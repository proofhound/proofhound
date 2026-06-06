import { createHash } from 'node:crypto';
import type { LlmJobPayload } from '@proofhound/orchestration-shared';
import type {
  CanaryReleaseFilterNodeDto,
  CanaryReleaseOutputMappingItemDto,
  CanaryReleaseVariableMappingItemDto,
  PromptLanguageDto,
  PromptOutputSchemaDto,
  PromptVariableDto,
} from '@proofhound/shared';
import { renderPromptForSample } from '../experiment/experiment.renderer';

const RUN_RESULT_NS = 'a82c98fb-8785-4f34-bf32-1e91c8dfeb2c';

export class CanaryRuntimeInputError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'CanaryRuntimeInputError';
  }
}

export interface CanaryRuntimeConfig {
  id: string;
  projectId: string;
  orgId?: string;
  releaseVariantId?: string | null;
  promptVersionId: string;
  promptId: string;
  modelId: string;
  variableMapping: unknown;
  filterRules: unknown;
  externalIdField: string;
  runConfig: Record<string, unknown>;
  promptBody: string;
  promptVariables: unknown;
  promptOutputSchema: unknown;
  promptJudgmentRules: unknown;
  promptLanguage: string;
  outputMapping?: unknown;
}

export interface CanaryRunResultForOutput {
  id: string;
  createdAt: Date;
  externalId: string | null;
  status: string;
  rawResponse: string | null;
  parsedOutput: unknown;
  decisionOutput: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costEstimate: number | null;
}

export function normalizeQueuePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CanaryRuntimeInputError('canary_payload_must_be_object');
  }
  return payload as Record<string, unknown>;
}

export function matchesCanaryFilter(filterRules: unknown, payload: Record<string, unknown>): boolean {
  if (!filterRules) return true;
  return evaluateFilter(filterRules as CanaryReleaseFilterNodeDto, payload);
}

export function mapCanaryVariables(
  canary: Pick<CanaryRuntimeConfig, 'variableMapping' | 'externalIdField'>,
  payload: Record<string, unknown>,
): { externalId: string; inputVariables: Record<string, unknown> } {
  const mapping = normalizeVariableMapping(canary.variableMapping);
  const inputVariables: Record<string, unknown> = {};
  const externalId = readPath(payload, canary.externalIdField);

  for (const item of mapping) {
    if (item.target === 'id') continue;
    const value = readMappedValue(payload, item);
    if (item.required && value === undefined) {
      throw new CanaryRuntimeInputError(
        'canary_missing_required_field',
        `canary_missing_required_field:${item.source}`,
      );
    }
    if (value !== undefined) inputVariables[item.target] = value;
  }

  if (externalId === undefined || externalId === null || String(externalId).trim().length === 0) {
    throw new CanaryRuntimeInputError('canary_missing_external_id');
  }

  return { externalId: String(externalId), inputVariables };
}

export function readReleaseExternalId(
  release: Pick<CanaryRuntimeConfig, 'externalIdField'>,
  payload: Record<string, unknown>,
): string {
  const externalId = readPath(payload, release.externalIdField);
  if (externalId === undefined || externalId === null || String(externalId).trim().length === 0) {
    throw new CanaryRuntimeInputError('release_missing_external_id');
  }
  return String(externalId);
}

export function buildReleaseLlmPayload(input: {
  release: CanaryRuntimeConfig;
  inputVariables: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
  externalId: string;
  runResultId: string;
}): LlmJobPayload {
  const { renderedPrompt } = renderPromptForSample(
    {
      body: input.release.promptBody,
      variables: normalizePromptVariables(input.release.promptVariables),
      outputSchema: normalizePromptOutputSchema(input.release.promptOutputSchema),
      promptLanguage: input.release.promptLanguage as PromptLanguageDto,
    },
    { data: input.inputVariables },
  );
  const expectedOutput = readReleaseExpectedOutput(input.release.promptJudgmentRules, {
    inputVariables: input.inputVariables,
    rawPayload: input.rawPayload,
  });

  return {
    projectId: input.release.projectId,
    ...(input.release.orgId ? { orgId: input.release.orgId } : {}),
    source: 'release',
    sourceId: input.release.id,
    releaseVariantId: input.release.releaseVariantId ?? null,
    promptVersionId: input.release.promptVersionId,
    promptId: input.release.promptId,
    modelId: input.release.modelId,
    runResultId: input.runResultId,
    sampleId: null,
    externalId: input.externalId,
    renderedPrompt,
    inputVariables: input.inputVariables,
    inference: pickInference(input.release.runConfig),
    limits: pickLimits(input.release.runConfig),
    retry: pickRetry(input.release.runConfig),
    judgment:
      expectedOutput === undefined
        ? undefined
        : {
            outputSchema: input.release.promptOutputSchema ?? null,
            judgmentRules: input.release.promptJudgmentRules ?? null,
            expectedOutput,
          },
  };
}

export function buildReleaseOutputPayload(input: {
  release: Pick<CanaryRuntimeConfig, 'id' | 'outputMapping'>;
  runResult: CanaryRunResultForOutput;
}): Record<string, unknown> {
  const { release, runResult } = input;
  const error =
    runResult.status === 'success'
      ? null
      : {
          class: runResult.errorClass,
          message: runResult.errorMessage,
        };

  return {
    external_id: runResult.externalId,
    run_result_id: runResult.id,
    status: runResult.status,
    result: buildOutputResult(release.outputMapping, runResult),
    raw_response: runResult.rawResponse,
    parsed_output: runResult.parsedOutput,
    decision_output: runResult.decisionOutput,
    error,
    metrics: {
      latency_ms: runResult.latencyMs,
      input_tokens: runResult.inputTokens,
      output_tokens: runResult.outputTokens,
      cost_estimate: runResult.costEstimate,
    },
    source: {
      type: 'release',
      id: release.id,
    },
    created_at: runResult.createdAt.toISOString(),
  };
}

function uuidFromSeed(seed: string): string {
  const hash = createHash('sha1').update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function computeReleaseRunResultId(releaseLineEventId: string, messageId: string): string {
  return uuidFromSeed(`${RUN_RESULT_NS}:release:${releaseLineEventId}:${messageId}`);
}

export function passesTrafficRatio(canaryId: string, externalId: string, trafficRatio: number): boolean {
  if (trafficRatio >= 1) return true;
  if (trafficRatio <= 0) return false;
  const hex = createHash('sha1').update(`${canaryId}:${externalId}:traffic`).digest('hex').slice(0, 8);
  const bucket = Number.parseInt(hex, 16) / 0xffffffff;
  return bucket < trafficRatio;
}

function readMappedValue(payload: Record<string, unknown>, item: CanaryReleaseVariableMappingItemDto): unknown {
  const value = readPath(payload, item.source);
  if (value !== undefined) return value;
  return item.defaultValue;
}

function normalizeVariableMapping(value: unknown): CanaryReleaseVariableMappingItemDto[] {
  if (Array.isArray(value)) return value as CanaryReleaseVariableMappingItemDto[];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].length > 0)
    .map(([target, source]) => ({
      source,
      target,
      required: target === 'id',
    }));
}

function buildOutputResult(outputMapping: unknown, runResult: CanaryRunResultForOutput): unknown {
  const mapping = Array.isArray(outputMapping) ? (outputMapping as CanaryReleaseOutputMappingItemDto[]) : [];
  if (mapping.length === 0) {
    return runResult.parsedOutput ?? runResult.decisionOutput ?? runResult.rawResponse ?? null;
  }

  const result: Record<string, unknown> = {};
  for (const item of mapping) {
    const value = readOutputSource(runResult, item.source);
    if (value !== undefined) writePath(result, item.target, value);
  }
  return result;
}

function readOutputSource(runResult: CanaryRunResultForOutput, source: string): unknown {
  if (source === 'external_id') return runResult.externalId;
  if (source === 'run_result_id') return runResult.id;
  if (source === 'status') return runResult.status;
  if (source === 'raw_response') return runResult.rawResponse;
  if (source === 'parsed_output') return runResult.parsedOutput;
  if (source === 'decision_output') return runResult.decisionOutput;

  if (runResult.parsedOutput && typeof runResult.parsedOutput === 'object' && !Array.isArray(runResult.parsedOutput)) {
    return readPath(runResult.parsedOutput as Record<string, unknown>, source);
  }
  return undefined;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  if (!path) return;
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) return;
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!segment) return;
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1];
  if (leaf) current[leaf] = value;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

function readReleaseExpectedOutput(
  judgmentRules: unknown,
  input: { inputVariables: Record<string, unknown>; rawPayload?: Record<string, unknown> },
): unknown {
  const expectedField = readExpectedField(judgmentRules);
  const fromInputVariables = readPath(input.inputVariables, expectedField);
  if (fromInputVariables !== undefined) return fromInputVariables;
  return input.rawPayload ? readPath(input.rawPayload, expectedField) : undefined;
}

function readExpectedField(judgmentRules: unknown): string {
  if (!judgmentRules || typeof judgmentRules !== 'object' || Array.isArray(judgmentRules)) return 'expected_output';
  const record = judgmentRules as Record<string, unknown>;
  const direct = record['expected_field'] ?? record['expectedField'];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  const rules = record['rules'];
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
      const nested =
        (rule as Record<string, unknown>)['expected_field'] ?? (rule as Record<string, unknown>)['expectedField'];
      if (typeof nested === 'string' && nested.trim().length > 0) return nested.trim();
    }
  }
  return 'expected_output';
}

function evaluateFilter(node: CanaryReleaseFilterNodeDto, payload: Record<string, unknown>): boolean {
  if (node.type === 'and') return node.children.every((child) => evaluateFilter(child, payload));
  if (node.type === 'or') return node.children.some((child) => evaluateFilter(child, payload));
  if (node.type === 'not') return !evaluateFilter(node.child, payload);
  const actual = readPath(payload, node.field);
  switch (node.op) {
    case 'eq':
      return actual === node.value;
    case 'neq':
      return actual !== node.value;
    case 'gt':
      return Number(actual) > Number(node.value);
    case 'gte':
      return Number(actual) >= Number(node.value);
    case 'lt':
      return Number(actual) < Number(node.value);
    case 'lte':
      return Number(actual) <= Number(node.value);
    case 'in':
      return Array.isArray(node.value) && node.value.includes(actual);
    case 'contains':
      return String(actual ?? '').includes(String(node.value ?? ''));
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'startsWith':
      return String(actual ?? '').startsWith(String(node.value ?? ''));
    case 'endsWith':
      return String(actual ?? '').endsWith(String(node.value ?? ''));
    default:
      return true;
  }
}

function normalizePromptVariables(value: unknown): PromptVariableDto[] {
  return Array.isArray(value) ? (value as PromptVariableDto[]) : [];
}

function normalizePromptOutputSchema(value: unknown): PromptOutputSchemaDto {
  return (value ?? { fields: [] }) as PromptOutputSchemaDto;
}

function pickInference(runConfig: Record<string, unknown>): LlmJobPayload['inference'] {
  const out: NonNullable<LlmJobPayload['inference']> = {};
  if (typeof runConfig['temperature'] === 'number') out.temperature = runConfig['temperature'];
  if (typeof runConfig['maxTokens'] === 'number') out.maxTokens = runConfig['maxTokens'];
  if (typeof runConfig['topP'] === 'number') out.topP = runConfig['topP'];
  if (typeof runConfig['apiVersion'] === 'string') out.apiVersion = runConfig['apiVersion'];
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickLimits(runConfig: Record<string, unknown>): LlmJobPayload['limits'] {
  const out: NonNullable<LlmJobPayload['limits']> = {};
  if (typeof runConfig['rpmLimit'] === 'number' && runConfig['rpmLimit'] > 0) out.rpmLimit = runConfig['rpmLimit'];
  if (typeof runConfig['tpmLimit'] === 'number' && runConfig['tpmLimit'] > 0) out.tpmLimit = runConfig['tpmLimit'];
  if (typeof runConfig['concurrency'] === 'number' && runConfig['concurrency'] > 0) {
    out.concurrency = runConfig['concurrency'];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickRetry(runConfig: Record<string, unknown>): LlmJobPayload['retry'] {
  if (typeof runConfig['retries'] === 'number' && runConfig['retries'] >= 0) {
    return { maxRetries: runConfig['retries'] };
  }
  return undefined;
}
