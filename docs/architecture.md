# Architecture

## Overview

```
                 ┌─────────────┐  06:00 daily   ┌──────────────────────────────────────────┐
                 │    n8n      │ ─────────────▶ │  TypeScript API (Fastify)                 │
                 │ (triggers   │  every 10 min  │  - /health, /health/ready, dashboard /    │
                 │  only)      │ ─────────────▶ │  - POST /api/schedule/daily (tomorrow)    │
                 └─────────────┘   (Bearer)     │  - POST /api/publish/due                  │
                                                │  - /api/brands, jobs, videos, publications│
                                                └───────────────┬──────────────────────────┘
                                                                │ enqueue (idempotency key)
                                                                ▼
                                     ┌──────────────────────────────────────────┐
                                     │ PostgreSQL – generation_jobs (queue)      │
                                     │ + content_ideas, scripts, video_scenes,   │
                                     │   videos, assets, publications, costs ... │
                                     └───────────────┬──────────────────────────┘
                                                     │ claim (FOR UPDATE SKIP LOCKED)
                                                     ▼
                                     ┌──────────────────────────────────────────┐
                                     │ JobWorker – src/pipeline handlers          │
                                     │ content.plan → storyboard.generate (shared │
                                     │ by the 3 self-improvement brands) →        │
                                     │ script.generate (per brand, native) →      │
                                     │ video.render (voice, captions, music, QA,  │
                                     │ publications at the slot time) →           │
                                     │ video.publish (gate → Blotato, at most once)│
                                     └──────────────────────────────────────────┘
```

- **One application**, nine brands separated by `brand_id`.
- **n8n** only triggers two API calls (daily plan, publish due). It holds no business logic.
- **The job queue lives in Postgres**: there's no extra infrastructure (Redis) until scale requires it.

## Daily pipeline (`src/pipeline`)

| Job type              | Idempotency key                                        | Does                                                                                                                | Stores                                                                                                       |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `content.plan`        | `content.plan:<brand>:<date>:slot-<n>`                 | Skips past dates and brands outside `AUTOMATION_BRANDS`. Self-improvement → shared storyboard; others → own script  | –                                                                                                            |
| `storyboard.generate` | `storyboard.generate:self-improvement:<date>:slot-<n>` | One storyboard (meaning only) + one image set, reused on re-run                                                     | files in `PIPELINE_DATA_DIR/<date>/slot-<n>/shared`, `content_ideas`, costs split per brand                  |
| `script.generate`     | `script.generate:<brand>:<date>:slot-<n>`              | Brand's own native script, regenerated with feedback up to 3 times; narration hash must be unique across all brands | `scripts` (+ `generation_output`), `video_scenes`, `compliance_results`                                      |
| `video.render`        | `video.render:<brand>:<date>:slot-<n>`                 | Brand voice (final mode: paid ElevenLabs only), captions, licensed sound, FFmpeg, QA. Failed QA → quarantine        | `videos` (one per platform version), `assets`, `compliance_results`, audio usage, `publications` (scheduled) |
| `video.publish`       | `video.publish:<publication>:<row version>`            | Publishing gate, one upload per video, create-post exactly once, status polling. Unclear outcome → `needs_check`    | `publications`                                                                                               |

- **Daily spend cap:** before every paid step, today's `cost_records` plus the step's estimate must stay under `DAILY_MAX_USD`; otherwise the job is **deferred** to 00:05 tomorrow (no attempt used).
- **Publish times:** each content slot has a `publishTime` (08:00 / 13:00 / 20:00) in the brand's `publishTimezone` (DST-safe).
- **Render mode:** `PIPELINE_RENDER_MODE=final` (publishable) or `test` (labelled renders, no publications).
- **Operator actions:** `POST /api/jobs/:id/requeue` (quarantined job), `POST /api/publications/:id/retry` (failed, skipped or needs_check post, after checking Blotato).

## Job lifecycle

```
queued ──claim──▶ running ──ok──▶ succeeded
   ▲                 │
   └──retry (backoff)┤ retryable error and attempts < max
                     └──▶ quarantined  (attempts exhausted or NonRetryableJobError)
                              │ operator: POST /api/jobs/:id/requeue
                              └──▶ queued (attempts reset)
running ──DeferJobError──▶ queued at a later run_at (attempt not used: spend cap, not due yet)
```

- Idempotency key: `content.plan:<brand>:<date>:slot-<n>`. Rescheduling the same day is a no-op.
- Backoff: 30 s · 2^(attempt-1), capped at 30 min. Default `max_attempts` is 3 (`JOB_MAX_ATTEMPTS`).
- Stale locks (a worker crashed) are recovered on worker start (`JOB_STALE_LOCK_MINUTES`).
- Only job types with a registered handler are claimed, so jobs for future phases wait safely in `queued`.

## Spec modules → code

| #     | Module                          | Where                                                                                                                                        | Status                                    |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1     | Brand management                | `src/brands`, `brands` table                                                                                                                 | ✅                                        |
| 2–4   | Research, planning, scripts     | `src/pipeline` (`content.plan`, `storyboard.generate`, `script.generate`); `content_ideas`, `scripts`                                        | ✅ (self-improvement brands)              |
| 5     | Originality detection           | narration hash across all brands (`scripts.content_hash`); `content_ideas.fingerprint/similarity_score`, pgvector                            | exact duplicates ✅, similarity pending   |
| 6–8   | Fact / scripture / child checks | `compliance_results`                                                                                                                         | schema                                    |
| 9     | Scene planning                  | `video_scenes` (written by `script.generate`)                                                                                                | ✅                                        |
| 10–12 | Illustration, voice, subtitles  | `src/media` (placeholder art, `VoiceProvider`, ASS captions); `assets`, `asset_licences`                                                     | captions ✅, providers pending            |
| 13    | FFmpeg rendering                | `src/media/render.ts`, `pipeline.ts` (`npm run video:demo`)                                                                                  | ✅ (local)                                |
| 13    | Licensed music & SFX            | `src/media/audio-library.ts` (+ store, `audio:*` CLI); `audio_library_assets`, `audio_library_usages` ([audio-library.md](audio-library.md)) | ✅ (library empty until tracks are added) |
| 14    | Automated QA                    | `src/media/qa.ts` (video checks, `audio_rights`, `duration_target`); `compliance_results`, `videos.qa_status`                                | video + rights checks ✅                  |
| 15    | Publishing                      | `src/publishing` (Blotato), `video.publish` job, `social_accounts` (36 slots), `publications` ledger                                         | ✅ (mocked; no accounts yet)              |
| 16    | Analytics                       | `analytics` (24h / 72h / 7d snapshots)                                                                                                       | schema                                    |
| 17–18 | Cost and revenue                | `cost_records`, `revenue_records`                                                                                                            | schema                                    |
| 19    | Error management                | `generation_jobs` retries, quarantine, `error_history`                                                                                       | ✅                                        |

## Deployment (VPS)

```
Internet ─▶ Caddy :80/:443 (Let's Encrypt) ─┬─ APP_DOMAIN → basic auth → api:3000 (Fastify + job worker)
                                            └─ N8N_DOMAIN → n8n:5678 (n8n owner login)
Private Docker network "qgm":  api ─┬─▶ postgres:5432 (qgm, n8n DBs; pgvector)
                                    n8n ─┘   n8n → http://api:3000/api/schedule/daily + /api/publish/due (Bearer token)
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
