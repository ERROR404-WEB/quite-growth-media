import { z } from 'zod';
import type { BrandConfig } from '../brands/index.js';
import type {
  AmbienceCategory,
  DeliveryStyle,
  Language,
  MusicMood,
  OneShotSfx,
  PaletteMood,
  Pause,
  Platform,
  ShotType,
  StoryBeat,
} from '../domain/constants.js';
import {
  AMBIENCE_CATEGORIES,
  DELIVERY_STYLES,
  MUSIC_MOODS,
  ONE_SHOT_SFX,
  PALETTE_MOODS,
  PARALLEL_PATTERNS,
  PAUSE_SECONDS,
  SHOT_TYPES,
  STORY_BEATS,
} from '../domain/constants.js';
import type { VideoScript } from '../media/pipeline.js';
import type { Motion } from '../media/render.js';
import { MOTIONS } from '../media/render.js';
import {
  estimateSpeechSeconds,
  SCENE_PADDING_SEC,
  sceneDuration,
  WORDS_PER_SECOND,
} from '../media/timeline.js';
import type { OpenAiClient } from './openai-client.js';
import type { Budget } from './pricing.js';
import { textCostUsd } from './pricing.js';

export interface ScriptRequest {
  brand: BrandConfig;
  /** One of the brand's content slot categories. */
  contentCategory: string;
  /** Optional topic hint; otherwise the model picks from the brand topics. */
  topic?: string;
  /** Titles already used, so the model avoids repeating them. */
  avoidTitles?: readonly string[];
  /** Music moods that have approved licensed tracks; the script picks one of these or "none". */
  availableMusicMoods?: readonly MusicMood[];
  /**
   * Shared storyboard (same topic and images for several language brands). The brand writes its own
   * narration from the storyboard's meaning - never from another language's wording.
   */
  storyboard?: Storyboard;
  /** Problems found in the previous attempt, so the model fixes them instead of retrying blind. */
  feedback?: readonly string[];
}

/** One line of a shared storyboard: meaning and image only, no wording. */
export interface StoryboardLine {
  beat: StoryBeat;
  /** In English: what this line must make the viewer understand/feel (meaning only, never a sentence to translate). */
  intent: string;
  delivery: string;
  visual: string;
  shot: ShotType;
  palette: PaletteMood;
  camera: Motion;
  sfx: OneShotSfx | 'none';
}

/** One topic + one image set, shared by the self-improvement brands; each writes its own script. */
export interface Storyboard {
  title: string;
  idea: Omit<ScriptIdea, 'quotes' | 'hookScore' | 'quotabilityScore'>;
  characterDescription: string;
  soundDesign: SoundDesignBrief;
  lines: StoryboardLine[];
}

/** What the script asks the audio engine for; the audio library decides what is actually licensed and used. */
export interface SoundDesignBrief {
  music: MusicMood | 'none';
  ambience: AmbienceCategory | 'none';
}

/** Per-video publishing metadata, written fresh in the brand language. */
export interface VideoMetadata {
  youtubeTitle: string;
  shortDescription: string;
  /** Captions without hashtags; publishers append `hashtags`. */
  captions: Record<Platform, string>;
  hashtags: string[];
  keywords: string[];
}

export class ScriptValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Generated script failed validation:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ScriptValidationError';
  }
}

const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'natural American English',
  hi: 'pure, modern, everyday Hindi written in Devanagari script that every Hindi speaker understands (no English words or Hinglish, no heavy Sanskritised words)',
  te: 'pure, modern, everyday Telugu written in Telugu script that every Telugu speaker understands (no English words, no old literary Telugu)',
};

/** Share of letters that must be in the brand's script; Indic narration must be (almost) free of Latin letters. */
const MIN_NATIVE_SHARE: Record<Language, number> = { en: 0.85, hi: 0.97, te: 0.97 };

const SCRIPT_CHARS: Record<Language, RegExp> = {
  en: /[A-Za-z]/g,
  hi: /[\u0900-\u097F]/g,
  te: /[\u0C00-\u0C7F]/g,
};

/**
 * Platform text limits from the official help pages (checked 2026-11-18): YouTube title 100 characters
 * and description 5,000 bytes, Instagram caption 2,200 characters, X post 280 weighted characters.
 */
export const PLATFORM_TEXT_LIMITS = {
  youtubeTitleChars: 100,
  youtubeDescriptionBytes: 5000,
  instagramCaptionChars: 2200,
  xPostWeighted: 280,
} as const;

/** Our own anti-stuffing limits (stricter than the platforms). */
const HASHTAGS = { min: 3, max: 8 } as const;
const KEYWORDS = { min: 3, max: 10 } as const;
const DEFAULT_DURATION = { minSec: 7, maxSec: 45, idealMinSec: 15, idealMaxSec: 30 } as const;
/** The hook must land within ~3 s (creative direction). */
const HOOK_MAX_SEC = 3.5;
/** Minimum self-scores for the viral mechanics (owner's framework: 8+/10). */
const MIN_SCORE = 8;

// Manipulative calls to action are banned for children's content (spec section 6).
const KIDS_CTA =
  /\b(subscribe|like|share|comment|follow|click|tap|link in bio)\b|सब्सक्राइब|लाइक|शेयर|कमेंट|सब्स्क्राइब|సబ్‌స్క్రైబ్|సబ్స్క్రైబ్|లైక్|షేర్|కామెంట్/iu;
// Engagement bait is banned for every brand.
const ENGAGEMENT_BAIT =
  /\b(?:like and subscribe|smash (?:that|the) like|hit (?:the|that) (?:like|bell)|comment below|drop a comment|tag (?:a|your) friend|follow (?:for|me for) more|share (?:this|it) with|link in bio|subscribe (?:now|for more))\b|लाइक कर|सब्सक्राइब|सब्स्क्राइब|फॉलो कर|शेयर कर|कमेंट कर|సబ్‌స్క్రైబ్|సబ్స్క్రైబ్|లైక్ చేయ|షేర్ చేయ|ఫాలో అవ్వ|కామెంట్ చేయ/iu;
const FALSE_PROMISES = /\b(guarantee[ds]?|100% (?:sure|guaranteed)|get rich|cure[sd]?|miracle cure)\b/i;
/** Clichés banned for self-improvement brands; the prompt covers other wordings. */
const CLICHES =
  /everything happens for a reason|never give up|believe in yourself|your time will come|pour from an empty cup|सब कुछ किसी (?:वजह|कारण) से होता है|कभी हार मत मान|खुद पर (?:भरोसा|विश्वास) रख|(?:तुम्हारा|आपका) (?:भी )?(?:वक्त|वक़्त|समय) आएगा/iu;
const HASHTAG = /^#[\p{L}\p{M}\p{N}_]{2,60}$/u;
/** A short English voice direction, sent to Eleven v4 as an audio tag: "[soft, aching]". */
const DELIVERY = /^[a-z][a-z ,'-]{1,38}[a-z]$/i;

const SFX_CHOICES = [...ONE_SHOT_SFX, 'none'] as const;
const MUSIC_CHOICES = [...MUSIC_MOODS, 'none'] as const;
const AMBIENCE_CHOICES = [...AMBIENCE_CATEGORIES, 'none'] as const;
const ARC: readonly StoryBeat[] = ['hook', 'message', 'metaphor', 'conclusion'];

/** One-line descriptions of each shot type (used in the script prompt and the image prompt). */
export const SHOT_DESCRIPTIONS: Record<(typeof SHOT_TYPES)[number], string> = {
  vast_landscape:
    'one small solitary figure, often seen from behind, on a hilltop, meadow path, shore or mountain overlook, with a huge soft sky filling 60-70% of the frame - introspection, life wisdom',
  close_up_portrait:
    'soft close portrait from the chest up in three-quarter view, warm window or golden light on the face, calm emotion readable in the eyes, softly blurred background - feelings, direct truths',
  two_people:
    'two people together in a balanced composition (partners, friends or family) - holding hands, side by side, a gentle embrace, or meaningful distance between them - love, connection, letting go',
  symbolic_object:
    'one symbolic subject from nature or daily life (a lone tree shedding leaves, an open window, a path, a cup, a letter, hands) on a rule-of-thirds point against a simple background - the visual metaphor',
  night_urban:
    'a figure by a window, on a balcony or rooftop at night with warm city lights softly blurred below and a deep blue sky - modern life, choices, quiet determination',
  indoor_reflection:
    'a figure sitting by a large window in a cozy room with books, plants and a warm lamp, soft daylight or lamp light, gazing outside - understanding, reflection',
};

/**
 * Voice directions that fight the calm narrator of the self-improvement brands (creative direction v3):
 * the voice stays deep, slow and reassuring - never performed.
 */
const LOUD_DELIVERY =
  /\b(shout\w*|yell\w*|scream\w*|excit\w*|energetic|hype\w*|angry|furious|rage|dramatic|crying|sob\w*|laugh\w*|giggl\w*|loud\w*|frantic|urgent|intense)\b/i;

/** Calm-voice check for per-line deliveries (scripts and storyboards). */
export function validateCalmDelivery(deliveries: readonly string[]): string[] {
  const loud = deliveries.filter((d) => LOUD_DELIVERY.test(d)).map((d) => `"${d}"`);
  return loud.length
    ? [`deliveries must stay calm, low and reassuring (no dramatic or loud directions): ${loud.join(', ')}`]
    : [];
}

/**
 * Lines of the owner's reference reel (docs/creative-sources/reference-reel-analysis.md). We copy its
 * format and feeling only; a script that reuses any of these lines is rejected.
 */
export const REFERENCE_REEL_LINES = [
  'stop apologizing for outgrowing people',
  "it's not rejection it's selection",
  "you didn't abandon them",
  'you simply graduated from who you were',
  "it's not loss it's direction",
  'some people were mirrors of your past',
  "you're building something entirely new",
  "a tree doesn't apologize for the branches it sheds",
  "they're just not the future",
  "that's not heartless that's evolution",
  "that's you becoming extraordinary",
] as const;

const PALETTE_HINTS: Record<(typeof PALETTE_MOODS)[number], string> = {
  contemplative: 'faded blue hour: slate and dusty teal with a warm amber glow',
  intimate: 'warm golden hour: honey, amber and cream against muted teal shadows',
  peaceful: 'soft dawn: misty sage, pale teal and warm cream',
  night: 'amber-lit night: deep navy and slate with warm lamp and city-light gold',
};

const str = (description: string) => ({ type: 'string', description }) as const;
const int = (description: string) => ({ type: 'integer', description }) as const;

export const SCRIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: str('Punchy title in the brand language, 3-7 words.'),
    idea: {
      type: 'object',
      properties: {
        coreMessage: str(
          'In English: the reframe in one sentence ("[thing you feel guilty about] is actually [honest positive reframe]").',
        ),
        identitySignal: str('In English: what sharing this says about the viewer.'),
        permissionGiven: str('In English: which guilt this removes.'),
        emotionalArc: {
          type: 'object',
          properties: {
            start: str('Starting emotion.'),
            mid: str('Mid emotion.'),
            peak: str('Peak emotion.'),
            landing: str('Landing emotion.'),
          },
          required: ['start', 'mid', 'peak', 'landing'],
          additionalProperties: false,
        },
        targetAudience: str('In English: who feels this most deeply.'),
        shareTrigger: str('In English: why someone would send this to a friend.'),
        parallelPattern: {
          type: 'string',
          enum: [...PARALLEL_PATTERNS],
          description: 'Pattern used in the message lines.',
        },
        quotes: {
          type: 'object',
          properties: {
            strongest: str('Exact narration line: the strongest standalone quote.'),
            screenshot: str('Exact narration line: the screenshot-ready line (usually the metaphor).'),
            share: str('Exact narration line: the share-trigger line (usually the conclusion).'),
          },
          required: ['strongest', 'screenshot', 'share'],
          additionalProperties: false,
        },
        loopLink: str('In English: how the last line connects back to the first so the video loops.'),
        hookScore: int('Honest 1-10 score of the hook.'),
        quotabilityScore: int('Honest 1-10 score: how likely the key line is to be screenshotted.'),
      },
      required: [
        'coreMessage',
        'identitySignal',
        'permissionGiven',
        'emotionalArc',
        'targetAudience',
        'shareTrigger',
        'parallelPattern',
        'quotes',
        'loopLink',
        'hookScore',
        'quotabilityScore',
      ],
      additionalProperties: false,
    },
    deliveryStyle: {
      type: 'string',
      enum: [...DELIVERY_STYLES],
      description: 'Overall narrator delivery.',
    },
    characterDescription: str(
      'In English: one precise visual description of the recurring original character(s) - age, build, hair, clothing colours - reused in every scene for consistency, or "none".',
    ),
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beat: { type: 'string', enum: [...STORY_BEATS], description: 'Story beat of this line.' },
          narration: str('One spoken line in the brand language.'),
          delivery: str(
            'In English, 1-5 words: how the narrator voices this line, e.g. "calm, low" or "quiet, certain".',
          ),
          visual: str(
            'In English: what the illustration shows - composition, scale, light and the visual metaphor. No text, letters, logos or captions in the image.',
          ),
          shot: { type: 'string', enum: [...SHOT_TYPES], description: 'Shot type of the image.' },
          palette: { type: 'string', enum: [...PALETTE_MOODS], description: 'Colour mood of the image.' },
          camera: {
            type: 'string',
            enum: [...MOTIONS],
            description: 'Restrained camera move: zoom-in = slow push-in.',
          },
          sfx: {
            type: 'string',
            enum: [...SFX_CHOICES],
            description: 'One-shot sound effect at the start of this line, usually "none".',
          },
        },
        required: ['beat', 'narration', 'delivery', 'visual', 'shot', 'palette', 'camera', 'sfx'],
        additionalProperties: false,
      },
    },
    soundDesign: {
      type: 'object',
      properties: {
        music: {
          type: 'string',
          enum: [...MUSIC_CHOICES],
          description: 'Music mood following the emotional arc, or "none".',
        },
        ambience: {
          type: 'string',
          enum: [...AMBIENCE_CHOICES],
          description: 'Background ambience only when the setting has it, else "none".',
        },
      },
      required: ['music', 'ambience'],
      additionalProperties: false,
    },
    metadata: {
      type: 'object',
      properties: {
        youtubeTitle: str('YouTube title in the brand language, max 100 characters.'),
        shortDescription: str('1-2 sentence description in the brand language.'),
        captions: {
          type: 'object',
          properties: {
            instagram: str('Instagram caption without hashtags.'),
            facebook: str('Facebook caption without hashtags.'),
            youtube: str('YouTube Shorts caption without hashtags.'),
            x: str('X post text without hashtags, max 200 characters.'),
          },
          required: ['instagram', 'facebook', 'youtube', 'x'],
          additionalProperties: false,
        },
        hashtags: { type: 'array', items: str('One hashtag starting with #, no spaces.') },
        keywords: { type: 'array', items: str('One search keyword or phrase.') },
      },
      required: ['youtubeTitle', 'shortDescription', 'captions', 'hashtags', 'keywords'],
      additionalProperties: false,
    },
    safetyNotes: str(
      'In English: any factual or psychological claims and how they are supported, or "none".',
    ),
  },
  required: [
    'title',
    'idea',
    'deliveryStyle',
    'characterDescription',
    'scenes',
    'soundDesign',
    'metadata',
    'safetyNotes',
  ],
  additionalProperties: false,
} as const;

const outputSchema = z.object({
  title: z.string().min(1).max(120),
  idea: z.object({
    coreMessage: z.string().min(10).max(400),
    identitySignal: z.string().min(3),
    permissionGiven: z.string().min(3),
    emotionalArc: z.object({ start: z.string(), mid: z.string(), peak: z.string(), landing: z.string() }),
    targetAudience: z.string().min(3),
    shareTrigger: z.string().min(3),
    parallelPattern: z.enum(PARALLEL_PATTERNS),
    quotes: z.object({ strongest: z.string(), screenshot: z.string(), share: z.string() }),
    loopLink: z.string(),
    hookScore: z.number().int().min(1).max(10),
    quotabilityScore: z.number().int().min(1).max(10),
  }),
  deliveryStyle: z.enum(DELIVERY_STYLES),
  characterDescription: z.string().min(4).max(600),
  scenes: z
    .array(
      z.object({
        beat: z.enum(STORY_BEATS),
        narration: z.string().min(1).max(300),
        delivery: z.string().max(60),
        visual: z.string().min(5).max(800),
        shot: z.enum(SHOT_TYPES),
        palette: z.enum(PALETTE_MOODS),
        camera: z.enum(MOTIONS),
        sfx: z.enum(SFX_CHOICES),
      }),
    )
    .min(3)
    .max(8),
  soundDesign: z.object({ music: z.enum(MUSIC_CHOICES), ambience: z.enum(AMBIENCE_CHOICES) }),
  metadata: z.object({
    youtubeTitle: z.string().min(1),
    shortDescription: z.string().min(1).max(500),
    captions: z.object({
      instagram: z.string().min(1),
      facebook: z.string().min(1),
      youtube: z.string().min(1),
      x: z.string().min(1),
    }),
    hashtags: z.array(z.string()),
    keywords: z.array(z.string().min(1).max(80)),
  }),
  safetyNotes: z.string(),
});

export type ScriptOutput = z.infer<typeof outputSchema>;
export type ScriptIdea = ScriptOutput['idea'];

export interface GeneratedScript {
  script: VideoScript;
  /** The viral-mechanics idea behind the video (core message, triggers, emotional arc, quotes). */
  idea: ScriptIdea;
  /** The one core message (used for duplicate detection and analytics). */
  centralIdea: string;
  deliveryStyle: DeliveryStyle;
  characterDescription: string;
  soundDesign: SoundDesignBrief;
  metadata: VideoMetadata;
  safetyNotes: string;
  model: string;
  usage: { input: number; cachedInput: number; output: number };
  costUsd: number;
  estimatedDurationSec: number;
}

function durationTarget(brand: BrandConfig) {
  return brand.durationTarget ?? DEFAULT_DURATION;
}

/** How to find a viral idea (owner's framework, docs/creative-sources/viral-framework-v2.md). */
export const IDEA_STEP = [
  'STEP 1 - THE IDEA (fill "idea"). Silently consider several ideas and keep only one that would score 9/10+ on viral mechanics:',
  '- coreMessage: the honest reframe in one sentence. Formula: "[thing the viewer feels guilty about] is actually [positive reframe]" - e.g. quitting is self-awareness, being alone is selectiveness, slowing down is strategy, saying no is self-respect.',
  '- identitySignal (sharing it says "I am deep / ambitious / emotionally intelligent"), permissionGiven (the guilt it removes), emotionalArc start → mid → peak → landing (tension or pain → relief, pride or quiet confidence), targetAudience, shareTrigger.',
  '- Reject ideas that are clichés, need context, are forced or dishonest, could read as toxic positivity, or would embarrass someone to share.',
] as const;

/** How to describe each image like a film director (also used by the shared storyboard). */
export const VISUAL_RECIPE =
  '- Write every "visual" like a film director, in this order: framing (from behind, three-quarter profile, soft close portrait, or wide with a tiny figure) → subject with a specific, understated expression or gesture → setting and time of day → the soft light source and the warm amber versus muted teal contrast → one gentle motion (wind in hair or coat, drifting leaves or petals, slow clouds, soft rain, distant city lights) → one symbolic detail. Use at least 3 different settings or times of day across the video.';

export const HOOK_IMAGE_RULE =
  '- The hook image is the thumbnail of the video and must stop the scroll on its own - quietly: one clear focal point with a strong emotional read, such as a lone figure small against a huge soft sky, a tender close portrait in warm window light with light catching the eyes, or a simple poetic visual metaphor; calm, premium and beautiful rather than loud.';

/** Music instruction: only moods that have approved licensed tracks may be chosen. */
export function musicMoodLine(available?: readonly MusicMood[]): string {
  if (!available) {
    return '- Choose one music mood that follows the emotional arc (e.g. soft piano for pain → hope), or "none" when voice and silence are stronger. Ambience only when the setting truly has it.';
  }
  if (available.length === 0) {
    return '- No licensed music is available yet: set music to "none". Ambience only when the setting truly has it.';
  }
  return `- Licensed music is available only for these moods: ${available.join(', ')}. Choose one of them if it fits the emotional arc, otherwise "none". Ambience only when the setting truly has it.`;
}

/** Storyboard brief for one brand: meaning and images only, so the script is written natively. */
function storyboardBrief(sb: Storyboard, language: Language): string[] {
  return [
    `SHARED STORYBOARD - the same topic and images are used by this network's channels in other languages. Write THIS brand's narration from scratch in ${LANGUAGE_NAMES[language]}: your own words, idioms, rhythm and parallel structure. Never translate or adapt wording from any other language - the intents below are meaning only.`,
    `Topic: ${sb.title}. Core message: ${sb.idea.coreMessage}`,
    `Identity signal: ${sb.idea.identitySignal}. Permission: ${sb.idea.permissionGiven}. Emotional arc: ${sb.idea.emotionalArc.start} → ${sb.idea.emotionalArc.mid} → ${sb.idea.emotionalArc.peak} → ${sb.idea.emotionalArc.landing}. Loop: ${sb.idea.loopLink}`,
    `Write exactly ${sb.lines.length} lines, in this order, one per image:`,
    ...sb.lines.map(
      (l, i) =>
        `${i + 1}. beat "${l.beat}" - intent: ${l.intent} | delivery hint: ${l.delivery} | visual: ${l.visual} | shot: ${l.shot} | palette: ${l.palette} | camera: ${l.camera} | sfx: ${l.sfx}`,
    ),
    `Character description (copy exactly): ${sb.characterDescription}`,
    `soundDesign (copy exactly): music ${sb.soundDesign.music}, ambience ${sb.soundDesign.ambience}`,
  ];
}

/** [BEAT] after the hook and the last message line, [PAUSE] after the metaphor. */
export function pausesFor(beats: readonly StoryBeat[]): Pause[] {
  return beats.map((b, i) => {
    if (b === 'hook') return 'beat';
    if (b === 'message' && beats[i + 1] !== 'message') return 'beat';
    if (b === 'metaphor') return 'pause';
    return 'none';
  });
}

/** Rough word budget for the whole script, leaving room for padding and the scripted pauses. */
function wordBudget(brand: BrandConfig): { min: number; max: number } {
  const d = durationTarget(brand);
  const gaps = 6 * SCENE_PADDING_SEC + PAUSE_SECONDS.beat * 2 + PAUSE_SECONDS.pause;
  const wps = WORDS_PER_SECOND[brand.language] * (brand.voice.settings?.speed ?? 1);
  return {
    min: Math.max(10, Math.round((d.minSec - gaps) * wps)),
    max: Math.round((d.maxSec - gaps) * wps),
  };
}

export function buildScriptPrompt(req: ScriptRequest): { system: string; user: string } {
  const { brand } = req;
  const slot = brand.contentSlots.find((s) => s.category === req.contentCategory);
  if (!slot) throw new Error(`${brand.id} has no content slot "${req.contentCategory}"`);
  const kids = brand.niche === 'kids';
  const viral = brand.niche === 'self_improvement';
  const d = durationTarget(brand);
  const words = wordBudget(brand);
  const v = brand.visualIdentity;
  const lines: (string | null)[] = [
    viral
      ? `You are a world-class viral short-form scriptwriter and content strategist for the self-improvement brand "${brand.displayName}". You write deeply emotional, quotable vertical videos that make viewers feel seen - never generic AI content.`
      : `You are the creative director and scriptwriter for the brand "${brand.displayName}". You write original, emotionally intentional short vertical videos - never generic AI content.`,
    `Audience: ${brand.audience}.${kids && brand.ageRange ? ` Target age: ${brand.ageRange.min}-${brand.ageRange.max} years.` : ''}`,
    brand.tone ? `Brand tone: ${brand.tone}.` : null,
    `Narration language: ${LANGUAGE_NAMES[brand.language]}. Write it natively for this audience - never translate from another language.`,
    'Rules you must follow:',
    ...brand.contentRules.map((r) => `- ${r}`),
    '',
  ];
  if (viral) {
    lines.push(
      ...(req.storyboard
        ? [
            'STEP 1 - THE IDEA is given by the shared storyboard (in the user message). Restate it in "idea" (English), adapting targetAudience to this brand; quotes and scores come from YOUR narration.',
          ]
        : IDEA_STEP),
      '',
      'STEP 2 - THE SCRIPT: one scene per spoken line, labelled with its "beat", in this order:',
      '1. "hook" - exactly 1 line, 3-9 words, under 3 seconds, a declarative statement (never a question) that stops the scroll and works as on-screen text without audio: a pattern interrupt ("Stop apologizing for having standards."), a provocative claim, a direct address ("You\'re not lazy. You\'re exhausted from pretending.") or a counter-narrative.',
      '2. "message" - 2-4 lines (20-45 words together; 3-4 lines is the sweet spot) built on ONE parallel structure, named in idea.parallelPattern: A_repetitive_opener ("It\'s not about X. It\'s about Y."), B_contrasting_pairs ("Some people X. Strong people Y."), C_escalating_list ("First... Then... Finally..."), D_negation_affirmation ("You don\'t need X. You need Y." / "It was never about X. It was always about Y."). A message line may be a short reframe pair of two sentences ("It\'s not X. It\'s Y.") that shares one image. Every line independently quotable and stronger than the last; concrete, sensory words.',
      '3. "metaphor" - exactly 1 line, 8-15 words: a fresh, VISUAL image (nature, a physical object, a journey, a transformation) that anchors the message - the most screenshot-worthy line, the one people put in their bio.',
      '4. "conclusion" - exactly 1 line, 5-12 words: the mic drop (call to identity, empowerment close, permission stamp or challenge close). It resolves the emotion opened by the hook AND loops back to it, so the video feels like it restarts (explain the link in idea.loopLink).',
      `- Word counts are for English; in Hindi or Telugu keep the same timing per part. Whole script: ${d.minSec}-${d.maxSec} seconds when spoken (sweet spot ${d.idealMinSec}-${d.idealMaxSec} s), about ${words.min}-${words.max} words. The app adds a ${PAUSE_SECONDS.beat} s beat after the hook and after the last message line and a ${PAUSE_SECONDS.pause} s pause after the metaphor - never write [BEAT] or [PAUSE] in the narration.`,
      '- EMOTION: the narrator is a deep, calm, unhurried voice - a wise friend speaking softly, with long breaths between lines; never dramatic, excited, loud or performed. Write for that voice, with deep feeling. Use ellipses (...) for weight where a breath belongs. For every line give "delivery": a short English direction for HOW the narrator voices it (e.g. "calm, low", "soft, reassuring", "slow, gentle", "almost a whisper", "quiet, certain", "warm, steady"). Describe the voice only - never a sound effect. Deliveries follow the emotional arc from start to landing, always within that calm range.',
      '- idea.quotes must repeat lines exactly as written in the narration (strongest quote, screenshot line, share line). Give honest hookScore and quotabilityScore; only 8 or more is acceptable - rewrite until it is.',
      '- No questions in the hook. No hashtags, emojis or ALL-CAPS words in the narration.',
    );
  } else {
    lines.push(
      'Story:',
      '- Label the first scene "hook", the last scene "payoff" and the scenes between them "story".',
      `- Total narration must fit ${d.minSec}-${d.maxSec} seconds when read aloud (ideally ${d.idealMinSec}-${d.idealMaxSec} s): 3-7 scenes of 6-18 words. Let the story decide the number of scenes; no filler.`,
      '- Write for the ear: naturally spoken, short memorable lines, strong rhythm. No hashtags or emojis in the narration.',
      '- For every scene give "delivery": a short English direction for how the narrator voices it (e.g. "warm, playful").',
      '- Fill "idea" briefly in English (coreMessage, emotional arc, quotes from the narration); scores are informational.',
    );
  }
  lines.push(
    kids
      ? '- Never ask viewers to like, subscribe, share, comment or follow. No personal questions. Nothing scary or unsafe.'
      : '- Do not ask viewers to like, follow, subscribe, comment or share.',
    '',
    ...(req.storyboard
      ? [
          'Visuals: the images are already fixed by the shared storyboard (one image per line). Copy each line\'s "visual", "shot", "palette" and "camera" exactly as given - do not invent new images.',
        ]
      : [
          `Visuals - ${viral ? 'one image per line' : 'one image per scene'} (describe each in English in "visual"):`,
          `- Style: ${v.style}. Characters: ${v.characterNotes}.`,
          v.mood?.length ? `- Mood: ${v.mood.join(', ')}.` : null,
          v.environments?.length
            ? `- Brand settings, used naturally when they serve the line (not in every scene): ${v.environments.join('; ')}.`
            : null,
          v.lighting ? `- Light: ${v.lighting}` : null,
          `- "shot" per line: ${SHOT_TYPES.map((s) => `${s} (${SHOT_DESCRIPTIONS[s]})`).join('; ')}.${viral ? ' Use at least 3 different shot types, never the same shot twice in a row, at most 2 close_up_portrait, and at least one wide shot (vast_landscape or night_urban); the metaphor is usually symbolic_object or vast_landscape.' : ' Use at least 3 different shot types.'}`,
          `- "palette" per line: ${PALETTE_MOODS.map((p) => `${p} (${PALETTE_HINTS[p]})`).join('; ')}. Let the palette follow the emotional arc and progress cohesively.`,
          viral ? VISUAL_RECIPE : null,
          kids
            ? '- Scene 1 is a bright, curious opening frame that instantly delights a young child.'
            : HOOK_IMAGE_RULE,
          '- Every image advances the feeling with a different composition; interpret the line through creative visual metaphor instead of illustrating it literally. Keep the same characters consistent.',
          `- Avoid: ${v.avoid.join('; ')}.`,
          viral
            ? '- Pick a restrained camera move per line (zoom-in = slow push-in, zoom-out, pan-left, pan-right): mostly slow push-ins, with an occasional gentle pan or pull-back for variety.'
            : '- Pick a restrained camera move per line (zoom-in = slow push-in, zoom-out, pan-left, pan-right) and vary them.',
        ]),
    '',
    'Sound:',
    req.storyboard
      ? '- Use the storyboard\'s soundDesign and per-line "sfx" exactly.'
      : musicMoodLine(req.availableMusicMoods),
    '- Sound effects are rare and purposeful: most lines use "none", at most 2 per video. Never on every line.',
    '- Pick the overall narrator deliveryStyle.',
    '',
    'Metadata (in the brand language, written fresh for this video and never reused across brands):',
    `- youtubeTitle (max ${PLATFORM_TEXT_LIMITS.youtubeTitleChars} characters), a 1-2 sentence shortDescription, and a separate natural caption per platform: instagram and facebook 1-3 short lines (lead with the screenshot line), youtube one short line, x at most 200 characters.`,
    `- ${HASHTAGS.min}-${HASHTAGS.max} relevant hashtags (no stuffing, no hashtags inside captions) and ${KEYWORDS.min}-${KEYWORDS.max} search keywords.`,
    '- Metadata must match the actual content: no misleading claims, no fake engagement requests, no spam.',
  );
  const system = lines.filter((line): line is string => line !== null).join('\n');
  const user = [
    `Content slot: ${slot.label} - ${slot.description}`,
    ...(req.storyboard
      ? storyboardBrief(req.storyboard, brand.language)
      : [
          req.topic
            ? `Topic: ${req.topic}`
            : `Pick one specific, fresh angle from these brand topics: ${brand.topics.join(', ')}.`,
        ]),
    req.avoidTitles?.length
      ? `Do not reuse these existing titles or their angles: ${req.avoidTitles.join(' | ')}`
      : '',
    req.feedback?.length
      ? `Your previous draft was rejected for: ${req.feedback.join('; ')}. Write a new version that fixes every point (for length: fewer, shorter words per line - keep the beats).`
      : '',
    'Return the idea and script as JSON matching the schema.',
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

function nativeShare(text: string, language: Language): number {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '').length;
  if (letters === 0) return 1;
  return (text.match(SCRIPT_CHARS[language]) ?? []).length / letters;
}

/** X weighting (twitter-text v3): code points up to U+10FF and common punctuation count 1, everything else 2. */
export function xWeightedLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const light =
      cp <= 0x10ff ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** Lowercase, letters/marks/digits only - for checking that quotes really appear in the narration. */
const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

/** Hook → message (2-4) → metaphor → conclusion, in that order. */
export function validateArc(beats: readonly StoryBeat[]): string[] {
  const problems: string[] = [];
  const count = (b: StoryBeat) => beats.filter((x) => x === b).length;
  if (beats.some((b) => !ARC.includes(b))) {
    problems.push('self-improvement lines must use the beats hook, message, metaphor and conclusion');
  }
  if (beats[0] !== 'hook' || count('hook') !== 1) problems.push('the first line must be the only hook');
  if (count('message') < 2 || count('message') > 4)
    problems.push(`needs 2-4 message lines (got ${count('message')})`);
  if (count('metaphor') !== 1) problems.push('needs exactly one metaphor line');
  if (beats.at(-1) !== 'conclusion' || count('conclusion') !== 1) {
    problems.push('the last line must be the only conclusion');
  }
  if (beats.some((b, i) => i > 0 && ARC.indexOf(b) < ARC.indexOf(beats[i - 1]!))) {
    problems.push('beats are out of order (hook → message → metaphor → conclusion)');
  }
  return problems;
}

function validateViral(brand: BrandConfig, out: ScriptOutput): string[] {
  const problems = validateArc(out.scenes.map((s) => s.beat));
  const hook = out.scenes[0]!;
  if (/[?？]/.test(hook.narration)) problems.push('the hook must be a statement, not a question');
  const hookSec = estimateSpeechSeconds(hook.narration, brand.language);
  if (hookSec > HOOK_MAX_SEC)
    problems.push(`the hook takes ~${hookSec.toFixed(1)} s (max ${HOOK_MAX_SEC} s)`);
  const { hookScore, quotabilityScore, quotes } = out.idea;
  if (hookScore < MIN_SCORE) problems.push(`hook score ${hookScore}/10 is below ${MIN_SCORE}`);
  if (quotabilityScore < MIN_SCORE)
    problems.push(`quotability score ${quotabilityScore}/10 is below ${MIN_SCORE}`);
  const narration = normalise(out.scenes.map((s) => s.narration).join(' '));
  for (const [name, quote] of Object.entries(quotes)) {
    if (!normalise(quote) || !narration.includes(normalise(quote))) {
      problems.push(`idea.quotes.${name} is not a line from the narration`);
    }
  }
  if (out.scenes.some((s) => /\b[A-Z]{3,}\b/.test(s.narration))) {
    problems.push('no ALL-CAPS words in the narration (captions would shout)');
  }
  problems.push(...validateCalmDelivery(out.scenes.map((s) => s.delivery)));
  const reused = REFERENCE_REEL_LINES.find((line) => narration.includes(normalise(line)));
  if (reused)
    problems.push(`narration reuses a line from the reference reel ("${reused}") - write original lines`);
  return [...problems, ...validateShots(out.scenes.map((s) => s.shot))];
}

/** Visual variety rules for one image per line (shared by scripts and storyboards). */
export function validateShots(shots: readonly ShotType[]): string[] {
  const problems: string[] = [];
  if (shots.length >= 5 && new Set(shots).size < 3) problems.push('use at least 3 different shot types');
  if (shots.filter((s) => s === 'close_up_portrait').length > 2)
    problems.push('use at most 2 close-up portraits');
  if (shots.some((s, i) => i > 0 && s === shots[i - 1]))
    problems.push('never repeat a shot type in consecutive lines');
  if (!shots.some((s) => s === 'vast_landscape' || s === 'night_urban')) {
    problems.push('include at least one wide shot (vast_landscape or night_urban)');
  }
  return problems;
}

function validateMetadata(brand: BrandConfig, m: ScriptOutput['metadata']): string[] {
  const problems: string[] = [];
  const L = PLATFORM_TEXT_LIMITS;
  const tags = m.hashtags.join(' ');
  if (m.youtubeTitle.length > L.youtubeTitleChars) {
    problems.push(`YouTube title is ${m.youtubeTitle.length} characters (max ${L.youtubeTitleChars})`);
  }
  if (Buffer.byteLength(`${m.shortDescription}\n\n${tags}`, 'utf8') > L.youtubeDescriptionBytes) {
    problems.push('YouTube description exceeds 5,000 bytes');
  }
  if (`${m.captions.instagram}\n\n${tags}`.length > L.instagramCaptionChars) {
    problems.push('Instagram caption exceeds 2,200 characters');
  }
  const xLen = xWeightedLength(`${m.captions.x} ${tags}`);
  if (xLen > L.xPostWeighted) problems.push(`X post is ${xLen} weighted characters (max ${L.xPostWeighted})`);

  if (m.hashtags.length < HASHTAGS.min || m.hashtags.length > HASHTAGS.max) {
    problems.push(`needs ${HASHTAGS.min}-${HASHTAGS.max} hashtags (got ${m.hashtags.length})`);
  }
  const badTags = m.hashtags.filter((t) => !HASHTAG.test(t));
  if (badTags.length) problems.push(`invalid hashtags: ${badTags.join(' ')}`);
  if (new Set(m.hashtags.map((t) => t.toLowerCase())).size !== m.hashtags.length) {
    problems.push('duplicate hashtags');
  }
  if (m.keywords.length < KEYWORDS.min || m.keywords.length > KEYWORDS.max) {
    problems.push(`needs ${KEYWORDS.min}-${KEYWORDS.max} keywords (got ${m.keywords.length})`);
  }

  const captions = Object.values(m.captions);
  if (captions.some((c) => /(^|\s)#[\p{L}\p{N}_]/u.test(c))) {
    problems.push('captions must not contain hashtags');
  }
  const text = [m.youtubeTitle, m.shortDescription, ...captions].join('\n');
  if (nativeShare(text, brand.language) < 0.6) {
    problems.push(`metadata is not mainly in ${LANGUAGE_NAMES[brand.language]}`);
  }
  if (ENGAGEMENT_BAIT.test(text) || (brand.niche === 'kids' && KIDS_CTA.test(text))) {
    problems.push('metadata contains an engagement request / call to action');
  }
  if (FALSE_PROMISES.test(text))
    problems.push('metadata contains a guaranteed-outcome / cure / get-rich claim');
  return problems;
}

/** Estimated length including padding and the scripted pauses (slower brand voices take longer). */
export function estimateScriptSeconds(
  brand: BrandConfig,
  scenes: readonly { beat: StoryBeat; narration: string }[],
) {
  const pauses = brand.niche === 'self_improvement' ? pausesFor(scenes.map((s) => s.beat)) : [];
  const pace = brand.voice.settings?.speed ?? 1;
  return scenes.reduce(
    (sum, s, i) =>
      sum +
      sceneDuration(
        estimateSpeechSeconds(s.narration, brand.language) / pace,
        PAUSE_SECONDS[pauses[i] ?? 'none'],
      ),
    0,
  );
}

/** Deterministic checks on a generated script (language, length, structure, safety, metadata). */
export function validateScript(
  brand: BrandConfig,
  out: ScriptOutput,
): { problems: string[]; seconds: number } {
  const problems: string[] = [];
  const narration = out.scenes.map((s) => s.narration).join(' ');
  const share = nativeShare(narration, brand.language);
  if (share < MIN_NATIVE_SHARE[brand.language]) {
    problems.push(
      `narration is not mainly in ${LANGUAGE_NAMES[brand.language]} (${Math.round(100 * share)}%)`,
    );
  }
  const seconds = estimateScriptSeconds(brand, out.scenes);
  const d = durationTarget(brand);
  if (seconds < d.minSec || seconds > d.maxSec) {
    problems.push(`estimated duration ${seconds.toFixed(1)} s is outside ${d.minSec}-${d.maxSec} s`);
  }
  if (brand.niche === 'kids' && KIDS_CTA.test(narration)) {
    problems.push('kids content contains a call to action');
  } else if (ENGAGEMENT_BAIT.test(narration)) {
    problems.push('narration asks viewers to like, follow, share, comment or subscribe');
  }
  if (FALSE_PROMISES.test(narration)) {
    problems.push('narration contains a guaranteed-outcome / cure / get-rich claim');
  }
  const badDelivery = out.scenes
    .filter((s) => !DELIVERY.test(s.delivery.trim()))
    .map((s) => `"${s.delivery}"`);
  if (badDelivery.length)
    problems.push(`delivery must be a short English voice direction: ${badDelivery.join(', ')}`);
  if (brand.niche === 'self_improvement') {
    const cliche = CLICHES.exec(narration);
    if (cliche) problems.push(`narration uses the cliché "${cliche[0]}"`);
    problems.push(...validateViral(brand, out));
  }
  problems.push(...validateMetadata(brand, out.metadata));
  return { problems, seconds };
}

/**
 * Locks a brand's script to the shared storyboard: same line count and beats, and the storyboard's
 * images, shots, palettes, camera moves, effects, character and sound - only the narration is the brand's.
 */
export function applyStoryboard(
  sb: Storyboard,
  out: ScriptOutput,
): { out: ScriptOutput; problems: string[] } {
  const problems: string[] = [];
  if (out.scenes.length !== sb.lines.length) {
    problems.push(`storyboard has ${sb.lines.length} lines but the script has ${out.scenes.length}`);
    return { out, problems };
  }
  const wrong = out.scenes.findIndex((s, i) => s.beat !== sb.lines[i]!.beat);
  if (wrong >= 0) problems.push(`line ${wrong + 1} must be the storyboard's "${sb.lines[wrong]!.beat}" beat`);
  return {
    problems,
    out: {
      ...out,
      characterDescription: sb.characterDescription,
      soundDesign: sb.soundDesign,
      scenes: out.scenes.map((s, i) => {
        const l = sb.lines[i]!;
        return { ...s, visual: l.visual, shot: l.shot, palette: l.palette, camera: l.camera, sfx: l.sfx };
      }),
    },
  };
}

interface ResponsesApiResult {
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  status?: string;
  incomplete_details?: { reason?: string } | null;
}

export interface StructuredResult {
  json: unknown;
  usage: { input: number; cachedInput: number; output: number };
  costUsd: number;
}

/** One Responses API call with a strict JSON schema; records cost on the budget; validation errors are typed. */
export async function callStructured(
  client: OpenAiClient,
  call: { system: string; user: string; schema: object; name: string; label: string },
  opts: { model: string; budget: Budget; signal?: AbortSignal },
): Promise<StructuredResult> {
  opts.budget.reserve(0.1, call.label);
  const res = await client.post<ResponsesApiResult>(
    '/responses',
    {
      model: opts.model,
      store: false,
      input: [
        { role: 'system', content: call.system },
        { role: 'user', content: call.user },
      ],
      text: { format: { type: 'json_schema', name: call.name, schema: call.schema, strict: true } },
    },
    opts.signal,
  );
  const usage = {
    input: res.usage?.input_tokens ?? 0,
    cachedInput: res.usage?.input_tokens_details?.cached_tokens ?? 0,
    output: res.usage?.output_tokens ?? 0,
  };
  const costUsd = textCostUsd(opts.model, usage);
  opts.budget.record('script', opts.model, costUsd);

  const content = res.output?.find((o) => o.type === 'message')?.content ?? [];
  const refusal = content.find((c) => c.type === 'refusal');
  if (refusal) throw new ScriptValidationError([`model refused: ${refusal.refusal ?? 'no reason given'}`]);
  const text = content.find((c) => c.type === 'output_text')?.text;
  if (!text) {
    throw new ScriptValidationError([
      `no ${call.label} returned (status ${res.status ?? '?'} ${res.incomplete_details?.reason ?? ''})`,
    ]);
  }
  try {
    return { json: JSON.parse(text), usage, costUsd };
  } catch {
    throw new ScriptValidationError(['model output was not valid JSON']);
  }
}

export async function generateScript(
  client: OpenAiClient,
  req: ScriptRequest,
  opts: { model: string; budget: Budget; signal?: AbortSignal },
): Promise<GeneratedScript> {
  const { brand } = req;
  if (brand.validation.scriptureCheck) {
    // Spec section 12: unverifiable scripture claims must be rejected. Until the scripture validator
    // exists (Phase 4), devotional/spiritual brands are not generated automatically.
    throw new ScriptValidationError([
      `${brand.displayName} requires scripture verification, which is not implemented yet (Phase 4).`,
    ]);
  }
  const { system, user } = buildScriptPrompt(req);
  const { json, usage, costUsd } = await callStructured(
    client,
    { system, user, schema: SCRIPT_JSON_SCHEMA, name: 'video_script', label: 'script generation' },
    opts,
  );
  const parsed = outputSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScriptValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const sb = req.storyboard;
  const data = sb ? applyStoryboard(sb, parsed.data) : { out: parsed.data, problems: [] };
  const { problems, seconds } = validateScript(brand, data.out);
  problems.unshift(...data.problems);
  if (problems.length) throw new ScriptValidationError(problems);

  const out = data.out;
  const pauses = brand.niche === 'self_improvement' ? pausesFor(out.scenes.map((s) => s.beat)) : [];
  return {
    script: {
      brandId: brand.id,
      title: out.title,
      contentCategory: req.contentCategory,
      language: brand.language,
      scenes: out.scenes.map((s, i) => ({ ...s, delivery: s.delivery.trim(), pause: pauses[i] ?? 'none' })),
    },
    idea: out.idea,
    centralIdea: out.idea.coreMessage,
    deliveryStyle: out.deliveryStyle,
    characterDescription: out.characterDescription,
    soundDesign: out.soundDesign,
    metadata: out.metadata,
    safetyNotes: out.safetyNotes,
    model: opts.model,
    usage,
    costUsd,
    estimatedDurationSec: Math.round(seconds * 10) / 10,
  };
}
