import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { evaluateJudgment } from '@proofhound/judgment';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import {
  invokeLLM,
  type LimiterAcquiredContext,
  parseJsonResponseWithMarkdownFallback,
  type LLMCallLogger,
  type LLMJudgmentOutcome,
  type LLMMessage,
  type ModelImageCapability,
  type ModelInvocationConfig,
  type LLMRunResultWriter,
} from '@proofhound/llm-client';
import type { LlmJobPayload } from '@proofhound/orchestration-shared';
import type { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import type { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import type { RuntimeLimitsProvider } from '../../server/common/contracts/runtime-limits.provider';
import { safeRecordUsageEvent, type UsageMeteringHook } from '../../server/common/contracts/usage-metering.hook';
import { applyRuntimeLimits } from '../../shared/llm/runtime-limits';
import type { ModelSecretResolver } from './model-secret';

export interface LlmRunnerDependencies {
  db: DbClient;
  limiter: RateLimiter;
  limiterKeyStrategy: LimiterKeyStrategy;
  quotaPolicy: QuotaPolicyHook;
  runtimeLimitsProvider: RuntimeLimitsProvider;
  usageMetering: UsageMeteringHook;
  logger: LLMCallLogger;
  modelSecretResolver: ModelSecretResolver;
  runResultWriter: LLMRunResultWriter;
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
  const runResultWriter = deps.runResultWriter;

  return async function runLlmJob(input: LlmJobPayload, jobContext: LlmRunnerJobContext): Promise<LlmRunnerResult> {
    const runResultId = input.runResultId ?? randomUUID();
    const basePayload = {
      queue: jobContext.bullmqQueue,
      jobId: jobContext.bullmqJobId,
      attempt: jobContext.attempt,
      runResultId,
      modelId: input.modelId,
      source: input.source,
    };
    const recordJobEvent = (eventType: string, payload: Record<string, unknown>) =>
      safeRecordUsageEvent(
        deps.usageMetering,
        {
          idempotencyKey: `job:${jobContext.bullmqQueue}:${jobContext.bullmqJobId}:${jobContext.attempt}:${eventType}`,
          dimension: 'job',
          eventType,
          projectId: input.projectId,
          occurredAt: new Date(),
          source: 'worker',
          payload: { ...basePayload, ...payload },
        },
        deps.logger,
      );
    const model = await loadModelInvocationConfig(deps, input.modelId);
    // Fold any deployment-level runtime caps (a replacement implementation's org plan ceiling, SPEC 08 §3.10) into the per-call limits at the
    // single worker enforcement point, so every job source (experiment / optimization child / release / webhook) is
    // capped uniformly. OSS LocalRuntimeLimitsProvider is a pass-through → mergedLimits === input.limits.
    const mergedLimits = await deps.runtimeLimitsProvider.mergeLlmLimits({
      project: { projectId: input.projectId, orgId: input.orgId, source: 'local' },
      modelId: input.modelId,
      source: input.source,
      limits: input.limits,
    });
    // Fold runtime caps into the model before invokeLLM. A model RPM/TPM of -1 only means "no model-layer cap";
    // a positive runtime cap still applies. Concurrency remains a positive min(model, runtime) value.
    const effectiveModel = applyExperimentLimits(model, mergedLimits);

    const expectedOutput = input.judgment?.expectedOutput ?? null;
    const hasExpectedOutput = input.judgment?.expectedOutput !== undefined && input.judgment.expectedOutput !== null;
    const evaluateJudgmentHook = input.judgment
      ? ({ parsed }: { parsed: unknown; rawResponse: string }): LLMJudgmentOutcome => {
          const outcome = evaluateJudgment('classification', parsed, {
            outputSchema: input.judgment!.outputSchema,
            judgmentRules: input.judgment!.judgmentRules,
            expectedOutput: input.judgment!.expectedOutput,
          });
          if (input.source === 'release' && !hasExpectedOutput) {
            return {
              decisionOutput: outcome.decisionOutput,
              isCorrect: null,
              judgmentStatus: outcome.judgmentStatus === 'parse_error' ? 'parse_error' : null,
            };
          }
          return outcome;
        }
      : undefined;

    // Build the rate-limit key at the runtime layer (§3.7); llm-client/limiter stay project-unaware (§8).
    const project = { projectId: input.projectId, orgId: input.orgId, source: 'local' as const };
    const limiterKey = deps.limiterKeyStrategy.buildModelKey(project, input.modelId);

    let result: Awaited<ReturnType<typeof invokeLLM>>;
    try {
      result = await deps.quotaPolicy.withExecutionSlot(
        { project, source: input.source, modelId: input.modelId, requestId: input.requestId },
        () =>
          invokeLLM(
            {
              model: effectiveModel,
              limiterKey,
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
                orgId: input.orgId ?? null,
                source: input.source,
                sourceId: input.sourceId,
                releaseVersionId: input.releaseVersionId ?? null,
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
              // The judgment strategy expects a parsed[decisionField]-style structure; when parseResponse is not provided, parsed=undefined,
              // and the whole metrics is unreliable. Parse strict JSON first; on failure, fall back to parsing a Markdown JSON fence.
              parseResponse: parseJsonResponseWithMarkdownFallback,
              evaluateJudgment: evaluateJudgmentHook,
              preReservedConcurrency: input.admission !== undefined,
            },
            {
              limiter: deps.limiter,
              logger: deps.logger,
              runResultWriter,
              onLimiterAcquired: (context: LimiterAcquiredContext) => {
                const acquireResult =
                  context.acquireResult && typeof context.acquireResult === 'object' ? context.acquireResult : null;
                return recordJobEvent('job.started', {
                  status: 'started',
                  limiterKey: context.key,
                  estimatedTokens: context.estimatedTokens,
                  effectiveConcurrency: acquireResult?.effectiveConcurrency ?? null,
                });
              },
            },
          ),
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError) throw error;
      await recordJobEvent('job.attempt_failed', {
        status: 'failed',
        errorKind: error instanceof Error ? error.name : 'Error',
      });
      throw error;
    }

    await recordJobEvent('job.completed', {
      status: 'completed',
      latencyMs: result.durationMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costEstimate: result.costEstimate,
    });

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
  return applyRuntimeLimits(model, limits);
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
