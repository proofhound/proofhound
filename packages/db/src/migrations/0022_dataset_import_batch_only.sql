-- Dataset import sessions are now client-driven batches only.
-- Any in-flight raw-object states cannot be resumed after this migration, so keep their rows for
-- readable status but mark them aborted before narrowing the status check.
DROP INDEX IF EXISTS "ph_assets"."idx_dataset_imports_job_id";--> statement-breakpoint
DROP INDEX IF EXISTS "ph_assets"."idx_dataset_imports_stale";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP CONSTRAINT IF EXISTS "dataset_imports_import_mode_check";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP CONSTRAINT IF EXISTS "dataset_imports_status_check";--> statement-breakpoint
UPDATE "ph_assets"."dataset_imports"
SET
  "status" = 'aborted',
  "error_code" = COALESCE("error_code", 'dataset_import_raw_removed'),
  "error_message" = COALESCE("error_message", 'Raw dataset import sessions are no longer supported in OSS.'),
  "aborted_at" = COALESCE("aborted_at", now()),
  "updated_at" = now()
WHERE "status" IN ('created', 'uploaded', 'queued', 'parsing');--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ALTER COLUMN "status" SET DEFAULT 'uploading';--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD CONSTRAINT "dataset_imports_status_check" CHECK ("status" IN ('uploading', 'importing', 'completed', 'failed', 'aborted'));--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "import_mode";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_upload_session_id";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_upload_expires_at";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_upload_completed_at";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_object_ref";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "job_id";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "queued_at";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "started_at";--> statement-breakpoint
CREATE INDEX "idx_dataset_imports_stale" ON "ph_assets"."dataset_imports" USING btree ("status","updated_at") WHERE "status" IN ('uploading', 'importing');
