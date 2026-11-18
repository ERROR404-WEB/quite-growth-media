#!/usr/bin/env node
// Creates an env file from a template and fills every empty secret with a strong random value.
// Safe to re-run: an existing file is never overwritten (use --force to regenerate).
// Secrets are written to disk only; they are never printed.
//
//   node scripts/setup-env.mjs                                    -> .env from .env.example (local dev)
//   node scripts/setup-env.mjs --example deploy/.env.example --out deploy/.env   (VPS)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const examplePath = resolve(root, argValue('--example') ?? '.env.example');
const envPath = resolve(root, argValue('--out') ?? '.env');
const force = process.argv.includes('--force');
const label = relative(root, envPath).startsWith('..') ? envPath : relative(root, envPath);

if (existsSync(envPath) && !force) {
  console.log(`${label} already exists - leaving it unchanged (pass --force to regenerate).`);
  process.exit(0);
}

const SECRET_KEYS = ['ADMIN_API_TOKEN', 'POSTGRES_PASSWORD', 'N8N_DB_PASSWORD', 'N8N_ENCRYPTION_KEY'];
const values = Object.fromEntries(SECRET_KEYS.map((k) => [k, randomBytes(32).toString('hex')]));

const output = readFileSync(examplePath, 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) return line;
    const [, key, value] = match;
    if (SECRET_KEYS.includes(key) && value === '') return `${key}=${values[key]}`;
    return line.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name) => values[name] ?? whole);
  })
  .join('\n');

writeFileSync(envPath, output, { encoding: 'utf8', mode: 0o600 });
console.log(`Created ${label} with ${SECRET_KEYS.length} generated secrets (values not shown).`);
