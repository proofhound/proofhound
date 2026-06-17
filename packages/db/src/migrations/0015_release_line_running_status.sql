ALTER TABLE "ph_releases"."release_lines" DROP CONSTRAINT IF EXISTS "release_lines_status_check";--> statement-breakpoint
ALTER TABLE "ph_releases"."release_lines" ALTER COLUMN "status" SET DEFAULT 'running';--> statement-breakpoint
UPDATE "ph_releases"."release_lines"
SET "status" = 'running'
WHERE "status" IN ('canary', 'production', 'production_with_canary');--> statement-breakpoint
ALTER TABLE "ph_releases"."release_lines"
  ADD CONSTRAINT "release_lines_status_check"
  CHECK ("status" IN ('running', 'stopped', 'archived'));--> statement-breakpoint
