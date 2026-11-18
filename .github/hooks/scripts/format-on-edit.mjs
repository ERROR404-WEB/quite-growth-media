#!/usr/bin/env node
// postToolUse hook: formats files the agent just created/edited with the project's Prettier config.
// Never blocks or fails the session: always prints {} and exits 0.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const FORMATTABLE = /\.(ts|tsx|js|mjs|cjs|json|md|ya?ml|css|html)$/i;
const EDIT_TOOLS = new Set([
  'edit',
  'create',
  'write',
  'str_replace_editor',
  'apply_patch',
  'Edit',
  'Write',
  'MultiEdit',
]);

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

try {
  const event = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const toolName = event.toolName ?? event.tool_name ?? '';
  const root = resolve(event.cwd ?? process.cwd());
  if (EDIT_TOOLS.has(toolName)) {
    const args = parseArgs(event.toolArgs ?? event.tool_input);
    const files = [args.path, args.file_path, args.filePath].filter((p) => typeof p === 'string');
    const patch =
      typeof args.patch === 'string' ? args.patch : typeof args.input === 'string' ? args.input : '';
    for (const m of patch.matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)) files.push(m[1].trim());

    const prettier = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
    const targets = files
      .map((f) => (isAbsolute(f) ? f : join(root, f)))
      .filter((f) => FORMATTABLE.test(f) && existsSync(f))
      .filter((f) => !relative(root, f).startsWith('..') && !/(^|[\\/])\.env/.test(f));
    if (targets.length && existsSync(prettier)) {
      spawnSync(
        process.execPath,
        [prettier, '--write', '--log-level', 'silent', '--ignore-unknown', ...targets],
        {
          cwd: root,
          stdio: 'ignore',
          timeout: 20_000,
        },
      );
    }
  }
} catch {
  // Formatting is best-effort.
}
process.stdout.write('{}');
