import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getBrand } from '../../src/brands/index.js';
import type { Language } from '../../src/domain/constants.js';
import { ffmpegAvailable, mediaDuration, resolveFfmpeg, run } from '../../src/media/ffmpeg.js';
import { produceVideo } from '../../src/media/pipeline.js';
import type { NarrationClip, VoiceProvider } from '../../src/media/voice.js';

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
