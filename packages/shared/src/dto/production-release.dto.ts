import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export const productionReleaseEventTypeSchema = z.enum([
  'from_prompt',
  'from_experiment',
  'from_canary',
  'config_change',
  'rollback',
  'force_stop',
]);
export type ProductionReleaseEventTypeDto = z.infer<typeof productionReleaseEventTypeSchema>;

export const productionReleaseStatusSchema = z.enum(['running', 'success', 'failed', 'stopped']);
export type ProductionReleaseStatusDto = z.infer<typeof productionReleaseStatusSchema>;

export const productionReleaseStopReasonSchema = z.enum(['replaced', 'rolled_back', 'force_stopped', 'error']);
export type ProductionReleaseStopReasonDto = z.infer<typeof productionReleaseStopReasonSchema>;

export const productionReleaseRecordModeSchema = z.enum(['all', 'selected_categories', 'correct_only']);
export type ProductionReleaseRecordModeDto = z.infer<typeof productionReleaseRecordModeSchema>;
export const productionReleaseRecordCategoriesSchema = z.array(z.string().trim().min(1).max(200)).default([]);
export type ProductionReleaseRecordCategoriesDto = z.infer<typeof productionReleaseRecordCategoriesSchema>;

// Aggregated online status (derived)
export const productionReleaseAggregateStatusSchema = z.enum(['online', 'offline']);
export type ProductionReleaseAggregateStatusDto = z.infer<typeof productionReleaseAggregateStatusSchema>;

// ============================================================================
// Sub-structures
// ============================================================================

export const productionReleaseRunConfigSchema = z.object({
  rpmLimit: z.number().int().positive(),
  tpmLimit: z.number().int().positive(),
  concurrency: z.number().int().positive().default(1),
  temperature: z.number().min(0).max(2).default(0.3),
});
export type ProductionReleaseRunConfigDto = z.infer<typeof productionReleaseRunConfigSchema>;

export const productionReleaseVariableMappingSchema = z.record(z.string(), z.string());
export type ProductionReleaseVariableMappingDto = z.infer<typeof productionReleaseVariableMappingSchema>;

export const productionReleaseFilterRulesSchema = z.record(z.string(), z.unknown()).nullable();
export type ProductionReleaseFilterRulesDto = z.infer<typeof productionReleaseFilterRulesSchema>;

export const productionReleasePromptSnapshotSchema = z.record(z.string(), z.unknown());
export type ProductionReleasePromptSnapshotDto = z.infer<typeof productionReleasePromptSnapshotSchema>;

export const productionReleasePromptVersionSnapshotSchema = z.record(z.string(), z.unknown());
export type ProductionReleasePromptVersionSnapshotDto = z.infer<typeof productionReleasePromptVersionSnapshotSchema>;

// ============================================================================
// Main event
// ============================================================================

export const productionReleaseEventSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  promptId: z.string().uuid(),
  eventType: productionReleaseEventTypeSchema,
  promptVersionId: z.string().uuid(),
  modelId: z.string().uuid(),
  inputConnectorId: z.string().uuid().nullable(),
  outputConnectorIds: z.array(z.string().uuid()),
  runConfig: productionReleaseRunConfigSchema,
  variableMapping: productionReleaseVariableMappingSchema,
  filterRules: productionReleaseFilterRulesSchema,
  recordMode: productionReleaseRecordModeSchema,
  recordCategories: productionReleaseRecordCategoriesSchema,
  externalIdField: z.string().nullable(),
  retentionDays: z.number().int().positive().nullable(),
  status: productionReleaseStatusSchema,
  createdBy: z.string().uuid(),
  submitReason: z.string(),
  sourceExperimentId: z.string().uuid().nullable(),
  sourceCanaryId: z.string().uuid().nullable(),
  sourceMetricsSnapshot: z.record(z.string(), z.unknown()).nullable(),
  promptSnapshot: productionReleasePromptSnapshotSchema,
  promptVersionSnapshot: productionReleasePromptVersionSnapshotSchema,
  rollbackTargetEventId: z.string().uuid().nullable(),
  controlState: z.enum(['stop', 'resume', 'cancel']).nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  stopReason: productionReleaseStopReasonSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductionReleaseEventDto = z.infer<typeof productionReleaseEventSchema>;

// ============================================================================
// List item (aggregated by prompt; one row per prompt + a current/latest event sub-object; still returns the latest event after stopping)
// ============================================================================

export const productionReleaseListItemSchema = z.object({
  promptId: z.string().uuid(),
  promptName: z.string(),
  promptVersionLabel: z.string().nullable(), // e.g. "v16"
  aggregateStatus: productionReleaseAggregateStatusSchema,
  currentEvent: productionReleaseEventSchema.nullable(),
  currentEventCreatedAt: z.string().datetime().nullable(),
  // Display name of the associated resource
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  inputConnectorName: z.string().nullable(),
  inputConnectorType: z.string().nullable(),
  outputConnectors: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        type: z.string(),
      }),
    )
    .nullable(),
  // Latest event type, used for a small list label (e.g. "Config change / Rollback / Force-stop")
  lastEventType: productionReleaseEventTypeSchema.nullable(),
  // Online duration since the current running state (ms); null when offline
  onlineDurationMs: z.number().int().nonnegative().nullable(),
});
export type ProductionReleaseListItemDto = z.infer<typeof productionReleaseListItemSchema>;

// ============================================================================
// History timeline item
// ============================================================================

export const productionReleaseHistoryItemSchema = productionReleaseEventSchema.extend({
  // Display name of the associated resource
  promptVersionLabel: z.string().nullable(),
  modelName: z.string().nullable(),
  inputConnectorName: z.string().nullable(),
  createdByName: z.string().nullable(),
  rollbackTargetVersionLabel: z.string().nullable(),
});
export type ProductionReleaseHistoryItemDto = z.infer<typeof productionReleaseHistoryItemSchema>;

export const productionReleaseAnnotationMetricsSchema = z.object({
  total: z.number().int().nonnegative(),
  claimed: z.number().int().nonnegative(),
  submitted: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
});
export type ProductionReleaseAnnotationMetricsDto = z.infer<typeof productionReleaseAnnotationMetricsSchema>;

// ============================================================================
// Create / stop inputs
// ============================================================================

export const createProductionReleaseInputSchema = z.object({
  promptId: z.string().uuid(),
  promptVersionId: z.string().uuid(),
  modelId: z.string().uuid(),
  inputConnectorId: z.string().uuid(),
  outputConnectorIds: z.array(z.string().uuid()).default([]),
  eventType: productionReleaseEventTypeSchema.default('from_prompt'),
  runConfig: productionReleaseRunConfigSchema,
  variableMapping: productionReleaseVariableMappingSchema.default({}),
  filterRules: productionReleaseFilterRulesSchema.default(null),
  recordMode: productionReleaseRecordModeSchema.default('all'),
  recordCategories: productionReleaseRecordCategoriesSchema,
  externalIdField: z.string().min(1).nullable().default(null),
  retentionDays: z.number().int().positive().nullable().default(null),
  submitReason: z.string().min(1, 'submit_reason is required').max(2000),
  // Source (required by eventType)
  sourceExperimentId: z.string().uuid().nullable().default(null),
  sourceCanaryId: z.string().uuid().nullable().default(null),
  sourceMetricsSnapshot: z.record(z.string(), z.unknown()).nullable().default(null),
  rollbackTargetEventId: z.string().uuid().nullable().default(null),
});
export type CreateProductionReleaseInputDto = z.infer<typeof createProductionReleaseInputSchema>;

export const stopProductionReleaseInputSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type StopProductionReleaseInputDto = z.infer<typeof stopProductionReleaseInputSchema>;

// ============================================================================
// Constants (shared between frontend / backend)
// ============================================================================

export const PRODUCTION_RELEASE_EVENT_TYPES = productionReleaseEventTypeSchema.options;
export const PRODUCTION_RELEASE_STATUSES = productionReleaseStatusSchema.options;
export const PRODUCTION_RELEASE_STOP_REASONS = productionReleaseStopReasonSchema.options;
export const PRODUCTION_RELEASE_RECORD_MODES = productionReleaseRecordModeSchema.options;
