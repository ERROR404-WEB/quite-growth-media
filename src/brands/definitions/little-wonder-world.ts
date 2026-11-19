import { GLOBAL_CONTENT_RULES, KIDS_RULES, KIDS_SLOTS, PLATFORMS_ALL } from '../shared.js';
import type { BrandConfig } from '../types.js';

export const littleWonderWorld: BrandConfig = {
  id: 'little-wonder-world',
  brandNumber: 7,
  displayName: 'Little Wonder World',
  language: 'en',
  locale: 'en-US',
  audience: 'Children aged 2-6 in the United States and their families',
  niche: 'kids',
  tradition: 'none',
  ageRange: { min: 2, max: 6 },
  madeForKids: true,
  dailyVideoTarget: 3,
  publishTimezone: 'America/New_York',
  platforms: [...PLATFORMS_ALL],
  contentSlots: KIDS_SLOTS,
  topics: [
    'Alphabet',
    'Numbers',
    'Colours',
    'Shapes',
    'Animals',
    'Fruits',
    'Basic vocabulary',
    'Counting',
    'Simple manners',
    'Friendship',
    'Kindness',
    'Imagination',
    'Everyday learning',
  ],
  validation: { factCheck: true, scriptureCheck: false, childSafety: true },
  contentRules: [...GLOBAL_CONTENT_RULES, ...KIDS_RULES, 'Use simple American English vocabulary.'],
  visualIdentity: {
    style: 'Soft rounded 2D storybook illustration with simple, gentle animation',
    palette: ['#FFD166', '#06D6A0', '#118AB2', '#EF476F', '#FFF9F0'],
    typography: 'Large rounded sans-serif, high contrast, few words per screen',
    characterNotes: 'Original friendly animal and child characters with a fixed model sheet for consistency',
    pacing: 'Gentle, repetitive and predictable; no sudden loud changes',
    avoid: [
      'Scary or violent scenes',
      'Dangerous behaviour',
      'Look-alikes of famous kids’ characters',
      'Flashing lights',
    ],
  },
  voice: {
    direction:
      'Pip, an original cartoon bunny mascot: high-pitched, bouncy, funny and kind; sing-song for rhymes, gentle for stories.',
    designPrompt:
      'American English with clear, simple pronunciation. An original animated cartoon character voice: Pip, a tiny, cheerful bunny. High-pitched, bright and bouncy, playful and a little silly, with warm giggles and a gentle sing-song rhythm for nursery rhymes and bedtime stories. Friendly and kind, never shrill, harsh or loud. Clean, studio-quality recording.',
    previewText:
      "Hi, little friends! It's me, Pip the bunny. Today we are counting the stars together. One little star, two little stars, three little stars that twinkle and wink! Let's clap our paws and sing along with me. Clap, clap, hooray!",
    alternatives: [],
  },
};
