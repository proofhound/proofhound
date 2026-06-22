-- Persist visible server-side import progress for the upload page.
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "progress" jsonb NOT NULL DEFAULT '{}'::jsonb;
