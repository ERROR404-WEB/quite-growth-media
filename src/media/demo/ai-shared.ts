// Makes ONE topic for the self-improvement brands: a shared storyboard and ONE image set, then a
// separately written (never translated) script, voice, captions, music and metadata per brand.
//   npm run video:ai:shared                                  default: the 3 self-improvement brands
//   npm run video:ai:shared -- --category relationships_eq --topic "walking away without guilt"
//   options: --brands quiet-growth,behtar-bano,ninnu-nuvvu-geluvu
//            --voice-ids <id1>,<id2>,<id3>   one-off ElevenLabs voices, in --brands order (Free plan)
//            --quality low|medium|high      images other than the hook (hook: OPENAI_IMAGE_HOOK_QUALITY)
//            --resume <run dir>             reuse a run's storyboard + images; only make the missing brands
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { getOpenAiConfig, requireApiKey } from '../../ai/config.js';
import { ELEVENLABS_PRICING_CHECKED_ON, getElevenLabsConfig } from '../../ai/elevenlabs.js';
import { OpenAiClient } from '../../ai/openai-client.js';
import type { ImageQuality } from '../../ai/openai-illustrator.js';
import { OpenAiIllustrator } from '../../ai/openai-illustrator.js';
import { Budget, PRICING_CHECKED_ON } from '../../ai/pricing.js';
import type { GeneratedScript, Storyboard } from '../../ai/script-writer.js';
import { generateScript, ScriptValidationError } from '../../ai/script-writer.js';
import { generateStoryboard } from '../../ai/storyboard.js';
import type { BrandConfig } from '../../brands/index.js';
import { BRANDS, getBrand } from '../../brands/index.js';
import { UNIVERSAL_VISUAL_IDENTITY } from '../../brands/shared.js';
import { musicMoodsOnAnyPlatform } from '../audio-library.js';
import { ffmpegAvailable, resolveFfmpeg } from '../ffmpeg.js';
import { ExistingImagesIllustrator, mapLimit } from '../illustrator.js';
import { even, OVERSCAN } from '../render.js';
import { loadApprovedAudio } from './audio-load.js';
import { recordTestCosts } from './record-costs.js';
import type { VoiceMode } from './voice-select.js';
import { renderLabel, selectVoice } from './voice-select.js';
import { renderPlatformVersions } from './variants.js';

const MAX_ATTEMPTS = 3;
const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

/** Retries on validation failure, passing the problems back so the next draft fixes them. */
async function withRetries<T>(what: string, fn: (feedback?: string[]) => Promise<T>): Promise<T> {
  let feedback: string[] | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(feedback);
    } catch (err) {
      if (!(err instanceof ScriptValidationError) || attempt >= MAX_ATTEMPTS) throw err;
      feedback = err.problems;
      out(`  ! ${what}: ${err.problems.join('; ')} - regenerating with this feedback`);
    }
  }
}

async function main(): Promise<void> {
  const cfg = getOpenAiConfig();
  const el = getElevenLabsConfig();
  const ids = (
    arg('--brands') ??
    BRANDS.filter((b) => b.niche === 'self_improvement')
      .map((b) => b.id)
      .join(',')
  )
    .split(',')
    .map((s) => s.trim());
  const brands: BrandConfig[] = ids.map((id) => {
    const b = getBrand(id);
    if (!b) throw new Error(`Unknown brand ${id}`);
    if (b.niche !== 'self_improvement') throw new Error(`${id} is not a self-improvement brand`);
    return b;
  });
  const voiceIds = (arg('--voice-ids') ?? '').split(',').map((s) => s.trim());
  const category = arg('--category') ?? brands[0]!.contentSlots[0]!.category;
  const quality = (arg('--quality') ?? cfg.OPENAI_IMAGE_QUALITY) as ImageQuality;

  const tools = resolveFfmpeg();
  if (!ffmpegAvailable(tools))
    throw new Error('FFmpeg not found (winget install Gyan.FFmpeg or set FFMPEG_PATH).');
  const client = new OpenAiClient({ apiKey: requireApiKey(cfg) });
  const shared = new Budget(cfg.OPENAI_MAX_USD_PER_RUN);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resume = arg('--resume');
  const root = resume ? resolve(resume) : join(process.cwd(), 'data', 'renders', 'ai-test', 'shared', stamp);
  const imagesDir = join(root, 'images');
  mkdirSync(imagesDir, { recursive: true });

  out(`▶ Shared topic for ${brands.map((b) => b.displayName).join(', ')} · slot ${category}`);
  out(
    `  budget cap $${shared.capUsd.toFixed(2)} (storyboard + images) · prices checked ${PRICING_CHECKED_ON}`,
  );

  // Choose every voice first, so a voice problem stops the run before anything is spent.
  const voiceBudget = new Budget(el.ELEVENLABS_MAX_USD_PER_RUN);
  const selections = [];
  for (const [i, brand] of brands.entries()) {
    selections.push(
      await selectVoice({
        brand,
        el,
        mode: 'auto' as VoiceMode,
        voiceIdOverride: voiceIds[i] || undefined,
        tools,
        budget: voiceBudget,
        log: out,
      }),
    );
  }

  const audio = await loadApprovedAudio(brands[0]!);
  const moods = musicMoodsOnAnyPlatform(audio.library, brands[0]!.platforms);
  out(`  sound: ${audio.note} · music moods available: ${moods.join(', ') || 'none'}`);

  // 1. One storyboard (meaning + images, no wording) - or the one from the run being resumed.
  let storyboard: Storyboard;
  let files: string[];
  if (resume) {
    storyboard = JSON.parse(readFileSync(join(root, 'storyboard.json'), 'utf8')) as Storyboard;
    files = storyboard.lines.map((_, i) => {
      const file = readdirSync(imagesDir).find((f) => f.startsWith(`scene-${i + 1}.`));
      if (!file) throw new Error(`Missing shared image ${i + 1} in ${imagesDir}`);
      return file;
    });
    out(`  resuming ${relative(process.cwd(), root)} - reusing its storyboard and ${files.length} images`);
    printStoryboard(storyboard);
  } else {
    ({ storyboard } = await withRetries('storyboard', () =>
      generateStoryboard(
        client,
        { brands, contentCategory: category, topic: arg('--topic'), availableMusicMoods: moods },
        { model: cfg.OPENAI_TEXT_MODEL, budget: shared },
      ),
    ));
    writeFileSync(join(root, 'storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`, 'utf8');
    printStoryboard(storyboard);
    files = await illustrate(storyboard);
  }

  // 2. One image set for every brand.
  async function illustrate(sb: Storyboard): Promise<string[]> {
    const sharedBrand: BrandConfig = { ...brands[0]!, visualIdentity: UNIVERSAL_VISUAL_IDENTITY };
    const illustrator = new OpenAiIllustrator(client, {
      model: cfg.OPENAI_IMAGE_MODEL,
      quality,
      hookQuality: cfg.OPENAI_IMAGE_HOOK_QUALITY,
      size: cfg.OPENAI_IMAGE_SIZE,
      budget: shared,
    });
    out(`  illustrating ${sb.lines.length} shared images with ${illustrator.name}…`);
    const images = await mapLimit(sb.lines, cfg.OPENAI_IMAGE_CONCURRENCY, (line, i) =>
      illustrator.generate({
        brand: sharedBrand,
        sceneIndex: i,
        sceneCount: sb.lines.length,
        visual: line.visual,
        shot: line.shot,
        palette: line.palette,
        characterDescription: sb.characterDescription,
        seed: sb.title,
        width: even(1080 * OVERSCAN),
        height: even(1920 * OVERSCAN),
        workDir: imagesDir,
      }),
    );
    const cost = images.reduce((s, im) => s + im.costUsd, 0);
    out(`  images: $${cost.toFixed(4)} for ${images.length} images (shared by ${brands.length} brands)`);
    return images.map((im) => im.file);
  }

  // 3. Per brand: its own script (never translated), voice, captions, music and metadata.
  const results: string[] = [];
  for (const [i, brand] of brands.entries()) {
    if (resume && existsSync(join(root, brand.id, 'video.mp4'))) {
      results.push(
        `✔ ${brand.displayName}: ${relative(process.cwd(), join(root, brand.id, 'video.mp4'))} (from the earlier run)`,
      );
      continue;
    }
    const selection = selections[i]!;
    const scriptBudget = new Budget(0.5);
    out(`\n▶ ${brand.displayName} (${brand.language}) - writing its own script…`);
    const g: GeneratedScript = await withRetries(`${brand.id} script`, (feedback) =>
      generateScript(
        client,
        { brand, contentCategory: category, storyboard, feedback },
        { model: cfg.OPENAI_TEXT_MODEL, budget: scriptBudget },
      ),
    );
    out(
      `  "${g.script.title}" · ~${g.estimatedDurationSec} s · hook ${g.idea.hookScore}/10 · quotability ${g.idea.quotabilityScore}/10`,
    );
    g.script.scenes.forEach((s, k) =>
      out(
        `    ${k + 1}. [${s.beat} · ${s.delivery}${s.pause && s.pause !== 'none' ? ` · ${s.pause.toUpperCase()}` : ''}] ${s.narration}`,
      ),
    );
    const workDir = join(root, brand.id);
    mkdirSync(workDir, { recursive: true });
    const versions = await renderPlatformVersions({
      base: {
        brand,
        script: g.script,
        voice: selection.voice,
        illustrator: new ExistingImagesIllustrator(imagesDir, files),
        characterDescription: storyboard.characterDescription,
        tools,
        label: renderLabel(selection, process.argv.includes('--final')),
        manifestExtra: {
          sharedStoryboard: { dir: relative(process.cwd(), root), title: storyboard.title, images: files },
          voiceSelection: {
            temporary: selection.temporary,
            voiceId: selection.voiceId ?? null,
            commercial: selection.commercial,
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
            safetyNotes: g.safetyNotes,
          },
          metadata: g.metadata,
          spend: {
            script: scriptBudget.entries,
            sharedShareUsd: shared.spentUsd / brands.length,
            elevenlabs: { pricesCheckedOn: ELEVENLABS_PRICING_CHECKED_ON },
          },
        },
      },
      workDir,
      sound: {
        brief: g.soundDesign,
        scenes: g.script.scenes,
        durationSec: g.estimatedDurationSec,
        kids: false,
      },
      library: audio.library,
      usage: audio.usage,
      metadata: g.metadata,
      metadataBase: { brandId: brand.id, title: g.script.title, idea: g.idea },
      log: out,
    });
    let voiceCost = 0;
    let allPassed = true;
    for (const { variant, result } of versions) {
      voiceCost += result.voiceCostUsd;
      allPassed &&= result.passed;
      out(
        `  [${variant.platforms.join(', ')}] ${relative(process.cwd(), result.video)} · ${result.durationSec.toFixed(1)} s · music: ${result.music}`,
      );
      if (variant.credits.length)
        out(`    credit added to the YouTube description: ${variant.credits.join(' | ')}`);
      result.qa
        .filter((c) => c.status !== 'passed')
        .forEach((c) => out(`    ${c.status === 'warning' ? '!' : '✖'} ${c.name}: ${c.detail}`));
      results.push(
        `${result.passed ? '✔' : '✖'} ${brand.displayName} [${variant.platforms.join(', ')}]: ${relative(process.cwd(), result.video)}`,
      );
    }
    out(
      `  QA: ${allPassed ? 'PASSED' : 'FAILED'} · script $${g.costUsd.toFixed(4)} + voice $${voiceCost.toFixed(4)}`,
    );
    out(
      `  ${await recordTestCosts(brand.id, [{ provider: 'openai', budget: scriptBudget }], { workDir: relative(process.cwd(), workDir), title: g.script.title, sharedTopic: storyboard.title })}`,
    );
    await recordTestCosts(
      brand.id,
      [{ provider: 'openai', budget: shared }],
      { sharedTopic: storyboard.title, sharedPart: true },
      1 / brands.length,
    );
    if (!allPassed) process.exitCode = 1;
  }
  await recordTestCosts(brands[0]!.id, [{ provider: 'elevenlabs', budget: voiceBudget }], {
    sharedTopic: storyboard.title,
  });

  out(`\nDone - "${storyboard.title}"`);
  results.forEach((r) => out(`  ${r}`));
  out(
    `  total: shared storyboard + images $${shared.spentUsd.toFixed(4)} · voice $${voiceBudget.spentUsd.toFixed(4)} · scripts see above`,
  );
}

function printStoryboard(sb: Storyboard): void {
  out(
    `  storyboard: "${sb.title}" · ${sb.lines.length} lines · ${sb.idea.parallelPattern} · music ${sb.soundDesign.music}`,
  );
  out(`  core message: ${sb.idea.coreMessage}`);
  out(`  identity: ${sb.idea.identitySignal} · permission: ${sb.idea.permissionGiven}`);
  sb.lines.forEach((l, i) => out(`    ${i + 1}. [${l.beat} · ${l.shot}/${l.palette}] ${l.intent}`));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
