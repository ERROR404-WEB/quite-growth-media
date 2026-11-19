import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const schema = z.object({
  BLOTATO_API_KEY: z.string().optional(),
  BLOTATO_BASE_URL: z.string().url().default('https://backend.blotato.com/v2'),
  /** YouTube visibility for new uploads; "private" until the owner has checked the first posts. */
  BLOTATO_YOUTUBE_PRIVACY: z.enum(['private', 'unlisted', 'public']).default('private'),
});

export type BlotatoConfig = z.infer<typeof schema>;

export function parseBlotatoConfig(source: NodeJS.ProcessEnv): BlotatoConfig {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid Blotato configuration:\n${issues}`);
  }
  const key = result.data.BLOTATO_API_KEY?.trim();
  return { ...result.data, BLOTATO_API_KEY: key ? key : undefined };
}

export function getBlotatoConfig(): BlotatoConfig {
  loadDotenv({ quiet: true });
  return parseBlotatoConfig(process.env);
}

export function requireBlotatoKey(cfg: BlotatoConfig): string {
  if (!cfg.BLOTATO_API_KEY) {
    throw new Error(
      'BLOTATO_API_KEY is not set. Add it to .env yourself (never paste it into chat) - see docs/publishing.md.',
    );
  }
  return cfg.BLOTATO_API_KEY;
}
