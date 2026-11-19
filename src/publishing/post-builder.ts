import { PLATFORM_TEXT_LIMITS, xWeightedLength } from '../ai/script-writer.js';
import type { VideoMetadata } from '../ai/script-writer.js';
import type { BrandConfig } from '../brands/index.js';
import type { Platform } from '../domain/constants.js';
import type { BlotatoPlatform, BlotatoPostRequest } from './blotato.js';

/** Our platform names → Blotato's (`x` is `twitter` there). */
export const BLOTATO_PLATFORM: Record<Platform, BlotatoPlatform> = {
  instagram: 'instagram',
  facebook: 'facebook',
  youtube: 'youtube',
  x: 'twitter',
};

export interface PublishTarget {
  platform: Platform;
  /** Blotato account ID (List Connected Accounts). */
  accountId: string;
  /** Facebook Page ID (List Subaccounts); required for Facebook. */
  pageId?: string;
}

export interface PostInput {
  brand: BrandConfig;
  target: PublishTarget;
  mediaUrl: string;
  metadata: VideoMetadata & { youtubeDescription?: string };
  /** Attribution lines required by licensed audio (platform-specific versions only). */
  credits?: readonly string[];
  youtubePrivacy: 'private' | 'unlisted' | 'public';
  /** ISO-8601 time in the future, or "next" for Blotato's next free calendar slot. */
  schedule?: string;
}

const join = (...parts: (string | undefined)[]) => parts.filter((p) => p && p.trim()).join('\n\n');

/** X text: the caption plus as many hashtags as fit in 280 weighted characters. */
export function xText(caption: string, hashtags: readonly string[], credits: readonly string[] = []): string {
  let text = join(caption, ...credits);
  for (const tag of hashtags) {
    const next = `${text} ${tag}`;
    if (xWeightedLength(next) > PLATFORM_TEXT_LIMITS.xPostWeighted) break;
    text = next;
  }
  if (xWeightedLength(text) > PLATFORM_TEXT_LIMITS.xPostWeighted) {
    throw new Error(`X text is longer than ${PLATFORM_TEXT_LIMITS.xPostWeighted} weighted characters`);
  }
  return text;
}

/**
 * Builds one Blotato post for a rendered video (official field reference, checked 18 Nov 2026):
 * Instagram and Facebook as Reels, YouTube with title/privacy/made-for-kids/AI disclosure, X as text +
 * video. Captions and hashtags come from the video's validated per-platform metadata.
 */
export function buildBlotatoPost(input: PostInput): BlotatoPostRequest {
  const { target, metadata: m, brand } = input;
  const credits = input.credits ?? [];
  const tags = m.hashtags.join(' ');
  const platform = BLOTATO_PLATFORM[target.platform];
  let text: string;
  let extra: Record<string, unknown>;
  switch (target.platform) {
    case 'instagram':
      text = join(m.captions.instagram, ...credits, tags);
      if (text.length > PLATFORM_TEXT_LIMITS.instagramCaptionChars)
        throw new Error('Instagram caption is longer than 2,200 characters');
      extra = { mediaType: 'reel', shareToFeed: true };
      break;
    case 'facebook':
      if (!target.pageId) throw new Error(`Facebook needs a pageId for ${brand.id} (blotato:link --page-id)`);
      text = join(m.captions.facebook, ...credits, tags);
      extra = { pageId: target.pageId, mediaType: 'reel' };
      break;
    case 'youtube':
      if (m.youtubeTitle.length > PLATFORM_TEXT_LIMITS.youtubeTitleChars)
        throw new Error('YouTube title is longer than 100 characters');
      text = join(m.youtubeDescription ?? m.shortDescription, ...credits, tags);
      if (Buffer.byteLength(text, 'utf8') > PLATFORM_TEXT_LIMITS.youtubeDescriptionBytes)
        throw new Error('YouTube description is longer than 5,000 bytes');
      extra = {
        title: m.youtubeTitle,
        privacyStatus: input.youtubePrivacy,
        shouldNotifySubscribers: input.youtubePrivacy === 'public',
        // Children's brands are made for kids (COPPA); everything else is not.
        isMadeForKids: brand.madeForKids,
        // AI-generated illustrations and voice: disclose (spec + YouTube altered/synthetic policy).
        containsSyntheticMedia: true,
      };
      break;
    case 'x':
      text = xText(m.captions.x, m.hashtags, credits);
      extra = {};
      break;
  }
  const request: BlotatoPostRequest = {
    post: {
      accountId: target.accountId,
      content: { text, mediaUrls: [input.mediaUrl], platform },
      target: { targetType: platform, ...extra },
    },
  };
  if (input.schedule === 'next') request.useNextFreeSlot = true;
  else if (input.schedule) {
    const at = new Date(input.schedule);
    if (Number.isNaN(at.getTime())) throw new Error(`Invalid schedule time ${input.schedule}`);
    if (at.getTime() <= Date.now()) throw new Error(`Schedule time ${input.schedule} is in the past`);
    request.scheduledTime = at.toISOString();
  }
  return request;
}
