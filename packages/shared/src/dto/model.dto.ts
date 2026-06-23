import { z } from 'zod';

export const modelStatusSchema = z.enum(['enabled', 'testing', 'disabled']);
export type ModelStatus = z.infer<typeof modelStatusSchema>;

export const modelProbeStatusSchema = z.enum(['success', 'failed', 'pending']);
export type ModelProbeStatus = z.infer<typeof modelProbeStatusSchema>;

const modelProbeOutcomeStatusSchema = z.enum(['success', 'failed']);

export const modelImageCapabilitySchema = z.enum(['none', 'url', 'base64', 'both']);
export type ModelImageCapability = z.infer<typeof modelImageCapabilitySchema>;

export const MODEL_UNLIMITED_RATE_LIMIT = -1;
export const MODEL_DEFAULT_CONCURRENCY_LIMIT = 20;
export const MODEL_MAX_CONCURRENCY_LIMIT = 999;

// UI-selectable invocation protocols; the DTO keeps an open string to avoid locking existing legacy data and future adapters.
export const SUPPORTED_MODEL_PROVIDER_TYPES = ['openai', 'anthropic'] as const;
export type SupportedModelProviderType = (typeof SUPPORTED_MODEL_PROVIDER_TYPES)[number];

const modelRateLimitValueSchema = z
  .number()
  .int()
  .refine((value) => value === MODEL_UNLIMITED_RATE_LIMIT || value > 0);

const modelConcurrencyLimitValueSchema = z.number().int().min(1).max(MODEL_MAX_CONCURRENCY_LIMIT);

// limit = upper bound; usage = 0-100 percent; current = absolute counter in the current window (RPM/TPM) or in-flight count (concurrency)
export const modelLimitSchema = z.object({
  limit: modelRateLimitValueSchema,
  usage: z.number().min(0).max(100),
  current: z.number().nonnegative(),
});
export type ModelLimitDto = z.infer<typeof modelLimitSchema>;

// limit = concurrency ceiling; effective = system-derived in-flight cap when autoConcurrency is on (see 21 §6.1)
const modelConcurrencyLimitSchema = modelLimitSchema.extend({
  limit: modelConcurrencyLimitValueSchema,
  effective: z.number().int().positive().optional(),
});

export const modelPricingSchema = z.object({
  inputPerMillion: z.coerce.number().nonnegative(),
  outputPerMillion: z.coerce.number().nonnegative(),
});
export type ModelPricingDto = z.infer<typeof modelPricingSchema>;

export const modelCapabilitiesSchema = z.object({
  image: modelImageCapabilitySchema,
});
export type ModelCapabilitiesDto = z.infer<typeof modelCapabilitiesSchema>;

export const modelExtraBodySchema = z.record(z.string(), z.unknown()).optional();
export type ModelExtraBodyDto = z.infer<typeof modelExtraBodySchema>;

export const modelActiveUsageSchema = z.object({
  experiments: z.number().int().nonnegative(),
  canaryReleases: z.number().int().nonnegative(),
  optimizations: z.number().int().nonnegative(),
  productionReleases: z.number().int().nonnegative(),
});
export type ModelActiveUsageDto = z.infer<typeof modelActiveUsageSchema>;

// ---------------------------------------------------------------------------
// List item
// ---------------------------------------------------------------------------
const modelBaseListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  providerType: z.string(),
  providerModelId: z.string(),
  endpoint: z.string(),
  contextWindowTokens: z.number().int().positive().nullable(),
  credentialTail: z.string(),
  status: modelStatusSchema,
  probeStatus: modelProbeStatusSchema,
  lastProbedAt: z.string().datetime().nullable(),
  lastProbeError: z.string().nullable(),
  rpm: modelLimitSchema,
  tpm: modelLimitSchema,
  concurrency: modelConcurrencyLimitSchema,
  autoConcurrency: z.boolean(),
  pricing: modelPricingSchema,
  capabilities: modelCapabilitiesSchema,
  extraBody: modelExtraBodySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const projectModelListItemSchema = modelBaseListItemSchema.extend({
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  references: z.number().int().nonnegative(),
});
export type ProjectModelListItemDto = z.infer<typeof projectModelListItemSchema>;

// ---------------------------------------------------------------------------
// List response wrapper
// ---------------------------------------------------------------------------
export const projectModelListResponseSchema = z.object({
  data: z.array(projectModelListItemSchema),
  total: z.number().int().nonnegative(),
});
export type ProjectModelListResponseDto = z.infer<typeof projectModelListResponseSchema>;

// ---------------------------------------------------------------------------
// Create / update DTOs
// ---------------------------------------------------------------------------
const modelRateLimitInputSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .refine((value) => value === MODEL_UNLIMITED_RATE_LIMIT || value > 0),
});

const modelConcurrencyLimitInputSchema = z.object({
  limit: z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? MODEL_DEFAULT_CONCURRENCY_LIMIT : value),
    z.coerce.number().int().min(1).max(MODEL_MAX_CONCURRENCY_LIMIT),
  ),
});

const modelCreateStatusSchema = z.enum(['enabled', 'disabled']);

export const createModelInitialProbeSchema = z.object({
  status: modelProbeOutcomeStatusSchema,
  probedAt: z.string().datetime(),
  error: z.string().nullable(),
});
export type CreateModelInitialProbeDto = z.infer<typeof createModelInitialProbeSchema>;

const modelMutableFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  providerType: z.string().trim().min(1).max(80),
  providerModelId: z.string().trim().min(1).max(200),
  endpoint: z.string().trim().url(),
  apiKey: z.string().min(1),
  contextWindowTokens: z.coerce.number().int().positive().optional(),
  rpm: modelRateLimitInputSchema,
  tpm: modelRateLimitInputSchema,
  concurrency: modelConcurrencyLimitInputSchema.default({ limit: MODEL_DEFAULT_CONCURRENCY_LIMIT }),
  // When true (default), concurrency.limit is the ceiling and effective concurrency is auto-tuned. See 21 §6.1
  autoConcurrency: z.coerce.boolean().default(true),
  pricing: modelPricingSchema.default({ inputPerMillion: 0, outputPerMillion: 0 }),
  capabilities: modelCapabilitiesSchema.default({ image: 'none' }),
  extraBody: modelExtraBodySchema,
});

const createProjectModelBaseSchema = modelMutableFieldsSchema.extend({
  status: modelCreateStatusSchema.optional(),
});

export const createProjectModelSchema = createProjectModelBaseSchema.extend({
  initialProbe: createModelInitialProbeSchema.optional(),
});
export type CreateProjectModelDto = z.infer<typeof createProjectModelSchema>;

export const probeDraftProjectModelSchema = createProjectModelBaseSchema;
export type ProbeDraftProjectModelDto = z.infer<typeof probeDraftProjectModelSchema>;

export const updateProjectModelSchema = modelMutableFieldsSchema
  .omit({ apiKey: true })
  .partial()
  .extend({
    apiKey: z.string().min(1).optional(),
    status: modelStatusSchema.optional(),
  });
export type UpdateProjectModelDto = z.infer<typeof updateProjectModelSchema>;

// ---------------------------------------------------------------------------
// Sub-operation responses
// ---------------------------------------------------------------------------
export const modelReferencesSchema = modelActiveUsageSchema.extend({
  total: z.number().int().nonnegative(),
});
export type ModelReferencesDto = z.infer<typeof modelReferencesSchema>;

export const probeModelResponseSchema = z.object({
  modelId: z.string().uuid(),
  status: modelProbeOutcomeStatusSchema,
  probedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type ProbeModelResponseDto = z.infer<typeof probeModelResponseSchema>;

export const revealApiKeyResponseSchema = z.object({
  modelId: z.string().uuid(),
  apiKey: z.string(),
});
export type RevealApiKeyResponseDto = z.infer<typeof revealApiKeyResponseSchema>;

export const modelIdParamSchema = z.string().uuid();
export const modelDeleteQuerySchema = z.object({
  force: z.coerce.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ModelDeleteQueryDto = z.infer<typeof modelDeleteQuerySchema>;

export const modelExportFormatSchema = z.enum(['csv']);
export type ModelExportFormatDto = z.infer<typeof modelExportFormatSchema>;

// ---------------------------------------------------------------------------
// Model context dictionary (unchanged)
// ---------------------------------------------------------------------------
export const contextWindowTokensSchema = z.coerce.number().int().positive();

export const modelContextWindowResponseSchema = z.object({
  providerModelId: z.string(),
  contextWindowTokens: z.number().int().positive(),
  updatedBy: z.string().uuid().nullable(),
  updatedAt: z.string().datetime(),
});
export type ModelContextWindowResponseDto = z.infer<typeof modelContextWindowResponseSchema>;

export const listModelContextWindowsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListModelContextWindowsQueryDto = z.infer<typeof listModelContextWindowsQuerySchema>;

export const lookupModelContextWindowQuerySchema = z.object({
  providerModelId: z.string().trim().min(1).max(200),
});
export type LookupModelContextWindowQueryDto = z.infer<typeof lookupModelContextWindowQuerySchema>;

export const upsertModelContextWindowSchema = z.object({
  providerModelId: z.string().trim().min(1).max(200),
  contextWindowTokens: contextWindowTokensSchema,
});
export type UpsertModelContextWindowDto = z.infer<typeof upsertModelContextWindowSchema>;
