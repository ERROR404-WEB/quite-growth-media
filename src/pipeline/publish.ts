import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ApiError } from '../ai/http-client.js';
import { getBrand } from '../brands/index.js';
import type { Platform } from '../domain/constants.js';
import { JOB_TYPES } from '../domain/constants.js';
import type { Queryable } from '../db/pool.js';
import { enqueue } from '../jobs/queue.js';
import type { Job, JobContext } from '../jobs/types.js';
import { DeferJobError, NonRetryableJobError } from '../jobs/types.js';
import type { BlotatoPostStatus } from '../publishing/blotato.js';
import type { RenderManifest } from '../publishing/gate.js';
import { publishProblems } from '../publishing/gate.js';
import { buildBlotatoPost } from '../publishing/post-builder.js';
import type { PipelineContext } from './context.js';
import { parsePayload } from './plan.js';
import { fromStorageUri } from './shared.js';

/** Publish jobs poll Blotato across retries (30 s, 1, 2, 4, 8 min backoff), so they get more attempts. */
export const PUBLISH_MAX_ATTEMPTS = 6;

export interface DueResult {
  due: number;
  enqueued: number;
  /** Due publications whose social account is not connected yet (they wait; nothing is lost). */
  waitingForAccount: number;
}

/**
 * Enqueues one video.publish job per due publication whose destination is connected. The key includes
 * the row's updated_at, so an operator retry (which resets the row) gets a fresh job; repeated calls
 * in between are no-ops.
 */
export async function enqueueDuePublications(db: Queryable, now: Date): Promise<DueResult> {
  const { rows } = await db.query<{
    id: string;
    brand_id: string;
    version: string;
    connected: boolean;
  }>(
    `SELECT p.id, p.brand_id, (extract(epoch FROM p.updated_at) * 1000000)::bigint::text AS version,
            (s.status = 'connected' AND s.provider_account_ref IS NOT NULL) AS connected
       FROM publications p
       JOIN social_accounts s ON s.id = p.social_account_id
       JOIN videos v ON v.id = p.video_id
      WHERE p.status = 'scheduled' AND p.scheduled_for <= $1 AND v.qa_status = 'passed'
      ORDER BY p.scheduled_for`,
    [now],
  );
  let enqueued = 0;
  for (const r of rows.filter((x) => x.connected)) {
    const res = await enqueue(db, {
      jobType: JOB_TYPES.videoPublish,
      idempotencyKey: `${JOB_TYPES.videoPublish}:${r.id}:${r.version}`,
      brandId: r.brand_id,
      payload: { publicationId: r.id },
      maxAttempts: PUBLISH_MAX_ATTEMPTS,
    });
    if (res.created) enqueued++;
  }
  return { due: rows.length, enqueued, waitingForAccount: rows.filter((x) => !x.connected).length };
}

/** Operator action after checking the provider dashboard: put a failed/blocked/unclear post back in line. */
export async function retryPublication(db: Queryable, id: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE publications SET status = 'scheduled', submission_id = NULL, last_error = NULL
      WHERE id = $1 AND status IN ('failed', 'needs_check', 'skipped')`,
    [id],
  );
  return (res.rowCount ?? 0) > 0;
}

interface PublicationRow {
  id: string;
  brand_id: string;
  platform: Platform;
  status: string;
  scheduled_for: Date | null;
  submission_id: string | null;
  video_id: string;
  qa_status: string;
  storage_uri: string | null;
  checksum_sha256: string | null;
  provider_media_url: string | null;
  video_metadata: { workDir?: string };
  account_id: string | null;
  account_status: string;
  page_id: string | null;
}

const payloadSchema = z.object({ publicationId: z.uuid() });

/**
 * video.publish: posts one video to one platform through Blotato, at most once. The publications row
 * is the ledger: the intent is saved before the one-shot create call, an unclear outcome becomes
 * needs_check (never a blind resubmit), and "still processing" is re-checked on the next attempt.
 */
export function publishHandler(ctx: PipelineContext) {
  return async (job: Job, jc: JobContext) => {
    const p = parsePayload(payloadSchema, job);
    const row = (
      await ctx.db.query<PublicationRow>(
        `SELECT p.id, p.brand_id, p.platform, p.status, p.scheduled_for, p.submission_id, p.video_id,
                v.qa_status, v.storage_uri, v.checksum_sha256, v.provider_media_url, v.metadata AS video_metadata,
                s.provider_account_ref AS account_id, s.status AS account_status, s.capabilities->>'pageId' AS page_id
           FROM publications p
           JOIN videos v ON v.id = p.video_id
           JOIN social_accounts s ON s.id = p.social_account_id
          WHERE p.id = $1`,
        [p.publicationId],
      )
    ).rows[0];
    if (!row) throw new NonRetryableJobError(`publication ${p.publicationId} not found`);
    const set = (fields: Record<string, unknown>) => updatePublication(ctx.db, row.id, fields);

    switch (row.status) {
      case 'published':
      case 'removed':
      case 'failed':
      case 'skipped':
        return { status: row.status, note: 'nothing to do' };
      case 'needs_check':
        throw new NonRetryableJobError(
          'needs check: look for this post at https://my.blotato.com/posts, then POST /api/publications/:id/retry only if it is not there',
        );
      case 'publishing':
        if (!row.submission_id) {
          await set({ status: 'needs_check', last_error: 'submit may have reached Blotato without a reply' });
          throw new NonRetryableJobError(
            'an earlier submit may have reached Blotato without a reply; marked needs_check (never resubmitted automatically)',
          );
        }
        return poll(ctx, row, row.submission_id, jc.signal);
    }

    // status = scheduled
    if (row.scheduled_for && row.scheduled_for.getTime() > ctx.now().getTime())
      throw new DeferJobError('not due yet', row.scheduled_for);
    const brand = getBrand(row.brand_id);
    if (!brand) throw new NonRetryableJobError(`unknown brand ${row.brand_id}`);
    const workDir = row.video_metadata.workDir ? fromStorageUri(row.video_metadata.workDir) : undefined;
    const manifestFile = workDir ? join(workDir, 'manifest.json') : undefined;
    const videoFile = row.storage_uri ? fromStorageUri(row.storage_uri) : undefined;
    const problems: string[] = [];
    let manifest: RenderManifest | undefined;
    if (row.qa_status !== 'passed') problems.push(`video QA status is ${row.qa_status}`);
    if (!manifestFile || !existsSync(manifestFile)) problems.push('render manifest.json is missing');
    else manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as RenderManifest;
    if (!videoFile || !existsSync(videoFile)) problems.push('video file is missing');
    if (manifest) problems.push(...publishProblems(manifest, brand, row.platform));
    if (row.account_status !== 'connected' || !row.account_id)
      problems.push(`no connected Blotato account for ${brand.id}/${row.platform}`);
    if (problems.length) {
      await set({ status: 'skipped', last_error: `blocked by the publishing gate: ${problems.join('; ')}` });
      throw new NonRetryableJobError(`blocked by the publishing gate: ${problems.join('; ')}`);
    }

    const client = ctx.providers.blotato();
    let request;
    try {
      request = buildBlotatoPost({
        brand,
        target: { platform: row.platform, accountId: row.account_id!, pageId: row.page_id ?? undefined },
        mediaUrl: row.provider_media_url ?? '<upload>',
        metadata: manifest!.metadata!,
        credits: manifest!.credits,
        youtubePrivacy: ctx.settings.youtubePrivacy,
      });
    } catch (err) {
      await set({ status: 'failed', last_error: (err as Error).message });
      throw new NonRetryableJobError(`post could not be built: ${(err as Error).message}`);
    }

    let mediaUrl = row.provider_media_url;
    if (!mediaUrl) {
      mediaUrl = await client.uploadFile(videoFile!, jc.signal);
      await ctx.db.query('UPDATE videos SET provider_media_url = $2 WHERE id = $1', [row.video_id, mediaUrl]);
    }
    request.post.content.mediaUrls = [mediaUrl];

    // Persist the intent before the one-shot create call, so a crash can never cause a blind resubmit.
    const claimed = await ctx.db.query(
      `UPDATE publications SET status = 'publishing', submission_id = NULL, attempts = attempts + 1, last_error = NULL
        WHERE id = $1 AND status = 'scheduled'`,
      [row.id],
    );
    if ((claimed.rowCount ?? 0) === 0)
      return { status: 'changed', note: 'publication was changed concurrently' };

    let created: { postSubmissionId: string };
    try {
      created = await client.createPost(request, jc.signal);
    } catch (err) {
      if (err instanceof ApiError && err.status !== null && err.status >= 400 && err.status < 500) {
        await set({ status: 'failed', last_error: err.message });
        throw new NonRetryableJobError(`Blotato rejected the post: ${err.message}`);
      }
      await set({
        status: 'needs_check',
        last_error: `no clear answer from Blotato: ${(err as Error).message}`,
      });
      throw new NonRetryableJobError(
        `no clear answer from Blotato (${(err as Error).message}); marked needs_check - check https://my.blotato.com/posts`,
      );
    }
    await set({
      submission_id: created.postSubmissionId,
      platform_metadata: {
        request: { platform: request.post.content.platform, target: request.post.target },
      },
    });
    return poll(ctx, row, created.postSubmissionId, jc.signal);
  };
}

async function poll(ctx: PipelineContext, row: PublicationRow, submissionId: string, signal: AbortSignal) {
  const status: BlotatoPostStatus = await ctx.providers
    .blotato()
    .waitForPost(submissionId, { maxChecks: ctx.providers.publishStatusChecks, signal });
  switch (status.status) {
    case 'published':
      await updatePublication(ctx.db, row.id, {
        status: 'published',
        published_at: ctx.now(),
        external_url: status.publicUrl ?? null,
        last_error: null,
      });
      return { status: 'published', url: status.publicUrl ?? null };
    case 'failed':
      await updatePublication(ctx.db, row.id, {
        status: 'failed',
        last_error: status.errorMessage ?? 'failed (no reason returned)',
      });
      throw new NonRetryableJobError(
        `Blotato could not publish: ${status.errorMessage ?? 'no reason returned'}`,
      );
    default:
      // Not a failure: the post is still processing; the next attempt only checks the status again.
      throw new Error(`still ${status.status} at Blotato (submission ${submissionId}); checking again later`);
  }
}

const COLUMNS = new Set([
  'status',
  'submission_id',
  'last_error',
  'published_at',
  'external_url',
  'platform_metadata',
]);

async function updatePublication(db: Queryable, id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields).filter((k) => COLUMNS.has(k));
  const sets = keys.map((k, i) =>
    k === 'platform_metadata' ? `${k} = ${k} || $${i + 2}::jsonb` : `${k} = $${i + 2}`,
  );
  const values = keys.map((k) => (k === 'platform_metadata' ? JSON.stringify(fields[k]) : fields[k]));
  await db.query(`UPDATE publications SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
}
