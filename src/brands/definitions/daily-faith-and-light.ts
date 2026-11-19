import { DEVOTIONAL_SLOTS, GLOBAL_CONTENT_RULES, PLATFORMS_ALL } from '../shared.js';
import type { BrandConfig } from '../types.js';

export const dailyFaithAndLight: BrandConfig = {
  id: 'daily-faith-and-light',
  brandNumber: 2,
  displayName: 'Daily Faith and Light',
  language: 'en',
  locale: 'en-US',
  audience: 'Adults in the United States seeking general spiritual encouragement',
  niche: 'spirituality',
  tradition: 'general',
  madeForKids: false,
  dailyVideoTarget: 3,
  publishTimezone: 'America/New_York',
  platforms: [...PLATFORMS_ALL],
  contentSlots: DEVOTIONAL_SLOTS,
  topics: [
    'Faith',
    'Hope',
    'Kindness',
    'Gratitude',
    'Forgiveness',
    'Compassion',
    "God's presence",
    'Trust in God',
    'Spiritual strength',
    'Finding peace during difficult times',
  ],
  validation: { factCheck: true, scriptureCheck: true, childSafety: false },
  contentRules: [
    ...GLOBAL_CONTENT_RULES,
    'General spirituality only: never assign the content to Christianity, Hinduism or any specific religion.',
    'If a quotation from any sacred text is used, verify and cite it exactly; otherwise avoid quotations.',
    'No fake miracle claims and no promises of health, wealth or guaranteed outcomes.',
  ],
  visualIdentity: {
    style: 'Luminous painterly illustration: soft light, nature, sunrise and quiet human moments',
    palette: ['#FFF8E7', '#F2C57C', '#7FB3D5', '#3D5A80', '#FDFCDC'],
    typography: 'Warm humanist serif for quotes, simple sans-serif for captions',
    characterNotes: 'Universal, non-denominational people and settings; no religion-specific symbols',
    pacing: 'Gentle fades and slow parallax; calm and reassuring',
    avoid: ['Religion-specific iconography', 'Fear-based messaging', 'Prosperity promises'],
  },
  voice: {
    direction:
      'Warm, reassuring American woman; gentle, hopeful and comforting - like a kind friend, non-denominational.',
    elevenLabs: {
      voiceId: 'DLsHlh26Ugcm6ELvS0qi',
      name: 'Ms. Walker - Warm, Reassuring, and Round',
      source: 'library',
    },
    alternatives: [
      { voiceId: '7AvtJrjTNyBhBxEvNPIZ', name: 'Rhythm - Calm & Friendly Meditation', source: 'library' },
    ],
  },
};
