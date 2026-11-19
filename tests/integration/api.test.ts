import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/pool.js';
import { todayIn } from '../../src/jobs/schedule.js';
import { addDays } from '../../src/jobs/time.js';
import { createLogger } from '../../src/logger.js';
import { buildApp } from '../../src/server/app.js';
import { createFreshTestDb, testDatabaseUrl } from '../helpers/db.js';

const TOKEN = 't'.repeat(40);

describe.skipIf(!testDatabaseUrl())('HTTP API (integration)', () => {
  let db: Db;
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${TOKEN}` };

  beforeAll(async () => {
    db = await createFreshTestDb();
    app = await buildApp({
      db,
      logger: createLogger('silent'),
      env: { ADMIN_API_TOKEN: TOKEN, APP_TIMEZONE: 'Asia/Kolkata', JOB_MAX_ATTEMPTS: 3 },
    });
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  it('reports liveness and readiness', async () => {
    expect((await app.inject('/health')).statusCode).toBe(200);
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.brands.detail).toBe('9 active');
  });

  it('lists the nine brands', async () => {
    const res = await app.inject('/api/brands');
    expect(res.json().brands).toHaveLength(9);
  });

  it('rejects scheduling without a valid token, before parsing the body', async () => {
    const none = await app.inject({ method: 'POST', url: '/api/schedule/daily', payload: {} });
    expect(none.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/schedule/daily',
      headers: { authorization: 'Bearer nope' },
      payload: 'not json',
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('schedules 27 independent jobs per day, idempotently', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/schedule/daily',
      headers: auth,
      payload: { date: '2030-01-01' },
    });
    expect(first.json()).toEqual({ date: '2030-01-01', brands: 9, created: 27, existing: 0 });
    const again = await app.inject({
      method: 'POST',
      url: '/api/schedule/daily',
      headers: auth,
      payload: { date: '2030-01-01' },
    });
    expect(again.json()).toMatchObject({ created: 0, existing: 27 });
    const jobs = await app.inject('/api/jobs?status=queued&limit=100');
    const list = jobs.json().jobs as { brand_id: string }[];
    expect(list).toHaveLength(27);
    expect(new Set(list.map((j) => j.brand_id)).size).toBe(9);
  });

  it('limits the daily plan to the automation brands and plans ahead by default', async () => {
    const pilot = await buildApp({
      db,
      logger: createLogger('silent'),
      env: {
        ADMIN_API_TOKEN: TOKEN,
        APP_TIMEZONE: 'Asia/Kolkata',
        JOB_MAX_ATTEMPTS: 3,
        AUTOMATION_BRANDS: ['quiet-growth', 'behtar-bano'],
        SCHEDULE_LEAD_DAYS: 1,
      },
    });
    try {
      const res = await pilot.inject({
        method: 'POST',
        url: '/api/schedule/daily',
        headers: auth,
        payload: {},
      });
      expect(res.json()).toEqual({
        date: addDays(todayIn('Asia/Kolkata'), 1),
        brands: 2,
        created: 6,
        existing: 0,
      });
    } finally {
      await pilot.close();
    }
  });

  it('does not publish until publishing is enabled, and lists videos and publications', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/publish/due' })).statusCode).toBe(401);
    const due = await app.inject({ method: 'POST', url: '/api/publish/due', headers: auth });
    expect(due.json()).toMatchObject({ enabled: false, enqueued: 0 });
    expect((await app.inject('/api/videos')).json()).toEqual({ videos: [] });
    expect((await app.inject('/api/publications?status=needs_check')).json()).toEqual({ publications: [] });
    expect((await app.inject('/api/publications?status=bogus')).statusCode).toBe(400);
    const retry = await app.inject({
      method: 'POST',
      url: '/api/publications/00000000-0000-4000-8000-000000000000/retry',
      headers: auth,
    });
    expect(retry.statusCode).toBe(409);
  });

  it('validates input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/schedule/daily',
      headers: auth,
      payload: { date: 'soon' },
    });
    expect(res.statusCode).toBe(400);
    expect((await app.inject('/api/jobs?status=bogus')).statusCode).toBe(400);
    const requeue = await app.inject({ method: 'POST', url: '/api/jobs/not-a-uuid/requeue', headers: auth });
    expect(requeue.statusCode).toBe(400);
  });

  it('renders the dashboard with escaped content', async () => {
    const res = await app.inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Quiet Growth Media Network');
    expect(res.body).toContain('చిన్ని లోకం');
  });
});

describe.skipIf(!testDatabaseUrl())('schema constraints (integration)', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createFreshTestDb();
  });
  afterAll(async () => {
    await db?.end();
  });

  it('creates all 17 domain tables', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      [
        'analytics',
        'asset_licences',
        'assets',
        'audio_library_assets',
        'audio_library_usages',
        'brands',
        'compliance_results',
        'content_ideas',
        'cost_records',
        'experiments',
        'generation_jobs',
        'publications',
        'revenue_records',
        'scripts',
        'social_accounts',
        'video_scenes',
        'videos',
      ].sort(),
    );
  });

  it('seeds 36 social destinations (not connected)', async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM social_accounts WHERE status = 'not_connected'`,
    );
    expect(rows[0].n).toBe(36);
  });

  it('refuses a kids brand without an age range', async () => {
    await expect(
      db.query(
        `INSERT INTO brands (id, brand_number, display_name, language, locale, audience, niche, made_for_kids, publish_timezone)
         VALUES ('bad-kids', 50, 'Bad', 'en', 'en-US', 'kids', 'kids', true, 'UTC')`,
      ),
    ).rejects.toThrow(/brands_kids_need_age_range/);
  });

  it('stores one video per platform version and tracks unclear publications', async () => {
    const { rows } = await db.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('publications_status_check', 'videos_script_variant_unique', 'videos_script_unique')`,
    );
    const defs = Object.fromEntries(rows.map((r) => [r.conname, r.def]));
    expect(defs.publications_status_check).toContain('needs_check');
    expect(defs.videos_script_variant_unique).toBe('UNIQUE (script_id, variant)');
    expect(defs.videos_script_unique).toBeUndefined();
  });

  it('refuses rows for unknown brands', async () => {
    await expect(
      db.query(
        `INSERT INTO cost_records (brand_id, category, provider, amount) VALUES ('nope', 'script', 'openai', 0.01)`,
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
