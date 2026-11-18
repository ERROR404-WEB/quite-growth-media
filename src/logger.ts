import pino from 'pino';
import type { Logger } from 'pino';

export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;
  return pino({
    level,
    base: { service: 'qgm-api' },
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        '*.password',
        '*.token',
        '*.apiKey',
        '*.api_key',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } } : {}),
  });
}

export type { Logger };
