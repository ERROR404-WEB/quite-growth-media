import type { ContentSlot } from './types.js';

/** Rules applied to every brand. Brand files add their own on top. */
export const GLOBAL_CONTENT_RULES = [
  'Create every script independently for this brand. Never translate or adapt another brand’s script, rhyme or story.',
  'Never produce a minor variation of an existing script; a shared broad theme is fine only with a genuinely new angle and execution.',
  'Do not imitate copyrighted characters, specific creators or protected works.',
  'Never guarantee outcomes such as income, health, success or miracles.',
  'Use natural, native-quality language for the brand audience - not literal translation.',
] as const;

export const SELF_IMPROVEMENT_SLOTS: ContentSlot[] = [
  {
    slot: 1,
    category: 'mindset_growth',
    label: 'Mindset & personal growth',
    description: 'Mindset shifts, overthinking, confidence and personal growth.',
  },
  {
    slot: 2,
    category: 'relationships_eq',
    label: 'Relationships & emotional intelligence',
    description: 'Relationships, boundaries, empathy and emotional intelligence.',
  },
  {
    slot: 3,
    category: 'habits_discipline',
    label: 'Habits, discipline & motivation',
    description: 'Practical habits, discipline, productivity and motivation.',
  },
];

export const DEVOTIONAL_SLOTS: ContentSlot[] = [
  {
    slot: 1,
    category: 'stories_teachings',
    label: 'Stories, teachings & spiritual knowledge',
    description: 'Stories, teachings or spiritual knowledge with traceable sources.',
  },
  {
    slot: 2,
    category: 'goodness',
    label: 'Goodness',
    description: 'Kindness, gratitude, forgiveness and compassion.',
  },
  {
    slot: 3,
    category: 'god_centred_motivation',
    label: 'God-centred motivation',
    description: 'Faith, hope, patience and reassurance - without false promises.',
  },
];

export const KIDS_SLOTS: ContentSlot[] = [
  {
    slot: 1,
    category: 'rhyme_song',
    label: 'Original rhyme or song',
    description: 'An original rhyme or song with original lyrics, melody and characters.',
  },
  {
    slot: 2,
    category: 'illustrated_story',
    label: 'Short illustrated story',
    description: 'A short illustrated or bedtime story with original characters.',
  },
  {
    slot: 3,
    category: 'learning_video',
    label: 'Early-learning video',
    description: 'A visually engaging early-learning video (letters, numbers, colours, shapes, words).',
  },
];

export const KIDS_RULES = [
  'Use age-appropriate language and concepts for the configured age range.',
  'No frightening, violent or unsafe imagery, behaviour or challenges.',
  'No manipulative calls to subscribe, like, share or comment.',
  'Never ask for or collect children’s personal information.',
  'No misleading educational claims; facts (counting, letters, animals) must be correct.',
  'Use only original or properly licensed music; never copyrighted rhyme recordings or protected arrangements.',
  'Record the origin and rights status of lyrics, composition and recording for every rhyme.',
] as const;

export const HINDU_DEVOTIONAL_RULES = [
  'Verify every scripture claim; store book, chapter, verse and translation.',
  'Distinguish direct quotations from interpretation.',
  'Reject fabricated or misattributed verses; rewrite or drop anything unverifiable.',
  'No fake miracle claims and no promises of health, wealth or guaranteed success.',
  'Treat all deities, scriptures and traditions with respect.',
] as const;

export const PLATFORMS_ALL = ['instagram', 'facebook', 'youtube', 'x'] as const;
