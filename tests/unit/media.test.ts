import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BRANDS } from '../../src/brands/index.js';
import {
  assTime,
  buildAss,
  chunkCaptionText,
  escapeAssText,
  softCaptionText,
  splitIntoCues,
} from '../../src/media/captions.js';
import { crc32, encodePng } from '../../src/media/png.js';
import { hexToRgb, renderPlaceholderScene } from '../../src/media/placeholder-art.js';
import type { VideoProbe } from '../../src/media/qa.js';
import { evaluateVideo, qaPassed } from '../../src/media/qa.js';
import { buildRenderArgs, motionFilter } from '../../src/media/render.js';
import {
  buildTimeline,
  estimateSpeechSeconds,
  sceneDuration,
  totalDuration,
} from '../../src/media/timeline.js';
import { DEMO_SCRIPTS } from '../../src/media/demo/scripts.js';

describe('png encoder', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('writes a valid PNG whose pixels round-trip', () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    const png = encodePng(2, 2, rgb);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(2);
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 10, 20, 30]);
  });

  it('rejects a mismatched buffer', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow();
  });
});

describe('placeholder art', () => {
  it('renders every brand palette deterministically', () => {
    for (const b of BRANDS) {
      const opts = {
        width: 90,
        height: 160,
        palette: b.visualIdentity.palette,
        sceneIndex: 1,
        sceneCount: 3,
        seed: b.id,
      };
      const a = renderPlaceholderScene(opts);
      expect(a.readUInt32BE(16)).toBe(90);
      expect(a.readUInt32BE(20)).toBe(160);
      expect(renderPlaceholderScene(opts).equals(a)).toBe(true);
    }
  });

  it('parses hex colours', () => {
    expect(hexToRgb('#FF8000')).toEqual([255, 128, 0]);
    expect(() => hexToRgb('red')).toThrow();
  });
});

describe('timeline', () => {
  it('pads speech and enforces a minimum scene length', () => {
    expect(sceneDuration(3)).toBe(3.7);
    expect(sceneDuration(0.5)).toBe(2.5);
    expect(estimateSpeechSeconds('one two three four five six', 'en')).toBeCloseTo(6 / 2.8);
  });

  it('extends streams by the crossfade so the total equals the sum of durations', () => {
    const t = buildTimeline([3, 4, 5], 0.5);
    expect(t.map((e) => e.start)).toEqual([0, 3, 7]);
    expect(t.map((e) => e.streamLength)).toEqual([3.5, 4.5, 5]);
    expect(totalDuration(t)).toBe(12);
    expect(() => buildTimeline([0.4], 0.5)).toThrow();
  });
});

describe('captions', () => {
  it('splits narration into short cues covering the time span in order', () => {
    const cues = splitIntoCues(
      'Try this. Write the worry down in one plain sentence, then close the notebook.',
      2,
      6,
      'en',
    );
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.start).toBe(2);
    expect(cues.at(-1)!.end).toBeCloseTo(8, 1);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(34);
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeCloseTo(cues[i - 1]!.end, 2);
  });

  it('splits Hindi on the danda and keeps Telugu words whole', () => {
    expect(splitIntoCues('छोटी जीत रोज़ जुड़ती है। कल फिर बस दो मिनट।', 0, 4, 'hi').map((c) => c.text)).toEqual([
      'छोटी जीत रोज़ जुड़ती है।',
      'कल फिर बस दो मिनट।',
    ]);
    const te = splitIntoCues('చిట్టి స్నేహితులతో పంచుకుంది. పంచుకోవడం ఎంత బాగుంది!', 0, 4, 'te');
    expect(te.map((c) => c.text).join(' ')).toBe('చిట్టి స్నేహితులతో పంచుకుంది. పంచుకోవడం ఎంత బాగుంది!');
  });

  it('formats ASS times and neutralises override codes', () => {
    expect(assTime(3725.456)).toBe('1:02:05.46');
    expect(escapeAssText('{\\b1}hi\nthere')).toBe('(/b1)hi there');
  });

  it('builds an ASS file with the script-specific font and safe margins', () => {
    const ass = buildAss({
      width: 1080,
      height: 1920,
      language: 'te',
      cues: [{ start: 0, end: 2, text: 'ఒకటి' }],
      label: 'DEMO',
    });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toMatch(/Style: Caption,Noto Sans Telugu,/);
    expect(ass).toContain(',2,97,97,461,1'); // bottom-centre, ~9% sides, ~24% bottom margin
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,ఒకటి');
    expect(ass).toContain(',Label,,0,0,0,,DEMO');
  });

  it('renders hook and metaphor cues in the larger warm Emphasis style', () => {
    const ass = buildAss({
      width: 1080,
      height: 1920,
      language: 'en',
      cues: [
        { start: 0, end: 2, text: "You're not lazy.", style: 'emphasis' },
        { start: 2, end: 4, text: 'It is about carrying less.' },
      ],
    });
    expect(ass).toMatch(/Style: Emphasis,Noto Sans,83,&H0075C4F0/);
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Emphasis,,0,0,0,,You're not lazy.");
    expect(ass).toContain('Dialogue: 0,0:00:02.00,0:00:04.00,Caption,,0,0,0,,It is about carrying less.');
  });

  it('builds centred soft handwritten captions (reference look) with a subtle cream emphasis', () => {
    const ass = buildAss({
      width: 1080,
      height: 1920,
      language: 'en',
      style: 'soft_handwritten',
      cues: [
        { start: 0, end: 2, text: 'Stop shrinking...', style: 'emphasis' },
        { start: 2, end: 4, text: "It's not weakness." },
      ],
    });
    // Kalam, bold + slanted for English, translucent blurred shadow, centred (alignment 5, no vertical margin).
    expect(ass).toContain(
      'Style: Caption,Kalam,67,&H00FFFFFF,&H00FFFFFF,&H50000000,&H80000000,-1,-1,0,0,100,100,0,0,1,3,2,5,108,108,0,1',
    );
    expect(ass).toMatch(/Style: Emphasis,Kalam,77,&H00C8E7F6,/);
    // Lowercase, no trailing punctuation or ellipses, soft blur and fades.
    expect(ass).toContain(
      'Dialogue: 0,0:00:00.00,0:00:02.00,Emphasis,,0,0,0,,{\\blur3\\fad(120,120)}stop shrinking',
    );
    expect(ass).toContain("Caption,,0,0,0,,{\\blur3\\fad(120,120)}it's not weakness");
    const te = buildAss({ width: 1080, height: 1920, language: 'te', style: 'soft_handwritten', cues: [] });
    expect(te).toMatch(/Style: Caption,Timmana,78,&H00FFFFFF,&H00FFFFFF,&H50000000,&H80000000,0,0,/);
    const hi = buildAss({
      width: 1080,
      height: 1920,
      language: 'hi',
      style: 'soft_handwritten',
      cues: [{ start: 0, end: 1, text: 'यह कमज़ोरी नहीं है।' }],
    });
    expect(hi).toMatch(/Style: Caption,Kalam,71,&H00FFFFFF,&H00FFFFFF,&H50000000,&H80000000,-1,0,/);
    expect(hi).toContain('}यह कमज़ोरी नहीं है\n');
  });

  it('cuts soft captions into balanced 2-4 word chunks (2-3 for Telugu), never a lonely word', () => {
    expect(chunkCaptionText("It's not rejection. It's selection.", 'en', 'soft_handwritten')).toEqual([
      "It's not rejection.",
      "It's selection.",
    ]);
    expect(
      chunkCaptionText('Some people were only ever meant to walk you here', 'en', 'soft_handwritten'),
    ).toEqual(['Some people were', 'only ever meant', 'to walk you here']);
    expect(chunkCaptionText('You were never too much for them', 'en', 'soft_handwritten')).toEqual([
      'You were never',
      'too much for them',
    ]);
    const te = chunkCaptionText('నువ్వు ఎప్పుడూ ఎక్కువ కాదు నీకు', 'te', 'soft_handwritten');
    expect(te.every((c) => c.split(' ').length <= 3)).toBe(true);
    expect(te.join(' ')).toBe('నువ్వు ఎప్పుడూ ఎక్కువ కాదు నీకు');
    // The default bold style keeps its longer lines.
    expect(chunkCaptionText('You were never too much for them', 'en')).toEqual([
      'You were never too much for them',
    ]);
    expect(softCaptionText('I said... “No.” Fine!', 'en')).toBe('i said no fine');
    expect(softCaptionText('Why me?', 'en')).toBe('why me?');
  });
});

describe('render arguments', () => {
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
    subtitles: 'captions.ass',
    fontsDir: '../../assets/fonts',
    narration: [{ file: 'narration-1.wav', start: 0.3 }],
    musicVolume: 0.3,
    output: 'video.mp4',
  };

  it('builds a 9:16 H.264/AAC render with crossfade, captions, narration and loudness normalisation', () => {
    const args = buildRenderArgs(spec);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(args.join(' ')).toContain('-loop 1 -framerate 30 -t 3.500 -i scene-1.png');
    expect(graph).toContain('xfade=transition=fade:duration=0.5:offset=3.000');
    expect(graph).toContain(
      'ass=filename=captions.ass:fontsdir=../../assets/fonts:shaping=complex,scale=out_range=tv,format=yuv420p[vout]',
    );
    expect(graph).toContain(
      '[2:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=delays=300:all=1[n0]',
    );
    expect(graph).toContain('amix=inputs=2');
    expect(graph).toContain('loudnorm=I=-16');
    expect(args).toEqual(expect.arrayContaining(['libx264', 'yuv420p', 'aac', '+faststart', 'video.mp4']));
    expect(args.join(' ')).toContain('-crf 20 -maxrate 8M -bufsize 16M');
    expect(args[args.indexOf('-t', args.indexOf('-map')) + 1]).toBe('6.000');
  });

  it('uses a silent bed when music is off', () => {
    const graph = buildRenderArgs({ ...spec, musicVolume: 0, narration: [] }).join(' ');
    expect(graph).toContain('anullsrc');
    expect(graph).not.toContain('aevalsrc');
  });

  it('applies the brand film grade (desaturation, animated grain, vignette) before the captions', () => {
    const args = buildRenderArgs({ ...spec, grade: { saturation: 0.9, grain: 10, vignette: true } });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[x1]eq=saturation=0.9,noise=c0s=10:c0f=t,vignette=angle=PI/6[graded]');
    expect(graph).toContain('[graded]ass=filename=captions.ass');
    expect(buildRenderArgs(spec).join(' ')).not.toContain('noise=');
    const vivid = buildRenderArgs({
      ...spec,
      grade: { saturation: 1.06, contrast: 1.05, grain: 4, vignette: false },
    }).join(' ');
    expect(vivid).toContain('[x1]eq=saturation=1.06:contrast=1.05,noise=c0s=4:c0f=t[graded]');
  });

  it('adds the warm lo-fi finish: temperature, faded blacks, procedural dust under a strong vignette', () => {
    const args = buildRenderArgs({
      ...spec,
      grade: {
        saturation: 0.92,
        contrast: 1.04,
        grain: 7,
        vignette: true,
        vignetteAngle: 0.8,
        temperature: 5600,
        fade: 0.05,
        dust: true,
      },
    });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain(
      "[x1]eq=saturation=0.92:contrast=1.04,colortemperature=temperature=5600,curves=m='0/0.050 1/0.980',noise=c0s=7:c0f=t[graded]",
    );
    expect(graph).toContain('nullsrc=s=270x480:r=10:d=6.000,format=gray,geq=');
    expect(graph).toContain(
      '[graded]format=gbrp[predust];[predust][dust]blend=all_mode=multiply:all_opacity=0.6:shortest=1,format=yuv420p,vignette=angle=0.80[dusty]',
    );
    expect(graph).toContain('[dusty]ass=filename=captions.ass');
  });

  it('scales the camera move for near-still scenes', () => {
    expect(motionFilter('zoom-in', 1080, 1920, 3, 30)).toContain(
      "scale=w='trunc(1080*(1+0.10*t/3.000)/2)*2'",
    );
    expect(motionFilter('zoom-in', 1080, 1920, 3, 30, 0.45)).toContain(
      "scale=w='trunc(1080*(1+0.045*t/3.000)/2)*2'",
    );
    expect(motionFilter('pan-right', 1080, 1920, 3, 30, 0.45)).toContain(
      "x='(in_w-out_w)*(0.5+0.45*(t/3.000-0.5))'",
    );
    expect(motionFilter('pan-left', 1080, 1920, 3, 30)).toContain("x='(in_w-out_w)*(1-t/3.000)'");
    const graph = buildRenderArgs({ ...spec, motionStrength: 0.45 }).join(' ');
    expect(graph).toContain('1+0.045*t/');
  });

  it('cover-crops any source aspect ratio, then moves within the 9:16 frame', () => {
    for (const m of ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const) {
      expect(motionFilter(m, 1080, 1920, 3, 30)).toMatch(
        /^scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,.*crop=1080:1920.*format=yuv420p,settb=AVTB$/,
      );
    }
  });
});

describe('video QA', () => {
  const good: VideoProbe = {
    fileBytes: 2_000_000,
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    durationSec: 18.2,
    video: { codec: 'h264', width: 1080, height: 1920, pixFmt: 'yuv420p', fps: 30 },
    audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
    meanVolumeDb: -19,
    maxVolumeDb: -1.4,
    decodeErrors: [],
  };
  const expectations = { width: 1080, height: 1920, fps: 30 };

  it('passes a correct vertical video', () => {
    const checks = evaluateVideo(good, expectations);
    expect(checks.every((c) => c.status === 'passed')).toBe(true);
    expect(checks.find((c) => c.name === 'duration')!.detail).toContain('13-20');
  });

  it.each([
    ['missing audio', { audio: undefined, meanVolumeDb: undefined, maxVolumeDb: undefined }, 'audio_present'],
    ['silence', { meanVolumeDb: -91 }, 'audio_not_silent'],
    ['clipping', { maxVolumeDb: 0 }, 'audio_no_clipping'],
    ['landscape', { video: { ...good.video!, width: 1920, height: 1080 } }, 'aspect_ratio_9_16'],
    ['too long', { durationSec: 61 }, 'duration'],
    ['too short', { durationSec: 5 }, 'duration'],
    ['corrupt', { decodeErrors: ['Invalid NAL unit size'] }, 'mp4_integrity'],
  ])('fails on %s', (_name, patch, failing) => {
    const checks = evaluateVideo({ ...good, ...patch }, expectations);
    expect(checks.find((c) => c.name === failing)!.status).toBe('failed');
    expect(qaPassed(checks)).toBe(false);
  });

  it('only warns on an off frame rate', () => {
    const checks = evaluateVideo({ ...good, video: { ...good.video!, fps: 25 } }, expectations);
    expect(checks.find((c) => c.name === 'frame_rate')!.status).toBe('warning');
    expect(qaPassed(checks)).toBe(true);
  });
});

describe('demo scripts', () => {
  it('match their brand language and come from three different brands', () => {
    for (const s of DEMO_SCRIPTS) {
      const brand = BRANDS.find((b) => b.id === s.brandId)!;
      expect(s.language).toBe(brand.language);
      expect(brand.contentSlots.map((c) => c.category)).toContain(s.contentCategory);
    }
    expect(new Set(DEMO_SCRIPTS.map((s) => s.language)).size).toBe(3);
  });
});
