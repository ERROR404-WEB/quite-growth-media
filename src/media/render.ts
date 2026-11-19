import type { FfmpegTools } from './ffmpeg.js';
import { resolveFfmpeg, run } from './ffmpeg.js';
import type { TimelineEntry } from './timeline.js';
import { totalDuration } from './timeline.js';

export const MOTIONS = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'] as const;
export type Motion = (typeof MOTIONS)[number];

/** Source images should be this much larger than the output so motion never shows edges. */
export const OVERSCAN = 1.1;

export const even = (n: number) => Math.round(n / 2) * 2;

export interface RenderScene {
  /** Image path relative to the render working directory. */
  image: string;
  motion: Motion;
}

export interface RenderNarration {
  /** Audio path relative to the render working directory. */
  file: string;
  /** Seconds from the start of the video. */
  start: number;
}

/** A licensed music or ambience file, looped/trimmed to the video length and faded in/out. */
export interface RenderAudioBed {
  /** Path relative to the render working directory. */
  file: string;
  /** Linear gain before loudness normalisation. */
  volume: number;
}

export interface RenderSfx {
  file: string;
  start: number;
  volume: number;
}

/** Sidechain ducking: music and ambience dip under the narration and return in the gaps. */
export const DUCKING = 'sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400';

export interface RenderSpec {
  width: number;
  height: number;
  fps: number;
  scenes: readonly RenderScene[];
  timeline: readonly TimelineEntry[];
  transition: number;
  /** ASS subtitle file relative to the working directory. */
  subtitles?: string;
  /** Font directory relative to the working directory, forward slashes, no ':' (filter syntax). */
  fontsDir?: string;
  narration: readonly RenderNarration[];
  /** 0..1 level of the generated background pad; 0 disables it. Ignored when music or ambience is set. */
  musicVolume: number;
  /** Licensed music from the audio library (replaces the synthesized pad). */
  music?: RenderAudioBed;
  /** Licensed ambience bed (rain, city, room…). */
  ambience?: RenderAudioBed;
  sfx?: readonly RenderSfx[];
  /** Film look over the whole picture (before captions): colour, grain, dust, vignette. */
  grade?: {
    saturation: number;
    contrast?: number;
    grain: number;
    vignette: boolean;
    vignetteAngle?: number;
    temperature?: number;
    fade?: number;
    dust?: boolean;
  };
  /** Scales every Ken Burns move (1 = full overscan; the reference look uses ~0.45 = near-still). */
  motionStrength?: number;
  output: string;
  preset?: 'ultrafast' | 'veryfast' | 'medium';
}

/** Video filter for one scene: overscan, Ken Burns motion, then normalise for xfade. */
export function motionFilter(
  motion: Motion,
  width: number,
  height: number,
  length: number,
  fps: number,
  strength = 1,
): string {
  const ow = even(width * OVERSCAN);
  const oh = even(height * OVERSCAN);
  const L = length.toFixed(3);
  const s = Math.min(1, Math.max(0.1, strength));
  const amount = s === 1 ? (OVERSCAN - 1).toFixed(2) : ((OVERSCAN - 1) * s).toFixed(3);
  const zoom = (expr: string) =>
    `scale=w='trunc(${width}*(1+${amount}*${expr})/2)*2':h=-2:eval=frame,crop=${width}:${height}`;
  // A weaker pan drifts around the centre instead of travelling edge to edge.
  const pan = (progress: string) => (s === 1 ? progress : `(0.5+${s.toFixed(2)}*(${progress}-0.5))`);
  const motionPart = {
    'zoom-in': zoom(`t/${L}`),
    'zoom-out': zoom(`(1-t/${L})`),
    'pan-right': `crop=${width}:${height}:x='(in_w-out_w)*${pan(`t/${L}`)}':y='(in_h-out_h)/2'`,
    'pan-left': `crop=${width}:${height}:x='(in_w-out_w)*${pan(`(1-t/${L})`)}':y='(in_h-out_h)/2'`,
  }[motion];
  return `scale=${ow}:${oh}:force_original_aspect_ratio=increase,crop=${ow}:${oh},${motionPart},setsar=1,fps=${fps},format=yuv420p,settb=AVTB`;
}

/**
 * Procedural film dust (original, no licence): sparse dark specks on white, drawn at quarter resolution
 * so each speck is a few pixels wide, held for ~3 frames like real dust on a projected print. RGB so
 * that a multiply blend leaves every colour untouched except under a speck.
 */
export function dustSource(width: number, height: number, fps: number, total: number): string {
  const w = even(width / 4);
  const h = even(height / 4);
  return (
    `nullsrc=s=${w}x${h}:r=10:d=${total.toFixed(3)},format=gray,` +
    `geq=lum='if(lt(random(1),0.00006),0,255)',` +
    `scale=${width}:${height}:flags=neighbor,gblur=sigma=1.3,fps=${fps},format=gbrp`
  );
}

/** Soft, original synthesized pad (A major chord with slow tremolo) - no licensing questions. */
export const PAD_EXPRESSION = [
  '0.08*sin(2*PI*220*t)*(0.7+0.3*sin(2*PI*0.2*t))',
  '0.06*sin(2*PI*277.18*t)*(0.7+0.3*sin(2*PI*0.23*t))',
  '0.06*sin(2*PI*329.63*t)*(0.7+0.3*sin(2*PI*0.17*t))',
].join('+');

export function buildRenderArgs(spec: RenderSpec): string[] {
  const { width, height, fps, scenes, timeline, transition } = spec;
  if (scenes.length === 0 || scenes.length !== timeline.length)
    throw new Error('scenes and timeline must match');
  const total = totalDuration(timeline);
  const args = ['-hide_banner', '-nostats', '-loglevel', 'error'];
  scenes.forEach((s, i) =>
    args.push(
      '-loop',
      '1',
      '-framerate',
      String(fps),
      '-t',
      timeline[i]!.streamLength.toFixed(3),
      '-i',
      s.image,
    ),
  );
  spec.narration.forEach((n) => args.push('-i', n.file));
  const beds = [spec.music, spec.ambience].filter((b): b is RenderAudioBed => !!b);
  // Beds loop until the -t limit, so a short track still spans the whole video.
  beds.forEach((b) => args.push('-stream_loop', '-1', '-t', total.toFixed(3), '-i', b.file));
  const sfx = spec.sfx ?? [];
  sfx.forEach((s) => args.push('-i', s.file));
  const bedInput = scenes.length + spec.narration.length;
  const sfxInput = bedInput + beds.length;

  const graph: string[] = [];
  scenes.forEach((s, i) =>
    graph.push(
      `[${i}:v]${motionFilter(s.motion, width, height, timeline[i]!.streamLength, fps, spec.motionStrength)}[v${i}]`,
    ),
  );
  let last = 'v0';
  for (let i = 1; i < scenes.length; i++) {
    graph.push(
      `[${last}][v${i}]xfade=transition=fade:duration=${transition}:offset=${timeline[i]!.start.toFixed(3)}[x${i}]`,
    );
    last = `x${i}`;
  }
  // Normalise to limited ("TV") range yuv420p: JPEG sources arrive as full-range yuvj420p,
  // which some platforms and players mishandle.
  const finish = 'scale=out_range=tv,format=yuv420p';
  if (spec.grade) {
    const g = spec.grade;
    const eq = [
      g.saturation !== 1 ? `saturation=${g.saturation}` : '',
      g.contrast !== undefined && g.contrast !== 1 ? `contrast=${g.contrast}` : '',
    ].filter(Boolean);
    const fade = g.fade ?? 0;
    const vignette = g.vignette
      ? `vignette=angle=${g.vignetteAngle !== undefined ? g.vignetteAngle.toFixed(2) : 'PI/6'}`
      : '';
    const parts = [
      eq.length ? `eq=${eq.join(':')}` : '',
      g.temperature !== undefined && g.temperature !== 6500
        ? `colortemperature=temperature=${g.temperature}`
        : '',
      // Lifted blacks and slightly softened whites = faded film print.
      fade > 0 ? `curves=m='0/${fade.toFixed(3)} 1/${(1 - fade * 0.4).toFixed(3)}'` : '',
      g.grain > 0 ? `noise=c0s=${g.grain}:c0f=t` : '',
      // Dust sits under the vignette, so with dust the vignette is applied after the blend.
      g.dust ? '' : vignette,
    ].filter(Boolean);
    if (parts.length) {
      graph.push(`[${last}]${parts.join(',')}[graded]`);
      last = 'graded';
    }
    if (g.dust) {
      graph.push(`${dustSource(width, height, fps, total)}[dust]`);
      // Multiply in RGB against white: only the specks darken, colours stay exact.
      graph.push(
        `[${last}]format=gbrp[predust];[predust][dust]blend=all_mode=multiply:all_opacity=0.6:shortest=1,format=yuv420p${vignette ? `,${vignette}` : ''}[dusty]`,
      );
      last = 'dusty';
    }
  }
  if (spec.subtitles) {
    const fonts = spec.fontsDir ? `:fontsdir=${spec.fontsDir}` : '';
    graph.push(`[${last}]ass=filename=${spec.subtitles}${fonts}:shaping=complex,${finish}[vout]`);
  } else {
    graph.push(`[${last}]${finish}[vout]`);
  }

  const STEREO = 'aformat=sample_rates=48000:channel_layouts=stereo';
  const fadeOut = Math.max(0, total - 1.5).toFixed(3);
  const narrationLabels = spec.narration.map((n, k) => {
    const ms = Math.round(n.start * 1000);
    graph.push(`[${scenes.length + k}:a]${STEREO},adelay=delays=${ms}:all=1[n${k}]`);
    return `[n${k}]`;
  });

  const mixInputs: string[] = [];
  if (beds.length > 0) {
    // A silent base guarantees the bed spans the full video before ducking.
    graph.push(`anullsrc=r=48000:cl=stereo:d=${total.toFixed(3)}[sil]`);
    const bedLabels = beds.map((b, j) => {
      graph.push(
        `[${bedInput + j}:a]${STEREO},atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,volume=${b.volume},` +
          `afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=1.5[bed${j}]`,
      );
      return `[bed${j}]`;
    });
    graph.push(`[sil]${bedLabels.join('')}amix=inputs=${beds.length + 1}:duration=first:normalize=0[bgraw]`);
    if (narrationLabels.length > 0) {
      const voice =
        narrationLabels.length === 1
          ? `${narrationLabels[0]}anull`
          : `${narrationLabels.join('')}amix=inputs=${narrationLabels.length}:duration=longest:normalize=0`;
      // The sidechain must last as long as the bed, or the compressor would end the stream early.
      graph.push(`${voice},apad=whole_dur=${total.toFixed(3)},asplit=2[voice][voicekey]`);
      graph.push(`[bgraw][voicekey]${DUCKING}[bed]`);
      mixInputs.push('[bed]', '[voice]');
    } else {
      graph.push('[bgraw]anull[bed]');
      mixInputs.push('[bed]');
    }
  } else {
    if (spec.musicVolume > 0) {
      graph.push(
        `aevalsrc=${PAD_EXPRESSION}:s=48000:d=${total.toFixed(3)},volume=${spec.musicVolume},` +
          `afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=1.5,${STEREO}[bed]`,
      );
    } else {
      // Silent base track so the mix always spans the full video.
      graph.push(`anullsrc=r=48000:cl=stereo:d=${total.toFixed(3)}[bed]`);
    }
    mixInputs.push('[bed]', ...narrationLabels);
  }
  sfx.forEach((s, k) => {
    const ms = Math.round(s.start * 1000);
    graph.push(`[${sfxInput + k}:a]${STEREO},volume=${s.volume},adelay=delays=${ms}:all=1[sfx${k}]`);
    mixInputs.push(`[sfx${k}]`);
  });
  graph.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0,` +
      'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]',
  );

  args.push(
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    spec.preset ?? 'medium',
    '-crf',
    '20',
    // Film grain is costly to encode; cap the bitrate so files stay upload-friendly (~1 MB/s).
    '-maxrate',
    '8M',
    '-bufsize',
    '16M',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-r',
    String(fps),
    '-g',
    String(fps * 2),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-t',
    total.toFixed(3),
    '-movflags',
    '+faststart',
    '-y',
    spec.output,
  );
  return args;
}

export async function renderVideo(
  spec: RenderSpec,
  options: { cwd: string; tools?: FfmpegTools; signal?: AbortSignal },
): Promise<void> {
  const tools = options.tools ?? resolveFfmpeg();
  await run(tools.ffmpeg, buildRenderArgs(spec), {
    cwd: options.cwd,
    signal: options.signal,
    timeoutMs: 20 * 60_000,
  });
}

export async function extractThumbnail(
  video: string,
  output: string,
  atSec: number,
  options: { cwd: string; tools?: FfmpegTools },
): Promise<void> {
  const tools = options.tools ?? resolveFfmpeg();
  await run(
    tools.ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      atSec.toFixed(2),
      '-i',
      video,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-y',
      output,
    ],
    { cwd: options.cwd },
  );
}
