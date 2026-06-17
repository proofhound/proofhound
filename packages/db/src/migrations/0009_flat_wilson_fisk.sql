ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_status_check";--> statement-breakpoint
UPDATE "ph_runs"."run_results"
SET "status" = 'failed'
WHERE "status" NOT IN ('running', 'success', 'failed');--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD CONSTRAINT "run_results_status_check" CHECK ("status" IN ('running', 'success', 'failed'));
