import { GLOBAL_CONTENT_RULES, KIDS_RULES, KIDS_SLOTS, PLATFORMS_ALL } from '../shared.js';
import type { BrandConfig } from '../types.js';

export const chinniLokam: BrandConfig = {
  id: 'chinni-lokam',
  brandNumber: 9,
  displayName: 'Chinni Lokam',
  nativeName: 'చిన్ని లోకం',
  language: 'te',
  locale: 'te-IN',
  audience: 'Telugu-speaking children aged 2-6 and their families',
  niche: 'kids',
  tradition: 'none',
  ageRange: { min: 2, max: 6 },
  madeForKids: true,
  dailyVideoTarget: 3,
  publishTimezone: 'Asia/Kolkata',
  platforms: [...PLATFORMS_ALL],
  contentSlots: KIDS_SLOTS,
  topics: [
    'Telugu letters',
    'Numbers',
    'Colours',
    'Shapes',
    'Animals',
    'Fruits',
    'Basic vocabulary',
    'Counting',
    'Good habits',
    'Friendship',
    'Kindness',
    'Simple educational activities',
  ],
  validation: { factCheck: true, scriptureCheck: false, childSafety: true },
  contentRules: [
    ...GLOBAL_CONTENT_RULES,
    ...KIDS_RULES,
    'Original Telugu rhymes and stories only - never translate English or Hindi kids content.',
    'Telugu letters (అక్షరమాల) and pronunciation must be correct.',
  ],
  visualIdentity: {
    style: 'Playful watercolour-texture illustration with South Indian village and nature settings',
    palette: ['#F9C74F', '#90BE6D', '#43AA8B', '#F94144', '#FFFCF2'],
    typography: 'Large rounded Telugu font with clear letter shapes',
    characterNotes: 'Own original Telugu child and animal characters, distinct from the other kids brands',
    pacing: 'Calm, repetitive and musical',
    avoid: [
      'Scary or violent scenes',
      'Dangerous behaviour',
      'Look-alikes of famous kids’ characters',
      'Flashing lights',
    ],
  },
  voice: {
    direction:
      'Chitti, an original cartoon parrot mascot: high-pitched, chirpy, funny and kind; sing-song for Telugu rhymes, gentle for stories.',
    designPrompt:
      'Native Telugu speaker with clear, natural Telugu pronunciation. An original animated cartoon character voice: Chitti, a tiny, friendly green parrot. High-pitched, bright, chirpy and funny, with cheerful giggles and a gentle sing-song rhythm for Telugu rhymes and bedtime stories. Warm and kind, never shrill, harsh or loud. Clean, studio-quality recording.',
    previewText:
      'హాయ్ పిల్లలూ! నేను చిట్టి, మీ చిన్ని చిలుకని. ఈ రోజు మనం కలిసి అంకెలు లెక్కపెడదాం. ఒకటి, రెండు, మూడు, నాలుగు, ఐదు! చూడండి, ఎన్ని మామిడి పండ్లో! రండి, చప్పట్లు కొడుతూ నాతో పాట పాడండి, లల్లల్లా!',
    alternatives: [],
  },
};
