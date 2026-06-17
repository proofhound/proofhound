// ph_releases.canary_releases — canary releases
// See docs/specs/06-database-schema.md §6.2 and docs/specs/27-releases.md

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { connectors, datasets, models } from '../ph_assets/index';
import { projects } from '../ph_core/index';
import { phReleases } from './_schema';

export const canaryReleases = phReleases.table(
  'canary_releases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name'),
    description: text('description'),
    promptVersionId: uuid('prompt_version_id').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    inputConnectorId: uuid('input_connector_id')
      .notNull()
      .references(() => connectors.id),
    outputConnectorIds: uuid('output_connector_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),

    // State machine
    status: text('status').notNull().default('pending'),
    controlState: text('control_state'),
    controlStatePayload: jsonb('control_state_payload'),

    // Run config
    trafficRatio: numeric('traffic_ratio', { precision: 5, scale: 4 }).notNull(),
    trafficMode: text('traffic_mode').notNull().default('split'),
    runMode: text('run_mode').notNull(),
    stopConditions: jsonb('stop_conditions'),
    recordMode: text('record_mode').notNull().default('all'),
    recordCategories: text('record_categories')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    filterRules: jsonb('filter_rules'),
    variableMapping: jsonb('variable_mapping').notNull(),
    outputMapping: jsonb('output_mapping')
      .notNull()
      .default(sql`'[]'::jsonb`),
    externalIdField: text('external_id_field').notNull(),
    annotationSchema: jsonb('annotation_schema'),
    // Decision categories to write into the target dataset; empty array = select-all; see docs/specs/27-releases.md
    storageCategories: text('storage_categories')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    targetDatasetId: uuid('target_dataset_id').references(() => datasets.id, {
      onDelete: 'set null',
    }),
    runConfig: jsonb('run_config')
      .notNull()
      .default(sql`'{}'::jsonb`),

    // Real-time metrics snapshot (the skeleton version does not consume this; see docs/specs/03-orchestration.md §3.3)
    totalReceived: integer('total_received').notNull().default(0),
    totalProcessed: integer('total_processed').notNull().default(0),
    totalFiltered: integer('total_filtered').notNull().default(0),
    totalCorrect: integer('total_correct').notNull().default(0),
    totalErrors: integer('total_errors').notNull().default(0),
    metrics: jsonb('metrics'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'canary_releases_status_check',
      sql`${t.status} IN ('pending', 'running', 'stopped', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'canary_releases_control_state_check',
      sql`${t.controlState} IN ('stop', 'resume', 'cancel', 'extend') OR ${t.controlState} IS NULL`,
    ),
    check('canary_releases_run_mode_check', sql`${t.runMode} IN ('fixed_duration', 'manual')`),
    check('canary_releases_traffic_mode_check', sql`${t.trafficMode} IN ('split', 'dual_run')`),
    check('canary_releases_record_mode_check', sql`${t.recordMode} IN ('all', 'selected_categories', 'correct_only')`),
    check('canary_releases_traffic_ratio_check', sql`${t.trafficRatio} >= 0 AND ${t.trafficRatio} <= 1`),
    // One input connector can be occupied by at most one running canary at a time (mutual exclusion with production releases is enforced by the application layer)
    uniqueIndex('uniq_running_canary_per_input_connector')
      .on(t.inputConnectorId)
      .where(sql`${t.status} = 'running' AND ${t.deletedAt} IS NULL`),
    index('idx_canary_project_created')
      .on(t.projectId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_canary_status')
      .on(t.projectId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_canary_prompt_version').on(t.promptVersionId),
  ],
);
