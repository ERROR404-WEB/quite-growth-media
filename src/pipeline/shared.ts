import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import type { Budget } from '../ai/pricing.js';
import type { Queryable } from '../db/pool.js';
import { DeferJobError } from '../jobs/types.js';
import { todayIn } from '../jobs/schedule.js';
import { addDays, zonedTimeToUtc } from '../jobs/time.js';
import type { PipelineContext } from './context.js';

/** Rough worst-case spend per step, checked against the daily cap before the step starts. */
export const STEP_ESTIMATE_USD = {
  /** One storyboard + 6-8 images (medium, hook high). */
  storyboard: 0.6,
  script: 0.05,
  /** Narration for one video. */
  render: 0.1,
} as const;

export const slotDir = (dataDir: string, date: string, slot: number) => join(dataDir, date, `slot-${slot}`);
export const sharedDir = (dataDir: string, date: string, slot: number) =>
  join(slotDir(dataDir, date, slot), 'shared');
export const brandDir = (dataDir: string, date: string, slot: number, brandId: string) =>
  join(slotDir(dataDir, date, slot), brandId);

/** Paths stored in the DB are relative to the working directory, with "/" separators. */
export const toStorageUri = (path: string) => relative(process.cwd(), path).split(sep).join('/');
export const fromStorageUri = (uri: string) => resolve(process.cwd(), uri);

export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** Dates come back from pg as Date objects (midnight local); keep the calendar day. */
export function isoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Recorded spend since local midnight in `timeZone`. */
export async function spentTodayUsd(db: Queryable, timeZone: string, now: Date): Promise<number> {
  const since = zonedTimeToUtc(todayIn(timeZone, now), '00:00', timeZone);
  const { rows } = await db.query<{ total: string | null }>(
    'SELECT sum(amount) AS total FROM cost_records WHERE incurred_at >= $1',
    [since],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Defers the job to tomorrow (local 00:05) when today's recorded spend plus this step's estimate
 * would pass DAILY_MAX_USD. A deferral does not use up a retry attempt.
 */
export async function ensureDailyBudget(ctx: PipelineContext, estimateUsd: number, what: string) {
  const { timeZone, dailyMaxUsd } = ctx.settings;
  const now = ctx.now();
  const spent = await spentTodayUsd(ctx.db, timeZone, now);
  if (spent + estimateUsd > dailyMaxUsd) {
    const runAt = zonedTimeToUtc(addDays(todayIn(timeZone, now), 1), '00:05', timeZone);
    throw new DeferJobError(
      `Daily AI spend cap reached before ${what}: $${spent.toFixed(2)} spent today, cap $${dailyMaxUsd.toFixed(2)} (DAILY_MAX_USD); continuing tomorrow`,
      runAt,
    );
  }
}

const CATEGORY: Record<string, string> = {
  script: 'script',
  illustration: 'illustration',
  voiceover: 'voiceover',
};

export interface CostLinks {
  jobId: string;
  contentIdeaId?: string | null;
  scriptId?: string | null;
  videoId?: string | null;
}

/** Writes budget entries to cost_records; `share` splits a cost several brands used. Returns USD saved. */
export async function recordCosts(
  db: Queryable,
  args: {
    brandId: string;
    provider: string;
    entries: Budget['entries'];
    links: CostLinks;
    share?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<number> {
  const share = args.share ?? 1;
  let total = 0;
  for (const e of args.entries) {
    const amount = Number((e.usd * share).toFixed(6));
    total += amount;
    await db.query(
      `INSERT INTO cost_records (brand_id, category, provider, units, unit_type, amount, currency,
                                 content_idea_id, script_id, video_id, job_id, metadata)
       VALUES ($1, $2, $3, 1, 'request', $4, 'USD', $5, $6, $7, $8, $9)`,
      [
        args.brandId,
        CATEGORY[e.kind] ?? 'other',
        args.provider,
        amount,
        args.links.contentIdeaId ?? null,
        args.links.scriptId ?? null,
        args.links.videoId ?? null,
        args.links.jobId,
        JSON.stringify({ ...args.metadata, model: e.model, ...(share !== 1 ? { share } : {}) }),
      ],
    );
  }
  return total;
}

export type ComplianceCheckType =
  | 'originality'
  | 'language'
  | 'brand_relevance'
  | 'child_safety'
  | 'audio'
  | 'video_integrity'
  | 'licence'
  | 'platform_policy';

export async function recordCompliance(
  db: Queryable,
  row: {
    brandId: string;
    entityType: 'content_idea' | 'script' | 'video' | 'publication';
    entityId: string;
    checkType: ComplianceCheckType;
    status: 'passed' | 'failed' | 'warning' | 'error';
    checker: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO compliance_results (brand_id, entity_type, entity_id, check_type, status, checker, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.brandId,
      row.entityType,
      row.entityId,
      row.checkType,
      row.status,
      row.checker,
      JSON.stringify(row.details ?? {}),
    ],
  );
}
