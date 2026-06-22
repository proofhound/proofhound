UPDATE "ph_runs"."experiments"
SET
  "status" = CASE WHEN "status" = 'cancelled' THEN 'stopped' ELSE "status" END,
  "control_state" = CASE
    WHEN "control_state" = 'cancel' AND "status" = 'running' THEN 'stop'
    WHEN "control_state" = 'cancel' THEN NULL
    ELSE "control_state"
  END,
  "finished_at" = CASE
    WHEN "status" = 'cancelled' AND "finished_at" IS NULL THEN NOW()
    ELSE "finished_at"
  END,
  "updated_at" = NOW()
WHERE "status" = 'cancelled'
   OR "control_state" = 'cancel';--> statement-breakpoint

ALTER TABLE "ph_runs"."experiments"
  DROP CONSTRAINT IF EXISTS "experiments_status_check";--> statement-breakpoint
ALTER TABLE "ph_runs"."experiments"
  DROP CONSTRAINT IF EXISTS "experiments_control_state_check";--> statement-breakpoint
ALTER TABLE "ph_runs"."experiments"
  ADD CONSTRAINT "experiments_status_check"
  CHECK ("status" IN ('running', 'success', 'failed', 'stopped'));--> statement-breakpoint
ALTER TABLE "ph_runs"."experiments"
  ADD CONSTRAINT "experiments_control_state_check"
  CHECK ("control_state" IN ('stop', 'resume') OR "control_state" IS NULL);
