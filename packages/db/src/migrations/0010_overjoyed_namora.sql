ALTER TABLE "ph_releases"."release_variants" RENAME TO "release_versions";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" RENAME COLUMN "release_variant_id" TO "release_version_id";--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" RENAME COLUMN "release_variant_id" TO "release_version_id";--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" RENAME COLUMN "variant_number" TO "production_version_number";--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" RENAME COLUMN "release_variant_id" TO "release_version_id";--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" DROP CONSTRAINT "release_variants_number_positive_check";--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" DROP CONSTRAINT "annotation_tasks_scope_target_consistent";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_release_variant_id_release_variants_id_fk";
--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" DROP CONSTRAINT "release_line_events_release_variant_id_release_variants_id_fk";
--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" DROP CONSTRAINT "release_variants_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" DROP CONSTRAINT "release_variants_release_line_id_release_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" DROP CONSTRAINT "release_variants_model_id_models_id_fk";
--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" DROP CONSTRAINT "annotation_tasks_release_variant_id_release_variants_id_fk";
--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_release_variant_time";--> statement-breakpoint
DROP INDEX "ph_releases"."idx_release_line_events_variant";--> statement-breakpoint
DROP INDEX "ph_releases"."uniq_release_variants_line_number";--> statement-breakpoint
DROP INDEX "ph_releases"."uniq_release_variants_line_prompt_model";--> statement-breakpoint
DROP INDEX "ph_releases"."idx_release_variants_project_line";--> statement-breakpoint
DROP INDEX "ph_releases"."idx_release_variants_project_prompt_model";--> statement-breakpoint
DROP INDEX "ph_releases"."idx_annotation_tasks_release_variant";--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD COLUMN "target_production_version_number" integer;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD COLUMN "candidate_number" integer;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD COLUMN "promoted_from_release_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD COLUMN "release_version_scope" text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
UPDATE "ph_releases"."release_versions"
SET
  "kind" = 'production',
  "target_production_version_number" = "production_version_number",
  "candidate_number" = NULL
WHERE "kind" IS NULL;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ALTER COLUMN "target_production_version_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD CONSTRAINT "run_results_release_version_id_release_versions_id_fk" FOREIGN KEY ("release_version_id") REFERENCES "ph_releases"."release_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_release_version_id_release_versions_id_fk" FOREIGN KEY ("release_version_id") REFERENCES "ph_releases"."release_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_release_line_id_release_lines_id_fk" FOREIGN KEY ("release_line_id") REFERENCES "ph_releases"."release_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_promoted_from_release_version_id_release_versions_id_fk" FOREIGN KEY ("promoted_from_release_version_id") REFERENCES "ph_releases"."release_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_release_version_id_release_versions_id_fk" FOREIGN KEY ("release_version_id") REFERENCES "ph_releases"."release_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_run_results_release_version_time" ON "ph_runs"."run_results" USING btree ("project_id","release_version_id","created_at" DESC NULLS LAST) WHERE "release_version_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_release_line_events_version" ON "ph_releases"."release_line_events" USING btree ("release_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_release_versions_line_production_number" ON "ph_releases"."release_versions" USING btree ("release_line_id","production_version_number") WHERE "kind" = 'production';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_release_versions_line_candidate_number" ON "ph_releases"."release_versions" USING btree ("release_line_id","target_production_version_number","candidate_number") WHERE "kind" = 'candidate';--> statement-breakpoint
CREATE INDEX "idx_release_versions_project_line" ON "ph_releases"."release_versions" USING btree ("project_id","release_line_id");--> statement-breakpoint
CREATE INDEX "idx_release_versions_project_prompt_model" ON "ph_releases"."release_versions" USING btree ("project_id","prompt_version_id","model_id");--> statement-breakpoint
CREATE INDEX "idx_release_versions_target" ON "ph_releases"."release_versions" USING btree ("release_line_id","target_production_version_number","kind");--> statement-breakpoint
CREATE INDEX "idx_annotation_tasks_release_version" ON "ph_releases"."annotation_tasks" USING btree ("release_version_id");--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_kind_check" CHECK ("kind" IN ('candidate', 'production'));--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_target_positive_check" CHECK ("target_production_version_number" > 0);--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_production_number_positive_check" CHECK ("production_version_number" IS NULL OR "production_version_number" > 0);--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_candidate_number_positive_check" CHECK ("candidate_number" IS NULL OR "candidate_number" > 0);--> statement-breakpoint
ALTER TABLE "ph_releases"."release_versions" ADD CONSTRAINT "release_versions_shape_check" CHECK ((
        "kind" = 'production'
        AND "production_version_number" IS NOT NULL
        AND "candidate_number" IS NULL
        AND "target_production_version_number" = "production_version_number"
      ) OR (
        "kind" = 'candidate'
        AND "production_version_number" IS NULL
        AND "candidate_number" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_release_version_scope_check" CHECK ("release_version_scope" IN ('exact', 'journey'));--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_scope_target_consistent" CHECK (("scope" = 'canary' AND "production_release_event_id" IS NULL AND ("release_version_id" IS NOT NULL OR "release_line_event_id" IS NOT NULL OR "canary_id" IS NOT NULL))
        OR ("scope" = 'online' AND "canary_id" IS NULL AND ("release_version_id" IS NOT NULL OR "release_line_event_id" IS NOT NULL OR "production_release_event_id" IS NOT NULL)));
