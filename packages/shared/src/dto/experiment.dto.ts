import { z } from 'zod';
import { datasetFieldSchema } from './dataset.dto';
import { datasetModalitySchema } from './dataset-modality';
import { promptOutputSchema, promptVariableTypeSchema } from './prompt.dto';

export const experimentIdParamSchema = z.string().uuid();
export type ExperimentIdParamDto = z.infer<typeof experimentIdParamSchema>;

export const experimentStatusSchema = z.enum(['running', 'success', 'failed', 'stopped']);
export type ExperimentStatusDto = z.infer<typeof experimentStatusSchema>;

// `cancel` is kept as a legacy control action alias for `stop`.
export const experimentControlActionSchema = z.enum(['stop', 'resume', 'cancel', 'retry']);
export type ExperimentControlActionDto = z.infer<typeof experimentControlActionSchema>;

export const experimentExportFormatSchema = z.enum(['csv', 'jsonl']);
export type ExperimentExportFormatDto = z.infer<typeof experimentExportFormatSchema>;

export const experimentSortSchema = z.enum(['accuracy', 'updated', 'duration']);
export type ExperimentSortDto = z.infer<typeof experimentSortSchema>;

export const experimentListQuerySchema = z.object({
  status: experimentStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  sort: experimentSortSchema.optional(),
});
export type ExperimentListQueryDto = z.infer<typeof experimentListQuerySchema>;

export const experimentRunConfigSchema = z
  .object({
    concurrency: z.number().int().positive().optional(),
    rpmLimit: z.number().int().positive().optional(),
    tpmLimit: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    sampleTimeoutSeconds: z.number().int().positive().optional(),
    retries: z.number().int().nonnegative().optional(),
    imageEncoding: z.enum(['url', 'base64']).optional(),
    description: z.string().nullable().optional(),
  })
  .catchall(z.unknown());
export type ExperimentRunConfigDto = z.infer<typeof experimentRunConfigSchema>;

export const experimentMetricsPerClassEntrySchema = z.object({
  label: z.string(),
  precision: z.number().min(0).max(1).nullable(),
  recall: z.number().min(0).max(1).nullable(),
  f1: z.number().min(0).max(1).nullable(),
  support: z.number().int().nonnegative(),
  tp: z.number().int().nonnegative().optional(),
  fn: z.number().int().nonnegative().optional(),
});
export type ExperimentMetricsPerClassEntryDto = z.infer<typeof experimentMetricsPerClassEntrySchema>;

export const experimentMetricsSchema = z
  .object({
    accuracy: z.number().min(0).max(1).nullable().optional(),
    precision: z.number().min(0).max(1).nullable().optional(),
    recall: z.number().min(0).max(1).nullable().optional(),
    f1: z.number().min(0).max(1).nullable().optional(),
    perClass: z.array(experimentMetricsPerClassEntrySchema).nullable().optional(),
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    costEstimate: z.number().nonnegative().nullable().optional(),
    averageLatencyMs: z.number().nonnegative().nullable().optional(),
    p50LatencyMs: z.number().nonnegative().nullable().optional(),
    p95LatencyMs: z.number().nonnegative().nullable().optional(),
  })
  .catchall(z.unknown())
  .nullable();
export type ExperimentMetricsDto = z.infer<typeof experimentMetricsSchema>;

export const experimentFailureKindSchema = z.enum(['rate_limit', 'parse', 'timeout', 'internal']).nullable();
export type ExperimentFailureKindDto = z.infer<typeof experimentFailureKindSchema>;

export const experimentListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  optimizationId: z.string().uuid().nullable(),
  roundIndex: z.number().int().nonnegative().nullable(),
  promptId: z.string().uuid(),
  promptVersionId: z.string().uuid(),
  promptName: z.string(),
  promptVersionNumber: z.number().int().positive(),
  promptVersionLabel: z.string(),
  datasetId: z.string().uuid(),
  datasetName: z.string(),
  datasetSamples: z.number().int().nonnegative(),
  modelId: z.string().uuid(),
  modelName: z.string(),
  modelVariant: z.string(),
  promptVariableTypes: z.array(promptVariableTypeSchema),
  datasetHasImages: z.boolean(),
  datasetModalities: z.array(datasetModalitySchema),
  datasetFieldSchema: z.array(datasetFieldSchema).nullable(),
  outputSchema: promptOutputSchema,
  status: experimentStatusSchema,
  controlState: z.enum(['stop', 'resume']).nullable(),
  totalSamples: z.number().int().nonnegative(),
  processedSamples: z.number().int().nonnegative(),
  failedSamples: z.number().int().nonnegative(),
  metrics: experimentMetricsSchema,
  runConfig: experimentRunConfigSchema,
  dbosWorkflowId: z.string().nullable(),
  failureReason: z.string().nullable(),
  failureKind: experimentFailureKindSchema,
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdByUsername: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type ExperimentListItemDto = z.infer<typeof experimentListItemSchema>;

export const experimentListStatsSchema = z.object({
  newThisWeek: z.number().int().nonnegative(),
  averageDurationSeconds: z.number().nonnegative().nullable(),
  medianDurationSeconds: z.number().nonnegative().nullable(),
  p90DurationSeconds: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costEstimate: z.number().nonnegative(),
  monthlyCostEstimate: z.number().nonnegative(),
  monthlyCostQuota: z.number().nonnegative().nullable(),
});
export type ExperimentListStatsDto = z.infer<typeof experimentListStatsSchema>;

export const experimentListResponseSchema = z.object({
  data: z.array(experimentListItemSchema),
  total: z.number().int().nonnegative(),
  stats: experimentListStatsSchema,
});
export type ExperimentListResponseDto = z.infer<typeof experimentListResponseSchema>;

export const createExperimentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  promptVersionId: z.string().uuid(),
  datasetId: z.string().uuid(),
  modelId: z.string().uuid(),
  runConfig: experimentRunConfigSchema.optional(),
});
export type CreateExperimentDto = z.infer<typeof createExperimentSchema>;
