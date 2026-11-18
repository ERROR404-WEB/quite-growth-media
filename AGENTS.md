# AGENTS.md – Quiet Growth Media Network

Always-on instructions for AI coding agents (GitHub Copilot in VS Code / CLI).
Read this before changing anything. Detailed workflows live in skills under `.agents/skills/`.

## 1. Mission

Build one central, automated AI media-production platform for **9 independent brands**. Each brand creates **3 original vertical videos per day** (27/day) for Instagram, Facebook, YouTube and X (36 destinations, up to 108 publishing actions/day). Optimise for original value, quality, retention, compliance and sustainable cost. **Never promise revenue, reach or monetisation approval.**

## 2. Non-negotiable rules

1. **Originality.** Every brand researches, plans and writes its own content. Never translate scripts, rhymes or stories between brands or languages (EN↔HI↔TE), never reuse videos across brands, and never ship minor variations. Duplicate detection runs across all nine brands. A shared broad theme alone is not a duplicate.
2. **Children's safety** (brands 7–9): content must be age-appropriate and safe, with original characters and properly licensed music. No manipulative CTAs, no personal data, YouTube made-for-kids set correctly, and no behavioural ads or profiling of children.
3. **Devotional accuracy:** Hindu devotional brands (3, 4) verify every scripture claim (book/chapter/verse/translation, quote vs interpretation). Daily Faith and Light (2) stays **general spirituality** and is not assigned to a specific religion. No fake miracles, and no health/wealth promises.
4. **No mandatory human approval** in routine production. Instead, automated QA → regenerate → bounded retries → quarantine → notify. **Never publish failed or quarantined content.**
5. **Secrets.** These live only in `.env` (local) or the server's `.env` / a secret manager. Never read, print, log or commit `.env`, and never store API keys in the database (store reference names only). Never ask the user to paste secrets into chat.
6. **`brand_id` on everything** brand-related (FK to `brands.id`).
7. **Business logic in TypeScript.** n8n only schedules, orchestrates and integrates, calling the API. Do not build pipeline logic inside n8n nodes.
8. **Idempotency and bounded retries** for every step (unique idempotency keys, `generation_jobs`).
9. **Git.** Do **not** commit, push or create repos/PRs unless the user explicitly asks in the current conversation. The repo uses a _local_ personal identity (`git config --local`). Never touch `--global` git config (it belongs to the user's work account) and never use the work GitHub account.
10. **Costs.** Do not sign up for, buy or upgrade paid services. Before any paid integration, present current official pricing (dated), the free tier and the estimated monthly cost, then wait for approval.
11. **Third-party facts.** Verify platform API capabilities, rate limits, pricing and licensing against **official docs** before relying on them. Do not assume all platforms support the same actions.
12. Never imitate copyrighted characters or specific creators. Respect platform AI-disclosure rules and never bypass platform restrictions.

## 3. Working with the owner (beginner in infra)

- For any manual step, use the **`beginner-step-guide`** skill: what → why → where (URL) → exact clicks → one command → what success looks like → **wait for confirmation**.
- Never dump many commands at once, and never assume an account, server or key exists.
- At the end of each phase or work session, produce a report with the **`phase-report`** skill (completed, working, remaining, cost incurred, next exact step).
- Follow the phase order in [docs/roadmap.md](docs/roadmap.md). Don't start VPS work (Phase 2) until local development works and the user confirms.

## 4. Stack

Node.js + TypeScript (strict, ESM, NodeNext), Fastify 5, zod 4, pino, `pg` with plain-SQL migrations, vitest, ESLint + Prettier. PostgreSQL 16+ (pgvector on Docker/VPS), n8n Community Edition, FFmpeg (installed: 9.x), OpenAI API (Phase 4). The image, voice and publishing providers (Blotato + official APIs) are chosen in Phases 5 and 7 after comparing them. Target video: MP4, 9:16, 1080×1920, durations 7–12 / 13–20 / 21–30 / 31–45 s chosen by content.

## 5. Commands

| Task                      | Command                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| First-time env            | `npm run setup:env` (generates `.env` with random secrets)                                          |
| Start DB (no Docker)      | `npm run pg:start` (`pg:init` once; `pg:status`, `pg:stop`)                                         |
| Start DB + n8n (Docker)   | `npm run stack:up` (VPS / machines where Docker works)                                              |
| Migrate / seed / status   | `npm run db:migrate` · `npm run db:seed` · `npm run db:status`                                      |
| Dev server (API + worker) | `npm run dev` → http://127.0.0.1:3000                                                               |
| n8n (native)              | `npm run n8n:start` → http://localhost:5678 · `npm run n8n:bootstrap` (credential + workflows)      |
| All checks                | `npm run check` (typecheck + lint + all tests)                                                      |
| Test video rendering      | `npm run video:demo` (3 demo videos + QA, placeholder art/voice, free; see docs/video-demo.md)      |
| Unit / integration tests  | `npm run test:unit` · `npm run test:integration`                                                    |
| Production (on the VPS)   | `bash deploy/scripts/deploy.sh --pull` · `dc.sh ps/logs` · `backup.sh` (see `vps-operations` skill) |

Integration tests reset the **`qgm_test`** database only (the helper refuses any DB not ending in `_test`).

## 6. Layout

```
src/
  config/env.ts          zod-validated environment (getEnv)
  logger.ts              pino with secret redaction
  domain/constants.ts    languages, niches, platforms, duration buckets, job statuses/types
  brands/                9 brand configs (definitions/*.ts) + zod schema + registry
  db/                    pool, migration runner (checksummed), seed, CLI
  jobs/                  durable queue (idempotency, SKIP LOCKED, backoff, quarantine), worker, daily scheduler
  server/                Fastify app, admin-token auth, routes (health, api, dashboard)
  media/                 video pipeline: ffmpeg runner, timeline, captions (ASS), placeholder art, voice providers,
                         render (Ken Burns, xfade, loudnorm), QA (ffprobe + full decode), pipeline.produceVideo, demo/
  index.ts               entry: HTTP server + job worker + graceful shutdown
assets/fonts/            Noto Sans (Latin/Devanagari/Telugu) caption fonts, OFL 1.1
migrations/              NNNN_name.sql – never edit an applied file
tests/unit, tests/integration, tests/helpers
n8n/workflows/           importable n8n workflows (trigger the API only)
scripts/                 setup-env, local-pg (Postgres without Docker), n8n-local (native n8n), n8n-bootstrap
Dockerfile               production image (API + worker, Node 24, ffmpeg, non-root)
deploy/                  VPS stack: docker-compose.yml (postgres, api, n8n, caddy), caddy/Caddyfile, .env.example,
                         scripts/ (server-setup, harden-ssh, init-env, set-dashboard-password, deploy, dc,
                         backup, restore, n8n-bootstrap)
docs/                    roadmap, architecture, local stack, phase 1 + phase 2 beginner guides
.agents/skills/          agent skills (read by Copilot)
.github/hooks/           Copilot agent hooks (guard, format-on-edit, session context)
```

## 7. Area rules

- **Migrations** → follow the `add-migration` skill. Add new files only, with a CHECK for every enumeration (mirrored in `domain/constants.ts`), indexes on FKs, unique constraints for idempotency and no secret columns.
- **Brands** → follow the `add-or-update-brand` skill. The zod schema enforces kids, devotional and spirituality invariants, so do not weaken it.
- **Pipeline steps** → follow the `add-job-type` skill. Each step is a job type with a handler, a deterministic idempotency key, and `NonRetryableJobError` for policy failures.
- **Generated content, prompts and QA** → follow the `content-compliance-check` skill.
- **Media / rendering** → `produceVideo()` in `src/media/pipeline.ts`. Providers (voice, illustrations) are pluggable interfaces; tests use local test doubles, never paid APIs. A script must match its brand's language. Keep captions above the bottom 24% (platform UI) and use the bundled fonts. Demo output (`data/renders/demo`) is never published.
- **Environment trouble** → follow the `local-stack` skill.
- **Server / deployment / backups** → follow the `vps-operations` skill. Only Caddy may publish ports, deploy files must use LF line endings, and every required compose variable must be in `deploy/.env.example` (enforced by `tests/unit/deploy.test.ts`).
- **API**: validate all input with zod. Mutating routes require `Authorization: Bearer $ADMIN_API_TOKEN` (checked in `onRequest`). Escape all HTML output.
- **Tests**: every feature ships with tests. Tests never call paid APIs (mock providers). Run `npm run check` before declaring work done.
- **Style**: strict TypeScript, no `any`, `import type` for types, `.js` extensions in relative imports (NodeNext), small modules, comments only where intent isn't obvious.

## 8. Environment notes (owner's Windows work laptop)

- No admin rights. Docker Desktop is blocked by corporate policy (WSL `0x80070569`), so locally Postgres runs as a user process (`scripts/local-pg.mjs`, port 5433, data in `data/postgres`) and n8n runs natively under a portable Node 24 in `.tools/` (n8n's native modules don't support Node 26). The VPS uses `deploy/docker-compose.yml`; the root `docker-compose.yml` is only for local Docker.
- The corporate network breaks TLS revocation checks, so use `curl.exe --ssl-no-revoke` for downloads.
- GitHub CLI is installed per-user at `%LOCALAPPDATA%\Programs\gh\bin`. Authenticate it with the **personal** account only, when the user asks.
- PowerShell 5.1: no `&&`/`||`. Writing with `Set-Content -Encoding utf8` adds a BOM, so prefer editor tools.

## 9. Current status

Phase 1 (local setup) and the local part of Phase 3 (core) are done: schema (15 tables), 9 brands seeded with 36 social-account slots, job queue + worker, `/health`, `/health/ready`, brands and jobs API, idempotent `POST /api/schedule/daily` (27 jobs/day), dashboard at `/`, and the n8n daily-scheduler workflow.

Phase 2 is **prepared but not deployed**. The production Dockerfile, compose stack with Caddy HTTPS and basic auth, server setup/hardening, deploy, backup/restore and n8n bootstrap scripts are written and validated locally, and the provider comparison is dated 18 Nov 2026 ([docs/phase-2-vps.md](docs/phase-2-vps.md)).

The Phase 5 render engine and video QA work locally (`npm run video:demo`, [docs/video-demo.md](docs/video-demo.md)). They use placeholder illustrations and a local test voice. Real script, image and voice providers still need cost approval.

**Next:**

1. The owner creates a personal GitHub account and repository ([docs/phase-1-setup-windows.md](docs/phase-1-setup-windows.md)).
2. The owner picks and approves a VPS plan.
3. Follow docs/phase-2-vps.md step by step.

Keep [docs/roadmap.md](docs/roadmap.md) up to date.
