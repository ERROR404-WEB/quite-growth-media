import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoMetadata } from '../../ai/script-writer.js';
import type { AudioAsset, AudioUsageStats, PlatformVariant, SoundPlanInput } from '../audio-library.js';
import { planPlatformVariants } from '../audio-library.js';
import type { Illustrator } from '../illustrator.js';
import { ExistingImagesIllustrator } from '../illustrator.js';
import type { ProduceVideoOptions, ProduceVideoResult } from '../pipeline.js';
import { produceVideo } from '../pipeline.js';
import type { VoiceProvider } from '../voice.js';
import { ReusedNarration } from '../voice.js';

export interface RenderedVersion {
  variant: PlatformVariant;
  workDir: string;
  result: ProduceVideoResult;
}

/** Metadata for one platform version, with required music credits appended to the YouTube description. */
export function metadataForVersion(metadata: VideoMetadata, variant: PlatformVariant) {
  return {
    ...metadata,
    platforms: variant.platforms,
    credits: variant.credits,
    youtubeDescription: [metadata.shortDescription, ...variant.credits].join('\n\n'),
  };
}

/**
 * Renders the cross-platform version and, where a platform-restricted licensed track fits better
 * (e.g. YouTube-only music with a credit), a separate version for that platform. Later versions reuse
 * the first one's narration and images, so they cost nothing extra.
 */
export async function renderPlatformVersions(args: {
  base: Omit<ProduceVideoOptions, 'workDir' | 'soundPlan' | 'platforms' | 'canPublishAttribution'>;
  workDir: string;
  sound: Omit<SoundPlanInput, 'platforms' | 'canPublishAttribution' | 'library' | 'usage'>;
  library: readonly AudioAsset[];
  usage: ReadonlyMap<string, AudioUsageStats>;
  metadata: VideoMetadata;
  metadataBase: Record<string, unknown>;
  log: (line: string) => void;
}): Promise<RenderedVersion[]> {
  const { base } = args;
  const { main, extra } = planPlatformVariants(
    { ...args.sound, library: args.library, usage: args.usage },
    base.brand.platforms,
  );
  const variants = [main, ...extra].filter((v) => v.platforms.length > 0);
  const versions: RenderedVersion[] = [];
  for (const [i, variant] of variants.entries()) {
    const first = versions[0];
    const workDir = i === 0 ? args.workDir : join(args.workDir, variant.platforms.join('-'));
    mkdirSync(workDir, { recursive: true });
    args.log(
      `  version for ${variant.platforms.join(', ')}:${variant.soundPlan.notes.map((n) => `\n    ${n}`).join('')}`,
    );
    writeFileSync(
      join(workDir, 'metadata.json'),
      `${JSON.stringify({ ...args.metadataBase, ...metadataForVersion(args.metadata, variant) }, null, 2)}\n`,
      'utf8',
    );
    const voice: VoiceProvider | null | undefined = first
      ? new ReusedNarration(first.result.voice, first.result.narrationClips)
      : base.voice;
    const illustrator: Illustrator | undefined = first
      ? new ExistingImagesIllustrator(first.workDir, first.result.imageFiles)
      : base.illustrator;
    const result = await produceVideo({
      ...base,
      voice,
      illustrator,
      workDir,
      soundPlan: variant.soundPlan,
      platforms: variant.platforms,
      canPublishAttribution: variant.credits.length > 0,
      manifestExtra: { ...base.manifestExtra, platformVersion: variant.platforms, credits: variant.credits },
    });
    versions.push({ variant, workDir, result });
  }
  return versions;
}
