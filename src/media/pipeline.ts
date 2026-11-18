import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrandConfig } from '../brands/index.js';
import type { Language } from '../domain/constants.js';
import { durationBucketFor } from '../domain/constants.js';
import type { CaptionCue } from './captions.js';
import { buildAss, splitIntoCues } from './captions.js';
import type { FfmpegTools } from './ffmpeg.js';
import { resolveFfmpeg } from './ffmpeg.js';
import { renderPlaceholderScene } from './placeholder-art.js';
import type { QaCheck } from './qa.js';
import { evaluateVideo, probeVideo, qaPassed } from './qa.js';
import type { RenderNarration, RenderScene } from './render.js';
import { even, extractThumbnail, MOTIONS, OVERSCAN, renderVideo } from './render.js';
import { buildTimeline, estimateSpeechSeconds, sceneDuration, totalDuration } from './timeline.js';
import type { VoiceProvider } from './voice.js';

export const DEFAULT_FONTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'fonts',
);

export interface VideoScriptScene {
  narration: string;
  /** Visual direction for the illustration provider (placeholder art ignores it). */
  visual: string;
  /** Placeholder-art hint: how many props (fruit/stars) to draw, e.g. for counting scenes. */
  props?: number;
}

export interface VideoScript {
  brandId: string;
  title: string;
  contentCategory: string;
  language: Language;
  scenes: VideoScriptScene[];
}

export interface ProduceVideoOptions {
  brand: BrandConfig;
  script: VideoScript;
  workDir: string;
  voice?: VoiceProvider | null;
  width?: number;
  height?: number;
  fps?: number;
  transition?: number;
  musicVolume?: number;
  preset?: 'ultrafast' | 'veryfast' | 'medium';
  /** Small on-screen label, e.g. "DEMO · placeholder art & voice". */
  label?: string;
  fontsDir?: string;
  tools?: FfmpegTools;
  signal?: AbortSignal;
}

export interface ProduceVideoResult {
  video: string;
  thumbnail: string;
  durationSec: number;
  durationBucket: string | null;
  voice: string;
  qa: QaCheck[];
  passed: boolean;
  renderSeconds: number;
}

const posix = (p: string) => p.split(sep).join('/');

/** libass needs a fonts path inside a filter argument: relative, '/' separators, no drive colon. */
function fontsPathFor(workDir: string, fontsDir: string): string {
  const rel = posix(relative(workDir, fontsDir));
  if (rel && !rel.includes(':') && !/[\s,;'[\]]/.test(rel)) return rel;
  const local = join(workDir, 'fonts');
  mkdirSync(local, { recursive: true });
  for (const f of readdirSync(fontsDir).filter((n) => n.endsWith('.ttf')))
    copyFileSync(join(fontsDir, f), join(local, f));
  return 'fonts';
}

/**
 * Script → narration → scene timing → illustrations → captions → FFmpeg render → thumbnail → QA.
 * Providers are pluggable; today illustrations are placeholders and voice is optional.
 */
export async function produceVideo(opts: ProduceVideoOptions): Promise<ProduceVideoResult> {
  const { brand, script, workDir } = opts;
  if (script.brandId !== brand.id) throw new Error(`Script belongs to ${script.brandId}, not ${brand.id}`);
  if (script.language !== brand.language) {
    throw new Error(`Script language ${script.language} does not match brand language ${brand.language}`);
  }
  if (script.scenes.length === 0) throw new Error('Script has no scenes');

  const width = opts.width ?? 1080;
  const height = opts.height ?? 1920;
  const fps = opts.fps ?? 30;
  const transition = opts.transition ?? 0.5;
  const tools = opts.tools ?? resolveFfmpeg();
  const started = Date.now();
  mkdirSync(workDir, { recursive: true });

  // 1. Narration (or estimated speaking time when no voice is available for this language).
  const voice = opts.voice?.supports(script.language) ? opts.voice : null;
  const speech: number[] = [];
  const narrationFiles: (string | undefined)[] = [];
  for (const [i, scene] of script.scenes.entries()) {
    if (voice) {
      const clip = await voice.synthesize(
        scene.narration,
        script.language,
        join(workDir, `narration-${i + 1}.wav`),
      );
      speech.push(clip.durationSec);
      narrationFiles.push(`narration-${i + 1}.wav`);
    } else {
      speech.push(estimateSpeechSeconds(scene.narration, script.language));
      narrationFiles.push(undefined);
    }
  }

  // 2. Timeline.
  const timeline = buildTimeline(speech.map(sceneDuration), transition);
  const total = totalDuration(timeline);

  // 3. Illustrations (placeholder until the Phase 5 illustration provider is integrated).
  const scenes: RenderScene[] = script.scenes.map((scene, i) => {
    const image = `scene-${i + 1}.png`;
    writeFileSync(
      join(workDir, image),
      renderPlaceholderScene({
        width: even(width * OVERSCAN),
        height: even(height * OVERSCAN),
        palette: brand.visualIdentity.palette,
        sceneIndex: i,
        sceneCount: script.scenes.length,
        seed: `${brand.id}:${script.title}`,
        props: scene.props,
      }),
    );
    return { image, motion: MOTIONS[i % MOTIONS.length]! };
  });

  // 4. Captions + narration placement.
  const cues: CaptionCue[] = [];
  const narration: RenderNarration[] = [];
  timeline.forEach((t, i) => {
    const speechStart = t.start + (i === 0 ? 0.3 : transition * 0.6);
    const speechLen = Math.max(0.8, Math.min(speech[i]!, t.start + t.duration - speechStart - 0.1));
    cues.push(...splitIntoCues(script.scenes[i]!.narration, speechStart, speechLen, script.language));
    const file = narrationFiles[i];
    if (file) narration.push({ file, start: speechStart });
  });
  writeFileSync(
    join(workDir, 'captions.ass'),
    buildAss({ width, height, language: script.language, cues, label: opts.label }),
    'utf8',
  );

  // 5. Render.
  await renderVideo(
    {
      width,
      height,
      fps,
      scenes,
      timeline,
      transition,
      subtitles: 'captions.ass',
      fontsDir: fontsPathFor(workDir, opts.fontsDir ?? DEFAULT_FONTS_DIR),
      narration,
      musicVolume: opts.musicVolume ?? (voice ? 0.25 : 0.6),
      output: 'video.mp4',
      preset: opts.preset,
    },
    { cwd: workDir, tools, signal: opts.signal },
  );
  await extractThumbnail('video.mp4', 'thumbnail.jpg', Math.min(1.5, total / 2), { cwd: workDir, tools });

  // 6. Automated QA.
  const video = join(workDir, 'video.mp4');
  const probe = await probeVideo(video, tools);
  const qa = evaluateVideo(probe, { width, height, fps });
  const result: ProduceVideoResult = {
    video,
    thumbnail: join(workDir, 'thumbnail.jpg'),
    durationSec: probe.durationSec,
    durationBucket: durationBucketFor(probe.durationSec),
    voice: voice?.name ?? 'none (placeholder music bed; captions timed by estimated speaking pace)',
    qa,
    passed: qaPassed(qa),
    renderSeconds: Math.round((Date.now() - started) / 100) / 10,
  };
  writeFileSync(
    join(workDir, 'manifest.json'),
    JSON.stringify(
      {
        brandId: brand.id,
        title: script.title,
        language: script.language,
        contentCategory: script.contentCategory,
        providers: {
          illustration: 'placeholder (local)',
          voice: result.voice,
          music: 'synthesized pad (original)',
        },
        timeline: timeline.map((t, i) => ({ scene: i + 1, ...t, narration: script.scenes[i]!.narration })),
        captions: cues,
        result: { ...result, video: 'video.mp4', thumbnail: 'thumbnail.jpg' },
      },
      null,
      2,
    ),
    'utf8',
  );
  if (!existsSync(video)) throw new Error('Render finished without producing video.mp4');
  return result;
}
