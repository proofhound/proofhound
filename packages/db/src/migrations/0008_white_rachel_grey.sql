ALTER TABLE "ph_releases"."production_release_events" DROP CONSTRAINT "production_release_events_source_experiment_required";--> statement-breakpoint
ALTER TABLE "ph_assets"."datasets" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "ph_assets"."datasets" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."prompts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "ph_assets"."prompts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."datasets" ADD CONSTRAINT "datasets_status_check" CHECK ("status" IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "ph_assets"."prompts" ADD CONSTRAINT "prompts_status_check" CHECK ("status" IN ('active', 'archived'));
