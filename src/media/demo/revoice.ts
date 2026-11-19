// Re-renders an earlier AI test video with a different voice, reusing its script and images
// (no OpenAI cost). Typical use: after upgrading ElevenLabs, swap a temporary voice for the
// brand's fixed voice.
//   npm run video:revoice -- --dir data/renders/ai-test/<brand>/<time>
//   options: --voice-id <id> (one-off voice)   --voice auto|elevenlabs|windows|none
//            --replan-audio   choose licensed music again from the audio library (e.g. after adding tracks)
//            --platforms youtube   platform-specific version (allows platform-only music with its credit)
//            --final   no "AI TEST" label (only with the brand's own ElevenLabs voice on a paid plan) - publishable
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ELEVENLABS_PRICING_CHECKED_ON, getElevenLabsConfig } from '../../ai/elevenlabs.js';
import { Budget } from '../../ai/pricing.js';
import type { SoundDesignBrief } from '../../ai/script-writer.js';
import { getBrand } from '../../brands/index.js';
import type { Platform } from '../../domain/constants.js';
import { PLATFORMS } from '../../domain/constants.js';
import type { SavedSoundPlan, SoundPlan } from '../audio-library.js';
import { creditsFor, planSoundDesign, restoreSoundPlan } from '../audio-library.js';
import { ffmpegAvailable, resolveFfmpeg } from '../ffmpeg.js';
import { ExistingImagesIllustrator } from '../illustrator.js';
import type { VideoScriptScene } from '../pipeline.js';
import { produceVideo } from '../pipeline.js';
import { loadApprovedAudio } from './audio-load.js';
import { recordTestCosts } from './record-costs.js';
import type { VoiceMode } from './voice-select.js';
import { renderLabel, selectVoice } from './voice-select.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(name);

interface Manifest {
  brandId: string;
  title: string;
  language: string;
  contentCategory: string;
  scenes?: VideoScriptScene[];
  characterDescription?: string | null;
  illustrations: { scene: number; file: string }[];
  audio?: { soundPlan?: SavedSoundPlan | null };
  /** Script info saved by video:ai, including the sound brief (music mood, ambience). */
  script?: { soundDesign?: SoundDesignBrief };
  result?: { durationSec?: number };
}

async function main(): Promise<void> {
  const dirArg = arg('--dir');
  if (!dirArg) throw new Error('Pass --dir <folder of an earlier video:ai run>');
  const sourceDir = resolve(dirArg);
  const manifestPath = join(sourceDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`No manifest.json in ${sourceDir}`);
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (!m.scenes?.length)
    throw new Error('This run was made before scripts were saved in manifest.json; generate it again.');
  const brand = getBrand(m.brandId);
  if (!brand) throw new Error(`Unknown brand ${m.brandId}`);

  const tools = resolveFfmpeg();
  if (!ffmpegAvailable(tools))
    throw new Error('FFmpeg not found (winget install Gyan.FFmpeg or set FFMPEG_PATH).');
  const el = getElevenLabsConfig();
  const voiceBudget = new Budget(el.ELEVENLABS_MAX_USD_PER_RUN);
  const selection = await selectVoice({
    brand,
    el,
    mode: (arg('--voice') ?? 'elevenlabs') as VoiceMode,
    voiceIdOverride: arg('--voice-id'),
    tools,
    budget: voiceBudget,
    log: out,
  });
  const files = [...m.illustrations].sort((a, b) => a.scene - b.scene).map((i) => i.file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const workDir = `${sourceDir}_revoiced_${stamp}`;

  out(
    `▶ Re-voicing "${m.title}" (${brand.displayName}) with ${selection.voice?.name ?? 'no voice'} ${selection.voiceId ?? ''}`,
  );
  // Runs made with a sound plan keep the same licensed audio, re-checked against the library today.
  // --replan-audio picks fresh licensed music for the script's sound brief (e.g. after adding tracks).
  // --platforms youtube makes a platform-specific version (e.g. with YouTube-only music + its credit).
  const platforms = (arg('--platforms')
    ?.split(',')
    .map((p) => p.trim()) ?? brand.platforms) as Platform[];
  if (platforms.some((p) => !PLATFORMS.includes(p)))
    throw new Error(`Invalid --platforms ${platforms.join(',')}`);
  const platformSpecific = !!arg('--platforms');
  let soundPlan: SoundPlan | undefined;
  if (flag('--replan-audio')) {
    const brief = m.script?.soundDesign;
    if (!brief) throw new Error('This run has no saved sound brief (made before sound design existed).');
    const audio = await loadApprovedAudio(brand);
    soundPlan = planSoundDesign({
      brief,
      scenes: m.scenes,
      library: audio.library,
      platforms,
      durationSec: m.result?.durationSec ?? 25,
      kids: brand.niche === 'kids',
      usage: audio.usage,
      canPublishAttribution: platformSpecific,
    });
    out(`  sound (re-planned for ${platforms.join(', ')}): ${audio.note}`);
    soundPlan.notes.forEach((n) => out(`    ${n}`));
  } else if (m.audio?.soundPlan) {
    const audio = await loadApprovedAudio(brand);
    soundPlan = restoreSoundPlan(m.audio.soundPlan, audio.library, platforms, {
      canPublishAttribution: platformSpecific,
    });
    out(`  sound: ${audio.note}`);
    soundPlan.notes.forEach((n) => out(`    ${n}`));
  }
  const credits = soundPlan ? creditsFor(soundPlan) : [];
  if (credits.length) out(`  credit for the ${platforms.join(', ')} description: ${credits.join(' | ')}`);
  const result = await produceVideo({
    brand,
    script: {
      brandId: brand.id,
      title: m.title,
      contentCategory: m.contentCategory,
      language: brand.language,
      scenes: m.scenes,
    },
    workDir,
    voice: selection.voice,
    illustrator: new ExistingImagesIllustrator(sourceDir, files),
    characterDescription: m.characterDescription ?? undefined,
    soundPlan,
    platforms,
    canPublishAttribution: credits.length > 0,
    tools,
    label: renderLabel(selection, flag('--final')),
    manifestExtra: {
      revoicedFrom: relative(process.cwd(), sourceDir),
      platformVersion: platforms,
      credits,
      voiceSelection: {
        temporary: selection.temporary,
        voiceId: selection.voiceId ?? null,
        commercial: selection.commercial,
      },
      spend: {
        totalUsd: voiceBudget.spentUsd,
        elevenlabs: {
          totalUsd: voiceBudget.spentUsd,
          entries: voiceBudget.entries,
          pricesCheckedOn: ELEVENLABS_PRICING_CHECKED_ON,
        },
      },
    },
  });
  out(`  video:     ${relative(process.cwd(), result.video)}`);
  out(`  duration:  ${result.durationSec.toFixed(1)} s · voice: ${result.voice}`);
  out(`  music:     ${result.music}`);
  for (const c of result.qa) {
    out(
      `  ${c.status === 'passed' ? '✔' : c.status === 'warning' ? '!' : '✖'} ${c.name.padEnd(18)} ${c.detail}`,
    );
  }
  out(`  QA:        ${result.passed ? 'PASSED' : 'FAILED'}`);
  out(`  cost:      voice $${result.voiceCostUsd.toFixed(4)} (images reused, no OpenAI cost)`);
  out(
    `  ${await recordTestCosts(brand.id, [{ provider: 'elevenlabs', budget: voiceBudget }], { workDir: relative(process.cwd(), workDir), title: m.title, revoice: true })}`,
  );
  if (!result.passed) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
