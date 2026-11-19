// Designs an original voice for a brand with ElevenLabs Voice Design.
//   npm run voices:design -- --brand chinni-lokam                 3 previews -> data/voice-design/<brand>/<time>/
//   npm run voices:design -- --brand chinni-lokam --save <generated_voice_id>   keep one (uses a voice slot)
// Previews cost only the preview-text characters (charged once for all 3).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BRANDS, getBrand } from '../brands/index.js';
import { createDesignedVoice, designVoice, ElevenLabsClient, getElevenLabsConfig } from './elevenlabs.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const brand = getBrand(arg('--brand') ?? '');
  if (!brand) throw new Error(`Pass --brand <id>. Available: ${BRANDS.map((b) => b.id).join(', ')}`);
  const { designPrompt, previewText } = brand.voice;
  if (!designPrompt || !previewText)
    throw new Error(`${brand.id} has no voice.designPrompt / voice.previewText`);
  const cfg = getElevenLabsConfig();
  if (!cfg.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set in .env');
  const client = new ElevenLabsClient({ apiKey: cfg.ELEVENLABS_API_KEY });

  const keep = arg('--save');
  if (keep) {
    const voiceId = await createDesignedVoice(client, {
      name: `QGM ${brand.displayName}`,
      description: designPrompt.slice(0, 500),
      generatedVoiceId: keep,
      labels: { brand: brand.id, language: brand.language },
    });
    out(`Saved "${`QGM ${brand.displayName}`}" as voice ${voiceId}.`);
    out(`Next: set it as the brand voice in src/brands/definitions/${brand.id}.ts:`);
    out(`  elevenLabs: { voiceId: '${voiceId}', name: 'QGM ${brand.displayName}', source: 'designed' },`);
    return;
  }

  const seed = arg('--seed') ? Number(arg('--seed')) : undefined;
  out(`Designing voices for ${brand.displayName} (${brand.language})…`);
  const previews = await designVoice(client, { description: designPrompt, text: previewText, seed });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(process.cwd(), 'data', 'voice-design', brand.id, stamp);
  mkdirSync(dir, { recursive: true });
  previews.forEach((p, i) => {
    const file = join(dir, `preview-${i + 1}.mp3`);
    writeFileSync(file, Buffer.from(p.audioBase64, 'base64'));
    out(
      `  ${i + 1}. ${relative(process.cwd(), file)}  (${p.durationSecs.toFixed(1)} s)  generated_voice_id ${p.generatedVoiceId}`,
    );
  });
  writeFileSync(
    join(dir, 'previews.json'),
    JSON.stringify(
      {
        brand: brand.id,
        prompt: designPrompt,
        text: previewText,
        previews: previews.map((p, i) => ({
          file: `preview-${i + 1}.mp3`,
          generatedVoiceId: p.generatedVoiceId,
          durationSecs: p.durationSecs,
        })),
      },
      null,
      2,
    ),
  );
  out(
    `\nListen to the previews, then keep your favourite:\n  npm run voices:design -- --brand ${brand.id} --save <generated_voice_id>`,
  );
  out('Not happy with any? Run again for 3 new options (or add --seed <number> to reproduce a set).');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
