---
name: vps-operations
description: Deploys, updates, monitors, backs up and troubleshoots the production VPS (Ubuntu 24.04 + Docker Compose + Caddy HTTPS + n8n + PostgreSQL). Use for anything about the server, deploy/ folder, HTTPS, domains, backups/restores or production logs.
---

# VPS operations

Production runs from `deploy/docker-compose.yml` (project name `qgm`): `postgres` (pgvector), `api` (built from `Dockerfile`), `n8n`, and `caddy`. Only Caddy publishes ports (80/443). Everything is driven by scripts in `deploy/scripts/`. The full beginner walkthrough is in `docs/phase-2-vps.md`.

## Ground rules

- The owner is new to servers, so follow the `beginner-step-guide` skill: one step at a time, say what success looks like, and wait for confirmation.
- Never buy, resize or delete servers, domains or storage without explicit approval and a dated price check.
- Secrets live only in `deploy/.env` on the server (chmod 600). Never print it, `cat` it, paste it or commit it. Read single values with `env_value KEY` inside scripts.
- Never run `docker compose down -v`, `docker volume rm` or `docker system prune --volumes`. They delete the database volumes.
- Before any risky change (Postgres major upgrade, restore, migration that rewrites data), run `bash deploy/scripts/backup.sh` first.
- Docker-published ports bypass ufw. Never add `ports:` to postgres, n8n or api. Reach them via `dc.sh exec` or an SSH tunnel.
- All `.sh`, `Dockerfile`, `Caddyfile` and compose files must use LF line endings. `tests/unit/deploy.test.ts` enforces this.

## Common tasks (run on the server as `qgm` in `~/quiet-growth-media`)

| Task                       | Command                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Deploy latest code         | `bash deploy/scripts/deploy.sh --pull` (builds, migrates, seeds, restarts, waits for `/health/ready`)            |
| Status / logs              | `bash deploy/scripts/dc.sh ps` · `bash deploy/scripts/dc.sh logs -f --tail 100 api`                              |
| DB shell                   | `bash deploy/scripts/dc.sh exec postgres psql -U qgm -d qgm`                                                     |
| Dashboard password         | `bash deploy/scripts/set-dashboard-password.sh` (bcrypt hash in `deploy/caddy/dashboard-auth.caddy`, gitignored) |
| n8n credential + workflows | `bash deploy/scripts/n8n-bootstrap.sh` (rewrites the workflow API URL to `http://api:3000`)                      |
| Backup / verify / restore  | `backup.sh` · `restore.sh --verify <dir>` (safe) · `restore.sh <dir>` (replaces live DBs, asks to type RESTORE)  |
| Nightly backups            | `bash deploy/scripts/backup.sh --install-cron` (02:17, retention `BACKUP_RETENTION_DAYS`)                        |

## Changing the stack

1. Edit `deploy/docker-compose.yml`, `deploy/caddy/Caddyfile` or `Dockerfile` locally.
2. Validate locally (Docker Desktop can't run on the owner's laptop, but these checks work without it):
   - `docker compose --project-directory deploy -f deploy/docker-compose.yml --env-file <test env> config --quiet` (create a test env with `node scripts/setup-env.mjs --example deploy/.env.example --out <tmp>`).
   - shellcheck for scripts: `shellcheck -x deploy/scripts/*.sh`.
   - `npm run check`.
3. If you add a required variable (`${VAR:?...}`), add it to `deploy/.env.example`. The deploy tests check this.
4. Commit and push (only with the owner's approval), then `deploy.sh --pull` on the server.

## Troubleshooting

- **HTTPS fails:** check `dc.sh logs caddy`, confirm DNS A records point to the server, and confirm ports 80/443 are open (`sudo ufw status`). Let's Encrypt rate-limits repeated failures, so fix DNS before retrying.
- **API not ready:** `dc.sh logs api`. Look for pending or failed migrations and invalid env values (zod error lists the key).
- **n8n can't reach the API:** inside Docker the URL is `http://api:3000`. Re-run `n8n-bootstrap.sh`.
- **Disk full:** `df -h`; `docker system df`. Remove old images with `docker image prune` (no `--volumes`). Check `/var/backups/qgm`.
- **Locked out of SSH:** use the provider's web console and log in as `qgm` with the password.
