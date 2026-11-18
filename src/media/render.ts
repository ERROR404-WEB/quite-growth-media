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
  /** 0..1 level of the generated background pad; 0 disables it. */
  musicVolume: number;
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
): string {
  const ow = even(width * OVERSCAN);
  const oh = even(height * OVERSCAN);
  const L = length.toFixed(3);
  const zoom = (expr: string) =>
    `scale=w='trunc(${width}*(1+${(OVERSCAN - 1).toFixed(2)}*${expr})/2)*2':h=-2:eval=frame,crop=${width}:${height}`;
  const motionPart = {
    'zoom-in': zoom(`t/${L}`),
    'zoom-out': zoom(`(1-t/${L})`),
    'pan-right': `crop=${width}:${height}:x='(in_w-out_w)*t/${L}':y='(in_h-out_h)/2'`,
    'pan-left': `crop=${width}:${height}:x='(in_w-out_w)*(1-t/${L})':y='(in_h-out_h)/2'`,
  }[motion];
  return `scale=${ow}:${oh},${motionPart},setsar=1,fps=${fps},format=yuv420p,settb=AVTB`;
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

  const graph: string[] = [];
  scenes.forEach((s, i) =>
    graph.push(`[${i}:v]${motionFilter(s.motion, width, height, timeline[i]!.streamLength, fps)}[v${i}]`),
  );
  let last = 'v0';
  for (let i = 1; i < scenes.length; i++) {
    graph.push(
      `[${last}][v${i}]xfade=transition=fade:duration=${transition}:offset=${timeline[i]!.start.toFixed(3)}[x${i}]`,
    );
    last = `x${i}`;
  }
  if (spec.subtitles) {
    const fonts = spec.fontsDir ? `:fontsdir=${spec.fontsDir}` : '';
    graph.push(`[${last}]ass=filename=${spec.subtitles}${fonts}:shaping=complex[vout]`);
  } else {
    graph.push(`[${last}]null[vout]`);
  }

  const mixInputs: string[] = [];
  if (spec.musicVolume > 0) {
    const fadeOut = Math.max(0, total - 1.5).toFixed(3);
    graph.push(
      `aevalsrc=${PAD_EXPRESSION}:s=48000:d=${total.toFixed(3)},volume=${spec.musicVolume},` +
        `afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=1.5,aformat=sample_rates=48000:channel_layouts=stereo[bed]`,
    );
    mixInputs.push('[bed]');
  } else {
    // Silent base track so the mix always spans the full video.
    graph.push(`anullsrc=r=48000:cl=stereo:d=${total.toFixed(3)}[bed]`);
    mixInputs.push('[bed]');
  }
  spec.narration.forEach((n, k) => {
    const ms = Math.round(n.start * 1000);
    graph.push(
      `[${scenes.length + k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=delays=${ms}:all=1[n${k}]`,
    );
    mixInputs.push(`[n${k}]`);
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
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
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
