// ph_assets — models / datasets / prompts / connectors
// See docs/specs/06-database-schema.md §4

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from '../ph_core/index';

export const phAssets = pgSchema('ph_assets');

export const models = phAssets.table(
  'models',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    providerType: text('provider_type').notNull(),
    providerModelId: text('provider_model_id').notNull(),
    endpoint: text('endpoint').notNull(),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    contextWindowTokens: integer('context_window_tokens'),
    rpmLimit: integer('rpm_limit').notNull().default(60),
    tpmLimit: integer('tpm_limit').notNull().default(100000),
    // concurrency_limit acts as the ceiling when auto_concurrency is on; otherwise it is the hard limit. See docs/specs/21-models.md §6.1
    concurrencyLimit: integer('concurrency_limit').notNull().default(20),
    autoConcurrency: boolean('auto_concurrency').notNull().default(true),
    inputTokenPricePerMillion: numeric('input_token_price_per_million', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    outputTokenPricePerMillion: numeric('output_token_price_per_million', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    capabilities: jsonb('capabilities')
      .notNull()
      .default(sql`'{}'::jsonb`),
    extraBody: jsonb('extra_body')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isActive: boolean('is_active').notNull().default(true),
    lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
    lastProbeError: text('last_probe_error'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'models_context_window_tokens_positive_check',
      sql`${t.contextWindowTokens} IS NULL OR ${t.contextWindowTokens} > 0`,
    ),
    check('models_rpm_limit_valid_check', sql`${t.rpmLimit} = -1 OR ${t.rpmLimit} > 0`),
    check('models_tpm_limit_valid_check', sql`${t.tpmLimit} = -1 OR ${t.tpmLimit} > 0`),
    check('models_concurrency_limit_valid_check', sql`${t.concurrencyLimit} >= 1 AND ${t.concurrencyLimit} <= 999`),
    check('models_input_token_price_nonnegative_check', sql`${t.inputTokenPricePerMillion} >= 0`),
    check('models_output_token_price_nonnegative_check', sql`${t.outputTokenPricePerMillion} >= 0`),
    check('models_extra_body_object_check', sql`jsonb_typeof(${t.extraBody}) = 'object'`),
    uniqueIndex('idx_models_project_name_active')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_models_project')
      .on(t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const modelContextWindows = phAssets.table(
  'model_context_windows',
  {
    providerModelId: text('provider_model_id').primaryKey(),
    contextWindowTokens: integer('context_window_tokens').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('model_context_windows_context_window_positive_check', sql`${t.contextWindowTokens} > 0`)],
);

export const datasets = phAssets.table(
  'datasets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    sampleCount: integer('sample_count').notNull().default(0),
    fieldSchema: jsonb('field_schema')
      .notNull()
      .default(sql`'[]'::jsonb`),
    hasImages: boolean('has_images').notNull().default(false),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('datasets_status_check', sql`${t.status} IN ('active', 'archived')`),
    uniqueIndex('idx_datasets_project_name_active')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_datasets_project')
      .on(t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const datasetSamples = phAssets.table(
  'dataset_samples',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    // The full sample content is stored inline in PostgreSQL (SPEC 22 §7); `data` is the system of record.
    data: jsonb('data').notNull(),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_dataset_samples_dataset').on(t.datasetId),
    index('idx_dataset_samples_ext')
      .on(t.datasetId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  ],
);

// Large-file streaming import session + staging samples. See docs/specs/06-database-schema.md §4.3.1 / 22-datasets.md §3.1.2
export const datasetImports = phAssets.table(
  'dataset_imports',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // NULL during import; backfilled to the new dataset on successful complete promote
    datasetId: uuid('dataset_id').references(() => datasets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    fieldMappings: jsonb('field_mappings')
      .notNull()
      .default(sql`'[]'::jsonb`),
    fileName: text('file_name').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    contentType: text('content_type'),
    sourceFormat: text('source_format').notNull(),
    progress: jsonb('progress')
      .notNull()
      .default(sql`'{}'::jsonb`),
    declaredTotalRows: integer('declared_total_rows'),
    receivedRows: integer('received_rows').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    status: text('status').notNull().default('created'),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    abortedAt: timestamp('aborted_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Heartbeat advanced on each batch; sweep reaps importing sessions stale past the timeout
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('dataset_imports_source_format_check', sql`${t.sourceFormat} IN ('jsonl', 'csv', 'tsv', 'json', 'zip')`),
    check(
      'dataset_imports_status_check',
      sql`${t.status} IN ('created', 'importing', 'completed', 'failed', 'aborted')`,
    ),
    index('idx_dataset_imports_project_status').on(t.projectId, t.status),
    index('idx_dataset_imports_stale')
      .on(t.status, t.updatedAt)
      .where(sql`${t.status} = 'importing'`),
  ],
);

export const datasetImportSamples = phAssets.table(
  'dataset_import_samples',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => datasetImports.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    data: jsonb('data').notNull(),
    externalId: text('external_id'),
  },
  // (import_id, row_index) gives single-batch resend idempotency; ON DELETE CASCADE makes cleanup = delete the session row
  (t) => [primaryKey({ columns: [t.importId, t.rowIndex] })],
);

export const prompts = phAssets.table(
  'prompts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currentOnlineVersionId: uuid('current_online_version_id'),
    defaultDatasetId: uuid('default_dataset_id').references(() => datasets.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('prompts_status_check', sql`${t.status} IN ('active', 'archived')`),
    uniqueIndex('idx_prompts_project_name_active')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_prompts_project')
      .on(t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_prompts_default_dataset')
      .on(t.defaultDatasetId)
      .where(sql`${t.defaultDatasetId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

export const promptVersions = phAssets.table(
  'prompt_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    body: text('body'),
    variables: jsonb('variables')
      .notNull()
      .default(sql`'[]'::jsonb`),
    outputSchema: jsonb('output_schema'),
    judgmentRules: jsonb('judgment_rules'),
    promptLanguage: text('prompt_language').notNull().default('zh-CN'),
    parentVersionId: uuid('parent_version_id'),
    generatedByOptimizationId: uuid('generated_by_optimization_id'),
    changeReason: text('change_reason'),
    isFrozen: boolean('is_frozen').notNull().default(false),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
  },
  (t) => [
    unique('prompt_versions_prompt_version_unique').on(t.promptId, t.versionNumber),
    check('prompt_versions_prompt_language_check', sql`${t.promptLanguage} IN ('zh-CN', 'en-US')`),
    index('idx_prompt_versions_prompt').on(t.promptId, t.versionNumber),
  ],
);

export const promptVersionLabels = phAssets.table(
  'prompt_version_labels',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => promptVersions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    labelType: text('label_type').notNull().default('custom'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uniq_prompt_version_labels_prompt_label').on(t.promptId, t.label),
    index('idx_prompt_version_labels_version').on(t.versionId),
    check('prompt_version_labels_type_check', sql`${t.labelType} IN ('system', 'custom')`),
    check('prompt_version_labels_label_check', sql`${t.label} ~ '^[A-Za-z0-9一-鿿][A-Za-z0-9一-鿿_.:-]{0,63}$'`),
  ],
);

export const connectors = phAssets.table(
  'connectors',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    direction: text('direction').notNull(),
    type: text('type').notNull(),
    config: jsonb('config').notNull(),
    configEncrypted: jsonb('config_encrypted'),
    webhookPath: text('webhook_path'),
    // Inbound webhook tokens are not referenced in this table; they live in ph_core.tokens (scope='webhook' AND connector_id=this.id)
    // See docs/specs/06-database-schema.md §3.2 / §4.5
    ipWhitelist: jsonb('ip_whitelist').$type<string[]>(),
    healthStatus: text('health_status').notNull().default('unknown'),
    lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
    lastProbeError: text('last_probe_error'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('connectors_direction_check', sql`${t.direction} IN ('input', 'output')`),
    check('connectors_type_check', sql`${t.type} IN ('redis', 'kafka', 'webhook')`),
    check('connectors_health_status_check', sql`${t.healthStatus} IN ('healthy', 'degraded', 'unhealthy', 'unknown')`),
    check(
      'connectors_type_webhook_check',
      sql`(
        (${t.type} = 'webhook'   AND ${t.direction} = 'input'  AND ${t.webhookPath} IS NOT NULL) OR
        (${t.type} = 'webhook'   AND ${t.direction} = 'output' AND ${t.webhookPath} IS NULL)     OR
        (${t.type} <> 'webhook'  AND ${t.webhookPath} IS NULL)
      )`,
    ),
    uniqueIndex('idx_connectors_project_name_active')
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('idx_connectors_webhook_path_active')
      .on(t.projectId, t.webhookPath)
      .where(sql`${t.webhookPath} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('idx_connectors_project')
      .on(t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
