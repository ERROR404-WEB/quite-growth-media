// Searches the ElevenLabs Voice Library (free - no characters used).
//   npm run voices:search -- --language hi --gender male --age middle_aged --use-case narrative_story
//   npm run voices:search -- --language en --search "cartoon kid"
//   options: --sort usage_character_count_1y|trending|cloned_by_count   --min-notice <days>   --limit <n>
import { ElevenLabsClient, getElevenLabsConfig, searchSharedVoices } from './elevenlabs.js';

const out = (line = '') => process.stdout.write(`${line}\n`);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const cfg = getElevenLabsConfig();
  if (!cfg.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set in .env');
  const client = new ElevenLabsClient({ apiKey: cfg.ELEVENLABS_API_KEY });
  const sort = (arg('--sort') ?? 'usage_character_count_1y') as 'usage_character_count_1y';
  const minNotice = arg('--min-notice');
  const voices = await searchSharedVoices(client, {
    language: arg('--language'),
    gender: arg('--gender'),
    age: arg('--age'),
    useCases: arg('--use-case') ? [arg('--use-case')!] : undefined,
    search: arg('--search'),
    category: arg('--category'),
    minNoticePeriodDays: minNotice ? Number(minNotice) : undefined,
    sort,
    pageSize: Number(arg('--limit') ?? 15),
  });
  if (voices.length === 0) {
    out('No voices matched. Try fewer filters.');
    return;
  }
  for (const v of voices) {
    out(
      `${v.name} - ${v.gender}, ${v.age}, ${v.accent}${v.language ? `, ${v.language}` : ''} · ${v.useCase} · ${v.descriptive}`,
    );
    out(`   voice_id ${v.voiceId}  owner ${v.publicOwnerId}`);
    out(
      `   used ${(v.usage1y / 1e6).toFixed(1)}M chars/yr · notice ${v.noticePeriodDays ?? 'none'} days · live moderation ${v.liveModeration ? 'yes' : 'no'}`,
    );
    if (v.description) out(`   "${v.description.slice(0, 160)}"`);
    if (v.previewUrl) out(`   preview: ${v.previewUrl}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
