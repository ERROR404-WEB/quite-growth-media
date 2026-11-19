import type { FetchLike } from './http-client.js';
import { ApiError, JsonApiClient } from './http-client.js';

export type { FetchLike };
/** Errors from OpenAI calls (same class as other providers; kept for readability). */
export { ApiError as OpenAiError };

export interface OpenAiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** OpenAI JSON client. The key is only ever sent in the Authorization header. */
export class OpenAiClient extends JsonApiClient {
  constructor(opts: OpenAiClientOptions) {
    if (!opts.apiKey) throw new Error('OpenAI API key is missing');
    super({
      name: 'OpenAI',
      baseUrl: opts.baseUrl ?? 'https://api.openai.com/v1',
      headers: { Authorization: 'Bearer ' + opts.apiKey },
      fetch: opts.fetch,
      maxAttempts: opts.maxAttempts,
      timeoutMs: opts.timeoutMs,
      sleep: opts.sleep,
    });
  }
}
