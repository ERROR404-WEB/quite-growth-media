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

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'quarantined', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = {
  contentPlan: 'content.plan',
  systemNoop: 'system.noop',
} as const;
