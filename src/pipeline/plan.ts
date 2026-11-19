import { z } from 'zod';
import type { BrandConfig } from '../brands/index.js';
import { getBrand } from '../brands/index.js';
import { JOB_TYPES } from '../domain/constants.js';
import { enqueue } from '../jobs/queue.js';
import { todayIn } from '../jobs/schedule.js';
import type { Job } from '../jobs/types.js';
import { NonRetryableJobError } from '../jobs/types.js';
import type { PipelineContext } from './context.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const contentPlanPayload = z.object({
  brandId: z.string().min(1),
  date,
  slot: z.number().int().min(1).max(20),
  contentCategory: z.string().min(1),
});

export const SHARED_GROUP = 'self-improvement';

export const storyboardKey = (date: string, slot: number) =>
  `${JOB_TYPES.storyboardGenerate}:${SHARED_GROUP}:${date}:slot-${slot}`;
export const scriptKey = (brandId: string, date: string, slot: number) =>
  `${JOB_TYPES.scriptGenerate}:${brandId}:${date}:slot-${slot}`;
export const renderKey = (brandId: string, date: string, slot: number) =>
  `${JOB_TYPES.videoRender}:${brandId}:${date}:slot-${slot}`;

/** Parses a job payload or quarantines the job (a malformed payload never fixes itself). */
export function parsePayload<T>(schema: z.ZodType<T>, job: Job): T {
  const parsed = schema.safeParse(job.payload);
  if (!parsed.success) {
    throw new NonRetryableJobError(
      `invalid ${job.job_type} payload: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

export function requireBrand(id: string): BrandConfig {
  const brand = getBrand(id);
  if (!brand) throw new NonRetryableJobError(`unknown brand ${id}`);
  return brand;
}

/** Brands the automation runs for, in brand-number order. */
export function automationBrands(ctx: PipelineContext, all: readonly BrandConfig[]): BrandConfig[] {
  const ids = ctx.settings.automationBrands;
  return ids.includes('all') ? [...all] : all.filter((b) => ids.includes(b.id));
}

/**
 * content.plan: decides how one brand's slot is made. Self-improvement brands share one storyboard and
 * image set per date and slot (owner exception, AGENTS.md rule 1); every other brand writes alone.
 */
export function contentPlanHandler(ctx: PipelineContext, allBrands: readonly BrandConfig[]) {
  return async (job: Job) => {
    const p = parsePayload(contentPlanPayload, job);
    const brand = requireBrand(p.brandId);
    // Old jobs (e.g. from before the pipeline existed) must not start spending money on past dates.
    if (p.date < todayIn(ctx.settings.timeZone, ctx.now()))
      return { skipped: `planned date ${p.date} has already passed` };
    if (!automationBrands(ctx, allBrands).some((b) => b.id === brand.id))
      throw new NonRetryableJobError(`${brand.id} is not in AUTOMATION_BRANDS`);
    const slot = brand.contentSlots.find((s) => s.slot === p.slot);
    if (!slot || slot.category !== p.contentCategory)
      throw new NonRetryableJobError(`${brand.id} has no slot ${p.slot} for ${p.contentCategory}`);
    if (brand.validation.scriptureCheck)
      throw new NonRetryableJobError(
        `${brand.displayName} needs scripture verification, which is not built yet; keep it out of AUTOMATION_BRANDS`,
      );

    if (brand.niche === 'self_improvement') {
      const group = automationBrands(ctx, allBrands).filter((b) => b.niche === 'self_improvement');
      const { job: next, created } = await enqueue(
        ctx.db,
        {
          jobType: JOB_TYPES.storyboardGenerate,
          idempotencyKey: storyboardKey(p.date, p.slot),
          brandId: null,
          payload: {
            date: p.date,
            slot: p.slot,
            contentCategory: p.contentCategory,
            brandIds: group.map((b) => b.id),
          },
          parentJobId: job.id,
        },
        ctx.settings.maxAttempts,
      );
      return { mode: 'shared-storyboard', storyboardJobId: next.id, created };
    }

    const { job: next, created } = await enqueue(
      ctx.db,
      {
        jobType: JOB_TYPES.scriptGenerate,
        idempotencyKey: scriptKey(brand.id, p.date, p.slot),
        brandId: brand.id,
        payload: { brandId: brand.id, date: p.date, slot: p.slot, contentCategory: p.contentCategory },
        parentJobId: job.id,
      },
      ctx.settings.maxAttempts,
    );
    return { mode: 'single-brand', scriptJobId: next.id, created };
  };
}
