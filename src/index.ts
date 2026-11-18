import { getEnv } from './config/env.js';
import { migrationStatus } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { JOB_TYPES } from './domain/constants.js';
import { JobWorker } from './jobs/worker.js';
import { createLogger } from './logger.js';
import { buildApp } from './server/app.js';

async function main(): Promise<void> {
  const env = getEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const db = createPool(env.DATABASE_URL);

  const status = await migrationStatus(db);
  if (status.pending.length) {
    logger.warn({ pending: status.pending }, 'pending migrations - run: npm run db:migrate');
  }

  const app = await buildApp({ db, env, logger });

  const worker = new JobWorker(db, logger, {
    pollIntervalMs: env.JOB_POLL_INTERVAL_MS,
    staleLockMinutes: env.JOB_STALE_LOCK_MINUTES,
  });
  // Real pipeline handlers (content.plan, script.generate, ...) are registered in Phase 4+.
  worker.register(JOB_TYPES.systemNoop, async (job) => ({ ok: true, echo: job.payload }));

  await app.listen({ host: env.HOST, port: env.PORT });
  if (env.JOB_WORKER_ENABLED) await worker.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await worker.stop();
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
