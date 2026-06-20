-- Raw object-backed dataset import sessions.
-- Additive + nullable: existing client-streamed imports remain import_mode='batch'. Raw object fields
-- are temporary transfer metadata used only while status='importing'.
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN "import_mode" text DEFAULT 'batch' NOT NULL;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN "raw_upload_session_id" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN "raw_upload_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN "raw_object_ref" jsonb;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD CONSTRAINT "dataset_imports_import_mode_check" CHECK ("ph_assets"."dataset_imports"."import_mode" IN ('batch', 'raw_object'));
