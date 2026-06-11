CREATE TABLE "ph_runs"."run_result_ids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "ph_runs"."run_result_ids" ("id", "created_at")
SELECT DISTINCT ON ("id") "id", "created_at"
FROM "ph_runs"."run_results"
ORDER BY "id", "created_at";
