import { GLOBAL_CONTENT_RULES, KIDS_RULES, KIDS_SLOTS, PLATFORMS_ALL } from '../shared.js';
import type { BrandConfig } from '../types.js';

export const nanheSitare: BrandConfig = {
  id: 'nanhe-sitare',
  brandNumber: 8,
  displayName: 'Nanhe Sitare',
  nativeName: 'नन्हे सितारे',
  language: 'hi',
  locale: 'hi-IN',
  audience: 'Hindi-speaking children aged 2-6 and their families',
  niche: 'kids',
  tradition: 'none',
  ageRange: { min: 2, max: 6 },
  madeForKids: true,
  dailyVideoTarget: 3,
  publishTimezone: 'Asia/Kolkata',
  platforms: [...PLATFORMS_ALL],
  contentSlots: KIDS_SLOTS,
  topics: [
    'Hindi alphabets',
    'Numbers',
    'Colours',
    'Shapes',
    'Animals',
    'Fruits',
    'Basic words',
    'Counting',
    'Good habits',
    'Friendship',
    'Kindness',
    'Simple learning activities',
  ],
  validation: { factCheck: true, scriptureCheck: false, childSafety: true },
  contentRules: [
    ...GLOBAL_CONTENT_RULES,
    ...KIDS_RULES,
    'Original Hindi rhymes and stories only - never translate English or Telugu kids content.',
    'Hindi letters (वर्णमाला) and pronunciation must be correct.',
  ],
  visualIdentity: {
    style: 'Bright, cosy Indian storybook illustration with simple cut-out style animation',
    palette: ['#FF8C42', '#FFD23F', '#3BCEAC', '#0EAD69', '#FFF8EC'],
    typography: 'Large rounded Devanagari font, one word or letter in focus',
    characterNotes: 'Own original Indian child and animal characters, distinct from the other kids brands',
    pacing: 'Gentle and repetitive with sing-along rhythm',
    avoid: [
      'Scary or violent scenes',
      'Dangerous behaviour',
      'Look-alikes of famous kids’ characters',
      'Flashing lights',
    ],
  },
  voice: {
    direction:
      'Chamku, an original cartoon little-star mascot: high-pitched, bubbly, funny and kind; sing-song for Hindi rhymes, gentle for stories.',
    designPrompt:
      'Native Hindi speaker with clear, standard Hindi pronunciation. An original animated cartoon character voice: Chamku, a tiny, twinkly little star. High-pitched, bright, bubbly and funny, with playful giggles and a gentle sing-song rhythm for Hindi rhymes and bedtime stories. Warm and kind, never shrill, harsh or loud. Clean, studio-quality recording.',
    previewText:
      'नमस्ते दोस्तों! मैं हूँ चमकू, आसमान का नन्हा सितारा। आज हम मिलकर गिनती गाएँगे। एक, दो, तीन, चार... देखो, कितने सारे तारे टिमटिमा रहे हैं! चलो, ताली बजाओ और मेरे साथ गाओ, ला ला ला!',
    alternatives: [],
  },
};
