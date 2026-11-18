import { statSync } from 'node:fs';
import { durationBucketFor } from '../domain/constants.js';
import type { FfmpegTools } from './ffmpeg.js';
import { resolveFfmpeg, run } from './ffmpeg.js';

export interface VideoProbe {
  fileBytes: number;
  formatName: string;
  durationSec: number;
  video?: { codec: string; width: number; height: number; pixFmt: string; fps: number };
  audio?: { codec: string; sampleRate: number; channels: number };
  meanVolumeDb?: number;
  maxVolumeDb?: number;
  decodeErrors: string[];
}

export type QaStatus = 'passed' | 'failed' | 'warning';

export interface QaCheck {
  name: string;
  status: QaStatus;
  detail: string;
}

export interface QaExpectations {
  width: number;
  height: number;
  fps: number;
  /** Platform-wide limits for this project: 7–45 s. */
  minSec?: number;
  maxSec?: number;
}

interface FfprobeJson {
  format?: { format_name?: string; duration?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    avg_frame_rate?: string;
    sample_rate?: string;
    channels?: number;
  }[];
}

const fraction = (s = '0/1') => {
  const [n, d] = s.split('/').map(Number);
  return d ? (n ?? 0) / d : (n ?? 0);
};

function parseDb(stderr: string, key: 'mean_volume' | 'max_volume'): number | undefined {
  const raw = new RegExp(`${key}:\\s*(-?[\\d.]+|-inf) dB`).exec(stderr)?.[1];
  if (raw === undefined) return undefined;
  return raw === '-inf' ? -Infinity : Number(raw);
}

export async function probeVideo(file: string, tools: FfmpegTools = resolveFfmpeg()): Promise<VideoProbe> {
  const { stdout } = await run(tools.ffprobe, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const json = JSON.parse(stdout) as FfprobeJson;
  const v = json.streams?.find((s) => s.codec_type === 'video');
  const a = json.streams?.find((s) => s.codec_type === 'audio');

  // Full decode: catches truncated/corrupt files that still have valid headers.
  const decode = await run(tools.ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-']).catch(
    (err: Error) => ({
      stdout: '',
      stderr: err.message,
    }),
  );
  const decodeErrors = decode.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let meanVolumeDb: number | undefined;
  let maxVolumeDb: number | undefined;
  if (a) {
    const vol = await run(tools.ffmpeg, [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-vn',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ]);
    meanVolumeDb = parseDb(vol.stderr, 'mean_volume');
    maxVolumeDb = parseDb(vol.stderr, 'max_volume');
  }

  return {
    fileBytes: statSync(file).size,
    formatName: json.format?.format_name ?? '',
    durationSec: Number(json.format?.duration ?? 0),
    video: v && {
      codec: v.codec_name ?? '',
      width: v.width ?? 0,
      height: v.height ?? 0,
      pixFmt: v.pix_fmt ?? '',
      fps: fraction(v.avg_frame_rate),
    },
    audio: a && {
      codec: a.codec_name ?? '',
      sampleRate: Number(a.sample_rate ?? 0),
      channels: a.channels ?? 0,
    },
    meanVolumeDb,
    maxVolumeDb,
    decodeErrors,
  };
}

/** Automated video QA (spec section 14: integrity, duration, resolution, aspect ratio, audio presence). */
export function evaluateVideo(p: VideoProbe, expect: QaExpectations): QaCheck[] {
  const checks: QaCheck[] = [];
  const add = (name: string, ok: boolean, detail: string, softFail = false) =>
    checks.push({ name, status: ok ? 'passed' : softFail ? 'warning' : 'failed', detail });
  const minSec = expect.minSec ?? 7;
  const maxSec = expect.maxSec ?? 45;

  add(
    'mp4_integrity',
    p.formatName.includes('mp4') && p.decodeErrors.length === 0 && p.fileBytes > 10_000,
    p.decodeErrors.length
      ? `decode errors: ${p.decodeErrors.slice(0, 3).join(' | ')}`
      : `${p.formatName}, ${(p.fileBytes / 1e6).toFixed(2)} MB`,
  );
  add(
    'video_codec',
    p.video?.codec === 'h264' && p.video.pixFmt === 'yuv420p',
    p.video ? `${p.video.codec} ${p.video.pixFmt}` : 'no video stream',
  );
  add(
    'resolution',
    p.video?.width === expect.width && p.video.height === expect.height,
    p.video
      ? `${p.video.width}x${p.video.height} (expected ${expect.width}x${expect.height})`
      : 'no video stream',
  );
  const ratio = p.video ? p.video.width / p.video.height : 0;
  add('aspect_ratio_9_16', Math.abs(ratio - 9 / 16) < 0.01, ratio ? ratio.toFixed(4) : 'n/a');
  add(
    'frame_rate',
    !!p.video && Math.abs(p.video.fps - expect.fps) < 0.5,
    p.video ? `${p.video.fps.toFixed(2)} fps` : 'n/a',
    true,
  );
  const bucket = durationBucketFor(p.durationSec);
  add(
    'duration',
    p.durationSec >= minSec && p.durationSec <= maxSec && bucket !== null,
    `${p.durationSec.toFixed(2)} s (bucket ${bucket ?? 'none'}, allowed ${minSec}–${maxSec} s)`,
  );
  add(
    'audio_present',
    p.audio?.codec === 'aac' && (p.audio?.channels ?? 0) > 0,
    p.audio ? `${p.audio.codec} ${p.audio.sampleRate} Hz ${p.audio.channels}ch` : 'no audio stream',
  );
  add('audio_not_silent', (p.meanVolumeDb ?? -Infinity) > -40, `mean ${p.meanVolumeDb ?? 'n/a'} dB`);
  add('audio_no_clipping', (p.maxVolumeDb ?? 0) < -0.1, `peak ${p.maxVolumeDb ?? 'n/a'} dB`);
  return checks;
}

export const qaPassed = (checks: readonly QaCheck[]) => checks.every((c) => c.status !== 'failed');
