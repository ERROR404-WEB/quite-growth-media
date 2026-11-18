#!/usr/bin/env node
// Runs n8n natively (no Docker) against the project's PostgreSQL "n8n" database.
// Used when Docker Desktop is unavailable. Requires the one-time install described in
// docs/local-stack.md (portable Node 24 in .tools/node24 + n8n in .tools/n8n).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(root, '.env'), quiet: true });

const nodeExe = join(root, '.tools', 'node24', process.platform === 'win32' ? 'node.exe' : 'bin/node');
const n8nBin = join(root, '.tools', 'n8n', 'node_modules', 'n8n', 'bin', 'n8n');
if (!existsSync(n8nBin)) {
  console.error('n8n is not installed in .tools/n8n - see docs/local-stack.md ("Native n8n").');
  process.exit(1);
}
for (const key of ['N8N_DB_PASSWORD', 'N8N_ENCRYPTION_KEY']) {
  if (!process.env[key]) {
    console.error(`${key} missing from .env - run: npm run setup:env`);
    process.exit(1);
  }
}

const userFolder = join(root, 'data', 'n8n');
mkdirSync(userFolder, { recursive: true });

const env = {
  ...process.env,
  N8N_USER_FOLDER: userFolder,
  DB_TYPE: 'postgresdb',
  DB_POSTGRESDB_HOST: '127.0.0.1',
  DB_POSTGRESDB_PORT: process.env.POSTGRES_PORT ?? '5433',
  DB_POSTGRESDB_DATABASE: 'n8n',
  DB_POSTGRESDB_USER: 'n8n',
  DB_POSTGRESDB_PASSWORD: process.env.N8N_DB_PASSWORD,
  N8N_HOST: 'localhost',
  N8N_PORT: '5678',
  N8N_LISTEN_ADDRESS: '127.0.0.1',
  N8N_PROTOCOL: 'http',
  N8N_SECURE_COOKIE: 'false',
  N8N_DIAGNOSTICS_ENABLED: 'false',
  N8N_PERSONALIZATION_ENABLED: 'false',
  GENERIC_TIMEZONE: process.env.APP_TIMEZONE ?? 'Asia/Kolkata',
  // Keep app secrets out of n8n's process environment.
  ADMIN_API_TOKEN: '',
  POSTGRES_PASSWORD: '',
  DATABASE_URL: '',
  TEST_DATABASE_URL: '',
};

const runtime = existsSync(nodeExe) ? nodeExe : process.execPath;
// Default is "start"; any other n8n CLI command can be passed through, e.g. import:workflow --input=...
const args = process.argv.length > 2 ? process.argv.slice(2) : ['start'];
const child = spawn(runtime, [n8nBin, ...args], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
