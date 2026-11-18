import type { Language } from '../domain/constants.js';

/** Approximate natural narration pace (words per second) used when no voice audio exists yet. */
const WORDS_PER_SECOND: Record<Language, number> = { en: 2.6, hi: 2.4, te: 1.9 };
export const SCENE_PADDING_SEC = 0.7;
export const MIN_SCENE_SEC = 2.5;

export function estimateSpeechSeconds(text: string, language: Language): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / WORDS_PER_SECOND[language];
}

/** Scene length: narration length plus breathing room, never shorter than MIN_SCENE_SEC. */
export function sceneDuration(speechSec: number): number {
  return Math.max(MIN_SCENE_SEC, Math.round((speechSec + SCENE_PADDING_SEC) * 100) / 100);
}

export interface TimelineEntry {
  /** When the scene starts on the final timeline (its transition-in begins here). */
  start: number;
  /** How long the scene owns the timeline. */
  duration: number;
  /** Length of the scene's video stream: includes the overlap consumed by the next crossfade. */
  streamLength: number;
}

/**
 * Lays scenes end to end. Each crossfade overlaps the next scene by `transition` seconds, so every
 * stream except the last is extended by that amount and the total equals the sum of durations.
 */
export function buildTimeline(durations: readonly number[], transition: number): TimelineEntry[] {
  let start = 0;
  return durations.map((duration, i) => {
    if (duration <= transition) throw new Error(`Scene ${i} (${duration}s) is shorter than the transition`);
    const entry = { start, duration, streamLength: duration + (i < durations.length - 1 ? transition : 0) };
    start += duration;
    return entry;
  });
}

export function totalDuration(timeline: readonly TimelineEntry[]): number {
  const last = timeline.at(-1);
  return last ? last.start + last.duration : 0;
}
