// ph_releases.production_release_events — production release event stream
// See docs/specs/06-database-schema.md §6.3 and docs/specs/27-releases.md
// Event-sourced: new release / config change / rollback / force-stop are each one record; commit means running, no approval step.

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { connectors, models } from '../ph_assets/index';
import { projects } from '../ph_core/index';
import { experiments } from '../ph_runs/experiments';
import { canaryReleases } from './canary-releases';
import { phReleases } from './_schema';

export const productionReleaseEvents = phReleases.table(
  'production_release_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    promptId: uuid('prompt_id').notNull(),
    eventType: text('event_type').notNull(),

    // Target config snapshot
    promptVersionId: uuid('prompt_version_id').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    // force_stop may keep the original upstream snapshot; legacy data is also allowed to be empty ("no backfill after takedown" semantics)
    inputConnectorId: uuid('input_connector_id').references(() => connectors.id),
    outputConnectorIds: uuid('output_connector_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    runConfig: jsonb('run_config').notNull(),
    variableMapping: jsonb('variable_mapping')
      .notNull()
      .default(sql`'{}'::jsonb`),
    filterRules: jsonb('filter_rules'),
    recordMode: text('record_mode').notNull().default('all'),
    recordCategories: text('record_categories')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    externalIdField: text('external_id_field'),
    retentionDays: integer('retention_days'),

    // State machine
    status: text('status').notNull().default('running'),
    createdBy: uuid('created_by').notNull(),
    submitReason: text('submit_reason').notNull(),

    // Source snapshot
    sourceExperimentId: uuid('source_experiment_id').references(() => experiments.id),
    sourceCanaryId: uuid('source_canary_id').references((): AnyPgColumn => canaryReleases.id),
    sourceMetricsSnapshot: jsonb('source_metrics_snapshot'),
    promptSnapshot: jsonb('prompt_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    promptVersionSnapshot: jsonb('prompt_version_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),

    // Rollback target (self-reference)
    rollbackTargetEventId: uuid('rollback_target_event_id').references((): AnyPgColumn => productionReleaseEvents.id),

    // Runtime
    controlState: text('control_state'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stopReason: text('stop_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'production_release_events_event_type_check',
      sql`${t.eventType} IN ('from_prompt', 'from_experiment', 'from_canary', 'config_change', 'rollback', 'force_stop')`,
    ),
    check(
      'production_release_events_record_mode_check',
      sql`${t.recordMode} IN ('all', 'selected_categories', 'correct_only')`,
    ),
    check('production_release_events_status_check', sql`${t.status} IN ('running', 'success', 'failed', 'stopped')`),
    check(
      'production_release_events_control_state_check',
      sql`${t.controlState} IN ('stop', 'resume', 'cancel') OR ${t.controlState} IS NULL`,
    ),
    check(
      'production_release_events_stop_reason_check',
      sql`${t.stopReason} IN ('replaced', 'rolled_back', 'force_stopped', 'error') OR ${t.stopReason} IS NULL`,
    ),
    check(
      'production_release_events_source_canary_required',
      sql`${t.eventType} <> 'from_canary' OR ${t.sourceCanaryId} IS NOT NULL`,
    ),
    check(
      'production_release_events_rollback_target_required',
      sql`${t.eventType} <> 'rollback' OR ${t.rollbackTargetEventId} IS NOT NULL`,
    ),
    // At most one running per prompt at any time
    uniqueIndex('uniq_running_release_per_prompt')
      .on(t.promptId)
      .where(sql`${t.status} = 'running'`),
    // At most one running occupancy per input connector at any time
    uniqueIndex('uniq_running_release_per_input_connector')
      .on(t.inputConnectorId)
      .where(sql`${t.status} = 'running' AND ${t.inputConnectorId} IS NOT NULL`),
    // List / history queries
    index('idx_release_events_status_created').on(t.projectId, t.status, t.createdAt),
    index('idx_release_events_prompt_created').on(t.projectId, t.promptId, t.createdAt),
  ],
);
