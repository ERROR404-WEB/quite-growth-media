import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { loadMigrations } from '../../src/db/migrate.js';
import { durationBucketFor } from '../../src/domain/constants.js';
import { backoffMs } from '../../src/jobs/queue.js';
import { contentPlanKey, todayIn } from '../../src/jobs/schedule.js';
import { escapeHtml } from '../../src/server/routes/dashboard.js';

describe('durationBucketFor', () => {
  it.each([
    [7, '7-12'],
    [12.4, '7-12'],
    [13, '13-20'],
    [30, '21-30'],
    [45, '31-45'],
  ])('%s s -> %s', (sec, bucket) => expect(durationBucketFor(sec)).toBe(bucket));

  it.each([6, 46, Number.NaN])('returns null for %s', (sec) => expect(durationBucketFor(sec)).toBeNull());
});

describe('backoffMs', () => {
  it('doubles per attempt and is capped', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(50)).toBe(30 * 60_000);
  });
});

describe('scheduling helpers', () => {
  it('formats today in the requested timezone', () => {
    const instant = new Date('2026-01-01T20:00:00Z');
    expect(todayIn('Asia/Kolkata', instant)).toBe('2026-01-02');
    expect(todayIn('America/New_York', instant)).toBe('2026-01-01');
  });

  it('builds deterministic idempotency keys', () => {
    expect(contentPlanKey('quiet-growth', '2026-01-02', 1)).toBe(
      'content.plan:quiet-growth:2026-01-02:slot-1',
    );
  });
});

describe('parseEnv', () => {
  const base = {
    ADMIN_API_TOKEN: 'x'.repeat(32),
    POSTGRES_PASSWORD: 'secret',
    DATABASE_URL: 'postgres://qgm:${POSTGRES_PASSWORD}@127.0.0.1:5433/qgm',
  };

  it('expands ${VAR} references and applies defaults', () => {
    const env = parseEnv(base);
    expect(env.DATABASE_URL).toBe('postgres://qgm:secret@127.0.0.1:5433/qgm');
    expect(env.PORT).toBe(3000);
    expect(env.JOB_WORKER_ENABLED).toBe(true);
  });

  it('rejects a weak admin token', () => {
    expect(() => parseEnv({ ...base, ADMIN_API_TOKEN: 'short' })).toThrow(/ADMIN_API_TOKEN/);
  });

  it('rejects unresolved placeholders', () => {
    expect(() => parseEnv({ ...base, POSTGRES_PASSWORD: undefined })).toThrow(/placeholder/);
  });
});

describe('migrations', () => {
  it('are well-named, ordered and unique', async () => {
    const files = await loadMigrations();
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]?.version).toBe('0001');
    expect(files.map((f) => f.version)).toEqual([...files.map((f) => f.version)].sort());
  });
});

describe('escapeHtml', () => {
  it('escapes markup', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });
});
