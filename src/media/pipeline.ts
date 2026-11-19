import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrandConfig } from '../brands/index.js';
import type {
  Language,
  OneShotSfx,
  PaletteMood,
  Pause,
  Platform,
  ShotType,
  StoryBeat,
} from '../domain/constants.js';
import { durationBucketFor, PAUSE_SECONDS } from '../domain/constants.js';
import type { AudioAsset, SoundPlan } from './audio-library.js';
import { licenceRecord, saveSoundPlan } from './audio-library.js';
import type { CaptionCue } from './captions.js';
import { buildAss, cuesFromAlignment, splitIntoCues } from './captions.js';
import type { FfmpegTools } from './ffmpeg.js';
import { resolveFfmpeg } from './ffmpeg.js';
import type { Illustration, Illustrator } from './illustrator.js';
import { mapLimit, PlaceholderIllustrator } from './illustrator.js';
import type { QaCheck } from './qa.js';
import { evaluateAudioRights, evaluateDurationTarget, evaluateVideo, probeVideo, qaPassed } from './qa.js';
import type { Motion, RenderAudioBed, RenderNarration, RenderScene, RenderSfx } from './render.js';
import { even, extractThumbnail, MOTIONS, OVERSCAN, renderVideo } from './render.js';
import { buildTimeline, estimateSpeechSeconds, sceneDuration, totalDuration } from './timeline.js';
import type { NarrationClip, VoiceProvider } from './voice.js';

export const DEFAULT_FONTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'fonts',
);

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface VideoScriptScene {
  narration: string;
  /** Visual direction for the illustration provider (placeholder art ignores it). */
  visual: string;
  /** Placeholder-art hint: how many props (fruit/stars) to draw, e.g. for counting scenes. */
  props?: number;
  /** Story beat (hook, message, metaphor, conclusion; or hook, story, payoff). */
  beat?: StoryBeat;
  /** Camera move chosen by the script; otherwise moves cycle through MOTIONS. */
  camera?: Motion;
  /** One-shot sound effect requested at the start of this scene. */
  sfx?: OneShotSfx | 'none';
  /** Short English voice direction, sent as an audio tag when the brand allows it. */
  delivery?: string;
  /** Silence after this line: beat = 0.7 s, pause = 1.2 s. */
  pause?: Pause;
  shot?: ShotType;
  palette?: PaletteMood;
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
  /** Defaults to free placeholder art. */
  illustrator?: Illustrator;
  /** Max parallel illustration requests. */
  illustrationConcurrency?: number;
  /** Recurring character description passed to every illustration request. */
  characterDescription?: string;
  /** Extra data stored in manifest.json (e.g. script generation cost). */
  manifestExtra?: Record<string, unknown>;
  /**
   * Licensed audio chosen by planSoundDesign(). When set, the synthesized pad is never used: missing
   * music means no music (copyright-safe fallback). Files are copied into the work dir and checksummed.
   */
  soundPlan?: SoundPlan;
  /** Directory that AudioAsset.storageUri paths are relative to (default: repository root). */
  audioRoot?: string;
  /** Platforms the video is meant for (audio rights QA). Defaults to the brand's platforms. */
  platforms?: readonly Platform[];
  /** Whether the publisher will include attribution text (allows CC-BY style assets). */
  canPublishAttribution?: boolean;
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
  illustrator: string;
  illustrationCostUsd: number;
  voiceCostUsd: number;
  /** How many scenes had captions synced to real speech timings. */
  captionsAlignedScenes: number;
  /** Narration per scene (absolute paths), reusable for platform-specific versions. */
  narrationClips: (NarrationClip | undefined)[];
  /** Scene image file names inside the work dir, reusable for platform-specific versions. */
  imageFiles: string[];
  /** Background music used, e.g. "synthesized pad (original)" or a library asset code. */
  music: string;
  qa: QaCheck[];
  passed: boolean;
  renderSeconds: number;
}

const posix = (p: string) => p.split(sep).join('/');

const EMPHASIS_BEATS: ReadonlySet<StoryBeat> = new Set(['hook', 'metaphor']);

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

interface StagedAudio {
  asset: AudioAsset;
  /** Path relative to the work dir. */
  file: string;
  fileSha256: string;
}

/** Copies library audio into the work dir (filter-safe relative paths) and checksums it for rights QA. */
function stageAudio(asset: AudioAsset, workDir: string, root: string): StagedAudio {
  const source = resolve(root, asset.storageUri);
  if (!existsSync(source))
    throw new Error(`Audio file for ${asset.assetCode} not found: ${asset.storageUri}`);
  mkdirSync(join(workDir, 'audio'), { recursive: true });
  const file = `audio/${asset.assetCode}${extname(source).toLowerCase()}`;
  copyFileSync(source, join(workDir, file));
  return { asset, file, fileSha256: sha256(join(workDir, file)) };
}

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
  const transition = opts.transition ?? brand.visualIdentity.motion?.transition ?? 0.5;
  const captionStyle = brand.visualIdentity.captionStyle ?? 'bold';
  const tools = opts.tools ?? resolveFfmpeg();
  const started = Date.now();
  mkdirSync(workDir, { recursive: true });

  // 1. Narration (or estimated speaking time when no voice is available for this language).
  const voice = opts.voice?.supports(script.language, brand.id) ? opts.voice : null;
  const speech: number[] = [];
  const clips: (NarrationClip | undefined)[] = [];
  for (const [i, scene] of script.scenes.entries()) {
    if (voice) {
      const clip = await voice.synthesize(
        scene.narration,
        script.language,
        join(workDir, `narration-${i + 1}.wav`),
        {
          brandId: brand.id,
          previousText: script.scenes[i - 1]?.narration,
          nextText: script.scenes[i + 1]?.narration,
          direction: brand.voice.audioTags ? scene.delivery : undefined,
          signal: opts.signal,
        },
      );
      speech.push(clip.durationSec);
      clips.push(clip);
    } else {
      speech.push(estimateSpeechSeconds(scene.narration, script.language));
      clips.push(undefined);
    }
  }
  const voiceCostUsd = clips.reduce((sum, c) => sum + (c?.costUsd ?? 0), 0);

  // 2. Timeline ([BEAT]/[PAUSE] add silence after a line).
  const timeline = buildTimeline(
    speech.map((s, i) => sceneDuration(s, PAUSE_SECONDS[script.scenes[i]!.pause ?? 'none'])),
    transition,
  );
  const total = totalDuration(timeline);

  // 3. Illustrations (free placeholder by default; OpenAI images when an illustrator is passed).
  const illustrator = opts.illustrator ?? new PlaceholderIllustrator();
  const illustrations: Illustration[] = await mapLimit(
    script.scenes,
    opts.illustrationConcurrency ?? 2,
    (scene, i) =>
      illustrator.generate({
        brand,
        sceneIndex: i,
        sceneCount: script.scenes.length,
        visual: scene.visual,
        shot: scene.shot,
        palette: scene.palette,
        characterDescription: opts.characterDescription,
        seed: `${brand.id}:${script.title}`,
        props: scene.props,
        width: even(width * OVERSCAN),
        height: even(height * OVERSCAN),
        workDir,
        signal: opts.signal,
      }),
  );
  const scenes: RenderScene[] = illustrations.map((ill, i) => ({
    image: ill.file,
    motion: script.scenes[i]!.camera ?? MOTIONS[i % MOTIONS.length]!,
  }));
  const illustrationCostUsd = illustrations.reduce((sum, ill) => sum + ill.costUsd, 0);

  // 4. Captions (synced to the provider's character timings when available) + narration placement.
  const cues: CaptionCue[] = [];
  const narration: RenderNarration[] = [];
  let alignedScenes = 0;
  timeline.forEach((t, i) => {
    const speechStart = t.start + (i === 0 ? 0.3 : transition * 0.6);
    const speechLen = Math.max(0.8, Math.min(speech[i]!, t.start + t.duration - speechStart - 0.1));
    const text = script.scenes[i]!.narration;
    const clip = clips[i];
    const aligned = clip?.alignment
      ? cuesFromAlignment(text, clip.alignment, speechStart, script.language, captionStyle)
      : null;
    if (aligned) alignedScenes++;
    // The hook and the metaphor are the lines that must work as on-screen text without audio.
    const emphasis = EMPHASIS_BEATS.has(script.scenes[i]!.beat ?? 'story');
    const sceneCues = aligned ?? splitIntoCues(text, speechStart, speechLen, script.language, captionStyle);
    cues.push(...sceneCues.map((c) => (emphasis ? { ...c, style: 'emphasis' as const } : c)));
    if (clip) narration.push({ file: posix(relative(workDir, clip.file)), start: speechStart });
  });
  writeFileSync(
    join(workDir, 'captions.ass'),
    buildAss({ width, height, language: script.language, cues, label: opts.label, style: captionStyle }),
    'utf8',
  );

  // 5. Licensed audio (music, ambience, effects) from the sound plan.
  const plan = opts.soundPlan;
  const audioRoot = opts.audioRoot ?? REPO_ROOT;
  const staged: StagedAudio[] = [];
  const stage = (asset: AudioAsset) => {
    const s = stageAudio(asset, workDir, audioRoot);
    staged.push(s);
    return s;
  };
  const musicBed: RenderAudioBed | undefined = plan?.music
    ? { file: stage(plan.music.asset).file, volume: plan.music.volume }
    : undefined;
  const ambienceBed: RenderAudioBed | undefined = plan?.ambience
    ? { file: stage(plan.ambience.asset).file, volume: plan.ambience.volume }
    : undefined;
  const sfx: RenderSfx[] = (plan?.sfx ?? [])
    .filter((s) => s.sceneIndex < timeline.length)
    .map((s) => ({ file: stage(s.asset).file, start: timeline[s.sceneIndex]!.start, volume: s.volume }));
  const musicLabel = plan
    ? plan.music
      ? `${plan.music.asset.title} (${plan.music.asset.assetCode}, ${plan.music.asset.licenceType})`
      : 'none (no approved licensed track - copyright-safe fallback)'
    : 'synthesized pad (original)';

  // 6. Render.
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
      musicVolume: plan ? 0 : (opts.musicVolume ?? (voice ? 0.25 : 0.6)),
      music: musicBed,
      ambience: ambienceBed,
      sfx,
      grade: brand.visualIdentity.grade,
      motionStrength: brand.visualIdentity.motion?.strength,
      output: 'video.mp4',
      preset: opts.preset,
    },
    { cwd: workDir, tools, signal: opts.signal },
  );
  await extractThumbnail('video.mp4', 'thumbnail.jpg', Math.min(1.5, total / 2), { cwd: workDir, tools });

  // 7. Automated QA.
  const video = join(workDir, 'video.mp4');
  const probe = await probeVideo(video, tools);
  const platforms = opts.platforms ?? brand.platforms;
  const qa = evaluateVideo(probe, { width, height, fps });
  qa.push(evaluateAudioRights(staged, platforms, { canPublishAttribution: opts.canPublishAttribution }));
  const target = evaluateDurationTarget(probe.durationSec, brand.durationTarget);
  if (target) qa.push(target);
  const result: ProduceVideoResult = {
    video,
    thumbnail: join(workDir, 'thumbnail.jpg'),
    durationSec: probe.durationSec,
    durationBucket: durationBucketFor(probe.durationSec),
    voice: voice?.name ?? 'none (captions timed by estimated speaking pace)',
    illustrator: illustrator.name,
    illustrationCostUsd: Math.round(illustrationCostUsd * 10000) / 10000,
    voiceCostUsd: Math.round(voiceCostUsd * 10000) / 10000,
    captionsAlignedScenes: alignedScenes,
    narrationClips: clips,
    imageFiles: illustrations.map((ill) => ill.file),
    music: musicLabel,
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
        // On-screen label (e.g. "AI TEST · not for publishing"); the publishing gate refuses labelled renders.
        label: opts.label ?? null,
        language: script.language,
        contentCategory: script.contentCategory,
        scenes: script.scenes,
        characterDescription: opts.characterDescription ?? null,
        providers: {
          illustration: illustrator.name,
          voice: result.voice,
          music: musicLabel,
        },
        audio: {
          platforms,
          plan: plan?.notes ?? ['no sound plan (demo): synthesized original pad'],
          soundPlan: plan ? saveSoundPlan(plan) : null,
          files: staged.map((s) => ({ file: s.file, sha256: s.fileSha256, licence: licenceRecord(s.asset) })),
          mix: {
            music: musicBed ?? null,
            ambience: ambienceBed ?? null,
            sfx,
            ducking: musicBed || ambienceBed ? 'sidechain under narration' : null,
          },
        },
        illustrations: illustrations.map((ill, i) => ({
          scene: i + 1,
          visual: script.scenes[i]!.visual,
          ...ill,
        })),
        narrationClips: clips.map((c, i) =>
          c
            ? {
                scene: i + 1,
                file: posix(relative(workDir, c.file)),
                durationSec: c.durationSec,
                costUsd: c.costUsd ?? 0,
                aligned: !!c.alignment,
                provenance: c.provenance,
              }
            : { scene: i + 1, file: null },
        ),
        ...opts.manifestExtra,
        timeline: timeline.map((t, i) => ({ scene: i + 1, ...t, narration: script.scenes[i]!.narration })),
        captions: cues,
        result: {
          ...result,
          narrationClips: undefined,
          imageFiles: undefined,
          video: 'video.mp4',
          thumbnail: 'thumbnail.jpg',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  if (!existsSync(video)) throw new Error('Render finished without producing video.mp4');
  return result;
}
