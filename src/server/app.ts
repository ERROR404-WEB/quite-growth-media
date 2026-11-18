import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppEnv } from '../config/env.js';
import type { Db } from '../db/pool.js';
import type { Logger } from '../logger.js';
import { apiRoutes } from './routes/api.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  db: Db;
  env: Pick<AppEnv, 'ADMIN_API_TOKEN' | 'APP_TIMEZONE' | 'JOB_MAX_ATTEMPTS'>;
  logger: Logger;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Cast keeps the default FastifyInstance type (pino's Logger is a superset of FastifyBaseLogger).
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    bodyLimit: 1_048_576,
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    void reply.code(status).send({ error: status >= 500 ? 'internal error' : err.message });
  });

  await app.register(async (scope) => healthRoutes(scope, deps));
  await app.register(async (scope) => apiRoutes(scope, deps));
  await app.register(async (scope) => dashboardRoutes(scope, deps));
  return app;
}
