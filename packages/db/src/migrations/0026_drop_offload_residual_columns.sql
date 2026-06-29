-- Drop object-storage / payload-tiering / raw-import residual columns.
-- OSS stores datasets and run results fully inline in PostgreSQL with no payload-read seam
-- (SPEC 04 §4, 06 §4.3.1 / §5, 22 §7, 30 §9; the 08 §3.14 reader extension point is removed).
-- These were reserved dormant slots only an external offload consumer would have written; OSS never
-- did, so they are dropped. The big inline fields go back to NOT NULL to match the inline-only
-- contract — OSS writers always populate them and offload never ran in the OSS trunk, so no row is NULL.

-- 1. run_results: drop tiering pointer / generation guard / list-preview columns; restore rendered_prompt NOT NULL.
ALTER TABLE "ph_runs"."run_results" DROP COLUMN IF EXISTS "payload_ref";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP COLUMN IF EXISTS "compaction_generation";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP COLUMN IF EXISTS "input_preview";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP COLUMN IF EXISTS "output_preview";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ALTER COLUMN "rendered_prompt" SET NOT NULL;--> statement-breakpoint

-- 2. dataset_samples: drop payload pointer + queryable projection + their indexes; restore data NOT NULL.
DROP INDEX IF EXISTS "ph_assets"."idx_dataset_samples_expected";--> statement-breakpoint
DROP INDEX IF EXISTS "ph_assets"."idx_dataset_samples_label";--> statement-breakpoint
DROP INDEX IF EXISTS "ph_assets"."idx_dataset_samples_category";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" DROP COLUMN IF EXISTS "payload_ref";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" DROP COLUMN IF EXISTS "search_preview";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" DROP COLUMN IF EXISTS "expected_output_scalar";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" DROP COLUMN IF EXISTS "label_scalar";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" DROP COLUMN IF EXISTS "category_scalar";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" DROP COLUMN IF EXISTS "index_values";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ALTER COLUMN "data" SET NOT NULL;--> statement-breakpoint

-- 3. dataset_imports: drop raw-object / async-importer columns + job_id index; narrow the status check.
DROP INDEX IF EXISTS "ph_assets"."idx_dataset_imports_job_id";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP CONSTRAINT IF EXISTS "dataset_imports_import_mode_check";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP CONSTRAINT IF EXISTS "dataset_imports_status_check";--> statement-breakpoint
-- Any in-flight raw / async session cannot resume after this migration; keep the row for readable
-- status but mark it aborted before narrowing the status check so the new constraint validates.
UPDATE "ph_assets"."dataset_imports"
SET
  "status" = 'aborted',
  "error_code" = COALESCE("error_code", 'dataset_import_raw_removed'),
  "error_message" = COALESCE("error_message", 'Raw / async dataset import sessions are no longer supported in OSS.'),
  "aborted_at" = COALESCE("aborted_at", now()),
  "updated_at" = now()
WHERE "status" IN ('uploading', 'uploaded', 'queued', 'parsing');--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "import_mode";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_upload_session_id";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_upload_expires_at";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_upload_completed_at";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "raw_object_ref";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP COLUMN IF EXISTS "job_id";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD CONSTRAINT "dataset_imports_status_check" CHECK ("status" IN ('created', 'importing', 'completed', 'failed', 'aborted'));
