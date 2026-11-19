import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  AUDIO_ASSET_STATUSES,
  AUDIO_KINDS,
  AUDIO_LICENCE_TYPES,
  AUDIO_SOURCES,
  CONTENT_ID_STATUSES,
  PLATFORMS,
  RIGHTS_ANSWERS,
} from '../domain/constants.js';
import type { AudioAsset } from './audio-library.js';
import { AUDIO_CATEGORIES, audioAssetSchema, rightsDecision } from './audio-library.js';

const posix = (p: string) => p.split(sep).join('/');
const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** What the owner writes by hand for each downloaded file (data/audio/catalog.json). */
export const catalogEntrySchema = z
  .object({
    assetCode: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lowercase-words-with-dashes'),
    kind: z.enum(AUDIO_KINDS),
    title: z.string().min(1),
    creator: z.string().min(1).optional(),
    /** Audio file, relative to the catalog. */
    file: z.string().min(1),
    category: z.enum(AUDIO_CATEGORIES),
    moods: z.array(z.string().min(1)).default([]),
    bpm: z.number().positive().optional(),
    source: z.enum(AUDIO_SOURCES),
    sourceUrl: z.url(),
    licenceType: z.enum(AUDIO_LICENCE_TYPES),
    licenceVersion: z.string().min(1).optional(),
    licenceUrl: z.url().optional(),
    commercialUse: z.enum(RIGHTS_ANSWERS).default('unknown'),
    monetizedSocialUse: z.enum(RIGHTS_ANSWERS).default('unknown'),
    modification: z.enum(RIGHTS_ANSWERS).default('unknown'),
    allowedPlatforms: z.array(z.enum(PLATFORMS)).default([]),
    attributionRequired: z.boolean().default(false),
    attributionText: z.string().min(1).optional(),
    prohibitedUses: z.string().min(1).optional(),
    contentIdStatus: z.enum(CONTENT_ID_STATUSES).default('unknown'),
    licenceCheckedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
      .optional(),
    /** Saved licence page / screenshot (path relative to the catalog) or a URL. */
    licenceEvidence: z.string().min(1).optional(),
    status: z.enum(AUDIO_ASSET_STATUSES).default('pending_review'),
    reviewNotes: z.string().optional(),
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const EXAMPLE_CATALOG: z.input<typeof catalogEntrySchema>[] = [
  {
    assetCode: 'example-soft-piano',
    kind: 'music',
    title: 'Example - replace with the real track title',
    creator: 'Artist name from the track page',
    file: 'files/example-soft-piano.mp3',
    category: 'reflective',
    moods: ['calm', 'healing'],
    source: 'mixkit',
    sourceUrl: 'https://mixkit.co/free-stock-music/',
    licenceType: 'mixkit_music_free',
    licenceVersion: 'Mixkit Stock Music Free License',
    licenceUrl: 'https://mixkit.co/license/#musicFree',
    commercialUse: 'unknown',
    monetizedSocialUse: 'unknown',
    modification: 'unknown',
    allowedPlatforms: [],
    attributionRequired: false,
    contentIdStatus: 'unknown',
    licenceEvidence: 'evidence/example-soft-piano.pdf',
    status: 'pending_review',
    reviewNotes: 'Fill in every field from the track and licence pages, then set status to approved.',
  },
];

export interface BuildAssetOptions {
  /** Directory the catalog's relative paths start from. */
  catalogDir: string;
  /** storageUri / evidence paths are stored relative to this root. */
  root: string;
  measureDuration: (file: string) => Promise<number>;
  /** YYYY-MM-DD; defaults to today (UTC). */
  today?: string;
}

/** Builds the full asset record from a catalog entry: checks files, measures duration and checksum. */
export async function buildAsset(
  entry: CatalogEntry,
  opts: BuildAssetOptions,
): Promise<{ asset?: AudioAsset; problems: string[] }> {
  const problems: string[] = [];
  const file = isAbsolute(entry.file) ? entry.file : resolve(opts.catalogDir, entry.file);
  if (!existsSync(file)) return { problems: [`file not found: ${entry.file}`] };
  let evidence: string | null = null;
  if (entry.licenceEvidence) {
    if (isUrl(entry.licenceEvidence)) {
      evidence = entry.licenceEvidence;
    } else {
      const path = resolve(opts.catalogDir, entry.licenceEvidence);
      if (existsSync(path)) evidence = posix(relative(opts.root, path));
      else problems.push(`licence evidence not found: ${entry.licenceEvidence}`);
    }
  }
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  if (entry.licenceCheckedOn && entry.licenceCheckedOn > today)
    problems.push('licenceCheckedOn is in the future');

  const parsed = audioAssetSchema.safeParse({
    assetCode: entry.assetCode,
    kind: entry.kind,
    title: entry.title,
    creator: entry.creator ?? null,
    fileName: basename(file),
    storageUri: posix(relative(opts.root, file)),
    checksumSha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    durationSec: Math.round((await opts.measureDuration(file)) * 1000) / 1000,
    bpm: entry.bpm ?? null,
    category: entry.category,
    moods: entry.moods,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    licenceType: entry.licenceType,
    licenceVersion: entry.licenceVersion ?? null,
    licenceUrl: entry.licenceUrl ?? null,
    commercialUse: entry.commercialUse,
    monetizedSocialUse: entry.monetizedSocialUse,
    modification: entry.modification,
    allowedPlatforms: entry.allowedPlatforms,
    attributionRequired: entry.attributionRequired,
    attributionText: entry.attributionText ?? null,
    prohibitedUses: entry.prohibitedUses ?? null,
    contentIdStatus: entry.contentIdStatus,
    licenceCheckedOn: entry.licenceCheckedOn ?? null,
    licenceEvidenceUri: evidence,
    status: entry.status,
    reviewNotes: entry.reviewNotes ?? null,
  });
  if (!parsed.success) {
    return {
      problems: [...problems, ...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)],
    };
  }
  const asset = parsed.data;
  if (asset.status === 'approved') {
    // Attribution is checked again at selection time, when we know whether it can be published.
    const rights = rightsDecision(asset, asset.allowedPlatforms, { canPublishAttribution: true });
    if (asset.allowedPlatforms.length === 0) rights.reasons.push('allowedPlatforms is empty');
    problems.push(...rights.reasons.map((r) => `cannot approve: ${r}`));
  }
  return problems.length ? { problems } : { asset, problems };
}
