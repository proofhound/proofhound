-- Run-result large-payload storage tiering (SPEC 30 §9).
-- All additive + nullable: a NULL payload_ref means the row is still fully inline (existing rows,
-- or a deployment with no ObjectStorageProvider configured), so this is backward-compatible and
-- needs no backfill. run_results is partitioned by created_at; ADD COLUMN / DROP NOT NULL on the
-- partitioned parent are metadata-only and propagate to every partition.
ALTER TABLE "ph_runs"."run_results" ALTER COLUMN "rendered_prompt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD COLUMN "payload_ref" jsonb;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD COLUMN "compaction_generation" integer;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD COLUMN "input_preview" text;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD COLUMN "output_preview" text;
