-- Restore raw object-backed dataset imports after the batch-only compatibility migration,
-- and persist visible server-side import progress for the upload page.
ALTER TABLE "ph_assets"."dataset_imports"
  DROP CONSTRAINT IF EXISTS "dataset_imports_status_check";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  DROP CONSTRAINT IF EXISTS "dataset_imports_import_mode_check";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ALTER COLUMN "status" SET DEFAULT 'created';--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "import_mode" text NOT NULL DEFAULT 'batch';--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "raw_upload_session_id" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "raw_upload_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "raw_upload_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "raw_object_ref" jsonb;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "job_id" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD COLUMN IF NOT EXISTS "progress" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD CONSTRAINT "dataset_imports_import_mode_check"
  CHECK ("import_mode" IN ('batch', 'raw_object'));--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports"
  ADD CONSTRAINT "dataset_imports_status_check"
  CHECK ("status" IN ('created', 'uploading', 'uploaded', 'queued', 'parsing', 'importing', 'completed', 'failed', 'aborted'));--> statement-breakpoint
DROP INDEX IF EXISTS "ph_assets"."idx_dataset_imports_stale";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dataset_imports_stale"
  ON "ph_assets"."dataset_imports" USING btree ("status", "updated_at")
  WHERE "status" = 'importing';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dataset_imports_job_id"
  ON "ph_assets"."dataset_imports" USING btree ("job_id")
  WHERE "job_id" IS NOT NULL;
