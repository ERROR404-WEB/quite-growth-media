export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface JsonApiClientOptions {
  /** Provider name used in error messages, e.g. "OpenAI". */
  name: string;
  baseUrl: string;
  /** Auth headers. Keys are only ever sent in headers, never in URLs or bodies. */
  headers: Record<string, string>;
  fetch?: FetchLike;
  /** Total attempts for retryable failures (429, 5xx, network). */
  maxAttempts?: number;
  timeoutMs?: number;
  /** Injected for tests so retries don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  // OpenAI style
  error?: { message?: string; code?: string; type?: string };
  // ElevenLabs style: { detail: { status, message } } or a FastAPI validation list
  detail?: { status?: string; message?: string } | { msg?: string; loc?: unknown[] }[] | string;
}

function describe(body: ErrorBody): { message?: string; code?: string } {
  if (body.error) return { message: body.error.message, code: body.error.code ?? body.error.type };
  const d = body.detail;
  if (typeof d === 'string') return { message: d };
  if (Array.isArray(d))
    return {
      message: d
        .map((x) => x.msg)
        .filter(Boolean)
        .join('; '),
      code: 'validation_error',
    };
  if (d) return { message: d.message, code: d.status };
  return {};
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Minimal JSON HTTP client with bounded retries (429 / 5xx / network) and timeouts. */
export class JsonApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: JsonApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.timeoutMs = opts.timeoutMs ?? 180_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>('POST', path, body, signal);
  }

  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>('GET', path, undefined, signal);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const label = `${this.opts.name} ${path.split('?')[0]}`;
    let lastError: ApiError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers: {
            ...this.opts.headers,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: combined,
        });
        if (res.ok) return (await res.json()) as T;
        const parsed = describe((await res.json().catch(() => ({}))) as ErrorBody);
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new ApiError(
          `${label} failed (${res.status}): ${parsed.message ?? res.statusText ?? 'request failed'}`,
          res.status,
          retryable,
          parsed.code,
        );
        if (!retryable) throw lastError;
        const retryAfter = Number(res.headers.get('retry-after'));
        if (attempt < this.maxAttempts) {
          await this.sleep(
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1),
          );
        }
      } catch (err) {
        if (err instanceof ApiError && !err.retryable) throw err;
        if (signal?.aborted) throw err;
        if (!(err instanceof ApiError)) {
          lastError = new ApiError(`${label} network error: ${(err as Error).message}`, null, true);
          if (attempt < this.maxAttempts) await this.sleep(2000 * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError ?? new ApiError(`${label} failed`, null, true);
  }
}
