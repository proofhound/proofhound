// ph_runs.experiments / optimizations — offline regression experiments and optimization tasks

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
import { datasets, models } from '../ph_assets/index';
import { projects } from '../ph_core/index';
import { phRuns } from './_schema';

export const experiments = phRuns.table(
  'experiments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    promptVersionId: uuid('prompt_version_id').notNull(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    optimizationId: uuid('optimization_id').references((): AnyPgColumn => optimizations.id, {
      onDelete: 'set null',
    }),
    roundIndex: integer('round_index'),
    status: text('status').notNull().default('running'),
    runConfig: jsonb('run_config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    dbosWorkflowId: text('dbos_workflow_id'),
    controlState: text('control_state'),
    totalSamples: integer('total_samples').notNull().default(0),
    processedSamples: integer('processed_samples').notNull().default(0),
    failedSamples: integer('failed_samples').notNull().default(0),
    metrics: jsonb('metrics'),
    failureKind: text('failure_kind'),
    failureReason: text('failure_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('experiments_status_check', sql`${t.status} IN ('running', 'success', 'failed', 'stopped')`),
    check('experiments_control_state_check', sql`${t.controlState} IN ('stop', 'resume') OR ${t.controlState} IS NULL`),
    check(
      'experiments_failure_kind_check',
      sql`${t.failureKind} IN ('rate_limit', 'parse', 'timeout', 'internal') OR ${t.failureKind} IS NULL`,
    ),
    check('experiments_optimization_round_paired', sql`(${t.optimizationId} IS NULL) = (${t.roundIndex} IS NULL)`),
    uniqueIndex('idx_experiments_project_name_active')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_experiments_project_created')
      .on(t.projectId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_experiments_dbos')
      .on(t.dbosWorkflowId)
      .where(sql`${t.dbosWorkflowId} IS NOT NULL`),
    index('idx_experiments_status')
      .on(t.projectId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('experiments_optimization_round_uq')
      .on(t.optimizationId, t.roundIndex)
      .where(sql`${t.optimizationId} IS NOT NULL`),
  ],
);

export const optimizations = phRuns.table(
  'optimizations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    optimizationHint: text('optimization_hint'),
    strategy: text('strategy').notNull().default('error_pattern_analysis'),
    strategyConfig: jsonb('strategy_config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    startingMode: text('starting_mode').notNull(),
    sourceExperimentId: uuid('source_experiment_id').references((): AnyPgColumn => experiments.id),
    promptId: uuid('prompt_id'),
    baseVersionId: uuid('base_version_id'),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id),
    experimentModelId: uuid('experiment_model_id')
      .notNull()
      .references(() => models.id),
    analysisModelId: uuid('analysis_model_id')
      .notNull()
      .references(() => models.id),
    promptLanguage: text('prompt_language').notNull().default('zh-CN'),
    status: text('status').notNull().default('running'),
    objectiveStatus: text('objective_status').notNull().default('pending'),
    dbosWorkflowId: text('dbos_workflow_id'),
    controlState: text('control_state'),
    goals: jsonb('goals').notNull(),
    fieldWhitelist: jsonb('field_whitelist'),
    runConfig: jsonb('run_config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    maxRounds: integer('max_rounds').notNull().default(10),
    stopAfterNoImprovementRounds: integer('stop_after_no_improvement_rounds').notNull().default(0),
    currentRound: integer('current_round').notNull().default(0),
    bestVersionId: uuid('best_version_id'),
    bestMetrics: jsonb('best_metrics'),
    summary: jsonb('summary'),
    analysisFailureReason: text('analysis_failure_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('optimizations_status_check', sql`${t.status} IN ('running', 'success', 'failed', 'stopped', 'cancelled')`),
    check(
      'optimizations_objective_status_check',
      sql`${t.objectiveStatus} IN ('pending', 'met', 'not_met', 'unknown')`,
    ),
    check(
      'optimizations_stop_after_no_improvement_rounds_check',
      sql`${t.stopAfterNoImprovementRounds} >= 0 AND ${t.stopAfterNoImprovementRounds} <= 20`,
    ),
    check(
      'optimizations_starting_mode_check',
      sql`${t.startingMode} IN ('from_experiment', 'from_prompt_version', 'from_dataset_only')`,
    ),
    check(
      'optimizations_control_state_check',
      sql`${t.controlState} IN ('stop', 'resume', 'cancel') OR ${t.controlState} IS NULL`,
    ),
    check('optimizations_prompt_language_check', sql`${t.promptLanguage} IN ('zh-CN', 'en-US')`),
    uniqueIndex('idx_optimization_project_name_active')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_optimization_project_created')
      .on(t.projectId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_optimization_dbos')
      .on(t.dbosWorkflowId)
      .where(sql`${t.dbosWorkflowId} IS NOT NULL`),
    index('idx_optimization_running')
      .on(t.projectId)
      .where(sql`${t.status} = 'running'`),
  ],
);
