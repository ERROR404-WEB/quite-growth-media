import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Platform } from '../../src/domain/constants.js';
import { buildAsset, catalogEntrySchema, EXAMPLE_CATALOG } from '../../src/media/audio-catalog.js';
import type { AudioAsset } from '../../src/media/audio-library.js';
import {
  availableMusicMoods,
  creditsFor,
  HOOK_SFX_VOLUME,
  musicMoodsOnAnyPlatform,
  planPlatformVariants,
  planSoundDesign,
  restoreSoundPlan,
  rightsDecision,
  saveSoundPlan,
  selectAudio,
} from '../../src/media/audio-library.js';
import { evaluateAudioRights, evaluateDurationTarget } from '../../src/media/qa.js';
import { metadataForVersion } from '../../src/media/demo/variants.js';
import { ReusedNarration } from '../../src/media/voice.js';
import { buildRenderArgs, DUCKING } from '../../src/media/render.js';
import { buildTimeline } from '../../src/media/timeline.js';

const ALL: Platform[] = ['instagram', 'facebook', 'youtube', 'x'];

/** A fully verified Mixkit music track; tests override single fields. */
function asset(overrides: Partial<AudioAsset> = {}): AudioAsset {
  return {
    assetCode: 'mixkit-soft-piano',
    kind: 'music',
    title: 'Soft piano',
    creator: 'Artist',
    fileName: 'soft-piano.mp3',
    storageUri: 'data/audio/files/soft-piano.mp3',
    checksumSha256: 'a'.repeat(64),
    durationSec: 120,
    bpm: null,
    category: 'reflective',
    moods: [],
    source: 'mixkit',
    sourceUrl: 'https://mixkit.co/free-stock-music/tag/piano/',
    licenceType: 'mixkit_music_free',
    licenceVersion: 'Mixkit Stock Music Free License',
    licenceUrl: 'https://mixkit.co/license/#musicFree',
    commercialUse: 'allowed',
    monetizedSocialUse: 'allowed',
    modification: 'allowed',
    allowedPlatforms: [...ALL],
    attributionRequired: false,
    attributionText: null,
    prohibitedUses: 'No CDs/DVDs, games, TV/radio; no remixes as music-only tracks',
    contentIdStatus: 'not_registered',
    licenceCheckedOn: '2026-11-18',
    licenceEvidenceUri: 'data/audio/evidence/soft-piano.pdf',
    status: 'approved',
    reviewNotes: null,
    ...overrides,
  };
}

const sfx = (code: string, category: AudioAsset['category'], extra: Partial<AudioAsset> = {}) =>
  asset({
    assetCode: code,
    kind: 'sound_effect',
    category,
    licenceType: 'mixkit_sfx_free',
    durationSec: 2,
    ...extra,
  });

describe('audio rights gate', () => {
  it('approves only fully verified assets for the intended platforms', () => {
    expect(rightsDecision(asset(), ALL)).toEqual({ approved: true, reasons: [] });
  });

  it.each([
    ['pending review', { status: 'pending_review' as const }, /status is pending_review/],
    ['unknown commercial use', { commercialUse: 'unknown' as const }, /commercial use is unknown/],
    ['no monetised use', { monetizedSocialUse: 'prohibited' as const }, /monetised social-media use/],
    ['no modification', { modification: 'unknown' as const }, /modification/],
    ['Content ID registered', { contentIdStatus: 'registered' as const }, /Content ID status is registered/],
    ['no evidence', { licenceEvidenceUri: null }, /evidence is missing/],
    ['no check date', { licenceCheckedOn: null }, /verification date/],
    [
      'platform missing',
      { allowedPlatforms: ['youtube' as const] },
      /not cleared for instagram, facebook, x/,
    ],
    ['SFX licence on music', { licenceType: 'mixkit_sfx_free' as const }, /does not cover a music/],
  ])('rejects %s', (_name, overrides, reason) => {
    const d = rightsDecision(asset(overrides), ALL);
    expect(d.approved).toBe(false);
    expect(d.reasons.join('; ')).toMatch(reason);
  });

  it('limits YouTube Audio Library tracks to YouTube', () => {
    const yt = asset({ source: 'youtube_audio_library', licenceType: 'youtube_audio_library' });
    expect(rightsDecision(yt, ['youtube']).reasons.join()).toMatch(/only documented as safe on YouTube/);
    const ytOnly = { ...yt, allowedPlatforms: ['youtube' as const] };
    expect(rightsDecision(ytOnly, ['youtube']).approved).toBe(true);
    expect(rightsDecision(ytOnly, ALL).approved).toBe(false);
  });

  it('allows attribution-required assets only when attribution can be published', () => {
    const ccBy = asset({
      licenceType: 'cc_by',
      attributionRequired: true,
      attributionText: 'Music: X (CC BY 4.0)',
    });
    expect(rightsDecision(ccBy, ALL).reasons.join()).toMatch(/cannot be published yet/);
    expect(rightsDecision(ccBy, ALL, { canPublishAttribution: true }).approved).toBe(true);
    const noText = { ...ccBy, attributionText: null };
    expect(rightsDecision(noText, ALL, { canPublishAttribution: true }).reasons.join()).toMatch(
      /no attribution text/,
    );
  });
});

describe('audio selection', () => {
  const library = [
    asset({ assetCode: 'calm-a', category: 'calm' }),
    asset({ assetCode: 'sad-a', category: 'sad' }),
    asset({ assetCode: 'sad-b', category: 'sad' }),
    asset({ assetCode: 'sad-unverified', category: 'sad', status: 'pending_review' }),
    asset({ assetCode: 'heartbreak-short', category: 'heartbreak', durationSec: 10 }),
  ];

  it('prefers the exact mood, then the closest mood, and never unverified tracks', () => {
    expect(
      selectAudio(library, { kind: 'music', categories: ['sad', 'heartbreak'], platforms: ALL })?.assetCode,
    ).toBe('sad-a');
    expect(
      selectAudio(library, { kind: 'music', categories: ['healing', 'calm'], platforms: ALL })?.assetCode,
    ).toBe('calm-a');
    expect(selectAudio(library, { kind: 'music', categories: ['suspense'], platforms: ALL })).toBeNull();
  });

  it('rotates away from tracks this brand used recently', () => {
    const usage = new Map([['sad-a', { uses: 3, brandUses: 2, lastBrandUseAt: new Date('2026-11-17') }]]);
    const pick = selectAudio(library, {
      kind: 'music',
      categories: ['sad'],
      platforms: ALL,
      usage,
      now: new Date('2026-11-18'),
    });
    expect(pick?.assetCode).toBe('sad-b');
  });

  it('matches mood tags and penalises beds shorter than the video', () => {
    const tagged = [asset({ assetCode: 'tagged', category: 'ambient', moods: ['heartbreak'] })];
    expect(
      selectAudio(tagged, { kind: 'music', categories: ['heartbreak'], platforms: ALL })?.assetCode,
    ).toBe('tagged');
    const pick = selectAudio(library, {
      kind: 'music',
      categories: ['heartbreak', 'sad'],
      platforms: ALL,
      minDurationSec: 20,
    });
    expect(pick?.assetCode).toBe('sad-a');
  });
});

describe('platform-specific versions (e.g. YouTube-only music with a credit)', () => {
  const ytOnly = asset({
    assetCode: 'mx-broken',
    category: 'sad',
    moods: ['emotional', 'reflective'],
    source: 'other',
    licenceType: 'custom',
    allowedPlatforms: ['youtube'],
    attributionRequired: true,
    attributionText: '♪ Broken (Prod. by MX Audio Library)',
  });
  const everywhere = asset({ assetCode: 'mixkit-drive', category: 'motivational', moods: ['hopeful'] });
  const library = [ytOnly, everywhere];
  const base = { scenes: [], library, durationSec: 22, kids: false };

  it('counts moods that only one platform can use, for the script writer', () => {
    expect(availableMusicMoods(library, ALL)).toEqual(['hopeful', 'motivational']);
    expect(musicMoodsOnAnyPlatform(library, ALL)).toEqual([
      'emotional',
      'sad',
      'hopeful',
      'motivational',
      'reflective',
    ]);
  });

  it('keeps the YouTube-only track out of the cross-platform version and adds a YouTube version with the credit', () => {
    const { main, extra } = planPlatformVariants({ ...base, brief: { music: 'sad', ambience: 'none' } }, ALL);
    expect(main.platforms).toEqual(['instagram', 'facebook', 'x']);
    expect(main.soundPlan.music).toBeNull();
    expect(extra).toHaveLength(1);
    expect(extra[0]!.platforms).toEqual(['youtube']);
    expect(extra[0]!.soundPlan.music?.asset.assetCode).toBe('mx-broken');
    expect(extra[0]!.credits).toEqual(['♪ Broken (Prod. by MX Audio Library)']);
  });

  it('makes a single version when the cross-platform track already fits every platform', () => {
    const { main, extra } = planPlatformVariants(
      { ...base, brief: { music: 'hopeful', ambience: 'none' } },
      ALL,
    );
    expect(main.platforms).toEqual(ALL);
    expect(main.soundPlan.music?.asset.assetCode).toBe('mixkit-drive');
    expect(main.credits).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('collects credits only for attribution-required assets', () => {
    const plan = planSoundDesign({
      ...base,
      platforms: ['youtube'],
      canPublishAttribution: true,
      brief: { music: 'sad', ambience: 'none' },
    });
    expect(creditsFor(plan)).toEqual(['♪ Broken (Prod. by MX Audio Library)']);
    expect(
      metadataForVersion(
        {
          youtubeTitle: 't',
          shortDescription: 'A quiet reminder.',
          captions: { instagram: 'a', facebook: 'b', youtube: 'c', x: 'd' },
          hashtags: [],
          keywords: [],
        },
        { platforms: ['youtube'], soundPlan: plan, credits: creditsFor(plan) },
      ).youtubeDescription,
    ).toBe('A quiet reminder.\n\n♪ Broken (Prod. by MX Audio Library)');
  });
});

describe('reused narration (platform versions cost no extra voice)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qgm-reuse-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'first-2.mp3'), 'voice bytes');
  const clip = {
    file: join(dir, 'first-2.mp3'),
    durationSec: 2.5,
    costUsd: 0.01,
    alignment: { characters: ['a'], starts: [0], ends: [0.1] },
  };

  it('copies the matching scene clip, keeps timings and charges nothing', async () => {
    const voice = new ReusedNarration('elevenlabs eleven_v4', [undefined, clip]);
    expect(voice.supports()).toBe(true);
    expect(voice.name).toBe('elevenlabs eleven_v4 (reused narration)');
    mkdirSync(join(dir, 'v2'));
    const out = await voice.synthesize('text', 'en', join(dir, 'v2', 'narration-2.wav'));
    expect(out).toMatchObject({
      file: join(dir, 'v2', 'narration-2.mp3'),
      durationSec: 2.5,
      costUsd: 0,
      alignment: clip.alignment,
    });
    await expect(voice.synthesize('text', 'en', join(dir, 'v2', 'narration-1.wav'))).rejects.toThrow(
      /No reusable narration/,
    );
    expect(new ReusedNarration('none', [undefined]).supports()).toBe(false);
  });
});

describe('available music moods', () => {
  it('lists moods (category + tags) served by approved, cleared music only', () => {
    const lib = [
      asset({ assetCode: 'm1', category: 'motivational', moods: ['confidence', 'hopeful', 'not-a-mood'] }),
      asset({ assetCode: 'm2', category: 'sad', status: 'pending_review' }),
      asset({ assetCode: 'm3', category: 'calm', allowedPlatforms: ['youtube'] }),
      asset({ assetCode: 's1', kind: 'sound_effect', category: 'whoosh', licenceType: 'mixkit_sfx_free' }),
    ];
    expect(availableMusicMoods(lib, ALL)).toEqual(['hopeful', 'motivational', 'confidence']);
    expect(availableMusicMoods([], ALL)).toEqual([]);
  });
});

describe('sound design plan', () => {
  const library = [
    asset({ assetCode: 'reflective-a', category: 'reflective' }),
    asset({ assetCode: 'playful-a', category: 'playful' }),
    sfx('impact-a', 'soft_impact'),
    sfx('whoosh-a', 'whoosh'),
    sfx('transition-a', 'transition'),
    sfx('rain-a', 'rain', { durationSec: 60 }),
  ];
  const base = { library, platforms: ALL, durationSec: 22, kids: false };

  it('selects licensed music, ambience and at most two gentle effects', () => {
    const plan = planSoundDesign({
      ...base,
      brief: { music: 'reflective', ambience: 'rain' },
      scenes: [{ sfx: 'soft_impact' }, { sfx: 'whoosh' }, { sfx: 'whoosh' }, { sfx: 'none' }],
    });
    expect(plan.music?.asset.assetCode).toBe('reflective-a');
    expect(plan.ambience?.asset.assetCode).toBe('rain-a');
    expect(plan.sfx.map((s) => [s.sceneIndex, s.asset.assetCode])).toEqual([
      [0, 'impact-a'],
      [1, 'whoosh-a'],
    ]);
    expect(plan.sfx[0]!.volume).toBe(HOOK_SFX_VOLUME);
    expect(plan.notes.join('\n')).toMatch(/dropped \(max 2 per video\)/);
  });

  it('does not repeat the identical effect within a video', () => {
    const plan = planSoundDesign({
      ...base,
      brief: { music: 'none', ambience: 'none' },
      scenes: [{ sfx: 'none' }, { sfx: 'transition' }, { sfx: 'transition' }],
    });
    expect(plan.sfx.map((s) => s.asset.assetCode)).toEqual(['transition-a', 'whoosh-a']);
  });

  it('falls back to no music instead of an unverified track', () => {
    const plan = planSoundDesign({
      ...base,
      library: [asset({ category: 'sad', status: 'pending_review' })],
      brief: { music: 'sad', ambience: 'none' },
      scenes: [],
    });
    expect(plan.music).toBeNull();
    expect(plan.notes[0]).toMatch(/copyright-safe fallback/);
  });

  it('keeps children away from heavy moods', () => {
    const kidsLib = [asset({ assetCode: 'sad-kids', category: 'sad' }), ...library];
    expect(
      planSoundDesign({
        ...base,
        library: kidsLib,
        kids: true,
        brief: { music: 'sad', ambience: 'none' },
        scenes: [],
      }).music,
    ).toBeNull();
    expect(
      planSoundDesign({ ...base, kids: true, brief: { music: 'playful', ambience: 'none' }, scenes: [] })
        .music?.asset.assetCode,
    ).toBe('playful-a');
  });

  it('saves and restores a plan, re-checking rights against the current library', () => {
    const plan = planSoundDesign({
      ...base,
      brief: { music: 'reflective', ambience: 'none' },
      scenes: [{ sfx: 'soft_impact' }],
    });
    const saved = JSON.parse(JSON.stringify(saveSoundPlan(plan))) as ReturnType<typeof saveSoundPlan>;
    expect(restoreSoundPlan(saved, library, ALL).music?.asset.assetCode).toBe('reflective-a');
    const revoked = library.map((a) =>
      a.assetCode === 'reflective-a' ? { ...a, status: 'retired' as const } : a,
    );
    const restored = restoreSoundPlan(saved, revoked, ALL);
    expect(restored.music).toBeNull();
    expect(restored.sfx).toHaveLength(1);
    expect(restored.notes.join()).toMatch(/reflective-a dropped \(status is retired\)/);
  });
});

describe('audio catalog import', () => {
  const root = mkdtempSync(join(tmpdir(), 'qgm-audio-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const catalogDir = join(root, 'data', 'audio');
  mkdirSync(join(catalogDir, 'files'), { recursive: true });
  mkdirSync(join(catalogDir, 'evidence'), { recursive: true });
  const bytes = Buffer.from('fake mp3 bytes');
  writeFileSync(join(catalogDir, 'files', 'piano.mp3'), bytes);
  writeFileSync(join(catalogDir, 'evidence', 'piano.pdf'), 'licence page');
  const opts = { catalogDir, root, measureDuration: async () => 95.4321, today: '2026-11-18' };
  const entry = (overrides: Record<string, unknown> = {}) =>
    catalogEntrySchema.parse({
      assetCode: 'mixkit-piano',
      kind: 'music',
      title: 'Piano',
      file: 'files/piano.mp3',
      category: 'reflective',
      source: 'mixkit',
      sourceUrl: 'https://mixkit.co/free-stock-music/',
      licenceType: 'mixkit_music_free',
      commercialUse: 'allowed',
      monetizedSocialUse: 'allowed',
      modification: 'allowed',
      allowedPlatforms: ALL,
      contentIdStatus: 'not_registered',
      licenceCheckedOn: '2026-11-18',
      licenceEvidence: 'evidence/piano.pdf',
      status: 'approved',
      ...overrides,
    });

  it('accepts the example template (as pending review)', () => {
    expect(EXAMPLE_CATALOG.every((e) => catalogEntrySchema.safeParse(e).success)).toBe(true);
    expect(EXAMPLE_CATALOG.every((e) => e.status === 'pending_review')).toBe(true);
  });

  it('measures, checksums and stores repo-relative paths', async () => {
    const { asset: a, problems } = await buildAsset(entry(), opts);
    expect(problems).toEqual([]);
    expect(a).toMatchObject({
      storageUri: 'data/audio/files/piano.mp3',
      licenceEvidenceUri: 'data/audio/evidence/piano.pdf',
      durationSec: 95.432,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      status: 'approved',
    });
  });

  it('refuses to approve without verified rights, but imports pending entries', async () => {
    const unsure = await buildAsset(entry({ contentIdStatus: 'unknown' }), opts);
    expect(unsure.asset).toBeUndefined();
    expect(unsure.problems.join()).toMatch(/cannot approve: Content ID status is unknown/);
    const pending = await buildAsset(entry({ contentIdStatus: 'unknown', status: 'pending_review' }), opts);
    expect(pending.asset?.status).toBe('pending_review');
  });

  it('reports missing files, missing evidence and future check dates', async () => {
    expect((await buildAsset(entry({ file: 'files/missing.mp3' }), opts)).problems).toEqual([
      'file not found: files/missing.mp3',
    ]);
    const r = await buildAsset(
      entry({ licenceEvidence: 'evidence/none.pdf', licenceCheckedOn: '2026-12-01' }),
      opts,
    );
    expect(r.problems.join()).toMatch(/licence evidence not found/);
    expect(r.problems.join()).toMatch(/in the future/);
  });

  it('rejects unknown catalog fields so typos are caught', () => {
    expect(catalogEntrySchema.safeParse({ ...entry(), commercialUSE: 'allowed' }).success).toBe(false);
  });
});

describe('audio QA', () => {
  it('fails rights QA on an unapproved asset or a swapped file', () => {
    const ok = asset();
    expect(evaluateAudioRights([], ALL).status).toBe('passed');
    expect(evaluateAudioRights([{ asset: ok, fileSha256: ok.checksumSha256 }], ALL).status).toBe('passed');
    const swapped = evaluateAudioRights([{ asset: ok, fileSha256: 'b'.repeat(64) }], ALL);
    expect(swapped).toMatchObject({ status: 'failed' });
    expect(swapped.detail).toMatch(/checksum does not match/);
    const ytOnly = asset({ allowedPlatforms: ['youtube'] });
    expect(evaluateAudioRights([{ asset: ytOnly, fileSha256: ytOnly.checksumSha256 }], ALL).detail).toMatch(
      /not cleared for instagram/,
    );
  });

  it('warns (does not fail) outside the brand duration target', () => {
    const target = { minSec: 15, maxSec: 28, idealMinSec: 18, idealMaxSec: 25 };
    expect(evaluateDurationTarget(21, target)?.status).toBe('passed');
    expect(evaluateDurationTarget(21, target)?.detail).toMatch(/ideal\)$/);
    expect(evaluateDurationTarget(31, target)?.status).toBe('warning');
    expect(evaluateDurationTarget(31, undefined)).toBeNull();
  });
});

describe('render with licensed audio', () => {
  const timeline = buildTimeline([3, 3], 0.5);
  const spec = {
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: [
      { image: 'scene-1.png', motion: 'zoom-in' as const },
      { image: 'scene-2.png', motion: 'pan-left' as const },
    ],
    timeline,
    transition: 0.5,
    narration: [
      { file: 'narration-1.wav', start: 0.3 },
      { file: 'narration-2.wav', start: 3.3 },
    ],
    musicVolume: 0.3,
    music: { file: 'audio/music.mp3', volume: 0.22 },
    ambience: { file: 'audio/rain.mp3', volume: 0.12 },
    sfx: [{ file: 'audio/impact.wav', start: 0, volume: 0.25 }],
    output: 'video.mp4',
  };

  it('loops beds to the video length, ducks them under narration and places effects', () => {
    const args = buildRenderArgs(spec);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(args.join(' ')).toContain('-stream_loop -1 -t 6.000 -i audio/music.mp3');
    expect(args.join(' ')).toContain('-stream_loop -1 -t 6.000 -i audio/rain.mp3');
    expect(graph).not.toContain('aevalsrc'); // licensed music replaces the synthesized pad
    expect(graph).toContain('[4:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:6.000');
    expect(graph).toContain('[sil][bed0][bed1]amix=inputs=3:duration=first:normalize=0[bgraw]');
    expect(graph).toContain(
      '[n0][n1]amix=inputs=2:duration=longest:normalize=0,apad=whole_dur=6.000,asplit=2[voice][voicekey]',
    );
    expect(graph).toContain(`[bgraw][voicekey]${DUCKING}[bed]`);
    expect(graph).toContain(
      '[6:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.25,adelay=delays=0:all=1[sfx0]',
    );
    expect(graph).toContain('[bed][voice][sfx0]amix=inputs=3:duration=first');
  });

  it('plays music without ducking when there is no narration', () => {
    const graph = buildRenderArgs({ ...spec, narration: [], ambience: undefined, sfx: [] }).join(' ');
    expect(graph).toContain('[bgraw]anull[bed]');
    expect(graph).not.toContain('sidechaincompress');
  });
});
