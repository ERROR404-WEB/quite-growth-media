-- 0002_audio_library.sql
-- Curated, licence-verified music and sound-effect library shared by the network
-- (docs/audio-library.md). The library itself is network-wide; every use is recorded per brand in
-- audio_library_usages (brand_id), which drives rotation and brand usage history.
-- Rule: only rows with status 'approved' may enter production, and the database refuses to approve a
-- row unless every right needed for monetised, modified, multi-platform social video is explicitly
-- 'allowed', Content ID status is known-clean, and dated licence evidence exists.

CREATE TABLE audio_library_assets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code             text NOT NULL UNIQUE CHECK (asset_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind                   text NOT NULL CHECK (kind IN ('music', 'sound_effect')),
  title                  text NOT NULL,
  creator                text,
  file_name              text NOT NULL,
  storage_uri            text NOT NULL,
  checksum_sha256        text NOT NULL UNIQUE CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  duration_sec           numeric(8, 3) NOT NULL CHECK (duration_sec > 0),
  bpm                    numeric(6, 2) CHECK (bpm > 0),
  category               text NOT NULL
                           CHECK (category IN (
                             -- music moods
                             'calm', 'emotional', 'sad', 'heartbreak', 'healing', 'hopeful', 'motivational',
                             'cinematic', 'suspense', 'curiosity', 'confidence', 'reflective', 'ambient',
                             'playful', 'lullaby', 'devotional',
                             -- one-shot sound effects
                             'whoosh', 'soft_impact', 'cinematic_hit', 'transition', 'footsteps', 'paper',
                             'clock', 'soft_texture', 'emotional_transition',
                             -- ambience beds
                             'rain', 'wind', 'room_ambience', 'city_ambience', 'nature_ambience')),
  moods                  text[] NOT NULL DEFAULT '{}',
  source                 text NOT NULL CHECK (source IN ('pixabay', 'mixkit', 'youtube_audio_library', 'original', 'other')),
  source_url             text NOT NULL,
  licence_type           text NOT NULL
                           CHECK (licence_type IN ('pixabay_content_license', 'mixkit_music_free', 'mixkit_sfx_free',
                                                   'youtube_audio_library', 'cc0', 'cc_by', 'original_work', 'custom')),
  licence_version        text,
  licence_url            text,
  commercial_use         text NOT NULL DEFAULT 'unknown' CHECK (commercial_use IN ('allowed', 'prohibited', 'unknown')),
  monetized_social_use   text NOT NULL DEFAULT 'unknown' CHECK (monetized_social_use IN ('allowed', 'prohibited', 'unknown')),
  modification           text NOT NULL DEFAULT 'unknown' CHECK (modification IN ('allowed', 'prohibited', 'unknown')),
  -- Platforms this asset is cleared for. A YouTube-only licence must list only 'youtube'.
  allowed_platforms      text[] NOT NULL DEFAULT '{}'
                           CHECK (allowed_platforms <@ ARRAY['instagram', 'facebook', 'youtube', 'x']::text[]),
  attribution_required   boolean NOT NULL DEFAULT false,
  attribution_text       text,
  prohibited_uses        text,
  content_id_status      text NOT NULL DEFAULT 'unknown' CHECK (content_id_status IN ('not_registered', 'registered', 'unknown')),
  licence_checked_on     date,
  licence_evidence_uri   text,
  status                 text NOT NULL DEFAULT 'pending_review'
                           CHECK (status IN ('pending_review', 'approved', 'rejected', 'retired')),
  review_notes           text,
  last_used_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audio_library_assets_category_matches_kind CHECK (
    (kind = 'music' AND category IN ('calm', 'emotional', 'sad', 'heartbreak', 'healing', 'hopeful', 'motivational',
                                     'cinematic', 'suspense', 'curiosity', 'confidence', 'reflective', 'ambient',
                                     'playful', 'lullaby', 'devotional'))
    OR (kind = 'sound_effect' AND category IN ('whoosh', 'soft_impact', 'cinematic_hit', 'transition', 'suspense',
                                               'footsteps', 'paper', 'clock', 'soft_texture', 'emotional_transition',
                                               'rain', 'wind', 'room_ambience', 'city_ambience', 'nature_ambience'))),
  CONSTRAINT audio_library_assets_approval_requires_rights CHECK (
    status <> 'approved' OR (
      commercial_use = 'allowed'
      AND monetized_social_use = 'allowed'
      AND modification = 'allowed'
      AND content_id_status = 'not_registered'
      AND cardinality(allowed_platforms) > 0
      AND licence_checked_on IS NOT NULL
      AND licence_evidence_uri IS NOT NULL
      AND (NOT attribution_required OR attribution_text IS NOT NULL)))
);
CREATE INDEX audio_library_assets_selection_idx ON audio_library_assets (kind, status, category);
CREATE TRIGGER audio_library_assets_updated_at BEFORE UPDATE ON audio_library_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audio_library_usages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_asset_id  uuid NOT NULL REFERENCES audio_library_assets (id) ON DELETE RESTRICT,
  brand_id        text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  video_id        uuid REFERENCES videos (id) ON DELETE SET NULL,
  role            text NOT NULL CHECK (role IN ('music', 'ambience', 'sound_effect')),
  platforms       text[] NOT NULL CHECK (platforms <@ ARRAY['instagram', 'facebook', 'youtube', 'x']::text[]),
  idempotency_key text NOT NULL UNIQUE,
  used_at         timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audio_library_usages_asset_idx ON audio_library_usages (audio_asset_id, used_at DESC);
CREATE INDEX audio_library_usages_brand_idx ON audio_library_usages (brand_id, used_at DESC);
CREATE INDEX audio_library_usages_video_idx ON audio_library_usages (video_id);
