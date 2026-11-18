# Architecture

## Overview

```
                 ┌─────────────┐  cron 06:00   ┌──────────────────────────────────────────┐
                 │    n8n      │ ────────────▶ │  TypeScript API (Fastify)                 │
                 │ (scheduling,│  POST /api/   │  - /health, /health/ready                 │
                 │  integrations)│ schedule/daily│  - /api/brands, /api/jobs, dashboard /  │
                 └─────────────┘   (Bearer)     │  - POST /api/schedule/daily (27 jobs)    │
                                               └───────────────┬──────────────────────────┘
                                                               │ enqueue (idempotency key)
                                                               ▼
                                     ┌──────────────────────────────────────────┐
                                     │ PostgreSQL – generation_jobs (queue)      │
                                     │ + brands, content_ideas, scripts, ...     │
                                     └───────────────┬──────────────────────────┘
                                                     │ claim (FOR UPDATE SKIP LOCKED)
                                                     ▼
                                     ┌──────────────────────────────────────────┐
                                     │ JobWorker – handlers per job type         │
                                     │ research → script → validate → scenes →   │
                                     │ illustrate → voice → subtitles → render → │
                                     │ QA → publish → analytics                   │
                                     └──────────────────────────────────────────┘
```

- **One application**, nine brands separated by `brand_id`.
- **n8n** handles scheduling, orchestration and external integrations only. It calls the API and holds no business logic.
- **The job queue lives in Postgres**: there's no extra infrastructure (Redis) until scale requires it.

## Job lifecycle

```
queued ──claim──▶ running ──ok──▶ succeeded
   ▲                 │
   └──retry (backoff)┤ retryable error and attempts < max
                     └──▶ quarantined  (attempts exhausted or NonRetryableJobError)
                              │ operator: POST /api/jobs/:id/requeue
                              └──▶ queued (attempts reset)
```

- Idempotency key: `content.plan:<brand>:<date>:slot-<n>`. Rescheduling the same day is a no-op.
- Backoff: 30 s · 2^(attempt-1), capped at 30 min. Default `max_attempts` is 3 (`JOB_MAX_ATTEMPTS`).
- Stale locks (a worker crashed) are recovered on worker start (`JOB_STALE_LOCK_MINUTES`).
- Only job types with a registered handler are claimed, so jobs for future phases wait safely in `queued`.

## Spec modules → code

| #     | Module                          | Where                                                                                    | Status                         |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| 1     | Brand management                | `src/brands`, `brands` table                                                             | ✅                             |
| 2–4   | Research, planning, scripts     | job types `content.plan`, `script.generate` (Phase 4)                                    | queue ready                    |
| 5     | Originality detection           | `content_ideas.fingerprint/similarity_score`, pgvector                                   | schema                         |
| 6–8   | Fact / scripture / child checks | `compliance_results`                                                                     | schema                         |
| 9     | Scene planning                  | `video_scenes`                                                                           | schema                         |
| 10–12 | Illustration, voice, subtitles  | `src/media` (placeholder art, `VoiceProvider`, ASS captions); `assets`, `asset_licences` | captions ✅, providers pending |
| 13    | FFmpeg rendering                | `src/media/render.ts`, `pipeline.ts` (`npm run video:demo`)                              | ✅ (local)                     |
| 14    | Automated QA                    | `src/media/qa.ts` (video checks); `compliance_results`, `videos.qa_status`               | video checks ✅                |
| 15    | Publishing                      | `social_accounts` (36 slots), `publications`                                             | schema                         |
| 16    | Analytics                       | `analytics` (24h / 72h / 7d snapshots)                                                   | schema                         |
| 17–18 | Cost and revenue                | `cost_records`, `revenue_records`                                                        | schema                         |
| 19    | Error management                | `generation_jobs` retries, quarantine, `error_history`                                   | ✅                             |

## Deployment (VPS)

```
Internet ─▶ Caddy :80/:443 (Let's Encrypt) ─┬─ APP_DOMAIN → basic auth → api:3000 (Fastify + job worker)
                                            └─ N8N_DOMAIN → n8n:5678 (n8n owner login)
Private Docker network "qgm":  api ─┬─▶ postgres:5432 (qgm, n8n DBs; pgvector)
                                    n8n ─┘   n8n → http://api:3000/api/schedule/daily (Bearer token)
```

- `Dockerfile`: a multi-stage build on Node 24 alpine with ffmpeg; runs as the non-root `node` user, with tini and a healthcheck.
- `deploy/docker-compose.yml`: only Caddy publishes ports. n8n has `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, so workflows can't read container secrets.
- `deploy/scripts/deploy.sh`: build → start Postgres → migrate + seed (`node dist/db/cli.js`) → start everything → wait for `/health/ready`.
- Backups: `pg_dump -Fc` of both databases, plus a tarball of the n8n volume and the settings. Each dump is checked with `pg_restore --list`; `restore.sh --verify` performs a full test restore into a scratch DB.
- Server hardening: ufw (22/80/443), fail2ban, unattended security upgrades, key-only SSH with no root login, and Docker log rotation.

## Security

- Secrets only in `.env` (generated by `npm run setup:env`, gitignored). The DB stores credential _reference names_ only.
- Mutating API routes require `ADMIN_API_TOKEN` (constant-time compare, checked before body parsing).
- Local services bind to `127.0.0.1`. The API binds to `0.0.0.0` only so that n8n in Docker can reach it. On the VPS, only Caddy is exposed (HTTPS). The dashboard is behind basic auth and n8n behind its own login.
- Logs redact authorization headers and token, password and key fields.
- Agent hooks (`.github/hooks`) block reading `.env`, destructive DB and git commands, and global git config changes. They ask before commits and pushes.
