// Shared domain vocabulary. Keep in sync with CHECK constraints in migrations/.

export const LANGUAGES = ['en', 'hi', 'te'] as const;
export type Language = (typeof LANGUAGES)[number];

export const NICHES = ['self_improvement', 'spirituality', 'hindu_devotional', 'kids'] as const;
export type Niche = (typeof NICHES)[number];

export const PLATFORMS = ['instagram', 'facebook', 'youtube', 'x'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const DURATION_BUCKETS = ['7-12', '13-20', '21-30', '31-45'] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

const BUCKET_RANGES: Record<DurationBucket, readonly [number, number]> = {
  '7-12': [7, 12],
  '13-20': [13, 20],
  '21-30': [21, 30],
  '31-45': [31, 45],
};

/** Maps a duration in seconds to its reporting bucket, or null when outside 7–45 s. */
export function durationBucketFor(seconds: number): DurationBucket | null {
  if (!Number.isFinite(seconds)) return null;
  const rounded = Math.round(seconds);
  for (const bucket of DURATION_BUCKETS) {
    const [min, max] = BUCKET_RANGES[bucket];
    if (rounded >= min && rounded <= max) return bucket;
  }
  return null;
}

export const CONTENT_CATEGORIES = {
  self_improvement: ['mindset_growth', 'relationships_eq', 'habits_discipline'],
  spirituality: ['stories_teachings', 'goodness', 'god_centred_motivation'],
  hindu_devotional: ['stories_teachings', 'goodness', 'god_centred_motivation'],
  kids: ['rhyme_song', 'illustrated_story', 'learning_video'],
} as const satisfies Record<Niche, readonly string[]>;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[Niche][number];

// Creative direction (docs/creative-direction.md).

/**
 * Story beats. Self-improvement: hook → message (2-4 parallel lines) → metaphor → conclusion
 * (docs/creative-direction.md). Other niches: hook → story → payoff.
 */
export const STORY_BEATS = ['hook', 'message', 'metaphor', 'conclusion', 'story', 'payoff'] as const;
export type StoryBeat = (typeof STORY_BEATS)[number];

/**
 * Silence after a line: [BEAT] = 0.7 s, [PAUSE] = 1.2 s - the long, breathing gaps of the reference
 * reel (0.5-2 s between lines; creative direction v3).
 */
export const PAUSES = ['none', 'beat', 'pause'] as const;
export type Pause = (typeof PAUSES)[number];
export const PAUSE_SECONDS: Record<Pause, number> = { none: 0, beat: 0.7, pause: 1.2 };

/** Parallel-structure patterns for the message lines. */
export const PARALLEL_PATTERNS = [
  'A_repetitive_opener',
  'B_contrasting_pairs',
  'C_escalating_list',
  'D_negation_affirmation',
] as const;
export type ParallelPattern = (typeof PARALLEL_PATTERNS)[number];

/** Image composition per line. */
export const SHOT_TYPES = [
  'vast_landscape',
  'close_up_portrait',
  'two_people',
  'symbolic_object',
  'night_urban',
  'indoor_reflection',
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

/** Colour mood per line (palettes in src/brands/shared.ts). */
export const PALETTE_MOODS = ['contemplative', 'intimate', 'peaceful', 'night'] as const;
export type PaletteMood = (typeof PALETTE_MOODS)[number];

export const DELIVERY_STYLES = [
  'calm_reflection',
  'intimate',
  'soft_sadness',
  'honest_vulnerability',
  'firm_self_respect',
  'quiet_confidence',
  'encouraging',
  'warm',
  'controlled_intensity',
  'playful',
  'reverent',
] as const;
export type DeliveryStyle = (typeof DELIVERY_STYLES)[number];

// Audio library (migrations/0002_audio_library.sql). Keep in sync with its CHECK constraints.

export const MUSIC_MOODS = [
  'calm',
  'emotional',
  'sad',
  'heartbreak',
  'healing',
  'hopeful',
  'motivational',
  'cinematic',
  'suspense',
  'curiosity',
  'confidence',
  'reflective',
  'ambient',
  'playful',
  'lullaby',
  'devotional',
] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

/** Ambience beds loop under a whole video; one-shot effects are placed at a scene. */
export const AMBIENCE_CATEGORIES = [
  'rain',
  'wind',
  'room_ambience',
  'city_ambience',
  'nature_ambience',
] as const;
export type AmbienceCategory = (typeof AMBIENCE_CATEGORIES)[number];

export const ONE_SHOT_SFX = [
  'whoosh',
  'soft_impact',
  'cinematic_hit',
  'transition',
  'suspense',
  'footsteps',
  'paper',
  'clock',
  'soft_texture',
  'emotional_transition',
] as const;
export type OneShotSfx = (typeof ONE_SHOT_SFX)[number];

export const SFX_CATEGORIES = [...ONE_SHOT_SFX, ...AMBIENCE_CATEGORIES] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];

export const AUDIO_KINDS = ['music', 'sound_effect'] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

export const AUDIO_SOURCES = ['pixabay', 'mixkit', 'youtube_audio_library', 'original', 'other'] as const;
export type AudioSource = (typeof AUDIO_SOURCES)[number];

export const AUDIO_LICENCE_TYPES = [
  'pixabay_content_license',
  'mixkit_music_free',
  'mixkit_sfx_free',
  'youtube_audio_library',
  'cc0',
  'cc_by',
  'original_work',
  'custom',
] as const;
export type AudioLicenceType = (typeof AUDIO_LICENCE_TYPES)[number];

/** Tri-state rights answer: anything not explicitly "allowed" blocks approval. */
export const RIGHTS_ANSWERS = ['allowed', 'prohibited', 'unknown'] as const;
export type RightsAnswer = (typeof RIGHTS_ANSWERS)[number];

export const CONTENT_ID_STATUSES = ['not_registered', 'registered', 'unknown'] as const;
export type ContentIdStatus = (typeof CONTENT_ID_STATUSES)[number];

export const AUDIO_ASSET_STATUSES = ['pending_review', 'approved', 'rejected', 'retired'] as const;
export type AudioAssetStatus = (typeof AUDIO_ASSET_STATUSES)[number];

export const AUDIO_USAGE_ROLES = ['music', 'ambience', 'sound_effect'] as const;
export type AudioUsageRole = (typeof AUDIO_USAGE_ROLES)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'quarantined', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = {
  contentPlan: 'content.plan',
  storyboardGenerate: 'storyboard.generate',
  scriptGenerate: 'script.generate',
  videoRender: 'video.render',
  videoPublish: 'video.publish',
  systemNoop: 'system.noop',
} as const;

// migrations/0003_pipeline_automation.sql
export const PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'published',
  'failed',
  'skipped',
  'removed',
  'needs_check',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** final = publishable renders (brand voice on a paid plan); test = labelled renders that the gate refuses. */
export const RENDER_MODES = ['final', 'test'] as const;
export type RenderMode = (typeof RENDER_MODES)[number];
