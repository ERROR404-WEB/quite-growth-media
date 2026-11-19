import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const SCRIPTS = readdirSync(join(ROOT, 'deploy', 'scripts')).filter((f) => f.endsWith('.sh'));

describe('deployment files', () => {
  it('use LF line endings (CRLF breaks bash and Caddy on Linux)', () => {
    const files = [
      ...SCRIPTS.map((f) => ['deploy', 'scripts', f]),
      ['deploy', 'docker-compose.yml'],
      ['deploy', 'caddy', 'Caddyfile'],
      ['deploy', '.env.example'],
      ['docker', 'postgres', 'init', '01-init.sh'],
      ['Dockerfile'],
    ];
    for (const f of files) expect(read(...f).includes('\r\n'), f.join('/')).toBe(false);
  });

  it('shell scripts are strict bash', () => {
    for (const f of SCRIPTS) {
      const text = read('deploy', 'scripts', f);
      expect(text.startsWith('#!/usr/bin/env bash\n'), f).toBe(true);
      if (f !== 'lib.sh') expect(text, f).toContain('set -euo pipefail');
    }
  });

  it('only Caddy publishes ports in production', () => {
    const compose = read('deploy', 'docker-compose.yml');
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1);
    const caddyBlock = compose.slice(compose.indexOf('  caddy:'));
    expect(caddyBlock).toContain("- '443:443'");
  });

  it('locks down n8n and runs the API as a non-root user', () => {
    expect(read('deploy', 'docker-compose.yml')).toMatch(/N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true'/);
    expect(read('Dockerfile')).toMatch(/^USER node$/m);
  });

  it('declares every required compose variable in deploy/.env.example', () => {
    const required = [...read('deploy', 'docker-compose.yml').matchAll(/\$\{([A-Z0-9_]+):\?/g)].map(
      (m) => m[1],
    );
    const example = read('deploy', '.env.example');
    for (const key of new Set(required)) expect(example, key).toMatch(new RegExp(`^${key}=`, 'm'));
  });

  it('keeps the workflow URL that n8n-bootstrap.sh rewrites to http://api:3000', () => {
    for (const wf of ['daily-scheduler.json', 'publish-due.json'])
      expect(read('n8n', 'workflows', wf), wf).toContain('"value": "http://127.0.0.1:3000"');
    expect(read('deploy', 'scripts', 'n8n-bootstrap.sh')).toContain('"value": "http://127.0.0.1:3000"');
  });

  it('git-ignores generated secrets', () => {
    for (const p of ['deploy/.env', '.env', 'deploy/caddy/dashboard-auth.caddy']) {
      const res = spawnSync('git', ['check-ignore', '-q', p], { cwd: ROOT });
      expect(res.status, p).toBe(0);
    }
    expect(spawnSync('git', ['check-ignore', '-q', 'deploy/.env.example'], { cwd: ROOT }).status).toBe(1);
  });
});

describe('setup-env.mjs', () => {
  it('creates an env file from any template with fresh secrets and never overwrites it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qgm-env-'));
    try {
      const out = join(dir, 'deploy.env');
      const run = () =>
        spawnSync(
          process.execPath,
          ['scripts/setup-env.mjs', '--example', 'deploy/.env.example', '--out', out],
          {
            cwd: ROOT,
            encoding: 'utf8',
          },
        );
      expect(run().stdout).toContain('Created');
      const first = readFileSync(out, 'utf8');
      for (const key of ['ADMIN_API_TOKEN', 'POSTGRES_PASSWORD', 'N8N_DB_PASSWORD', 'N8N_ENCRYPTION_KEY']) {
        expect(first).toMatch(new RegExp(`^${key}=[0-9a-f]{64}$`, 'm'));
      }
      expect(first).toMatch(/^APP_DOMAIN=$/m);
      const second = run();
      expect(second.stdout).toContain('already exists');
      expect(second.stdout).not.toMatch(/[0-9a-f]{64}/);
      expect(readFileSync(out, 'utf8')).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
