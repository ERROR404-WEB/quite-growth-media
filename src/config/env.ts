import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .default('true')
  .transform((v) => v === 'true' || v === '1');

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/[^\s]+$/, 'must be a postgres:// connection URL')
  .refine((v) => !v.includes('${'), 'contains an unresolved ${VAR} placeholder');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  ADMIN_API_TOKEN: z
    .string()
    .min(24, 'ADMIN_API_TOKEN must be at least 24 characters (run npm run setup:env)'),
  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl.optional(),
  JOB_WORKER_ENABLED: booleanString,
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  JOB_STALE_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Expands ${VAR} references (dotenv does not), so .env.example style URLs keep working. */
function expand(value: string | undefined, source: NodeJS.ProcessEnv): string | undefined {
  return value?.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name: string) => source[name] ?? whole);
}

export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const expanded: NodeJS.ProcessEnv = { ...source };
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) expanded[key] = expand(source[key], source);
  const result = envSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cached) {
    loadDotenv({ quiet: true });
    cached = parseEnv(process.env);
  }
  return cached;
}
