ALTER TABLE "ph_releases"."annotation_tasks" DROP CONSTRAINT IF EXISTS "annotation_tasks_scope_target_consistent";--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" DROP CONSTRAINT IF EXISTS "annotation_tasks_scope_check";--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_scope_check" CHECK ("scope" IN ('all', 'canary', 'online'));--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_scope_target_consistent" CHECK (("scope" = 'all' AND "release_version_id" IS NOT NULL AND "canary_id" IS NULL AND "production_release_event_id" IS NULL)
        OR ("scope" = 'canary' AND "production_release_event_id" IS NULL AND ("release_version_id" IS NOT NULL OR "release_line_event_id" IS NOT NULL OR "canary_id" IS NOT NULL))
        OR ("scope" = 'online' AND "canary_id" IS NULL AND ("release_version_id" IS NOT NULL OR "release_line_event_id" IS NOT NULL OR "production_release_event_id" IS NOT NULL)));--> statement-breakpoint
