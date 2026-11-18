import type { FastifyInstance } from 'fastify';
import { migrationStatus } from '../../db/migrate.js';
import type { AppDeps } from '../app.js';

export async function healthRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', uptimeSec: Math.round(process.uptime()) }));

  app.get('/health/ready', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    try {
      await deps.db.query('SELECT 1');
      checks.database = { ok: true };
      const status = await migrationStatus(deps.db);
      checks.migrations = status.pending.length
        ? { ok: false, detail: `pending: ${status.pending.join(', ')}` }
        : { ok: true, detail: `${status.applied.length} applied` };
      const { rows } = await deps.db.query<{ count: string }>('SELECT count(*) FROM brands WHERE is_active');
      const brands = Number(rows[0]?.count ?? 0);
      checks.brands =
        brands > 0 ? { ok: true, detail: `${brands} active` } : { ok: false, detail: 'run npm run db:seed' };
    } catch (err) {
      checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    const ready = Object.values(checks).every((c) => c.ok);
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });
}
