import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString, max, application_name: 'qgm-api' });
  // Without a listener, an idle-client error (e.g. DB restart) would crash the process.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return pool;
}

export async function withTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
