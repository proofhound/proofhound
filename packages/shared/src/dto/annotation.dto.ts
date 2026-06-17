import { z } from 'zod';

export const annotationTaskScopeSchema = z.enum(['all', 'canary', 'online']);
export type AnnotationTaskScopeDto = z.infer<typeof annotationTaskScopeSchema>;

export const annotationReleaseVersionScopeSchema = z.enum(['exact', 'journey']);
export type AnnotationReleaseVersionScopeDto = z.infer<typeof annotationReleaseVersionScopeSchema>;

export const annotationSamplingModeSchema = z.enum(['random', 'per_category']);
export type AnnotationSamplingModeDto = z.infer<typeof annotationSamplingModeSchema>;

export const annotationTaskStatusSchema = z.enum(['active', 'completed', 'archived']);
export type AnnotationTaskStatusDto = z.infer<typeof annotationTaskStatusSchema>;

export const annotationSampleStatusSchema = z.enum(['pending', 'claimed', 'submitted']);
export type AnnotationSampleStatusDto = z.infer<typeof annotationSampleStatusSchema>;

export const annotationTaskProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  claimed: z.number().int().nonnegative(),
  submitted: z.number().int().nonnegative(),
});
export type AnnotationTaskProgressDto = z.infer<typeof annotationTaskProgressSchema>;

export const annotationTaskQualitySchema = z
  .object({
    matched: z.number().int().nonnegative(),
    mismatched: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
  })
  .nullable();
export type AnnotationTaskQualityDto = z.infer<typeof annotationTaskQualitySchema>;

export const annotationCategoryCountSchema = z.object({
  category: z.string().trim().min(1),
  count: z.number().int().nonnegative(),
});
export type AnnotationCategoryCountDto = z.infer<typeof annotationCategoryCountSchema>;

export const annotationReleaseVersionOptionSchema = z.object({
  id: z.string().uuid(),
  releaseLineId: z.string().uuid(),
  label: z.string(),
  kind: z.enum(['candidate', 'production']),
  productionVersionNumber: z.number().int().positive().nullable(),
  targetProductionVersionNumber: z.number().int().positive(),
  candidateNumber: z.number().int().positive().nullable(),
  promptVersionId: z.string().uuid(),
  promptVersionNumber: z.number().int().positive().nullable(),
  promptVersionLabel: z.string().nullable(),
  categoryOptions: z.array(z.string().trim().min(1)).default([]),
  modelId: z.string().uuid(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  runResultCount: z.number().int().nonnegative(),
  canaryCount: z.number().int().nonnegative(),
  onlineCount: z.number().int().nonnegative(),
  journeyCanaryCount: z.number().int().nonnegative(),
  journeyOnlineCount: z.number().int().nonnegative(),
  journeyCompatible: z.boolean(),
  categoryCounts: z.array(annotationCategoryCountSchema).default([]),
});
export type AnnotationReleaseVersionOptionDto = z.infer<typeof annotationReleaseVersionOptionSchema>;

export const annotationReleaseLineOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  promptName: z.string(),
  inputConnectorName: z.string().nullable(),
  versions: z.array(annotationReleaseVersionOptionSchema),
});
export type AnnotationReleaseLineOptionDto = z.infer<typeof annotationReleaseLineOptionSchema>;

export const annotationTaskDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  scope: annotationTaskScopeSchema,
  releaseLineId: z.string().uuid(),
  releaseLineName: z.string(),
  releaseVersionId: z.string().uuid(),
  releaseVersionLabel: z.string(),
  releaseVersionScope: annotationReleaseVersionScopeSchema,
  promptName: z.string(),
  promptVersionId: z.string().uuid(),
  promptVersionNumber: z.number().int().positive().nullable(),
  promptVersionLabel: z.string().nullable(),
  categoryOptions: z.array(z.string().trim().min(1)).default([]),
  modelId: z.string().uuid(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  status: annotationTaskStatusSchema,
  progress: annotationTaskProgressSchema,
  quality: annotationTaskQualitySchema,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AnnotationTaskDto = z.infer<typeof annotationTaskDtoSchema>;

export const annotationTaskListResponseSchema = z.object({
  data: z.array(annotationTaskDtoSchema),
  total: z.number().int().nonnegative(),
});
export type AnnotationTaskListResponseDto = z.infer<typeof annotationTaskListResponseSchema>;

export const annotationTaskOptionsResponseSchema = z.object({
  data: z.array(annotationReleaseLineOptionSchema),
  total: z.number().int().nonnegative(),
});
export type AnnotationTaskOptionsResponseDto = z.infer<typeof annotationTaskOptionsResponseSchema>;

export const annotationCategorySampleInputSchema = z.object({
  category: z.string().trim().min(1),
  sampleSize: z.number().int().min(0).max(10_000),
});
export type AnnotationCategorySampleInputDto = z.infer<typeof annotationCategorySampleInputSchema>;

export const createAnnotationTaskInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    releaseLineId: z.string().uuid(),
    releaseVersionId: z.string().uuid(),
    releaseVersionScope: annotationReleaseVersionScopeSchema.default('exact'),
    scope: annotationTaskScopeSchema.default('all'),
    samplingMode: annotationSamplingModeSchema.default('random'),
    sampleSize: z.number().int().min(1).max(10_000).optional(),
    categorySampleCounts: z.array(annotationCategorySampleInputSchema).max(200).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.samplingMode === 'random') {
      if (input.sampleSize === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sampleSize'],
          message: 'sampleSize is required for random sampling',
        });
      }
      return;
    }

    const requestedCounts = input.categorySampleCounts ?? [];
    const total = requestedCounts.reduce((sum, item) => sum + item.sampleSize, 0);
    if (total < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categorySampleCounts'],
        message: 'At least one category sample count is required',
      });
    }
    if (total > 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categorySampleCounts'],
        message: 'Total category sample count must be at most 10000',
      });
    }
    const seen = new Set<string>();
    requestedCounts.forEach((item, index) => {
      if (seen.has(item.category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categorySampleCounts', index, 'category'],
          message: 'Duplicate category sample count',
        });
      }
      seen.add(item.category);
    });
  });
export type CreateAnnotationTaskInputDto = z.infer<typeof createAnnotationTaskInputSchema>;

export const annotationSampleDtoSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  runResultId: z.string().uuid(),
  externalId: z.string().nullable(),
  inputPreview: z.string().nullable(),
  outputPreview: z.string().nullable(),
  inputVariables: z.record(z.string(), z.unknown()).nullable(),
  renderedPrompt: z.unknown().nullable(),
  decisionOutput: z.string().nullable(),
  expectedOutput: z.string().nullable(),
  annotatedExpectedOutput: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  rawResponse: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  notes: z.string().nullable(),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().datetime().nullable(),
  lockHeartbeatAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  submittedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type AnnotationSampleDto = z.infer<typeof annotationSampleDtoSchema>;

export const annotationSampleListResponseSchema = z.object({
  data: z.array(annotationSampleDtoSchema),
  total: z.number().int().nonnegative(),
});
export type AnnotationSampleListResponseDto = z.infer<typeof annotationSampleListResponseSchema>;

export const claimAnnotationSamplesInputSchema = z.object({
  batchSize: z.number().int().min(1).max(100),
});
export type ClaimAnnotationSamplesInputDto = z.infer<typeof claimAnnotationSamplesInputSchema>;

export const claimAnnotationSamplesResponseSchema = z.object({
  data: z.array(annotationSampleDtoSchema),
  claimedCount: z.number().int().nonnegative(),
});
export type ClaimAnnotationSamplesResponseDto = z.infer<typeof claimAnnotationSamplesResponseSchema>;

export const submitAnnotationSampleInputSchema = z.object({
  annotationId: z.string().uuid(),
  expectedOutput: z.string().trim().min(1).max(4000),
  notes: z.string().max(4000).nullable(),
});
export type SubmitAnnotationSampleInputDto = z.infer<typeof submitAnnotationSampleInputSchema>;

export const releaseAnnotationSampleInputSchema = z.object({
  annotationId: z.string().uuid(),
});
export type ReleaseAnnotationSampleInputDto = z.infer<typeof releaseAnnotationSampleInputSchema>;
