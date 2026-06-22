import { z } from 'zod';

export const promptIdParamSchema = z.string().uuid();
export const promptVersionIdParamSchema = z.string().uuid();

export const promptVersionStatusSchema = z.enum(['editable', 'frozen']);
export type PromptVersionStatusDto = z.infer<typeof promptVersionStatusSchema>;

export const promptStatusSchema = z.enum(['active', 'archived']);
export type PromptStatusDto = z.infer<typeof promptStatusSchema>;

export const reservedPromptVersionLabelSchema = z.enum(['latest', 'canary', 'production']);
export type ReservedPromptVersionLabelDto = z.infer<typeof reservedPromptVersionLabelSchema>;

export const PROMPT_VERSION_LABEL_NAME_PATTERN = /^[A-Za-z0-9\u4E00-\u9FFF][A-Za-z0-9\u4E00-\u9FFF_.:-]*$/u;

export const promptVersionLabelNameSchema = z.string().trim().min(1).max(64).regex(PROMPT_VERSION_LABEL_NAME_PATTERN);

export const promptVersionLabelTypeSchema = z.enum(['system', 'custom']);
export type PromptVersionLabelTypeDto = z.infer<typeof promptVersionLabelTypeSchema>;

export const promptVersionLabelSchema = z.object({
  name: promptVersionLabelNameSchema,
  type: promptVersionLabelTypeSchema,
});
export type PromptVersionLabelDto = z.infer<typeof promptVersionLabelSchema>;

export const promptListCustomLabelSchema = z.object({
  name: promptVersionLabelNameSchema,
  versionNumber: z.number().int().positive(),
});
export type PromptListCustomLabelDto = z.infer<typeof promptListCustomLabelSchema>;

export const DEFAULT_PROMPT_LANGUAGE = 'zh-CN' as const;
export const promptLanguageSchema = z.enum(['zh-CN', 'en-US']);
export type PromptLanguageDto = z.infer<typeof promptLanguageSchema>;

export const promptVariableTypeSchema = z.enum(['text', 'image', 'image_url', 'image_base64', 'number']);
export type PromptVariableTypeDto = z.infer<typeof promptVariableTypeSchema>;

export const promptVariableSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: promptVariableTypeSchema,
  required: z.boolean(),
  description: z.string().trim().max(500).optional(),
  datasetField: z.string().trim().max(160).optional(),
});
export type PromptVariableDto = z.infer<typeof promptVariableSchema>;

export const promptOutputSchemaFieldSchema = z.object({
  key: z.string().trim().min(1).max(160),
  value: z.string().trim().max(2000).default(''),
  isJudgment: z.boolean().default(false),
});
export type PromptOutputSchemaFieldDto = z.infer<typeof promptOutputSchemaFieldSchema>;

export const promptOutputSchema = z
  .object({
    fields: z.array(promptOutputSchemaFieldSchema).max(50).default([]),
  })
  .nullable();
export type PromptOutputSchemaDto = z.infer<typeof promptOutputSchema>;

export const DEFAULT_PROMPT_JUDGMENT_DECISION_FIELD = 'label';
export const DEFAULT_PROMPT_JUDGMENT_EXPECTED_FIELD = 'expected_output';
export const DEFAULT_PROMPT_JUDGMENT_OPERATOR = 'exact_match';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStringAlias(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function isThresholdComparisonOperator(value: string | undefined): value is 'gt' | 'gte' | 'lt' | 'lte' | 'eq' {
  return value === 'gt' || value === 'gte' || value === 'lt' || value === 'lte' || value === 'eq';
}

function readJudgmentOperatorAlias(source: Record<string, unknown>): string | undefined {
  const explicitMode = readStringAlias(source, ['mode', 'ruleName']);
  if (explicitMode) return explicitMode;
  const operator = readStringAlias(source, ['operator']);
  if (isThresholdComparisonOperator(operator) && source['threshold'] !== undefined) return 'threshold';
  return operator;
}

function readThresholdOperatorAlias(source: Record<string, unknown>): string | undefined {
  const explicit = readStringAlias(source, ['thresholdOperator', 'comparisonOperator']);
  if (explicit) return explicit;
  const operator = readStringAlias(source, ['operator']);
  return isThresholdComparisonOperator(operator) ? operator : undefined;
}

function sanitizeRuleExtras(source: Record<string, unknown>): Record<string, unknown> {
  const extra = { ...source };
  for (const key of ['decision_field', 'expected_field', 'field', 'value', 'mode', 'ruleName', 'config']) {
    delete extra[key];
  }
  if (typeof extra['id'] !== 'string' || extra['id'].trim().length === 0) delete extra['id'];
  if (typeof extra['description'] !== 'string') delete extra['description'];
  return extra;
}

function sanitizeRulesRootExtras(source: Record<string, unknown>): Record<string, unknown> {
  const extra = sanitizeRuleExtras(source);
  for (const key of ['decisionField', 'expectedField', 'operator', 'description', 'id', 'threshold']) {
    delete extra[key];
  }
  return extra;
}

function mergeLegacyConfig(source: Record<string, unknown>): Record<string, unknown> {
  const config = isRecord(source['config']) ? source['config'] : null;
  return config ? { ...config, ...source } : source;
}

function hasRuleSignal(rule: Record<string, unknown>, root?: JudgmentRuleRootAliases): boolean {
  return Boolean(
    readStringAlias(rule, ['decisionField', 'decision_field', 'field']) ??
      readStringAlias(rule, ['expectedField', 'expected_field', 'value']) ??
      readStringAlias(rule, ['operator', 'mode', 'ruleName']) ??
      root?.decisionField ??
      root?.expectedField ??
      root?.operator ??
      rule['threshold'] ??
      rule['description'],
  );
}

interface JudgmentRuleRootAliases {
  decisionField?: string;
  expectedField?: string;
  operator?: string;
}

function readRuleRootAliases(source: Record<string, unknown>): JudgmentRuleRootAliases {
  const merged = mergeLegacyConfig(source);
  return {
    decisionField: readStringAlias(merged, ['decisionField', 'decision_field', 'field']),
    expectedField: readStringAlias(merged, ['expectedField', 'expected_field', 'value']),
    operator: readJudgmentOperatorAlias(merged),
  };
}

function normalizePromptJudgmentRuleInput(
  value: unknown,
  root?: JudgmentRuleRootAliases,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const merged = mergeLegacyConfig(value);
  if (!hasRuleSignal(merged, root)) return null;

  const extra = sanitizeRuleExtras(merged);
  const thresholdOperator = readThresholdOperatorAlias(merged);
  if (thresholdOperator && extra['thresholdOperator'] === undefined) {
    extra['thresholdOperator'] = thresholdOperator;
  }
  return {
    ...extra,
    decisionField:
      readStringAlias(merged, ['decisionField', 'decision_field', 'field']) ??
      root?.decisionField ??
      DEFAULT_PROMPT_JUDGMENT_DECISION_FIELD,
    expectedField:
      readStringAlias(merged, ['expectedField', 'expected_field', 'value']) ??
      root?.expectedField ??
      DEFAULT_PROMPT_JUDGMENT_EXPECTED_FIELD,
    operator: readJudgmentOperatorAlias(merged) ?? root?.operator ?? DEFAULT_PROMPT_JUDGMENT_OPERATOR,
  };
}

function normalizePromptJudgmentRulesInput(value: unknown): unknown {
  if (!isRecord(value)) return null;

  const merged = mergeLegacyConfig(value);
  const root = readRuleRootAliases(value);
  const rootExtras = sanitizeRulesRootExtras(merged);
  delete rootExtras['rules'];

  const rawRules = Array.isArray(value['rules']) ? value['rules'] : merged['rules'];
  if (Array.isArray(rawRules)) {
    const rules = rawRules
      .map((rule) => normalizePromptJudgmentRuleInput(rule, root))
      .filter((rule): rule is Record<string, unknown> => Boolean(rule));
    if (rules.length === 0) {
      const directRule = normalizePromptJudgmentRuleInput(value);
      return { ...rootExtras, rules: directRule ? [directRule] : [] };
    }
    return { ...rootExtras, rules };
  }

  const directRule = normalizePromptJudgmentRuleInput(value);
  return { ...rootExtras, rules: directRule ? [directRule] : [] };
}

export const promptJudgmentOperatorSchema = z.string().trim().min(1).max(80);
export const promptJudgmentRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(120).optional(),
    decisionField: z.string().trim().min(1).max(160),
    expectedField: z.string().trim().min(1).max(160),
    operator: promptJudgmentOperatorSchema.default(DEFAULT_PROMPT_JUDGMENT_OPERATOR),
    description: z.string().trim().max(1000).optional(),
  })
  .passthrough();
export type PromptJudgmentRuleDto = z.infer<typeof promptJudgmentRuleSchema>;

const promptJudgmentRulesObjectSchema = z
  .object({
    rules: z.array(promptJudgmentRuleSchema).max(50).default([]),
  })
  .passthrough();

export const promptJudgmentRulesSchema = z.preprocess(
  normalizePromptJudgmentRulesInput,
  promptJudgmentRulesObjectSchema.nullable(),
);
export type PromptJudgmentRulesDto = z.infer<typeof promptJudgmentRulesSchema>;

export function normalizePromptJudgmentRules(value: unknown): PromptJudgmentRulesDto {
  return promptJudgmentRulesSchema.parse(value);
}

function readPromptJudgmentField(
  value: unknown,
  keys: string[],
  fallback: string,
): string {
  const explicit = readExplicitPromptJudgmentField(value, keys);
  return explicit ?? fallback;
}

function readExplicitPromptJudgmentField(value: unknown, keys: string[]): string | null {
  if (!isRecord(value)) return null;

  const merged = mergeLegacyConfig(value);
  const rootValue = readStringAlias(merged, keys) ?? null;
  const rawRules = Array.isArray(value['rules']) ? value['rules'] : merged['rules'];
  if (Array.isArray(rawRules)) {
    for (const rule of rawRules) {
      if (!isRecord(rule)) continue;
      const ruleMerged = mergeLegacyConfig(rule);
      const ruleValue = readStringAlias(ruleMerged, keys);
      if (ruleValue) return ruleValue;
      if (rootValue && hasRuleSignal(ruleMerged)) return rootValue;
    }
    return rootValue;
  }

  return rootValue;
}

export function readPromptJudgmentExpectedField(
  value: unknown,
  fallback = DEFAULT_PROMPT_JUDGMENT_EXPECTED_FIELD,
): string {
  return readPromptJudgmentField(value, ['expectedField', 'expected_field', 'value'], fallback);
}

export function readPromptJudgmentDecisionField(
  value: unknown,
  fallback = DEFAULT_PROMPT_JUDGMENT_DECISION_FIELD,
): string {
  return readPromptJudgmentField(value, ['decisionField', 'decision_field', 'field'], fallback);
}

export const promptVersionSchema = z.object({
  id: z.string().uuid(),
  promptId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  status: promptVersionStatusSchema,
  body: z.string(),
  variables: z.array(promptVariableSchema),
  outputSchema: promptOutputSchema,
  judgmentRules: promptJudgmentRulesSchema,
  promptLanguage: promptLanguageSchema.default(DEFAULT_PROMPT_LANGUAGE),
  parentVersionId: z.string().uuid().nullable(),
  generatedByOptimizationId: z.string().uuid().nullable(),
  changeReason: z.string().nullable(),
  labels: z.array(promptVersionLabelSchema).default([]),
  isFrozen: z.boolean(),
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime().nullable(),
});
export type PromptVersionDto = z.infer<typeof promptVersionSchema>;

export const promptListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  status: promptStatusSchema,
  defaultDatasetId: z.string().uuid().nullable(),
  defaultDatasetName: z.string().nullable(),
  latestVersionNumber: z.number().int().positive(),
  currentOnlineVersionNumber: z.number().int().positive().nullable(),
  currentCanaryVersionNumber: z.number().int().positive().nullable(),
  customLabels: z.array(promptListCustomLabelSchema).default([]),
  latestVersionStatus: promptVersionStatusSchema,
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  activeReferences: z.number().int().nonnegative(),
});
export type PromptListItemDto = z.infer<typeof promptListItemSchema>;

export const promptDetailSchema = promptListItemSchema.extend({
  versions: z.array(promptVersionSchema),
});
export type PromptDetailDto = z.infer<typeof promptDetailSchema>;

export const createPromptSchema = z.object({
  name: z.string().trim().min(1).max(160),
  defaultDatasetId: z.string().uuid().optional(),
  promptLanguage: promptLanguageSchema.default(DEFAULT_PROMPT_LANGUAGE),
});
export type CreatePromptDto = z.input<typeof createPromptSchema>;

export const updatePromptSchema = z.object({
  defaultDatasetId: z.string().uuid(),
});
export type UpdatePromptDto = z.infer<typeof updatePromptSchema>;

export const updatePromptDraftVersionSchema = z.object({
  body: z.string(),
  variables: z.array(promptVariableSchema).max(200),
  outputSchema: promptOutputSchema,
  judgmentRules: promptJudgmentRulesSchema,
  promptLanguage: promptLanguageSchema.default(DEFAULT_PROMPT_LANGUAGE),
  changeReason: z.string().trim().max(1000).optional().nullable(),
});
export type UpdatePromptDraftVersionDto = z.input<typeof updatePromptDraftVersionSchema>;

export const createPromptDraftVersionSchema = z.object({
  sourceVersionId: promptVersionIdParamSchema.optional(),
  changeReason: z.string().trim().max(1000).optional(),
});
export type CreatePromptDraftVersionDto = z.infer<typeof createPromptDraftVersionSchema>;

export const updatePromptVersionLabelSchema = z.object({
  label: promptVersionLabelNameSchema,
  versionId: promptVersionIdParamSchema.nullable(),
});
export type UpdatePromptVersionLabelDto = z.infer<typeof updatePromptVersionLabelSchema>;

export const promptDeletionImpactItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['release_line', 'experiment', 'optimization']),
  name: z.string().nullable(),
  status: z.string().nullable(),
  promptId: z.string().uuid().nullable(),
  promptVersionId: z.string().uuid().nullable(),
  promptVersionNumber: z.number().int().positive().nullable(),
  createdAt: z.string().datetime().nullable(),
});
export type PromptDeletionImpactItemDto = z.infer<typeof promptDeletionImpactItemSchema>;

export const promptDeletionImpactSchema = z.object({
  promptId: z.string().uuid(),
  versionId: z.string().uuid().nullable(),
  releaseLines: z.array(promptDeletionImpactItemSchema),
  experiments: z.array(promptDeletionImpactItemSchema),
  optimizations: z.array(promptDeletionImpactItemSchema),
  total: z.number().int().nonnegative(),
});
export type PromptDeletionImpactDto = z.infer<typeof promptDeletionImpactSchema>;

export const promptVersionMetricsItemSchema = z.object({
  promptVersionId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  status: promptVersionStatusSchema,
  labels: z.array(promptVersionLabelSchema),
  runCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  incorrectCount: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1).nullable(),
  medianLatencyMs: z.number().nonnegative().nullable(),
  medianInputTokens: z.number().nonnegative().nullable(),
  medianOutputTokens: z.number().nonnegative().nullable(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCostEstimate: z.number().nonnegative(),
  firstRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
});
export type PromptVersionMetricsItemDto = z.infer<typeof promptVersionMetricsItemSchema>;

export const promptMetricsSummarySchema = z.object({
  runCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCostEstimate: z.number().nonnegative(),
});
export type PromptMetricsSummaryDto = z.infer<typeof promptMetricsSummarySchema>;

export const promptMetricsSchema = z.object({
  promptId: z.string().uuid(),
  versions: z.array(promptVersionMetricsItemSchema),
  totals: promptMetricsSummarySchema,
});
export type PromptMetricsDto = z.infer<typeof promptMetricsSchema>;

export const promptTryRunRequestSchema = z.object({
  promptVersionId: promptVersionIdParamSchema,
  modelId: z.string().uuid(),
  variables: z.record(z.string(), z.unknown()).default({}),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32000).optional(),
  timeoutSeconds: z.number().int().positive().max(600).optional(),
});
export type PromptTryRunRequestDto = z.infer<typeof promptTryRunRequestSchema>;

export const promptTryRunResponseSchema = z.object({
  status: z.enum(['success', 'error']),
  rawOutput: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costEstimate: z.number().nonnegative(),
  errorClass: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type PromptTryRunResponseDto = z.infer<typeof promptTryRunResponseSchema>;
