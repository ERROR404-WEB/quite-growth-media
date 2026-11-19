import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Budget, BudgetExceededError } from '../ai/pricing.js';
import type { Storyboard } from '../ai/script-writer.js';
import { ScriptValidationError } from '../ai/script-writer.js';
import type { BrandConfig } from '../brands/index.js';
import { UNIVERSAL_VISUAL_IDENTITY } from '../brands/shared.js';
import { JOB_TYPES } from '../domain/constants.js';
import { enqueue } from '../jobs/queue.js';
import type { Job, JobContext } from '../jobs/types.js';
import { NonRetryableJobError } from '../jobs/types.js';
import { musicMoodsOnAnyPlatform } from '../media/audio-library.js';
import { loadAudioLibrary } from '../media/audio-library-store.js';
import { mapLimit } from '../media/illustrator.js';
import { even, OVERSCAN } from '../media/render.js';
import type { PipelineContext } from './context.js';
import { parsePayload, requireBrand, scriptKey } from './plan.js';
import { ensureDailyBudget, recordCosts, sharedDir, STEP_ESTIMATE_USD, toStorageUri } from './shared.js';

export const MAX_GENERATION_ATTEMPTS = 3;

const payloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.number().int().min(1).max(20),
  contentCategory: z.string().min(1),
  brandIds: z.array(z.string().min(1)).min(1),
});

/** Research notes stored on every brand's content idea for a shared storyboard. */
export interface SharedIdeaNotes {
  mode: 'shared-storyboard';
  storyboard: Storyboard;
  /** Storage URI of the shared images folder. */
  imagesDir: string;
  images: string[];
  storyboardJobId: string;
}

/**
 * Retries a generator on validation failure, passing the problems back so the next draft fixes them.
 * After the last attempt the job is quarantined (regenerate → bounded retries → quarantine).
 */
export async function withFeedback<T>(fn: (feedback?: string[]) => Promise<T>): Promise<T> {
  let feedback: string[] | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(feedback);
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new NonRetryableJobError(err.message);
      if (!(err instanceof ScriptValidationError)) throw err;
      if (attempt >= MAX_GENERATION_ATTEMPTS || err.problems.some((p) => /scripture/.test(p)))
        throw new NonRetryableJobError(
          `validation failed after ${attempt} attempt(s): ${err.problems.join('; ')}`,
        );
      feedback = err.problems;
    }
  }
}

const findImage = (dir: string, i: number) =>
  existsSync(dir) ? readdirSync(dir).find((f) => f.startsWith(`scene-${i + 1}.`)) : undefined;

/**
 * storyboard.generate: ONE topic and ONE image set for the self-improvement brands of a date/slot
 * (meaning only, never wording). Safe to re-run: an existing storyboard and images are reused.
 */
export function storyboardHandler(ctx: PipelineContext) {
  return async (job: Job, jc: JobContext) => {
    const p = parsePayload(payloadSchema, job);
    const brands: BrandConfig[] = p.brandIds.map(requireBrand);
    if (brands.some((b) => b.niche !== 'self_improvement'))
      throw new NonRetryableJobError('shared storyboards are only for the self-improvement brands');
    const dir = sharedDir(ctx.settings.dataDir, p.date, p.slot);
    const imagesDir = join(dir, 'images');
    mkdirSync(imagesDir, { recursive: true });
    const storyboardFile = join(dir, 'storyboard.json');
    const share = 1 / brands.length;
    const costBrands = async (budget: Budget, from: number) => {
      const entries = budget.entries.slice(from);
      for (const b of brands)
        await recordCosts(ctx.db, {
          brandId: b.id,
          provider: 'openai',
          entries,
          share,
          links: { jobId: job.id },
          metadata: { sharedStoryboard: `${p.date}/slot-${p.slot}` },
        });
      return budget.entries.length;
    };

    const budget = new Budget(ctx.providers.caps.storyboardUsd);
    let recorded = 0;
    let storyboard: Storyboard;
    if (existsSync(storyboardFile)) {
      storyboard = JSON.parse(readFileSync(storyboardFile, 'utf8')) as Storyboard;
    } else {
      await ensureDailyBudget(ctx, STEP_ESTIMATE_USD.storyboard, `the ${p.date} slot ${p.slot} storyboard`);
      const library = await loadAudioLibrary(ctx.db, ['approved']);
      const moods = musicMoodsOnAnyPlatform(library, brands[0]!.platforms);
      try {
        storyboard = await withFeedback(() =>
          ctx.providers.generateStoryboard(
            { brands, contentCategory: p.contentCategory, availableMusicMoods: moods },
            budget,
            jc.signal,
          ),
        );
      } finally {
        recorded = await costBrands(budget, recorded);
      }
      writeFileSync(storyboardFile, `${JSON.stringify(storyboard, null, 2)}\n`, 'utf8');
    }

    const missing = storyboard.lines.map((_, i) => i).filter((i) => !findImage(imagesDir, i));
    if (missing.length) {
      if (recorded === 0)
        await ensureDailyBudget(ctx, STEP_ESTIMATE_USD.storyboard, `the ${p.date} slot ${p.slot} images`);
      const illustrator = ctx.providers.illustrator(budget);
      const sharedBrand: BrandConfig = { ...brands[0]!, visualIdentity: UNIVERSAL_VISUAL_IDENTITY };
      try {
        await mapLimit(missing, ctx.providers.imageConcurrency, (i) =>
          illustrator.generate({
            brand: sharedBrand,
            sceneIndex: i,
            sceneCount: storyboard.lines.length,
            visual: storyboard.lines[i]!.visual,
            shot: storyboard.lines[i]!.shot,
            palette: storyboard.lines[i]!.palette,
            characterDescription: storyboard.characterDescription,
            seed: storyboard.title,
            width: even(1080 * OVERSCAN),
            height: even(1920 * OVERSCAN),
            workDir: imagesDir,
            signal: jc.signal,
          }),
        );
      } catch (err) {
        if (err instanceof BudgetExceededError) throw new NonRetryableJobError(err.message);
        throw err;
      } finally {
        await costBrands(budget, recorded);
      }
    }
    const images = storyboard.lines.map((_, i) => {
      const file = findImage(imagesDir, i);
      if (!file) throw new Error(`shared image ${i + 1} is missing after illustration`);
      return file;
    });

    const notes: SharedIdeaNotes = {
      mode: 'shared-storyboard',
      storyboard,
      imagesDir: toStorageUri(imagesDir),
      images,
      storyboardJobId: job.id,
    };
    const ideas: { brandId: string; contentIdeaId: string; scriptJobId: string }[] = [];
    for (const brand of brands) {
      const contentIdeaId = await upsertIdea(ctx, brand, p, storyboard, notes);
      const { job: next } = await enqueue(
        ctx.db,
        {
          jobType: JOB_TYPES.scriptGenerate,
          idempotencyKey: scriptKey(brand.id, p.date, p.slot),
          brandId: brand.id,
          payload: { contentIdeaId },
          parentJobId: job.id,
        },
        ctx.settings.maxAttempts,
      );
      ideas.push({ brandId: brand.id, contentIdeaId, scriptJobId: next.id });
    }
    return { title: storyboard.title, lines: storyboard.lines.length, spentUsd: budget.spentUsd, ideas };
  };
}

async function upsertIdea(
  ctx: PipelineContext,
  brand: BrandConfig,
  p: z.infer<typeof payloadSchema>,
  storyboard: Storyboard,
  notes: SharedIdeaNotes,
): Promise<string> {
  const inserted = await ctx.db.query<{ id: string }>(
    `INSERT INTO content_ideas (brand_id, language, content_category, planned_for, slot, title, angle, summary,
                                research_notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'selected')
     ON CONFLICT (brand_id, planned_for, slot) WHERE status IN ('selected', 'used') DO NOTHING
     RETURNING id`,
    [
      brand.id,
      brand.language,
      p.contentCategory,
      p.date,
      p.slot,
      storyboard.title,
      storyboard.idea.permissionGiven,
      storyboard.idea.coreMessage,
      JSON.stringify(notes),
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await ctx.db.query<{ id: string }>(
    `SELECT id FROM content_ideas WHERE brand_id = $1 AND planned_for = $2 AND slot = $3
        AND status IN ('selected', 'used')`,
    [brand.id, p.date, p.slot],
  );
  return existing.rows[0]!.id;
}
