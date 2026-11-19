import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandConfig } from '../brands/index.js';
import type { Illustration, IllustrationRequest, Illustrator } from '../media/illustrator.js';
import type { OpenAiClient } from './openai-client.js';
import { OpenAiError } from './openai-client.js';
import type { Budget } from './pricing.js';
import { imageCostUsd } from './pricing.js';
import { SHOT_DESCRIPTIONS } from './script-writer.js';

export type ImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

/** Conservative per-image ceilings used only for the budget check before each call. */
const MAX_ESTIMATE_USD: Record<ImageQuality, number> = {
  low: 0.05,
  medium: 0.15,
  high: 0.4,
  xhigh: 0.8,
  max: 1.5,
  auto: 0.4,
};

const FALLBACK_SIZE = '1024x1536';

interface ImagesApiResult {
  data?: { b64_json?: string; revised_prompt?: string }[];
  size?: string;
  quality?: string;
  output_format?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  };
}

export function buildImagePrompt(
  brand: BrandConfig,
  req: Pick<IllustrationRequest, 'visual' | 'characterDescription' | 'shot' | 'palette'> & {
    sceneIndex?: number;
  },
): string {
  const v = brand.visualIdentity;
  const kids = brand.niche === 'kids';
  const character = req.characterDescription?.trim();
  const opening =
    req.sceneIndex === 0
      ? kids
        ? 'This is the opening frame: bright, clear and instantly delightful, with one obvious focal point.'
        : 'This is the opening frame of the video: it must stop the scroll - one clear focal point with quiet but striking emotion or composition, readable at a glance on a phone.'
      : '';
  const moodPalette = req.palette && v.moodPalettes?.[req.palette];
  const colours = moodPalette
    ? `Colour palette (${req.palette} mood): ${moodPalette.join(', ')}. Brand accent colours, used sparingly: ${v.palette.join(', ')}.`
    : `Colour palette: ${v.palette.join(', ')}.`;
  return [
    `Vertical 9:16 illustration for a short video. Style: ${v.style}.`,
    req.shot ? `Shot: ${SHOT_DESCRIPTIONS[req.shot]}.` : '',
    `${colours}${v.mood?.length ? ` Mood: ${v.mood.join(', ')}.` : ''} Pacing: ${v.pacing}.`,
    v.skinTones?.length ? `Character skin tones: ${v.skinTones.join(', ')}; dark hair (#2D2D2D).` : '',
    v.lighting ? `Lighting: ${v.lighting}` : '',
    character && !/^none\.?$/i.test(character)
      ? `Recurring character (keep identical in every scene): ${character.replace(/\.$/, '')}.`
      : '',
    `Scene: ${req.visual}`,
    opening,
    v.composition ? `Framing: ${v.composition}` : '',
    v.captionStyle === 'soft_handwritten'
      ? 'Composition: a full-bleed scene that fills the entire frame edge to edge - continue the floor, ground or background naturally all the way to the bottom edge (never leave an empty band or border). A short caption is added later across the vertical centre of the frame, so keep the horizontal band around the middle calm and low in detail (sky, soft wall, mist, distant landscape or soft fabric) and place faces above that band or to one side - never behind it.'
      : 'Composition: a full-bleed scene that fills the entire frame edge to edge - continue the floor, ground or background naturally all the way to the bottom edge (never leave an empty band or border). Keep the main subject in the upper two-thirds; the lower third should hold only simple, low-detail background because captions are added there later.',
    v.captionStyle === 'soft_handwritten'
      ? 'Build gentle depth for a very slow push-in: distinct foreground, midground and background layers, fine detail, one clean focal point.'
      : 'Build depth for a slow camera push-in or pan: distinct foreground, midground and background layers, high detail, clean focal point.',
    'Do not include any text, letters, numbers, captions, speech bubbles, logos, watermarks or signatures in the image.',
    'Use only original characters and designs; do not resemble any existing cartoon, anime, film, game or brand character, or any real person.',
    kids
      ? 'Gentle, friendly and age-appropriate for young children: soft shapes, kind expressions, nothing scary, violent or unsafe.'
      : '',
    v.avoid.length ? `Avoid: ${v.avoid.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export class OpenAiIllustrator implements Illustrator {
  readonly name: string;

  constructor(
    private readonly client: OpenAiClient,
    private readonly opts: {
      model: string;
      quality: ImageQuality;
      size: string;
      budget: Budget;
      /** Quality for the hook (first) image; defaults to `quality`. */
      hookQuality?: ImageQuality;
    },
  ) {
    this.name = `openai ${opts.model} (${opts.quality}${opts.hookQuality && opts.hookQuality !== opts.quality ? `, hook ${opts.hookQuality}` : ''}, ${opts.size})`;
  }

  async generate(req: IllustrationRequest): Promise<Illustration> {
    const prompt = buildImagePrompt(req.brand, req);
    const what = `image ${req.sceneIndex + 1}/${req.sceneCount}`;
    // The hook frame decides whether viewers stop scrolling, so it may use a higher quality.
    const quality = req.sceneIndex === 0 && this.opts.hookQuality ? this.opts.hookQuality : this.opts.quality;
    let size = this.opts.size;
    let res: ImagesApiResult;
    const started = Date.now();
    this.opts.budget.reserve(MAX_ESTIMATE_USD[quality], what);
    try {
      res = await this.request(prompt, size, quality, req.signal);
    } catch (err) {
      // Custom sizes depend on the model's pixel/edge limits; fall back to the standard portrait size.
      if (
        err instanceof OpenAiError &&
        err.status === 400 &&
        /size/i.test(err.message) &&
        size !== FALLBACK_SIZE
      ) {
        size = FALLBACK_SIZE;
        res = await this.request(prompt, size, quality, req.signal);
      } else {
        throw err;
      }
    }

    const usage = {
      textInput: res.usage?.input_tokens_details?.text_tokens ?? res.usage?.input_tokens ?? 0,
      imageInput: res.usage?.input_tokens_details?.image_tokens ?? 0,
      output: res.usage?.output_tokens ?? 0,
    };
    const costUsd = imageCostUsd(this.opts.model, usage);
    this.opts.budget.record('illustration', this.opts.model, costUsd);

    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new OpenAiError(`OpenAI returned no image for ${what}`, null, true);
    const ext = res.output_format === 'png' ? 'png' : res.output_format === 'webp' ? 'webp' : 'jpg';
    const file = `scene-${req.sceneIndex + 1}.${ext}`;
    writeFileSync(join(req.workDir, file), Buffer.from(b64, 'base64'));
    return {
      file,
      provider: 'openai',
      model: this.opts.model,
      prompt,
      costUsd,
      provenance: {
        requestedSize: this.opts.size,
        size: res.size ?? size,
        quality: res.quality ?? quality,
        usage,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        createdAt: new Date().toISOString(),
        licence:
          'OpenAI Services Agreement (updated 2025-12-01): customer owns all Output, to the extent permitted by law. Checked 2026-11-18.',
      },
    };
  }

  private request(
    prompt: string,
    size: string,
    quality: ImageQuality,
    signal?: AbortSignal,
  ): Promise<ImagesApiResult> {
    return this.client.post<ImagesApiResult>(
      '/images/generations',
      {
        model: this.opts.model,
        prompt,
        size,
        quality,
        output_format: 'jpeg',
        output_compression: 92,
        moderation: 'auto',
        n: 1,
      },
      signal,
    );
  }
}
