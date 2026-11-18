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
- Record provider spend in `cost_records` (brand_id, category, provider, amount, job_id).
- Record every automated check in `compliance_results`.
- Respect `ctx.signal` for long operations (shutdown).
- Never log secrets, prompts containing personal data, or full provider responses with tokens.

## Steps

1. Add the type name to `JOB_TYPES` in `src/domain/constants.ts` (format `area.action`, e.g. `script.generate`).
2. Implement the handler in `src/pipeline/<area>/<action>.ts`, exporting `async (job, ctx) => result`. Validate `job.payload` with zod first and throw `NonRetryableJobError` on invalid payloads.
3. Register it in `src/index.ts` with `worker.register(JOB_TYPES.x, handler)`. Unregistered types simply stay `queued`.
4. Enqueue the next step from the handler with `enqueue(db, { jobType, idempotencyKey, brandId, payload, parentJobId: job.id })`.
5. Tests: unit-test pure logic; integration-test the handler against the test DB (see `tests/integration/queue.test.ts`). Mock external providers; tests must never call paid APIs.
6. Run `npm run check`.
