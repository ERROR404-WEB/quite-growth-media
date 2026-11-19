import { getOpenAiConfig } from '../ai/config.js';
import { getElevenLabsConfig } from '../ai/elevenlabs.js';
import { ApiError } from '../ai/http-client.js';
import { OpenAiClient } from '../ai/openai-client.js';
import { OpenAiIllustrator } from '../ai/openai-illustrator.js';
import { generateScript } from '../ai/script-writer.js';
import { generateStoryboard } from '../ai/storyboard.js';
import { NonRetryableJobError } from '../jobs/types.js';
import { selectVoice } from '../media/demo/voice-select.js';
import { resolveFfmpeg } from '../media/ffmpeg.js';
import { BlotatoClient } from '../publishing/blotato.js';
import { getBlotatoConfig } from '../publishing/config.js';
import type { PipelineProviders } from './context.js';

/** Max spend for one script job (a script costs about $0.01-0.03; retries with feedback included). */
const SCRIPT_CAP_USD = 0.5;

/** Network, rate-limit and server errors are worth retrying; everything else is a configuration problem. */
export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === null || err.status === 429 || err.status >= 500);
}

/** Production providers: OpenAI (script + images), ElevenLabs (voice), Blotato (publishing). */
export function defaultProviders(): PipelineProviders {
  const ai = getOpenAiConfig();
  const el = getElevenLabsConfig();
  const bl = getBlotatoConfig();
  let openAiClient: OpenAiClient | undefined;
  const openai = () => {
    if (!ai.OPENAI_API_KEY)
      throw new NonRetryableJobError('OPENAI_API_KEY is not set in .env (see docs/ai-video-test.md)');
    openAiClient ??= new OpenAiClient({ apiKey: ai.OPENAI_API_KEY });
    return openAiClient;
  };
  const model = ai.OPENAI_TEXT_MODEL;
  return {
    textModel: model,
    imageConcurrency: ai.OPENAI_IMAGE_CONCURRENCY,
    caps: {
      storyboardUsd: ai.OPENAI_MAX_USD_PER_RUN,
      scriptUsd: SCRIPT_CAP_USD,
      voiceUsd: el.ELEVENLABS_MAX_USD_PER_RUN,
    },
    generateStoryboard: async (req, budget, signal) =>
      (await generateStoryboard(openai(), req, { model, budget, signal })).storyboard,
    generateScript: (req, budget, signal) => generateScript(openai(), req, { model, budget, signal }),
    illustrator: (budget) =>
      new OpenAiIllustrator(openai(), {
        model: ai.OPENAI_IMAGE_MODEL,
        quality: ai.OPENAI_IMAGE_QUALITY,
        hookQuality: ai.OPENAI_IMAGE_HOOK_QUALITY,
        size: ai.OPENAI_IMAGE_SIZE,
        budget,
      }),
    selectVoice: async (brand, budget, mode) => {
      try {
        return await selectVoice({
          brand,
          el,
          // final renders need the brand's own ElevenLabs voice; test renders may fall back to a local voice.
          mode: mode === 'final' ? 'elevenlabs' : 'auto',
          tools: resolveFfmpeg(),
          budget,
          log: () => undefined,
        });
      } catch (err) {
        if (isTransient(err)) throw err;
        throw new NonRetryableJobError(`voice: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    blotato: () => {
      if (!bl.BLOTATO_API_KEY)
        throw new NonRetryableJobError('BLOTATO_API_KEY is not set in .env (see docs/publishing.md)');
      return new BlotatoClient({ apiKey: bl.BLOTATO_API_KEY, baseUrl: bl.BLOTATO_BASE_URL });
    },
    tools: resolveFfmpeg(),
    publishStatusChecks: 6,
  };
}
