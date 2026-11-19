import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JOB_STATUSES, PUBLICATION_STATUSES } from '../../domain/constants.js';
import { requeueQuarantined } from '../../jobs/queue.js';
import { scheduleDaily, todayIn } from '../../jobs/schedule.js';
import { addDays } from '../../jobs/time.js';
import { enqueueDuePublications, retryPublication } from '../../pipeline/publish.js';
import type { AppDeps } from '../app.js';
import { requireAdmin } from '../auth.js';

const listJobsQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  brandId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const scheduleBody = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
      .optional(),
  })
  .default({});

const idParams = z.object({ id: z.uuid() });

const listVideosQuery = z.object({
  brandId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const listPublicationsQuery = z.object({
  status: z.enum(PUBLICATION_STATUSES).optional(),
  brandId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export async function apiRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const admin = requireAdmin(deps.env.ADMIN_API_TOKEN);

  app.get('/api/brands', async () => {
    const { rows } = await deps.db.query(
      `SELECT b.id, b.brand_number, b.display_name, b.native_name, b.language, b.locale, b.audience, b.niche,
              b.age_min, b.age_max, b.made_for_kids, b.daily_video_target, b.publish_timezone, b.is_active,
              count(s.id) FILTER (WHERE s.status = 'connected')::int AS connected_accounts
         FROM brands b LEFT JOIN social_accounts s ON s.brand_id = b.id
        GROUP BY b.id ORDER BY b.brand_number`,
    );
    return { brands: rows };
  });

  app.get<{ Params: { id: string } }>('/api/brands/:id', async (req, reply) => {
    const { rows } = await deps.db.query('SELECT * FROM brands WHERE id = $1', [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'brand not found' });
    return rows[0];
  });

  app.get('/api/jobs', async (req, reply) => {
    const parsed = listJobsQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    const { status, brandId, limit } = parsed.data;
    const { rows } = await deps.db.query(
      `SELECT id, brand_id, job_type, idempotency_key, status, attempts, max_attempts, run_at, last_error,
              created_at, finished_at
         FROM generation_jobs
        WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR brand_id = $2)
        ORDER BY created_at DESC LIMIT $3`,
      [status ?? null, brandId ?? null, limit],
    );
    return { jobs: rows };
  });

  app.get('/api/jobs/summary', async () => {
    const { rows } = await deps.db.query(
      `SELECT brand_id, status, count(*)::int AS count FROM generation_jobs GROUP BY brand_id, status ORDER BY 1, 2`,
    );
    return { summary: rows };
  });

  app.post('/api/schedule/daily', { onRequest: admin }, async (req, reply) => {
    const parsed = scheduleBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    const date =
      parsed.data.date ?? addDays(todayIn(deps.env.APP_TIMEZONE), deps.env.SCHEDULE_LEAD_DAYS ?? 0);
    const result = await scheduleDaily(deps.db, date, deps.env.JOB_MAX_ATTEMPTS, deps.env.AUTOMATION_BRANDS);
    req.log.info(result, 'daily schedule requested');
    return result;
  });

  app.post('/api/publish/due', { onRequest: admin }, async (req) => {
    const publishing = deps.publishing ?? { enabled: false, reason: 'publishing is not configured' };
    if (!publishing.enabled) return { enabled: false, reason: publishing.reason, enqueued: 0 };
    const result = await enqueueDuePublications(deps.db, new Date());
    req.log.info(result, 'due publications enqueued');
    return { enabled: true, ...result };
  });

  app.get('/api/videos', async (req, reply) => {
    const parsed = listVideosQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    const { brandId, limit } = parsed.data;
    const { rows } = await deps.db.query(
      `SELECT v.id, v.brand_id, v.variant, v.platforms, v.title, v.duration_sec, v.duration_bucket, v.render_status,
              v.qa_status, v.storage_uri, v.created_at, to_char(i.planned_for, 'YYYY-MM-DD') AS planned_for, i.slot
         FROM videos v JOIN content_ideas i ON i.id = v.content_idea_id
        WHERE ($1::text IS NULL OR v.brand_id = $1)
        ORDER BY v.created_at DESC LIMIT $2`,
      [brandId ?? null, limit],
    );
    return { videos: rows };
  });

  app.get('/api/publications', async (req, reply) => {
    const parsed = listPublicationsQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    const { status, brandId, limit } = parsed.data;
    const { rows } = await deps.db.query(
      `SELECT id, brand_id, video_id, platform, status, scheduled_for, published_at, external_url, attempts,
              last_error, updated_at
         FROM publications
        WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR brand_id = $2)
        ORDER BY scheduled_for DESC NULLS LAST LIMIT $3`,
      [status ?? null, brandId ?? null, limit],
    );
    return { publications: rows };
  });

  app.post('/api/publications/:id/retry', { onRequest: admin }, async (req, reply) => {
    const parsed = idParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid publication id' });
    const ok = await retryPublication(deps.db, parsed.data.id);
    if (!ok)
      return reply.code(409).send({ error: 'publication not found or not failed/needs_check/skipped' });
    return { status: 'scheduled' };
  });

  app.post('/api/jobs/:id/requeue', { onRequest: admin }, async (req, reply) => {
    const parsed = idParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid job id' });
    const ok = await requeueQuarantined(deps.db, parsed.data.id);
    if (!ok) return reply.code(409).send({ error: 'job not found or not quarantined' });
    return { status: 'queued' };
  });
}
