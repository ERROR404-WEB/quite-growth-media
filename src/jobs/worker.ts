import { hostname } from 'node:os';
import type { Db } from '../db/pool.js';
import type { Logger } from '../logger.js';
import { claimNext, markFailed, markSucceeded, recoverStaleJobs } from './queue.js';
import { NonRetryableJobError, type JobHandler } from './types.js';

export interface WorkerOptions {
  pollIntervalMs: number;
  staleLockMinutes: number;
  workerId?: string;
}

/**
 * Polls generation_jobs and runs registered handlers one job at a time.
 * Only job types with a registered handler are claimed, so jobs for future phases stay queued.
 */
export class JobWorker {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId: string;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private current: Promise<void> | undefined;
  private readonly abort = new AbortController();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly options: WorkerOptions,
  ) {
    this.workerId = options.workerId ?? `${hostname()}:${process.pid}`;
  }

  register(jobType: string, handler: JobHandler): this {
    this.handlers.set(jobType, handler);
    return this;
  }

  get registeredTypes(): string[] {
    return [...this.handlers.keys()];
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const recovered = await recoverStaleJobs(this.db, this.options.staleLockMinutes);
    if (recovered) this.logger.warn({ recovered }, 'recovered stale jobs');
    this.logger.info({ workerId: this.workerId, types: this.registeredTypes }, 'job worker started');
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
    await this.current;
    this.logger.info('job worker stopped');
  }

  /** Processes at most one job. Returns true if a job was processed. Exposed for tests. */
  async tick(): Promise<boolean> {
    const job = await claimNext(this.db, this.workerId, this.registeredTypes);
    if (!job) return false;
    const handler = this.handlers.get(job.job_type)!;
    const log = this.logger.child({
      jobId: job.id,
      jobType: job.job_type,
      brandId: job.brand_id,
      attempt: job.attempts,
    });
    try {
      const result = await handler(job, {
        workerId: this.workerId,
        attempt: job.attempts,
        signal: this.abort.signal,
      });
      await markSucceeded(this.db, job.id, result);
      log.info('job succeeded');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await markFailed(this.db, job, message, !(err instanceof NonRetryableJobError));
      if (outcome === 'quarantined') {
        // Operator notification hook point (n8n / email / chat) - Phase 6.
        log.error({ err: message, event: 'job.quarantined' }, 'job quarantined after failed attempts');
      } else {
        log.warn({ err: message }, 'job failed; will retry');
      }
    }
    return true;
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.current = this.tick()
        .then((didWork) => this.schedule(didWork ? 0 : this.options.pollIntervalMs))
        .catch((err: unknown) => {
          this.logger.error({ err }, 'job worker tick failed');
          this.schedule(this.options.pollIntervalMs);
        });
    }, delayMs);
  }
}
