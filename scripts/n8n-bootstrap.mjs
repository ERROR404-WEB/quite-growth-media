#!/usr/bin/env node
// One-command n8n setup (idempotent):
//   1. creates/updates the "QGM Admin Token" Header Auth credential from ADMIN_API_TOKEN in .env
//      (n8n encrypts it with N8N_ENCRYPTION_KEY; the token is never printed)
//   2. imports/updates the workflows in n8n/workflows/
// Usage: npm run n8n:bootstrap   (works whether or not n8n is running)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(root, '.env'), quiet: true });

const token = process.env.ADMIN_API_TOKEN;
if (!token) {
  console.error('ADMIN_API_TOKEN missing - run: npm run setup:env');
  process.exit(1);
}

function n8n(...args) {
  const res = spawnSync(process.execPath, [join(root, 'scripts', 'n8n-local.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation|license SDK/.test(l));
  if (res.status !== 0) {
    console.error(output.join('\n'));
    process.exit(res.status ?? 1);
  }
  return output;
}

const dir = mkdtempSync(join(tmpdir(), 'qgm-n8n-'));
try {
  const credFile = join(dir, 'credentials.json');
  writeFileSync(
    credFile,
    JSON.stringify([
      {
        id: 'qgmAdminToken001',
        name: 'QGM Admin Token',
        type: 'httpHeaderAuth',
        data: { name: 'Authorization', value: `Bearer ${token}` },
      },
    ]),
    { mode: 0o600 },
  );
  console.log(n8n('import:credentials', `--input=${credFile}`).at(-1));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(n8n('import:workflow', '--separate', `--input=${join(root, 'n8n', 'workflows')}`).at(-1));
console.log('n8n bootstrap complete: credential "QGM Admin Token" + workflows imported.');
