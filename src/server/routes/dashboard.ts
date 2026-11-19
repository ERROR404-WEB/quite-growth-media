import type { FastifyInstance } from 'fastify';
import { JOB_STATUSES } from '../../domain/constants.js';
import type { AppDeps } from '../app.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface BrandRow {
  id: string;
  brand_number: number;
  display_name: string;
  native_name: string | null;
  language: string;
  niche: string;
  daily_video_target: number;
  made_for_kids: boolean;
  is_active: boolean;
}

export async function dashboardRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/', async (_req, reply) => {
    const brands = (await deps.db.query<BrandRow>('SELECT * FROM brands ORDER BY brand_number')).rows;
    const counts = (
      await deps.db.query<{ brand_id: string | null; status: string; count: number }>(
        'SELECT brand_id, status, count(*)::int AS count FROM generation_jobs GROUP BY 1, 2',
      )
    ).rows;
    const quarantined = (
      await deps.db.query<{
        id: string;
        brand_id: string | null;
        job_type: string;
        last_error: string | null;
      }>(
        `SELECT id, brand_id, job_type, last_error FROM generation_jobs
          WHERE status = 'quarantined' ORDER BY updated_at DESC LIMIT 20`,
      )
    ).rows;

    const pubCounts = (
      await deps.db.query<{ status: string; count: number }>(
        'SELECT status, count(*)::int AS count FROM publications GROUP BY 1 ORDER BY 1',
      )
    ).rows;
    const upcoming = (
      await deps.db.query<{
        brand_id: string;
        platform: string;
        status: string;
        scheduled_for: Date | null;
        title: string | null;
        last_error: string | null;
      }>(
        `SELECT p.brand_id, p.platform, p.status, p.scheduled_for, v.title, p.last_error
           FROM publications p JOIN videos v ON v.id = p.video_id
          WHERE p.status <> 'published' OR p.published_at > now() - interval '1 day'
          ORDER BY p.scheduled_for NULLS LAST LIMIT 30`,
      )
    ).rows;
    const videoCount = (
      await deps.db.query<{ rendered: number; passed: number }>(
        `SELECT count(*)::int AS rendered, count(*) FILTER (WHERE qa_status = 'passed')::int AS passed FROM videos`,
      )
    ).rows[0] ?? { rendered: 0, passed: 0 };
    const spentToday = (
      await deps.db.query<{ total: string | null }>(
        `SELECT sum(amount) AS total FROM cost_records WHERE incurred_at >= date_trunc('day', now() AT TIME ZONE $1::text) AT TIME ZONE $1::text`,
        [deps.env.APP_TIMEZONE],
      )
    ).rows[0]?.total;

    const countFor = (brandId: string, status: string) =>
      counts.find((c) => c.brand_id === brandId && c.status === status)?.count ?? 0;
    const dailyTotal = brands.filter((b) => b.is_active).reduce((sum, b) => sum + b.daily_video_target, 0);

    const brandRows = brands
      .map(
        (b) => `<tr>
          <td>${b.brand_number}</td>
          <td><strong>${escapeHtml(b.display_name)}</strong>${b.native_name ? `<br><small>${escapeHtml(b.native_name)}</small>` : ''}</td>
          <td>${escapeHtml(b.language)}</td>
          <td>${escapeHtml(b.niche)}${b.made_for_kids ? ' <span class="tag">kids</span>' : ''}</td>
          <td>${b.daily_video_target}</td>
          ${JOB_STATUSES.map((s) => `<td class="num s-${s}">${countFor(b.id, s)}</td>`).join('')}
        </tr>`,
      )
      .join('');

    const quarantineRows = quarantined.length
      ? quarantined
          .map(
            (j) =>
              `<tr><td><code>${escapeHtml(j.id)}</code></td><td>${escapeHtml(j.brand_id)}</td><td>${escapeHtml(j.job_type)}</td><td>${escapeHtml(j.last_error)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">No quarantined jobs.</td></tr>';

    const publicationRows = upcoming.length
      ? upcoming
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.scheduled_for?.toISOString().replace('T', ' ').slice(0, 16) ?? '')} UTC</td><td>${escapeHtml(p.brand_id)}</td><td>${escapeHtml(p.platform)}</td><td>${escapeHtml(p.title)}</td><td class="p-${escapeHtml(p.status)}">${escapeHtml(p.status)}</td><td>${escapeHtml(p.last_error)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="6">No publications yet.</td></tr>';
    const pubSummary = pubCounts.map((c) => `${escapeHtml(c.status)}: ${c.count}`).join(' · ') || 'none';

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="30">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quiet Growth Media Network - Control Room</title>
<style>
  body{font-family:system-ui,'Segoe UI',sans-serif;margin:2rem;color:#1f2933;background:#f7f7f5}
  h1{margin-bottom:.2rem} .muted{color:#6b7280}
  .cards{display:flex;gap:1rem;margin:1.5rem 0;flex-wrap:wrap}
  .card{background:#fff;border-radius:10px;padding:1rem 1.4rem;box-shadow:0 1px 3px #0001;min-width:150px}
  .card b{font-size:1.6rem;display:block}
  table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px #0001;margin-bottom:2rem}
  th,td{padding:.55rem .7rem;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
  th{background:#2f3e46;color:#fff;font-weight:600} .num{text-align:right}
  .s-quarantined{color:#b91c1c;font-weight:600} .s-succeeded{color:#15803d}
  .tag{background:#ffd166;border-radius:4px;padding:0 .35rem;font-size:.75rem}
  .p-published{color:#15803d} .p-failed,.p-needs_check,.p-skipped{color:#b91c1c;font-weight:600}
</style></head>
<body>
<h1>Quiet Growth Media Network</h1>
<div class="muted">Control room - auto-refreshes every 30s. Daily pipeline: plan → storyboard → script → render → publish.</div>
<div class="cards">
  <div class="card"><b>${brands.length}</b>brands</div>
  <div class="card"><b>${dailyTotal}</b>videos / day target</div>
  <div class="card"><b>${dailyTotal * 4}</b>publishing actions / day (max)</div>
  <div class="card"><b>${quarantined.length}</b>quarantined jobs</div>
  <div class="card"><b>${videoCount.passed}/${videoCount.rendered}</b>videos passed QA</div>
  <div class="card"><b>$${Number(spentToday ?? 0).toFixed(2)}</b>AI spend today</div>
</div>
<h2>Brands &amp; job pipeline</h2>
<table><thead><tr><th>#</th><th>Brand</th><th>Lang</th><th>Niche</th><th>Daily</th>
${JOB_STATUSES.map((s) => `<th class="num">${s}</th>`).join('')}</tr></thead>
<tbody>${brandRows}</tbody></table>
<h2>Quarantine</h2>
<table><thead><tr><th>Job</th><th>Brand</th><th>Type</th><th>Last error</th></tr></thead>
<tbody>${quarantineRows}</tbody></table>
<h2>Publishing</h2>
<div class="muted">Publications: ${pubSummary}</div>
<table><thead><tr><th>Scheduled</th><th>Brand</th><th>Platform</th><th>Video</th><th>Status</th><th>Last error</th></tr></thead>
<tbody>${publicationRows}</tbody></table>
<p class="muted">API: <a href="/health/ready">/health/ready</a> · <a href="/api/brands">/api/brands</a> ·
<a href="/api/jobs">/api/jobs</a> · <a href="/api/jobs/summary">/api/jobs/summary</a> ·
<a href="/api/videos">/api/videos</a> · <a href="/api/publications">/api/publications</a></p>
</body></html>`;
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
