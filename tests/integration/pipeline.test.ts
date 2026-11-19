import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/ai/http-client.js';
import type { GeneratedScript, Storyboard } from '../../src/ai/script-writer.js';
import { getBrand } from '../../src/brands/index.js';
import type { Db } from '../../src/db/pool.js';
import type { Language } from '../../src/domain/constants.js';
import { JOB_TYPES } from '../../src/domain/constants.js';
import { enqueue } from '../../src/jobs/queue.js';
import { contentPlanKey, todayIn } from '../../src/jobs/schedule.js';
import { addDays } from '../../src/jobs/time.js';
import { JobWorker } from '../../src/jobs/worker.js';
import { createLogger } from '../../src/logger.js';
import { ffmpegAvailable, mediaDuration, resolveFfmpeg, run } from '../../src/media/ffmpeg.js';
import { PlaceholderIllustrator } from '../../src/media/illustrator.js';
import type { NarrationClip, VoiceProvider } from '../../src/media/voice.js';
import type { PipelineContext, PipelineProviders } from '../../src/pipeline/index.js';
import { registerPipeline } from '../../src/pipeline/index.js';
import { enqueueDuePublications, retryPublication } from '../../src/pipeline/publish.js';
import { slotPublishAt } from '../../src/pipeline/render.js';
import { BlotatoClient } from '../../src/publishing/blotato.js';
import { linkBlotatoAccount } from '../../src/publishing/accounts.js';
import { createFreshTestDb, testDatabaseUrl } from '../helpers/db.js';

const tools = resolveFfmpeg();
const hasFfmpeg = ffmpegAvailable(tools);
const TZ = 'Asia/Kolkata';
const brand = getBrand('quiet-growth')!;

/** Test double named like the production voice so the publishing gate treats it as the brand voice. */
class ToneVoice implements VoiceProvider {
  readonly name = 'elevenlabs (test double)';
  supports(): boolean {
    return true;
  }
  async synthesize(_text: string, _language: Language, outFile: string): Promise<NarrationClip> {
    await run(tools.ffmpeg, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=1.6',
      '-y',
      outFile,
    ]);
    return { file: outFile, durationSec: await mediaDuration(outFile, tools), costUsd: 0.002 };
  }
}

const beats = ['hook', 'message', 'message', 'message', 'metaphor', 'conclusion'] as const;
const shots = [
  'close_up_portrait',
  'indoor_reflection',
  'two_people',
  'night_urban',
  'vast_landscape',
  'close_up_portrait',
] as const;
const palettes = ['contemplative', 'contemplative', 'intimate', 'night', 'peaceful', 'peaceful'] as const;
const narration = [
  "You're not lazy. You're exhausted from pretending.",
  "It's not about doing more. It's about carrying less.",
  "It's not about being stronger. It's about being honest.",
  'The moment you stop performing, you start recovering.',
  'Even the ocean pulls back before the next wave rises.',
  "Rest isn't quitting. It's how you come back.",
];

const idea = {
  coreMessage: 'What looks like laziness is often exhaustion from pretending to be fine.',
  identitySignal: 'I understand myself',
  permissionGiven: 'Removes guilt about resting',
  emotionalArc: { start: 'shame', mid: 'recognition', peak: 'relief', landing: 'quiet pride' },
  targetAudience: 'Burnt-out young adults',
  shareTrigger: 'Sending it to a tired friend',
  parallelPattern: 'A_repetitive_opener' as const,
  loopLink: 'Coming back loops to the hook.',
};

const storyboard: Storyboard = {
  title: 'Rest is how you come back',
  idea,
  characterDescription: 'A young woman with dark wavy hair and a mustard cardigan.',
  soundDesign: { music: 'none', ambience: 'none' },
  lines: beats.map((beat, i) => ({
    beat,
    intent: `Meaning of line ${i + 1}`,
    delivery: 'soft, steady',
    visual: `Shared image ${i + 1}: rooftop at dusk`,
    shot: shots[i]!,
    palette: palettes[i]!,
    camera: 'zoom-in' as const,
    sfx: 'none' as const,
  })),
};

function fakeScript(sb: Storyboard, title: string): GeneratedScript {
  return {
    script: {
      brandId: brand.id,
      title,
      contentCategory: 'mindset_growth',
      language: 'en',
      scenes: sb.lines.map((l, i) => ({
        narration: `${narration[i]} (${title})`,
        visual: l.visual,
        beat: l.beat,
        shot: l.shot,
        palette: l.palette,
        camera: l.camera,
        sfx: l.sfx,
        delivery: l.delivery,
        pause: i === 0 ? 'beat' : 'none',
      })),
    },
    idea: {
      ...idea,
      quotes: { strongest: narration[1]!, screenshot: narration[4]!, share: narration[5]! },
      hookScore: 9,
      quotabilityScore: 9,
    },
    centralIdea: idea.coreMessage,
    deliveryStyle: 'intimate',
    characterDescription: sb.characterDescription,
    soundDesign: sb.soundDesign,
    metadata: {
      youtubeTitle: "You're not lazy",
      shortDescription: 'A reminder that rest is how you come back.',
      captions: {
        instagram: 'Even the ocean pulls back.',
        facebook: "You're not lazy.",
        youtube: "Rest isn't quitting.",
        x: "Rest isn't quitting. It's how you come back.",
      },
      hashtags: ['#rest', '#quietgrowth'],
      keywords: ['rest'],
    },
    safetyNotes: 'none',
    model: 'fake',
    usage: { input: 1, cachedInput: 0, output: 1 },
    costUsd: 0.01,
    estimatedDurationSec: 20,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Blotato double: counts uploads/posts; `postFails` makes create-post lose its reply for a platform. */
function blotatoDouble(postFails: Set<string>) {
  const calls = { uploads: 0, posts: [] as string[] };
  const fetch: FetchLike = async (url, init) => {
    if (url.endsWith('/media/uploads')) {
      calls.uploads++;
      return json({ presignedUrl: 'https://upload.test/put', publicUrl: 'https://cdn.test/video.mp4' });
    }
    if (url === 'https://upload.test/put') return new Response(null, { status: 200 });
    if (url.endsWith('/posts') && init.method === 'POST') {
      const platform = JSON.parse(String(init.body)).post.content.platform as string;
      calls.posts.push(platform);
      if (postFails.has(platform)) throw new TypeError('socket hang up');
      return json({ postSubmissionId: `sub-${platform}` });
    }
    const m = /\/posts\/sub-([a-z]+)$/.exec(url);
    if (m) return json({ status: 'published', publicUrl: `https://${m[1]}.test/post` });
    throw new Error(`unexpected request ${init.method} ${url}`);
  };
  return { calls, client: () => new BlotatoClient({ apiKey: 'k', fetch, sleep: async () => undefined }) };
}

describe.skipIf(!testDatabaseUrl() || !hasFfmpeg)('daily pipeline (integration, needs FFmpeg)', () => {
  let db: Db;
  let dir: string;
  let ctx: PipelineContext;
  let worker: JobWorker;
  const date = addDays(todayIn(TZ), 1);
  const failing = new Set<string>();
  let blotato = blotatoDouble(failing);

  const drain = async () => {
    for (let i = 0; i < 40 && (await worker.tick()); i++);
  };
  const job = async (type: string) =>
    (
      await db.query<{ status: string; attempts: number; last_error: string | null; run_at: Date }>(
        'SELECT status, attempts, last_error, run_at FROM generation_jobs WHERE job_type = $1 ORDER BY created_at DESC LIMIT 1',
        [type],
      )
    ).rows[0];

  beforeAll(async () => {
    db = await createFreshTestDb();
    dir = mkdtempSync(join(tmpdir(), 'qgm-pipeline-'));
    let titles = 0;
    const providers: PipelineProviders = {
      textModel: 'fake',
      imageConcurrency: 2,
      caps: { storyboardUsd: 2, scriptUsd: 0.5, voiceUsd: 0.5 },
      generateStoryboard: async (_req, budget) => {
        budget.record('script', 'fake', 0.02);
        return storyboard;
      },
      generateScript: async (req, budget) => {
        budget.record('script', 'fake', 0.01);
        expect(req.storyboard?.title).toBe(storyboard.title);
        return fakeScript(req.storyboard!, `Take ${++titles}`);
      },
      illustrator: (budget) => {
        const art = new PlaceholderIllustrator();
        return {
          name: 'openai (test double)',
          generate: async (req) => {
            budget.record('illustration', 'fake', 0.01);
            return art.generate({ ...req, width: 216, height: 384 });
          },
        };
      },
      selectVoice: async () => ({
        voice: new ToneVoice(),
        temporary: false,
        voiceId: 'v1',
        commercial: true,
      }),
      blotato: () => blotato.client(),
      tools,
      publishStatusChecks: 2,
      renderOverrides: { width: 360, height: 640, preset: 'ultrafast' },
    };
    ctx = {
      db,
      logger: createLogger('silent'),
      settings: {
        dataDir: dir,
        timeZone: TZ,
        dailyMaxUsd: 3,
        renderMode: 'final',
        automationBrands: [brand.id],
        maxAttempts: 3,
        youtubePrivacy: 'private',
      },
      providers,
      now: () => new Date(),
    };
    worker = registerPipeline(
      new JobWorker(db, ctx.logger, { pollIntervalMs: 50, staleLockMinutes: 15 }),
      ctx,
    );
  });
  afterAll(async () => {
    await db?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('plans, writes, renders, stores and schedules a video for every platform', async () => {
    await enqueue(db, {
      jobType: JOB_TYPES.contentPlan,
      idempotencyKey: contentPlanKey(brand.id, date, 1),
      brandId: brand.id,
      payload: { brandId: brand.id, date, slot: 1, contentCategory: 'mindset_growth' },
    });
    await drain();

    const jobs = await db.query<{ job_type: string; status: string; last_error: string | null }>(
      'SELECT job_type, status, last_error FROM generation_jobs ORDER BY created_at',
    );
    expect(jobs.rows).toEqual([
      expect.objectContaining({ job_type: 'content.plan', status: 'succeeded' }),
      expect.objectContaining({ job_type: 'storyboard.generate', status: 'succeeded' }),
      expect.objectContaining({ job_type: 'script.generate', status: 'succeeded' }),
      expect.objectContaining({ job_type: 'video.render', status: 'succeeded' }),
    ]);

    const ideas = await db.query('SELECT status, title FROM content_ideas WHERE brand_id = $1', [brand.id]);
    expect(ideas.rows).toEqual([{ status: 'used', title: storyboard.title }]);
    const scripts = await db.query<{ id: string; status: string; content_hash: string }>(
      'SELECT id, status, content_hash FROM scripts',
    );
    expect(scripts.rows).toHaveLength(1);
    expect(scripts.rows[0]!.status).toBe('validated');
    const scenes = await db.query('SELECT count(*)::int AS n FROM video_scenes WHERE script_id = $1', [
      scripts.rows[0]!.id,
    ]);
    expect(scenes.rows[0].n).toBe(6);

    const videos = await db.query<{
      id: string;
      variant: string;
      platforms: string[];
      qa_status: string;
      storage_uri: string;
    }>('SELECT id, variant, platforms, qa_status, storage_uri FROM videos');
    expect(videos.rows).toEqual([
      expect.objectContaining({ variant: 'main', qa_status: 'passed', platforms: brand.platforms }),
    ]);
    expect(existsSync(join(dir, date, 'slot-1', brand.id, 'video.mp4'))).toBe(true);

    const pubs = await db.query<{ platform: string; status: string; scheduled_for: Date }>(
      'SELECT platform, status, scheduled_for FROM publications ORDER BY platform',
    );
    expect(pubs.rows.map((p) => p.platform)).toEqual([...brand.platforms].sort());
    for (const p of pubs.rows) {
      expect(p.status).toBe('scheduled');
      expect(p.scheduled_for.toISOString()).toBe(slotPublishAt(brand, date, 1).toISOString());
    }

    const checks = await db.query<{ entity_type: string; n: number }>(
      `SELECT entity_type, count(*)::int AS n FROM compliance_results GROUP BY 1 ORDER BY 1`,
    );
    expect(checks.rows.map((r) => r.entity_type)).toEqual(['script', 'video']);
    const assets = await db.query<{ kind: string }>('SELECT DISTINCT kind FROM assets ORDER BY kind');
    expect(assets.rows.map((r) => r.kind)).toEqual(['illustration', 'thumbnail', 'video', 'voiceover']);
    const costs = await db.query<{ category: string; total: string; unlinked: number }>(
      `SELECT category, sum(amount)::text AS total, count(*) FILTER (WHERE job_id IS NULL)::int AS unlinked
         FROM cost_records GROUP BY 1 ORDER BY 1`,
    );
    expect(costs.rows.map((r) => r.category)).toEqual(['illustration', 'script']);
    expect(costs.rows.every((r) => r.unlinked === 0)).toBe(true);

    // Re-running a finished step changes nothing (idempotent).
    await db.query(
      `UPDATE generation_jobs SET status = 'queued', attempts = 0 WHERE job_type = 'video.render'`,
    );
    await drain();
    expect((await db.query('SELECT count(*)::int AS n FROM videos')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM publications')).rows[0].n).toBe(4);
  }, 180_000);

  it('waits for the next day instead of spending past the daily cap', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO cost_records (brand_id, category, provider, amount) VALUES ($1, 'other', 'test', 10) RETURNING id`,
      [brand.id],
    );
    await enqueue(db, {
      jobType: JOB_TYPES.contentPlan,
      idempotencyKey: contentPlanKey(brand.id, date, 2),
      brandId: brand.id,
      payload: { brandId: brand.id, date, slot: 2, contentCategory: 'relationships_eq' },
    });
    await drain();
    const deferred = await job(JOB_TYPES.storyboardGenerate);
    expect(deferred).toMatchObject({ status: 'queued', attempts: 0 });
    expect(deferred!.last_error).toMatch(/Daily AI spend cap/);
    expect(deferred!.run_at.getTime()).toBeGreaterThan(Date.now());
    await db.query('DELETE FROM cost_records WHERE id = $1', [rows[0]!.id]);
    await db.query(`DELETE FROM generation_jobs WHERE idempotency_key LIKE '%:slot-2'`);
  });

  it('skips plans for dates that have already passed', async () => {
    const past = addDays(todayIn(TZ), -2);
    await enqueue(db, {
      jobType: JOB_TYPES.contentPlan,
      idempotencyKey: contentPlanKey(brand.id, past, 1),
      brandId: brand.id,
      payload: { brandId: brand.id, date: past, slot: 1, contentCategory: 'mindset_growth' },
    });
    await drain();
    expect(await job(JOB_TYPES.contentPlan)).toMatchObject({ status: 'succeeded' });
    expect((await db.query('SELECT count(*)::int AS n FROM content_ideas')).rows[0].n).toBe(1);
  });

  it('publishes due videos at most once and never resubmits an unclear post', async () => {
    await linkBlotatoAccount(db, { brandId: brand.id, platform: 'youtube', accountId: '13' });
    await linkBlotatoAccount(db, { brandId: brand.id, platform: 'instagram', accountId: '14' });
    expect(await enqueueDuePublications(db, new Date())).toEqual({
      due: 0,
      enqueued: 0,
      waitingForAccount: 0,
    });
    await db.query(`UPDATE publications SET scheduled_for = now() - interval '1 minute'`);

    failing.add('instagram');
    blotato = blotatoDouble(failing);
    expect(await enqueueDuePublications(db, new Date())).toEqual({
      due: 4,
      enqueued: 2,
      waitingForAccount: 2,
    });
    await drain();
    const status = async () =>
      Object.fromEntries(
        (
          await db.query<{ platform: string; status: string }>('SELECT platform, status FROM publications')
        ).rows.map((r) => [r.platform, r.status]),
      );
    expect(await status()).toMatchObject({ youtube: 'published', instagram: 'needs_check' });
    expect(blotato.calls.uploads).toBe(1);
    expect(blotato.calls.posts.sort()).toEqual(['instagram', 'youtube']);
    const yt = await db.query(
      `SELECT external_url, submission_id FROM publications WHERE platform = 'youtube'`,
    );
    expect(yt.rows[0]).toEqual({ external_url: 'https://youtube.test/post', submission_id: 'sub-youtube' });

    // Nothing is re-sent automatically.
    expect((await enqueueDuePublications(db, new Date())).enqueued).toBe(0);

    // The operator checked Blotato, the post is not there: retry once.
    failing.clear();
    blotato = blotatoDouble(failing);
    const ig = await db.query<{ id: string }>(`SELECT id FROM publications WHERE platform = 'instagram'`);
    expect(await retryPublication(db, ig.rows[0]!.id)).toBe(true);
    expect((await enqueueDuePublications(db, new Date())).enqueued).toBe(1);
    await drain();
    expect(await status()).toMatchObject({ youtube: 'published', instagram: 'published' });
    expect(blotato.calls.uploads).toBe(0);
    expect(blotato.calls.posts).toEqual(['instagram']);
  }, 60_000);
});
