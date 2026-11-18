#!/usr/bin/env node
// sessionStart hook: gives the agent a short, secret-free status of the local stack.
// Prints {"additionalContext": "..."} and always exits 0. Must stay fast (< 3 s).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

function portOpen(port, host = '127.0.0.1', timeoutMs = 600) {
  return new Promise((done) => {
    const socket = createConnection({ port, host });
    const finish = (ok) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

let context;
try {
  let cwd = process.cwd();
  try {
    const event = JSON.parse(readFileSync(0, 'utf8') || '{}');
    if (event.cwd) cwd = resolve(event.cwd);
  } catch {
    // stdin is optional
  }
  const [pg, api, n8n] = await Promise.all([portOpen(5433), portOpen(3000), portOpen(5678)]);
  const migrations = readdirSync(join(cwd, 'migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f));
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || 'unknown';
  const commits = git(['rev-list', '--count', 'HEAD'], cwd) || '0';
  const changed = git(['status', '--porcelain'], cwd).split('\n').filter(Boolean).length;
  const status = (ok) => (ok ? 'UP' : 'down');

  context = [
    'Quiet Growth Media Network - session status (from .github/hooks/scripts/session-context.mjs):',
    `- Postgres 127.0.0.1:5433: ${status(pg)}${pg ? '' : ' (start: npm run pg:start, or npm run stack:up if Docker works)'}`,
    `- API http://127.0.0.1:3000: ${status(api)} (start: npm run dev)`,
    `- n8n http://localhost:5678: ${status(n8n)} (start: npm run n8n:start)`,
    `- Migrations on disk: ${migrations.length} (latest: ${migrations.at(-1) ?? 'none'})`,
    `- Git: branch ${branch}, ${commits} commits, ${changed} changed files. Do not commit or push without explicit approval.`,
    '- Follow AGENTS.md. Never read or print .env.',
  ].join('\n');
} catch {
  context = '';
}
process.stdout.write(JSON.stringify(context ? { additionalContext: context } : {}));
