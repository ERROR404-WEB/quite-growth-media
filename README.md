# Quiet Growth Media Network

An automated AI media-production platform for **nine independent brands** (English, Hindi and Telugu; self-improvement, spirituality/devotional and kids). Each brand creates three original vertical videos a day for Instagram, Facebook, YouTube and X.

> Status: **Phase 1 + local Phase 3 core**. The schema, brands, job queue, API, dashboard and n8n scheduler work locally. **Phase 2 (VPS) is prepared**: the production stack and scripts are ready to deploy. Content generation starts in Phase 4. See [docs/roadmap.md](docs/roadmap.md).

## Brands

| #   | Brand                                   | Language | Niche                |
| --- | --------------------------------------- | -------- | -------------------- |
| 1   | Quiet Growth                            | English  | Self-improvement     |
| 2   | Daily Faith and Light                   | English  | General spirituality |
| 3   | Bhakti Ki Shakti (भक्ति की शक्ति)         | Hindi    | Hindu devotional     |
| 4   | Devudu Manatho Unnadu (దేవుడు మనతో ఉన్నాడు) | Telugu   | Hindu devotional     |
| 5   | Behtar Bano (बेहतर बनो)                  | Hindi    | Self-improvement     |
| 6   | Ninnu Nuvvu Geluvu (నిన్ను నువ్వు గెలువు)   | Telugu   | Self-improvement     |
| 7   | Little Wonder World                     | English  | Kids (2–6)           |
| 8   | Nanhe Sitare (नन्हे सितारे)                | Hindi    | Kids (2–6)           |
| 9   | Chinni Lokam (చిన్ని లోకం)                  | Telugu   | Kids (2–6)           |

## Quick start (Windows, no Docker)

```powershell
npm install
npm run setup:env      # creates .env with random secrets (never commit it)
npm run pg:init        # first time only: local PostgreSQL on 127.0.0.1:5433
npm run db:migrate
npm run db:seed
npm run dev            # http://127.0.0.1:3000
```

Then run `npm run check` (typecheck, lint and tests). For n8n and day-to-day use, see [docs/local-stack.md](docs/local-stack.md).

To test video rendering (free, no API keys): `npm run video:demo`. See [docs/video-demo.md](docs/video-demo.md).
Where Docker works, `npm run stack:up` starts Postgres and n8n instead of `pg:*` / `n8n:start`.

## Production (VPS)

The VPS runs the production stack in `deploy/` (Docker Compose: PostgreSQL, API + worker, n8n, and Caddy with automatic HTTPS). Follow [docs/phase-2-vps.md](docs/phase-2-vps.md): it covers choosing a provider, creating the server, hardening it, deploying, and setting up backups.

## API

| Method | Path                    | Auth         | Purpose                                      |
| ------ | ----------------------- | ------------ | -------------------------------------------- |
| GET    | `/`                     | –            | Control-room dashboard                       |
| GET    | `/health`               | –            | Liveness                                     |
| GET    | `/health/ready`         | –            | DB, migrations and brands readiness          |
| GET    | `/api/brands`           | –            | Brands                                       |
| GET    | `/api/brands/:id`       | –            | One brand incl. full config                  |
| GET    | `/api/jobs`             | –            | Jobs (`?status=&brandId=&limit=`)            |
| GET    | `/api/jobs/summary`     | –            | Job counts by brand and status               |
| POST   | `/api/schedule/daily`   | Bearer token | Enqueue each brand's daily jobs (idempotent) |
| POST   | `/api/jobs/:id/requeue` | Bearer token | Requeue a quarantined job                    |

## Documentation

- [docs/phase-1-setup-windows.md](docs/phase-1-setup-windows.md): beginner guide (GitHub account, first push)
- [docs/local-stack.md](docs/local-stack.md): running Postgres, the API and n8n locally
- [docs/phase-2-vps.md](docs/phase-2-vps.md): VPS provider comparison and step-by-step server deployment
- [docs/video-demo.md](docs/video-demo.md): test the video render + QA pipeline locally
- [docs/architecture.md](docs/architecture.md): design, job lifecycle, module map
- [docs/roadmap.md](docs/roadmap.md): phases 1–9 checklist
- [AGENTS.md](AGENTS.md): rules for AI coding agents (GitHub Copilot)

## AI agent setup

- `AGENTS.md`: always-on project instructions
- `.agents/skills/`: skills: `add-migration`, `add-or-update-brand`, `add-job-type`, `content-compliance-check`, `beginner-step-guide`, `phase-report`, `local-stack`, `vps-operations`
- `.github/hooks/qgm.json`: Copilot hooks: a safety guard (blocks `.env` reads and destructive commands such as volume deletion, asks before commit/push, deploys and live restores), auto-format after edits, and a session status message at start
