import { z } from 'zod';
import { datasetFieldSchemaRoleSchema } from './dataset.dto';

export const runResultStatusSchema = z.enum(['running', 'success', 'failed']);
export type RunResultStatusDto = z.infer<typeof runResultStatusSchema>;

export const runResultJudgmentStatusSchema = z.enum(['correct', 'incorrect', 'parse_error', 'judge_error']);
export type RunResultJudgmentStatusDto = z.infer<typeof runResultJudgmentStatusSchema>;

export const runResultSourceSchema = z.enum([
  'experiment',
  'optimization_analysis',
  'optimization_generate',
  'release',
  'canary',
  'online',
]);
export type RunResultSourceDto = z.infer<typeof runResultSourceSchema>;

export const releaseRunResultLaneSchema = z.enum(['production', 'canary']);
export type ReleaseRunResultLaneDto = z.infer<typeof releaseRunResultLaneSchema>;

export const releaseRunResultVersionScopeSchema = z.enum(['exact', 'journey']);
export type ReleaseRunResultVersionScopeDto = z.infer<typeof releaseRunResultVersionScopeSchema>;

export const runResultSortSchema = z.enum(['created_desc', 'latency_desc', 'tokens_desc']);
export type RunResultSortDto = z.infer<typeof runResultSortSchema>;

export const runResultDatasetFieldValueSchema = z.object({
  name: z.string(),
  role: datasetFieldSchemaRoleSchema,
  value: z.unknown().nullable(),
});
export type RunResultDatasetFieldValueDto = z.infer<typeof runResultDatasetFieldValueSchema>;

const statusCsvSchema = z
  .union([runResultStatusSchema, z.array(runResultStatusSchema), z.string()])
  .optional()
  .transform((value): RunResultStatusDto[] | undefined => {
    if (value === undefined) return undefined;
    const list = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : [value];
    const out: RunResultStatusDto[] = [];
    for (const item of list) {
      const parse = runResultStatusSchema.safeParse(item);
      if (parse.success) out.push(parse.data);
    }
    return out.length > 0 ? out : undefined;
  });

const judgmentCsvSchema = z
  .union([runResultJudgmentStatusSchema, z.array(runResultJudgmentStatusSchema), z.string()])
  .optional()
  .transform((value): RunResultJudgmentStatusDto[] | undefined => {
    if (value === undefined) return undefined;
    const list = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : [value];
    const out: RunResultJudgmentStatusDto[] = [];
    for (const item of list) {
      const parse = runResultJudgmentStatusSchema.safeParse(item);
      if (parse.success) out.push(parse.data);
    }
    return out.length > 0 ? out : undefined;
  });

const uuidCsvSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return value;
}, z.array(z.string().uuid()).optional());

const releaseLaneCsvSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return value;
}, z.array(releaseRunResultLaneSchema).optional());

export const runResultListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  status: statusCsvSchema,
  judgmentStatus: judgmentCsvSchema,
  isCorrect: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return typeof value === 'boolean' ? value : value === 'true';
    }),
  search: z.string().trim().max(200).optional(),
  sort: runResultSortSchema.optional().default('created_desc'),
});
export type RunResultListQueryDto = z.infer<typeof runResultListQuerySchema>;

export const runResultReleaseListQuerySchema = runResultListQuerySchema.extend({
  sourceIds: uuidCsvSchema,
  releaseVersionIds: uuidCsvSchema,
  releaseVersionScope: releaseRunResultVersionScopeSchema.optional().default('exact'),
  promptVersionIds: uuidCsvSchema,
  lane: releaseLaneCsvSchema,
  externalId: z.string().trim().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type RunResultReleaseListQueryDto = z.infer<typeof runResultReleaseListQuerySchema>;

export const runResultListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  experimentId: z.string().uuid(),
  sampleId: z.string().uuid().nullable(),
  externalId: z.string().nullable(),
  status: runResultStatusSchema,
  judgmentStatus: runResultJudgmentStatusSchema.nullable(),
  isCorrect: z.boolean().nullable(),
  decisionOutput: z.string().nullable(),
  expectedOutput: z.string().nullable(),
  datasetTextFields: z.array(runResultDatasetFieldValueSchema),
  datasetImageFields: z.array(runResultDatasetFieldValueSchema),
  // List previews: short text kept in the DB even after the full fields tier out to object storage
  // (SPEC 30 §9). The list serves these so it never reads a shard; the full fields below stay for
  // backward compatibility and are null once the row is compacted (the detail view rehydrates them).
  inputPreview: z.string().nullable(),
  outputPreview: z.string().nullable(),
  inputVariables: z.unknown().nullable(),
  rawResponse: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  errorClass: z.string().nullable(),
  errorMessage: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  costEstimate: z.number().nonnegative().nullable(),
  attempt: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type RunResultListItemDto = z.infer<typeof runResultListItemSchema>;

export const runResultListResponseSchema = z.object({
  data: z.array(runResultListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type RunResultListResponseDto = z.infer<typeof runResultListResponseSchema>;

export const releaseRunResultListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  source: z.literal('release'),
  sourceId: z.string().uuid(),
  lane: releaseRunResultLaneSchema,
  eventId: z.string().uuid().nullable(),
  canaryId: z.string().uuid().nullable(),
  releaseVersionId: z.string().uuid().nullable(),
  releaseVersionKind: z.enum(['candidate', 'production']).nullable(),
  releaseVersionLabel: z.string().nullable(),
  releaseVersionProductionNumber: z.number().int().positive().nullable(),
  releaseVersionTargetProductionNumber: z.number().int().positive().nullable(),
  releaseVersionCandidateNumber: z.number().int().positive().nullable(),
  externalId: z.string().nullable(),
  promptName: z.string().nullable(),
  promptVersionId: z.string().uuid(),
  promptVersionNumber: z.number().int().positive().nullable(),
  modelId: z.string().uuid(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  status: runResultStatusSchema,
  judgmentStatus: runResultJudgmentStatusSchema.nullable(),
  isCorrect: z.boolean().nullable(),
  decisionOutput: z.string().nullable(),
  inputVariables: z.unknown().nullable(),
  rawResponse: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  errorClass: z.string().nullable(),
  errorMessage: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  costEstimate: z.number().nonnegative().nullable(),
  attempt: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type ReleaseRunResultListItemDto = z.infer<typeof releaseRunResultListItemSchema>;

export const releaseRunResultListResponseSchema = z.object({
  data: z.array(releaseRunResultListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ReleaseRunResultListResponseDto = z.infer<typeof releaseRunResultListResponseSchema>;

export const runResultDetailSchema = runResultListItemSchema.extend({
  promptVersionId: z.string().uuid(),
  modelId: z.string().uuid(),
  source: z.literal('experiment'),
  renderedPrompt: z.unknown(),
  inputVariables: z.unknown().nullable(),
  rawResponse: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  dbosWorkflowId: z.string().nullable(),
  bullmqJobId: z.string().nullable(),
});
export type RunResultDetailDto = z.infer<typeof runResultDetailSchema>;
