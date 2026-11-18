import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface FfmpegTools {
  ffmpeg: string;
  ffprobe: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

const EXE = process.platform === 'win32' ? '.exe' : '';

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, name + EXE))) return join(dir, name + EXE);
  }
  return undefined;
}

/** winget installs FFmpeg per-user; shells opened before the install don't have it on PATH yet. */
function findWingetFfmpeg(env: NodeJS.ProcessEnv): string | undefined {
  const base = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages') : '';
  if (!base || !existsSync(base)) return undefined;
  for (const pkg of readdirSync(base).filter((d) => d.startsWith('Gyan.FFmpeg'))) {
    for (const build of readdirSync(join(base, pkg))) {
      const bin = join(base, pkg, build, 'bin');
      if (existsSync(join(bin, 'ffmpeg.exe'))) return bin;
    }
  }
  return undefined;
}

/** Locates ffmpeg/ffprobe: FFMPEG_PATH/FFPROBE_PATH, then PATH, then the winget install folder. */
export function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env): FfmpegTools {
  const wingetBin = process.platform === 'win32' ? findWingetFfmpeg(env) : undefined;
  const pick = (name: 'ffmpeg' | 'ffprobe', override?: string) =>
    override ?? findOnPath(name, env) ?? (wingetBin ? join(wingetBin, name + EXE) : name);
  return { ffmpeg: pick('ffmpeg', env.FFMPEG_PATH), ffprobe: pick('ffprobe', env.FFPROBE_PATH) };
}

export function ffmpegAvailable(tools: FfmpegTools = resolveFfmpeg()): boolean {
  const res = spawnSync(tools.ffmpeg, ['-hide_banner', '-version'], { stdio: 'ignore', timeout: 15_000 });
  return res.status === 0;
}

/** Runs a command, rejecting with the tail of stderr on failure. */
export function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    input?: Buffer | string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      signal: options.signal,
      timeout: options.timeoutMs ?? 10 * 60_000,
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) return resolve({ stdout, stderr });
      const tail = stderr.trim().split('\n').slice(-15).join('\n');
      reject(new Error(`${command} exited with ${code ?? signal}:\n${tail}`));
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** Duration in seconds of any media file. */
export async function mediaDuration(file: string, tools: FfmpegTools = resolveFfmpeg()): Promise<number> {
  const { stdout } = await run(tools.ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`Could not read duration of ${file}`);
  return seconds;
}
