import { writeFileSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { getBrand } from '../brands/index.js';
import type { Language } from '../domain/constants.js';
import { mediaDuration } from '../media/ffmpeg.js';
import type { NarrationClip, SpeechAlignment, SpeechContext, VoiceProvider } from '../media/voice.js';
import type { FetchLike } from './http-client.js';
import { JsonApiClient } from './http-client.js';
import type { Budget } from './pricing.js';

// USD per 1,000 characters, from https://elevenlabs.io/pricing/api (checked 18 Nov 2026).
// Paid plans include a monthly character allowance at these rates; extra usage is billed per character.
export const ELEVENLABS_PRICING_CHECKED_ON = '2026-11-18';
export const ELEVENLABS_RATES_PER_1K: Record<string, number> = {
  eleven_v4: 0.08,
  eleven_v4_turbo: 0.04,
  eleven_v3: 0.08,
  eleven_multilingual_v2: 0.08,
  eleven_flash_v2_5: 0.04,
};

/** Models whose official language list includes Telugu (checked 18 Nov 2026). Multilingual v2 / Flash v2.5 do not. */
export const TELUGU_CAPABLE_MODELS = new Set(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3']);

/** Models that follow inline audio tags such as "[whispers]" (ElevenLabs docs, checked 18 Nov 2026). */
export const AUDIO_TAG_MODELS = new Set(['eleven_v4', 'eleven_v3']);

/**
 * The alignment covers the text we sent, including a leading audio tag. Drop the tag's characters so
 * captions match the narration; if the tag isn't there (the API may omit it), return timings unchanged.
 */
export function stripPrefix(a: SpeechAlignment, prefix: string): SpeechAlignment {
  if (!prefix) return a;
  let consumed = '';
  let n = 0;
  while (n < a.characters.length && consumed.length < prefix.length) consumed += a.characters[n++];
  if (consumed !== prefix) return a;
  return { characters: a.characters.slice(n), starts: a.starts.slice(n), ends: a.ends.slice(n) };
}

const voiceId = z
  .string()
  .regex(/^[A-Za-z0-9]{8,64}$/, 'must be an ElevenLabs voice ID (letters and digits)');
const unit = z.coerce.number().min(0).max(1);

const schema = z.object({
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL: z.string().min(1).default('eleven_v4'),
  ELEVENLABS_OUTPUT_FORMAT: z
    .enum(['mp3_44100_128', 'mp3_44100_192', 'mp3_44100_96', 'mp3_22050_32'])
    .default('mp3_44100_128'),
  ELEVENLABS_STABILITY: unit.default(0.5),
  ELEVENLABS_SIMILARITY: unit.default(0.75),
  ELEVENLABS_MAX_USD_PER_RUN: z.coerce.number().positive().max(50).default(0.5),
});

export interface ElevenLabsConfig extends z.infer<typeof schema> {
  /** Default voice per language (ELEVENLABS_VOICE_EN / _HI / _TE). */
  languageVoices: Partial<Record<Language, string>>;
  /** Brand-specific voices (ELEVENLABS_VOICE_<BRAND_ID>, e.g. ELEVENLABS_VOICE_CHINNI_LOKAM). */
  brandVoices: Record<string, string>;
}

export const brandVoiceEnvKey = (brandId: string) =>
  `ELEVENLABS_VOICE_${brandId.toUpperCase().replace(/-/g, '_')}`;

export function parseElevenLabsConfig(source: NodeJS.ProcessEnv): ElevenLabsConfig {
  const result = schema.safeParse(source);
  const issues = result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const languageVoices: Partial<Record<Language, string>> = {};
  const brandVoices: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    const m = /^ELEVENLABS_VOICE_([A-Z0-9_]+)$/.exec(key);
    const value = raw?.trim();
    if (!m || !value) continue;
    const parsed = voiceId.safeParse(value);
    if (!parsed.success) {
      issues.push(`${key}: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const suffix = m[1]!;
    if (suffix === 'EN' || suffix === 'HI' || suffix === 'TE')
      languageVoices[suffix.toLowerCase() as Language] = value;
    else brandVoices[suffix.toLowerCase().replace(/_/g, '-')] = value;
  }
  if (issues.length || !result.success) {
    throw new Error(`Invalid ElevenLabs configuration:\n  - ${issues.join('\n  - ')}`);
  }
  const key = result.data.ELEVENLABS_API_KEY?.trim();
  return { ...result.data, ELEVENLABS_API_KEY: key ? key : undefined, languageVoices, brandVoices };
}

export function getElevenLabsConfig(): ElevenLabsConfig {
  loadDotenv({ quiet: true });
  return parseElevenLabsConfig(process.env);
}

export function speechCostUsd(model: string, text: string): number {
  // Unknown models are priced at the highest listed rate so budgets stay conservative.
  const rate = ELEVENLABS_RATES_PER_1K[model] ?? 0.08;
  return ([...text].length / 1000) * rate;
}

/** The voice a brand will use: .env brand override > brand config > .env language default. */
export function resolveBrandVoice(
  cfg: ElevenLabsConfig,
  brandId: string,
  language: Language,
): { voiceId: string; source: string } | undefined {
  const override = cfg.brandVoices[brandId];
  if (override) return { voiceId: override, source: brandVoiceEnvKey(brandId) };
  const configured = getBrand(brandId)?.voice.elevenLabs;
  if (configured)
    return { voiceId: configured.voiceId, source: `brand config: ${configured.name} (${configured.source})` };
  const fallback = cfg.languageVoices[language];
  return fallback ? { voiceId: fallback, source: `ELEVENLABS_VOICE_${language.toUpperCase()}` } : undefined;
}

export class ElevenLabsClient extends JsonApiClient {
  constructor(opts: {
    apiKey: string;
    fetch?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    baseUrl?: string;
  }) {
    if (!opts.apiKey) throw new Error('ElevenLabs API key is missing');
    super({
      name: 'ElevenLabs',
      baseUrl: opts.baseUrl ?? 'https://api.elevenlabs.io/v1',
      headers: { 'xi-api-key': opts.apiKey },
      fetch: opts.fetch,
      sleep: opts.sleep,
      timeoutMs: 120_000,
    });
  }
}

interface TimestampsResponse {
  audio_base64?: string;
  alignment?: AlignmentJson | null;
  normalized_alignment?: AlignmentJson | null;
}

interface AlignmentJson {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** ElevenLabs text-to-speech with character timestamps (POST /v1/text-to-speech/{voice_id}/with-timestamps). */
export class ElevenLabsVoice implements VoiceProvider {
  readonly name: string;

  constructor(
    private readonly client: ElevenLabsClient,
    private readonly cfg: ElevenLabsConfig,
    private readonly budget: Budget,
    private readonly durationOf: (file: string) => Promise<number> = (f) => mediaDuration(f),
  ) {
    this.name = `elevenlabs ${cfg.ELEVENLABS_MODEL}`;
  }

  voiceIdFor(language: Language, brandId?: string): string | undefined {
    if (brandId) return resolveBrandVoice(this.cfg, brandId, language)?.voiceId;
    return this.cfg.languageVoices[language];
  }

  supports(language: Language, brandId?: string): boolean {
    if (language === 'te' && !TELUGU_CAPABLE_MODELS.has(this.cfg.ELEVENLABS_MODEL)) return false;
    return this.voiceIdFor(language, brandId) !== undefined;
  }

  async synthesize(
    text: string,
    language: Language,
    outFile: string,
    ctx?: SpeechContext,
  ): Promise<NarrationClip> {
    const voice = this.voiceIdFor(language, ctx?.brandId);
    if (!voice || !this.supports(language, ctx?.brandId)) {
      throw new Error(
        `No ElevenLabs voice for ${ctx?.brandId ?? language}: set ${ctx?.brandId ? brandVoiceEnvKey(ctx.brandId) : ''} or ELEVENLABS_VOICE_${language.toUpperCase()} in .env`,
      );
    }
    const spoken = text.trim();
    const model = this.cfg.ELEVENLABS_MODEL;
    // Eleven v3/v4 voice an inline audio tag ("[soft, aching] ...") as delivery direction.
    const tag =
      ctx?.direction && AUDIO_TAG_MODELS.has(model) ? `[${ctx.direction.replace(/[[\]]/g, '')}] ` : '';
    const sent = `${tag}${spoken}`;
    const settings = ctx?.brandId ? getBrand(ctx.brandId)?.voice.settings : undefined;
    const stability = settings?.stability ?? this.cfg.ELEVENLABS_STABILITY;
    const speed = settings?.speed;
    const estimate = speechCostUsd(model, sent);
    this.budget.reserve(estimate, `speech for ${ctx?.brandId ?? language}`);
    const started = Date.now();
    const res = await this.client.post<TimestampsResponse>(
      `/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=${this.cfg.ELEVENLABS_OUTPUT_FORMAT}`,
      {
        text: sent,
        model_id: model,
        ...(model === 'eleven_multilingual_v2' ? {} : { language_code: language }),
        voice_settings: {
          stability,
          similarity_boost: this.cfg.ELEVENLABS_SIMILARITY,
          ...(speed !== undefined ? { speed } : {}),
        },
        ...(ctx?.previousText ? { previous_text: ctx.previousText } : {}),
        ...(ctx?.nextText ? { next_text: ctx.nextText } : {}),
      },
      ctx?.signal,
    );
    if (!res.audio_base64) throw new Error('ElevenLabs returned no audio');
    this.budget.record('voiceover', model, estimate);

    const file = outFile.replace(/\.[a-z0-9]+$/i, '') + '.mp3';
    writeFileSync(file, Buffer.from(res.audio_base64, 'base64'));
    const a = res.alignment ?? undefined;
    const timings =
      a &&
      stripPrefix(
        {
          characters: a.characters,
          starts: a.character_start_times_seconds,
          ends: a.character_end_times_seconds,
        },
        tag,
      );
    return {
      file,
      durationSec: await this.durationOf(file),
      costUsd: estimate,
      alignment: timings,
      provenance: {
        provider: 'elevenlabs',
        model,
        voiceId: voice,
        language,
        characters: [...sent].length,
        audioTag: tag ? tag.trim() : null,
        stability,
        ...(speed !== undefined ? { speed } : {}),
        outputFormat: this.cfg.ELEVENLABS_OUTPUT_FORMAT,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        createdAt: new Date().toISOString(),
        licence:
          'ElevenLabs: you own generated audio; commercial use requires a paid plan (checked 2026-11-18).',
      },
    };
  }
}

/** Subscription tier, e.g. "free", "starter", "creator" (GET /v1/user/subscription; no cost). */
export async function getSubscriptionTier(client: ElevenLabsClient): Promise<string> {
  const res = await client.get<{ tier?: string }>('/user/subscription');
  return res.tier ?? 'unknown';
}

export interface VoiceDesignPreview {
  generatedVoiceId: string;
  audioBase64: string;
  mediaType: string;
  durationSecs: number;
}

/**
 * Voice Design (POST /v1/text-to-voice/design): returns 3 preview voices for a description.
 * Charged once for the preview text characters. eleven_ttv_v3 covers Telugu.
 */
export async function designVoice(
  client: ElevenLabsClient,
  req: { description: string; text: string; modelId?: string; seed?: number; guidanceScale?: number },
): Promise<VoiceDesignPreview[]> {
  const res = await client.post<{
    previews?: {
      generated_voice_id: string;
      audio_base_64: string;
      media_type: string;
      duration_secs: number;
    }[];
  }>('/text-to-voice/design?output_format=mp3_44100_128', {
    voice_description: req.description,
    text: req.text,
    model_id: req.modelId ?? 'eleven_ttv_v3',
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
    ...(req.guidanceScale !== undefined ? { guidance_scale: req.guidanceScale } : {}),
  });
  return (res.previews ?? []).map((p) => ({
    generatedVoiceId: p.generated_voice_id,
    audioBase64: p.audio_base_64,
    mediaType: p.media_type,
    durationSecs: p.duration_secs,
  }));
}

/** Saves a designed preview as a permanent voice in My Voices (uses one custom voice slot). */
export async function createDesignedVoice(
  client: ElevenLabsClient,
  req: { name: string; description: string; generatedVoiceId: string; labels?: Record<string, string> },
): Promise<string> {
  const res = await client.post<{ voice_id: string }>('/text-to-voice', {
    voice_name: req.name,
    voice_description: req.description,
    generated_voice_id: req.generatedVoiceId,
    ...(req.labels ? { labels: req.labels } : {}),
  });
  return res.voice_id;
}

export interface SharedVoice {
  voiceId: string;
  publicOwnerId: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  language: string | null;
  locale: string | null;
  useCase: string;
  descriptive: string;
  category: string;
  description: string;
  previewUrl: string | null;
  usage1y: number;
  clonedBy: number;
  noticePeriodDays: number | null;
  liveModeration: boolean;
  /** Price multiplier; null/1 = standard rate. */
  rate: number | null;
  verifiedLanguages: string[];
}

export interface SharedVoiceQuery {
  language?: string;
  gender?: string;
  age?: string;
  useCases?: string[];
  search?: string;
  category?: string;
  minNoticePeriodDays?: number;
  sort?: 'usage_character_count_1y' | 'trending' | 'cloned_by_count' | 'created_date';
  pageSize?: number;
}

interface SharedVoiceJson {
  voice_id: string;
  public_owner_id: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  language?: string | null;
  locale?: string | null;
  use_case: string;
  descriptive: string;
  category: string;
  description?: string | null;
  preview_url?: string | null;
  usage_character_count_1y: number;
  cloned_by_count: number;
  notice_period?: number | null;
  live_moderation_enabled: boolean;
  rate?: number | null;
  verified_languages?: { language?: string; locale?: string | null }[] | null;
}

/** Searches the public Voice Library (GET /v1/shared-voices; no character cost). Excludes custom-rate voices. */
export async function searchSharedVoices(
  client: ElevenLabsClient,
  q: SharedVoiceQuery,
): Promise<SharedVoice[]> {
  const params = new URLSearchParams({
    page_size: String(q.pageSize ?? 20),
    sort: q.sort ?? 'usage_character_count_1y',
    include_custom_rates: 'false',
  });
  if (q.language) params.set('language', q.language);
  if (q.gender) params.set('gender', q.gender);
  if (q.age) params.set('age', q.age);
  if (q.search) params.set('search', q.search);
  if (q.category) params.set('category', q.category);
  if (q.minNoticePeriodDays !== undefined)
    params.set('min_notice_period_days', String(q.minNoticePeriodDays));
  for (const u of q.useCases ?? []) params.append('use_cases', u);
  const res = await client.get<{ voices?: SharedVoiceJson[] }>(`/shared-voices?${params.toString()}`);
  return (res.voices ?? []).map((v) => ({
    voiceId: v.voice_id,
    publicOwnerId: v.public_owner_id,
    name: v.name,
    gender: v.gender,
    age: v.age,
    accent: v.accent,
    language: v.language ?? null,
    locale: v.locale ?? null,
    useCase: v.use_case,
    descriptive: v.descriptive,
    category: v.category,
    description: (v.description ?? '').replace(/\s+/g, ' ').trim(),
    previewUrl: v.preview_url ?? null,
    usage1y: v.usage_character_count_1y,
    clonedBy: v.cloned_by_count,
    noticePeriodDays: v.notice_period ?? null,
    liveModeration: v.live_moderation_enabled,
    rate: v.rate ?? null,
    verifiedLanguages: (v.verified_languages ?? []).map((l) => l.locale ?? l.language ?? '').filter(Boolean),
  }));
}

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
}

/** Lists the voices available to this account (GET /v1/voices; no character cost). */
export async function listVoices(client: ElevenLabsClient): Promise<VoiceSummary[]> {
  const res = await client.get<{
    voices?: { voice_id: string; name?: string; category?: string; labels?: Record<string, string> }[];
  }>('/voices');
  return (res.voices ?? []).map((v) => ({
    voiceId: v.voice_id,
    name: v.name ?? '',
    category: v.category ?? '',
    labels: v.labels ?? {},
  }));
}
