-- Dataset-sample large-payload storage tiering (SPEC 22 §X / SPEC 30 §9 mirror).
-- Additive + nullable: a NULL payload_ref means the row is still fully inline (existing rows, or a
-- deployment with no object storage), so this is backward-compatible and needs no backfill. The full
-- `data` becomes a droppable inline cache; the queryable projection (preview + role scalars +
-- index_values + pointer) keeps list / search / distribution in SQL with no shard read.
ALTER TABLE "ph_assets"."dataset_samples" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ADD COLUMN "payload_ref" jsonb;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ADD COLUMN "search_preview" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ADD COLUMN "expected_output_scalar" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ADD COLUMN "label_scalar" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ADD COLUMN "category_scalar" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ADD COLUMN "index_values" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dataset_samples_expected" ON "ph_assets"."dataset_samples" USING btree ("dataset_id","expected_output_scalar") WHERE "expected_output_scalar" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dataset_samples_label" ON "ph_assets"."dataset_samples" USING btree ("dataset_id","label_scalar") WHERE "label_scalar" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dataset_samples_category" ON "ph_assets"."dataset_samples" USING btree ("dataset_id","category_scalar") WHERE "category_scalar" IS NOT NULL;
