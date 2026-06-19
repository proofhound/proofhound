// ph_runs — experiments / optimizations / run results / annotations
// See docs/specs/06-database-schema.md §5

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { annotationTasks } from '../ph_releases/annotation-tasks';
import { releaseVersions } from '../ph_releases/release-lines';
import { projects, tokens } from '../ph_core/index';
import { phRuns } from './_schema';
import { optimizations } from './experiments';

export { phRuns } from './_schema';
export { experiments, optimizations } from './experiments';

export const runResultIds = phRuns.table('run_result_ids', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const optimizationRoundSteps = phRuns.table(
  'optimization_round_steps',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    optimizationId: uuid('optimization_id')
      .notNull()
      .references(() => optimizations.id, { onDelete: 'cascade' }),
    roundIndex: integer('round_index').notNull(),
    step: text('step').notNull(),
    status: text('status').notNull(),
    errorClass: text('error_class'),
    errorMessage: text('error_message'),
    runResultId: uuid('run_result_id'),
    experimentId: uuid('experiment_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    attempt: integer('attempt').notNull().default(0),
    dbosWorkflowId: text('dbos_workflow_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('optimization_round_steps_step_check', sql`${t.step} IN ('error_analysis', 'generate_prompt', 'experiment')`),
    check(
      'optimization_round_steps_status_check',
      sql`${t.status} IN ('pending', 'running', 'success', 'failed', 'skipped')`,
    ),
    uniqueIndex('optimization_round_steps_uq').on(t.optimizationId, t.roundIndex, t.step),
    index('idx_optimization_round_steps_by_iter').on(t.optimizationId, t.roundIndex),
  ],
);

export const runResults = phRuns.table(
  'run_results',
  {
    id: uuid('id')
      .notNull()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceId: uuid('source_id').notNull(),
    releaseVersionId: uuid('release_version_id').references((): AnyPgColumn => releaseVersions.id),
    promptVersionId: uuid('prompt_version_id').notNull(),
    modelId: uuid('model_id').notNull(),
    sampleId: uuid('sample_id'),
    externalId: text('external_id'),
    roundIndex: integer('round_index'),
    // Large fields — tiered to object-storage shards by compaction when an ObjectStorageProvider is
    // enabled (SPEC 30 §9). `rendered_prompt` is nullable so it can be cleared once offloaded; a NULL
    // big field with a non-null `payload_ref` means the authoritative bytes live in the shard.
    renderedPrompt: jsonb('rendered_prompt'),
    inputVariables: jsonb('input_variables'),
    rawResponse: text('raw_response'),
    parsedOutput: jsonb('parsed_output'),
    decisionOutput: text('decision_output'),
    expectedOutput: text('expected_output'),
    // Storage tiering (SPEC 30 §9): pointer + generation guard + list previews. All nullable; a NULL
    // `payload_ref` means the row is still fully inline (fresh / old row / no object storage configured).
    payloadRef: jsonb('payload_ref'),
    compactionGeneration: integer('compaction_generation'),
    inputPreview: text('input_preview'),
    outputPreview: text('output_preview'),
    isCorrect: boolean('is_correct'),
    judgmentStatus: text('judgment_status'),
    status: text('status').notNull(),
    errorClass: text('error_class'),
    errorMessage: text('error_message'),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costEstimate: numeric('cost_estimate', { precision: 12, scale: 6 }),
    attempt: integer('attempt').notNull().default(1),
    dbosWorkflowId: text('dbos_workflow_id'),
    bullmqJobId: text('bullmq_job_id'),
    // Webhook-entry attribution: only filled when the call was triggered by a webhook token
    // (HTTP / MCP entries leave it NULL). ON DELETE SET NULL keeps run_result audit rows after token revocation.
    // See docs/specs/08-saas-adapter-boundary.md §3.4 / §5.
    webhookTokenId: uuid('webhook_token_id').references((): AnyPgColumn => tokens.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Drizzle does not expose PostgreSQL partition DDL; the migration owns
    // PARTITION BY RANGE (created_at) and the monthly partition creation.
    primaryKey({ columns: [t.id, t.createdAt], name: 'run_results_pkey' }),
    check(
      'run_results_source_check',
      sql`${t.source} IN ('experiment', 'optimization_analysis', 'optimization_generate', 'release', 'canary', 'online')`,
    ),
    check(
      'run_results_judgment_status_check',
      sql`${t.judgmentStatus} IN ('correct', 'incorrect', 'parse_error', 'judge_error') OR ${t.judgmentStatus} IS NULL`,
    ),
    check('run_results_status_check', sql`${t.status} IN ('running', 'success', 'failed')`),
    index('idx_run_results_source_source_time').on(t.source, t.sourceId, t.createdAt.desc()),
    index('idx_run_results_project_time').on(t.projectId, t.createdAt.desc()),
    index('idx_run_results_project_source_time').on(t.projectId, t.source, t.createdAt.desc()),
    index('idx_run_results_release_version_time')
      .on(t.projectId, t.releaseVersionId, t.createdAt.desc())
      .where(sql`${t.releaseVersionId} IS NOT NULL`),
    index('idx_run_results_external_id')
      .on(t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index('idx_run_results_dbos')
      .on(t.dbosWorkflowId)
      .where(sql`${t.dbosWorkflowId} IS NOT NULL`),
    index('idx_run_results_bullmq_job')
      .on(t.bullmqJobId)
      .where(sql`${t.bullmqJobId} IS NOT NULL`),
    index('idx_run_results_prompt_version_time').on(t.promptVersionId, t.createdAt.desc()),
    index('idx_run_results_id_lookup').on(t.id),
    index('idx_run_results_webhook_token_time')
      .on(t.webhookTokenId, t.createdAt.desc())
      .where(sql`${t.webhookTokenId} IS NOT NULL`),
  ],
);

export const annotations = phRuns.table(
  'annotations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    runResultId: uuid('run_result_id').notNull(),
    runResultCreatedAt: timestamp('run_result_created_at', { withTimezone: true }).notNull(),
    taskId: uuid('task_id').references((): AnyPgColumn => annotationTasks.id),
    isCorrect: boolean('is_correct'),
    fields: jsonb('fields')
      .notNull()
      .default(sql`'{}'::jsonb`),
    notes: text('notes'),
    lockedBy: uuid('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockHeartbeatAt: timestamp('lock_heartbeat_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedBy: uuid('submitted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uniq_annotations_run_result_task').on(t.runResultId, t.taskId),
    index('idx_annotations_run_result').on(t.runResultId),
    index('idx_annotations_task')
      .on(t.taskId)
      .where(sql`${t.taskId} IS NOT NULL`),
    index('idx_annotations_lock_stale')
      .on(t.taskId, t.lockHeartbeatAt)
      .where(sql`${t.lockedBy} IS NOT NULL`),
  ],
);
