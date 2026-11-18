import { GLOBAL_CONTENT_RULES, PLATFORMS_ALL, SELF_IMPROVEMENT_SLOTS } from '../shared.js';
import type { BrandConfig } from '../types.js';

export const quietGrowth: BrandConfig = {
  id: 'quiet-growth',
  brandNumber: 1,
  displayName: 'Quiet Growth',
  language: 'en',
  locale: 'en-US',
  audience: 'Adults in the United States',
  niche: 'self_improvement',
  tradition: 'none',
  madeForKids: false,
  dailyVideoTarget: 3,
  publishTimezone: 'America/New_York',
  platforms: [...PLATFORMS_ALL],
  contentSlots: SELF_IMPROVEMENT_SLOTS,
  topics: [
    'Mindset',
    'Overthinking',
    'Emotional intelligence',
    'Relationships',
    'Boundaries',
    'Habits',
    'Discipline',
    'Confidence',
    'Personal growth',
    'Motivation',
  ],
  validation: { factCheck: true, scriptureCheck: false, childSafety: false },
  contentRules: [
    ...GLOBAL_CONTENT_RULES,
    'Calm, grounded, practical tone - no hype or toxic-positivity.',
    'Psychology claims must be accurate and not presented as medical or therapeutic advice.',
  ],
  visualIdentity: {
    style:
      'Minimal editorial illustration with soft grain, quiet everyday scenes and generous negative space',
    palette: ['#2F3E46', '#52796F', '#CAD2C5', '#F4F1DE', '#E07A5F'],
    typography: 'Clean geometric sans-serif, sentence case, high-contrast captions',
    characterNotes: 'Diverse adult characters drawn with simple line work and consistent proportions',
    pacing: 'Slow, reflective transitions; one idea per scene',
    avoid: ['Stock-photo clichés', 'Luxury/wealth flexing imagery', 'Aggressive red-text hooks'],
  },
};
