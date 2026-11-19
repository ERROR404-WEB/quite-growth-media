// Generates ONE test video: OpenAI script + illustrations, ElevenLabs voice (when configured),
// FFmpeg render and QA.
//   npm run video:ai -- --brand quiet-growth --dry-run          free: prints prompts + voice setup, no API calls
//   npm run video:ai -- --brand quiet-growth                     real run (costs money; capped)
//   npm run video:ai -- --brand little-wonder-world --category rhyme_song --topic "colours of fruit"
//   options: --quality low|medium|high   --placeholder-images (AI script only)
//            --voice auto|elevenlabs|windows|none   (default auto: ElevenLabs if configured, else Windows test voice)
//            --voice-id <id>   one-off ElevenLabs voice instead of the brand's fixed voice (re-voice later)
//            --final   no "AI TEST" label (only with the brand's own ElevenLabs voice on a paid plan) - publishable
import { join, relative } from 'node:path';
import { getOpenAiConfig, requireApiKey } from '../../ai/config.js';
import {
  brandVoiceEnvKey,
  ELEVENLABS_PRICING_CHECKED_ON,
  getElevenLabsConfig,
  resolveBrandVoice,
} from '../../ai/elevenlabs.js';
import { OpenAiClient } from '../../ai/openai-client.js';
import type { ImageQuality } from '../../ai/openai-illustrator.js';
import { buildImagePrompt, OpenAiIllustrator } from '../../ai/openai-illustrator.js';
import { Budget, PRICING_CHECKED_ON } from '../../ai/pricing.js';
import type { GeneratedScript } from '../../ai/script-writer.js';
import { buildScriptPrompt, generateScript, ScriptValidationError } from '../../ai/script-writer.js';
import { BRANDS, getBrand } from '../../brands/index.js';
import { musicMoodsOnAnyPlatform } from '../audio-library.js';
import { ffmpegAvailable, resolveFfmpeg } from '../ffmpeg.js';
import { PlaceholderIllustrator } from '../illustrator.js';
import { renderPlatformVersions } from './variants.js';
import { loadApprovedAudio } from './audio-load.js';
import { recordTestCosts } from './record-costs.js';
import type { VoiceMode } from './voice-select.js';
import { renderLabel, selectVoice } from './voice-select.js';

const MAX_SCRIPT_ATTEMPTS = 2;
const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(name);

async function main(): Promise<void> {
  const cfg = getOpenAiConfig();
  const el = getElevenLabsConfig();
  const brandId = arg('--brand');
  const brand = brandId ? getBrand(brandId) : undefined;
  if (!brand) {
    throw new Error(`Pass --brand <id>. Available: ${BRANDS.map((b) => b.id).join(', ')}`);
  }
  const voiceMode = arg('--voice') ?? (flag('--no-voice') ? 'none' : 'auto');
  if (!['auto', 'elevenlabs', 'windows', 'none'].includes(voiceMode))
    throw new Error(`Invalid --voice ${voiceMode}`);
  const elVoice = resolveBrandVoice(el, brand.id, brand.language);
  const category = arg('--category') ?? brand.contentSlots[0]!.category;
  const topic = arg('--topic');
  const quality = (arg('--quality') ?? cfg.OPENAI_IMAGE_QUALITY) as ImageQuality;
  if (!['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(quality))
    throw new Error(`Invalid --quality ${quality}`);
  const request = { brand, contentCategory: category, topic };

  if (flag('--dry-run')) {
    const { system, user } = buildScriptPrompt(request);
    out(
      `DRY RUN - no API calls, no cost. Brand: ${brand.displayName} (${brand.language}), slot: ${category}\n`,
    );
    out(
      `--- script model: ${cfg.OPENAI_TEXT_MODEL}\n--- system prompt:\n${system}\n\n--- user prompt:\n${user}\n`,
    );
    out(`--- image model: ${cfg.OPENAI_IMAGE_MODEL}, quality ${quality}, size ${cfg.OPENAI_IMAGE_SIZE}`);
    out(
      `--- example image prompt (scene 1):\n${buildImagePrompt(brand, { visual: '<scene description written by the script model>', characterDescription: '<recurring character description>', sceneIndex: 0, shot: 'close_up_portrait', palette: 'contemplative' })}`,
    );
    out(
      `\nBudget cap per run: $${cfg.OPENAI_MAX_USD_PER_RUN.toFixed(2)} (OPENAI_MAX_USD_PER_RUN). API key configured: ${cfg.OPENAI_API_KEY ? 'yes' : 'NO - see docs/ai-video-test.md'}`,
    );
    out(
      `ElevenLabs: key configured: ${el.ELEVENLABS_API_KEY ? 'yes' : 'NO'} · model ${el.ELEVENLABS_MODEL} · voice for this brand: ${elVoice ? `${elVoice.voiceId} (${elVoice.source})` : brand.niche === 'kids' ? `NOT DESIGNED YET (npm run voices:design -- --brand ${brand.id})` : `NOT SET (${brandVoiceEnvKey(brand.id)})`} · voice cap $${el.ELEVENLABS_MAX_USD_PER_RUN.toFixed(2)}`,
    );
    return;
  }

  const tools = resolveFfmpeg();
  if (!ffmpegAvailable(tools))
    throw new Error('FFmpeg not found (winget install Gyan.FFmpeg or set FFMPEG_PATH).');
  const client = new OpenAiClient({ apiKey: requireApiKey(cfg) });
  const budget = new Budget(cfg.OPENAI_MAX_USD_PER_RUN);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const workDir = join(process.cwd(), 'data', 'renders', 'ai-test', brand.id, stamp);

  out(`▶ ${brand.displayName} (${brand.language}) · slot ${category}${topic ? ` · topic "${topic}"` : ''}`);
  out(`  budget cap $${budget.capUsd.toFixed(2)} · prices checked ${PRICING_CHECKED_ON}`);

  // Choose the voice first, so a voice problem stops the run before anything is spent.
  const voiceBudget = new Budget(el.ELEVENLABS_MAX_USD_PER_RUN);
  const selection = await selectVoice({
    brand,
    el,
    mode: voiceMode as VoiceMode,
    voiceIdOverride: arg('--voice-id'),
    tools,
    budget: voiceBudget,
    log: out,
  });
  const voice = selection.voice;
  if (selection.temporary) {
    out(
      `  voice ${selection.voiceId} is TEMPORARY - re-voice later with: npm run video:revoice -- --dir <this run>`,
    );
  }

  const audio = await loadApprovedAudio(brand);
  const musicMoods = musicMoodsOnAnyPlatform(audio.library, brand.platforms);
  let generated: GeneratedScript | undefined;
  for (let attempt = 1; attempt <= MAX_SCRIPT_ATTEMPTS && !generated; attempt++) {
    try {
      out(`  writing script with ${cfg.OPENAI_TEXT_MODEL} (attempt ${attempt}/${MAX_SCRIPT_ATTEMPTS})…`);
      generated = await generateScript(
        client,
        { ...request, availableMusicMoods: musicMoods },
        { model: cfg.OPENAI_TEXT_MODEL, budget },
      );
    } catch (err) {
      if (
        !(err instanceof ScriptValidationError) ||
        attempt === MAX_SCRIPT_ATTEMPTS ||
        /scripture/.test(err.message)
      )
        throw err;
      out(`  ! ${err.problems.join('; ')} - regenerating`);
    }
  }
  const g = generated!;
  out(
    `  "${g.script.title}" · ${g.script.scenes.length} scenes · ~${g.estimatedDurationSec} s · $${g.costUsd.toFixed(4)}`,
  );
  out(`  idea: ${g.centralIdea} · delivery: ${g.deliveryStyle}`);
  const arc = g.idea.emotionalArc;
  out(
    `  arc: ${arc.start} → ${arc.mid} → ${arc.peak} → ${arc.landing} · hook ${g.idea.hookScore}/10 · quotability ${g.idea.quotabilityScore}/10 · ${g.idea.parallelPattern}`,
  );
  out(`  identity: ${g.idea.identitySignal} · permission: ${g.idea.permissionGiven}`);
  g.script.scenes.forEach((s, i) =>
    out(
      `    ${i + 1}. [${s.beat ?? '-'} · ${s.delivery ?? '-'} · ${s.shot ?? '-'}/${s.palette ?? '-'}${s.sfx && s.sfx !== 'none' ? ` · sfx ${s.sfx}` : ''}${s.pause && s.pause !== 'none' ? ` · ${s.pause.toUpperCase()}` : ''}] ${s.narration}`,
    ),
  );
  out(`  screenshot line: "${g.idea.quotes.screenshot}" · loop: ${g.idea.loopLink}`);
  out(`  sound: ${audio.note}`);
  out(`  metadata: "${g.metadata.youtubeTitle}" · ${g.metadata.hashtags.join(' ')}`);

  const illustrator = flag('--placeholder-images')
    ? new PlaceholderIllustrator()
    : new OpenAiIllustrator(client, {
        model: cfg.OPENAI_IMAGE_MODEL,
        quality,
        hookQuality: cfg.OPENAI_IMAGE_HOOK_QUALITY,
        size: cfg.OPENAI_IMAGE_SIZE,
        budget,
      });
  out(`  illustrating ${g.script.scenes.length} scenes with ${illustrator.name}… (can take a minute or two)`);
  out(`  voice: ${voice?.name ?? 'none'}`);

  const versions = await renderPlatformVersions({
    base: {
      brand,
      script: g.script,
      voice,
      illustrator,
      illustrationConcurrency: cfg.OPENAI_IMAGE_CONCURRENCY,
      characterDescription: g.characterDescription,
      tools,
      label: renderLabel(selection, flag('--final')),
      manifestExtra: {
        voiceSelection: {
          temporary: selection.temporary,
          voiceId: selection.voiceId ?? null,
          commercial: selection.commercial,
          brandFixedVoice: elVoice ?? null,
        },
        script: {
          provider: 'openai',
          model: g.model,
          usage: g.usage,
          costUsd: g.costUsd,
          centralIdea: g.centralIdea,
          idea: g.idea,
          deliveryStyle: g.deliveryStyle,
          soundDesign: g.soundDesign,
          characterDescription: g.characterDescription,
          safetyNotes: g.safetyNotes,
        },
        metadata: g.metadata,
        spend: {
          openai: { capUsd: budget.capUsd, pricesCheckedOn: PRICING_CHECKED_ON },
          elevenlabs: { capUsd: voiceBudget.capUsd, pricesCheckedOn: ELEVENLABS_PRICING_CHECKED_ON },
        },
      },
    },
    workDir,
    sound: {
      brief: g.soundDesign,
      scenes: g.script.scenes,
      durationSec: g.estimatedDurationSec,
      kids: brand.niche === 'kids',
    },
    library: audio.library,
    usage: audio.usage,
    metadata: g.metadata,
    metadataBase: { brandId: brand.id, title: g.script.title, idea: g.idea },
    log: out,
  });

  let passed = true;
  for (const { variant, result } of versions) {
    passed &&= result.passed;
    out(`  [${variant.platforms.join(', ')}] video: ${relative(process.cwd(), result.video)}`);
    out(
      `    duration ${result.durationSec.toFixed(1)} s (bucket ${result.durationBucket}) · voice: ${result.voice} · music: ${result.music}`,
    );
    if (variant.credits.length)
      out(`    credit added to the YouTube description: ${variant.credits.join(' | ')}`);
    for (const c of result.qa)
      out(
        `    ${c.status === 'passed' ? '✔' : c.status === 'warning' ? '!' : '✖'} ${c.name.padEnd(18)} ${c.detail}`,
      );
    out(`    QA: ${result.passed ? 'PASSED' : 'FAILED'}`);
  }
  const main = versions[0]!.result;
  if (main.captionsAlignedScenes) {
    out(
      `  captions:  synced to speech timings in ${main.captionsAlignedScenes}/${g.script.scenes.length} scenes`,
    );
  }
  out(
    `  cost:      script $${g.costUsd.toFixed(4)} + images $${main.illustrationCostUsd.toFixed(4)} + voice $${main.voiceCostUsd.toFixed(4)} = $${(budget.spentUsd + voiceBudget.spentUsd).toFixed(4)} (estimated from usage)`,
  );
  out(
    `  ${await recordTestCosts(
      brand.id,
      [
        { provider: 'openai', budget },
        { provider: 'elevenlabs', budget: voiceBudget },
      ],
      { workDir: relative(process.cwd(), workDir), title: g.script.title },
    )}`,
  );
  if (!passed) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
