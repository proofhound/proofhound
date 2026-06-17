ALTER TABLE "ph_releases"."release_line_events" DROP CONSTRAINT IF EXISTS "release_line_events_operation_check";--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_operation_check" CHECK ("operation" IN (
  'create_production',
  'create_production_from_experiment',
  'create_canary',
  'traffic_updated',
  'mode_updated',
  'config_changed',
  'stop_lane',
  'resume_lane',
  'cancel_canary',
  'promote_canary',
  'rollback',
  'restore_to_production',
  'restore_to_canary',
  'force_stop',
  'archive_line',
  'unarchive_line'
));--> statement-breakpoint
