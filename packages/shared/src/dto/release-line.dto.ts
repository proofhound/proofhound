import { z } from 'zod';
import {
  canaryReleaseFilterRulesSchema,
  canaryReleaseOutputMappingSchema,
  canaryReleaseRunConfigSchema,
  canaryReleaseVariableMappingSchema,
} from './canary-release.dto';
import { productionReleaseRunConfigSchema, productionReleaseVariableMappingSchema } from './production-release.dto';

export const releaseLineStatusSchema = z.enum(['running', 'stopped', 'archived']);
export type ReleaseLineStatusDto = z.infer<typeof releaseLineStatusSchema>;

export const releaseLineLaneTypeSchema = z.enum(['production', 'canary']);
export type ReleaseLineLaneTypeDto = z.infer<typeof releaseLineLaneTypeSchema>;

export const releaseLineRecordModeSchema = z.enum(['all', 'selected_categories', 'correct_only']);
export type ReleaseLineRecordModeDto = z.infer<typeof releaseLineRecordModeSchema>;
export const releaseLineRecordCategoriesSchema = z.array(z.string().trim().min(1).max(200)).default([]);
export type ReleaseLineRecordCategoriesDto = z.infer<typeof releaseLineRecordCategoriesSchema>;

export const releaseLineEventStatusSchema = z.enum([
  'running',
  'stopped',
  'completed',
  'failed',
  'cancelled',
  'archived',
]);
export type ReleaseLineEventStatusDto = z.infer<typeof releaseLineEventStatusSchema>;

export const releaseLineEventOperationSchema = z.enum([
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
  'unarchive_line',
]);
export type ReleaseLineEventOperationDto = z.infer<typeof releaseLineEventOperationSchema>;

export const releaseLineEventTerminalReasonSchema = z.enum([
  'replaced',
  'rolled_back',
  'force_stopped',
  'promoted',
  'cancelled',
  'archived',
  'error',
]);
export type ReleaseLineEventTerminalReasonDto = z.infer<typeof releaseLineEventTerminalReasonSchema>;

export const releaseVersionKindSchema = z.enum(['candidate', 'production']);
export type ReleaseVersionKindDto = z.infer<typeof releaseVersionKindSchema>;

const connectorSnapshotSchema = z.record(z.string(), z.unknown());
const promptSnapshotSchema = z.record(z.string(), z.unknown());
const promptVersionSnapshotSchema = z.record(z.string(), z.unknown());
const modelSnapshotSchema = z.record(z.string(), z.unknown());

export const releaseLineOutputConnectorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
});
export type ReleaseLineOutputConnectorDto = z.infer<typeof releaseLineOutputConnectorSchema>;

export const releaseLineConnectorOutputMappingSchema = z.object({
  connectorId: z.string().uuid(),
  outputMapping: canaryReleaseOutputMappingSchema.default([]),
});
export type ReleaseLineConnectorOutputMappingDto = z.infer<typeof releaseLineConnectorOutputMappingSchema>;

export const releaseLineOutputMappingSchema = z.union([
  canaryReleaseOutputMappingSchema,
  z.array(releaseLineConnectorOutputMappingSchema),
]);
export type ReleaseLineOutputMappingDto = z.infer<typeof releaseLineOutputMappingSchema>;

export const releaseVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseLineId: z.string().uuid(),
  kind: releaseVersionKindSchema,
  productionVersionNumber: z.number().int().positive().nullable(),
  targetProductionVersionNumber: z.number().int().positive(),
  candidateNumber: z.number().int().positive().nullable(),
  promotedFromReleaseVersionId: z.string().uuid().nullable(),
  label: z.string(),
  promptId: z.string().uuid().nullable(),
  promptName: z.string(),
  promptVersionId: z.string().uuid(),
  promptVersionNumber: z.number().int().nullable(),
  promptVersionLabel: z.string().nullable(),
  promptSnapshot: promptSnapshotSchema,
  promptVersionSnapshot: promptVersionSnapshotSchema,
  modelId: z.string().uuid(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  modelSnapshot: modelSnapshotSchema,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReleaseVersionDto = z.infer<typeof releaseVersionSchema>;

export const releaseLineEventSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseLineId: z.string().uuid(),
  releaseVersionId: z.string().uuid().nullable(),
  releaseVersionKind: releaseVersionKindSchema.nullable(),
  releaseVersionLabel: z.string().nullable(),
  releaseVersionProductionNumber: z.number().int().positive().nullable(),
  releaseVersionTargetProductionNumber: z.number().int().positive().nullable(),
  releaseVersionCandidateNumber: z.number().int().positive().nullable(),
  annotationTaskId: z.string().uuid().nullable(),
  laneType: releaseLineLaneTypeSchema,
  operation: releaseLineEventOperationSchema,
  status: releaseLineEventStatusSchema,
  terminalReason: releaseLineEventTerminalReasonSchema.nullable(),
  sourceEventId: z.string().uuid().nullable(),
  sourceLegacySource: z.enum(['production_release_event', 'canary_release']).nullable(),
  sourceLegacyId: z.string().uuid().nullable(),
  supersedesEventId: z.string().uuid().nullable(),
  rollbackTargetEventId: z.string().uuid().nullable(),
  legacySource: z.enum(['production_release_event', 'canary_release']).nullable(),
  legacySourceId: z.string().uuid().nullable(),
  promptId: z.string().uuid().nullable(),
  promptName: z.string(),
  promptVersionId: z.string().uuid().nullable(),
  promptVersionNumber: z.number().int().nullable(),
  promptVersionLabel: z.string().nullable(),
  promptSnapshot: promptSnapshotSchema,
  promptVersionSnapshot: promptVersionSnapshotSchema,
  modelId: z.string().uuid().nullable(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  modelSnapshot: modelSnapshotSchema,
  inputConnectorId: z.string().uuid().nullable(),
  inputConnectorName: z.string().nullable(),
  inputConnectorType: z.string().nullable(),
  inputConnectorSnapshot: connectorSnapshotSchema,
  outputConnectorIds: z.array(z.string().uuid()),
  outputConnectors: z.array(releaseLineOutputConnectorSchema),
  outputConnectorSnapshots: z.array(connectorSnapshotSchema),
  trafficMode: z.enum(['split', 'dual_run']).nullable(),
  trafficRatio: z.number().min(0).max(1).nullable(),
  runConfig: z.record(z.string(), z.unknown()),
  variableMapping: z.unknown(),
  outputMapping: z.unknown(),
  filterRules: z.unknown().nullable(),
  recordMode: releaseLineRecordModeSchema,
  recordCategories: releaseLineRecordCategoriesSchema,
  externalIdField: z.string().nullable(),
  retentionDays: z.number().int().positive().nullable(),
  sourceExperimentId: z.string().uuid().nullable(),
  submitReason: z.string(),
  metrics: z.record(z.string(), z.unknown()).nullable(),
  totalReceived: z.number().int().nonnegative(),
  totalProcessed: z.number().int().nonnegative(),
  totalFiltered: z.number().int().nonnegative(),
  totalCorrect: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative(),
  controlState: z.string().nullable(),
  controlStatePayload: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReleaseLineEventDto = z.infer<typeof releaseLineEventSchema>;

export const releaseLineSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  promptId: z.string().uuid().nullable(),
  promptName: z.string(),
  promptSnapshot: promptSnapshotSchema,
  inputConnectorId: z.string().uuid().nullable(),
  inputConnectorName: z.string().nullable(),
  inputConnectorType: z.string().nullable(),
  inputConnectorSnapshot: connectorSnapshotSchema,
  status: releaseLineStatusSchema,
  currentProductionEventId: z.string().uuid().nullable(),
  activeCanaryEventId: z.string().uuid().nullable(),
  currentProductionEvent: releaseLineEventSchema.nullable(),
  activeCanaryEvent: releaseLineEventSchema.nullable(),
  versions: z.array(releaseVersionSchema),
  outputConnectors: z.array(releaseLineOutputConnectorSchema),
  latestEvent: releaseLineEventSchema.nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type ReleaseLineDto = z.infer<typeof releaseLineSchema>;

export const releaseLineListResponseSchema = z.object({
  data: z.array(releaseLineSchema),
  total: z.number().int().nonnegative(),
});
export type ReleaseLineListResponseDto = z.infer<typeof releaseLineListResponseSchema>;

export const releaseLineEventListResponseSchema = z.object({
  data: z.array(releaseLineEventSchema),
  total: z.number().int().nonnegative(),
});
export type ReleaseLineEventListResponseDto = z.infer<typeof releaseLineEventListResponseSchema>;

export const updateReleaseLineTrafficRatioInputSchema = z.object({
  trafficRatio: z.number().min(0).max(1),
});
export type UpdateReleaseLineTrafficRatioInputDto = z.infer<typeof updateReleaseLineTrafficRatioInputSchema>;

export const updateReleaseLineRunConfigInputSchema = z.discriminatedUnion('laneType', [
  z.object({
    laneType: z.literal('production'),
    modelId: z.string().uuid().optional(),
    runConfig: productionReleaseRunConfigSchema,
    recordMode: releaseLineRecordModeSchema.optional(),
    recordCategories: releaseLineRecordCategoriesSchema.optional(),
  }),
  z.object({
    laneType: z.literal('canary'),
    modelId: z.string().uuid().optional(),
    runConfig: canaryReleaseRunConfigSchema,
    recordMode: releaseLineRecordModeSchema.optional(),
    recordCategories: releaseLineRecordCategoriesSchema.optional(),
  }),
]);
export type UpdateReleaseLineRunConfigInputDto = z.infer<typeof updateReleaseLineRunConfigInputSchema>;

export const updateReleaseLineOutputRouteInputSchema = z.object({
  laneType: releaseLineLaneTypeSchema,
  outputConnectorIds: z.array(z.string().uuid()).default([]),
  outputMapping: releaseLineOutputMappingSchema.default([]),
});
export type UpdateReleaseLineOutputRouteInputDto = z.infer<typeof updateReleaseLineOutputRouteInputSchema>;

export const updateReleaseLineInputRouteInputSchema = z.discriminatedUnion('laneType', [
  z.object({
    laneType: z.literal('production'),
    variableMapping: productionReleaseVariableMappingSchema.default({}),
    filterRules: canaryReleaseFilterRulesSchema.default(null),
    externalIdField: z.string().min(1),
  }),
  z.object({
    laneType: z.literal('canary'),
    variableMapping: canaryReleaseVariableMappingSchema,
    filterRules: canaryReleaseFilterRulesSchema.default(null),
    externalIdField: z.string().min(1),
  }),
]);
export type UpdateReleaseLineInputRouteInputDto = z.infer<typeof updateReleaseLineInputRouteInputSchema>;

export const updateReleaseLineRetentionInputSchema = z.object({
  retentionDays: z.number().int().positive().nullable(),
});
export type UpdateReleaseLineRetentionInputDto = z.infer<typeof updateReleaseLineRetentionInputSchema>;

export const stopReleaseLineInputSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type StopReleaseLineInputDto = z.infer<typeof stopReleaseLineInputSchema>;

export const startReleaseLineInputSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});
export type StartReleaseLineInputDto = z.infer<typeof startReleaseLineInputSchema>;

export const archiveReleaseLineInputSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});
export type ArchiveReleaseLineInputDto = z.infer<typeof archiveReleaseLineInputSchema>;

export const unarchiveReleaseLineInputSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});
export type UnarchiveReleaseLineInputDto = z.infer<typeof unarchiveReleaseLineInputSchema>;

export const restoreReleaseLineHistoryInputSchema = z.object({
  sourceEventId: z.string().uuid(),
  reason: z.string().min(1).max(2000).optional(),
});
export type RestoreReleaseLineHistoryInputDto = z.infer<typeof restoreReleaseLineHistoryInputSchema>;

export const releaseLineDeletionImpactItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['event', 'version', 'annotation_task']),
  name: z.string().nullable(),
  status: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string().datetime().nullable(),
});
export type ReleaseLineDeletionImpactItemDto = z.infer<typeof releaseLineDeletionImpactItemSchema>;

export const releaseLineDeletionImpactSchema = z.object({
  releaseLineId: z.string().uuid(),
  lineName: z.string(),
  events: z.array(releaseLineDeletionImpactItemSchema),
  versions: z.array(releaseLineDeletionImpactItemSchema),
  annotationTasks: z.array(releaseLineDeletionImpactItemSchema),
  runResults: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type ReleaseLineDeletionImpactDto = z.infer<typeof releaseLineDeletionImpactSchema>;

export const deleteReleaseLineInputSchema = z.object({
  confirmationName: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000).optional(),
});
export type DeleteReleaseLineInputDto = z.infer<typeof deleteReleaseLineInputSchema>;

export const RELEASE_LINE_STATUSES = releaseLineStatusSchema.options;
export const RELEASE_LINE_EVENT_STATUSES = releaseLineEventStatusSchema.options;
export const RELEASE_LINE_EVENT_OPERATIONS = releaseLineEventOperationSchema.options;
