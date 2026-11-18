---
name: local-stack
description: Starts, stops, checks and troubleshoots the local development environment - PostgreSQL, the TypeScript API, the job worker and n8n - on Windows with or without Docker. Use when the app or database won't start, tests can't connect, or setting up a fresh machine.
---

# Local development stack

| Service    | Address               | Start (no Docker – current default) | Start (Docker Compose) |
| ---------- | --------------------- | ----------------------------------- | ---------------------- |
| PostgreSQL | 127.0.0.1:5433        | `npm run pg:start`                  | `npm run stack:up`     |
| API + jobs | http://127.0.0.1:3000 | `npm run dev`                       | `npm run dev`          |
| n8n        | http://localhost:5678 | `npm run n8n:start`                 | included in `stack:up` |

Databases: `qgm` (app), `qgm_test` (tests only, reset on every test run) and `n8n` (owned by the `n8n` role).

## Fresh machine (first time)

1. `npm install`
2. `npm run setup:env`: creates `.env` with random secrets (never print or commit it).
3. Database, either:
   - No Docker: `npm run pg:init` (uses the installed PostgreSQL binaries and creates `./data/postgres`), or
   - Docker: `npm run stack:up`
4. `npm run db:migrate` then `npm run db:seed`
5. `npm run dev`, then open http://127.0.0.1:3000
6. `npm run check`

## Why there are two paths

Docker Desktop on the current work laptop fails with WSL error `0x80070569` ("user has not been granted the requested logon type"), which comes from corporate Group Policy and needs IT/admin to fix. So locally we run PostgreSQL as a user process (`scripts/local-pg.mjs`) and n8n natively (`scripts/n8n-local.mjs`, using a portable Node 24 in `.tools/`, because n8n's native modules don't support Node 26 yet). **The VPS (Phase 2) uses Docker Compose** (`deploy/docker-compose.yml`; see the `vps-operations` skill).

## Troubleshooting

- **`ECONNREFUSED 127.0.0.1:5433`**: Postgres isn't running. Run `npm run pg:status`, then `npm run pg:start`. Logs are in `data/postgres.log`.
- **`/health/ready` returns 503 with pending migrations**: run `npm run db:migrate`.
- **"Migration ... was modified after being applied"**: someone edited an applied migration. Revert it and add a new migration instead.
- **Port 3000 in use**: find the PID with `Get-NetTCPConnection -LocalPort 3000 -State Listen` and stop it with `Stop-Process -Id <PID>`.
- **n8n "not installed"**: see the "Native n8n" section of `docs/local-stack.md`.
- **Downloads fail with `CRYPT_E_NO_REVOCATION_CHECK`**: the corporate proxy blocks the revocation check. Use `curl.exe --ssl-no-revoke`.
- **Integration tests skipped**: `TEST_DATABASE_URL` is missing from `.env`, or Postgres is down.

Never run `docker compose down -v` or delete `data/postgres`. That destroys the database (the hooks block it).
