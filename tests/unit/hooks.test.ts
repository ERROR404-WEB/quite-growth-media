import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const HOOKS = join(ROOT, '.github', 'hooks', 'scripts');

function runHook(script: string, input: unknown): { status: number | null; json: Record<string, unknown> } {
  const res = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 15_000,
  });
  return { status: res.status, json: JSON.parse(res.stdout) as Record<string, unknown> };
}

const shell = (command: string, asString = false) => ({
  toolName: 'powershell',
  toolArgs: asString ? JSON.stringify({ command }) : { command },
  cwd: ROOT,
});

describe('guard.mjs (preToolUse)', () => {
  it.each([
    ['docker compose down -v', 'deny'],
    ['psql -c "DROP DATABASE qgm"', 'deny'],
    ['git push --force origin main', 'deny'],
    ['git reset --hard HEAD~1', 'deny'],
    ['git config --global user.email me@example.com', 'deny'],
    ['Get-Content .env', 'deny'],
    ['cat ./.env | head', 'deny'],
    ['Remove-Item -Recurse data\\postgres', 'deny'],
    ['git commit -m "wip"', 'ask'],
    ['git push origin main', 'ask'],
    ['gh repo create quiet-growth-media --private', 'ask'],
    ['docker volume rm qgm_postgres_data', 'deny'],
    ['docker system prune -a --volumes', 'deny'],
    ['bash deploy/scripts/restore.sh /var/backups/qgm/20261118T020000Z', 'ask'],
    ['bash deploy/scripts/deploy.sh --pull', 'ask'],
  ])('%s -> %s', (command, decision) => {
    const { status, json } = runHook('guard.mjs', shell(command));
    expect(status).toBe(0);
    expect(json.permissionDecision).toBe(decision);
    expect(String(json.permissionDecisionReason)).toContain('[qgm guard]');
  });

  it.each([
    'npm test',
    'Get-Content .env.example',
    'git status',
    'git config --local user.name Arjun',
    'git config --global --get user.email',
    'docker compose down',
    'bash deploy/scripts/restore.sh --verify /var/backups/qgm/20261118T020000Z',
    'docker image prune',
  ])('allows "%s" (no decision)', (command) => {
    expect(runHook('guard.mjs', shell(command)).json).toEqual({});
  });

  it('accepts toolArgs as a JSON string', () => {
    expect(runHook('guard.mjs', shell('git commit -m x', true)).json.permissionDecision).toBe('ask');
  });

  it('accepts the VS Code compatible snake_case payload', () => {
    const { json } = runHook('guard.mjs', { tool_name: 'Bash', tool_input: { command: 'git push -f' } });
    expect(json.permissionDecision).toBe('deny');
  });

  it('blocks reading or editing .env via file tools but allows .env.example', () => {
    expect(
      runHook('guard.mjs', { toolName: 'view', toolArgs: { path: 'C:\\repo\\.env' } }).json
        .permissionDecision,
    ).toBe('deny');
    expect(
      runHook('guard.mjs', { toolName: 'edit', toolArgs: { path: '/repo/.env.local' } }).json
        .permissionDecision,
    ).toBe('deny');
    expect(runHook('guard.mjs', { toolName: 'view', toolArgs: { path: '/repo/.env.example' } }).json).toEqual(
      {},
    );
  });

  it('asks before editing an existing migration but allows creating a new one', () => {
    const edit = runHook('guard.mjs', {
      toolName: 'edit',
      toolArgs: { path: 'migrations/0001_core_schema.sql' },
    });
    expect(edit.json.permissionDecision).toBe('ask');
    const create = runHook('guard.mjs', {
      toolName: 'create',
      toolArgs: { path: 'migrations/0002_new.sql' },
    });
    expect(create.json).toEqual({});
  });

  it('never crashes on malformed input', () => {
    for (const input of ['', 'not json', '{"toolArgs": 42}', '[]']) {
      const res = runHook('guard.mjs', input);
      expect(res.status).toBe(0);
      expect(res.json).toEqual({});
    }
  });
});

describe('session-context.mjs (sessionStart)', () => {
  it('returns secret-free additional context', () => {
    const { status, json } = runHook('session-context.mjs', { cwd: ROOT, source: 'new' });
    expect(status).toBe(0);
    const ctx = String(json.additionalContext);
    expect(ctx).toContain('Postgres 127.0.0.1:5433');
    expect(ctx).toContain('AGENTS.md');
    expect(ctx).not.toMatch(/[a-f0-9]{48,}/);
  });
});

describe('format-on-edit.mjs (postToolUse)', () => {
  it('formats an edited TypeScript file and always returns {}', () => {
    const dir = mkdtempSync(join(ROOT, 'tests', '.tmp-'));
    try {
      const file = join(dir, 'ugly.ts');
      writeFileSync(file, 'const   x = {a:1,b:"two"}\n');
      const { status, json } = runHook('format-on-edit.mjs', {
        toolName: 'edit',
        toolArgs: { path: file },
        cwd: ROOT,
      });
      expect(status).toBe(0);
      expect(json).toEqual({});
      expect(readFileSync(file, 'utf8')).toBe("const x = { a: 1, b: 'two' };\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores files outside the repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qgm-'));
    try {
      const file = join(dir, 'outside.ts');
      writeFileSync(file, 'const   y=1\n');
      runHook('format-on-edit.mjs', { toolName: 'edit', toolArgs: { path: file }, cwd: ROOT });
      expect(readFileSync(file, 'utf8')).toBe('const   y=1\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
