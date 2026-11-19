// Shows the fixed voice each brand will use, and the voices saved in your ElevenLabs account.
//   npm run voices:list
import { BRANDS } from '../brands/index.js';
import {
  brandVoiceEnvKey,
  ElevenLabsClient,
  getElevenLabsConfig,
  listVoices,
  resolveBrandVoice,
} from './elevenlabs.js';

const out = (line = '') => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const cfg = getElevenLabsConfig();
  out(`Model: ${cfg.ELEVENLABS_MODEL}\n\nVoice per brand (one fixed voice each - see docs/voices.md):`);
  for (const b of BRANDS) {
    const v = resolveBrandVoice(cfg, b.id, b.language);
    const missing =
      b.niche === 'kids'
        ? `NOT DESIGNED YET - npm run voices:design -- --brand ${b.id}`
        : `NOT SET - set voice.elevenLabs in src/brands/definitions/${b.id}.ts or ${brandVoiceEnvKey(b.id)}`;
    out(`  ${b.displayName.padEnd(24)} ${b.language}  ${v ? `${v.voiceId}  ${v.source}` : missing}`);
  }
  if (!cfg.ELEVENLABS_API_KEY) {
    out(
      '\nELEVENLABS_API_KEY is not set yet - add it to .env to list your account voices (see docs/voices.md).',
    );
    return;
  }
  const voices = await listVoices(new ElevenLabsClient({ apiKey: cfg.ELEVENLABS_API_KEY }));
  const own = voices.filter((v) => v.category !== 'premade');
  out(
    `\nVoices saved in your account: ${own.length} (plus ${voices.length - own.length} ElevenLabs Default voices).`,
  );
  for (const v of own) out(`  ${v.voiceId}  ${v.name}  [${v.category}]`);
  out('Default ("premade") voices expire on 31 Dec 2026 - this project does not use them.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
