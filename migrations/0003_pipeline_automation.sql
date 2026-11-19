-- 0003_pipeline_automation.sql
-- Database-backed production and publishing (content.plan → storyboard.generate → script.generate →
-- video.render → video.publish). See docs/publishing.md ("Full automation").

-- ---------------------------------------------------------------------------
-- scripts: the full validated generator output (idea, metadata, sound design, safety notes)
-- ---------------------------------------------------------------------------
ALTER TABLE scripts ADD COLUMN generation_output jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- videos: one row per platform version of a script. The cross-platform version is 'main'; a
-- platform-restricted licensed track (e.g. YouTube-only music with a credit) gets its own version.
-- ---------------------------------------------------------------------------
ALTER TABLE videos DROP CONSTRAINT videos_script_unique;
ALTER TABLE videos
  ADD COLUMN variant text NOT NULL DEFAULT 'main' CHECK (variant ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD COLUMN platforms text[] NOT NULL DEFAULT '{}'
    CHECK (platforms <@ ARRAY['instagram', 'facebook', 'youtube', 'x']::text[]),
  -- Public URL of the file after the one upload to the publishing provider (reused by every platform).
  ADD COLUMN provider_media_url text,
  ADD CONSTRAINT videos_script_variant_unique UNIQUE (script_id, variant);
CREATE INDEX videos_content_idea_idx ON videos (content_idea_id);

-- ---------------------------------------------------------------------------
-- publications: at-most-once ledger for the publishing provider.
--   publishing + submission_id NULL  = the one-shot create call may have been sent (ambiguous)
--   needs_check                      = an operator must look in the provider dashboard before any retry
-- ---------------------------------------------------------------------------
ALTER TABLE publications DROP CONSTRAINT publications_status_check;
ALTER TABLE publications
  ADD CONSTRAINT publications_status_check
    CHECK (status IN ('scheduled', 'publishing', 'published', 'failed', 'skipped', 'removed', 'needs_check')),
  ADD COLUMN submission_id text;
CREATE INDEX publications_video_idx ON publications (video_id);
CREATE INDEX publications_social_account_idx ON publications (social_account_id);

-- ---------------------------------------------------------------------------
-- cost_records: daily spend cap sums today's rows.
-- ---------------------------------------------------------------------------
CREATE INDEX cost_records_incurred_idx ON cost_records (incurred_at);
CREATE INDEX cost_records_job_idx ON cost_records (job_id);
