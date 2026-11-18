import pg from 'pg';
import { getEnv } from '../../src/config/env.js';
import { migrate } from '../../src/db/migrate.js';
import { createPool, type Db } from '../../src/db/pool.js';
import { seed } from '../../src/db/seed.js';

/** Returns the test DB URL, or undefined when integration tests should be skipped. */
export function testDatabaseUrl(): string | undefined {
  try {
    return getEnv().TEST_DATABASE_URL;
  } catch {
    return undefined;
  }
}

/** Drops and recreates the public schema of the *test* database, then migrates and seeds it. */
export async function createFreshTestDb(): Promise<Db> {
  const url = testDatabaseUrl();
  if (!url) throw new Error('TEST_DATABASE_URL is not configured');
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": test database names must end with _test`);
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await admin.end();
  }
  const db = createPool(url, 5);
  await migrate(db);
  await seed(db);
  return db;
}
