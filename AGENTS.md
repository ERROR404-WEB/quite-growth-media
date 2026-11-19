# AGENTS.md – Quiet Growth Media Network

Always-on instructions for AI coding agents (GitHub Copilot in VS Code / CLI).
Read this before changing anything. Detailed workflows live in skills under `.agents/skills/`.

## 1. Mission

Build one central, automated AI media-production platform for **9 independent brands**. Each brand creates **3 original vertical videos per day** (27/day) for Instagram, Facebook, YouTube and X (36 destinations, up to 108 publishing actions/day). Optimise for original value, quality, retention, compliance and sustainable cost. **Never promise revenue, reach or monetisation approval.**

## 2. Non-negotiable rules

1. **Originality.** Every brand researches, plans and writes its own content. Never translate scripts, rhymes or stories between brands or languages (EN↔HI↔TE), never reuse videos across brands, and never ship minor variations. Duplicate detection runs across all nine brands. A shared broad theme alone is not a duplicate.
   - **Owner exception (18 Nov 2026):** Quiet Growth, Behtar Bano and Ninnu Nuvvu Geluvu may share **one topic and one image set** per video (`npm run video:ai:shared`).
   - Each brand still writes its **own script from scratch**, from the storyboard's meaning only. A script is **never translated** from another language.
   - Each brand also has its own voice, captions, music plan and metadata.
   - The shared images use universal characters and places (no country-specific signs).
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

| Task                      | Command                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-time env            | `npm run setup:env` (generates `.env` with random secrets)                                                                                                                                                                        |
| Start DB (no Docker)      | `npm run pg:start` (`pg:init` once; `pg:status`, `pg:stop`)                                                                                                                                                                       |
| Start DB + n8n (Docker)   | `npm run stack:up` (VPS / machines where Docker works)                                                                                                                                                                            |
| Migrate / seed / status   | `npm run db:migrate` · `npm run db:seed` · `npm run db:status`                                                                                                                                                                    |
| Dev server (API + worker) | `npm run dev` → http://127.0.0.1:3000                                                                                                                                                                                             |
| n8n (native)              | `npm run n8n:start` → http://localhost:5678 · `npm run n8n:bootstrap` (credential + workflows)                                                                                                                                    |
| All checks                | `npm run check` (typecheck + lint + all tests)                                                                                                                                                                                    |
| Test video rendering      | `npm run video:demo` (3 demo videos + QA, placeholder art/voice, free; see docs/video-demo.md)                                                                                                                                    |
| AI test video (OpenAI)    | `npm run video:ai -- --brand <id> [--dry-run] [--voice-id <id>]` (script + images + voice, capped; docs/ai-video-test.md) · `npm run video:revoice -- --dir <run> [--replan-audio]`                                               |
| Shared topic (3 brands)   | `npm run video:ai:shared -- [--category <slot>] [--topic "…"] [--voice-ids a,b,c]` (one storyboard + one image set, separate native scripts per brand)                                                                            |
| Brand voices (ElevenLabs) | `npm run voices:list` · `voices:search -- --language te` · `voices:design -- --brand <id>` (docs/voices.md)                                                                                                                       |
| Licensed audio library    | `npm run audio:init` · `audio:import` (validates rights, checksums, saves to DB) · `audio:list` (docs/audio-library.md)                                                                                                           |
| Publishing (Blotato)      | `npm run publish:video -- --dir <run>` (dry run: gate + payloads) · `… --live [--platforms youtube]` · `blotato:accounts` · `blotato:link -- --brand <id> --platform <p> --account-id <id> [--page-id <id>]` (docs/publishing.md) |
| Daily automation (API)    | `POST /api/schedule/daily` (plans tomorrow for `AUTOMATION_BRANDS`) · `POST /api/publish/due` · `POST /api/publications/:id/retry` · `GET /api/videos`, `/api/publications` (docs/architecture.md)                                |
| Unit / integration tests  | `npm run test:unit` · `npm run test:integration`                                                                                                                                                                                  |
| Production (on the VPS)   | `bash deploy/scripts/deploy.sh --pull` · `dc.sh ps/logs` · `backup.sh` (see `vps-operations` skill)                                                                                                                               |

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
  media/                 video pipeline: ffmpeg runner, timeline, captions (ASS), illustrator interface + placeholder art,
                         voice providers, render (Ken Burns, xfade, music ducking, loudnorm), QA (ffprobe + full decode + audio rights),
                         audio-library (rights gate, selection, sound plan) + store + audio:* CLI, pipeline.produceVideo, demo/
  ai/                    OpenAI: config (OPENAI_* env), JSON client w/ bounded retries (http-client), dated pricing + Budget cap,
                         script-writer (Responses API, strict JSON schema, validation), openai-illustrator (Images API);
                         elevenlabs (voice per brand, timestamps, Voice Library search, Voice Design) + voices:* CLIs
  publishing/            Blotato REST client (presigned upload, one-shot create-post, status polling), per-platform post builder,
                         publishing gate (QA, no test label, brand voice, licensed audio), at-most-once ledger, account links, CLI
  pipeline/              daily automation job handlers: content.plan → storyboard.generate (shared) → script.generate →
                         video.render → video.publish; providers (injectable for tests), daily spend cap, DB ledger
  index.ts               entry: HTTP server + job worker + graceful shutdown
assets/fonts/            caption fonts, OFL 1.1: Noto Sans (Latin/Devanagari/Telugu), Kalam (Latin/Devanagari), Timmana (Telugu)
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
- **Daily automation** (`src/pipeline`, [docs/architecture.md](docs/architecture.md#daily-pipeline-srcpipeline)):
  - Handlers get a `PipelineContext`; every paid or external call goes through `PipelineProviders`, so tests swap in doubles.
  - Before every paid step call `ensureDailyBudget` (`DAILY_MAX_USD`); over the cap the job throws `DeferJobError` (re-queued for tomorrow, no attempt used). Record all spend with `recordCosts` (with `job_id`).
  - Handlers must be safe to re-run: reuse an existing storyboard/images/script/video before spending again.
  - `PIPELINE_RENDER_MODE=final` refuses anything but the brand's own ElevenLabs voice on a paid plan; `test` renders are labelled and get no publications. `PUBLISHING_ENABLED` is off by default.
  - `video.publish` uses the `publications` row as the at-most-once ledger: save `publishing` before the one create-post call; a lost reply → `needs_check`, never a resubmit.
- **Generated content, prompts and QA** → follow the `content-compliance-check` skill.
- **OpenAI** (`src/ai`): the owner has an OpenAI API account. OpenAI is the provider for scripts **and** illustrations. Rules:
  - Keys come only from `OPENAI_API_KEY` in `.env`.
  - Every call goes through `Budget` (spend cap `OPENAI_MAX_USD_PER_RUN`), and its cost is recorded from the returned `usage`.
  - Update the dated rates in `src/ai/pricing.ts` when prices change.
  - Tests use mocked `fetch` and never call the real API.
  - Scripture brands stay blocked until scripture verification exists.
- **Voice (ElevenLabs, `src/ai/elevenlabs.ts`)**:
  - Model `eleven_v4`, because Multilingual v2 and Flash have no Telugu.
  - **One fixed voice per brand**, set in the brand's `voice.elevenLabs`.
  - `validateBrands` rejects shared voices, and kids brands must use an original _designed_ mascot voice (never a "character-inspired" Library voice).
  - Captions sync to the returned character timestamps.
  - Every call goes through a `Budget` (`ELEVENLABS_MAX_USD_PER_RUN`).
  - Don't use Default voices, which expire 31 Dec 2026.
  - Commercial use, Library voices and Voice Design via the API all need a paid plan.
  - See docs/voices.md.
- **Media / rendering** → `produceVideo()` in `src/media/pipeline.ts`. Providers (voice, illustrations) are pluggable interfaces; tests use local test doubles, never paid APIs. A script must match its brand's language. Keep captions out of the bottom 24% (platform UI): `bold` captions sit just above it and `soft_handwritten` captions are centred. Use the bundled fonts. Demo output (`data/renders/demo`) is never published.
- **Creative direction** ([docs/creative-direction.md](docs/creative-direction.md), the final v3 formula for the 3 self-improvement brands; the owner's source briefs and the reference-reel analysis are in `docs/creative-sources/`):
  - **Idea (how to find viral ideas):** use the owner's framework in `docs/creative-sources/viral-framework-v2.md`. Every idea needs an identity signal, a permission reframe and an emotional swing; it comes from one of the 6 topic categories and passes the quality filters, with honest guardrails. Any future topic-research step must reuse this framework.
  - **Script (owner rule: every video holds ONE clear message and follows the 4 steps of the owner's slide):**
    1. **Hook:** the first 3 s, like a Netflix thumbnail.
    2. **Message:** 2–4 parallel lines delivering the core value; reframe pairs ("It's not X. It's Y.") are the signature rhythm.
    3. **Metaphor:** the sticky, visual "Aha!" line people screenshot.
    4. **Conclusion:** loops back to the hook.

    Length is 19–27 s, with [BEAT] 0.7 s / [PAUSE] 1.2 s, in short 2–6 word clauses.

  - **Reference reel (owner, 18 Nov 2026):** match its format and feeling only. Never reuse its lines; `REFERENCE_REEL_LINES` rejects them.
  - **Voice:** a **deep, calm, slow male narrator** for all three brands (Cal / Taksh – Late-Night / Vagmin), `CALM_NARRATION` (stability 0.5, speed 0.92), and calm-only per-line audio tags (loud or dramatic tags are rejected).
  - **Images:** **premium warm lo-fi anime**, one near-still image per line (`CALM_MOTION`), with a shot type and mood palette per line and a high-quality, quietly striking hook image. FFmpeg applies a warm film finish: temperature, faded blacks, grain, procedural dust and a strong vignette.
  - **Language (owner rule):** Hindi and Telugu narration must be pure, modern, everyday language that every speaker understands: no English words or Hinglish, and nothing archaic, literary or heavily Sanskritised. Enforced by the brand rules and a 97 % native-script check.
  - **Captions:** `soft_handwritten`: centred, Kalam (EN slanted, lowercase; HI) / Timmana (TE), 2–4 words at a time, soft shadow and fades; the hook and metaphor slightly larger in warm cream.
  - **Code:** encoded in `src/brands/shared.ts`, the brand files, `src/ai/script-writer.ts`, `buildImagePrompt`, `src/ai/elevenlabs.ts` and `src/media/{pipeline,render,captions}.ts`. Keep them in sync with the doc.
- **Publishing (Blotato, `src/publishing`, [docs/publishing.md](docs/publishing.md))**:
  - Blotato is called from TypeScript (not the n8n Blotato node); n8n only triggers.
  - `publishProblems()` must pass for every platform: QA passed, no on-screen test label (`--final` renders), the brand's own ElevenLabs voice on a paid plan, real images, audio licensed for that platform, metadata present.
  - Create-post has **no idempotency key**: send it exactly once (never retried), persist the intent in the ledger first, and resolve an ambiguous result by looking it up ("needs-check"), never by resubmitting.
  - YouTube always sets `containsSyntheticMedia: true` and `isMadeForKids` from the brand, and defaults to `private`.
  - Account IDs live on `social_accounts` (`provider_account_ref`, `capabilities.pageId`); the API key only in `.env` (`BLOTATO_API_KEY`). Generating a Blotato key ends the trial and starts billing.
  - Tests mock `fetch` and never call Blotato.
- **Music & sound effects** ([docs/audio-library.md](docs/audio-library.md)):
  - Use only `approved` rows of `audio_library_assets`. A DB CHECK plus `rightsDecision()` require verified commercial, monetised and modification rights, Content ID `not_registered`, the cleared platforms, and a dated licence check with evidence.
  - Selection: `planSoundDesign()`. Rights are re-checked by the `audio_rights` QA, which also verifies file checksums.
  - If no verified track fits, use **no music** (never an unverified track, never the synthesized pad in AI videos).
  - YouTube Audio Library assets are YouTube-only.
  - Platform-restricted tracks (e.g. "Broken" by MX Audio Library: YouTube only, credit required) are only used in a separate platform version. That version's metadata carries the credit, and the track never appears in a cross-platform export (`planPlatformVariants`, `src/media/demo/variants.ts`).
  - Never commit audio files; they stay in `data/audio/`.
- **Environment trouble** → follow the `local-stack` skill.
- **Server / deployment / backups** → follow the `vps-operations` skill. Only Caddy may publish ports, deploy files must use LF line endings, and every required compose variable must be in `deploy/.env.example` (enforced by `tests/unit/deploy.test.ts`).
- **API**: validate all input with zod. Mutating routes require `Authorization: Bearer $ADMIN_API_TOKEN` (checked in `onRequest`). Escape all HTML output.
- **Tests**: every feature ships with tests. Tests never call paid APIs (mock providers). Run `npm run check` before declaring work done.
- **Style**: strict TypeScript, no `any`, `import type` for types, `.js` extensions in relative imports (NodeNext), small modules, comments only where intent isn't obvious.

## 8. Environment notes (owner's Windows work laptop)

- No admin rights. Docker Desktop is blocked by corporate policy (WSL `0x80070569`), so locally Postgres runs as a user process (`scripts/local-pg.mjs`, port 5433, data in `data/postgres`) and n8n runs natively under a portable Node 24 in `.tools/` (n8n's native modules don't support Node 26). The VPS uses `deploy/docker-compose.yml`; the root `docker-compose.yml` is only for local Docker.
- The corporate network breaks TLS revocation checks, so use `curl.exe --ssl-no-revoke` for downloads.
- The corporate network also re-signs HTTPS to some hosts (e.g. `api.openai.com`) with a company certificate, so Node gets `SELF_SIGNED_CERT_IN_CHAIN`.
  - npm scripts that call external APIs run Node with **`--use-system-ca`**, which trusts the Windows certificate store.
  - Never disable TLS verification (`NODE_TLS_REJECT_UNAUTHORIZED=0`) as a workaround.
- GitHub CLI is installed per-user at `%LOCALAPPDATA%\Programs\gh\bin`. Authenticate it with the **personal** account only, when the user asks.
- PowerShell 5.1: no `&&`/`||`. Writing with `Set-Content -Encoding utf8` adds a BOM, so prefer editor tools.

## 9. Current status

Phase 1 (local setup) and the local part of Phase 3 (core) are done: schema (17 tables), 9 brands seeded with 36 social-account slots, job queue + worker, `/health`, `/health/ready`, brands and jobs API, idempotent `POST /api/schedule/daily` (plans tomorrow for the automation brands), dashboard at `/`, and the n8n daily-scheduler workflow.

Phase 2 is **prepared but not deployed**. The production Dockerfile, compose stack with Caddy HTTPS and basic auth, server setup/hardening, deploy, backup/restore and n8n bootstrap scripts are written and validated locally, and the provider comparison is dated 18 Nov 2026 ([docs/phase-2-vps.md](docs/phase-2-vps.md)).

The Phase 5 render engine and video QA work locally (`npm run video:demo`, [docs/video-demo.md](docs/video-demo.md)). **OpenAI** has been chosen and purchased for scripts and illustrations. `npm run video:ai` makes a real AI test video with a spend cap ([docs/ai-video-test.md](docs/ai-video-test.md)).

The owner's creative direction ([docs/creative-direction.md](docs/creative-direction.md), final v3 formula) is encoded for Quiet Growth, Behtar Bano and Ninnu Nuvvu Geluvu:

- the viral formula: idea triggers, hook → message (reframe pairs) → metaphor → conclusion, 19–27 s with beats and pauses, and calm per-line voice tags;
- the v3 reference-reel look ([analysis](docs/creative-sources/reference-reel-analysis.md)): a deep, calm male narrator per brand, premium warm lo-fi anime images with a high-quality hook frame, a warm film finish with dust, near-still motion, and centred soft handwritten captions;
- per-scene camera moves and sound cues;
- validated per-platform metadata (`metadata.json`);
- a licence-verified music/SFX library with ducking and rights QA. Five Mixkit tracks are approved for all 4 platforms (18 Nov 2026), plus one YouTube-only track ([docs/audio-library.md](docs/audio-library.md)).

**ElevenLabs** is chosen for voice and integrated. Six brands have a fixed Library voice. The three kids mascot voices still need to be designed, which needs a paid plan; the account is on Free ([docs/voices.md](docs/voices.md)). On 18 Nov 2026 the API stopped answering requests made with the owner's key (a fake key gets an instant reply), so the owner must check the account and create a new key.

**Publishing (Phase 7)** is built locally and tested with mocks: a Blotato client, a per-platform post builder, the publishing gate, an at-most-once ledger and account links (`npm run publish:video`, [docs/publishing.md](docs/publishing.md)). Nothing has been published: there is no Blotato subscription and no social accounts yet. n8n runs natively and the daily-scheduler workflow is imported (inactive).

**Daily automation** is built and tested (19 Nov 2026, mocked providers + real FFmpeg render; migration `0003`): the worker plans tomorrow's 3 slots for `AUTOMATION_BRANDS` (Quiet Growth, Behtar Bano, Ninnu Nuvvu Geluvu), writes one shared storyboard + image set per slot and each brand's own script, renders and QA-checks each video, stores everything in the DB and schedules publications at 08:00 / 13:00 / 20:00 brand-local time. `video.publish` posts due videos through Blotato once `PUBLISHING_ENABLED=true`; n8n "QGM - Publish due videos" (every 10 min) triggers it. Daily AI spend is capped by `DAILY_MAX_USD` ($3). Final renders need the paid ElevenLabs plan.

Still open:

- upgrading ElevenLabs to a paid plan and designing the three kids voices;
- creating and warming up the social accounts, then the Blotato subscription;
- the scripture validator;
- quarantine notifications, similarity-based duplicate detection and analytics.

**Next:**

1. The owner creates a personal GitHub account and repository ([docs/phase-1-setup-windows.md](docs/phase-1-setup-windows.md)).
2. The owner upgrades ElevenLabs, re-imports the n8n workflows (`npm run n8n:bootstrap`) and activates the daily scheduler.
3. The owner picks and approves a VPS plan, then follows docs/phase-2-vps.md step by step.

Keep [docs/roadmap.md](docs/roadmap.md) up to date.
