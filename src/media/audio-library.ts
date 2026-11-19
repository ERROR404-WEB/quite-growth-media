import { z } from 'zod';
import type { AmbienceCategory, MusicMood, OneShotSfx, Platform } from '../domain/constants.js';
import {
  AUDIO_ASSET_STATUSES,
  AUDIO_KINDS,
  AUDIO_LICENCE_TYPES,
  AUDIO_SOURCES,
  CONTENT_ID_STATUSES,
  MUSIC_MOODS,
  PLATFORMS,
  RIGHTS_ANSWERS,
  SFX_CATEGORIES,
} from '../domain/constants.js';

/** Music moods + sound-effect categories ('suspense' exists in both). */
export const AUDIO_CATEGORIES = [...new Set([...MUSIC_MOODS, ...SFX_CATEGORIES])] as [string, ...string[]];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/** Everything the audio engine may use is a row of this shape (table audio_library_assets). */
export const audioAssetSchema = z.object({
  assetCode: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a kebab-case code'),
  kind: z.enum(AUDIO_KINDS),
  title: z.string().min(1),
  creator: z.string().min(1).nullable(),
  fileName: z.string().min(1),
  /** Path relative to the repository/app root, '/' separators (e.g. data/audio/files/x.mp3). */
  storageUri: z.string().min(1),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  durationSec: z.number().positive(),
  bpm: z.number().positive().nullable(),
  category: z.enum(AUDIO_CATEGORIES),
  moods: z.array(z.string().min(1)),
  source: z.enum(AUDIO_SOURCES),
  sourceUrl: z.url(),
  licenceType: z.enum(AUDIO_LICENCE_TYPES),
  licenceVersion: z.string().min(1).nullable(),
  licenceUrl: z.url().nullable(),
  commercialUse: z.enum(RIGHTS_ANSWERS),
  monetizedSocialUse: z.enum(RIGHTS_ANSWERS),
  modification: z.enum(RIGHTS_ANSWERS),
  allowedPlatforms: z.array(z.enum(PLATFORMS)),
  attributionRequired: z.boolean(),
  attributionText: z.string().min(1).nullable(),
  prohibitedUses: z.string().min(1).nullable(),
  contentIdStatus: z.enum(CONTENT_ID_STATUSES),
  licenceCheckedOn: isoDate.nullable(),
  licenceEvidenceUri: z.string().min(1).nullable(),
  status: z.enum(AUDIO_ASSET_STATUSES),
  reviewNotes: z.string().nullable(),
});

export type AudioAsset = z.infer<typeof audioAssetSchema>;

export interface RightsDecision {
  approved: boolean;
  reasons: string[];
}

const LIBRARY_LICENCES: Record<AudioAsset['kind'], readonly string[]> = {
  music: ['pixabay_content_license', 'mixkit_music_free', 'youtube_audio_library'],
  sound_effect: ['pixabay_content_license', 'mixkit_sfx_free', 'youtube_audio_library'],
};
const GENERIC_LICENCES: readonly string[] = ['cc0', 'cc_by', 'original_work', 'custom'];

/**
 * Copyright & rights gate (creative direction §14 A-C, §17). Anything not explicitly verified is rejected.
 * Attribution-required assets are only usable when the caller can publish the attribution text.
 */
export function rightsDecision(
  asset: AudioAsset,
  platforms: readonly Platform[],
  opts: { canPublishAttribution?: boolean } = {},
): RightsDecision {
  const reasons: string[] = [];
  if (asset.status !== 'approved') reasons.push(`status is ${asset.status}`);
  if (asset.commercialUse !== 'allowed') reasons.push(`commercial use is ${asset.commercialUse}`);
  if (asset.monetizedSocialUse !== 'allowed') {
    reasons.push(`monetised social-media use is ${asset.monetizedSocialUse}`);
  }
  if (asset.modification !== 'allowed') {
    reasons.push(`modification (fades, ducking, trims) is ${asset.modification}`);
  }
  if (asset.contentIdStatus !== 'not_registered') {
    reasons.push(`Content ID status is ${asset.contentIdStatus} (claims would block automated publishing)`);
  }
  if (!asset.licenceCheckedOn) reasons.push('licence verification date is missing');
  if (!asset.licenceEvidenceUri) reasons.push('licence evidence is missing');
  if (asset.attributionRequired) {
    if (!asset.attributionText) reasons.push('attribution is required but no attribution text is recorded');
    else if (!opts.canPublishAttribution) reasons.push('attribution is required and cannot be published yet');
  }
  if (asset.licenceType === 'youtube_audio_library' && asset.allowedPlatforms.some((p) => p !== 'youtube')) {
    reasons.push('YouTube Audio Library tracks are only documented as safe on YouTube');
  }
  if (
    !GENERIC_LICENCES.includes(asset.licenceType) &&
    !LIBRARY_LICENCES[asset.kind].includes(asset.licenceType)
  ) {
    reasons.push(`licence ${asset.licenceType} does not cover a ${asset.kind.replace('_', ' ')}`);
  }
  const missing = platforms.filter((p) => !asset.allowedPlatforms.includes(p));
  if (missing.length) reasons.push(`not cleared for ${missing.join(', ')}`);
  return { approved: reasons.length === 0, reasons };
}

export interface AudioUsageStats {
  /** Uses across all brands in the look-back window. */
  uses: number;
  /** Uses by the requesting brand in the look-back window. */
  brandUses: number;
  /** Most recent use by the requesting brand. */
  lastBrandUseAt: Date | null;
}

/** Music moods ranked by closeness, so a missing exact mood still finds a fitting track. */
export const MOOD_PREFERENCES: Record<MusicMood, readonly MusicMood[]> = {
  calm: ['calm', 'ambient', 'reflective', 'healing'],
  emotional: ['emotional', 'sad', 'healing', 'reflective'],
  sad: ['sad', 'heartbreak', 'emotional', 'reflective'],
  heartbreak: ['heartbreak', 'sad', 'emotional'],
  healing: ['healing', 'hopeful', 'calm', 'ambient'],
  hopeful: ['hopeful', 'healing', 'motivational', 'cinematic'],
  motivational: ['motivational', 'confidence', 'cinematic', 'hopeful'],
  cinematic: ['cinematic', 'motivational', 'emotional'],
  suspense: ['suspense', 'curiosity', 'ambient'],
  curiosity: ['curiosity', 'suspense', 'ambient'],
  confidence: ['confidence', 'motivational', 'cinematic'],
  reflective: ['reflective', 'calm', 'ambient', 'emotional'],
  ambient: ['ambient', 'calm', 'reflective'],
  playful: ['playful'],
  lullaby: ['lullaby', 'calm'],
  devotional: ['devotional', 'calm'],
};

const SFX_PREFERENCES: Partial<Record<OneShotSfx, readonly OneShotSfx[]>> = {
  whoosh: ['whoosh', 'transition'],
  transition: ['transition', 'whoosh', 'emotional_transition'],
  emotional_transition: ['emotional_transition', 'transition'],
  soft_impact: ['soft_impact', 'cinematic_hit'],
  cinematic_hit: ['cinematic_hit', 'soft_impact'],
};

/** Moods allowed for children's brands: nothing sad, suspenseful or heavy. */
const KIDS_MUSIC: readonly MusicMood[] = ['playful', 'lullaby', 'calm'];

export interface AudioRequest {
  kind: AudioAsset['kind'];
  /** Acceptable categories, best first. */
  categories: readonly string[];
  platforms: readonly Platform[];
  /** Beds shorter than this get looped, which is penalised. */
  minDurationSec?: number;
  usage?: ReadonlyMap<string, AudioUsageStats>;
  /** Asset codes already used in this video (no repeated identical effects). */
  exclude?: ReadonlySet<string>;
  canPublishAttribution?: boolean;
  now?: Date;
}

/**
 * Picks the best verified asset: closest category, long enough, least used by this brand and network.
 * Returns null when no licensed asset fits - callers then fall back to ambience, silence or voice only.
 */
export function selectAudio(library: readonly AudioAsset[], req: AudioRequest): AudioAsset | null {
  const now = req.now ?? new Date();
  let best: { asset: AudioAsset; score: number } | null = null;
  for (const asset of library) {
    if (asset.kind !== req.kind || req.exclude?.has(asset.assetCode)) continue;
    const rights = rightsDecision(asset, req.platforms, { canPublishAttribution: req.canPublishAttribution });
    if (!rights.approved) continue;
    let rank = req.categories.indexOf(asset.category);
    if (rank < 0) rank = req.categories.findIndex((c) => asset.moods.includes(c));
    if (rank < 0) continue;
    let score = 100 - rank * 15;
    if (req.minDurationSec && asset.durationSec < req.minDurationSec) score -= 30;
    const u = req.usage?.get(asset.assetCode);
    if (u) {
      score -= u.brandUses * 12 + u.uses * 4;
      const days = u.lastBrandUseAt ? (now.getTime() - u.lastBrandUseAt.getTime()) / 86_400_000 : Infinity;
      if (days < 3) score -= 40;
    }
    if (!best || score > best.score || (score === best.score && asset.assetCode < best.asset.assetCode)) {
      best = { asset, score };
    }
  }
  return best?.asset ?? null;
}

export interface PlannedAudio {
  asset: AudioAsset;
  /** Linear gain before the final loudness normalisation. */
  volume: number;
}

export interface SoundPlan {
  music: PlannedAudio | null;
  ambience: PlannedAudio | null;
  sfx: (PlannedAudio & { sceneIndex: number })[];
  /** Human-readable decisions and copyright-safe fallbacks, stored in the manifest. */
  notes: string[];
}

export const MUSIC_VOLUME = 0.22;
export const AMBIENCE_VOLUME = 0.12;
export const SFX_VOLUME = 0.35;
/** Opening impacts stay gentle (creative direction §14 G). */
export const HOOK_SFX_VOLUME = 0.25;
export const MAX_SFX_PER_VIDEO = 2;

export interface SoundPlanInput {
  brief: { music: MusicMood | 'none'; ambience: AmbienceCategory | 'none' };
  scenes: readonly { sfx?: OneShotSfx | 'none' }[];
  library: readonly AudioAsset[];
  platforms: readonly Platform[];
  durationSec: number;
  kids: boolean;
  usage?: ReadonlyMap<string, AudioUsageStats>;
  canPublishAttribution?: boolean;
  now?: Date;
}

/** Turns the script's sound brief into licensed assets, never substituting an unverified one (§14 H). */
export function planSoundDesign(input: SoundPlanInput): SoundPlan {
  const notes: string[] = [];
  const common = {
    platforms: input.platforms,
    usage: input.usage,
    canPublishAttribution: input.canPublishAttribution,
    now: input.now,
  };

  let music: PlannedAudio | null = null;
  if (input.brief.music === 'none') {
    notes.push('music: none requested (voice, ambience and silence carry the video)');
  } else {
    const moods = MOOD_PREFERENCES[input.brief.music].filter((m) => !input.kids || KIDS_MUSIC.includes(m));
    const track = moods.length
      ? selectAudio(input.library, {
          ...common,
          kind: 'music',
          categories: moods,
          minDurationSec: input.durationSec,
        })
      : null;
    if (track) {
      music = { asset: track, volume: MUSIC_VOLUME };
      notes.push(`music: ${track.assetCode} (${track.category}) for requested mood "${input.brief.music}"`);
    } else {
      notes.push(
        `music: no approved licensed track for mood "${input.brief.music}" - copyright-safe fallback, no music`,
      );
    }
  }

  let ambience: PlannedAudio | null = null;
  if (input.brief.ambience !== 'none') {
    const bed = selectAudio(input.library, {
      ...common,
      kind: 'sound_effect',
      categories: [input.brief.ambience],
      minDurationSec: input.durationSec,
    });
    if (bed) {
      ambience = { asset: bed, volume: AMBIENCE_VOLUME };
      notes.push(`ambience: ${bed.assetCode} (${bed.category})`);
    } else {
      notes.push(`ambience: no approved licensed "${input.brief.ambience}" bed - skipped`);
    }
  }

  const sfx: SoundPlan['sfx'] = [];
  const used = new Set<string>();
  input.scenes.forEach((scene, sceneIndex) => {
    const want = scene.sfx;
    if (!want || want === 'none') return;
    if (sfx.length >= MAX_SFX_PER_VIDEO) {
      notes.push(`sfx scene ${sceneIndex + 1}: "${want}" dropped (max ${MAX_SFX_PER_VIDEO} per video)`);
      return;
    }
    const effect = selectAudio(input.library, {
      ...common,
      kind: 'sound_effect',
      categories: SFX_PREFERENCES[want] ?? [want],
      exclude: used,
    });
    if (!effect) {
      notes.push(`sfx scene ${sceneIndex + 1}: no approved licensed "${want}" effect - skipped`);
      return;
    }
    used.add(effect.assetCode);
    sfx.push({ asset: effect, sceneIndex, volume: sceneIndex === 0 ? HOOK_SFX_VOLUME : SFX_VOLUME });
    notes.push(`sfx scene ${sceneIndex + 1}: ${effect.assetCode} (${effect.category})`);
  });

  return { music, ambience, sfx, notes };
}

/** Music moods that at least one approved, cleared track can serve (category or mood tag). */
export function availableMusicMoods(
  library: readonly AudioAsset[],
  platforms: readonly Platform[],
  opts: { canPublishAttribution?: boolean } = {},
): MusicMood[] {
  const moods = new Set<string>();
  for (const a of library) {
    if (a.kind !== 'music' || !rightsDecision(a, platforms, opts).approved) continue;
    moods.add(a.category);
    a.moods.forEach((m) => moods.add(m));
  }
  return MUSIC_MOODS.filter((m) => moods.has(m));
}

/**
 * Moods available on at least one platform (e.g. a YouTube-only track counts). Videos then get a
 * platform-specific version where such a track is used - never a cross-platform one (§14 C).
 */
export function musicMoodsOnAnyPlatform(
  library: readonly AudioAsset[],
  platforms: readonly Platform[],
): MusicMood[] {
  const moods = new Set(
    platforms.flatMap((p) => availableMusicMoods(library, [p], { canPublishAttribution: true })),
  );
  return MUSIC_MOODS.filter((m) => moods.has(m));
}

/** Attribution lines that must be published with a video using this plan. */
export function creditsFor(plan: SoundPlan): string[] {
  const assets = [plan.music?.asset, plan.ambience?.asset, ...plan.sfx.map((s) => s.asset)];
  return [
    ...new Set(
      assets.flatMap((a) => (a?.attributionRequired && a.attributionText ? [a.attributionText] : [])),
    ),
  ];
}

export interface PlatformVariant {
  platforms: Platform[];
  soundPlan: SoundPlan;
  /** Attribution lines to add to the description on these platforms. */
  credits: string[];
}

const planKey = (p: SoundPlan) => JSON.stringify(saveSoundPlan(p));

/**
 * Plans the cross-platform version plus platform-only versions where a platform-restricted licensed
 * track fits the brief better (e.g. a YouTube-only track with a credit line). Platform-restricted
 * assets are never used in the cross-platform version.
 */
export function planPlatformVariants(
  input: Omit<SoundPlanInput, 'platforms' | 'canPublishAttribution'>,
  platforms: readonly Platform[],
): { main: PlatformVariant; extra: PlatformVariant[] } {
  const mainPlan = planSoundDesign({ ...input, platforms, canPublishAttribution: false });
  const groups = new Map<string, PlatformVariant>();
  for (const p of platforms) {
    const plan = planSoundDesign({ ...input, platforms: [p], canPublishAttribution: true });
    const key = planKey(plan);
    if (key === planKey(mainPlan)) continue;
    const existing = groups.get(key);
    if (existing) existing.platforms.push(p);
    else groups.set(key, { platforms: [p], soundPlan: plan, credits: creditsFor(plan) });
  }
  const extra = [...groups.values()];
  const taken = new Set(extra.flatMap((v) => v.platforms));
  return {
    main: {
      platforms: platforms.filter((p) => !taken.has(p)),
      soundPlan: mainPlan,
      credits: creditsFor(mainPlan),
    },
    extra,
  };
}

/** Compact, JSON-safe form of a plan for manifest.json (asset codes + gains). */
export interface SavedSoundPlan {
  music: { assetCode: string; volume: number } | null;
  ambience: { assetCode: string; volume: number } | null;
  sfx: { sceneIndex: number; assetCode: string; volume: number }[];
}

export function saveSoundPlan(plan: SoundPlan): SavedSoundPlan {
  const ref = (p: PlannedAudio | null) => (p ? { assetCode: p.asset.assetCode, volume: p.volume } : null);
  return {
    music: ref(plan.music),
    ambience: ref(plan.ambience),
    sfx: plan.sfx.map((s) => ({ sceneIndex: s.sceneIndex, assetCode: s.asset.assetCode, volume: s.volume })),
  };
}

/**
 * Rebuilds a saved plan from the current library (e.g. when re-voicing). Assets that are no longer
 * approved for the platforms are dropped - licence status is always re-checked, never trusted from a file.
 */
export function restoreSoundPlan(
  saved: SavedSoundPlan,
  library: readonly AudioAsset[],
  platforms: readonly Platform[],
  opts: { canPublishAttribution?: boolean } = {},
): SoundPlan {
  const notes: string[] = [];
  const find = (code: string, role: string): AudioAsset | null => {
    const asset = library.find((a) => a.assetCode === code);
    const reasons = asset ? rightsDecision(asset, platforms, opts).reasons : ['not in the library'];
    if (asset && reasons.length === 0) {
      notes.push(`${role}: ${code} (restored)`);
      return asset;
    }
    notes.push(`${role}: ${code} dropped (${reasons.join('; ')})`);
    return null;
  };
  const bed = (ref: SavedSoundPlan['music'], role: string): PlannedAudio | null => {
    const asset = ref ? find(ref.assetCode, role) : null;
    return asset && ref ? { asset, volume: ref.volume } : null;
  };
  const music = bed(saved.music, 'music');
  const ambience = bed(saved.ambience, 'ambience');
  const sfx = saved.sfx.flatMap((s) => {
    const asset = find(s.assetCode, `sfx scene ${s.sceneIndex + 1}`);
    return asset ? [{ asset, sceneIndex: s.sceneIndex, volume: s.volume }] : [];
  });
  return { music, ambience, sfx, notes };
}

/** Licence summary stored with every rendered video (rights QA evidence). */
export function licenceRecord(asset: AudioAsset) {
  return {
    assetCode: asset.assetCode,
    kind: asset.kind,
    title: asset.title,
    creator: asset.creator,
    source: asset.source,
    sourceUrl: asset.sourceUrl,
    licenceType: asset.licenceType,
    licenceVersion: asset.licenceVersion,
    licenceUrl: asset.licenceUrl,
    allowedPlatforms: asset.allowedPlatforms,
    attributionText: asset.attributionRequired ? asset.attributionText : null,
    licenceCheckedOn: asset.licenceCheckedOn,
    licenceEvidenceUri: asset.licenceEvidenceUri,
    checksumSha256: asset.checksumSha256,
  };
}
