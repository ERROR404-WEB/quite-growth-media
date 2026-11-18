// Renders demo videos locally with placeholder art/voice to test the media pipeline for free.
//   npm run video:demo                          all demo brands
//   npm run video:demo -- --brand behtar-bano   one brand
//   npm run video:demo -- --fast --no-voice     quicker encode, skip the Windows test voice
import { join, relative } from 'node:path';
import { getBrand } from '../../brands/index.js';
import { ffmpegAvailable, resolveFfmpeg } from '../ffmpeg.js';
import { produceVideo } from '../pipeline.js';
import { WindowsSapiVoice } from '../voice.js';
import { DEMO_SCRIPTS } from './scripts.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const tools = resolveFfmpeg();
  if (!ffmpegAvailable(tools)) {
    throw new Error('FFmpeg not found. Install it (winget install Gyan.FFmpeg) or set FFMPEG_PATH.');
  }
  const only = arg('--brand');
  const scripts = DEMO_SCRIPTS.filter((s) => !only || s.brandId === only);
  if (scripts.length === 0) {
    throw new Error(
      `No demo script for "${only}". Available: ${DEMO_SCRIPTS.map((s) => s.brandId).join(', ')}`,
    );
  }
  const voice = process.argv.includes('--no-voice') ? null : await WindowsSapiVoice.detect(tools);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let failures = 0;

  for (const script of scripts) {
    const brand = getBrand(script.brandId);
    if (!brand) throw new Error(`Unknown brand ${script.brandId}`);
    const workDir = join(process.cwd(), 'data', 'renders', 'demo', brand.id, stamp);
    out(`\n▶ ${brand.displayName} (${brand.language}) - "${script.title}"`);
    const result = await produceVideo({
      brand,
      script,
      workDir,
      voice,
      tools,
      preset: process.argv.includes('--fast') ? 'veryfast' : 'medium',
      label: 'DEMO · placeholder art & voice',
    });
    out(`  video:     ${relative(process.cwd(), result.video)}`);
    out(
      `  duration:  ${result.durationSec.toFixed(1)} s (bucket ${result.durationBucket}), rendered in ${result.renderSeconds} s`,
    );
    out(`  voice:     ${result.voice}`);
    for (const c of result.qa)
      out(
        `  ${c.status === 'passed' ? '✔' : c.status === 'warning' ? '!' : '✖'} ${c.name.padEnd(18)} ${c.detail}`,
      );
    out(`  QA:        ${result.passed ? 'PASSED' : 'FAILED'}`);
    if (!result.passed) failures++;
  }
  out(`\nDone. Open the MP4 files above to watch them (they are in data/renders/demo, not committed).`);
  if (failures) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
