-- Rename the prompt system label from the deprecated "gray" wording to "canary".
UPDATE "ph_assets"."prompt_version_labels"
SET "label" = 'canary',
    "updated_at" = now()
WHERE "label" = 'gray';--> statement-breakpoint
