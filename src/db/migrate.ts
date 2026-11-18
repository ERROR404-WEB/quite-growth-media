import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db, Queryable } from './pool.js';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Arbitrary constant; serialises concurrent migrators (e.g. two app instances starting at once).
const ADVISORY_LOCK_ID = 727_001;

export interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Invalid migration filename "${file}" (expected NNNN_snake_case.sql)`);
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({ version: match[1]!, name: match[2]!, checksum: checksum(sql), sql });
  }
  const versions = new Set<string>();
  for (const m of migrations) {
    if (versions.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`);
    versions.add(m.version);
  }
  return migrations;
}

async function ensureTable(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

async function appliedChecksums(db: Queryable): Promise<Map<string, string>> {
  const { rows } = await db.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

function assertUnchanged(files: MigrationFile[], applied: Map<string, string>): void {
  for (const file of files) {
    const recorded = applied.get(file.version);
    if (recorded && recorded !== file.checksum) {
      throw new Error(
        `Migration ${file.version}_${file.name} was modified after being applied. ` +
          'Never edit applied migrations - add a new migration instead.',
      );
    }
  }
}

export async function migrationStatus(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationStatus> {
  await ensureTable(db);
  const files = await loadMigrations(dir);
  const applied = await appliedChecksums(db);
  assertUnchanged(files, applied);
  return {
    applied: files.filter((f) => applied.has(f.version)).map((f) => `${f.version}_${f.name}`),
    pending: files.filter((f) => !applied.has(f.version)).map((f) => `${f.version}_${f.name}`),
  };
}

/** Applies pending migrations, each in its own transaction. Returns applied migration ids. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = await loadMigrations(dir);
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    await ensureTable(client);
    const applied = await appliedChecksums(client);
    assertUnchanged(files, applied);
    const done: string[] = [];
    for (const file of files.filter((f) => !applied.has(f.version))) {
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          file.version,
          file.name,
          file.checksum,
        ]);
        await client.query('COMMIT');
        done.push(`${file.version}_${file.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file.version}_${file.name} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
