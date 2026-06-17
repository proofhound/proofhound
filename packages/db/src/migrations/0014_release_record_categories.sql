ALTER TABLE "ph_releases"."release_line_events" DROP CONSTRAINT IF EXISTS "release_line_events_record_mode_check";
ALTER TABLE "ph_releases"."release_line_events"
  ADD COLUMN IF NOT EXISTS "record_categories" text[] DEFAULT ARRAY[]::text[] NOT NULL;
ALTER TABLE "ph_releases"."release_line_events"
  ADD CONSTRAINT "release_line_events_record_mode_check"
  CHECK ("record_mode" IN ('all', 'selected_categories', 'correct_only'));

ALTER TABLE "ph_releases"."canary_releases" DROP CONSTRAINT IF EXISTS "canary_releases_record_mode_check";
ALTER TABLE "ph_releases"."canary_releases"
  ADD COLUMN IF NOT EXISTS "record_categories" text[] DEFAULT ARRAY[]::text[] NOT NULL;
ALTER TABLE "ph_releases"."canary_releases"
  ADD CONSTRAINT "canary_releases_record_mode_check"
  CHECK ("record_mode" IN ('all', 'selected_categories', 'correct_only'));

ALTER TABLE "ph_releases"."production_release_events" DROP CONSTRAINT IF EXISTS "production_release_events_record_mode_check";
ALTER TABLE "ph_releases"."production_release_events"
  ADD COLUMN IF NOT EXISTS "record_categories" text[] DEFAULT ARRAY[]::text[] NOT NULL;
ALTER TABLE "ph_releases"."production_release_events"
  ADD CONSTRAINT "production_release_events_record_mode_check"
  CHECK ("record_mode" IN ('all', 'selected_categories', 'correct_only'));
