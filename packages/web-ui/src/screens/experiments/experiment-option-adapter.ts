import {
  DEFAULT_PROMPT_LANGUAGE,
  type DatasetFieldSchemaDto,
  type DatasetListItemDto,
  type ModelImageCapability,
  type ProjectModelListItemDto,
  type PromptDetailDto,
  type PromptListItemDto,
  type PromptVariableTypeDto,
  type PromptVersionDto,
} from '@proofhound/shared';
import { formatDateTime } from '../../lib';
import type {
  ExperimentDatasetOption,
  ExperimentModelOption,
  ExperimentPromptOption,
} from './experiment-view-model';
import { composePromptPreview } from '../prompts/prompt-preview';

// Rough per-sample average token usage. The backend has no estimation endpoint (SPEC 24 does not plan one); use an empirical constant for now;
// replace with a dynamic value computed by the selected prompt / dataset once a real estimation endpoint lands.
export const AVG_TOKENS_IN_PER_SAMPLE = 400;
export const AVG_TOKENS_OUT_PER_SAMPLE = 80;
type DateTimeFormatter = (value: string | null | undefined) => string;

const IMAGE_PROMPT_VARIABLE_TYPES = new Set<PromptVariableTypeDto>(['image', 'image_url', 'image_base64']);
const IMAGE_DATASET_FIELD_ROLES = new Set<DatasetFieldSchemaDto['role']>(['image', 'image_url', 'image_base64']);

export function hasImagePromptVariables(
  variables: ReadonlyArray<{ type: string }>,
): boolean {
  return variables.some((variable) => IMAGE_PROMPT_VARIABLE_TYPES.has(variable.type as PromptVariableTypeDto));
}

function isDatasetFieldCompatibleWithPromptVariable(
  variableType: string,
  field: Pick<DatasetFieldSchemaDto, 'role' | 'type'>,
): boolean {
  if (IMAGE_PROMPT_VARIABLE_TYPES.has(variableType as PromptVariableTypeDto)) {
    return IMAGE_DATASET_FIELD_ROLES.has(field.role);
  }
  if (variableType === 'number') {
    return field.role === 'text' && field.type === 'number';
  }
  return variableType === 'text' && field.role === 'text';
}

export interface DatasetVariableCoverageResult {
  ok: boolean;
  coveredVariables: string[];
  missingVariables: string[];
}

export function validateDatasetVariableCoverage(input: {
  variables: ReadonlyArray<{ name: string; type: string; datasetField?: string | null }>;
  fieldSchema: ReadonlyArray<Pick<DatasetFieldSchemaDto, 'name' | 'role' | 'type'>>;
}): DatasetVariableCoverageResult {
  const coveredVariables: string[] = [];
  const missingVariables: string[] = [];

  for (const variable of input.variables) {
    const fieldName = variable.datasetField?.trim() || variable.name;
    const field = input.fieldSchema.find((candidate) => candidate.name === fieldName);
    if (field && isDatasetFieldCompatibleWithPromptVariable(variable.type, field)) {
      coveredVariables.push(variable.name);
    } else {
      missingVariables.push(variable.name);
    }
  }

  return {
    ok: missingVariables.length === 0,
    coveredVariables,
    missingVariables,
  };
}

export function getModelImageEncodings(capability: ModelImageCapability | undefined): EncodingMode[] {
  if (capability === 'url') return ['url'];
  if (capability === 'base64') return ['base64'];
  if (capability === 'both') return ['url', 'base64'];
  return [];
}

export type EncodingMode = 'url' | 'base64';

function formatOptionDateTime(value: string | null | undefined, formatter?: DateTimeFormatter) {
  return formatter ? formatter(value) : formatDateTime(value);
}

export function mapDatasetToOption(dto: DatasetListItemDto, formatter?: DateTimeFormatter): ExperimentDatasetOption {
  const expectedField = dto.fieldSchema.find((field) => field.role === 'expected_output')?.name;
  const inputFieldCount = dto.fieldSchema.filter(
    (field) => field.role !== 'expected_output' && field.role !== 'metadata',
  ).length;
  return {
    id: dto.id,
    name: dto.name,
    sampleCount: dto.sampleCount,
    description: dto.description ?? '',
    expectedField,
    inputFieldCount,
    updatedAgo: formatOptionDateTime(dto.updatedAt, formatter),
    allFieldsOk: true,
  };
}

export function mapProjectModelToOption(dto: ProjectModelListItemDto): ExperimentModelOption {
  const capabilities: ExperimentModelOption['capabilities'] = [];
  if (dto.providerType.toLowerCase().includes('vllm') || dto.providerType.toLowerCase().includes('self')) {
    capabilities.push('local');
  }
  return {
    id: dto.id,
    name: dto.name,
    provider: dto.providerType,
    contextWindow: formatContextWindow(dto.contextWindowTokens),
    imageCapability: dto.capabilities.image,
    capabilities,
    rpm: dto.rpm.limit,
    rpmLimit: dto.rpm.limit,
    tpm: formatRateLimitNumber(dto.tpm.limit),
    tpmLimit: dto.tpm.limit,
    concurrencyLimit: dto.concurrency.limit,
    inputPricePerMillion: dto.pricing.inputPerMillion,
    outputPricePerMillion: dto.pricing.outputPerMillion,
    pricePer1Mt: dto.pricing.inputPerMillion.toFixed(2),
  };
}

export type PromptForOption = Pick<
  PromptListItemDto | PromptDetailDto,
  'name' | 'latestVersionNumber' | 'defaultDatasetId'
>;

export function mapPromptVersionToOption(
  prompt: PromptForOption,
  version: PromptVersionDto,
  formatter?: DateTimeFormatter,
): ExperimentPromptOption {
  const promptLanguage = version.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;

  return {
    id: version.id,
    name: prompt.name,
    version: `v${version.versionNumber}`,
    isLatest: version.versionNumber === prompt.latestVersionNumber,
    ownerHandle: version.createdByDisplayName ? `@${version.createdByDisplayName}` : '@unknown',
    updatedAgo: formatOptionDateTime(version.createdAt, formatter),
    variableCount: version.variables.length,
    defaultDatasetId: prompt.defaultDatasetId ?? '',
    promptLanguage,
    variables: version.variables.map((variable) => ({
      name: variable.name,
      type: variable.type,
      required: variable.required,
      datasetField: variable.datasetField ?? null,
    })),
    promptPreview: composePromptPreview({
      body: version.body,
      outputSchema: version.outputSchema,
      promptLanguage,
    }),
    template: version.body,
    status: version.status,
  };
}

export interface ExperimentEstimateInput {
  totalSamples: number;
  concurrency: number;
  rpmLimit: number; // -1 means unlimited
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface ExperimentEstimate {
  totalSamples: number;
  durationSeconds: number;
  durationLabel: string;
  tokensIn: number;
  tokensOut: number;
  tokensLabel: string;
  tokensInLabel: string;
  tokensOutLabel: string;
  cost: number;
  costLabel: string;
}

const EMPTY_PLACEHOLDER = '—';
const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;

export function resolveExperimentDatasetId(input: {
  explicitDatasetId?: string | null;
  promptDefaultDatasetId?: string | null;
  datasetIds: readonly string[];
}): string | null {
  const availableDatasetIds = new Set(input.datasetIds);
  const explicitDatasetId = input.explicitDatasetId?.trim();
  if (explicitDatasetId && availableDatasetIds.has(explicitDatasetId)) return explicitDatasetId;

  const promptDefaultDatasetId = input.promptDefaultDatasetId?.trim();
  if (promptDefaultDatasetId && availableDatasetIds.has(promptDefaultDatasetId)) return promptDefaultDatasetId;

  return input.datasetIds[0] ?? null;
}

export function normalizeTemperature(value: number): number {
  if (!Number.isFinite(value)) return TEMPERATURE_MIN;
  const clamped = Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, value));
  return Number(clamped.toFixed(1));
}

function isPositiveNumberText(value: string): boolean {
  if (value.trim().length === 0) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isNonNegativeIntegerText(value: string): boolean {
  if (value.trim().length === 0) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
}

export function isExperimentRunParamsComplete(input: {
  concurrency: number;
  rpm: string;
  tpm: string;
  temperature: number;
  timeoutSeconds: string;
  retries: string;
  encoding: 'url' | 'base64';
}): boolean {
  return (
    Number.isFinite(input.concurrency) &&
    input.concurrency > 0 &&
    input.temperature >= TEMPERATURE_MIN &&
    input.temperature <= TEMPERATURE_MAX &&
    isPositiveNumberText(input.rpm) &&
    isPositiveNumberText(input.tpm) &&
    isPositiveNumberText(input.timeoutSeconds) &&
    isNonNegativeIntegerText(input.retries) &&
    (input.encoding === 'url' || input.encoding === 'base64')
  );
}

export function estimateExperimentRun(input: ExperimentEstimateInput): ExperimentEstimate {
  const samples = Math.max(0, Math.floor(input.totalSamples));
  const tokensIn = samples * AVG_TOKENS_IN_PER_SAMPLE;
  const tokensOut = samples * AVG_TOKENS_OUT_PER_SAMPLE;
  const cost = (tokensIn * input.inputPricePerMillion + tokensOut * input.outputPricePerMillion) / 1_000_000;

  let throughputPerSec = input.concurrency > 0 ? input.concurrency : 0;
  if (input.rpmLimit > 0) {
    const rpmThroughput = input.rpmLimit / 60;
    throughputPerSec = throughputPerSec > 0 ? Math.min(throughputPerSec, rpmThroughput) : rpmThroughput;
  }
  const durationSeconds = samples > 0 && throughputPerSec > 0 ? samples / throughputPerSec : 0;

  return {
    totalSamples: samples,
    durationSeconds,
    durationLabel:
      samples === 0 || durationSeconds === 0 ? EMPTY_PLACEHOLDER : `~ ${formatDurationLabel(durationSeconds)}`,
    tokensIn,
    tokensOut,
    tokensLabel: samples === 0 ? EMPTY_PLACEHOLDER : `~ ${formatTokenCount(tokensIn + tokensOut)}`,
    tokensInLabel: formatTokenCount(tokensIn),
    tokensOutLabel: formatTokenCount(tokensOut),
    cost,
    costLabel: samples === 0 ? EMPTY_PLACEHOLDER : `~ $ ${cost.toFixed(2)}`,
  };
}

export function formatContextWindow(tokens: number | null): string {
  if (!tokens || tokens <= 0) return EMPTY_PLACEHOLDER;
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return tokens.toString();
}

export function formatRateLimitNumber(limit: number): string {
  if (limit < 0) return '∞';
  if (limit >= 1_000_000) {
    const value = limit / 1_000_000;
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`;
  }
  if (limit >= 1_000) return `${Math.round(limit / 1_000)}K`;
  return limit.toString();
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

export function formatDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return EMPTY_PLACEHOLDER;
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m} m ${s} s` : `${m} m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h} h ${m} m` : `${h} h`;
}
