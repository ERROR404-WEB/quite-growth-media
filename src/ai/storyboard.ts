import { z } from 'zod';
import type { BrandConfig } from '../brands/index.js';
import { UNIVERSAL_VISUAL_IDENTITY } from '../brands/shared.js';
import type { MusicMood } from '../domain/constants.js';
import {
  AMBIENCE_CATEGORIES,
  MUSIC_MOODS,
  ONE_SHOT_SFX,
  PALETTE_MOODS,
  PARALLEL_PATTERNS,
  SHOT_TYPES,
  STORY_BEATS,
} from '../domain/constants.js';
import { MOTIONS } from '../media/render.js';
import type { OpenAiClient } from './openai-client.js';
import type { Budget } from './pricing.js';
import type { Storyboard } from './script-writer.js';
import {
  callStructured,
  HOOK_IMAGE_RULE,
  IDEA_STEP,
  musicMoodLine,
  ScriptValidationError,
  SHOT_DESCRIPTIONS,
  validateArc,
  validateCalmDelivery,
  validateShots,
  VISUAL_RECIPE,
} from './script-writer.js';

/**
 * Shared storyboard: ONE topic and ONE image set for the self-improvement brands. It carries meaning
 * and images only - never wording - so each brand then writes its own native script (no translation).
 */
export interface StoryboardRequest {
  /** Brands that will use the storyboard (all self-improvement). */
  brands: readonly BrandConfig[];
  contentCategory: string;
  topic?: string;
  availableMusicMoods?: readonly MusicMood[];
}

const str = (description: string) => ({ type: 'string', description }) as const;
const DELIVERY = /^[a-z][a-z ,'-]{1,38}[a-z]$/i;

export const STORYBOARD_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: str('In English: the topic, 3-7 words.'),
    idea: {
      type: 'object',
      properties: {
        coreMessage: str('In English: the honest reframe in one sentence.'),
        identitySignal: str('In English: what sharing this says about the viewer.'),
        permissionGiven: str('In English: which guilt this removes.'),
        emotionalArc: {
          type: 'object',
          properties: {
            start: str('Start.'),
            mid: str('Mid.'),
            peak: str('Peak.'),
            landing: str('Landing.'),
          },
          required: ['start', 'mid', 'peak', 'landing'],
          additionalProperties: false,
        },
        targetAudience: str('In English: who feels this most deeply, in both the US and India.'),
        shareTrigger: str('In English: why someone would send this to a friend.'),
        parallelPattern: {
          type: 'string',
          enum: [...PARALLEL_PATTERNS],
          description: 'Pattern for the message lines.',
        },
        loopLink: str('In English: how the conclusion loops back to the hook.'),
      },
      required: [
        'coreMessage',
        'identitySignal',
        'permissionGiven',
        'emotionalArc',
        'targetAudience',
        'shareTrigger',
        'parallelPattern',
        'loopLink',
      ],
      additionalProperties: false,
    },
    characterDescription: str(
      'In English: the recurring original character(s), identical in every image, or "none".',
    ),
    soundDesign: {
      type: 'object',
      properties: {
        music: { type: 'string', enum: [...MUSIC_MOODS, 'none'], description: 'Music mood or "none".' },
        ambience: {
          type: 'string',
          enum: [...AMBIENCE_CATEGORIES, 'none'],
          description: 'Ambience or "none".',
        },
      },
      required: ['music', 'ambience'],
      additionalProperties: false,
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beat: { type: 'string', enum: [...STORY_BEATS], description: 'Beat of this line.' },
          intent: str(
            'In English: what this line must make the viewer understand and feel - meaning only, NOT a sentence to translate. Never put quotation marks or finished wording here.',
          ),
          delivery: str('In English, 1-5 words: how the narrator voices this line.'),
          visual: str(
            'In English: the image for this line, described like a film director. No text in the image.',
          ),
          shot: { type: 'string', enum: [...SHOT_TYPES], description: 'Shot type.' },
          palette: { type: 'string', enum: [...PALETTE_MOODS], description: 'Colour mood.' },
          camera: { type: 'string', enum: [...MOTIONS], description: 'Camera move.' },
          sfx: { type: 'string', enum: [...ONE_SHOT_SFX, 'none'], description: 'Usually "none".' },
        },
        required: ['beat', 'intent', 'delivery', 'visual', 'shot', 'palette', 'camera', 'sfx'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'idea', 'characterDescription', 'soundDesign', 'lines'],
  additionalProperties: false,
} as const;

const storyboardSchema = z.object({
  title: z.string().min(3).max(120),
  idea: z.object({
    coreMessage: z.string().min(10),
    identitySignal: z.string().min(3),
    permissionGiven: z.string().min(3),
    emotionalArc: z.object({ start: z.string(), mid: z.string(), peak: z.string(), landing: z.string() }),
    targetAudience: z.string().min(3),
    shareTrigger: z.string().min(3),
    parallelPattern: z.enum(PARALLEL_PATTERNS),
    loopLink: z.string(),
  }),
  characterDescription: z.string().min(4).max(600),
  soundDesign: z.object({
    music: z.enum([...MUSIC_MOODS, 'none']),
    ambience: z.enum([...AMBIENCE_CATEGORIES, 'none']),
  }),
  lines: z
    .array(
      z.object({
        beat: z.enum(STORY_BEATS),
        intent: z.string().min(5).max(300),
        delivery: z.string().max(60),
        visual: z.string().min(5).max(800),
        shot: z.enum(SHOT_TYPES),
        palette: z.enum(PALETTE_MOODS),
        camera: z.enum(MOTIONS),
        sfx: z.enum([...ONE_SHOT_SFX, 'none']),
      }),
    )
    .min(5)
    .max(7),
});

export function buildStoryboardPrompt(req: StoryboardRequest): { system: string; user: string } {
  const [first] = req.brands;
  if (!first) throw new Error('A storyboard needs at least one brand');
  if (req.brands.some((b) => b.niche !== 'self_improvement')) {
    throw new Error('Shared storyboards are only for the self-improvement brands');
  }
  const slot = first.contentSlots.find((s) => s.category === req.contentCategory);
  if (!slot) throw new Error(`no content slot "${req.contentCategory}"`);
  const v = UNIVERSAL_VISUAL_IDENTITY;
  const rules = [...new Set(req.brands.flatMap((b) => b.contentRules))].filter(
    (r) =>
      !/^Write (in|natural)|^Ground every line|^Natural, intimate American English|^Use cultural elements/.test(
        r,
      ),
  );
  const system = [
    `You are the creative director of a self-improvement video network with channels in ${req.brands.map((b) => `${b.displayName} (${b.language})`).join(', ')}. You plan ONE topic and ONE shared image set; each channel's writer will later write its own narration in its own language from your plan.`,
    'You write NO narration. For every line give its beat, its meaning ("intent", in English, meaning only - no finished sentences or quotes, so nothing can be translated) and its image.',
    'Rules the idea must follow:',
    ...rules.map((r) => `- ${r}`),
    '',
    ...IDEA_STEP,
    '- The idea must feel true for viewers in the US and in India alike (no country-specific situations).',
    '',
    'STEP 2 - THE LINES: 5-7 lines (6-7 is the sweet spot), one image each: exactly 1 "hook" (3-9 spoken words, a statement that stops the scroll), 2-4 "message" lines (one parallel structure, named in idea.parallelPattern; a line may be a short reframe pair such as "it is not X, it is Y" that shares one image), exactly 1 "metaphor" (a fresh visual image - the screenshot line) and exactly 1 "conclusion" (the mic drop that loops back to the hook).',
    '- "delivery": a short English voice direction per line for a deep, calm, unhurried narrator (e.g. "calm, low", "soft, reassuring", "quiet, certain", "warm, steady") following the emotional arc - never dramatic or loud.',
    '',
    'STEP 3 - THE IMAGES (shared by all channels):',
    `- Style: ${v.style}. Characters: ${v.characterNotes}.`,
    `- Settings that fit every channel (use at least 3 different ones or times of day): ${(v.environments ?? []).join('; ')}.`,
    `- Light: ${v.lighting ?? ''}`,
    `- "shot" per line: ${SHOT_TYPES.map((s) => `${s} (${SHOT_DESCRIPTIONS[s]})`).join('; ')}. At least 3 different shot types, never the same shot twice in a row, at most 2 close_up_portrait, at least one wide shot (vast_landscape or night_urban).`,
    `- "palette" per line: ${PALETTE_MOODS.join(', ')} - following the emotional arc.`,
    '- "camera" per line: mostly zoom-in (a very slow push-in), with an occasional gentle pan or zoom-out for variety.',
    VISUAL_RECIPE,
    HOOK_IMAGE_RULE,
    `- Avoid: ${v.avoid.join('; ')}.`,
    '',
    'Sound:',
    musicMoodLine(req.availableMusicMoods),
    '- Sound effects are rare: most lines "none", at most 2 per video.',
  ].join('\n');
  const user = [
    `Content slot: ${slot.label} - ${slot.description}`,
    req.topic
      ? `Topic: ${req.topic}`
      : `Pick one specific, fresh angle that fits all channels, for example from: ${[...new Set(req.brands.flatMap((b) => b.topics))].join(', ')}.`,
    'Return the storyboard as JSON matching the schema.',
  ].join('\n');
  return { system, user };
}

/** Deterministic checks: 4-step arc, visual variety, voice directions, music availability, no wording. */
export function validateStoryboard(sb: Storyboard, availableMusicMoods?: readonly MusicMood[]): string[] {
  const problems = [
    ...validateArc(sb.lines.map((l) => l.beat)),
    ...validateShots(sb.lines.map((l) => l.shot)),
  ];
  const bad = sb.lines.filter((l) => !DELIVERY.test(l.delivery.trim())).map((l) => `"${l.delivery}"`);
  if (bad.length) problems.push(`delivery must be a short English voice direction: ${bad.join(', ')}`);
  problems.push(...validateCalmDelivery(sb.lines.map((l) => l.delivery)));
  if (sb.lines.some((l) => /["“”]/.test(l.intent))) {
    problems.push('intents must describe meaning only - no quoted wording that could be translated');
  }
  if (
    availableMusicMoods &&
    sb.soundDesign.music !== 'none' &&
    !availableMusicMoods.includes(sb.soundDesign.music)
  ) {
    problems.push(
      `music mood "${sb.soundDesign.music}" has no licensed track (use ${[...availableMusicMoods, 'none'].join(' / ')})`,
    );
  }
  return problems;
}

export async function generateStoryboard(
  client: OpenAiClient,
  req: StoryboardRequest,
  opts: { model: string; budget: Budget; signal?: AbortSignal },
): Promise<{ storyboard: Storyboard; costUsd: number }> {
  const { system, user } = buildStoryboardPrompt(req);
  const { json, costUsd } = await callStructured(
    client,
    { system, user, schema: STORYBOARD_JSON_SCHEMA, name: 'shared_storyboard', label: 'storyboard' },
    opts,
  );
  const parsed = storyboardSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScriptValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const storyboard: Storyboard = {
    ...parsed.data,
    lines: parsed.data.lines.map((l) => ({ ...l, delivery: l.delivery.trim() })),
  };
  const problems = validateStoryboard(storyboard, req.availableMusicMoods);
  if (problems.length) throw new ScriptValidationError(problems);
  return { storyboard, costUsd };
}
