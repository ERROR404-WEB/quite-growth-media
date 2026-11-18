import type { Queryable } from '../db/pool.js';
import type { EnqueueInput, Job } from './types.js';

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;
const MAX_ERROR_LENGTH = 4_000;

/** Exponential backoff for the given (1-based) attempt that just failed: 30s, 60s, 120s ... capped at 30 min. */
export function backoffMs(attempt: number, baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS): number {
  const exp = Math.max(0, attempt - 1);
  return Math.min(maxMs, baseMs * 2 ** exp);
}

/** Inserts a job unless one with the same idempotency key already exists. */
export async function enqueue(
  db: Queryable,
  input: EnqueueInput,
  defaultMaxAttempts = 3,
): Promise<{ job: Job; created: boolean }> {
  const inserted = await db.query<Job>(
    `INSERT INTO generation_jobs (job_type, idempotency_key, brand_id, payload, run_at, max_attempts, parent_job_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      input.jobType,
      input.idempotencyKey,
      input.brandId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.runAt ?? null,
      input.maxAttempts ?? defaultMaxAttempts,
      input.parentJobId ?? null,
    ],
  );
  if (inserted.rows[0]) return { job: inserted.rows[0], created: true };
  const existing = await db.query<Job>('SELECT * FROM generation_jobs WHERE idempotency_key = $1', [
    input.idempotencyKey,
  ]);
  return { job: existing.rows[0]!, created: false };
}

/** Atomically claims the next ready job of the given types (safe across concurrent workers). */
export async function claimNext(db: Queryable, workerId: string, jobTypes: string[]): Promise<Job | null> {
  if (jobTypes.length === 0) return null;
  const { rows } = await db.query<Job>(
    `UPDATE generation_jobs
        SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1,
            started_at = COALESCE(started_at, now())
      WHERE id = (
        SELECT id FROM generation_jobs
         WHERE status = 'queued' AND run_at <= now() AND job_type = ANY($2) AND attempts < max_attempts
         ORDER BY run_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *`,
    [workerId, jobTypes],
  );
  return rows[0] ?? null;
}

export async function markSucceeded(db: Queryable, jobId: string, result: unknown): Promise<void> {
  await db.query(
    `UPDATE generation_jobs
        SET status = 'succeeded', result = $2, locked_at = NULL, locked_by = NULL, finished_at = now()
      WHERE id = $1 AND status = 'running'`,
    [jobId, JSON.stringify(result ?? null)],
  );
}

/**
 * Records a failure. Retries with backoff while attempts remain and the error is retryable;
 * otherwise quarantines the job so it is never processed (or published) automatically.
 */
export async function markFailed(
  db: Queryable,
  job: Pick<Job, 'id' | 'attempts' | 'max_attempts'>,
  error: string,
  retryable: boolean,
): Promise<'queued' | 'quarantined'> {
  const message = error.slice(0, MAX_ERROR_LENGTH);
  const willRetry = retryable && job.attempts < job.max_attempts;
  const entry = JSON.stringify([{ attempt: job.attempts, at: new Date().toISOString(), message }]);
  await db.query(
    `UPDATE generation_jobs
        SET status = $2, last_error = $3, error_history = error_history || $4::jsonb,
            run_at = CASE WHEN $2 = 'queued' THEN now() + ($5 * interval '1 millisecond') ELSE run_at END,
            locked_at = NULL, locked_by = NULL,
            finished_at = CASE WHEN $2 = 'quarantined' THEN now() ELSE NULL END
      WHERE id = $1`,
    [job.id, willRetry ? 'queued' : 'quarantined', message, entry, backoffMs(job.attempts)],
  );
  return willRetry ? 'queued' : 'quarantined';
}

/** Re-queues jobs whose worker died mid-run (lock older than the threshold). */
export async function recoverStaleJobs(db: Queryable, staleMinutes: number): Promise<number> {
  const res = await db.query(
    `UPDATE generation_jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'quarantined' ELSE 'queued' END,
            last_error = 'Worker lock expired (process crashed or was stopped mid-job)',
            finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
            locked_at = NULL, locked_by = NULL
      WHERE status = 'running' AND locked_at < now() - ($1 * interval '1 minute')`,
    [staleMinutes],
  );
  return res.rowCount ?? 0;
}

/** Operator action: give a quarantined job a fresh set of attempts. */
export async function requeueQuarantined(db: Queryable, jobId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE generation_jobs
        SET status = 'queued', attempts = 0, run_at = now(), finished_at = NULL
      WHERE id = $1 AND status = 'quarantined'`,
    [jobId],
  );
  return (res.rowCount ?? 0) > 0;
}
