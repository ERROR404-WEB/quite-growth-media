import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/ai/http-client.js';
import { xWeightedLength } from '../../src/ai/script-writer.js';
import { getBrand } from '../../src/brands/index.js';
import type { Platform } from '../../src/domain/constants.js';
import { renderLabel } from '../../src/media/demo/voice-select.js';
import { BlotatoClient, STATUS_POLL_MS } from '../../src/publishing/blotato.js';
import { parseBlotatoConfig } from '../../src/publishing/config.js';
import type { RenderManifest } from '../../src/publishing/gate.js';
import { publishProblems } from '../../src/publishing/gate.js';
import { buildBlotatoPost, xText } from '../../src/publishing/post-builder.js';
import type { PublishTarget } from '../../src/publishing/post-builder.js';
import { LEDGER_FILE, publishRender } from '../../src/publishing/publisher.js';

const KEY = 'blotato-test-key-0123456789';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    return next;
  };
  return { fetch, calls };
}

function makeClient(responses: Response[]) {
  const m = mockFetch(responses);
  const sleeps: number[] = [];
  const client = new BlotatoClient({
    apiKey: KEY,
    fetch: m.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls: m.calls, sleeps };
}

const qg = getBrand('quiet-growth')!;
const metadata = {
  youtubeTitle: 'You Don’t Owe Anyone a Rerun',
  shortDescription: 'Going home can pull you back into an old part.',
  captions: {
    instagram: 'You can love the photo without stepping back into the frame.',
    facebook: 'The people who knew you then get to meet you now.',
    youtube: 'You can go home without playing your old part.',
    x: 'You can love the photo without stepping back into the frame.',
  },
  hashtags: ['#QuietGrowth', '#SelfRespect', '#PersonalGrowth'],
  keywords: ['family roles', 'growth', 'self respect'],
};

const goodManifest = (): RenderManifest => ({
  brandId: 'quiet-growth',
  title: 'You Don’t Owe a Rerun',
  label: null,
  providers: {
    illustration: 'openai gpt-image-2.6-flare (medium)',
    voice: 'elevenlabs eleven_v4',
    music: 'x',
  },
  voiceSelection: { temporary: false, voiceId: 'Fxt4GZnlXkUGMtWSYIcm', commercial: true },
  audio: {
    platforms: ['instagram', 'facebook', 'youtube', 'x'],
    files: [
      {
        file: 'audio/mixkit-skyline-601.mp3',
        licence: {
          assetCode: 'mixkit-skyline-601',
          allowedPlatforms: ['instagram', 'facebook', 'youtube', 'x'],
        },
      },
    ],
  },
  platformVersion: ['instagram', 'facebook', 'youtube', 'x'],
  credits: [],
  metadata,
  result: { passed: true, qa: [{ name: 'mp4_integrity', status: 'passed', detail: 'ok' }] },
});

const targets: Record<Platform, PublishTarget> = {
  instagram: { platform: 'instagram', accountId: '11' },
  facebook: { platform: 'facebook', accountId: '12', pageId: '900' },
  youtube: { platform: 'youtube', accountId: '13' },
  x: { platform: 'x', accountId: '14' },
};

describe('Blotato post builder', () => {
  const build = (platform: Platform, extra: Partial<Parameters<typeof buildBlotatoPost>[0]> = {}) =>
    buildBlotatoPost({
      brand: qg,
      target: targets[platform],
      mediaUrl: 'https://database.blotato.io/v.mp4',
      metadata,
      youtubePrivacy: 'private',
      ...extra,
    });

  it('posts video as an Instagram and Facebook Reel with caption + hashtags', () => {
    const ig = build('instagram');
    expect(ig.post).toEqual({
      accountId: '11',
      content: {
        text: `${metadata.captions.instagram}\n\n#QuietGrowth #SelfRespect #PersonalGrowth`,
        mediaUrls: ['https://database.blotato.io/v.mp4'],
        platform: 'instagram',
      },
      target: { targetType: 'instagram', mediaType: 'reel', shareToFeed: true },
    });
    const fb = build('facebook');
    expect(fb.post.target).toEqual({ targetType: 'facebook', pageId: '900', mediaType: 'reel' });
    expect(() => build('facebook', { target: { platform: 'facebook', accountId: '12' } })).toThrow(/pageId/);
  });

  it('sets YouTube title, privacy, made-for-kids and AI disclosure', () => {
    const yt = build('youtube');
    expect(yt.post.target).toEqual({
      targetType: 'youtube',
      title: metadata.youtubeTitle,
      privacyStatus: 'private',
      shouldNotifySubscribers: false,
      isMadeForKids: false,
      containsSyntheticMedia: true,
    });
    expect(yt.post.content.text).toContain(metadata.shortDescription);
    const kids = buildBlotatoPost({
      brand: getBrand('little-wonder-world')!,
      target: targets.youtube,
      mediaUrl: 'u',
      metadata,
      youtubePrivacy: 'public',
    });
    expect(kids.post.target).toMatchObject({ isMadeForKids: true, shouldNotifySubscribers: true });
  });

  it('maps X to "twitter" and keeps the text within 280 weighted characters', () => {
    const x = build('x');
    expect(x.post.content.platform).toBe('twitter');
    expect(x.post.target).toEqual({ targetType: 'twitter' });
    const long = 'a'.repeat(260);
    const text = xText(long, ['#QuietGrowth', '#SelfRespect']);
    expect(xWeightedLength(text)).toBeLessThanOrEqual(280);
    expect(text).toBe(`${long} #QuietGrowth`);
    expect(() => xText('a'.repeat(300), [])).toThrow(/280/);
  });

  it('supports a future time or the next free slot, never the past', () => {
    expect(build('x', { schedule: 'next' }).useNextFreeSlot).toBe(true);
    expect(build('x', { schedule: '2099-01-01T10:00:00Z' }).scheduledTime).toBe('2099-01-01T10:00:00.000Z');
    expect(() => build('x', { schedule: '2001-01-01T10:00:00Z' })).toThrow(/past/);
  });
});

describe('publishing gate', () => {
  it('accepts a final render with the brand voice, commercial licence and cleared audio', () => {
    for (const p of qg.platforms) expect(publishProblems(goodManifest(), qg, p)).toEqual([]);
  });

  it('refuses test, temporary-voice, Free-plan, failed and unlicensed renders', () => {
    const problems = (patch: Partial<RenderManifest>, platform: Platform = 'youtube') =>
      publishProblems({ ...goodManifest(), ...patch }, qg, platform).join(' | ');
    expect(problems({ label: 'AI TEST · not for publishing' })).toMatch(/on-screen label/);
    const { label: _drop, ...noLabel } = goodManifest();
    expect(publishProblems(noLabel, qg, 'youtube').join()).toMatch(/predates label tracking/);
    expect(
      problems({ providers: { illustration: 'openai', voice: 'windows-sapi (local test voice)' } }),
    ).toMatch(/not a production voice/);
    expect(problems({ voiceSelection: { temporary: true, commercial: true } })).toMatch(/temporary/);
    expect(problems({ voiceSelection: { temporary: false, commercial: false } })).toMatch(
      /commercial licence/,
    );
    expect(
      problems({ providers: { illustration: 'placeholder (local, free)', voice: 'elevenlabs eleven_v4' } }),
    ).toMatch(/placeholders/);
    expect(
      problems({
        result: { passed: false, qa: [{ name: 'duration', status: 'failed', detail: 'too long' }] },
      }),
    ).toMatch(/QA did not pass.*failed QA checks: duration/);
    const youtubeOnly = goodManifest();
    youtubeOnly.platformVersion = ['youtube'];
    youtubeOnly.audio!.files![0]!.licence!.allowedPlatforms = ['youtube'];
    expect(publishProblems(youtubeOnly, qg, 'instagram').join()).toMatch(
      /not made for instagram.*not licensed for instagram/,
    );
    expect(publishProblems(goodManifest(), getBrand('behtar-bano')!, 'youtube').join()).toMatch(
      /belongs to quiet-growth/,
    );
  });

  it('only renders without the AI TEST label for the brand voice on a paid plan', () => {
    const el = { name: 'elevenlabs eleven_v4' } as never;
    expect(renderLabel({ voice: el, temporary: false, commercial: true }, true)).toBeUndefined();
    expect(renderLabel({ voice: el, temporary: false, commercial: true }, false)).toMatch(/AI TEST/);
    expect(renderLabel({ voice: el, temporary: true, commercial: true }, false)).toMatch(/temporary voice/);
    expect(() => renderLabel({ voice: el, temporary: false, commercial: false }, true)).toThrow(/paid plan/);
    expect(() => renderLabel({ voice: el, temporary: true, commercial: true }, true)).toThrow();
    expect(() =>
      renderLabel({ voice: { name: 'windows-sapi' } as never, temporary: false, commercial: false }, true),
    ).toThrow();
  });
});

describe('Blotato client', () => {
  it('sends the key header, uploads a local file through a presigned URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qgm-blotato-'));
    writeFileSync(join(dir, 'video.mp4'), Buffer.from('fake mp4'));
    const { client, calls } = makeClient([
      json(201, {
        presignedUrl: 'https://upload.example/put',
        publicUrl: 'https://database.blotato.io/v.mp4',
      }),
      new Response(null, { status: 200 }),
    ]);
    expect(await client.uploadFile(join(dir, 'video.mp4'))).toBe('https://database.blotato.io/v.mp4');
    expect(calls[0]!.url).toBe('https://backend.blotato.com/v2/media/uploads');
    expect((calls[0]!.init.headers as Record<string, string>)['blotato-api-key']).toBe(KEY);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ filename: 'video.mp4' });
    expect(calls[1]!.init.method).toBe('PUT');
    expect((calls[1]!.init.headers as Record<string, string>)['Content-Type']).toBe('video/mp4');
    // The presigned storage URL never receives the API key.
    expect((calls[1]!.init.headers as Record<string, string>)['blotato-api-key']).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never retries create-post (no idempotency key) but retries status reads', async () => {
    const { client, calls } = makeClient([json(500, { message: 'boom' })]);
    const req = buildBlotatoPost({
      brand: qg,
      target: targets.x,
      mediaUrl: 'u',
      metadata,
      youtubePrivacy: 'private',
    });
    await expect(client.createPost(req)).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);

    const reads = makeClient([
      json(503, {}),
      json(200, { status: 'published', publicUrl: 'https://x.com/1' }),
    ]);
    expect(await reads.client.getPostStatus('sub-1')).toEqual({
      status: 'published',
      publicUrl: 'https://x.com/1',
    });
    expect(reads.calls).toHaveLength(2);
  });

  it('polls status at least 10 s apart until a terminal state', async () => {
    const { client, sleeps } = makeClient([
      json(200, { status: 'in-progress' }),
      json(200, { status: 'failed', errorMessage: 'Unsupported media type' }),
    ]);
    expect(await client.waitForPost('sub-1')).toEqual({
      status: 'failed',
      errorMessage: 'Unsupported media type',
    });
    expect(sleeps).toEqual([STATUS_POLL_MS, STATUS_POLL_MS]);
    expect(STATUS_POLL_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('defaults YouTube uploads to private and treats a blank key as missing', () => {
    expect(parseBlotatoConfig({ BLOTATO_API_KEY: '  ' })).toMatchObject({
      BLOTATO_API_KEY: undefined,
      BLOTATO_YOUTUBE_PRIVACY: 'private',
      BLOTATO_BASE_URL: 'https://backend.blotato.com/v2',
    });
  });
});

describe('publishRender (idempotent, at most once per destination)', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const renderDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'qgm-publish-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'video.mp4'), Buffer.from('final video bytes'));
    return dir;
  };
  const base = (dir: string, client: BlotatoClient | null) => ({
    dir,
    brand: qg,
    manifest: goodManifest(),
    platforms: ['youtube'] as Platform[],
    targets,
    client,
    youtubePrivacy: 'private' as const,
    log: () => undefined,
  });

  it('dry run: gate + payload preview, no requests, no ledger', async () => {
    const dir = renderDir();
    const out = await publishRender(base(dir, null));
    expect(out[0]).toMatchObject({ platform: 'youtube', result: 'dry-run' });
    expect(out[0]!.request?.post.target).toMatchObject({
      targetType: 'youtube',
      containsSyntheticMedia: true,
    });
    expect(existsSync(join(dir, LEDGER_FILE))).toBe(false);
  });

  it('publishes once, records the outcome, and skips on the next run', async () => {
    const dir = renderDir();
    const first = makeClient([
      json(201, {
        presignedUrl: 'https://upload.example/put',
        publicUrl: 'https://database.blotato.io/v.mp4',
      }),
      new Response(null, { status: 200 }),
      json(201, { postSubmissionId: 'sub-1' }),
      json(200, { status: 'published', publicUrl: 'https://youtube.com/shorts/abc' }),
    ]);
    const out = await publishRender(base(dir, first.client));
    expect(out[0]).toMatchObject({ result: 'published', detail: 'https://youtube.com/shorts/abc' });
    const posted = JSON.parse(String(first.calls[2]!.init.body));
    expect(posted.post.content.mediaUrls).toEqual(['https://database.blotato.io/v.mp4']);
    const ledger = JSON.parse(readFileSync(join(dir, LEDGER_FILE), 'utf8'));
    expect(ledger.entries[0]).toMatchObject({
      platform: 'youtube',
      status: 'published',
      postSubmissionId: 'sub-1',
    });

    const second = makeClient([]);
    const again = await publishRender(base(dir, second.client));
    expect(again[0]).toMatchObject({ result: 'skipped' });
    expect(second.calls).toHaveLength(0);
  });

  it('never resubmits blindly after an ambiguous error, and marks 4xx rejections as failed', async () => {
    const dir = renderDir();
    const ambiguous = makeClient([
      json(201, {
        presignedUrl: 'https://upload.example/put',
        publicUrl: 'https://database.blotato.io/v.mp4',
      }),
      new Response(null, { status: 200 }),
      json(502, {}),
    ]);
    await expect(publishRender(base(dir, ambiguous.client))).rejects.toThrow(/502/);
    const next = makeClient([]);
    const out = await publishRender(base(dir, next.client));
    expect(out[0]).toMatchObject({ result: 'needs-check' });
    expect(next.calls).toHaveLength(0);

    const dir2 = renderDir();
    const rejected = makeClient([
      json(201, {
        presignedUrl: 'https://upload.example/put',
        publicUrl: 'https://database.blotato.io/v.mp4',
      }),
      new Response(null, { status: 200 }),
      json(400, { message: 'title is required' }),
    ]);
    const res = await publishRender(base(dir2, rejected.client));
    expect(res[0]).toMatchObject({ result: 'failed' });
    expect(res[0]!.detail).toMatch(/400/);
    // A failed destination is only resubmitted with retryFailed.
    const quiet = makeClient([]);
    expect((await publishRender(base(dir2, quiet.client)))[0]).toMatchObject({ result: 'failed' });
    expect(quiet.calls).toHaveLength(0);
  });

  it('blocks test renders and unlinked destinations before any request', async () => {
    const dir = renderDir();
    const c = makeClient([]);
    const out = await publishRender({
      ...base(dir, c.client),
      manifest: { ...goodManifest(), label: 'AI TEST · not for publishing' },
      platforms: ['youtube', 'instagram'],
      targets: { youtube: targets.youtube },
    });
    expect(out.map((o) => o.result)).toEqual(['blocked', 'blocked']);
    expect(out[1]!.detail).toMatch(/no Blotato account linked/);
    expect(c.calls).toHaveLength(0);
  });
});
