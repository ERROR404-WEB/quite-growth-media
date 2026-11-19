import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { FetchLike } from '../ai/http-client.js';
import { ApiError, JsonApiClient } from '../ai/http-client.js';

/**
 * Blotato REST API v2 (official docs, checked 18 Nov 2026: help.blotato.com/rest-api-reference).
 * Auth header `blotato-api-key`. Create-post has NO idempotency key ("repeating create-post risks a
 * duplicate"), so it is sent exactly once; reads and uploads may retry.
 */
export type BlotatoPlatform = 'instagram' | 'facebook' | 'youtube' | 'twitter';

export interface BlotatoAccount {
  id: string;
  platform: string;
  fullname?: string;
  username?: string;
}

export interface BlotatoSubaccount {
  id: string;
  accountId: string;
  name?: string;
}

export interface BlotatoPostRequest {
  post: {
    accountId: string;
    content: { text: string; mediaUrls: string[]; platform: BlotatoPlatform };
    target: Record<string, unknown> & { targetType: BlotatoPlatform };
  };
  scheduledTime?: string;
  useNextFreeSlot?: boolean;
}

export type BlotatoPostStatus =
  | { status: 'in-progress' }
  | { status: 'scheduled'; scheduledTime?: string }
  | { status: 'published'; publicUrl?: string }
  | { status: 'failed'; errorMessage?: string };

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/** Minimum wait between status checks (docs: at least 10 s). */
export const STATUS_POLL_MS = 10_000;

export class BlotatoClient {
  private readonly reads: JsonApiClient;
  private readonly writes: JsonApiClient;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    fetch?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
  }) {
    if (!opts.apiKey) throw new Error('Blotato API key is missing');
    const common = {
      name: 'Blotato',
      baseUrl: opts.baseUrl ?? 'https://backend.blotato.com/v2',
      headers: { 'blotato-api-key': opts.apiKey },
      fetch: opts.fetch,
      sleep: opts.sleep,
      timeoutMs: 120_000,
    };
    this.reads = new JsonApiClient({ ...common, maxAttempts: 4 });
    this.writes = new JsonApiClient({ ...common, maxAttempts: 1 });
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async listAccounts(platform?: BlotatoPlatform): Promise<BlotatoAccount[]> {
    const res = await this.reads.get<{ items?: BlotatoAccount[] }>(
      `/users/me/accounts${platform ? `?platform=${platform}` : ''}`,
    );
    return res.items ?? [];
  }

  async listSubaccounts(accountId: string): Promise<BlotatoSubaccount[]> {
    const res = await this.reads.get<{ items?: BlotatoSubaccount[] }>(
      `/users/me/accounts/${encodeURIComponent(accountId)}/subaccounts`,
    );
    return res.items ?? [];
  }

  /** Presigned upload of a local file: returns the public URL to use in `mediaUrls`. */
  async uploadFile(path: string, signal?: AbortSignal): Promise<string> {
    const contentType = CONTENT_TYPES[extname(path).toLowerCase()];
    if (!contentType) throw new Error(`Unsupported media type for upload: ${path}`);
    const slot = await this.reads.post<{ presignedUrl?: string; publicUrl?: string }>(
      '/media/uploads',
      { filename: basename(path) },
      signal,
    );
    if (!slot.presignedUrl || !slot.publicUrl) throw new Error('Blotato returned no presigned upload URL');
    const bytes = await readFile(path);
    const res = await this.fetchFn(slot.presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
      signal: signal ?? AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) throw new ApiError(`Blotato media upload failed (${res.status})`, res.status, false);
    return slot.publicUrl;
  }

  /** Submits a post once. Never retried here: a lost response must be resolved by looking it up. */
  async createPost(
    request: BlotatoPostRequest,
    signal?: AbortSignal,
  ): Promise<{ postSubmissionId: string; scheduledTime?: string }> {
    const res = await this.writes.post<{ postSubmissionId?: string; scheduledTime?: string }>(
      '/posts',
      request,
      signal,
    );
    if (!res.postSubmissionId) throw new Error('Blotato accepted the post but returned no postSubmissionId');
    return { postSubmissionId: res.postSubmissionId, scheduledTime: res.scheduledTime };
  }

  async getPostStatus(postSubmissionId: string, signal?: AbortSignal): Promise<BlotatoPostStatus> {
    return this.reads.get<BlotatoPostStatus>(`/posts/${encodeURIComponent(postSubmissionId)}`, signal);
  }

  /**
   * Polls until published, failed or scheduled, at least STATUS_POLL_MS apart. Returns the last
   * status; "in-progress" after the limit is NOT a failure - keep the ID and check again later.
   */
  async waitForPost(
    postSubmissionId: string,
    opts: { maxChecks?: number; signal?: AbortSignal } = {},
  ): Promise<BlotatoPostStatus> {
    const maxChecks = opts.maxChecks ?? 30;
    let last: BlotatoPostStatus = { status: 'in-progress' };
    for (let i = 0; i < maxChecks; i++) {
      await this.sleep(STATUS_POLL_MS);
      last = await this.getPostStatus(postSubmissionId, opts.signal);
      if (last.status !== 'in-progress') return last;
    }
    return last;
  }
}
