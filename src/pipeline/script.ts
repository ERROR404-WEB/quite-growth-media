import { z } from 'zod';
import { Budget } from '../ai/pricing.js';
import type { GeneratedScript } from '../ai/script-writer.js';
import type { BrandConfig } from '../brands/index.js';
import { withTransaction } from '../db/pool.js';
import { durationBucketFor, JOB_TYPES } from '../domain/constants.js';
import { enqueue } from '../jobs/queue.js';
import type { Job, JobContext } from '../jobs/types.js';
import { NonRetryableJobError } from '../jobs/types.js';
import { musicMoodsOnAnyPlatform } from '../media/audio-library.js';
import { loadAudioLibrary } from '../media/audio-library-store.js';
import type { PipelineContext } from './context.js';
import { contentPlanPayload, parsePayload, renderKey, requireBrand } from './plan.js';
import { ensureDailyBudget, recordCompliance, recordCosts, sha256, STEP_ESTIMATE_USD } from './shared.js';
import type { SharedIdeaNotes } from './storyboard.js';
import { withFeedback } from './storyboard.js';

const payloadSchema = z.union([z.object({ contentIdeaId: z.uuid() }), contentPlanPayload]);

export const SCRIPT_PROMPT_VERSION = 'creative-direction-v3';

/** Normalised narration hash: identical wording in any brand counts as a duplicate. */
export function narrationHash(script: GeneratedScript['script']): string {
  return sha256(
    script.scenes
      .map((s) => s.narration)
      .join(' ')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

interface IdeaRow {
  id: string;
  brand_id: string;
  content_category: string;
  planned_for: string;
  slot: number;
  research_notes: Partial<SharedIdeaNotes>;
}

/** Stored in scripts.generation_output (everything the renderer and publisher need besides scenes). */
export interface ScriptGenerationOutput {
  idea: GeneratedScript['idea'];
  centralIdea: string;
  deliveryStyle: GeneratedScript['deliveryStyle'];
  characterDescription: string;
  soundDesign: GeneratedScript['soundDesign'];
  metadata: GeneratedScript['metadata'];
  safetyNotes: string;
  estimatedDurationSec: number;
  usage: GeneratedScript['usage'];
}

/**
 * script.generate: the brand's own native script (never a translation), from the shared storyboard's
 * meaning or, for single-brand slots, from scratch. Validated, duplicate-checked and stored.
 */
export function scriptHandler(ctx: PipelineContext) {
  return async (job: Job, jc: JobContext) => {
    const p = parsePayload(payloadSchema, job);
    let idea: IdeaRow | undefined;
    let brand: BrandConfig;
    let target: { date: string; slot: number; contentCategory: string };
    if ('contentIdeaId' in p) {
      idea = (
        await ctx.db.query<IdeaRow>(
          `SELECT id, brand_id, content_category, to_char(planned_for, 'YYYY-MM-DD') AS planned_for, slot,
                  research_notes
             FROM content_ideas WHERE id = $1`,
          [p.contentIdeaId],
        )
      ).rows[0];
      if (!idea) throw new NonRetryableJobError(`content idea ${p.contentIdeaId} not found`);
      brand = requireBrand(idea.brand_id);
      target = { date: idea.planned_for, slot: idea.slot, contentCategory: idea.content_category };
    } else {
      brand = requireBrand(p.brandId);
      target = { date: p.date, slot: p.slot, contentCategory: p.contentCategory };
      // A retry after a crash finds the idea the first run stored.
      idea = (
        await ctx.db.query<IdeaRow>(
          `SELECT id, brand_id, content_category, to_char(planned_for, 'YYYY-MM-DD') AS planned_for, slot,
                  research_notes
             FROM content_ideas
            WHERE brand_id = $1 AND planned_for = $2 AND slot = $3 AND status IN ('selected', 'used')`,
          [brand.id, p.date, p.slot],
        )
      ).rows[0];
    }

    const existing = idea
      ? (
          await ctx.db.query<{ id: string }>(
            `SELECT id FROM scripts WHERE content_idea_id = $1 AND status = 'validated' ORDER BY version DESC LIMIT 1`,
            [idea.id],
          )
        ).rows[0]
      : undefined;
    let scriptId = existing?.id;

    if (!scriptId) {
      await ensureDailyBudget(ctx, STEP_ESTIMATE_USD.script, `${brand.id} script`);
      const storyboard = idea?.research_notes.storyboard;
      const recent = await ctx.db.query<{ title: string }>(
        `SELECT title FROM scripts WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [brand.id],
      );
      const moods = storyboard
        ? undefined
        : musicMoodsOnAnyPlatform(await loadAudioLibrary(ctx.db, ['approved']), brand.platforms);
      const budget = new Budget(ctx.providers.caps.scriptUsd);
      let g: GeneratedScript;
      try {
        g = await withFeedback((feedback) =>
          ctx.providers.generateScript(
            {
              brand,
              contentCategory: target.contentCategory,
              storyboard,
              feedback,
              avoidTitles: recent.rows.map((r) => r.title),
              availableMusicMoods: moods,
            },
            budget,
            jc.signal,
          ),
        );
      } finally {
        await recordCosts(ctx.db, {
          brandId: brand.id,
          provider: 'openai',
          entries: budget.entries,
          links: { jobId: job.id, contentIdeaId: idea?.id },
        });
      }

      const hash = narrationHash(g.script);
      const dup = await ctx.db.query<{ id: string; brand_id: string }>(
        `SELECT id, brand_id FROM scripts WHERE content_hash = $1 LIMIT 1`,
        [hash],
      );
      if (dup.rows[0]) {
        throw new NonRetryableJobError(
          `duplicate narration: same wording as script ${dup.rows[0].id} (${dup.rows[0].brand_id})`,
        );
      }

      scriptId = await withTransaction(ctx.db, async (tx) => {
        let ideaId = idea?.id;
        if (!ideaId) {
          const ins = await tx.query<{ id: string }>(
            `INSERT INTO content_ideas (brand_id, language, content_category, planned_for, slot, title, angle, summary,
                                        research_notes, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'selected') RETURNING id`,
            [
              brand.id,
              brand.language,
              target.contentCategory,
              target.date,
              target.slot,
              g.script.title,
              g.idea.permissionGiven,
              g.centralIdea,
              JSON.stringify({ mode: 'single-brand', jobId: job.id }),
            ],
          );
          ideaId = ins.rows[0]!.id;
        }
        const output: ScriptGenerationOutput = {
          idea: g.idea,
          centralIdea: g.centralIdea,
          deliveryStyle: g.deliveryStyle,
          characterDescription: g.characterDescription,
          soundDesign: g.soundDesign,
          metadata: g.metadata,
          safetyNotes: g.safetyNotes,
          estimatedDurationSec: g.estimatedDurationSec,
          usage: g.usage,
        };
        const body = g.script.scenes.map((s) => s.narration).join('\n');
        const s = await tx.query<{ id: string }>(
          `INSERT INTO scripts (brand_id, content_idea_id, version, language, content_category, title, hook, body,
                                word_count, estimated_duration_sec, duration_bucket, generation_provider,
                                generation_model, prompt_version, content_hash, status, generation_output)
           VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, 'openai', $11, $12, $13, 'validated', $14)
           RETURNING id`,
          [
            brand.id,
            ideaId,
            brand.language,
            target.contentCategory,
            g.script.title,
            g.script.scenes[0]?.narration ?? null,
            body,
            body.split(/\s+/).filter(Boolean).length,
            g.estimatedDurationSec,
            durationBucketFor(g.estimatedDurationSec),
            g.model,
            SCRIPT_PROMPT_VERSION,
            hash,
            JSON.stringify(output),
          ],
        );
        const id = s.rows[0]!.id;
        for (const [i, scene] of g.script.scenes.entries()) {
          const { narration, visual, ...direction } = scene;
          await tx.query(
            `INSERT INTO video_scenes (brand_id, script_id, scene_index, narration_text, visual_description, art_direction)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [brand.id, id, i, narration, visual, JSON.stringify(direction)],
          );
        }
        await tx.query(`UPDATE cost_records SET script_id = $1, content_idea_id = $2 WHERE job_id = $3`, [
          id,
          ideaId,
          job.id,
        ]);
        const checker = 'script-writer.validateScript';
        for (const [checkType, details] of [
          ['language', { language: brand.language, nativeScriptShare: 'checked' }],
          ['brand_relevance', { category: target.contentCategory, arc: 'checked' }],
          ['platform_policy', { metadata: 'platform text limits checked', safetyNotes: g.safetyNotes }],
          ['originality', { contentHash: hash, scope: 'all brands' }],
        ] as const) {
          await recordCompliance(tx, {
            brandId: brand.id,
            entityType: 'script',
            entityId: id,
            checkType,
            status: 'passed',
            checker: checkType === 'originality' ? 'pipeline.narrationHash' : checker,
            details,
          });
        }
        return id;
      });
    }

    const { job: next } = await enqueue(
      ctx.db,
      {
        jobType: JOB_TYPES.videoRender,
        idempotencyKey: renderKey(brand.id, target.date, target.slot),
        brandId: brand.id,
        payload: { scriptId },
        parentJobId: job.id,
      },
      ctx.settings.maxAttempts,
    );
    return { scriptId, reused: !!existing, renderJobId: next.id };
  };
}
