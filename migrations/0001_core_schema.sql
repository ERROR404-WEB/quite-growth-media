-- 0001_core_schema.sql
-- Core schema for the nine-brand media platform.
-- Rules: every brand-scoped row carries brand_id; no API secrets are ever stored in the database
-- (social_accounts.credential_ref holds only the NAME of a secret kept in .env / a secret manager).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------
CREATE TABLE brands (
  id                 text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  brand_number       smallint NOT NULL UNIQUE CHECK (brand_number BETWEEN 1 AND 99),
  display_name       text NOT NULL,
  native_name        text,
  language           text NOT NULL CHECK (language IN ('en', 'hi', 'te')),
  locale             text NOT NULL,
  audience           text NOT NULL,
  niche              text NOT NULL CHECK (niche IN ('self_improvement', 'spirituality', 'hindu_devotional', 'kids')),
  age_min            smallint CHECK (age_min BETWEEN 0 AND 17),
  age_max            smallint CHECK (age_max BETWEEN 0 AND 17),
  made_for_kids      boolean NOT NULL DEFAULT false,
  daily_video_target smallint NOT NULL DEFAULT 3 CHECK (daily_video_target BETWEEN 0 AND 20),
  publish_timezone   text NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brands_age_range_valid CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max),
  CONSTRAINT brands_kids_need_age_range CHECK (niche <> 'kids' OR (age_min IS NOT NULL AND age_max IS NOT NULL AND made_for_kids))
);
CREATE TRIGGER brands_updated_at BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- social_accounts
-- ---------------------------------------------------------------------------
CREATE TABLE social_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  platform              text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'youtube', 'x')),
  handle                text,
  external_account_id   text,
  publishing_provider   text NOT NULL DEFAULT 'blotato' CHECK (publishing_provider IN ('blotato', 'official_api', 'manual')),
  provider_account_ref  text,
  credential_ref        text,
  status                text NOT NULL DEFAULT 'not_connected'
                          CHECK (status IN ('not_connected', 'pending', 'connected', 'disconnected', 'error')),
  made_for_kids_default boolean NOT NULL DEFAULT false,
  capabilities          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_accounts_brand_platform_unique UNIQUE (brand_id, platform),
  CONSTRAINT social_accounts_external_unique UNIQUE (platform, external_account_id)
);
CREATE TRIGGER social_accounts_updated_at BEFORE UPDATE ON social_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- content_ideas
-- ---------------------------------------------------------------------------
CREATE TABLE content_ideas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  language          text NOT NULL CHECK (language IN ('en', 'hi', 'te')),
  content_category  text NOT NULL,
  planned_for       date NOT NULL,
  slot              smallint NOT NULL CHECK (slot BETWEEN 1 AND 20),
  title             text NOT NULL,
  angle             text,
  summary           text,
  topic_tags        text[] NOT NULL DEFAULT '{}',
  age_min           smallint,
  age_max           smallint,
  duration_bucket   text CHECK (duration_bucket IN ('7-12', '13-20', '21-30', '31-45')),
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  research_notes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('proposed', 'selected', 'rejected', 'duplicate', 'used')),
  similarity_score  numeric(5, 4) CHECK (similarity_score BETWEEN 0 AND 1),
  duplicate_of_id   uuid REFERENCES content_ideas (id) ON DELETE SET NULL,
  fingerprint       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_ideas_brand_planned_idx ON content_ideas (brand_id, planned_for);
CREATE INDEX content_ideas_fingerprint_idx ON content_ideas (fingerprint);
-- Only one active idea per brand/day/slot.
CREATE UNIQUE INDEX content_ideas_active_slot_unique
  ON content_ideas (brand_id, planned_for, slot) WHERE status IN ('selected', 'used');
CREATE TRIGGER content_ideas_updated_at BEFORE UPDATE ON content_ideas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- scripts (versioned)
-- ---------------------------------------------------------------------------
CREATE TABLE scripts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id               text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  content_idea_id        uuid NOT NULL REFERENCES content_ideas (id) ON DELETE RESTRICT,
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  language               text NOT NULL CHECK (language IN ('en', 'hi', 'te')),
  content_category       text NOT NULL,
  title                  text NOT NULL,
  hook                   text,
  body                   text NOT NULL,
  word_count             integer CHECK (word_count >= 0),
  estimated_duration_sec numeric(6, 2) CHECK (estimated_duration_sec > 0),
  duration_bucket        text CHECK (duration_bucket IN ('7-12', '13-20', '21-30', '31-45')),
  source_references      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ book, chapter, verse, translation, quote_type: 'direct'|'paraphrase'|'interpretation', source_url }]
  scripture_references   jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_provider    text,
  generation_model       text,
  prompt_version         text,
  content_hash           text,
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'validating', 'validated', 'rejected', 'superseded')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scripts_idea_version_unique UNIQUE (content_idea_id, version)
);
CREATE INDEX scripts_brand_created_idx ON scripts (brand_id, created_at DESC);
CREATE INDEX scripts_content_hash_idx ON scripts (content_hash);
CREATE TRIGGER scripts_updated_at BEFORE UPDATE ON scripts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- video_scenes
-- ---------------------------------------------------------------------------
CREATE TABLE video_scenes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  script_id          uuid NOT NULL REFERENCES scripts (id) ON DELETE CASCADE,
  scene_index        smallint NOT NULL CHECK (scene_index >= 0),
  narration_text     text,
  on_screen_text     text,
  visual_description text NOT NULL,
  characters         jsonb NOT NULL DEFAULT '[]'::jsonb,
  art_direction      jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_sec       numeric(6, 2) CHECK (duration_sec > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_scenes_script_index_unique UNIQUE (script_id, scene_index)
);
CREATE INDEX video_scenes_brand_idx ON video_scenes (brand_id);
CREATE TRIGGER video_scenes_updated_at BEFORE UPDATE ON video_scenes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------
CREATE TABLE videos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id               text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  script_id              uuid NOT NULL REFERENCES scripts (id) ON DELETE RESTRICT,
  content_idea_id        uuid NOT NULL REFERENCES content_ideas (id) ON DELETE RESTRICT,
  language               text NOT NULL CHECK (language IN ('en', 'hi', 'te')),
  content_category       text NOT NULL,
  title                  text,
  description            text,
  hashtags               text[] NOT NULL DEFAULT '{}',
  duration_sec           numeric(6, 2) CHECK (duration_sec > 0),
  duration_bucket        text CHECK (duration_bucket IN ('7-12', '13-20', '21-30', '31-45')),
  width                  integer CHECK (width > 0),
  height                 integer CHECK (height > 0),
  storage_uri            text,
  checksum_sha256        text,
  made_for_kids          boolean NOT NULL DEFAULT false,
  ai_disclosure_required boolean NOT NULL DEFAULT true,
  render_status          text NOT NULL DEFAULT 'pending'
                           CHECK (render_status IN ('pending', 'rendering', 'rendered', 'failed')),
  qa_status              text NOT NULL DEFAULT 'pending'
                           CHECK (qa_status IN ('pending', 'passed', 'failed', 'quarantined')),
  render_attempts        integer NOT NULL DEFAULT 0 CHECK (render_attempts >= 0),
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT videos_script_unique UNIQUE (script_id)
);
CREATE INDEX videos_brand_created_idx ON videos (brand_id, created_at DESC);
CREATE INDEX videos_status_idx ON videos (render_status, qa_status);
CREATE UNIQUE INDEX videos_checksum_unique ON videos (checksum_sha256) WHERE checksum_sha256 IS NOT NULL;
CREATE TRIGGER videos_updated_at BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- assets (+ provenance) and asset_licences
-- ---------------------------------------------------------------------------
CREATE TABLE assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  kind                text NOT NULL
                        CHECK (kind IN ('illustration', 'voiceover', 'music', 'sound_effect', 'subtitle', 'video', 'thumbnail', 'other')),
  script_id           uuid REFERENCES scripts (id) ON DELETE SET NULL,
  scene_id            uuid REFERENCES video_scenes (id) ON DELETE SET NULL,
  video_id            uuid REFERENCES videos (id) ON DELETE SET NULL,
  storage_uri         text NOT NULL,
  mime_type           text,
  checksum_sha256     text,
  bytes               bigint CHECK (bytes >= 0),
  width               integer,
  height              integer,
  duration_sec        numeric(8, 3),
  generation_provider text,
  generation_model    text,
  provider_request_id text,
  prompt              text,
  provenance          jsonb NOT NULL DEFAULT '{}'::jsonb,
  licence_status      text NOT NULL DEFAULT 'pending_review'
                        CHECK (licence_status IN ('original_generated', 'licensed', 'public_domain', 'pending_review', 'rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_brand_kind_idx ON assets (brand_id, kind);
CREATE INDEX assets_checksum_idx ON assets (checksum_sha256);
CREATE INDEX assets_scene_idx ON assets (scene_id);
CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE asset_licences (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id               text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  asset_id               uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  -- Which right this record covers. Nursery rhymes need lyrics/composition/recording/arrangement tracked separately.
  rights_component       text NOT NULL
                           CHECK (rights_component IN ('full', 'lyrics', 'composition', 'recording', 'arrangement', 'illustration', 'voice', 'character')),
  licence_type           text NOT NULL
                           CHECK (licence_type IN ('provider_terms', 'royalty_free', 'cc0', 'cc_by', 'public_domain', 'custom', 'original_work')),
  licensor               text,
  licence_url            text,
  terms_summary          text,
  commercial_use_allowed boolean NOT NULL,
  attribution_required   boolean NOT NULL DEFAULT false,
  attribution_text       text,
  origin_notes           text,
  evidence_uri           text,
  valid_from             date,
  valid_until            date,
  verified_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_licences_component_unique UNIQUE (asset_id, rights_component),
  CONSTRAINT asset_licences_validity CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_from <= valid_until)
);
CREATE INDEX asset_licences_brand_idx ON asset_licences (brand_id);
CREATE TRIGGER asset_licences_updated_at BEFORE UPDATE ON asset_licences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- generation_jobs (durable job queue: idempotency, bounded retries, quarantine)
-- ---------------------------------------------------------------------------
CREATE TABLE generation_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            text REFERENCES brands (id) ON DELETE RESTRICT,
  job_type            text NOT NULL,
  idempotency_key     text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'running', 'succeeded', 'quarantined', 'cancelled')),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  run_at              timestamptz NOT NULL DEFAULT now(),
  locked_at           timestamptz,
  locked_by           text,
  last_error          text,
  error_history       jsonb NOT NULL DEFAULT '[]'::jsonb,
  result              jsonb,
  parent_job_id       uuid REFERENCES generation_jobs (id) ON DELETE SET NULL,
  related_entity_type text,
  related_entity_id   uuid,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generation_jobs_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT generation_jobs_attempts_bounded CHECK (attempts <= max_attempts)
);
CREATE INDEX generation_jobs_ready_idx ON generation_jobs (run_at, created_at) WHERE status = 'queued';
CREATE INDEX generation_jobs_brand_status_idx ON generation_jobs (brand_id, status);
CREATE INDEX generation_jobs_type_status_idx ON generation_jobs (job_type, status);
CREATE TRIGGER generation_jobs_updated_at BEFORE UPDATE ON generation_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- publications
-- ---------------------------------------------------------------------------
CREATE TABLE publications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  video_id            uuid NOT NULL REFERENCES videos (id) ON DELETE RESTRICT,
  social_account_id   uuid NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  platform            text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'youtube', 'x')),
  publishing_provider text NOT NULL CHECK (publishing_provider IN ('blotato', 'official_api', 'manual')),
  idempotency_key     text NOT NULL,
  status              text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'publishing', 'published', 'failed', 'skipped', 'removed')),
  scheduled_for       timestamptz,
  published_at        timestamptz,
  external_post_id    text,
  external_url        text,
  made_for_kids       boolean NOT NULL DEFAULT false,
  ai_disclosure       boolean NOT NULL DEFAULT true,
  platform_metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publications_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT publications_video_account_unique UNIQUE (video_id, social_account_id)
);
CREATE INDEX publications_brand_status_idx ON publications (brand_id, status);
CREATE INDEX publications_scheduled_idx ON publications (scheduled_for) WHERE status = 'scheduled';
CREATE TRIGGER publications_updated_at BEFORE UPDATE ON publications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- analytics (snapshots at ~24h / 72h / 7d)
-- ---------------------------------------------------------------------------
CREATE TABLE analytics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  publication_id        uuid NOT NULL REFERENCES publications (id) ON DELETE CASCADE,
  platform              text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'youtube', 'x')),
  snapshot_label        text NOT NULL CHECK (snapshot_label IN ('24h', '72h', '7d', 'adhoc')),
  collected_at          timestamptz NOT NULL DEFAULT now(),
  views                 bigint CHECK (views >= 0),
  watch_time_seconds    numeric(14, 2) CHECK (watch_time_seconds >= 0),
  avg_view_duration_sec numeric(8, 2),
  avg_percentage_viewed numeric(6, 3),
  completion_rate       numeric(6, 5) CHECK (completion_rate BETWEEN 0 AND 1),
  likes                 bigint CHECK (likes >= 0),
  comments              bigint CHECK (comments >= 0),
  shares                bigint CHECK (shares >= 0),
  saves                 bigint CHECK (saves >= 0),
  follows               bigint CHECK (follows >= 0),
  raw                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT analytics_snapshot_unique UNIQUE (publication_id, snapshot_label)
);
CREATE INDEX analytics_brand_collected_idx ON analytics (brand_id, collected_at DESC);

-- ---------------------------------------------------------------------------
-- experiments
-- ---------------------------------------------------------------------------
CREATE TABLE experiments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  name        text NOT NULL,
  hypothesis  text,
  variable    text NOT NULL,
  variants    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'cancelled')),
  started_at  timestamptz,
  ended_at    timestamptz,
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiments_brand_name_unique UNIQUE (brand_id, name)
);
CREATE TRIGGER experiments_updated_at BEFORE UPDATE ON experiments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- cost_records / revenue_records
-- ---------------------------------------------------------------------------
CREATE TABLE cost_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  category    text NOT NULL
                CHECK (category IN ('research', 'script', 'validation', 'illustration', 'voiceover', 'subtitle',
                                    'render', 'storage', 'publishing', 'analytics', 'infrastructure', 'other')),
  provider    text NOT NULL,
  units       numeric(14, 4),
  unit_type   text,
  amount      numeric(14, 6) NOT NULL CHECK (amount >= 0),
  currency    char(3) NOT NULL DEFAULT 'USD',
  content_idea_id uuid REFERENCES content_ideas (id) ON DELETE SET NULL,
  script_id   uuid REFERENCES scripts (id) ON DELETE SET NULL,
  asset_id    uuid REFERENCES assets (id) ON DELETE SET NULL,
  video_id    uuid REFERENCES videos (id) ON DELETE SET NULL,
  job_id      uuid REFERENCES generation_jobs (id) ON DELETE SET NULL,
  incurred_at timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX cost_records_brand_incurred_idx ON cost_records (brand_id, incurred_at DESC);
CREATE INDEX cost_records_video_idx ON cost_records (video_id);

CREATE TABLE revenue_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  source             text NOT NULL
                       CHECK (source IN ('youtube', 'facebook', 'instagram', 'x', 'affiliate', 'sponsorship',
                                         'digital_product', 'ebook', 'other')),
  publication_id     uuid REFERENCES publications (id) ON DELETE SET NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  amount             numeric(14, 4) NOT NULL,
  currency           char(3) NOT NULL DEFAULT 'USD',
  external_reference text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_records_period_valid CHECK (period_start <= period_end),
  CONSTRAINT revenue_records_unique UNIQUE NULLS NOT DISTINCT (brand_id, source, period_start, period_end, external_reference)
);
CREATE INDEX revenue_records_brand_period_idx ON revenue_records (brand_id, period_start);

-- ---------------------------------------------------------------------------
-- compliance_results (every automated QA / safety / originality check)
-- ---------------------------------------------------------------------------
CREATE TABLE compliance_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  entity_type     text NOT NULL
                    CHECK (entity_type IN ('content_idea', 'script', 'video_scene', 'asset', 'video', 'publication')),
  entity_id       uuid NOT NULL,
  check_type      text NOT NULL
                    CHECK (check_type IN ('originality', 'language', 'grammar', 'brand_relevance', 'fact', 'scripture',
                                          'child_safety', 'visual', 'audio', 'subtitle', 'video_integrity', 'licence',
                                          'platform_policy')),
  status          text NOT NULL CHECK (status IN ('passed', 'failed', 'warning', 'error')),
  score           numeric(6, 4),
  checker         text NOT NULL,
  checker_version text,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_results_entity_idx ON compliance_results (entity_type, entity_id);
CREATE INDEX compliance_results_brand_check_idx ON compliance_results (brand_id, check_type, status);
