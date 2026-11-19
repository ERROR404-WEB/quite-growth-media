import type { VideoMetadata } from '../ai/script-writer.js';
import type { BrandConfig } from '../brands/index.js';
import type { Platform } from '../domain/constants.js';

/** The parts of a render's manifest.json the publisher relies on. */
export interface RenderManifest {
  brandId: string;
  title: string;
  /** On-screen label burned into the video (e.g. "AI TEST · not for publishing"); absent on final renders. */
  label?: string | null;
  providers?: { illustration?: string; voice?: string; music?: string };
  voiceSelection?: { temporary?: boolean; voiceId?: string | null; commercial?: boolean };
  audio?: {
    platforms?: Platform[];
    files?: { file: string; licence?: { assetCode?: string; allowedPlatforms?: Platform[] } }[];
  };
  platformVersion?: Platform[];
  credits?: string[];
  metadata?: VideoMetadata & { youtubeDescription?: string };
  result?: { passed?: boolean; qa?: { name: string; status: string; detail: string }[] };
}

/**
 * Hard publishing gate (AGENTS.md rule 4: never publish failed, test or quarantined content). Returns
 * every reason the render may not go to `platform`; an empty list means it may be published.
 */
export function publishProblems(manifest: RenderManifest, brand: BrandConfig, platform: Platform): string[] {
  const problems: string[] = [];
  if (manifest.brandId !== brand.id) problems.push(`render belongs to ${manifest.brandId}, not ${brand.id}`);
  if (!brand.platforms.includes(platform))
    problems.push(`${brand.displayName} does not publish to ${platform}`);

  const qa = manifest.result?.qa ?? [];
  if (manifest.result?.passed !== true || qa.length === 0) problems.push('QA did not pass');
  const failed = qa.filter((c) => c.status === 'failed').map((c) => c.name);
  if (failed.length) problems.push(`failed QA checks: ${failed.join(', ')}`);

  if (!('label' in manifest)) problems.push('render predates label tracking; render it again (with --final)');
  else if (manifest.label?.trim()) problems.push(`test render with an on-screen label ("${manifest.label}")`);
  const voice = manifest.providers?.voice ?? '';
  if (!voice.startsWith('elevenlabs')) problems.push(`voice "${voice || 'none'}" is not a production voice`);
  if (manifest.voiceSelection?.temporary !== false) problems.push('voice is temporary (not the brand voice)');
  if (manifest.voiceSelection?.commercial !== true)
    problems.push('voice has no confirmed commercial licence (paid ElevenLabs plan)');
  const art = manifest.providers?.illustration ?? '';
  if (!art) problems.push('illustration provider is unknown');
  else if (/placeholder|stand-in/i.test(art)) problems.push(`illustrations "${art}" are placeholders`);

  const cleared = manifest.platformVersion ?? manifest.audio?.platforms ?? [];
  if (!cleared.includes(platform)) problems.push(`this version was not made for ${platform}`);
  for (const f of manifest.audio?.files ?? []) {
    if (!f.licence?.allowedPlatforms?.includes(platform)) {
      problems.push(`audio ${f.licence?.assetCode ?? f.file} is not licensed for ${platform}`);
    }
  }

  const m = manifest.metadata;
  if (!m) problems.push('no publishing metadata in the manifest');
  else if (!m.captions?.[platform]?.trim()) problems.push(`no ${platform} caption in the metadata`);
  return problems;
}
