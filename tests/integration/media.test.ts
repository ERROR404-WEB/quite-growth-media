import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ElevenLabsClient, ElevenLabsVoice, parseElevenLabsConfig } from '../../src/ai/elevenlabs.js';
import type { FetchLike } from '../../src/ai/http-client.js';
import { Budget } from '../../src/ai/pricing.js';
import { getBrand } from '../../src/brands/index.js';
import type { Language } from '../../src/domain/constants.js';
import type { AudioAsset } from '../../src/media/audio-library.js';
import { planSoundDesign } from '../../src/media/audio-library.js';
import { ffmpegAvailable, mediaDuration, resolveFfmpeg, run } from '../../src/media/ffmpeg.js';
import { produceVideo } from '../../src/media/pipeline.js';
import type { Illustrator } from '../../src/media/illustrator.js';
import { ExistingImagesIllustrator } from '../../src/media/illustrator.js';
import type { NarrationClip, VoiceProvider } from '../../src/media/voice.js';
import { estimateSpeechSeconds } from '../../src/media/timeline.js';

const tools = resolveFfmpeg();
const hasFfmpeg = ffmpegAvailable(tools);

/** Test double: a 2-second tone instead of speech (tests never call paid voice APIs). */
class ToneVoice implements VoiceProvider {
  readonly name = 'test-tone';
  supports(language: Language): boolean {
    return language === 'te';
  }
  async synthesize(_text: string, _language: Language, outFile: string): Promise<NarrationClip> {
    await run(tools.ffmpeg, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=2',
      '-ar',
      '22050',
      '-y',
      outFile,
    ]);
    return { file: outFile, durationSec: await mediaDuration(outFile, tools) };
  }
}

describe.skipIf(!hasFfmpeg)('video pipeline (integration, needs FFmpeg)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qgm-render-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('renders a small Telugu video with narration and passes automated QA', async () => {
    const brand = getBrand('chinni-lokam')!;
    const result = await produceVideo({
      brand,
      script: {
        brandId: brand.id,
        title: 'test',
        contentCategory: 'learning_video',
        language: 'te',
        scenes: [
          { narration: 'ఒకటి, రెండు, మూడు!', visual: 'three mangoes' },
          { narration: 'నాలుగు, ఐదు!', visual: 'five mangoes' },
          { narration: 'పంచుకోవడం ఎంత బాగుంది!', visual: 'sharing' },
        ],
      },
      workDir: join(dir, 'chinni'),
      voice: new ToneVoice(),
      width: 360,
      height: 640,
      preset: 'ultrafast',
      tools,
    });
    const failed = result.qa.filter((c) => c.status === 'failed');
    expect(failed).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.durationSec).toBeCloseTo(3 * 2.7, 0); // 2 s narration + 0.7 s padding per scene
    expect(result.voice).toBe('test-tone');
    expect(existsSync(result.thumbnail)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(dir, 'chinni', 'manifest.json'), 'utf8')) as {
      timeline: unknown[];
    };
    expect(manifest.timeline).toHaveLength(3);
    expect(readFileSync(join(dir, 'chinni', 'captions.ass'), 'utf8')).toContain('Noto Sans Telugu');
  }, 120_000);

  it('cover-crops non-9:16 illustrations (e.g. 1024x1536 fallback) and records illustration cost', async () => {
    const brand = getBrand('quiet-growth')!;
    const portrait: Illustrator = {
      name: 'fake-2x3',
      async generate(req) {
        const file = `scene-${req.sceneIndex + 1}.jpg`;
        await run(tools.ffmpeg, [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=320x480',
          '-frames:v',
          '1',
          '-y',
          join(req.workDir, file),
        ]);
        return { file, provider: 'fake', costUsd: 0.01, provenance: {} };
      },
    };
    const result = await produceVideo({
      brand,
      script: {
        brandId: brand.id,
        title: 'crop test',
        contentCategory: 'mindset_growth',
        language: 'en',
        scenes: [
          {
            narration: 'One small step today matters more than a perfect plan.',
            visual: 'a',
            beat: 'hook',
            pause: 'beat',
          },
          { narration: 'Start before you feel ready.', visual: 'b', beat: 'metaphor', pause: 'pause' },
          { narration: 'Then do it again tomorrow.', visual: 'c', beat: 'conclusion' },
        ],
      },
      workDir: join(dir, 'crop'),
      illustrator: portrait,
      width: 360,
      height: 640,
      preset: 'ultrafast',
      tools,
    });
    expect(result.qa.filter((c) => c.status === 'failed')).toEqual([]);
    expect(result.illustrator).toBe('fake-2x3');
    expect(result.illustrationCostUsd).toBeCloseTo(0.03);
    // Quiet Growth's warm lo-fi grade (with dust) rendered fine; captions use the soft handwritten look:
    // centred Kalam, lowercase, soft fades; hook + metaphor in the Emphasis style.
    const ass = readFileSync(join(dir, 'crop', 'captions.ass'), 'utf8');
    expect(ass).toMatch(/Style: Caption,Kalam,/);
    expect(ass).toMatch(/,Emphasis,,0,0,0,,\{\\blur3\\fad\(120,120\)\}one small step/);
    expect(ass).toMatch(/,Caption,,0,0,0,,\{\\blur3\\fad\(120,120\)\}then do it\n/);
    expect(ass).toMatch(/,Caption,,0,0,0,,\{\\blur3\\fad\(120,120\)\}again tomorrow\n/);
    const manifest = JSON.parse(readFileSync(join(dir, 'crop', 'manifest.json'), 'utf8')) as {
      timeline: { duration: number; narration: string }[];
    };
    // [BEAT] adds 0.7 s and [PAUSE] 1.2 s to the estimated speech + 0.7 s padding.
    const est = (s: string) => estimateSpeechSeconds(s, 'en') + 0.7;
    expect(manifest.timeline[0]!.duration).toBeCloseTo(
      est('One small step today matters more than a perfect plan.') + 0.7,
      1,
    );
    expect(manifest.timeline[1]!.duration).toBeCloseTo(
      Math.max(2.5, est('Start before you feel ready.') + 1.2),
      1,
    );
  }, 120_000);

  it('re-voices an earlier render by reusing its saved script and images at no illustration cost', async () => {
    const brand = getBrand('quiet-growth')!;
    const source = join(dir, 'crop');
    const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8')) as {
      scenes: { narration: string; visual: string }[];
      illustrations: { scene: number; file: string }[];
    };
    expect(manifest.scenes).toHaveLength(3);
    const result = await produceVideo({
      brand,
      script: {
        brandId: brand.id,
        title: 'crop test',
        contentCategory: 'mindset_growth',
        language: 'en',
        scenes: manifest.scenes,
      },
      workDir: join(dir, 'crop_revoiced'),
      illustrator: new ExistingImagesIllustrator(
        source,
        manifest.illustrations.map((i) => i.file),
      ),
      width: 360,
      height: 640,
      preset: 'ultrafast',
      tools,
    });
    expect(result.passed).toBe(true);
    expect(result.illustrationCostUsd).toBe(0);
    expect(
      readFileSync(join(dir, 'crop_revoiced', 'scene-2.jpg')).equals(
        readFileSync(join(source, 'scene-2.jpg')),
      ),
    ).toBe(true);
  }, 120_000);

  it('renders with the ElevenLabs provider (mocked API) and syncs captions to the speech timings', async () => {
    const tone = join(dir, 'tone.mp3');
    await run(tools.ffmpeg, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=1.5',
      '-ar',
      '44100',
      '-y',
      tone,
    ]);
    const audio = readFileSync(tone).toString('base64');
    const calls: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      const { text } = JSON.parse(String(init.body)) as { text: string };
      calls.push(text);
      const characters = [...text];
      // Speech starts at 0.2 s and each character lasts 0.04 s.
      return new Response(
        JSON.stringify({
          audio_base64: audio,
          alignment: {
            characters,
            character_start_times_seconds: characters.map((_, i) => 0.2 + i * 0.04),
            character_end_times_seconds: characters.map((_, i) => 0.24 + i * 0.04),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const cfg = parseElevenLabsConfig({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_HI: 'Hindi0Voice0Id0001' });
    const budget = new Budget(1);
    const voice = new ElevenLabsVoice(new ElevenLabsClient({ apiKey: 'k', fetch }), cfg, budget);
    const brand = getBrand('behtar-bano')!;
    const result = await produceVideo({
      brand,
      script: {
        brandId: brand.id,
        title: 'el test',
        contentCategory: 'habits_discipline',
        language: 'hi',
        scenes: [
          { narration: 'सिर्फ़ दो मिनट पढ़ो।', visual: 'a' },
          { narration: 'छोटी जीत रोज़ जुड़ती है।', visual: 'b' },
          { narration: 'कल फिर बस दो मिनट।', visual: 'c' },
        ],
      },
      workDir: join(dir, 'el'),
      voice,
      width: 360,
      height: 640,
      preset: 'ultrafast',
      tools,
    });
    expect(result.qa.filter((c) => c.status === 'failed')).toEqual([]);
    expect(result.voice).toBe('elevenlabs eleven_v4');
    expect(result.captionsAlignedScenes).toBe(3);
    expect(result.voiceCostUsd).toBeGreaterThan(0);
    expect(calls).toHaveLength(3);
    // Scene 1 speech starts at 0.3 s on the timeline + 0.2 s into the clip.
    expect(readFileSync(join(dir, 'el', 'captions.ass'), 'utf8')).toContain('Dialogue: 0,0:00:00.50,');
    const manifest = JSON.parse(readFileSync(join(dir, 'el', 'manifest.json'), 'utf8')) as {
      narrationClips: { file: string; aligned: boolean }[];
    };
    expect(manifest.narrationClips.map((c) => [c.file, c.aligned])).toEqual([
      ['narration-1.mp3', true],
      ['narration-2.mp3', true],
      ['narration-3.mp3', true],
    ]);
  }, 120_000);

  it('mixes licensed music (ducked under the voice) and a sound effect, verifying rights in QA', async () => {
    const brand = getBrand('chinni-lokam')!;
    const root = join(dir, 'library');
    mkdirSync(join(root, 'files'), { recursive: true });
    const makeTone = (file: string, lavfi: string) =>
      run(tools.ffmpeg, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        lavfi,
        '-ar',
        '44100',
        '-y',
        join(root, 'files', file),
      ]);
    await makeTone('music.mp3', 'sine=frequency=220:duration=4');
    await makeTone('chime.wav', 'sine=frequency=880:duration=0.4');
    const sha = (file: string) =>
      createHash('sha256')
        .update(readFileSync(join(root, 'files', file)))
        .digest('hex');
    const licensed = (over: Partial<AudioAsset>): AudioAsset => ({
      assetCode: 'x',
      kind: 'music',
      title: 'Test track',
      creator: null,
      fileName: 'x',
      storageUri: 'files/x',
      checksumSha256: '0'.repeat(64),
      durationSec: 4,
      bpm: null,
      category: 'playful',
      moods: [],
      source: 'original',
      sourceUrl: 'https://example.org/original',
      licenceType: 'original_work',
      licenceVersion: null,
      licenceUrl: null,
      commercialUse: 'allowed',
      monetizedSocialUse: 'allowed',
      modification: 'allowed',
      allowedPlatforms: ['instagram', 'facebook', 'youtube', 'x'],
      attributionRequired: false,
      attributionText: null,
      prohibitedUses: null,
      contentIdStatus: 'not_registered',
      licenceCheckedOn: '2026-11-18',
      licenceEvidenceUri: 'files/evidence.txt',
      status: 'approved',
      reviewNotes: null,
      ...over,
    });
    const library = [
      licensed({
        assetCode: 'test-music',
        fileName: 'music.mp3',
        storageUri: 'files/music.mp3',
        checksumSha256: sha('music.mp3'),
      }),
      licensed({
        assetCode: 'test-chime',
        kind: 'sound_effect',
        category: 'soft_texture',
        fileName: 'chime.wav',
        storageUri: 'files/chime.wav',
        checksumSha256: sha('chime.wav'),
        durationSec: 0.4,
      }),
    ];
    const scenes = [
      { narration: 'ఒకటి, రెండు, మూడు!', visual: 'a', camera: 'zoom-out' as const },
      { narration: 'నాలుగు, ఐదు!', visual: 'b', sfx: 'soft_texture' as const },
      { narration: 'పంచుకోవడం ఎంత బాగుంది!', visual: 'c' },
    ];
    const soundPlan = planSoundDesign({
      brief: { music: 'playful', ambience: 'none' },
      scenes,
      library,
      platforms: brand.platforms,
      durationSec: 8,
      kids: true,
    });
    expect(soundPlan.music?.asset.assetCode).toBe('test-music');
    const result = await produceVideo({
      brand,
      script: {
        brandId: brand.id,
        title: 'music',
        contentCategory: 'learning_video',
        language: 'te',
        scenes,
      },
      workDir: join(dir, 'music'),
      voice: new ToneVoice(),
      soundPlan,
      audioRoot: root,
      width: 360,
      height: 640,
      preset: 'ultrafast',
      tools,
    });
    expect(result.qa.filter((c) => c.status === 'failed')).toEqual([]);
    expect(result.qa.find((c) => c.name === 'audio_rights')?.detail).toMatch(
      /2 licensed asset\(s\) verified/,
    );
    expect(result.music).toContain('test-music');
    // Music is looped to the full video, so the render keeps its narration-driven length.
    expect(result.durationSec).toBeCloseTo(3 * 2.7, 0);
    const manifest = JSON.parse(readFileSync(join(dir, 'music', 'manifest.json'), 'utf8')) as {
      audio: {
        files: { file: string }[];
        soundPlan: { music: { assetCode: string } };
        mix: { ducking: string };
      };
    };
    expect(manifest.audio.files.map((f) => f.file)).toEqual(['audio/test-music.mp3', 'audio/test-chime.wav']);
    expect(manifest.audio.soundPlan.music.assetCode).toBe('test-music');
    expect(manifest.audio.mix.ducking).toMatch(/sidechain/);

    // A file that is not byte-identical to the licensed one fails rights QA.
    writeFileSync(
      join(root, 'files', 'chime.wav'),
      Buffer.concat([readFileSync(join(root, 'files', 'chime.wav')), Buffer.from([0])]),
    );
    const tampered = await produceVideo({
      brand,
      script: {
        brandId: brand.id,
        title: 'music',
        contentCategory: 'learning_video',
        language: 'te',
        scenes,
      },
      workDir: join(dir, 'music-tampered'),
      voice: new ToneVoice(),
      soundPlan,
      audioRoot: root,
      width: 360,
      height: 640,
      preset: 'ultrafast',
      tools,
    });
    expect(tampered.passed).toBe(false);
    expect(tampered.qa.find((c) => c.name === 'audio_rights')?.detail).toMatch(/test-chime: file checksum/);
  }, 180_000);

  it('refuses a script in another language than the brand (no cross-language reuse)', async () => {
    const brand = getBrand('quiet-growth')!;
    await expect(
      produceVideo({
        brand,
        script: {
          brandId: brand.id,
          title: 'x',
          contentCategory: 'mindset_growth',
          language: 'hi',
          scenes: [],
        },
        workDir: join(dir, 'bad'),
        tools,
      }),
    ).rejects.toThrow(/does not match brand language/);
  });
});
