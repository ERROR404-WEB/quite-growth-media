import { z } from 'zod';
import { CONTENT_CATEGORIES, LANGUAGES, NICHES, PALETTE_MOODS, PLATFORMS } from '../domain/constants.js';

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB colour');

export const contentSlotSchema = z.object({
  slot: z.number().int().min(1).max(20),
  category: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  /** Local publish time (HH:MM, 24 h) in the brand's publishTimezone. */
  publishTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24 h)'),
});

const elevenLabsVoiceRef = z.object({
  voiceId: z.string().regex(/^[A-Za-z0-9]{8,64}$/, 'must be an ElevenLabs voice ID'),
  name: z.string().min(1),
  /** library = shared Voice Library voice (needs a paid plan for API use); designed = our own Voice Design voice. */
  source: z.enum(['library', 'designed']),
});

/** One fixed narrator voice per brand, so every video of the brand sounds the same. */
export const brandVoiceSchema = z.object({
  /** Casting brief: who the narrator is and how they speak. */
  direction: z.string().min(10),
  /** The brand's fixed ElevenLabs voice. Absent until chosen/designed. */
  elevenLabs: elevenLabsVoiceRef.optional(),
  /** Reviewed backups (same casting brief) in case the main voice becomes unavailable. */
  alternatives: z.array(elevenLabsVoiceRef).default([]),
  /** Prompt for ElevenLabs Voice Design (npm run voices:design), for an original voice owned by us. */
  designPrompt: z.string().min(20).max(1000).optional(),
  /** Original preview line in the brand language for Voice Design (100-1000 characters). */
  previewText: z.string().min(100).max(1000).optional(),
  /**
   * Per-brand ElevenLabs settings. Lower stability = broader emotional range (official API reference).
   * Absent values fall back to ELEVENLABS_STABILITY in .env.
   */
  settings: z
    .object({
      stability: z.number().min(0).max(1).optional(),
      /** Speaking pace, 1 = normal; 0.7-1.2 per the official ElevenLabs docs (all voices and models). */
      speed: z.number().min(0.7).max(1.2).optional(),
    })
    .optional(),
  /** Send a per-line delivery audio tag such as "[soft, aching]" (Eleven v3/v4 only). */
  audioTags: z.boolean().optional(),
});

export type BrandVoice = z.infer<typeof brandVoiceSchema>;

const seconds = z.number().min(7).max(45);

/** Brand-preferred video length inside the platform-wide 7–45 s window. */
export const durationTargetSchema = z
  .object({ minSec: seconds, maxSec: seconds, idealMinSec: seconds, idealMaxSec: seconds })
  .refine((d) => d.minSec <= d.idealMinSec && d.idealMinSec <= d.idealMaxSec && d.idealMaxSec <= d.maxSec, {
    message: 'must satisfy minSec <= idealMinSec <= idealMaxSec <= maxSec',
  });

export type DurationTarget = z.infer<typeof durationTargetSchema>;

export const brandConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a kebab-case slug'),
    brandNumber: z.number().int().min(1).max(99),
    displayName: z.string().min(1),
    nativeName: z.string().min(1).optional(),
    language: z.enum(LANGUAGES),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
    audience: z.string().min(1),
    /** How the brand speaks, e.g. "Reflective, calm, emotionally intelligent". */
    tone: z.string().min(10).optional(),
    niche: z.enum(NICHES),
    tradition: z.enum(['none', 'general', 'hindu']),
    ageRange: z
      .object({ min: z.number().int().min(0).max(17), max: z.number().int().min(0).max(17) })
      .optional(),
    madeForKids: z.boolean(),
    dailyVideoTarget: z.number().int().min(0).max(20),
    durationTarget: durationTargetSchema.optional(),
    publishTimezone: z.string().min(1),
    platforms: z.array(z.enum(PLATFORMS)).min(1),
    contentSlots: z.array(contentSlotSchema).min(1),
    topics: z.array(z.string().min(1)).min(5),
    validation: z.object({
      factCheck: z.boolean(),
      scriptureCheck: z.boolean(),
      childSafety: z.boolean(),
    }),
    contentRules: z.array(z.string().min(1)),
    visualIdentity: z.object({
      style: z.string().min(1),
      palette: z.array(hexColour).min(3),
      typography: z.string().min(1),
      characterNotes: z.string().min(1),
      pacing: z.string().min(1),
      avoid: z.array(z.string().min(1)),
      /** Emotional mood words the images should carry. */
      mood: z.array(z.string().min(1)).optional(),
      /** Recurring settings that make the brand recognisable (used naturally, not forced into every scene). */
      environments: z.array(z.string().min(1)).optional(),
      /** Signature light: how glow, shadow and colour temperature are used. */
      lighting: z.string().min(10).optional(),
      /** Framing rules added to every image prompt. */
      composition: z.string().min(10).optional(),
      /** Colour palette per line mood; when set, a scene's mood palette leads and `palette` becomes accents. */
      moodPalettes: z.record(z.enum(PALETTE_MOODS), z.array(hexColour).min(3)).optional(),
      /** Skin-tone and shadow colours for characters. */
      skinTones: z.array(hexColour).min(2).optional(),
      /** Film look applied to the whole video in FFmpeg, so every image shares the same grade. */
      grade: z
        .object({
          /** 1 = unchanged; 0.75 = 25 % less saturated. */
          saturation: z.number().min(0.5).max(1.3),
          /** 1 = unchanged. */
          contrast: z.number().min(0.8).max(1.3).optional(),
          /** Animated luma grain strength (FFmpeg noise), 0 = off. */
          grain: z.number().int().min(0).max(40),
          vignette: z.boolean(),
          /** Vignette lens angle in radians (FFmpeg default PI/5 ≈ 0.63); larger = darker corners. */
          vignetteAngle: z.number().min(0.2).max(1.2).optional(),
          /** Colour temperature in kelvin (6500 = neutral; lower = warmer), FFmpeg colortemperature. */
          temperature: z.number().int().min(3000).max(9000).optional(),
          /** Lifted blacks / faded film look: 0 = off, 0.08 = blacks lifted to 8 %. */
          fade: z.number().min(0).max(0.2).optional(),
          /** Procedural film dust specks (original, generated in FFmpeg - no licence needed). */
          dust: z.boolean().optional(),
        })
        .optional(),
      /**
       * Caption look: "bold" = bold sans in the lower-middle area (default); "soft_handwritten" = the
       * reference-reel look - centred, small handwritten text, 2-4 words at a time, soft shadow and fades.
       */
      captionStyle: z.enum(['bold', 'soft_handwritten']).optional(),
      /** Camera motion: strength scales the Ken Burns move (1 = full overscan), transition = crossfade seconds. */
      motion: z
        .object({
          strength: z.number().min(0.1).max(1),
          transition: z.number().min(0.1).max(1),
        })
        .optional(),
    }),
    voice: brandVoiceSchema,
  })
  .superRefine((brand, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });

    if (brand.contentSlots.length !== brand.dailyVideoTarget) {
      issue(`needs exactly ${brand.dailyVideoTarget} content slots`, ['contentSlots']);
    }
    const slotNumbers = brand.contentSlots.map((s) => s.slot);
    if (new Set(slotNumbers).size !== slotNumbers.length)
      issue('slot numbers must be unique', ['contentSlots']);
    const times = brand.contentSlots.map((s) => s.publishTime);
    if (new Set(times).size !== times.length) issue('slot publish times must be unique', ['contentSlots']);

    const allowed: readonly string[] = CONTENT_CATEGORIES[brand.niche];
    brand.contentSlots.forEach((s, i) => {
      if (!allowed.includes(s.category)) {
        issue(`category "${s.category}" is not valid for niche ${brand.niche}`, [
          'contentSlots',
          i,
          'category',
        ]);
      }
    });

    if (!brand.locale.startsWith(`${brand.language}-`)) issue('locale must match language', ['locale']);

    if (brand.niche === 'kids') {
      if (!brand.ageRange) issue('kids brands require an ageRange', ['ageRange']);
      if (!brand.madeForKids) issue('kids brands must be madeForKids', ['madeForKids']);
      if (!brand.validation.childSafety) issue('kids brands require child-safety validation', ['validation']);
    } else if (brand.madeForKids) {
      issue('only kids brands may be madeForKids', ['madeForKids']);
    }
    if (brand.ageRange && brand.ageRange.min > brand.ageRange.max) issue('ageRange.min > max', ['ageRange']);

    if (brand.niche === 'hindu_devotional') {
      if (brand.tradition !== 'hindu') issue('hindu_devotional brands use tradition "hindu"', ['tradition']);
      if (!brand.validation.scriptureCheck)
        issue('devotional brands require scripture validation', ['validation']);
    }
    if (brand.niche === 'spirituality' && brand.tradition !== 'general') {
      issue('general spirituality brands must not be tied to a specific religion', ['tradition']);
    }

    // Kids brands speak through an original character voice we design and own (no look-alike or
    // "inspired by" character voices from the shared library).
    if (brand.niche === 'kids') {
      if (!brand.voice.designPrompt || !brand.voice.previewText) {
        issue('kids brands need voice.designPrompt and voice.previewText for an original character voice', [
          'voice',
        ]);
      }
      if (brand.voice.elevenLabs && brand.voice.elevenLabs.source !== 'designed') {
        issue('kids brands must use a designed (original) voice', ['voice', 'elevenLabs', 'source']);
      }
    }
    const ids = [brand.voice.elevenLabs?.voiceId, ...brand.voice.alternatives.map((a) => a.voiceId)].filter(
      Boolean,
    );
    if (new Set(ids).size !== ids.length) issue('voice and alternatives must be different voices', ['voice']);
  });

export type BrandConfig = z.infer<typeof brandConfigSchema>;
export type ContentSlot = z.infer<typeof contentSlotSchema>;
