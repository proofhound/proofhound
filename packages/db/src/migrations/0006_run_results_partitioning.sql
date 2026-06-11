DROP INDEX "ph_runs"."idx_run_results_prompt_version";--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_webhook_token";--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_project_source_time";--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_release_variant_time";--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_external_id";--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_dbos";--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_bullmq_job";--> statement-breakpoint
DROP INDEX "ph_runs"."idx_run_results_id_lookup";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_webhook_token_id_tokens_id_fk";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_release_variant_id_release_variants_id_fk";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_status_check";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_judgment_status_check";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_source_check";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" DROP CONSTRAINT "run_results_pkey";--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" RENAME TO "run_results_legacy";--> statement-breakpoint
CREATE TABLE "ph_runs"."run_results" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid NOT NULL,
	"release_variant_id" uuid,
	"prompt_version_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"sample_id" uuid,
	"external_id" text,
	"round_index" integer,
	"rendered_prompt" jsonb NOT NULL,
	"input_variables" jsonb,
	"raw_response" text,
	"parsed_output" jsonb,
	"decision_output" text,
	"expected_output" text,
	"is_correct" boolean,
	"judgment_status" text,
	"status" text NOT NULL,
	"error_class" text,
	"error_message" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_estimate" numeric(12, 6),
	"attempt" integer DEFAULT 1 NOT NULL,
	"dbos_workflow_id" text,
	"bullmq_job_id" text,
	"webhook_token_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_results_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "run_results_source_check" CHECK ("source" IN ('experiment', 'optimization_analysis', 'optimization_generate', 'release', 'canary', 'online')),
	CONSTRAINT "run_results_judgment_status_check" CHECK ("judgment_status" IN ('correct', 'incorrect', 'parse_error', 'judge_error') OR "judgment_status" IS NULL),
	CONSTRAINT "run_results_status_check" CHECK ("status" IN ('success', 'error', 'timeout', 'rate_limited'))
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD CONSTRAINT "run_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD CONSTRAINT "run_results_release_variant_id_release_variants_id_fk" FOREIGN KEY ("release_variant_id") REFERENCES "ph_releases"."release_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD CONSTRAINT "run_results_webhook_token_id_tokens_id_fk" FOREIGN KEY ("webhook_token_id") REFERENCES "ph_core"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DO $$
DECLARE
	partition_month timestamp with time zone;
	start_month timestamp with time zone;
	end_month timestamp with time zone;
	partition_name text;
BEGIN
	PERFORM set_config('TimeZone', 'UTC', true);

	SELECT date_trunc('month', COALESCE(min("created_at"), now()))
	INTO start_month
	FROM "ph_runs"."run_results_legacy";

	IF start_month > date_trunc('month', now()) THEN
		start_month := date_trunc('month', now());
	END IF;

	end_month := date_trunc('month', now()) + interval '12 months';
	partition_month := start_month;

	WHILE partition_month <= end_month LOOP
		partition_name := format('run_results_%s', to_char(partition_month, 'YYYY_MM'));

		EXECUTE format(
			'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
			'ph_runs',
			partition_name,
			'ph_runs',
			'run_results',
			partition_month,
			partition_month + interval '1 month'
		);

		partition_month := partition_month + interval '1 month';
	END LOOP;
END $$;--> statement-breakpoint
CREATE TABLE "ph_runs"."run_results_default" PARTITION OF "ph_runs"."run_results" DEFAULT;--> statement-breakpoint
INSERT INTO "ph_runs"."run_results" (
	"id",
	"project_id",
	"source",
	"source_id",
	"release_variant_id",
	"prompt_version_id",
	"model_id",
	"sample_id",
	"external_id",
	"round_index",
	"rendered_prompt",
	"input_variables",
	"raw_response",
	"parsed_output",
	"decision_output",
	"expected_output",
	"is_correct",
	"judgment_status",
	"status",
	"error_class",
	"error_message",
	"latency_ms",
	"input_tokens",
	"output_tokens",
	"cost_estimate",
	"attempt",
	"dbos_workflow_id",
	"bullmq_job_id",
	"webhook_token_id",
	"created_at"
)
SELECT
	"id",
	"project_id",
	"source",
	"source_id",
	"release_variant_id",
	"prompt_version_id",
	"model_id",
	"sample_id",
	"external_id",
	"round_index",
	"rendered_prompt",
	"input_variables",
	"raw_response",
	"parsed_output",
	"decision_output",
	"expected_output",
	"is_correct",
	"judgment_status",
	"status",
	"error_class",
	"error_message",
	"latency_ms",
	"input_tokens",
	"output_tokens",
	"cost_estimate",
	"attempt",
	"dbos_workflow_id",
	"bullmq_job_id",
	"webhook_token_id",
	"created_at"
FROM "ph_runs"."run_results_legacy";--> statement-breakpoint
DROP TABLE "ph_runs"."run_results_legacy";--> statement-breakpoint
CREATE INDEX "idx_run_results_source_source_time" ON "ph_runs"."run_results" USING btree ("source","source_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_run_results_project_time" ON "ph_runs"."run_results" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_run_results_prompt_version_time" ON "ph_runs"."run_results" USING btree ("prompt_version_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_run_results_webhook_token_time" ON "ph_runs"."run_results" USING btree ("webhook_token_id","created_at" DESC NULLS LAST) WHERE "ph_runs"."run_results"."webhook_token_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_project_source_time" ON "ph_runs"."run_results" USING btree ("project_id","source","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_run_results_release_variant_time" ON "ph_runs"."run_results" USING btree ("project_id","release_variant_id","created_at" DESC NULLS LAST) WHERE "ph_runs"."run_results"."release_variant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_external_id" ON "ph_runs"."run_results" USING btree ("external_id") WHERE "ph_runs"."run_results"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_dbos" ON "ph_runs"."run_results" USING btree ("dbos_workflow_id") WHERE "ph_runs"."run_results"."dbos_workflow_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_bullmq_job" ON "ph_runs"."run_results" USING btree ("bullmq_job_id") WHERE "ph_runs"."run_results"."bullmq_job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_id_lookup" ON "ph_runs"."run_results" USING btree ("id");
