import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { Budget, BudgetExceededError } from '../ai/pricing.js';
import { getBrand } from '../brands/index.js';
import type { BrandConfig } from '../brands/index.js';
import type { Platform } from '../domain/constants.js';
import type { Queryable } from '../db/pool.js';
import type { Job, JobContext } from '../jobs/types.js';
import { NonRetryableJobError } from '../jobs/types.js';
import { zonedTimeToUtc } from '../jobs/time.js';
import { loadAudioLibrary, loadAudioUsage, recordAudioUsage } from '../media/audio-library-store.js';
import { renderLabel } from '../media/demo/voice-select.js';
import { renderPlatformVersions, type RenderedVersion } from '../media/demo/variants.js';
import type { Illustrator } from '../media/illustrator.js';
import { ExistingImagesIllustrator } from '../media/illustrator.js';
import type { QaCheck } from '../media/qa.js';
import type { VideoScript, VideoScriptScene } from '../media/pipeline.js';
import type { PipelineContext } from './context.js';
import { parsePayload } from './plan.js';
import type { ScriptGenerationOutput } from './script.js';
import type { ComplianceCheckType } from './shared.js';
import {
  brandDir,
  ensureDailyBudget,
  fromStorageUri,
  recordCompliance,
  recordCosts,
  sha256,
  STEP_ESTIMATE_USD,
  toStorageUri,
} from './shared.js';
import type { SharedIdeaNotes } from './storyboard.js';

const payloadSchema = z.object({ scriptId: z.uuid() });

interface ScriptRow {
  id: string;
  brand_id: string;
  content_idea_id: string;
  title: string;
  language: string;
  content_category: string;
  generation_output: ScriptGenerationOutput;
  planned_for: string;
  slot: number;
  research_notes: Partial<SharedIdeaNotes>;
}

/** QA check name → compliance_results.check_type. */
export function qaCheckType(name: string): ComplianceCheckType {
  if (name === 'audio_rights') return 'licence';
  if (/audio|loudness|silen|clipping/.test(name)) return 'audio';
  if (name === 'duration_target') return 'brand_relevance';
  return 'video_integrity';
}

const variantName = (i: number, platforms: readonly Platform[]) => (i === 0 ? 'main' : platforms.join('-'));

/** When the brand's slot should go live (local publish time in the brand's time zone). */
export function slotPublishAt(brand: BrandConfig, date: string, slot: number): Date {
  const s = brand.contentSlots.find((c) => c.slot === slot);
  if (!s) throw new NonRetryableJobError(`${brand.id} has no slot ${slot}`);
  return zonedTimeToUtc(date, s.publishTime, brand.publishTimezone);
}

/**
 * Creates one scheduled publication per platform (the version made for that platform), at the slot's
 * publish time. Idempotent per brand/date/slot/platform.
 */
export async function schedulePublications(
  db: Queryable,
  brand: BrandConfig,
  args: { date: string; slot: number; videos: { id: string; platforms: Platform[] }[] },
): Promise<number> {
  const at = slotPublishAt(brand, args.date, args.slot);
  let created = 0;
  for (const platform of brand.platforms) {
    const video = args.videos.find((v) => v.platforms.includes(platform));
    if (!video) continue;
    const res = await db.query(
      `INSERT INTO publications (brand_id, video_id, social_account_id, platform, publishing_provider,
                                 idempotency_key, status, scheduled_for, made_for_kids, ai_disclosure)
       SELECT $1, $2, s.id, $3, s.publishing_provider, $4, 'scheduled', $5, $6, true
         FROM social_accounts s WHERE s.brand_id = $1 AND s.platform = $3
       ON CONFLICT DO NOTHING`,
      [
        brand.id,
        video.id,
        platform,
        `publish:${brand.id}:${args.date}:slot-${args.slot}:${platform}`,
        at,
        brand.madeForKids,
      ],
    );
    created += res.rowCount ?? 0;
  }
  return created;
}

function toVideoScript(brand: BrandConfig, row: ScriptRow, scenes: SceneRow[]): VideoScript {
  return {
    brandId: brand.id,
    title: row.title,
    contentCategory: row.content_category,
    language: brand.language,
    scenes: scenes.map((s): VideoScriptScene => ({
      ...(s.art_direction as Omit<VideoScriptScene, 'narration' | 'visual'>),
      narration: s.narration_text,
      visual: s.visual_description,
    })),
  };
}

interface SceneRow {
  narration_text: string;
  visual_description: string;
  art_direction: Record<string, unknown>;
}

/**
 * video.render: voice, captions, licensed sound, FFmpeg render and QA for one script, stored as
 * videos (one per platform version) with assets, QA results and costs. Final renders that pass QA
 * get scheduled publications; failed QA quarantines the job, so nothing failed is ever published.
 */
export function renderHandler(ctx: PipelineContext) {
  return async (job: Job, jc: JobContext) => {
    const p = parsePayload(payloadSchema, job);
    const row = (
      await ctx.db.query<ScriptRow>(
        `SELECT s.id, s.brand_id, s.content_idea_id, s.title, s.language, s.content_category, s.generation_output,
                to_char(i.planned_for, 'YYYY-MM-DD') AS planned_for, i.slot, i.research_notes
           FROM scripts s JOIN content_ideas i ON i.id = s.content_idea_id
          WHERE s.id = $1`,
        [p.scriptId],
      )
    ).rows[0];
    if (!row) throw new NonRetryableJobError(`script ${p.scriptId} not found`);
    const brand = getBrand(row.brand_id);
    if (!brand) throw new NonRetryableJobError(`unknown brand ${row.brand_id}`);
    const final = ctx.settings.renderMode === 'final';

    const done = await ctx.db.query<{ id: string; platforms: Platform[]; qa_status: string }>(
      `SELECT id, platforms, qa_status FROM videos WHERE script_id = $1 AND render_status = 'rendered' ORDER BY variant = 'main' DESC`,
      [row.id],
    );
    if (done.rows.length && done.rows.every((v) => v.qa_status === 'passed')) {
      const scheduled = final
        ? await schedulePublications(ctx.db, brand, {
            date: row.planned_for,
            slot: row.slot,
            videos: done.rows,
          })
        : 0;
      return { reused: true, videos: done.rows.map((v) => v.id), publicationsCreated: scheduled };
    }

    await ensureDailyBudget(ctx, STEP_ESTIMATE_USD.render, `${brand.id} narration`);
    const voiceBudget = new Budget(ctx.providers.caps.voiceUsd);
    const imageBudget = new Budget(ctx.providers.caps.storyboardUsd);
    const selection = await ctx.providers.selectVoice(brand, voiceBudget, ctx.settings.renderMode);
    let label: string | undefined;
    try {
      label = renderLabel(selection, final);
    } catch (err) {
      throw new NonRetryableJobError(
        `final render refused: ${(err as Error).message} Set PIPELINE_RENDER_MODE=test for labelled test renders.`,
      );
    }

    const scenes = (
      await ctx.db.query<SceneRow>(
        `SELECT narration_text, visual_description, art_direction FROM video_scenes WHERE script_id = $1 ORDER BY scene_index`,
        [row.id],
      )
    ).rows;
    if (!scenes.length) throw new NonRetryableJobError(`script ${row.id} has no scenes`);
    const script = toVideoScript(brand, row, scenes);
    const g = row.generation_output;
    const notes = row.research_notes;
    let illustrator: Illustrator;
    if (notes.mode === 'shared-storyboard' && notes.imagesDir && notes.images) {
      const dir = fromStorageUri(notes.imagesDir);
      if (notes.images.some((f) => !existsSync(join(dir, f))))
        throw new NonRetryableJobError(`shared images are missing from ${notes.imagesDir}`);
      illustrator = new ExistingImagesIllustrator(dir, notes.images);
    } else {
      illustrator = ctx.providers.illustrator(imageBudget);
    }

    const library = await loadAudioLibrary(ctx.db, ['approved']);
    const usage = await loadAudioUsage(ctx.db, brand.id);
    const workDir = brandDir(ctx.settings.dataDir, row.planned_for, row.slot, brand.id);
    rmSync(workDir, { recursive: true, force: true });

    let versions: RenderedVersion[];
    try {
      versions = await renderPlatformVersions({
        base: {
          brand,
          script,
          voice: selection.voice,
          illustrator,
          characterDescription: g.characterDescription,
          tools: ctx.providers.tools,
          label,
          signal: jc.signal,
          ...ctx.providers.renderOverrides,
          manifestExtra: {
            voiceSelection: {
              temporary: selection.temporary,
              voiceId: selection.voiceId ?? null,
              commercial: selection.commercial,
            },
            script: {
              provider: 'openai',
              centralIdea: g.centralIdea,
              idea: g.idea,
              deliveryStyle: g.deliveryStyle,
              soundDesign: g.soundDesign,
              safetyNotes: g.safetyNotes,
            },
            metadata: g.metadata,
            pipeline: { scriptId: row.id, contentIdeaId: row.content_idea_id, jobId: job.id },
          },
        },
        workDir,
        sound: {
          brief: g.soundDesign,
          scenes: script.scenes,
          durationSec: g.estimatedDurationSec,
          kids: brand.niche === 'kids',
        },
        library,
        usage,
        metadata: g.metadata,
        metadataBase: { brandId: brand.id, title: row.title, idea: g.idea },
        log: (line) => ctx.logger.debug({ jobId: job.id }, line.trim()),
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new NonRetryableJobError(err.message);
      throw err;
    } finally {
      const links = { jobId: job.id, contentIdeaId: row.content_idea_id, scriptId: row.id };
      await recordCosts(ctx.db, {
        brandId: brand.id,
        provider: 'elevenlabs',
        entries: voiceBudget.entries,
        links,
      });
      await recordCosts(ctx.db, {
        brandId: brand.id,
        provider: 'openai',
        entries: imageBudget.entries,
        links,
      });
    }

    const width = ctx.providers.renderOverrides?.width ?? 1080;
    const height = ctx.providers.renderOverrides?.height ?? 1920;
    const stored: { id: string; platforms: Platform[]; passed: boolean; qa: QaCheck[] }[] = [];
    for (const [i, v] of versions.entries()) {
      const id = await storeVersion(ctx, {
        brand,
        row,
        version: v,
        variant: variantName(i, v.variant.platforms),
        label,
        width,
        height,
        attempt: job.attempts,
      });
      stored.push({ id, platforms: v.variant.platforms, passed: v.result.passed, qa: v.result.qa });
    }
    await ctx.db.query(`UPDATE cost_records SET video_id = $1 WHERE job_id = $2 AND video_id IS NULL`, [
      stored[0]!.id,
      job.id,
    ]);

    const failed = stored.flatMap((s) =>
      s.qa.filter((c) => c.status === 'failed').map((c) => `${c.name}: ${c.detail}`),
    );
    if (failed.length) throw new NonRetryableJobError(`video QA failed: ${failed.join('; ')}`);

    await ctx.db.query(`UPDATE content_ideas SET status = 'used' WHERE id = $1 AND status = 'selected'`, [
      row.content_idea_id,
    ]);
    const publicationsCreated = final
      ? await schedulePublications(ctx.db, brand, { date: row.planned_for, slot: row.slot, videos: stored })
      : 0;
    return {
      videos: stored.map((s) => ({ id: s.id, platforms: s.platforms })),
      mode: ctx.settings.renderMode,
      publicationsCreated,
      voiceUsd: voiceBudget.spentUsd,
    };
  };
}

async function storeVersion(
  ctx: PipelineContext,
  a: {
    brand: BrandConfig;
    row: ScriptRow;
    version: RenderedVersion;
    variant: string;
    label: string | undefined;
    width: number;
    height: number;
    attempt: number;
  },
): Promise<string> {
  const { brand, row, version } = a;
  const r = version.result;
  const meta = JSON.parse(readFileSync(join(version.workDir, 'metadata.json'), 'utf8')) as {
    youtubeDescription?: string;
    credits?: string[];
  };
  const checksum = sha256(readFileSync(r.video));
  const g = row.generation_output;
  const res = await ctx.db.query<{ id: string }>(
    `INSERT INTO videos (brand_id, script_id, content_idea_id, language, content_category, title, description, hashtags,
                         duration_sec, duration_bucket, width, height, storage_uri, checksum_sha256, made_for_kids,
                         ai_disclosure_required, render_status, qa_status, render_attempts, metadata, variant, platforms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, 'rendered', $16, $17, $18, $19, $20)
     ON CONFLICT (script_id, variant) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description, hashtags = EXCLUDED.hashtags,
       duration_sec = EXCLUDED.duration_sec, duration_bucket = EXCLUDED.duration_bucket, width = EXCLUDED.width,
       height = EXCLUDED.height, storage_uri = EXCLUDED.storage_uri, checksum_sha256 = EXCLUDED.checksum_sha256,
       render_status = 'rendered', qa_status = EXCLUDED.qa_status, render_attempts = EXCLUDED.render_attempts,
       metadata = EXCLUDED.metadata, platforms = EXCLUDED.platforms, provider_media_url = NULL
     RETURNING id`,
    [
      brand.id,
      row.id,
      row.content_idea_id,
      brand.language,
      row.content_category,
      g.metadata.youtubeTitle,
      meta.youtubeDescription ?? g.metadata.shortDescription,
      g.metadata.hashtags,
      r.durationSec.toFixed(2),
      r.durationBucket,
      a.width,
      a.height,
      toStorageUri(r.video),
      checksum,
      brand.madeForKids,
      r.passed ? 'passed' : 'failed',
      a.attempt,
      JSON.stringify({
        workDir: toStorageUri(version.workDir),
        label: a.label ?? null,
        voice: r.voice,
        illustrator: r.illustrator,
        music: r.music,
        credits: meta.credits ?? [],
        captionsAlignedScenes: r.captionsAlignedScenes,
        renderSeconds: r.renderSeconds,
      }),
      a.variant,
      version.variant.platforms,
    ],
  );
  const videoId = res.rows[0]!.id;

  await ctx.db.query('DELETE FROM assets WHERE video_id = $1', [videoId]);
  const assets: { kind: string; file: string; mime: string; provider?: string }[] = [
    { kind: 'video', file: r.video, mime: 'video/mp4', provider: 'ffmpeg' },
    { kind: 'thumbnail', file: r.thumbnail, mime: 'image/jpeg', provider: 'ffmpeg' },
    ...r.imageFiles.map((f) => ({
      kind: 'illustration',
      file: join(version.workDir, f),
      mime: f.endsWith('.png') ? 'image/png' : 'image/jpeg',
      provider: r.illustrator,
    })),
    ...r.narrationClips.flatMap((c) =>
      c ? [{ kind: 'voiceover', file: c.file, mime: 'audio/mpeg', provider: r.voice }] : [],
    ),
  ];
  for (const asset of assets) {
    if (!existsSync(asset.file)) continue;
    const bytes = readFileSync(asset.file);
    await ctx.db.query(
      `INSERT INTO assets (brand_id, kind, script_id, video_id, storage_uri, mime_type, checksum_sha256, bytes,
                           generation_provider, provenance, licence_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'original_generated')`,
      [
        brand.id,
        asset.kind,
        row.id,
        videoId,
        toStorageUri(resolve(asset.file)),
        asset.mime,
        sha256(bytes),
        bytes.length,
        asset.provider ?? null,
        JSON.stringify({ jobRender: true }),
      ],
    );
  }

  for (const check of r.qa) {
    await recordCompliance(ctx.db, {
      brandId: brand.id,
      entityType: 'video',
      entityId: videoId,
      checkType: qaCheckType(check.name),
      status: check.status === 'passed' ? 'passed' : check.status === 'warning' ? 'warning' : 'failed',
      checker: `media.qa:${check.name}`,
      details: { detail: check.detail },
    });
  }

  if (r.passed) {
    const plan = version.variant.soundPlan;
    const uses = [
      ...(plan.music ? [{ code: plan.music.asset.assetCode, role: 'music' as const }] : []),
      ...(plan.ambience ? [{ code: plan.ambience.asset.assetCode, role: 'ambience' as const }] : []),
      ...plan.sfx.map((s) => ({ code: s.asset.assetCode, role: 'sound_effect' as const })),
    ];
    for (const [k, u] of uses.entries()) {
      await recordAudioUsage(ctx.db, {
        assetCode: u.code,
        brandId: brand.id,
        videoId,
        role: u.role,
        platforms: version.variant.platforms,
        idempotencyKey: `video:${videoId}:${u.role}:${k}:${u.code}`,
      });
    }
  }
  return videoId;
}
