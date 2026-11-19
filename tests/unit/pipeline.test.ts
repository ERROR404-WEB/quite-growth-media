import { describe, expect, it } from 'vitest';
import { ScriptValidationError } from '../../src/ai/script-writer.js';
import { getBrand } from '../../src/brands/index.js';
import { brandConfigSchema } from '../../src/brands/types.js';
import { parseEnv } from '../../src/config/env.js';
import { NonRetryableJobError } from '../../src/jobs/types.js';
import { addDays, zonedTimeToUtc } from '../../src/jobs/time.js';
import { qaCheckType, slotPublishAt } from '../../src/pipeline/render.js';
import { narrationHash } from '../../src/pipeline/script.js';
import { withFeedback } from '../../src/pipeline/storyboard.js';

const BASE_ENV = { ADMIN_API_TOKEN: 'x'.repeat(30), DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('time zones and dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => addDays('tomorrow', 1)).toThrow(/Invalid date/);
  });

  it('converts local publish times to UTC (IST has no DST)', () => {
    expect(zonedTimeToUtc('2026-11-20', '08:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-20T02:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-20', '20:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-20T14:30:00.000Z',
    );
  });

  it('follows New York daylight saving time, including skipped and repeated hours', () => {
    expect(zonedTimeToUtc('2026-07-01', '08:00', 'America/New_York').toISOString()).toBe(
      '2026-07-01T12:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-12-01', '08:00', 'America/New_York').toISOString()).toBe(
      '2026-12-01T13:00:00.000Z',
    );
    // 02:30 does not exist on 8 Mar 2026 → 03:30 EDT.
    expect(zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // 01:30 happens twice on 1 Nov 2026 → the first one (EDT).
    expect(zonedTimeToUtc('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    // East of UTC: Berlin's repeated 02:30 on 25 Oct 2026 → the first one (CEST).
    expect(zonedTimeToUtc('2026-10-25', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('schedules each brand slot at its local publish time', () => {
    const qg = getBrand('quiet-growth')!;
    const bb = getBrand('behtar-bano')!;
    expect(qg.contentSlots.map((s) => s.publishTime)).toEqual(['08:00', '13:00', '20:00']);
    expect(slotPublishAt(qg, '2026-12-01', 2).toISOString()).toBe('2026-12-01T18:00:00.000Z');
    expect(slotPublishAt(bb, '2026-12-01', 3).toISOString()).toBe('2026-12-01T14:30:00.000Z');
    expect(() => slotPublishAt(qg, '2026-12-01', 9)).toThrow(NonRetryableJobError);
  });
});

describe('brand slot publish times', () => {
  it('requires a valid, unique HH:MM per slot', () => {
    const qg = getBrand('quiet-growth')!;
    const bad = { ...qg, contentSlots: qg.contentSlots.map((s) => ({ ...s, publishTime: '8am' })) };
    expect(brandConfigSchema.safeParse(bad).success).toBe(false);
    const same = { ...qg, contentSlots: qg.contentSlots.map((s) => ({ ...s, publishTime: '09:00' })) };
    const res = brandConfigSchema.safeParse(same);
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toMatch(/publish times must be unique/);
    expect(brandConfigSchema.safeParse(qg).success).toBe(true);
  });
});

describe('automation settings', () => {
  it('defaults to the three self-improvement brands, a day ahead, capped, final renders, no publishing', () => {
    const env = parseEnv(BASE_ENV);
    expect(env.AUTOMATION_BRANDS).toEqual(['quiet-growth', 'behtar-bano', 'ninnu-nuvvu-geluvu']);
    expect(env.SCHEDULE_LEAD_DAYS).toBe(1);
    expect(env.DAILY_MAX_USD).toBe(3);
    expect(env.PIPELINE_RENDER_MODE).toBe('final');
    expect(env.PUBLISHING_ENABLED).toBe(false);
  });

  it('accepts "all", trims lists and rejects bad values', () => {
    expect(parseEnv({ ...BASE_ENV, AUTOMATION_BRANDS: 'ALL' }).AUTOMATION_BRANDS).toEqual(['all']);
    expect(parseEnv({ ...BASE_ENV, AUTOMATION_BRANDS: ' quiet-growth , ' }).AUTOMATION_BRANDS).toEqual([
      'quiet-growth',
    ]);
    expect(parseEnv({ ...BASE_ENV, PUBLISHING_ENABLED: 'true' }).PUBLISHING_ENABLED).toBe(true);
    expect(() => parseEnv({ ...BASE_ENV, AUTOMATION_BRANDS: 'Quiet Growth' })).toThrow(/AUTOMATION_BRANDS/);
    expect(() => parseEnv({ ...BASE_ENV, PIPELINE_RENDER_MODE: 'draft' })).toThrow(/PIPELINE_RENDER_MODE/);
    expect(() => parseEnv({ ...BASE_ENV, DAILY_MAX_USD: '0' })).toThrow(/DAILY_MAX_USD/);
  });
});

describe('pipeline helpers', () => {
  it('treats wording that differs only in case, punctuation or spacing as a duplicate', () => {
    const script = (lines: string[]) => ({
      brandId: 'quiet-growth',
      title: 't',
      contentCategory: 'mindset_growth',
      language: 'en' as const,
      scenes: lines.map((narration) => ({ narration, visual: 'v' })),
    });
    const a = narrationHash(script(["You're not lazy.", 'Rest is how you come back!']));
    expect(narrationHash(script(['youre not  lazy', 'rest is how you come back']))).toBe(a);
    expect(narrationHash(script(["You're not lazy.", 'Rest is how you return.']))).not.toBe(a);
  });

  it('maps QA checks to compliance check types', () => {
    expect(qaCheckType('audio_rights')).toBe('licence');
    expect(qaCheckType('audio_present')).toBe('audio');
    expect(qaCheckType('duration_target')).toBe('brand_relevance');
    expect(qaCheckType('resolution')).toBe('video_integrity');
  });

  it('regenerates with feedback, then quarantines after the bounded attempts', async () => {
    const seen: (string[] | undefined)[] = [];
    const ok = await withFeedback(async (feedback) => {
      seen.push(feedback);
      if (seen.length < 2) throw new ScriptValidationError(['too long']);
      return 'done';
    });
    expect(ok).toBe('done');
    expect(seen).toEqual([undefined, ['too long']]);

    let calls = 0;
    const err = await withFeedback(async () => {
      calls++;
      throw new ScriptValidationError(['still too long']);
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableJobError);
    expect(calls).toBe(3);

    // Network errors stay retryable for the worker's backoff.
    await expect(
      withFeedback(async () => {
        throw new Error('ECONNRESET');
      }),
    ).rejects.not.toBeInstanceOf(NonRetryableJobError);
  });
});
