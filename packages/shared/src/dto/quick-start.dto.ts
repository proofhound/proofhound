import { z } from 'zod';
import {
  MODEL_DEFAULT_CONCURRENCY_LIMIT,
  createProjectModelSchema,
  modelIdParamSchema,
  projectModelListItemSchema,
} from './model.dto';
import {
  createDatasetSchema,
  datasetFieldMappingSchema,
  datasetIdParamSchema,
  datasetUploadSourceSchema,
} from './dataset.dto';
import { DEFAULT_PROMPT_LANGUAGE, promptLanguageSchema } from './prompt.dto';
import {
  optimizationLoopLimitsSchema,
  optimizationRunConfigSchema,
  createOptimizationGoalSchema,
} from './optimization.dto';

export const QUICK_START_DEFAULT_MAX_ROUNDS = 3;
export const QUICK_START_DEFAULT_INITIAL_SAMPLING_ROUNDS = 3;
export const QUICK_START_DEFAULT_INITIAL_SAMPLES_PER_ROUND = 10;
export const QUICK_START_DEFAULT_TEMPERATURE = 0.3;
export const QUICK_START_DEFAULT_RPM_LIMIT = 60;
export const QUICK_START_DEFAULT_TPM_LIMIT = 150_000;
export const QUICK_START_DEFAULT_CONCURRENCY = MODEL_DEFAULT_CONCURRENCY_LIMIT;
export const QUICK_START_DEFAULT_SAMPLE_TIMEOUT_SECONDS = 20;

export const quickStartExistingModelRefSchema = z.object({
  kind: z.literal('existing'),
  modelId: modelIdParamSchema,
});
export type QuickStartExistingModelRefDto = z.infer<typeof quickStartExistingModelRefSchema>;

export const quickStartDraftModelRefSchema = z.object({
  kind: z.literal('draft'),
  model: createProjectModelSchema,
});
export type QuickStartDraftModelRefDto = z.infer<typeof quickStartDraftModelRefSchema>;

export const quickStartModelRefSchema = z.discriminatedUnion('kind', [
  quickStartExistingModelRefSchema,
  quickStartDraftModelRefSchema,
]);
export type QuickStartModelRefDto = z.infer<typeof quickStartModelRefSchema>;

export const quickStartStrategyConfigSchema = z.object({
  initialSamplingRounds: z.coerce.number().int().min(1).max(10).default(QUICK_START_DEFAULT_INITIAL_SAMPLING_ROUNDS),
  initialSamplesPerRound: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(QUICK_START_DEFAULT_INITIAL_SAMPLES_PER_ROUND),
});
export type QuickStartStrategyConfigDto = z.infer<typeof quickStartStrategyConfigSchema>;

export const quickStartModelOptionSchema = projectModelListItemSchema;
export type QuickStartModelOptionDto = z.infer<typeof quickStartModelOptionSchema>;

export const quickStartModelOptionsResponseSchema = z.object({
  data: z.array(quickStartModelOptionSchema),
  total: z.number().int().nonnegative(),
});
export type QuickStartModelOptionsResponseDto = z.infer<typeof quickStartModelOptionsResponseSchema>;

export const probeQuickStartDraftModelSchema = createProjectModelSchema;
export type ProbeQuickStartDraftModelDto = z.infer<typeof probeQuickStartDraftModelSchema>;

export const importedQuickStartDatasetSchema = z.object({
  kind: z.literal('imported'),
  datasetId: datasetIdParamSchema,
  name: z.string().trim().min(1).max(160),
  uploadSource: datasetUploadSourceSchema,
  fieldMappings: z.array(datasetFieldMappingSchema).min(1).max(200),
});
export type ImportedQuickStartDatasetDto = z.infer<typeof importedQuickStartDatasetSchema>;

export const quickStartDatasetSchema = z.union([importedQuickStartDatasetSchema, createDatasetSchema]);
export type QuickStartDatasetDto = z.infer<typeof quickStartDatasetSchema>;

export const createQuickStartSchema = z
  .object({
    projectName: z.string().trim().min(1).max(120).optional(),
    projectDescription: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .nullable()
      .transform((value) => (value && value.length > 0 ? value : null)),
    optimizationName: z.string().trim().min(1).max(160).optional(),
    taskDescription: z.string().trim().min(1).max(200),
    promptLanguage: promptLanguageSchema.default(DEFAULT_PROMPT_LANGUAGE),
    dataset: quickStartDatasetSchema,
    experimentModel: quickStartModelRefSchema,
    analysisModel: quickStartModelRefSchema,
    goals: z
      .array(createOptimizationGoalSchema)
      .min(1)
      .max(10)
      .default([
        {
          metric: 'accuracy',
          comparator: 'gte',
          target: 0.8,
          scope: 'overall',
        },
      ]),
    loopLimits: optimizationLoopLimitsSchema.default({
      maxRounds: QUICK_START_DEFAULT_MAX_ROUNDS,
      stopAfterNoImprovementRounds: 0,
    }),
    runConfig: optimizationRunConfigSchema.optional(),
    strategyConfig: quickStartStrategyConfigSchema.default({
      initialSamplingRounds: QUICK_START_DEFAULT_INITIAL_SAMPLING_ROUNDS,
      initialSamplesPerRound: QUICK_START_DEFAULT_INITIAL_SAMPLES_PER_ROUND,
    }),
  })
  .superRefine((value, ctx) => {
    const expectedFields = value.dataset.fieldMappings.filter((field) => field.role === 'expected');
    if (expectedFields.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['dataset', 'fieldMappings'],
        message: 'quick_start_expected_field_required',
      });
    }

    const inputFields = value.dataset.fieldMappings.filter((field) => field.role === 'text' || field.role === 'image');
    if (inputFields.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['dataset', 'fieldMappings'],
        message: 'quick_start_input_field_required',
      });
    }
  });
export type CreateQuickStartDto = z.infer<typeof createQuickStartSchema>;

export const quickStartCreateResponseSchema = z.object({
  projectId: z.string().uuid(),
  datasetId: z.string().uuid(),
  promptId: z.string().uuid().nullable(),
  optimizationId: z.string().uuid(),
});
export type QuickStartCreateResponseDto = z.infer<typeof quickStartCreateResponseSchema>;
