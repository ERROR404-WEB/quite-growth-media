import type { Queryable } from '../db/pool.js';
import { JOB_TYPES } from '../domain/constants.js';
import type { BrandConfig } from '../brands/index.js';
import { enqueue } from './queue.js';

export interface DailyScheduleResult {
  date: string;
  brands: number;
  created: number;
  existing: number;
}

/** YYYY-MM-DD for "today" in the given IANA timezone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function contentPlanKey(brandId: string, date: string, slot: number): string {
  return `${JOB_TYPES.contentPlan}:${brandId}:${date}:slot-${slot}`;
}

/**
 * Enqueues one independent content.plan job per active brand per content slot for the date.
 * `brandIds` limits the run to those brands (undefined or ["all"] = every active brand).
 * Idempotent: calling it again for the same date creates nothing new.
 */
export async function scheduleDaily(
  db: Queryable,
  date: string,
  maxAttempts: number,
  brandIds?: readonly string[],
): Promise<DailyScheduleResult> {
  const all = !brandIds || brandIds.includes('all');
  const { rows } = await db.query<{ id: string; config: BrandConfig }>(
    'SELECT id, config FROM brands WHERE is_active AND ($1::text[] IS NULL OR id = ANY($1)) ORDER BY brand_number',
    [all ? null : brandIds],
  );
  let created = 0;
  let existing = 0;
  for (const brand of rows) {
    for (const slot of brand.config.contentSlots.slice(0, brand.config.dailyVideoTarget)) {
      const result = await enqueue(
        db,
        {
          jobType: JOB_TYPES.contentPlan,
          idempotencyKey: contentPlanKey(brand.id, date, slot.slot),
          brandId: brand.id,
          payload: { brandId: brand.id, date, slot: slot.slot, contentCategory: slot.category },
        },
        maxAttempts,
      );
      if (result.created) created++;
      else existing++;
    }
  }
  return { date, brands: rows.length, created, existing };
}
