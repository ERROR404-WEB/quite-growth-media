import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const imageSize = z
  .string()
  .regex(/^\d+x\d+$/, 'must be WIDTHxHEIGHT')
  .refine((s) => s.split('x').every((n) => Number(n) % 16 === 0), 'width and height must be multiples of 16');

const openAiSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().min(1).default('gpt-6.2-sol'),
  OPENAI_IMAGE_MODEL: z.string().min(1).default('gpt-image-2.6-flare'),
  OPENAI_IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'auto']).default('medium'),
  // The first (hook) frame decides whether viewers stop scrolling, so it gets a higher quality.
  OPENAI_IMAGE_HOOK_QUALITY: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'auto']).default('high'),
  // 9:16, both multiples of 16. Falls back to the standard 1024x1536 if the model rejects it.
  OPENAI_IMAGE_SIZE: imageSize.default('1008x1792'),
  OPENAI_MAX_USD_PER_RUN: z.coerce.number().positive().max(100).default(2),
  OPENAI_IMAGE_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(2),
});

export type OpenAiConfig = z.infer<typeof openAiSchema> & { OPENAI_API_KEY?: string };

export function parseOpenAiConfig(source: NodeJS.ProcessEnv): OpenAiConfig {
  const result = openAiSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid OpenAI configuration:\n${issues}`);
  }
  const key = result.data.OPENAI_API_KEY?.trim();
  return { ...result.data, OPENAI_API_KEY: key ? key : undefined };
}

export function getOpenAiConfig(): OpenAiConfig {
  loadDotenv({ quiet: true });
  return parseOpenAiConfig(process.env);
}

export function requireApiKey(cfg: OpenAiConfig): string {
  if (!cfg.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to .env yourself (never paste it into chat) - see docs/ai-video-test.md.',
    );
  }
  return cfg.OPENAI_API_KEY;
}
