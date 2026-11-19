---
name: add-job-type
description: Adds a new pipeline step (job type and handler) to the durable job queue - e.g. research, script generation, illustration, voice, render, QA, publish, analytics. Use when implementing any automated production step or background task.
---

# Add a pipeline job type

All production work runs as rows in `generation_jobs`, processed by `JobWorker` (`src/jobs/worker.ts`). n8n only **triggers** work through the API; business logic lives in TypeScript.

## Rules

- **Idempotency key** is mandatory and deterministic: `<job_type>:<brand_id>:<natural key>` (see `contentPlanKey` in `src/jobs/schedule.ts`). Re-enqueueing the same key must be a no-op.
- **Bounded retries**: transient errors (network, 429, 5xx) → throw a normal `Error` (the worker retries with exponential backoff up to `max_attempts`).
- **Non-retryable** (invalid input, policy/safety violation, licence problem) → throw `NonRetryableJobError`. The job is quarantined immediately.
- Quarantined content is **never published**. The operator can requeue it through `POST /api/jobs/:id/requeue`.
- Handlers must be safe to re-run after a crash: check whether the output already exists (e.g. a unique constraint, or an existing asset by checksum) before creating it.
- Record provider spend in `cost_records` (brand_id, category, provider, amount, job_id) with `recordCosts` (`src/pipeline/shared.ts`).
- Paid steps call `ensureDailyBudget(ctx, estimate, what)` first; over `DAILY_MAX_USD` it throws `DeferJobError`, which re-queues the job for tomorrow without using an attempt.
- Record every automated check in `compliance_results` (`recordCompliance`).
- Respect `ctx.signal` for long operations (shutdown).
- Never log secrets, prompts containing personal data, or full provider responses with tokens.

## Steps

1. Add the type name to `JOB_TYPES` in `src/domain/constants.ts` (format `area.action`, e.g. `script.generate`).
2. Implement the handler in `src/pipeline/<step>.ts` as a factory `(ctx: PipelineContext) => async (job, jobCtx) => result`. Validate `job.payload` with `parsePayload(schema, job)` (quarantines invalid payloads). Call paid or external services only through `ctx.providers` (`src/pipeline/context.ts`), so tests can pass doubles.
3. Register it in `registerPipeline` (`src/pipeline/index.ts`). Unregistered types simply stay `queued`.
4. Enqueue the next step from the handler with `enqueue(db, { jobType, idempotencyKey, brandId, payload, parentJobId: job.id })`.
5. Tests: unit-test pure logic; integration-test the handler against the test DB with doubles for every provider (see `tests/integration/pipeline.test.ts`). Tests must never call paid APIs.
6. Run `npm run check`.
