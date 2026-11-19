import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  brandVoiceEnvKey,
  createDesignedVoice,
  designVoice,
  ElevenLabsClient,
  ElevenLabsVoice,
  listVoices,
  parseElevenLabsConfig,
  searchSharedVoices,
  speechCostUsd,
  stripPrefix,
} from '../../src/ai/elevenlabs.js';
import type { FetchLike } from '../../src/ai/http-client.js';
import { ApiError } from '../../src/ai/http-client.js';
import { Budget, BudgetExceededError } from '../../src/ai/pricing.js';
import { cuesFromAlignment } from '../../src/media/captions.js';

const KEY = 'el-test-key-0123456789abcdef';
const VOICE = 'Abc123Def456Ghi789Jk';
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

/** Builds a fake per-character alignment: each character lasts 0.05 s. */
function fakeAlignment(text: string) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * 0.05),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.05),
  };
}

describe('ElevenLabs config', () => {
  it('reads defaults, language voices and brand voices', () => {
    const cfg = parseElevenLabsConfig({
      ELEVENLABS_API_KEY: KEY,
      ELEVENLABS_VOICE_TE: VOICE,
      [brandVoiceEnvKey('little-wonder-world')]: 'Kids0Voice0Id00001',
    });
    expect(cfg.ELEVENLABS_MODEL).toBe('eleven_v4');
    expect(cfg.ELEVENLABS_OUTPUT_FORMAT).toBe('mp3_44100_128');
    expect(cfg.ELEVENLABS_MAX_USD_PER_RUN).toBe(0.5);
    expect(cfg.languageVoices).toEqual({ te: VOICE });
    expect(cfg.brandVoices).toEqual({ 'little-wonder-world': 'Kids0Voice0Id00001' });
    expect(brandVoiceEnvKey('chinni-lokam')).toBe('ELEVENLABS_VOICE_CHINNI_LOKAM');
  });

  it('treats a blank key as missing and rejects malformed voice IDs', () => {
    expect(parseElevenLabsConfig({ ELEVENLABS_API_KEY: ' ' }).ELEVENLABS_API_KEY).toBeUndefined();
    expect(() => parseElevenLabsConfig({ ELEVENLABS_VOICE_HI: 'not a voice id!' })).toThrow(
      /ELEVENLABS_VOICE_HI/,
    );
  });

  it('prices speech per character from the dated rate table', () => {
    expect(speechCostUsd('eleven_v4', 'a'.repeat(1000))).toBeCloseTo(0.08);
    expect(speechCostUsd('eleven_v4_turbo', 'a'.repeat(1000))).toBeCloseTo(0.04);
    expect(speechCostUsd('eleven_v4', 'ఒకటి')).toBeCloseTo((4 / 1000) * 0.08);
  });
});

describe('ElevenLabsVoice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qgm-el-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  const client = (f: FetchLike) =>
    new ElevenLabsClient({ apiKey: KEY, fetch: f, sleep: async () => undefined });
  const make = (f: FetchLike, env: NodeJS.ProcessEnv = {}, budget = new Budget(1)) =>
    new ElevenLabsVoice(
      client(f),
      parseElevenLabsConfig({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_TE: VOICE, ...env }),
      budget,
      async () => 1.23,
    );

  it('resolves env brand override > brand config voice > language default; refuses Telugu on models without Telugu', () => {
    const v = make(mockFetch([]).fetch, { ELEVENLABS_VOICE_CHINNI_LOKAM: 'Brand0Voice0Id0001' });
    expect(v.voiceIdFor('te', 'chinni-lokam')).toBe('Brand0Voice0Id0001');
    // Devudu Manatho Unnadu has a fixed voice in its brand config.
    expect(v.voiceIdFor('te', 'devudu-manatho-unnadu')).toBe('EohubqvAiTiSkWCp1vu7');
    // No brand given -> language default.
    expect(v.voiceIdFor('te')).toBe(VOICE);
    // Kids brands have no voice until it is designed; Hindi has no default in this config.
    expect(v.supports('hi', 'nanhe-sitare')).toBe(false);
    expect(v.supports('hi', 'behtar-bano')).toBe(true);
    expect(make(mockFetch([]).fetch, { ELEVENLABS_MODEL: 'eleven_multilingual_v2' }).supports('te')).toBe(
      false,
    );
  });

  it('calls the timestamps endpoint with the key in a header and saves an mp3 with alignment', async () => {
    const text = 'చిట్టి వచ్చింది!';
    const m = mockFetch([
      json(200, { audio_base64: mp3.toString('base64'), alignment: fakeAlignment(text) }),
    ]);
    const budget = new Budget(1);
    const clip = await make(m.fetch, {}, budget).synthesize(` ${text} `, 'te', join(dir, 'narration-1.wav'), {
      brandId: 'chinni-lokam',
      previousText: 'before',
      nextText: 'after',
    });
    const call = m.calls[0]!;
    expect(call.url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`,
    );
    expect((call.init.headers as Record<string, string>)['xi-api-key']).toBe(KEY);
    expect(String(call.init.body)).not.toContain(KEY);
    expect(JSON.parse(String(call.init.body))).toEqual({
      text,
      model_id: 'eleven_v4',
      language_code: 'te',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      previous_text: 'before',
      next_text: 'after',
    });
    expect(clip.file).toBe(join(dir, 'narration-1.mp3'));
    expect(readFileSync(clip.file).equals(mp3)).toBe(true);
    expect(clip.durationSec).toBe(1.23);
    expect(clip.alignment!.characters.join('')).toBe(text);
    expect(clip.costUsd).toBeCloseTo(speechCostUsd('eleven_v4', text));
    expect(budget.spentUsd).toBeCloseTo(clip.costUsd!);
    expect(clip.provenance).toMatchObject({ provider: 'elevenlabs', voiceId: VOICE, language: 'te' });
  });

  it('omits language_code for multilingual_v2 (not supported there)', async () => {
    const m = mockFetch([json(200, { audio_base64: mp3.toString('base64') })]);
    await make(m.fetch, {
      ELEVENLABS_MODEL: 'eleven_multilingual_v2',
      ELEVENLABS_VOICE_HI: VOICE,
    }).synthesize('नमस्ते', 'hi', join(dir, 'n.wav'));
    expect(JSON.parse(String(m.calls[0]!.init.body))).not.toHaveProperty('language_code');
  });

  it('voices the delivery as an audio tag with the brand stability and speed, and strips the tag from the timings', async () => {
    const text = 'నువ్వు ఓడిపోలేదు.';
    const m = mockFetch([
      json(200, { audio_base64: mp3.toString('base64'), alignment: fakeAlignment(`[calm, low] ${text}`) }),
    ]);
    const clip = await make(m.fetch).synthesize(text, 'te', join(dir, 'tag.wav'), {
      brandId: 'ninnu-nuvvu-geluvu',
      direction: 'calm, low',
    });
    const body = JSON.parse(String(m.calls[0]!.init.body)) as {
      text: string;
      voice_settings: { stability: number; speed?: number };
    };
    expect(body.text).toBe(`[calm, low] ${text}`);
    // The calm narrator: steadier stability and a slightly slower pace (official range 0.7-1.2).
    expect(body.voice_settings).toMatchObject({ stability: 0.5, speed: 0.92 });
    expect(clip.alignment!.characters.join('')).toBe(text);
    expect(clip.alignment!.starts[0]).toBeCloseTo(12 * 0.05);
    expect(clip.provenance).toMatchObject({ audioTag: '[calm, low]', stability: 0.5, speed: 0.92 });
    // Captions still sync to the speech once the tag is removed.
    expect(cuesFromAlignment(text, clip.alignment!, 1, 'te')).not.toBeNull();
  });

  it('sends no tag on models without audio-tag support and keeps timings when the tag is not echoed', async () => {
    const m = mockFetch([json(200, { audio_base64: mp3.toString('base64') })]);
    await make(m.fetch, { ELEVENLABS_MODEL: 'eleven_flash_v2_5', ELEVENLABS_VOICE_EN: VOICE }).synthesize(
      'Hello there.',
      'en',
      join(dir, 'notag.wav'),
      { brandId: 'quiet-growth', direction: 'quiet, certain' },
    );
    expect(JSON.parse(String(m.calls[0]!.init.body)).text).toBe('Hello there.');
    const a = { characters: [...'Hi.'], starts: [0, 0.1, 0.2], ends: [0.1, 0.2, 0.3] };
    expect(stripPrefix(a, '[soft] ')).toBe(a);
    expect(stripPrefix(a, '')).toBe(a);
  });

  it('stops before exceeding the voice budget, without calling the API', async () => {
    const m = mockFetch([]);
    const voice = make(m.fetch, {}, new Budget(0.0001));
    await expect(voice.synthesize('ఒకటి రెండు మూడు నాలుగు', 'te', join(dir, 'x.wav'))).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(m.calls).toHaveLength(0);
  });

  it('surfaces ElevenLabs error details without retrying client errors', async () => {
    const m = mockFetch([
      json(401, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } }),
    ]);
    const err = (await make(m.fetch)
      .synthesize('ఒకటి', 'te', join(dir, 'y.wav'))
      .catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe(
      'ElevenLabs /text-to-speech/' +
        VOICE +
        '/with-timestamps failed (401): This request exceeds your quota.',
    );
    expect(err.code).toBe('quota_exceeded');
    expect(m.calls).toHaveLength(1);
  });

  it('lists account voices via GET without a request body', async () => {
    const m = mockFetch([
      json(200, {
        voices: [{ voice_id: VOICE, name: 'Asha', category: 'generated', labels: { accent: 'indian' } }],
      }),
    ]);
    expect(await listVoices(client(m.fetch))).toEqual([
      { voiceId: VOICE, name: 'Asha', category: 'generated', labels: { accent: 'indian' } },
    ]);
    expect(m.calls[0]!.init.method).toBe('GET');
    expect(m.calls[0]!.init.body).toBeUndefined();
  });
});

describe('voice library search and voice design', () => {
  const client = (f: FetchLike) =>
    new ElevenLabsClient({ apiKey: KEY, fetch: f, sleep: async () => undefined });

  it('searches shared voices with filters and excludes custom-rate voices', async () => {
    const m = mockFetch([
      json(200, {
        voices: [
          {
            voice_id: VOICE,
            public_owner_id: 'owner1',
            name: 'Srinu',
            gender: 'male',
            age: 'young',
            accent: 'standard',
            language: 'te',
            use_case: 'conversational',
            descriptive: 'casual',
            category: 'professional',
            usage_character_count_1y: 8_000_000,
            cloned_by_count: 10,
            live_moderation_enabled: false,
            notice_period: 730,
            verified_languages: [{ language: 'te', locale: null }],
          },
        ],
      }),
    ]);
    const res = await searchSharedVoices(client(m.fetch), {
      language: 'te',
      useCases: ['narrative_story'],
      minNoticePeriodDays: 365,
    });
    const url = new URL(m.calls[0]!.url);
    expect(url.pathname).toBe('/v1/shared-voices');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      language: 'te',
      use_cases: 'narrative_story',
      include_custom_rates: 'false',
      min_notice_period_days: '365',
      sort: 'usage_character_count_1y',
    });
    expect(res[0]).toMatchObject({ voiceId: VOICE, noticePeriodDays: 730, verifiedLanguages: ['te'] });
  });

  it('designs previews with eleven_ttv_v3 and saves the chosen one as a voice', async () => {
    const m = mockFetch([
      json(200, {
        text: 'x',
        previews: [
          { generated_voice_id: 'gen1', audio_base_64: 'AAAA', media_type: 'audio/mpeg', duration_secs: 4.2 },
        ],
      }),
      json(200, { voice_id: 'NewVoice0Id00001' }),
    ]);
    const previews = await designVoice(client(m.fetch), {
      description: 'A cartoon parrot',
      text: 'హాయ్ పిల్లలూ!',
    });
    expect(previews).toEqual([
      { generatedVoiceId: 'gen1', audioBase64: 'AAAA', mediaType: 'audio/mpeg', durationSecs: 4.2 },
    ]);
    expect(JSON.parse(String(m.calls[0]!.init.body))).toMatchObject({
      model_id: 'eleven_ttv_v3',
      voice_description: 'A cartoon parrot',
    });
    expect(
      await createDesignedVoice(client(m.fetch), {
        name: 'QGM Chinni Lokam',
        description: 'd',
        generatedVoiceId: 'gen1',
      }),
    ).toBe('NewVoice0Id00001');
    expect(m.calls[1]!.url).toBe('https://api.elevenlabs.io/v1/text-to-voice');
  });
});

describe('captions from speech alignment', () => {
  it('times each caption chunk from the first to the last spoken character, plus the offset', () => {
    const text = 'Try this. Write the worry down in one plain sentence.';
    const a = fakeAlignment(text);
    const cues = cuesFromAlignment(
      text,
      {
        characters: a.characters,
        starts: a.character_start_times_seconds,
        ends: a.character_end_times_seconds,
      },
      2,
      'en',
    )!;
    expect(cues.map((c) => c.text)).toEqual(['Try this.', 'Write the worry down in one plain', 'sentence.']);
    expect(cues[0]).toEqual({ start: 2, end: 2.5, text: 'Try this.' });
    expect(cues[2]!.end).toBeCloseTo(2 + text.length * 0.05, 2);
  });

  it('works with Indic text whose characters span several code units', () => {
    const text = 'ఒకటి, రెండు, మూడు!';
    const a = fakeAlignment(text);
    const cues = cuesFromAlignment(
      text,
      {
        characters: a.characters,
        starts: a.character_start_times_seconds,
        ends: a.character_end_times_seconds,
      },
      0,
      'te',
    );
    expect(cues?.map((c) => c.text).join(' ')).toBe(text);
  });

  it('returns null when the alignment does not match the narration', () => {
    const a = fakeAlignment('something else');
    expect(
      cuesFromAlignment(
        'Hello there',
        {
          characters: a.characters,
          starts: a.character_start_times_seconds,
          ends: a.character_end_times_seconds,
        },
        0,
        'en',
      ),
    ).toBeNull();
  });
});
