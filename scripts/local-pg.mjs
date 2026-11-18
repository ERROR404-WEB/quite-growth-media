#!/usr/bin/env node
// Manages a project-owned PostgreSQL cluster WITHOUT Docker or admin rights.
// Use this only when Docker Desktop is unavailable (e.g. blocked by corporate policy).
// Data lives in ./data/postgres (gitignored). Listens on 127.0.0.1:${POSTGRES_PORT:-5433}.
//
//   node scripts/local-pg.mjs init    -> create cluster + databases (qgm, qgm_test, n8n)
//   node scripts/local-pg.mjs start   -> start server
//   node scripts/local-pg.mjs stop    -> stop server
//   node scripts/local-pg.mjs status  -> show status
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(root, '.env'), quiet: true });

const dataDir = join(root, 'data', 'postgres');
const logFile = join(root, 'data', 'postgres.log');
const port = process.env.POSTGRES_PORT ?? '5433';
const user = process.env.POSTGRES_USER ?? 'qgm';
const password = process.env.POSTGRES_PASSWORD;
const appDb = process.env.POSTGRES_DB ?? 'qgm';
const n8nPassword = process.env.N8N_DB_PASSWORD;

function findPgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && existsSync(base)) {
    const versions = readdirSync(base)
      .filter((v) => existsSync(join(base, v, 'bin', 'pg_ctl.exe')))
      .sort((a, b) => Number(b) - Number(a));
    if (versions[0]) return join(base, versions[0], 'bin');
  }
  return ''; // rely on PATH
}

const bin = findPgBin();
const exe = (name) => (bin ? join(bin, process.platform === 'win32' ? `${name}.exe` : name) : name);

function run(name, args, { allowFail = false, env = {}, detachOutput = false } = {}) {
  // detachOutput: the long-running postgres child must not inherit our stdout/stderr,
  // otherwise the calling terminal waits for the pipe to close forever.
  const stdio = detachOutput ? 'ignore' : 'inherit';
  const result = spawnSync(exe(name), args, { stdio, env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    console.error(`${name} exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result.status;
}

function requireSecrets() {
  if (!password || !n8nPassword) {
    console.error('POSTGRES_PASSWORD / N8N_DB_PASSWORD missing. Run: npm run setup:env');
    process.exit(1);
  }
}

function psql(db, sql) {
  run(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '-h', '127.0.0.1', '-p', port, '-U', user, '-d', db, '-c', sql],
    {
      env: { PGPASSWORD: password },
    },
  );
}

function init() {
  requireSecrets();
  if (existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log(`Cluster already initialised at ${dataDir}`);
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  const pwFile = join(tmpdir(), `qgm-pw-${process.pid}.txt`);
  writeFileSync(pwFile, password, { mode: 0o600 });
  try {
    run('initdb', [
      '-D',
      dataDir,
      '-U',
      user,
      `--pwfile=${pwFile}`,
      '-A',
      'scram-sha-256',
      '-E',
      'UTF8',
      '--no-locale',
    ]);
  } finally {
    rmSync(pwFile, { force: true });
  }
  start();
  psql('postgres', `CREATE DATABASE ${appDb}`);
  psql('postgres', 'CREATE DATABASE qgm_test');
  psql('postgres', `CREATE ROLE n8n LOGIN PASSWORD '${n8nPassword.replace(/'/g, "''")}'`);
  psql('postgres', 'CREATE DATABASE n8n OWNER n8n');
  psql('postgres', 'REVOKE ALL ON DATABASE n8n FROM PUBLIC');
  console.log(`Local PostgreSQL ready on 127.0.0.1:${port} (databases: ${appDb}, qgm_test, n8n).`);
}

function start() {
  if (run('pg_ctl', ['-D', dataDir, 'status'], { allowFail: true }) === 0) {
    console.log('PostgreSQL already running.');
    return;
  }
  const opts = `-p ${port} -c listen_addresses=127.0.0.1`;
  run('pg_ctl', ['-D', dataDir, '-l', logFile, '-o', opts, '-w', 'start'], { detachOutput: true });
  console.log(`PostgreSQL started on 127.0.0.1:${port} (log: data/postgres.log).`);
}

const command = process.argv[2];
switch (command) {
  case 'init':
    init();
    break;
  case 'start':
    start();
    break;
  case 'stop':
    run('pg_ctl', ['-D', dataDir, '-m', 'fast', 'stop'], { allowFail: true });
    break;
  case 'status':
    run('pg_ctl', ['-D', dataDir, 'status'], { allowFail: true });
    break;
  default:
    console.error('Usage: node scripts/local-pg.mjs <init|start|stop|status>');
    process.exit(1);
}
