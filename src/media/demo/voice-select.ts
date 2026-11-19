import type { ElevenLabsConfig } from '../../ai/elevenlabs.js';
import {
  ElevenLabsClient,
  ElevenLabsVoice,
  getSubscriptionTier,
  resolveBrandVoice,
} from '../../ai/elevenlabs.js';
import type { Budget } from '../../ai/pricing.js';
import type { BrandConfig } from '../../brands/index.js';
import type { FfmpegTools } from '../ffmpeg.js';
import type { VoiceProvider } from '../voice.js';
import { WindowsSapiVoice } from '../voice.js';

export type VoiceMode = 'auto' | 'elevenlabs' | 'windows' | 'none';

export interface VoiceSelection {
  voice: VoiceProvider | null;
  /** True when a one-off --voice-id replaced the brand's fixed voice (re-voice later). */
  temporary: boolean;
  voiceId?: string;
  /** True only for ElevenLabs on a paid plan (Free audio has no commercial licence). */
  commercial: boolean;
}

/**
 * On-screen label for a render. Test renders are always labelled; `--final` drops the label and is
 * only allowed for the brand's own ElevenLabs voice on a paid plan (publishing gate, src/publishing/gate.ts).
 */
export function renderLabel(selection: VoiceSelection, final: boolean): string | undefined {
  if (!final) {
    return selection.temporary
      ? 'AI TEST · temporary voice · not for publishing'
      : 'AI TEST · not for publishing';
  }
  if (!selection.voice?.name.startsWith('elevenlabs') || selection.temporary || !selection.commercial) {
    throw new Error(
      '--final needs the brand’s own ElevenLabs voice on a paid plan (no --voice-id, no Windows/none voice, not the Free plan).',
    );
  }
  return undefined;
}

const FREE_PLAN =
  'ElevenLabs account is on the Free plan: Library voices cannot be used via the API and audio has no commercial licence (see docs/voices.md).';

/**
 * Picks the narrator for a test run. The brand's fixed ElevenLabs voice is the default; a one-off
 * --voice-id (e.g. an ElevenLabs Default voice, allowed on the Free plan) can stand in temporarily.
 */
export async function selectVoice(opts: {
  brand: BrandConfig;
  el: ElevenLabsConfig;
  mode: VoiceMode;
  voiceIdOverride?: string;
  tools: FfmpegTools;
  budget: Budget;
  log: (line: string) => void;
}): Promise<VoiceSelection> {
  const { brand, el, mode, voiceIdOverride } = opts;
  if (mode === 'none') return { voice: null, temporary: false, commercial: false };
  if (mode === 'windows')
    return { voice: await WindowsSapiVoice.detect(opts.tools), temporary: false, commercial: false };

  const override = voiceIdOverride?.trim();
  if (override && !/^[A-Za-z0-9]{8,64}$/.test(override)) throw new Error(`Invalid --voice-id ${override}`);
  const fixed = resolveBrandVoice(el, brand.id, brand.language);
  const wantElevenLabs =
    mode === 'elevenlabs' || !!override || (mode === 'auto' && !!el.ELEVENLABS_API_KEY && !!fixed);
  if (!wantElevenLabs)
    return { voice: await WindowsSapiVoice.detect(opts.tools), temporary: false, commercial: false };

  if (!el.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set in .env (see docs/voices.md)');
  if (!override && !fixed) {
    throw new Error(
      brand.niche === 'kids'
        ? `${brand.displayName} has no voice yet - design it first: npm run voices:design -- --brand ${brand.id}`
        : `${brand.displayName} has no fixed voice - set voice.elevenLabs in its brand file (see docs/voices.md)`,
    );
  }
  const client = new ElevenLabsClient({ apiKey: el.ELEVENLABS_API_KEY });
  const tier = await getSubscriptionTier(client);
  if (tier === 'free' && !override) {
    if (mode === 'elevenlabs') throw new Error(FREE_PLAN);
    opts.log(`  ! ${FREE_PLAN} Using the local test voice instead.`);
    return { voice: await WindowsSapiVoice.detect(opts.tools), temporary: false, commercial: false };
  }
  if (tier === 'free') {
    opts.log(
      '  ! Free plan: only ElevenLabs Default voices or your own voices work here, and the audio is for testing only.',
    );
  }
  const cfg: ElevenLabsConfig = override
    ? { ...el, brandVoices: { ...el.brandVoices, [brand.id]: override } }
    : el;
  const voice = new ElevenLabsVoice(client, cfg, opts.budget);
  if (!voice.supports(brand.language, brand.id)) {
    throw new Error(`${el.ELEVENLABS_MODEL} does not support ${brand.language}; use eleven_v4 for Telugu`);
  }
  return {
    voice,
    temporary: !!override,
    voiceId: override ?? fixed?.voiceId,
    commercial: tier !== 'free' && tier !== 'unknown',
  };
}
