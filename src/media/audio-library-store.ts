import type { AudioUsageRole, Platform } from '../domain/constants.js';
import type { Queryable } from '../db/pool.js';
import type { AudioAsset, AudioUsageStats } from './audio-library.js';
import { audioAssetSchema } from './audio-library.js';

const COLUMNS = `
  asset_code, kind, title, creator, file_name, storage_uri, checksum_sha256, duration_sec::float8 AS duration_sec,
  bpm::float8 AS bpm, category, moods, source, source_url, licence_type, licence_version, licence_url,
  commercial_use, monetized_social_use, modification, allowed_platforms, attribution_required, attribution_text,
  prohibited_uses, content_id_status, to_char(licence_checked_on, 'YYYY-MM-DD') AS licence_checked_on,
  licence_evidence_uri, status, review_notes`;

interface AudioRow {
  asset_code: string;
  kind: string;
  title: string;
  creator: string | null;
  file_name: string;
  storage_uri: string;
  checksum_sha256: string;
  duration_sec: number;
  bpm: number | null;
  category: string;
  moods: string[];
  source: string;
  source_url: string;
  licence_type: string;
  licence_version: string | null;
  licence_url: string | null;
  commercial_use: string;
  monetized_social_use: string;
  modification: string;
  allowed_platforms: string[];
  attribution_required: boolean;
  attribution_text: string | null;
  prohibited_uses: string | null;
  content_id_status: string;
  licence_checked_on: string | null;
  licence_evidence_uri: string | null;
  status: string;
  review_notes: string | null;
}

function fromRow(r: AudioRow): AudioAsset {
  return audioAssetSchema.parse({
    assetCode: r.asset_code,
    kind: r.kind,
    title: r.title,
    creator: r.creator,
    fileName: r.file_name,
    storageUri: r.storage_uri,
    checksumSha256: r.checksum_sha256,
    durationSec: r.duration_sec,
    bpm: r.bpm,
    category: r.category,
    moods: r.moods,
    source: r.source,
    sourceUrl: r.source_url,
    licenceType: r.licence_type,
    licenceVersion: r.licence_version,
    licenceUrl: r.licence_url,
    commercialUse: r.commercial_use,
    monetizedSocialUse: r.monetized_social_use,
    modification: r.modification,
    allowedPlatforms: r.allowed_platforms,
    attributionRequired: r.attribution_required,
    attributionText: r.attribution_text,
    prohibitedUses: r.prohibited_uses,
    contentIdStatus: r.content_id_status,
    licenceCheckedOn: r.licence_checked_on,
    licenceEvidenceUri: r.licence_evidence_uri,
    status: r.status,
    reviewNotes: r.review_notes,
  });
}

/** All library assets, or only those with the given statuses (e.g. ['approved'] for production). */
export async function loadAudioLibrary(
  db: Queryable,
  statuses?: readonly AudioAsset['status'][],
): Promise<AudioAsset[]> {
  const { rows } = statuses
    ? await db.query<AudioRow>(
        `SELECT ${COLUMNS} FROM audio_library_assets WHERE status = ANY($1::text[]) ORDER BY asset_code`,
        [statuses],
      )
    : await db.query<AudioRow>(`SELECT ${COLUMNS} FROM audio_library_assets ORDER BY asset_code`);
  return rows.map(fromRow);
}

/** Inserts or updates an asset by asset_code. The database refuses approval without verified rights. */
export async function upsertAudioAsset(db: Queryable, a: AudioAsset): Promise<{ created: boolean }> {
  const { rows } = await db.query<{ created: boolean }>(
    `INSERT INTO audio_library_assets (
       asset_code, kind, title, creator, file_name, storage_uri, checksum_sha256, duration_sec, bpm, category,
       moods, source, source_url, licence_type, licence_version, licence_url, commercial_use,
       monetized_social_use, modification, allowed_platforms, attribution_required, attribution_text,
       prohibited_uses, content_id_status, licence_checked_on, licence_evidence_uri, status, review_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
             $22, $23, $24, $25, $26, $27, $28)
     ON CONFLICT (asset_code) DO UPDATE SET
       kind = EXCLUDED.kind, title = EXCLUDED.title, creator = EXCLUDED.creator, file_name = EXCLUDED.file_name,
       storage_uri = EXCLUDED.storage_uri, checksum_sha256 = EXCLUDED.checksum_sha256,
       duration_sec = EXCLUDED.duration_sec, bpm = EXCLUDED.bpm, category = EXCLUDED.category,
       moods = EXCLUDED.moods, source = EXCLUDED.source, source_url = EXCLUDED.source_url,
       licence_type = EXCLUDED.licence_type, licence_version = EXCLUDED.licence_version,
       licence_url = EXCLUDED.licence_url, commercial_use = EXCLUDED.commercial_use,
       monetized_social_use = EXCLUDED.monetized_social_use, modification = EXCLUDED.modification,
       allowed_platforms = EXCLUDED.allowed_platforms, attribution_required = EXCLUDED.attribution_required,
       attribution_text = EXCLUDED.attribution_text, prohibited_uses = EXCLUDED.prohibited_uses,
       content_id_status = EXCLUDED.content_id_status, licence_checked_on = EXCLUDED.licence_checked_on,
       licence_evidence_uri = EXCLUDED.licence_evidence_uri, status = EXCLUDED.status,
       review_notes = EXCLUDED.review_notes
     RETURNING (xmax = 0) AS created`,
    [
      a.assetCode,
      a.kind,
      a.title,
      a.creator,
      a.fileName,
      a.storageUri,
      a.checksumSha256,
      a.durationSec,
      a.bpm,
      a.category,
      a.moods,
      a.source,
      a.sourceUrl,
      a.licenceType,
      a.licenceVersion,
      a.licenceUrl,
      a.commercialUse,
      a.monetizedSocialUse,
      a.modification,
      a.allowedPlatforms,
      a.attributionRequired,
      a.attributionText,
      a.prohibitedUses,
      a.contentIdStatus,
      a.licenceCheckedOn,
      a.licenceEvidenceUri,
      a.status,
      a.reviewNotes,
    ],
  );
  return { created: rows[0]?.created ?? false };
}

/** Recent usage per asset (network-wide and for one brand) for rotation in selectAudio(). */
export async function loadAudioUsage(
  db: Queryable,
  brandId: string,
  days = 30,
): Promise<Map<string, AudioUsageStats>> {
  const { rows } = await db.query<{
    asset_code: string;
    uses: number;
    brand_uses: number;
    last_brand_use_at: Date | null;
  }>(
    `SELECT a.asset_code,
            count(*)::int AS uses,
            count(*) FILTER (WHERE u.brand_id = $1)::int AS brand_uses,
            max(u.used_at) FILTER (WHERE u.brand_id = $1) AS last_brand_use_at
       FROM audio_library_usages u
       JOIN audio_library_assets a ON a.id = u.audio_asset_id
      WHERE u.used_at > now() - make_interval(days => $2)
      GROUP BY a.asset_code`,
    [brandId, days],
  );
  return new Map(
    rows.map((r) => [
      r.asset_code,
      { uses: r.uses, brandUses: r.brand_uses, lastBrandUseAt: r.last_brand_use_at },
    ]),
  );
}

/** Records one use (idempotent per key) and updates last_used_at. Returns false if already recorded. */
export async function recordAudioUsage(
  db: Queryable,
  use: {
    assetCode: string;
    brandId: string;
    videoId?: string | null;
    role: AudioUsageRole;
    platforms: readonly Platform[];
    idempotencyKey: string;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `WITH ins AS (
       INSERT INTO audio_library_usages (audio_asset_id, brand_id, video_id, role, platforms, idempotency_key)
       SELECT id, $2, $3, $4, $5, $6 FROM audio_library_assets WHERE asset_code = $1
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING audio_asset_id, used_at)
     UPDATE audio_library_assets a SET last_used_at = ins.used_at FROM ins WHERE a.id = ins.audio_asset_id`,
    [use.assetCode, use.brandId, use.videoId ?? null, use.role, use.platforms, use.idempotencyKey],
  );
  return (rowCount ?? 0) > 0;
}
