import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandConfig } from '../brands/index.js';
import { ApiError } from '../ai/http-client.js';
import type { Platform } from '../domain/constants.js';
import type { BlotatoClient, BlotatoPostRequest, BlotatoPostStatus } from './blotato.js';
import type { RenderManifest } from './gate.js';
import { publishProblems } from './gate.js';
import type { PublishTarget } from './post-builder.js';
import { buildBlotatoPost } from './post-builder.js';

export type LedgerStatus = 'submitting' | 'in-progress' | 'scheduled' | 'published' | 'failed';

export interface LedgerEntry {
  idempotencyKey: string;
  platform: Platform;
  accountId: string;
  status: LedgerStatus;
  postSubmissionId?: string;
  publicUrl?: string;
  scheduledTime?: string;
  errorMessage?: string;
  updatedAt: string;
}

export interface Ledger {
  videoSha256: string;
  mediaUrl?: string;
  entries: LedgerEntry[];
}

export const LEDGER_FILE = 'publications.json';

/** Deterministic key: one publication per brand, platform, destination account and exact video file. */
export function idempotencyKey(
  brandId: string,
  platform: Platform,
  accountId: string,
  videoSha256: string,
): string {
  return createHash('sha256').update(`${brandId}|${platform}|${accountId}|${videoSha256}`).digest('hex');
}

function loadLedger(dir: string, videoSha256: string): Ledger {
  const file = join(dir, LEDGER_FILE);
  if (!existsSync(file)) return { videoSha256, entries: [] };
  const ledger = JSON.parse(readFileSync(file, 'utf8')) as Ledger;
  if (ledger.videoSha256 !== videoSha256) {
    throw new Error(
      `${LEDGER_FILE} belongs to a different video file; the video was changed after publishing started`,
    );
  }
  return ledger;
}

function saveLedger(dir: string, ledger: Ledger): void {
  writeFileSync(join(dir, LEDGER_FILE), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

export interface PublishOptions {
  dir: string;
  brand: BrandConfig;
  manifest: RenderManifest;
  platforms: readonly Platform[];
  targets: Partial<Record<Platform, PublishTarget>>;
  /** null = dry run: gate + payload preview, no API calls. */
  client: BlotatoClient | null;
  youtubePrivacy: 'private' | 'unlisted' | 'public';
  schedule?: string;
  /** Resubmit platforms whose last attempt failed (after fixing the cause). */
  retryFailed?: boolean;
  /** Status checks per platform before leaving a post "in-progress" for a later run. */
  maxChecks?: number;
  log: (line: string) => void;
}

export interface PublishOutcome {
  platform: Platform;
  result:
    'blocked' | 'dry-run' | 'skipped' | 'published' | 'scheduled' | 'in-progress' | 'failed' | 'needs-check';
  detail: string;
  request?: BlotatoPostRequest;
}

const now = () => new Date().toISOString();

function applyStatus(entry: LedgerEntry, s: BlotatoPostStatus): void {
  entry.status = s.status;
  entry.updatedAt = now();
  if (s.status === 'published') entry.publicUrl = s.publicUrl;
  if (s.status === 'scheduled') entry.scheduledTime = s.scheduledTime;
  if (s.status === 'failed') entry.errorMessage = s.errorMessage;
}

function outcomeOf(platform: Platform, entry: LedgerEntry): PublishOutcome {
  switch (entry.status) {
    case 'published':
      return {
        platform,
        result: 'published',
        detail: entry.publicUrl ?? 'published (no public URL returned)',
      };
    case 'scheduled':
      return { platform, result: 'scheduled', detail: `scheduled for ${entry.scheduledTime ?? '?'}` };
    case 'failed':
      return { platform, result: 'failed', detail: entry.errorMessage ?? 'failed (no reason returned)' };
    default:
      return {
        platform,
        result: 'in-progress',
        detail: `still processing (submission ${entry.postSubmissionId}); run the same command later to check`,
      };
  }
}

/**
 * Publishes one rendered video to the requested platforms through Blotato, at most once per
 * destination. Every platform passes the publishing gate first; a dry run stops after the preview.
 */
export async function publishRender(opts: PublishOptions): Promise<PublishOutcome[]> {
  const { dir, brand, manifest, log } = opts;
  const videoFile = join(dir, 'video.mp4');
  if (!existsSync(videoFile)) throw new Error(`No video.mp4 in ${dir}`);
  const videoSha256 = createHash('sha256').update(readFileSync(videoFile)).digest('hex');
  const ledger = loadLedger(dir, videoSha256);
  const outcomes: PublishOutcome[] = [];

  for (const platform of opts.platforms) {
    const problems = publishProblems(manifest, brand, platform);
    const target = opts.targets[platform];
    if (!target)
      problems.push(`no Blotato account linked for ${brand.id}/${platform} (npm run blotato:link)`);
    if (problems.length) {
      outcomes.push({ platform, result: 'blocked', detail: problems.join('; ') });
      continue;
    }
    const request = buildBlotatoPost({
      brand,
      target: target!,
      mediaUrl: ledger.mediaUrl ?? '<public URL after upload>',
      metadata: manifest.metadata!,
      credits: manifest.credits,
      youtubePrivacy: opts.youtubePrivacy,
      schedule: opts.schedule,
    });
    if (!opts.client) {
      outcomes.push({ platform, result: 'dry-run', detail: 'gate passed; nothing sent', request });
      continue;
    }

    const key = idempotencyKey(brand.id, platform, target!.accountId, videoSha256);
    let entry = ledger.entries.find((e) => e.idempotencyKey === key);
    if (entry?.status === 'published' || entry?.status === 'scheduled') {
      outcomes.push({ ...outcomeOf(platform, entry), result: 'skipped' });
      continue;
    }
    if (entry?.status === 'submitting') {
      outcomes.push({
        platform,
        result: 'needs-check',
        detail:
          'an earlier submit may have reached Blotato without a reply; check https://my.blotato.com/posts before retrying (remove this entry from publications.json only if the post is not there)',
      });
      continue;
    }
    if (entry?.status === 'failed' && !opts.retryFailed) {
      outcomes.push(outcomeOf(platform, entry));
      continue;
    }
    if (entry?.status === 'in-progress' && entry.postSubmissionId) {
      applyStatus(
        entry,
        await opts.client.waitForPost(entry.postSubmissionId, { maxChecks: opts.maxChecks }),
      );
      saveLedger(dir, ledger);
      outcomes.push(outcomeOf(platform, entry));
      continue;
    }

    if (!ledger.mediaUrl) {
      log(`  uploading video.mp4 to Blotato…`);
      ledger.mediaUrl = await opts.client.uploadFile(videoFile);
      saveLedger(dir, ledger);
    }
    request.post.content.mediaUrls = [ledger.mediaUrl];
    if (!entry) {
      entry = {
        idempotencyKey: key,
        platform,
        accountId: target!.accountId,
        status: 'submitting',
        updatedAt: now(),
      };
      ledger.entries.push(entry);
    } else {
      Object.assign(entry, {
        status: 'submitting',
        errorMessage: undefined,
        postSubmissionId: undefined,
        updatedAt: now(),
      });
    }
    // Persist the intent before the one-shot create call, so a crash can never cause a blind resubmit.
    saveLedger(dir, ledger);
    log(`  submitting to ${platform}…`);
    let created: { postSubmissionId: string; scheduledTime?: string };
    try {
      created = await opts.client.createPost(request);
    } catch (err) {
      // A 4xx means Blotato rejected the request, so nothing was created. Anything else (timeout,
      // network, 5xx) is ambiguous and stays "submitting" until someone checks the dashboard.
      if (err instanceof ApiError && err.status !== null && err.status >= 400 && err.status < 500) {
        Object.assign(entry, { status: 'failed', errorMessage: err.message, updatedAt: now() });
        saveLedger(dir, ledger);
        outcomes.push(outcomeOf(platform, entry));
        continue;
      }
      throw err;
    }
    entry.postSubmissionId = created.postSubmissionId;
    entry.status = 'in-progress';
    entry.updatedAt = now();
    saveLedger(dir, ledger);
    if (created.scheduledTime) {
      applyStatus(entry, { status: 'scheduled', scheduledTime: created.scheduledTime });
    } else {
      applyStatus(
        entry,
        await opts.client.waitForPost(created.postSubmissionId, { maxChecks: opts.maxChecks }),
      );
    }
    saveLedger(dir, ledger);
    outcomes.push({ ...outcomeOf(platform, entry), request });
  }
  return outcomes;
}
