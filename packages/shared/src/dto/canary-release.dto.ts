import { z } from 'zod';

// ============================================================================
// Enums
// See docs/specs/27-releases.md and docs/specs/06-database-schema.md §6.2
// ============================================================================

export const canaryReleaseStatusSchema = z.enum(['pending', 'running', 'stopped', 'completed', 'failed', 'cancelled']);
export type CanaryReleaseStatusDto = z.infer<typeof canaryReleaseStatusSchema>;

export const canaryReleaseRunModeSchema = z.enum(['fixed_duration', 'manual']);
export type CanaryReleaseRunModeDto = z.infer<typeof canaryReleaseRunModeSchema>;

export const canaryReleaseRecordModeSchema = z.enum(['all', 'selected_categories', 'correct_only']);
export type CanaryReleaseRecordModeDto = z.infer<typeof canaryReleaseRecordModeSchema>;
export const canaryReleaseRecordCategoriesSchema = z.array(z.string().trim().min(1).max(200)).default([]);
export type CanaryReleaseRecordCategoriesDto = z.infer<typeof canaryReleaseRecordCategoriesSchema>;

export const canaryReleaseTrafficModeSchema = z.enum(['split', 'dual_run']);
export type CanaryReleaseTrafficModeDto = z.infer<typeof canaryReleaseTrafficModeSchema>;

export const canaryReleaseControlStateSchema = z.enum(['stop', 'resume', 'cancel', 'extend']);
export type CanaryReleaseControlStateDto = z.infer<typeof canaryReleaseControlStateSchema>;

// ============================================================================
// Filter rules recursive Zod (AND / OR / NOT arbitrary nesting; max depth 5)
// ============================================================================

export const canaryReleaseFilterOpSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'exists',
  'startsWith',
  'endsWith',
]);
export type CanaryReleaseFilterOpDto = z.infer<typeof canaryReleaseFilterOpSchema>;

export type CanaryReleaseFilterNodeDto =
  | { type: 'atom'; field: string; op: CanaryReleaseFilterOpDto; value?: unknown }
  | { type: 'and'; children: CanaryReleaseFilterNodeDto[] }
  | { type: 'or'; children: CanaryReleaseFilterNodeDto[] }
  | { type: 'not'; child: CanaryReleaseFilterNodeDto };

const canaryReleaseFilterAtomSchema = z.object({
  type: z.literal('atom'),
  field: z.string().min(1),
  op: canaryReleaseFilterOpSchema,
  value: z.unknown().optional(),
});

export const canaryReleaseFilterNodeSchema: z.ZodType<CanaryReleaseFilterNodeDto> = z.lazy(() =>
  z.discriminatedUnion('type', [
    canaryReleaseFilterAtomSchema,
    z.object({
      type: z.literal('and'),
      children: z.array(canaryReleaseFilterNodeSchema).min(1),
    }),
    z.object({
      type: z.literal('or'),
      children: z.array(canaryReleaseFilterNodeSchema).min(1),
    }),
    z.object({
      type: z.literal('not'),
      child: canaryReleaseFilterNodeSchema,
    }),
  ]),
);

export const CANARY_RELEASE_FILTER_MAX_DEPTH = 5;

function measureFilterDepth(node: CanaryReleaseFilterNodeDto): number {
  if (node.type === 'atom') return 1;
  if (node.type === 'not') return 1 + measureFilterDepth(node.child);
  return 1 + node.children.reduce<number>((max, child) => Math.max(max, measureFilterDepth(child)), 0);
}

export const canaryReleaseFilterRulesSchema = canaryReleaseFilterNodeSchema.nullable().superRefine((value, ctx) => {
  if (value === null) return;
  const depth = measureFilterDepth(value);
  if (depth > CANARY_RELEASE_FILTER_MAX_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `filter rules tree depth ${depth} exceeds max ${CANARY_RELEASE_FILTER_MAX_DEPTH}`,
    });
  }
});

// ============================================================================
// Sub-structures
// ============================================================================

export const canaryReleaseVariableMappingItemSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
});
export type CanaryReleaseVariableMappingItemDto = z.infer<typeof canaryReleaseVariableMappingItemSchema>;

export const canaryReleaseVariableMappingSchema = z
  .array(canaryReleaseVariableMappingItemSchema)
  .superRefine((items, ctx) => {
    if (!items.some((it) => it.target === 'id')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'variable_mapping must include a row with target="id"',
      });
    }
  });
export type CanaryReleaseVariableMappingDto = z.infer<typeof canaryReleaseVariableMappingSchema>;

export const canaryReleaseOutputMappingItemSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});
export type CanaryReleaseOutputMappingItemDto = z.infer<typeof canaryReleaseOutputMappingItemSchema>;

export const canaryReleaseOutputMappingSchema = z.array(canaryReleaseOutputMappingItemSchema);
export type CanaryReleaseOutputMappingDto = z.infer<typeof canaryReleaseOutputMappingSchema>;

export const canaryReleaseStopConditionsSchema = z
  .object({
    maxDurationSeconds: z.number().int().positive().nullable().default(null),
    maxSamples: z.number().int().positive().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.maxDurationSeconds === null && value.maxSamples === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one of maxDurationSeconds / maxSamples must be set when stop_conditions present',
      });
    }
  });
export type CanaryReleaseStopConditionsDto = z.infer<typeof canaryReleaseStopConditionsSchema>;

export const canaryReleaseRunConfigSchema = z.object({
  rpmLimit: z.number().int().positive(),
  tpmLimit: z.number().int().positive(),
  concurrency: z.number().int().positive().default(1),
  temperature: z.number().min(0).max(2).default(0.3),
  stopConditions: canaryReleaseStopConditionsSchema.nullable().optional(),
});
export type CanaryReleaseRunConfigDto = z.infer<typeof canaryReleaseRunConfigSchema>;

export const canaryReleaseAnnotationFieldTypeSchema = z.enum(['enum', 'text', 'timestamp', 'boolean']);
export type CanaryReleaseAnnotationFieldTypeDto = z.infer<typeof canaryReleaseAnnotationFieldTypeSchema>;

export const canaryReleaseAnnotationFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().nullable().optional(),
  type: canaryReleaseAnnotationFieldTypeSchema,
  required: z.boolean().default(false),
  enumValues: z.array(z.string()).optional(),
});
export type CanaryReleaseAnnotationFieldDto = z.infer<typeof canaryReleaseAnnotationFieldSchema>;

export const canaryReleaseAnnotationSchemaSchema = z.array(canaryReleaseAnnotationFieldSchema);
export type CanaryReleaseAnnotationSchemaDto = z.infer<typeof canaryReleaseAnnotationSchemaSchema>;

// ============================================================================
// Main DTO
// ============================================================================

export const canaryReleaseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseLineId: z.string().uuid(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  promptVersionId: z.string().uuid(),
  modelId: z.string().uuid(),
  inputConnectorId: z.string().uuid(),
  outputConnectorIds: z.array(z.string().uuid()),
  status: canaryReleaseStatusSchema,
  controlState: canaryReleaseControlStateSchema.nullable(),
  controlStatePayload: z.record(z.string(), z.unknown()).nullable(),
  trafficRatio: z.number().min(0).max(1),
  trafficMode: canaryReleaseTrafficModeSchema.default('split'),
  runMode: canaryReleaseRunModeSchema,
  stopConditions: canaryReleaseStopConditionsSchema.nullable(),
  recordMode: canaryReleaseRecordModeSchema,
  recordCategories: canaryReleaseRecordCategoriesSchema,
  filterRules: canaryReleaseFilterRulesSchema,
  variableMapping: canaryReleaseVariableMappingSchema,
  outputMapping: canaryReleaseOutputMappingSchema,
  externalIdField: z.string(),
  annotationSchema: canaryReleaseAnnotationSchemaSchema.nullable(),
  storageCategories: z.array(z.string()),
  targetDatasetId: z.string().uuid().nullable(),
  runConfig: canaryReleaseRunConfigSchema,
  totalReceived: z.number().int().nonnegative(),
  totalProcessed: z.number().int().nonnegative(),
  totalFiltered: z.number().int().nonnegative(),
  totalCorrect: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative(),
  metrics: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Join fields
  promptId: z.string().uuid().nullable(),
  promptName: z.string().nullable(),
  promptVersionLabel: z.string().nullable(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  inputConnectorName: z.string().nullable(),
  inputConnectorType: z.string().nullable(),
  outputConnectors: z.array(z.object({ id: z.string().uuid(), name: z.string(), type: z.string() })).default([]),
  targetDatasetName: z.string().nullable(),
  createdByName: z.string().nullable(),
  annotationTaskId: z.string().uuid().nullable(),
  releaseVersionId: z.string().uuid().nullable(),
  releaseVersionLabel: z.string().nullable(),
});
export type CanaryReleaseDto = z.infer<typeof canaryReleaseSchema>;

export const canaryReleaseListItemSchema = canaryReleaseSchema.extend({
  annotationProgress: z.object({
    total: z.number().int().nonnegative(),
    claimed: z.number().int().nonnegative(),
    submitted: z.number().int().nonnegative(),
  }),
  quality: z
    .object({
      precision: z.number().min(0).max(1),
      recall: z.number().min(0).max(1),
      f1: z.number().min(0).max(1),
    })
    .nullable(),
});
export type CanaryReleaseListItemDto = z.infer<typeof canaryReleaseListItemSchema>;

// ============================================================================
// Create / operation inputs
// ============================================================================

export const createCanaryReleaseInputSchema = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  promptVersionId: z.string().uuid(),
  modelId: z.string().uuid(),
  inputConnectorId: z.string().uuid(),
  outputConnectorIds: z.array(z.string().uuid()).default([]),
  trafficRatio: z.number().gt(0).lte(1),
  trafficMode: canaryReleaseTrafficModeSchema.default('split'),
  runMode: canaryReleaseRunModeSchema,
  recordMode: canaryReleaseRecordModeSchema.default('all'),
  recordCategories: canaryReleaseRecordCategoriesSchema,
  variableMapping: canaryReleaseVariableMappingSchema,
  outputMapping: canaryReleaseOutputMappingSchema.default([]),
  filterRules: canaryReleaseFilterRulesSchema.default(null),
  stopConditions: canaryReleaseStopConditionsSchema.nullable().default(null),
  externalIdField: z.string().min(1),
  annotationSchema: canaryReleaseAnnotationSchemaSchema.default([]),
  storageCategories: z.array(z.string()).default([]),
  targetDatasetId: z.string().uuid().nullable().default(null),
  runConfig: canaryReleaseRunConfigSchema,
});
export type CreateCanaryReleaseInputDto = z.infer<typeof createCanaryReleaseInputSchema>;

export const startCanaryReleaseInputSchema = z.object({}).optional();
export type StartCanaryReleaseInputDto = z.infer<typeof startCanaryReleaseInputSchema>;

export const stopCanaryReleaseInputSchema = z.object({}).default({});
export type StopCanaryReleaseInputDto = z.infer<typeof stopCanaryReleaseInputSchema>;

export const resumeCanaryReleaseInputSchema = z.object({}).default({});
export type ResumeCanaryReleaseInputDto = z.infer<typeof resumeCanaryReleaseInputSchema>;

export const cancelCanaryReleaseInputSchema = z.object({}).default({});
export type CancelCanaryReleaseInputDto = z.infer<typeof cancelCanaryReleaseInputSchema>;

export const updateCanaryTrafficRatioInputSchema = z.object({
  trafficRatio: z.number().min(0).max(1),
});
export type UpdateCanaryTrafficRatioInputDto = z.infer<typeof updateCanaryTrafficRatioInputSchema>;

// ============================================================================
// Annotation
// ============================================================================

export const canaryAnnotationStatusSchema = z.enum(['pending', 'claimed', 'submitted']);
export type CanaryAnnotationStatusDto = z.infer<typeof canaryAnnotationStatusSchema>;

export const canaryAnnotationDtoSchema = z.object({
  id: z.string().uuid(),
  canaryId: z.string().uuid(),
  taskId: z.string().uuid(),
  runResultId: z.string().uuid(),
  externalId: z.string().nullable(),
  inputPreview: z.string().nullable(),
  outputPreview: z.string().nullable(),
  inputVariables: z.record(z.string(), z.unknown()).nullable(),
  renderedPrompt: z.unknown().nullable(),
  decisionOutput: z.string().nullable(),
  rawResponse: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  isCorrect: z.boolean().nullable(),
  fields: z.record(z.string(), z.unknown()),
  notes: z.string().nullable(),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().datetime().nullable(),
  lockHeartbeatAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  submittedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type CanaryAnnotationDto = z.infer<typeof canaryAnnotationDtoSchema>;

export const claimCanaryAnnotationsInputSchema = z.object({
  batchSize: z.number().int().min(1).max(100),
});
export type ClaimCanaryAnnotationsInputDto = z.infer<typeof claimCanaryAnnotationsInputSchema>;

export const submitCanaryAnnotationInputSchema = z.object({
  annotationId: z.string().uuid(),
  isCorrect: z.boolean().nullable(),
  notes: z.string().nullable(),
  fields: z.record(z.string(), z.unknown()).default({}),
});
export type SubmitCanaryAnnotationInputDto = z.infer<typeof submitCanaryAnnotationInputSchema>;

export const releaseCanaryAnnotationInputSchema = z.object({
  annotationId: z.string().uuid(),
});
export type ReleaseCanaryAnnotationInputDto = z.infer<typeof releaseCanaryAnnotationInputSchema>;

// ============================================================================
// Constants
// ============================================================================

export const CANARY_RELEASE_STATUSES = canaryReleaseStatusSchema.options;
export const CANARY_RELEASE_RUN_MODES = canaryReleaseRunModeSchema.options;
export const CANARY_RELEASE_RECORD_MODES = canaryReleaseRecordModeSchema.options;
export const CANARY_RELEASE_TRAFFIC_MODES = canaryReleaseTrafficModeSchema.options;
export const CANARY_RELEASE_CONTROL_STATES = canaryReleaseControlStateSchema.options;
export const CANARY_RELEASE_FILTER_OPS = canaryReleaseFilterOpSchema.options;
export const CANARY_ANNOTATION_FIELD_TYPES = canaryReleaseAnnotationFieldTypeSchema.options;
