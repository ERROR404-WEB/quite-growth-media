import type { PaletteMood } from '../domain/constants.js';
import type { BrandConfig, ContentSlot, DurationTarget } from './types.js';

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
    publishTime: '08:00',
    category: 'mindset_growth',
    label: 'Mindset reframes & personal evolution',
    description:
      'Mental-health reframes (overthinking as depth, sensitivity as strength), personal evolution (outgrowing people, identity shifts, becoming unrecognisable) and contrarian wisdom (popular advice that is wrong).',
  },
  {
    slot: 2,
    publishTime: '13:00',
    category: 'relationships_eq',
    label: 'Relationships, boundaries & social dynamics',
    description:
      'Letting go, choosing yourself, toxic patterns, boundaries without guilt, the power of silence, being misunderstood and choosing your circle.',
  },
  {
    slot: 3,
    publishTime: '20:00',
    category: 'habits_discipline',
    label: 'Ambition, discipline & redefining success',
    description:
      'Redefining success, strategic rest, unconventional paths, discipline without burnout, quiet consistency and starting over.',
  },
];

/**
 * The final formula for the three self-improvement brands (docs/creative-direction.md): every idea
 * activates identity signalling, a permission reframe and an emotional swing, then is written as
 * hook → message → metaphor → conclusion.
 */
export const SELF_IMPROVEMENT_CREATIVE_RULES = [
  'Every video must hold ONE clear message and follow the 4 steps: 1 THE HOOK - the first 3 seconds stop the scroll instantly, like a Netflix thumbnail: bold, intriguing, impossible to ignore; 2 THE MESSAGE - once you have stopped them, keep them: deliver the core value, the reason they came, the insight they needed; 3 THE METAPHOR - make the concept sticky and visual: the "Aha!" moment that triggers screenshots, saves and rewatches; 4 THE CONCLUSION - don\'t end, loop: the last line pulls viewers back to the beginning so the video keeps replaying.',
  'Every idea must activate three triggers: IDENTITY SIGNAL (sharing it says something aspirational about who the viewer is), PERMISSION (reframe something the viewer feels guilty about as secretly wise, brave or strategic) and EMOTIONAL SWING (start in tension or pain, land in relief, pride or quiet confidence - the bigger the honest swing, the more shareable).',
  'One video = one core message = one emotional swing. It must create an "I needed to hear this" reaction and pass the screenshot test: the key line works alone as an image quote.',
  'Speak to the viewer directly ("you"), with deep feeling: name the hidden pain precisely, then lift them. Short, rhythmic, quotable lines; every sentence could stand alone as a quote. No filler, hedging or qualifiers.',
  'Sound like a calm, wise friend talking softly late at night: short, simple clauses of 2-6 words that land one at a time; reframe pairs ("It\'s not X. It\'s Y." / "You didn\'t X. You simply Y.") are the signature rhythm; gentle reassurance, never preachy, never hype or shouting.',
  'Match only the format and feeling of reference videos - never reuse their lines, metaphors or exact framing, or those of any other creator.',
  'A 15-year-old and a 50-year-old must both understand it on first listen: concrete, sensory words; no jargon.',
  'Never use clichés such as "everything happens for a reason", "never give up", "believe in yourself", "your time will come" or "you can\'t pour from an empty cup" (or their equivalents in any language); state metaphors freshly.',
  'Reframes must be honest: never romanticise clinical anxiety, depression or self-harm, never discourage professional help, never glorify cutting everyone off or quitting everything, no toxic positivity, nothing the viewer would be embarrassed to share.',
  'Never claim that a topic is trending unless verified research says so. No rage-bait or polarising provocation for its own sake.',
  'Do not force a call to action; never ask viewers to like, follow, share, comment or subscribe.',
] as const;

/** 19–27 s, sweet spot 22–25 s (docs/creative-direction.md). */
export const SELF_IMPROVEMENT_DURATION: DurationTarget = {
  minSec: 19,
  maxSec: 27,
  idealMinSec: 22,
  idealMaxSec: 25,
};

/**
 * Shared art style of the self-improvement brands: premium warm lo-fi anime, modelled on the owner's
 * reference reel (creative direction v3, 18 Nov 2026; docs/creative-sources/reference-reel-analysis.md).
 * It replaces v2's "vivid cinematic anime". Brands add settings, characters and accents.
 */
export const STORYBOOK_ANIME_STYLE =
  'Premium hand-painted anime-style illustration with a warm vintage lo-fi film look: soft painterly brushwork with fine, clean detail and delicate line art; gentle realistic proportions; calm, understated, emotionally readable faces with soft catch-lights in the eyes; muted, warm, slightly faded colour - amber and honey sunlight, sepia-cream highlights, dusty teal and slate-blue skies and shadows, softly lifted blacks; quiet, cinematic and intimate, like a still frame from a hand-painted animated film - calm and premium, never glossy, neon or over-saturated';

export const STORYBOOK_LIGHTING =
  'Soft, warm natural light that carries the feeling: low golden sun, late-afternoon window light, a warm lamp glow at night or distant amber city lights; gentle rim light on hair and shoulders; hazy, slightly dusty air with soft light shafts; shadows are soft warm-brown or muted teal, never pure black or harsh; the face or focal point is the warmest, brightest area of the frame.';

export const STORYBOOK_COMPOSITION =
  'Calm, cinematic framing with room to breathe: one solitary subject (or one symbolic object), rule of thirds, often seen from behind or in three-quarter profile gazing into the distance, or a soft close portrait in window light; clear foreground / midground / background depth and generous sky or soft negative space; only gentle natural motion - wind in hair and coat, drifting leaves or petals, slow clouds, soft rain, distant city lights. Never busy, cluttered or action-packed.';

/** Line-mood palettes: muted, warm lo-fi versions of the moods (creative direction v3, 18 Nov 2026). */
export const MOOD_PALETTES = {
  // Faded blue hour: slate and dusty teal with a warm amber glow.
  contemplative: ['#2B3A4A', '#4D6578', '#7E97A6', '#C9B79C', '#E3C48F', '#F1E6D2'],
  // Warm golden hour: honey, amber and cream against muted teal shadows.
  intimate: ['#C98A4B', '#E0A866', '#F2CF94', '#F6E7C8', '#7A5236', '#3F4E52'],
  // Soft dawn: misty sage, pale teal and warm cream.
  peaceful: ['#8FB3B8', '#B9CFC9', '#E8DCC0', '#D9B98A', '#6F8F7E', '#F4EDE0'],
  // Amber-lit night: deep navy and slate with warm lamp and city-light gold.
  night: ['#141B26', '#24324A', '#3B4A63', '#D9A35B', '#F0C987', '#8A6F5A'],
} as const satisfies Record<PaletteMood, readonly string[]>;

/** Mutable copy of the mood palettes for a brand config. */
export function moodPalettes(): Record<PaletteMood, string[]> {
  return {
    contemplative: [...MOOD_PALETTES.contemplative],
    intimate: [...MOOD_PALETTES.intimate],
    peaceful: [...MOOD_PALETTES.peaceful],
    night: [...MOOD_PALETTES.night],
  };
}

export const SKIN_TONES = {
  all: [
    '#C7A196',
    '#D0A789',
    '#C5A98D',
    '#C1926D',
    '#CC9B81',
    '#9F786C',
    '#8A5F4F',
    '#BA8671',
    '#75594B',
    '#9C7A65',
  ],
  southAsian: ['#C1926D', '#CC9B81', '#9F786C', '#8A5F4F', '#BA8671', '#75594B', '#9C7A65'],
} as const;

/**
 * Warm lo-fi film finish applied in FFmpeg (reference reel): slightly muted colour, warm temperature,
 * lifted blacks, visible fine grain, procedural dust specks and a strong vignette.
 */
export const VINTAGE_FILM_GRADE = {
  saturation: 0.92,
  contrast: 1.04,
  grain: 7,
  vignette: true,
  vignetteAngle: 0.8,
  temperature: 5600,
  fade: 0.05,
  dust: true,
} as const;

/** Near-still images like the reference reel: a gentle push or drift and short soft crossfades. */
export const CALM_MOTION = { strength: 0.45, transition: 0.35 } as const;

/**
 * ElevenLabs settings for the calm narrator of the reference reel: steadier than v2's 0.35 (official
 * API reference: lower = broader emotional range, higher = more stable) and a little slower than normal.
 */
export const CALM_NARRATION = { stability: 0.5, speed: 0.92 } as const;

export const STORYBOOK_AVOID = [
  'Glossy 3D, CGI or plastic-looking rendering',
  'Over-saturated, neon or harsh HDR colour',
  'Photorealism or a stock-photo look',
  'Busy, cluttered frames or several competing focal points',
  'Pure-black shadows that hide the face',
  'Chibi, cheap cartoon style or exaggerated proportions',
  'Dramatic action poses, shouting or exaggerated crying',
  'Generic motivational-poster visuals or glowing brains',
  'Repeating the same composition or setting in consecutive images',
  'Literal illustration of the narration without creative interpretation',
] as const;

/**
 * One image set shared by Quiet Growth, Behtar Bano and Ninnu Nuvvu Geluvu for the same topic
 * (owner decision 18 Nov 2026). Characters and places must feel at home to US and Indian viewers alike.
 */
export const UNIVERSAL_VISUAL_IDENTITY: BrandConfig['visualIdentity'] = {
  style: `${STORYBOOK_ANIME_STYLE}; universal look - places without country-specific signs, so the same image feels like home to viewers in the US and in India`,
  palette: ['#2B3A4A', '#4D6578', '#C9B79C', '#F1E6D2', '#E0A866', '#C98A4B'],
  typography: 'Shared images carry no text; each brand adds its own captions',
  characterNotes:
    'Original young adults with warm brown skin and dark hair, in simple modern clothes in muted earth tones (cream, beige, olive, charcoal), with no clothing, jewellery or symbols tied to one culture or religion; keep features and outfits identical whenever a character recurs',
  pacing: 'Calm and unhurried: one line, one near-still image; gentle push-ins; soft crossfades',
  avoid: [
    ...STORYBOOK_AVOID,
    'Country-specific signs, flags, landmarks, number plates, shop names or any text',
    'Religious or culture-specific symbols and clothing',
  ],
  mood: ['calm', 'reflective', 'tender', 'quietly hopeful'],
  environments: [
    'A grassy hilltop or meadow path under a huge soft sky',
    'A misty mountain overlook at dawn',
    'A quiet room by a large window with books, plants and a warm lamp',
    'A lone tree on a hill with leaves drifting in the wind',
    'A rooftop or balcony at dusk above distant city lights',
    'An empty shore or field at golden hour',
    'A rainy evening street with soft blurred lights',
  ],
  lighting: STORYBOOK_LIGHTING,
  composition: STORYBOOK_COMPOSITION,
  moodPalettes: moodPalettes(),
  skinTones: [...SKIN_TONES.southAsian],
  grade: { ...VINTAGE_FILM_GRADE },
  captionStyle: 'soft_handwritten',
  motion: { ...CALM_MOTION },
};

export const DEVOTIONAL_SLOTS: ContentSlot[] = [
  {
    slot: 1,
    publishTime: '08:00',
    category: 'stories_teachings',
    label: 'Stories, teachings & spiritual knowledge',
    description: 'Stories, teachings or spiritual knowledge with traceable sources.',
  },
  {
    slot: 2,
    publishTime: '13:00',
    category: 'goodness',
    label: 'Goodness',
    description: 'Kindness, gratitude, forgiveness and compassion.',
  },
  {
    slot: 3,
    publishTime: '20:00',
    category: 'god_centred_motivation',
    label: 'God-centred motivation',
    description: 'Faith, hope, patience and reassurance - without false promises.',
  },
];

export const KIDS_SLOTS: ContentSlot[] = [
  {
    slot: 1,
    publishTime: '08:00',
    category: 'rhyme_song',
    label: 'Original rhyme or song',
    description: 'An original rhyme or song with original lyrics, melody and characters.',
  },
  {
    slot: 2,
    publishTime: '13:00',
    category: 'illustrated_story',
    label: 'Short illustrated story',
    description: 'A short illustrated or bedtime story with original characters.',
  },
  {
    slot: 3,
    publishTime: '20:00',
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
