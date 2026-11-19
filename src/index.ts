import { getEnv } from './config/env.js';
import { migrationStatus } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { JOB_TYPES } from './domain/constants.js';
import { JobWorker } from './jobs/worker.js';
import { createLogger } from './logger.js';
import { createPipelineContext, pipelineSettings, registerPipeline } from './pipeline/index.js';
import { getBlotatoConfig } from './publishing/config.js';
import { buildApp } from './server/app.js';

async function main(): Promise<void> {
  const env = getEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const db = createPool(env.DATABASE_URL);

  const status = await migrationStatus(db);
  if (status.pending.length) {
    logger.warn({ pending: status.pending }, 'pending migrations - run: npm run db:migrate');
  }

  const settings = pipelineSettings(env);
  const blotatoKey = !!getBlotatoConfig().BLOTATO_API_KEY;
  const publishing = {
    enabled: env.PUBLISHING_ENABLED && blotatoKey,
    reason: !env.PUBLISHING_ENABLED
      ? 'PUBLISHING_ENABLED is false'
      : blotatoKey
        ? undefined
        : 'BLOTATO_API_KEY is not set',
  };
  const app = await buildApp({ db, env, logger, publishing });

  const worker = new JobWorker(db, logger, {
    pollIntervalMs: env.JOB_POLL_INTERVAL_MS,
    staleLockMinutes: env.JOB_STALE_LOCK_MINUTES,
  });
  worker.register(JOB_TYPES.systemNoop, async (job) => ({ ok: true, echo: job.payload }));
  registerPipeline(worker, createPipelineContext(db, logger, settings));
  logger.info(
    {
      automationBrands: settings.automationBrands,
      renderMode: settings.renderMode,
      dailyMaxUsd: settings.dailyMaxUsd,
      publishing,
    },
    'pipeline configured',
  );

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
