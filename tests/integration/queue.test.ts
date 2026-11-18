import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/pool.js';
import { createLogger } from '../../src/logger.js';
import {
  claimNext,
  enqueue,
  markFailed,
  recoverStaleJobs,
  requeueQuarantined,
} from '../../src/jobs/queue.js';
import { NonRetryableJobError } from '../../src/jobs/types.js';
import { JobWorker } from '../../src/jobs/worker.js';
import { createFreshTestDb, testDatabaseUrl } from '../helpers/db.js';

const TYPE = 'test.job';

describe.skipIf(!testDatabaseUrl())('job queue (integration)', () => {
  let db: Db;
  const logger = createLogger('silent');

  beforeAll(async () => {
    db = await createFreshTestDb();
  });
  afterAll(async () => {
    await db?.end();
  });
  beforeEach(async () => {
    await db.query('DELETE FROM generation_jobs');
  });

  it('enqueue is idempotent per key', async () => {
    const a = await enqueue(db, { jobType: TYPE, idempotencyKey: 'k1', brandId: 'quiet-growth' });
    const b = await enqueue(db, { jobType: TYPE, idempotencyKey: 'k1', brandId: 'quiet-growth' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it('concurrent claims never return the same job', async () => {
    await enqueue(db, { jobType: TYPE, idempotencyKey: 'a' });
    await enqueue(db, { jobType: TYPE, idempotencyKey: 'b' });
    const [x, y, z] = await Promise.all([
      claimNext(db, 'w1', [TYPE]),
      claimNext(db, 'w2', [TYPE]),
      claimNext(db, 'w3', [TYPE]),
    ]);
    const ids = [x, y, z].filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('only claims job types it has handlers for', async () => {
    await enqueue(db, { jobType: 'content.plan', idempotencyKey: 'future' });
    expect(await claimNext(db, 'w', [TYPE])).toBeNull();
  });

  it('retries with backoff and quarantines after max attempts', async () => {
    await enqueue(db, { jobType: TYPE, idempotencyKey: 'retry', maxAttempts: 2 });
    const first = (await claimNext(db, 'w', [TYPE]))!;
    expect(await markFailed(db, first, 'boom 1', true)).toBe('queued');
    await db.query('UPDATE generation_jobs SET run_at = now()'); // skip the backoff wait
    const second = (await claimNext(db, 'w', [TYPE]))!;
    expect(second.attempts).toBe(2);
    expect(await markFailed(db, second, 'boom 2', true)).toBe('quarantined');
    const { rows } = await db.query('SELECT status, error_history FROM generation_jobs WHERE id = $1', [
      first.id,
    ]);
    expect(rows[0].status).toBe('quarantined');
    expect(rows[0].error_history).toHaveLength(2);
    expect(await requeueQuarantined(db, first.id)).toBe(true);
  });

  it('recovers jobs whose worker died', async () => {
    await enqueue(db, { jobType: TYPE, idempotencyKey: 'stale' });
    await claimNext(db, 'dead-worker', [TYPE]);
    await db.query(`UPDATE generation_jobs SET locked_at = now() - interval '1 hour'`);
    expect(await recoverStaleJobs(db, 15)).toBe(1);
    const { rows } = await db.query('SELECT status FROM generation_jobs');
    expect(rows[0].status).toBe('queued');
  });

  it('worker runs handlers, records results and quarantines non-retryable failures', async () => {
    const worker = new JobWorker(db, logger, { pollIntervalMs: 50, staleLockMinutes: 15 })
      .register('ok', async (job) => ({ echoed: job.payload }))
      .register('bad', async () => {
        throw new NonRetryableJobError('policy violation');
      });
    await enqueue(db, { jobType: 'ok', idempotencyKey: 'ok-1', payload: { n: 1 } });
    await enqueue(db, { jobType: 'bad', idempotencyKey: 'bad-1' });
    expect(await worker.tick()).toBe(true);
    expect(await worker.tick()).toBe(true);
    expect(await worker.tick()).toBe(false);
    const { rows } = await db.query<{ job_type: string; status: string; result: unknown; attempts: number }>(
      'SELECT job_type, status, result, attempts FROM generation_jobs ORDER BY job_type',
    );
    expect(rows).toEqual([
      expect.objectContaining({ job_type: 'bad', status: 'quarantined', attempts: 1 }),
      expect.objectContaining({ job_type: 'ok', status: 'succeeded', result: { echoed: { n: 1 } } }),
    ]);
  });
});
