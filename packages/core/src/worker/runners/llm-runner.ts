import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { evaluateJudgment } from '@proofhound/judgment';
import type { RateLimiter } from '@proofhound/limiter';
import {
  invokeLLM,
  parseJsonResponseWithMarkdownFallback,
  type LLMCallLogger,
  type LLMJudgmentOutcome,
  type LLMMessage,
  type ModelImageCapability,
  type ModelInvocationConfig,
} from '@proofhound/llm-client';
import type { LlmJobPayload } from '@proofhound/orchestration-shared';
import type { ModelSecretResolver } from './model-secret';
import { DrizzleRunResultWriter } from './run-result-writer';

export interface LlmRunnerDependencies {
  db: DbClient;
  limiter: RateLimiter;
  logger: LLMCallLogger;
  modelSecretResolver: ModelSecretResolver;
}

export interface LlmRunnerJobContext {
  bullmqJobId: string;
  bullmqQueue: string;
  attempt: number;
  dbosWorkflowId?: string;
  stepName?: string;
}

export interface LlmRunnerResult {
  runResultId: string;
  content: string;
  parsed?: unknown;
  decisionOutput?: string | null;
  isCorrect?: boolean | null;
  judgmentStatus?: string | null;
  usage: { inputTokens: number; outputTokens: number };
  costEstimate: number;
  durationMs: number;
}

export function createLlmRunner(deps: LlmRunnerDependencies) {
  const runResultWriter = new DrizzleRunResultWriter(deps.db);

  return async function runLlmJob(
    input: LlmJobPayload,
    jobContext: LlmRunnerJobContext,
  ): Promise<LlmRunnerResult> {
    const runResultId = input.runResultId ?? randomUUID();
    const model = await loadModelInvocationConfig(deps, input.modelId);
    // Take min(experiment-level RPM/TPM/concurrency, model-level) (SPEC 21 §quota / SPEC 24 §4: model-level is the ceiling;
    // experiment-level only self-throttles and cannot exceed). Each field has an independent fallback: missing one does not affect the others.
    const effectiveModel = applyExperimentLimits(model, input.limits);

    const expectedOutput = input.judgment?.expectedOutput ?? null;
    const evaluateJudgmentHook = input.judgment
      ? ({ parsed }: { parsed: unknown; rawResponse: string }): LLMJudgmentOutcome => {
          const outcome = evaluateJudgment('classification', parsed, {
            outputSchema: input.judgment!.outputSchema,
            judgmentRules: input.judgment!.judgmentRules,
            expectedOutput: input.judgment!.expectedOutput,
          });
          return outcome;
        }
      : undefined;

    const result = await invokeLLM(
      {
        model: effectiveModel,
        messages: input.renderedPrompt.messages as LLMMessage[] | undefined,
        prompt: input.renderedPrompt.prompt,
        params: {
          temperature: input.inference?.temperature,
          maxTokens: input.inference?.maxTokens,
          topP: input.inference?.topP,
          tools: input.renderedPrompt.tools,
          responseFormat: input.renderedPrompt.responseFormat,
          imageRefs: input.renderedPrompt.imageRefs,
          apiVersion: input.inference?.apiVersion,
        },
        maxRetries: input.retry?.maxRetries,
        context: {
          requestId: input.requestId,
          dbosWorkflowId: jobContext.dbosWorkflowId,
          bullmqJobId: jobContext.bullmqJobId,
          bullmqQueue: jobContext.bullmqQueue,
          stepName: jobContext.stepName,
          runResultId,
          promptId: input.promptId,
          promptVersionId: input.promptVersionId,
          source: input.source,
          attempt: jobContext.attempt,
        },
        runResult: {
          id: runResultId,
          projectId: input.projectId,
          source: input.source,
          sourceId: input.sourceId,
          releaseVariantId: input.releaseVariantId ?? null,
          promptVersionId: input.promptVersionId,
          modelId: input.modelId,
          sampleId: input.sampleId ?? null,
          externalId: input.externalId ?? null,
          renderedPrompt: normalizeRenderedPrompt(input.renderedPrompt),
          inputVariables: input.inputVariables,
          expectedOutput: expectedOutputAsString(expectedOutput),
          dbosWorkflowId: jobContext.dbosWorkflowId,
          bullmqJobId: jobContext.bullmqJobId,
          attempt: jobContext.attempt,
          webhookTokenId: input.webhookTokenId ?? null,
        },
        // The judgment strategy expects a parsed[expected_field]-style structure; when parseResponse is not provided, parsed=undefined,
        // and the whole metrics is unreliable. Parse strict JSON first; on failure, fall back to parsing a Markdown JSON fence.
        parseResponse: parseJsonResponseWithMarkdownFallback,
        evaluateJudgment: evaluateJudgmentHook,
      },
      {
        limiter: deps.limiter,
        logger: deps.logger,
        runResultWriter,
      },
    );

    return {
      runResultId,
      content: result.content,
      parsed: result.parsed,
      decisionOutput: result.decisionOutput ?? null,
      isCorrect: result.isCorrect ?? null,
      judgmentStatus: result.judgmentStatus ?? null,
      usage: result.usage,
      costEstimate: result.costEstimate,
      durationMs: result.durationMs,
    };
  };
}

export async function loadModelInvocationConfig(
  deps: Pick<LlmRunnerDependencies, 'db' | 'modelSecretResolver'>,
  modelId: string,
): Promise<ModelInvocationConfig> {
  const [model] = await deps.db.select().from(schema.models).where(eq(schema.models.id, modelId)).limit(1);

  if (!model || !model.isActive) {
    throw validationError(`model is not available: ${modelId}`);
  }

  return {
    id: model.id,
    providerType: model.providerType,
    providerModelId: model.providerModelId,
    endpoint: model.endpoint,
    apiKey: await deps.modelSecretResolver.resolveApiKey(model),
    capabilities: toModelInvocationCapabilities(model.capabilities),
    rpmLimit: model.rpmLimit,
    tpmLimit: model.tpmLimit,
    concurrencyLimit: model.concurrencyLimit,
    autoConcurrency: model.autoConcurrency,
    inputTokenPricePerMillion: model.inputTokenPricePerMillion,
    outputTokenPricePerMillion: model.outputTokenPricePerMillion,
    extraBody: toExtraBody(model.extraBody),
  };
}

export function applyExperimentLimits(
  model: ModelInvocationConfig,
  limits: LlmJobPayload['limits'],
): ModelInvocationConfig {
  if (!limits) return model;
  return {
    ...model,
    rpmLimit:
      typeof limits.rpmLimit === 'number'
        ? Math.min(model.rpmLimit, limits.rpmLimit)
        : model.rpmLimit,
    tpmLimit:
      typeof limits.tpmLimit === 'number'
        ? Math.min(model.tpmLimit, limits.tpmLimit)
        : model.tpmLimit,
    concurrencyLimit:
      typeof limits.concurrency === 'number'
        ? Math.min(model.concurrencyLimit, limits.concurrency)
        : model.concurrencyLimit,
  };
}

function normalizeRenderedPrompt(input: LlmJobPayload['renderedPrompt']): Record<string, unknown> {
  return {
    messages: input.messages,
    prompt: input.prompt,
    tools: input.tools,
    response_format: input.responseFormat,
    image_refs: input.imageRefs,
  };
}

function expectedOutputAsString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function validationError(message: string): Error {
  const error = new Error(message);
  error.name = 'ValidationError';
  return error;
}

function toModelInvocationCapabilities(raw: unknown): ModelInvocationConfig['capabilities'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const image = (raw as Record<string, unknown>).image;
    if (typeof image === 'string' && ['none', 'url', 'base64', 'both'].includes(image)) {
      return { image: image as ModelImageCapability };
    }
  }

  return { image: 'none' };
}

function toExtraBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}
