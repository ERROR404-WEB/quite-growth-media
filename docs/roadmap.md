# Roadmap and phase checklist

Keep this file current. The `phase-report` skill reads it at the end of each phase.
Legend: ✅ done · 🟡 in progress · ⬜ not started · 👤 manual step for the owner

## Phase 1 – Local setup

- 👤 ⬜ Create a **personal** GitHub account ([guide](phase-1-setup-windows.md#step-1--create-a-personal-github-account))
- ✅ Code editor: VS Code + GitHub Copilot (Antigravity not needed)
- ✅ Git installed (2.55, already present)
- ✅ Node.js installed (v26 for the app; portable v24 in `.tools/` for n8n)
- ✅ Project folder created, `git init` with a repo-local identity (no commits)
- 👤 ⬜ Create the private GitHub repository + first commit/push ([guide](phase-1-setup-windows.md#step-6--create-the-github-repository-and-push))
- ✅ TypeScript application scaffolded (strict TS, ESLint, Prettier, vitest)
- ✅ First local application running (`npm run dev` → http://127.0.0.1:3000)
- ✅ Tools installed: FFmpeg 9.0.2 (winget, user), GitHub CLI 2.104 (portable, user)

## Phase 2 – Server (VPS)

Guide: [phase-2-vps.md](phase-2-vps.md). Code and scripts are ready (🟡 = prepared and validated locally, not yet run on a server).

- ✅ Compare VPS providers and pricing (Hetzner / DigitalOcean / Hostinger, checked 18 Nov 2026)
- 👤 ⬜ Choose and approve a plan (recommended: Hetzner CPX22, about €17/mo)
- 👤 ⬜ Create the VPS account, SSH key (`qgm_vps`) and Ubuntu 24.04 server
- 🟡 Non-root user, ufw (22/80/443), fail2ban, auto security updates, swap: `deploy/scripts/server-setup.sh`
- 🟡 SSH hardening (key-only, no root): `deploy/scripts/harden-ssh.sh`
- 🟡 Docker Engine + Compose plugin (official apt repo): `server-setup.sh`
- 🟡 Postgres + n8n + API + Caddy with Docker Compose: `Dockerfile`, `deploy/docker-compose.yml`, `deploy.sh`
- 🟡 HTTPS (Caddy + Let's Encrypt), basic auth on the dashboard, n8n behind its own login
- 🟡 Backups: nightly `pg_dump` (both DBs) + n8n volume + settings, 14-day retention, restore test (`backup.sh`, `restore.sh --verify`)
- ⬜ Paid off-site backup storage (for now: weekly copy to the laptop via `scp`)

## Phase 3 – Core application

- ✅ n8n → API verified end-to-end (workflow run created 27 jobs using the encrypted Header Auth credential)
- ✅ Database migrations (15 tables, FKs, indexes, unique/check constraints)
- ✅ Nine brand configurations (zod-validated) + seed (9 brands, 36 social-account slots)
- ✅ Job management (idempotency keys, SKIP LOCKED worker, exponential backoff, quarantine, stale-lock recovery, requeue)
- ✅ Logging (pino with redaction) and health checks (`/health`, `/health/ready`)
- ✅ Basic dashboard (`/`)
- ✅ n8n daily scheduler workflow (`n8n/workflows/daily-scheduler.json`)
- ⬜ Operator notifications for quarantined jobs (email/Telegram via n8n)

## Phase 4 – AI engine

- ⬜ OpenAI API connection (cost estimate first), with the key in `.env`
- ⬜ Nine brand-specific prompt configurations
- ⬜ Topic research → `content_ideas`
- ⬜ Original script generation → `scripts` (versioned)
- ⬜ Duplicate detection across all brands (fingerprint + pgvector embeddings)
- ⬜ Fact, scripture and age-suitability validation → `compliance_results`

## Phase 5 – Media engine

Local test: `npm run video:demo` ([video-demo.md](video-demo.md)).

- ⬜ Compare illustration providers (quality, price, rate limits, **commercial licence**)
- ⬜ Integrate the chosen illustration provider (today: placeholder art drawn in code)
- ⬜ Compare voice providers (EN/HI/TE pronunciation tests)
- ⬜ Integrate the chosen voice provider (today: Windows test voice, English only)
- ✅ Subtitles: timed ASS captions, safe margins, bundled Noto fonts (Latin/Devanagari/Telugu), complex shaping verified
- ✅ FFmpeg rendering: MP4, 9:16, 1080×1920, 30 fps, Ken Burns motion, crossfades, music bed, loudnorm −16 LUFS
- ⬜ `video.render` job type + storing scenes, assets and videos in the DB

## Phase 6 – Quality control

- ✅ Video checks: integrity (full decode), codec, resolution, 9:16, fps, duration bucket, audio present/silent/clipping
- ⬜ Script, visual, audio, subtitle and child-safety checks
- ⬜ Retries, quarantine and operator notification wired to every step

## Phase 7 – Publishing

- 👤 ⬜ Create a Blotato account (after a pricing review)
- ⬜ Test one destination → connect the rest (36)
- ⬜ Scheduling, rolling queues, idempotent publications
- ⬜ Platform adapters, made-for-kids settings, AI disclosure, X rules check

## Phase 8 – Analytics

- ⬜ Collect metrics at 24h / 72h / 7d
- ⬜ Cost and revenue tracking, per-brand profitability dashboard

## Phase 9 – Scale

- ⬜ Controlled pilot (e.g. 1 video/brand/day) → validate quality and cost → ramp up to 27/day
