ALTER TABLE "ph_runs"."optimizations"
  ADD COLUMN IF NOT EXISTS "objective_status" text NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations"
  ADD COLUMN IF NOT EXISTS "stop_after_no_improvement_rounds" integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE "ph_runs"."optimizations"
SET "objective_status" = CASE
  WHEN "summary"->>'reason' = 'goals_met' THEN 'met'
  WHEN "summary"->>'reason' IN ('max_rounds', 'no_improvement', 'control_stop', 'control_cancel') THEN 'not_met'
  WHEN "status" IN ('stopped', 'cancelled') THEN 'not_met'
  WHEN "status" = 'running' THEN 'pending'
  WHEN "status" = 'failed' THEN 'unknown'
  ELSE 'unknown'
END;--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations"
  DROP CONSTRAINT IF EXISTS "optimizations_objective_status_check";--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations"
  DROP CONSTRAINT IF EXISTS "optimizations_stop_after_no_improvement_rounds_check";--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations"
  ADD CONSTRAINT "optimizations_objective_status_check"
  CHECK ("objective_status" IN ('pending', 'met', 'not_met', 'unknown'));--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations"
  ADD CONSTRAINT "optimizations_stop_after_no_improvement_rounds_check"
  CHECK ("stop_after_no_improvement_rounds" >= 0 AND "stop_after_no_improvement_rounds" <= 20);
