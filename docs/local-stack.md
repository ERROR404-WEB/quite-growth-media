# Local development stack (Windows)

Everything runs on your laptop at **no cost**.

| Service    | URL / address         | How it runs here                               |
| ---------- | --------------------- | ---------------------------------------------- |
| PostgreSQL | `127.0.0.1:5433`      | Your own user-level cluster in `data/postgres` |
| API + jobs | http://127.0.0.1:3000 | `npm run dev`                                  |
| n8n        | http://localhost:5678 | Natively, with portable Node 24 from `.tools/` |

> **Why not Docker?** Docker Desktop is installed, but corporate policy stops its WSL engine from starting (error `0x80070569`: "the user has not been granted the requested logon type"). Only your IT department can fix that. We don't need it locally: the VPS (Phase 2) uses `deploy/docker-compose.yml`. If IT ever fixes Docker, `npm run stack:up` starts Postgres and n8n in containers instead (stop the native ones first; both use the same ports).

## Daily routine

Open a terminal in the project folder (in VS Code: **Terminal → New Terminal**) and run:

```powershell
npm run pg:start
```

✅ Success: `PostgreSQL started on 127.0.0.1:5433` (or `already running`).

```powershell
npm run dev
```

✅ Success: a log line containing `Server listening at http://0.0.0.0:3000`. Open http://127.0.0.1:3000 to see the control-room dashboard with 9 brands.

Optional, in a **second** terminal:

```powershell
npm run n8n:start
```

✅ Success: `Editor is now accessible via: http://localhost:5678`.

To stop: press `Ctrl+C` in each terminal, then run `npm run pg:stop`.

## First-time setup on a new machine

1. `npm install`
2. `npm run setup:env` creates `.env` with strong random secrets. You never need to open it.
3. `npm run pg:init` creates the database cluster plus the `qgm`, `qgm_test` and `n8n` databases. It needs PostgreSQL binaries installed (found automatically in `C:\Program Files\PostgreSQL\<version>\bin`; or set `PG_BIN`).
4. `npm run db:migrate` then `npm run db:seed`
5. `npm run check` (all tests should pass)
6. Native n8n (one-time, about 5 minutes, no admin needed): see below.

## Native n8n (one-time install)

n8n's native modules don't support Node 26 yet, so n8n gets its own portable Node 24 in `.tools/` (gitignored). The app itself keeps using your normal Node.

1. Download and unzip Node 24 (replace the version with the latest `v24.x` from https://nodejs.org/dist/):

   ```powershell
   curl.exe -sSL --ssl-no-revoke -o $env:TEMP\node24.zip https://nodejs.org/dist/v24.22.3/node-v24.22.3-win-x64.zip; Expand-Archive $env:TEMP\node24.zip .tools -Force; Rename-Item .tools\node-v24.22.3-win-x64 node24
   ```

2. Install n8n into `.tools\n8n`:

   ```powershell
   New-Item -ItemType Directory .tools\n8n -Force; Set-Content .tools\n8n\package.json '{"private":true}'; cmd /c "cd .tools\n8n && ..\node24\npm.cmd install n8n@2.48.4 --no-audit --no-fund"
   ```

3. `npm run n8n:bootstrap` creates the **QGM Admin Token** credential (n8n stores it encrypted; the token is never shown) and imports the workflows in `n8n/workflows/`. It's safe to re-run, e.g. after you change a workflow file or regenerate `.env`.
4. `npm run n8n:start`, then open http://localhost:5678.

### First time in the n8n editor

1. **Set up owner account**: enter your name, email and a strong password (stored only in your local n8n database). Skip the survey.
2. **Open the workflow**: Overview → **QGM - Daily content scheduler**. The **Plan the daily videos** node already uses the **QGM Admin Token** credential.
3. **Test it** (with `npm run dev` running): click **Execute workflow**. ✅ Success: the last node shows output like `{"date":"<tomorrow>","brands":3,"created":9,"existing":0}` (the 3 brands in `AUTOMATION_BRANDS`). A second run shows `created: 0, existing: 9`. That's idempotency working. ⚠️ With `npm run dev` running, the worker then **starts making those videos for real (OpenAI/ElevenLabs costs, capped by `DAILY_MAX_USD`)**.
4. **Activate** it with the toggle at the top (Inactive → Active) to run every day at 06:00 (`APP_TIMEZONE`).
5. **QGM - Publish due videos** calls `POST /api/publish/due` every 10 minutes. It does nothing until `PUBLISHING_ENABLED=true` and `BLOTATO_API_KEY` are set ([publishing.md](publishing.md#step-8--full-automation-built-switch-it-on-after-the-pilot-works)).

> Running an n8n CLI command while n8n is already running? Set a different task-broker port first: `$env:N8N_RUNNERS_BROKER_PORT='5690'`.

## Useful commands

| Command                    | What it does                                       |
| -------------------------- | -------------------------------------------------- |
| `npm run pg:status`        | Is Postgres running?                               |
| `npm run db:status`        | Applied and pending migrations                     |
| `npm run check`            | Typecheck + lint + all tests                       |
| `npm run test:integration` | DB tests (they reset the `qgm_test` database only) |
| `npm run build` / `start`  | Compile to `dist/` and run the compiled app        |

Troubleshooting: see the `local-stack` skill (`.agents/skills/local-stack/SKILL.md`).
