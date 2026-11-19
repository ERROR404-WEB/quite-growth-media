# Roadmap and phase checklist

Keep this file current. The `phase-report` skill reads it at the end of each phase.
Legend: ✅ done · 🟡 in progress · ⬜ not started · 👤 manual step for the owner

## Phase 1 – Local setup

- ✅ Create a **personal** GitHub account ([guide](phase-1-setup-windows.md#step-1--create-a-personal-github-account))
- ✅ Code editor: VS Code + GitHub Copilot (Antigravity not needed)
- ✅ Git installed (2.55, already present)
- ✅ Node.js installed (v26 for the app; portable v24 in `.tools/` for n8n)
- ✅ Project folder created, `git init` with a repo-local identity (no commits)
- ✅ GitHub repository + first commit/push: `ERROR404-WEB/quite-growth-media` (18 Nov 2026) ([guide](phase-1-setup-windows.md#step-6--create-the-github-repository-and-push))
- 👤 ⬜ Make the repository **private** (it is public as of 19 Nov 2026)
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
- 🟡 Postgres + n8n + API + Caddy with Docker Compose: `Dockerfile`, `deploy/docker-compose.yml`, `deploy.sh` (compose passes the automation switches and the Blotato key since 19 Nov 2026)
- 🟡 HTTPS (Caddy + Let's Encrypt), basic auth on the dashboard, n8n behind its own login
- 🟡 Backups: nightly `pg_dump` (both DBs) + n8n volume + settings, 14-day retention, restore test (`backup.sh`, `restore.sh --verify`)
- ⬜ Paid off-site backup storage (for now: weekly copy to the laptop via `scp`)

## Phase 3 – Core application

- ✅ n8n → API verified end-to-end (workflow run created 27 jobs using the encrypted Header Auth credential)
- ✅ Database migrations (17 tables, FKs, indexes, unique/check constraints; `0002` adds the licensed audio library)
- ✅ Nine brand configurations (zod-validated) + seed (9 brands, 36 social-account slots)
- ✅ Job management (idempotency keys, SKIP LOCKED worker, exponential backoff, quarantine, stale-lock recovery, requeue)
- ✅ Logging (pino with redaction) and health checks (`/health`, `/health/ready`)
- ✅ Basic dashboard (`/`)
- ✅ n8n daily scheduler workflow (`n8n/workflows/daily-scheduler.json`)
- ⬜ Operator notifications for quarantined jobs (email/Telegram via n8n)

## Phase 4 – AI engine

- 🟡 OpenAI API connection: account bought; client, spend cap and cost tracking built (`src/ai`). 👤 Owner adds `OPENAI_API_KEY` to `.env`
- 🟡 Brand-specific prompts: generated from each brand's config, rules, slot and visual identity (`buildScriptPrompt`). The final v3 formula ([creative-direction.md](creative-direction.md)) is encoded for the 3 self-improvement brands: viral idea triggers, hook → message (reframe pairs) → metaphor → conclusion, 19–27 s with 0.7 s beats and 1.2 s pauses, calm per-line voice tags, pure modern Hindi/Telugu, and the owner's reference-reel look ([analysis](creative-sources/reference-reel-analysis.md)): premium warm lo-fi anime visuals with a high-quality hook image, a warm film finish with dust, near-still motion, centred soft handwritten captions and a deep, calm male narrator per brand. Shared mode (`video:ai:shared`) is in place: one storyboard and image set per topic for the 3 brands, with separate native scripts.
- ⬜ Topic research → `content_ideas` (today: the storyboard step picks the topic per slot and stores it in `content_ideas`)
- ✅ Original script generation: `generateScript()` (structured output; checks language, duration target, story arc, clichés, engagement bait, kids CTAs and false promises). It also writes per-platform metadata (YouTube title, captions, 3–8 hashtags, keywords) checked against platform limits. Stored by the `script.generate` job in `scripts` + `video_scenes`
- 🟡 Duplicate detection across all brands: exact narration hash ✅ (`script.generate`); similarity (fingerprint + pgvector embeddings) ⬜
- ⬜ Fact, scripture and age-suitability validation → `compliance_results`

## Phase 5 – Media engine

Local test: `npm run video:demo` ([video-demo.md](video-demo.md)).

- ✅ Illustration provider chosen: **OpenAI** `gpt-image-2.6-flare` (owner decision; output owned by the customer per the OpenAI Services Agreement)
- 🟡 Integrated: `OpenAiIllustrator` (9:16, brand style, text-free, cost + provenance per image). Test: `npm run video:ai` ([ai-video-test.md](ai-video-test.md))
- ✅ Voice provider chosen: **ElevenLabs** `eleven_v4` (EN/HI/TE; Telugu only on v4/v3). Casting per brand in [voices.md](voices.md)
- 🟡 Integrated: `ElevenLabsVoice` (one fixed voice per brand, character-timed captions, budget cap). 👤 Upgrade from the Free plan (needed for commercial use, Library voices via API and Voice Design), design the 3 kids voices, then run a pronunciation check per brand
- ✅ First real AI videos (18 Nov 2026): Quiet Growth (EN), Behtar Bano (HI), Ninnu Nuvvu Geluvu (TE). OpenAI script + images, ElevenLabs narration (temporary Default voices on the Free plan), all QA passed, $0.16–0.20 each. Re-voice with the fixed voices after upgrading (`npm run video:revoice`)
- ✅ Subtitles: timed ASS captions, safe margins, bundled Noto fonts (Latin/Devanagari/Telugu), complex shaping verified
- ✅ FFmpeg rendering: MP4, 9:16, 1080×1920, 30 fps, Ken Burns motion (camera move chosen per scene), crossfades, loudnorm −16 LUFS
- ✅ Licensed music/SFX library ([audio-library.md](audio-library.md)): DB-enforced rights gate, mood-aware selection with per-brand rotation, music/ambience ducked under the voice, at most 2 effects. If no verified track fits, the video has no music
- ✅ First licence-verified tracks: 5 Mixkit tracks approved for all 4 platforms (Skyline, Forest Mist Whispers, Silent Descent, Miss You, Driving Ambition), files verified against assets.mixkit.co (18 Nov 2026)
- ✅ `video.render` job type: stores scenes, assets (video, thumbnail, illustrations, narration), videos (one row per platform version) and QA results in the DB (migration `0003`)

## Phase 6 – Quality control

- ✅ Video checks: integrity (full decode), codec, resolution, 9:16, fps, duration bucket, audio present/silent/clipping, brand duration target (warning), audio rights + file checksums
- ⬜ Script, visual, audio, subtitle and child-safety checks
- 🟡 Retries, quarantine and operator notification wired to every step: retries, feedback regeneration, quarantine and the daily spend cap (deferral) ✅ for every pipeline job; notifications ⬜

## Phase 7 – Publishing

Guide: [publishing.md](publishing.md) (Blotato facts and prices checked 18 Nov 2026).

- ✅ Publishing provider reviewed: **Blotato** REST API. Starter $29/month (20 accounts) for the pilot; Creator $97/month (40) for all 36 destinations. The trial has no API, and generating a key starts billing
- ✅ `src/publishing`: Blotato client (presigned upload, one-shot create-post, status polling ≥ 10 s), per-platform posts (IG/FB Reels, YouTube title/privacy/made-for-kids/AI disclosure, X ≤ 280), publishing gate, at-most-once ledger, account links on `social_accounts`, CLI `publish:video` (dry run by default). Unit + integration tests with mocks
- ✅ `--final` renders (no test label) for `video:ai`, `video:ai:shared` and `video:revoice`, only with the brand voice on a paid ElevenLabs plan
- ✅ n8n running natively; daily-scheduler workflow + QGM Admin Token credential imported (inactive)
- 👤 ⬜ Create the pilot brand's 4 social accounts, then warm them up by hand for 1–2 weeks (Blotato requirement)
- 👤 ⬜ Subscribe to Blotato (after approval), add `BLOTATO_API_KEY`, connect the accounts, `blotato:link`
- ⬜ First live post: YouTube private → then Instagram, Facebook, X
- ✅ Daily automation (19 Nov 2026, tested with mocks + a real FFmpeg render): `content.plan` → `storyboard.generate` (shared by the 3 self-improvement brands) → `script.generate` → `video.render` → `video.publish` (DB ledger on `publications`, at most once, `needs_check` for unclear results). Publish times 08:00 / 13:00 / 20:00 in each brand's time zone, videos made a day ahead, daily AI spend cap `DAILY_MAX_USD` ($3), `AUTOMATION_BRANDS` (the 3 self-improvement brands), `PUBLISHING_ENABLED` off by default. API: `POST /api/publish/due`, `GET /api/videos`, `GET /api/publications`, `POST /api/publications/:id/retry`; dashboard publishing table
- ✅ n8n "QGM - Publish due videos" workflow (`n8n/workflows/publish-due.json`, every 10 minutes, inactive until publishing is switched on)
- 👤 ⬜ Re-import the workflows locally (`npm run n8n:bootstrap`), then activate the daily scheduler once ElevenLabs is on a paid plan
- ⬜ Automation for the devotional (scripture validator) and kids brands (designed voices)
- ⬜ X rules check, analytics hooks

## Phase 8 – Analytics

- ⬜ Collect metrics at 24h / 72h / 7d
- ⬜ Cost and revenue tracking, per-brand profitability dashboard

## Phase 9 – Scale

- ⬜ Controlled pilot (e.g. 1 video/brand/day) → validate quality and cost → ramp up to 27/day
