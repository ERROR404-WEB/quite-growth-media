import type { JobStatus } from '../domain/constants.js';

export interface Job<P = Record<string, unknown>> {
  id: string;
  brand_id: string | null;
  job_type: string;
  idempotency_key: string;
  payload: P;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  error_history: { attempt: number; at: string; message: string }[];
  result: unknown;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

export interface EnqueueInput {
  jobType: string;
  idempotencyKey: string;
  brandId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
  parentJobId?: string;
}

export interface JobContext {
  workerId: string;
  attempt: number;
  signal: AbortSignal;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<unknown>;

/** Throw this from a handler when retrying cannot help (bad input, policy violation). */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableJobError';
  }
}
