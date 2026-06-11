import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RateLimitExceededError } from '@proofhound/limiter';
import { estimateCostFromTokenUsage } from './cost';
import { preprocessLLMImageInputs } from './image-preprocess';
import { capLLMLogPayload, type CappedPayload } from './payload-cap';
import { anthropicAdapter, normalizeAnthropicInferenceParams } from './providers/anthropic.adapter';
import { azureOpenAIAdapter } from './providers/azure-openai.adapter';
import { LLMAdapterHttpError, openAIAdapter } from './providers/openai.adapter';
import { estimateLLMTokens } from './token-estimate';
import type {
  AdapterInvokeArgs,
  AdapterInvokeResult,
  AdapterRequestLog,
  InvokeLLMArgs,
  InvokeLLMDependencies,
  InvokeLLMResult,
  LLMAdapter,
  LLMCallLogger,
  LLMInferenceParams,
  LLMJudgmentOutcome,
  LLMMessage,
  LimiterAcquiredContext,
  ModelConnectivityProbeArgs,
  ModelConnectivityProbeResult,
} from './types';

const IMAGE_PROBE_URL = 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen-VL/assets/demo.jpeg';
const IMAGE_PROBE_FILE_NAME = 'qwen-vl-demo.jpeg';
const IMAGE_PROBE_MEDIA_TYPE = 'image/jpeg';
const IMAGE_PROBE_TEXT = 'Reply with "pong" if you can process this image input.';

let cachedImageProbeAsset: { base64: string; sha256: string } | undefined;

export type {
  AdapterInvokeArgs,
  AdapterInvokeResult,
  AdapterRequestLog,
  InvokeLLMArgs,
  InvokeLLMDependencies,
  InvokeLLMResult,
  LLMAdapter,
  LLMCallContext,
  LLMCallLogger,
  LLMInferenceParams,
  LLMJudgmentOutcome,
  LLMJudgmentStatus,
  LLMMessage,
  LLMRunResultRecord,
  LLMRunResultWriter,
  LLMRunStatus,
  LLMSource,
  LimiterAcquiredContext,
  ModelConnectivityProbeArgs,
  ModelConnectivityProbeResult,
  ModelInvocationConfig,
  RateLimiterLike,
  RunResultContext,
} from './types';

const DEFAULT_TIMEOUT_MS = 300_000;

// Unified invokeLLM entrypoint
// Order: image pre-processing -> limiter.acquire -> provider.invoke -> application log -> [success: run_results] -> limiter.release
// On failure, only log; do NOT write run_results; after BullMQ retries are exhausted, the consumer writes the final error row in OnWorkerEvent('failed'),
// avoiding "the first failed error row blocks INSERT...WHERE NOT EXISTS so subsequent retry success cannot be persisted".
export async function invokeLLM(args: InvokeLLMArgs, deps: InvokeLLMDependencies): Promise<InvokeLLMResult> {
  assertInvocationShape(args);

  const startedAt = deps.now?.() ?? Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let acquired = false;
  let invocationArgs = args;

  try {
    invocationArgs = await preprocessLLMImageInputs(args);
    const params = normalizeInferenceParamsForProvider(invocationArgs.model, invocationArgs.params ?? {});
    invocationArgs = { ...invocationArgs, params };
    const estimated = estimateLLMTokens({
      messages: invocationArgs.messages,
      prompt: invocationArgs.prompt,
      tools: params.tools,
      responseFormat: params.responseFormat,
      maxTokens: params.maxTokens,
    });
    const provider = resolveLLMAdapter(invocationArgs.model.providerType, deps.adapters);

    const acquireResult = await deps.limiter.acquire({
      key: invocationArgs.limiterKey,
      estimatedTokens: estimated.totalTokens,
      limits: {
        rpmLimit: invocationArgs.model.rpmLimit,
        tpmLimit: invocationArgs.model.tpmLimit,
        concurrencyLimit: invocationArgs.model.concurrencyLimit,
      },
      autoConcurrency: invocationArgs.model.autoConcurrency,
    });
    acquired = true;
    await notifyLimiterAcquired(deps, {
      key: invocationArgs.limiterKey,
      estimatedTokens: estimated.totalTokens,
      acquireResult,
    });
    if (invocationArgs.model.autoConcurrency && acquireResult) {
      deps.logger.debug?.(
        {
          modelId: invocationArgs.model.id,
          effectiveConcurrency: acquireResult.effectiveConcurrency,
          ceiling: invocationArgs.model.concurrencyLimit,
          backoffFactor: acquireResult.backoffFactor,
          latencyEwmaMs: acquireResult.latencyEwmaMs,
        },
        'limiter_auto_concurrency',
      );
    }

    const providerInvokeArgs: AdapterInvokeArgs = {
      model: invocationArgs.model,
      messages: invocationArgs.messages,
      prompt: invocationArgs.prompt,
      params,
      signal: controller.signal,
    };
    logLLMRequest(
      deps.logger,
      invocationArgs,
      provider,
      providerInvokeArgs,
      estimated.totalTokens,
      args.maxRetries ?? 0,
    );

    const providerResult = await invokeProviderWithRetry(provider, providerInvokeArgs, {
      maxRetries: args.maxRetries ?? 0,
      signal: controller.signal,
      logger: deps.logger,
      context: invocationArgs.context,
      modelId: invocationArgs.model.id,
      providerModelId: invocationArgs.model.providerModelId,
    });
    const durationMs = (deps.now?.() ?? Date.now()) - startedAt;
    const parsed = args.parseResponse ? args.parseResponse(providerResult.content) : undefined;
    const usage = {
      inputTokens: providerResult.usage.inputTokens ?? estimated.inputTokens,
      outputTokens: providerResult.usage.outputTokens ?? estimated.outputTokens,
    };
    const costEstimate = estimateCostFromTokenUsage(usage, invocationArgs.model);

    logLLMSuccess(deps.logger, invocationArgs, providerResult, parsed, usage, costEstimate, durationMs);

    if (invocationArgs.model.autoConcurrency) {
      try {
        await deps.limiter.reportOutcome?.({
          key: invocationArgs.limiterKey,
          kind: 'success',
          latencyMs: durationMs,
          tokens: usage.inputTokens + usage.outputTokens,
        });
      } catch {
        // auto-concurrency feedback is best-effort; never fail the call because of it
      }
    }

    const judgmentOutcome = args.evaluateJudgment
      ? safeEvaluateJudgment(args.evaluateJudgment, parsed, providerResult.content)
      : null;

    if (invocationArgs.runResult && deps.runResultWriter) {
      await deps.runResultWriter.writeRunResult({
        ...invocationArgs.runResult,
        roundIndex: invocationArgs.runResult.roundIndex ?? null,
        rawResponse: providerResult.content,
        parsedOutput: parsed,
        decisionOutput: judgmentOutcome?.decisionOutput ?? null,
        isCorrect: judgmentOutcome?.isCorrect ?? null,
        judgmentStatus: judgmentOutcome?.judgmentStatus ?? null,
        status: 'success',
        errorClass: null,
        errorMessage: null,
        latencyMs: durationMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costEstimate,
      });
    }

    return {
      runResultId: invocationArgs.runResult?.id,
      content: providerResult.content,
      rawResponse: providerResult.rawResponse,
      parsed,
      decisionOutput: judgmentOutcome?.decisionOutput ?? null,
      isCorrect: judgmentOutcome?.isCorrect ?? null,
      judgmentStatus: judgmentOutcome?.judgmentStatus ?? null,
      finishReason: providerResult.finishReason,
      usage,
      costEstimate,
      durationMs,
    };
  } catch (error) {
    // Rate-limit is a "transient" signal, not a business failure: do not write run_result (to avoid polluting metrics); let the caller (worker) defer requeue by retryAfterMs
    if (error instanceof RateLimitExceededError) {
      throw error;
    }

    // Upstream provider throttle (HTTP 429) feeds the auto-concurrency backoff so effective concurrency
    // converges to what the provider actually sustains. Best-effort; the original error is still rethrown.
    if (invocationArgs.model.autoConcurrency && error instanceof LLMAdapterHttpError && error.httpStatus === 429) {
      try {
        await deps.limiter.reportOutcome?.({ key: invocationArgs.limiterKey, kind: 'upstream_throttle' });
        deps.logger.debug?.({ modelId: invocationArgs.model.id }, 'limiter_backoff_applied');
      } catch {
        // best-effort
      }
    }

    const durationMs = (deps.now?.() ?? Date.now()) - startedAt;
    const normalized = normalizeError(error);

    logLLMFailure(deps.logger, invocationArgs, normalized, durationMs);

    // Intentionally do not write run_result: a single job may still succeed during BullMQ retries; only after attempts are exhausted does the consumer write the final error row
    throw error;
  } finally {
    clearTimeout(timeout);
    if (acquired) {
      await deps.limiter.release({ key: invocationArgs.limiterKey });
    }
  }
}

export async function testModelConnectivity(
  args: ModelConnectivityProbeArgs,
  deps: InvokeLLMDependencies,
): Promise<ModelConnectivityProbeResult> {
  const probe = buildConnectivityProbe(args.model);
  const params: LLMInferenceParams = normalizeInferenceParamsForProvider(args.model, {
    maxTokens: 8,
    imageRefs: probe.imageRefs,
  });
  const messages = probe.messages;
  const estimated = estimateLLMTokens({ messages, maxTokens: params.maxTokens });
  const provider = resolveLLMAdapter(args.model.providerType, deps.adapters);
  const startedAt = deps.now?.() ?? Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);
  const endpoint = safeEndpoint(args.model.endpoint);

  let acquired = false;
  let probeRequestLogged = false;

  try {
    // Connectivity probe goes through the limiter but never reports outcomes — a single health check
    // must not pollute the model's auto-concurrency EWMA / backoff state.
    await deps.limiter.acquire({
      key: args.limiterKey,
      estimatedTokens: estimated.totalTokens,
      limits: {
        rpmLimit: args.model.rpmLimit,
        tpmLimit: args.model.tpmLimit,
        concurrencyLimit: args.model.concurrencyLimit,
      },
      autoConcurrency: args.model.autoConcurrency,
    });
    acquired = true;
    await notifyLimiterAcquired(deps, {
      key: args.limiterKey,
      estimatedTokens: estimated.totalTokens,
    });

    const providerInvokeArgs: AdapterInvokeArgs = {
      model: args.model,
      messages,
      params,
      signal: controller.signal,
    };
    logProbeRequest(
      deps.logger,
      args,
      provider,
      providerInvokeArgs,
      probe.type,
      estimated.totalTokens,
      probe.imageRefs,
    );
    probeRequestLogged = true;

    const result = await provider.invoke(providerInvokeArgs);
    const durationMs = (deps.now?.() ?? Date.now()) - startedAt;

    logProbeResponse(deps.logger, args, result, probe.type, durationMs, probe.imageRefs);

    deps.logger.info(
      {
        requestId: args.requestId,
        model: {
          id: args.model.id,
          providerModelId: args.model.providerModelId,
          providerType: args.model.providerType,
          endpoint,
        },
        durationMs,
        probeType: probe.type,
        image_refs: probe.imageRefs,
      },
      'model_connectivity_probe_completed',
    );

    return {
      ok: true,
      modelId: args.model.id,
      providerType: args.model.providerType,
      providerModelId: args.model.providerModelId,
      endpoint,
      durationMs,
      checkedAt: new Date().toISOString(),
      responsePreview: result.content.slice(0, 200),
    };
  } catch (error) {
    if (deps.rethrowRateLimit && error instanceof RateLimitExceededError) {
      throw error;
    }

    const durationMs = (deps.now?.() ?? Date.now()) - startedAt;
    const normalized = normalizeError(error);

    if (probeRequestLogged) {
      logProbeFailureResponse(deps.logger, args, normalized, probe.type, durationMs, probe.imageRefs);
    }

    deps.logger.error(
      {
        requestId: args.requestId,
        model: {
          id: args.model.id,
          providerModelId: args.model.providerModelId,
          providerType: args.model.providerType,
          endpoint,
        },
        durationMs,
        probeType: probe.type,
        image_refs: probe.imageRefs,
        ...normalized,
      },
      'model_connectivity_probe_failed',
    );

    return {
      ok: false,
      modelId: args.model.id,
      providerType: args.model.providerType,
      providerModelId: args.model.providerModelId,
      endpoint,
      durationMs,
      checkedAt: new Date().toISOString(),
      ...normalized,
    };
  } finally {
    clearTimeout(timeout);
    if (acquired) {
      await deps.limiter.release({ key: args.limiterKey });
    }
  }
}

const OPENAI_COMPATIBLE_PROVIDER_TYPES = ['openai', 'deepseek', 'kimi', 'minimax', 'qwen', 'ernie'] as const;

export function defaultLLMAdapters(): LLMAdapter[] {
  return [
    ...OPENAI_COMPATIBLE_PROVIDER_TYPES.map((providerType) => ({ ...openAIAdapter, providerType })),
    azureOpenAIAdapter,
    { ...azureOpenAIAdapter, providerType: 'azure' },
    anthropicAdapter,
  ];
}

export function resolveLLMAdapter(providerType: string, adapters = defaultLLMAdapters()): LLMAdapter {
  const normalized = normalizeProviderType(providerType);
  const adapter = adapters.find((candidate) => candidate.providerType === normalized);

  if (!adapter) {
    throw new Error(`unsupported llm provider type: ${providerType}`);
  }

  return adapter;
}

async function notifyLimiterAcquired(deps: InvokeLLMDependencies, context: LimiterAcquiredContext): Promise<void> {
  if (!deps.onLimiterAcquired) return;
  try {
    await deps.onLimiterAcquired(context);
  } catch (error) {
    const payload = {
      key: context.key,
      error: (error as Error).message,
    };
    if (deps.logger.warn) {
      deps.logger.warn(payload, 'limiter_acquired_callback_failed');
    } else {
      deps.logger.error(payload, 'limiter_acquired_callback_failed');
    }
  }
}

type ConnectivityProbeType = 'text' | 'image_url' | 'image_base64';

function buildConnectivityProbe(model: ModelConnectivityProbeArgs['model']): {
  type: ConnectivityProbeType;
  messages: LLMMessage[];
  imageRefs?: unknown;
} {
  const imageCapability = model.capabilities?.image ?? 'none';
  if (imageCapability === 'none') {
    return {
      type: 'text',
      messages: [{ role: 'user', content: 'ping' }],
    };
  }

  const shouldUseBase64 = imageCapability === 'base64' || imageCapability === 'both';
  const type: ConnectivityProbeType = shouldUseBase64 ? 'image_base64' : 'image_url';
  const base64Asset = shouldUseBase64 ? loadImageProbeAsset() : undefined;
  const imageRefs = shouldUseBase64
    ? [{ kind: 'base64', mediaType: IMAGE_PROBE_MEDIA_TYPE, sha256: base64Asset?.sha256 }]
    : [{ kind: 'url', url: IMAGE_PROBE_URL }];

  return {
    type,
    messages:
      normalizeProviderType(model.providerType) === 'anthropic'
        ? buildAnthropicImageProbeMessages(base64Asset?.base64)
        : buildOpenAICompatibleImageProbeMessages(base64Asset?.base64),
    imageRefs,
  };
}

function buildOpenAICompatibleImageProbeMessages(base64?: string): LLMMessage[] {
  const url = base64 ? `data:${IMAGE_PROBE_MEDIA_TYPE};base64,${base64}` : IMAGE_PROBE_URL;
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: IMAGE_PROBE_TEXT },
        { type: 'image_url', image_url: { url } },
      ],
    },
  ];
}

function buildAnthropicImageProbeMessages(base64?: string): LLMMessage[] {
  return [
    {
      role: 'user',
      content: [
        base64
          ? {
              type: 'image',
              source: {
                type: 'base64',
                media_type: IMAGE_PROBE_MEDIA_TYPE,
                data: base64,
              },
            }
          : {
              type: 'image',
              source: {
                type: 'url',
                url: IMAGE_PROBE_URL,
              },
            },
        { type: 'text', text: IMAGE_PROBE_TEXT },
      ],
    },
  ];
}

function loadImageProbeAsset(): { base64: string; sha256: string } {
  if (cachedImageProbeAsset) return cachedImageProbeAsset;

  const assetPath = findImageProbeAssetPath();
  const bytes = readFileSync(assetPath);
  cachedImageProbeAsset = {
    base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return cachedImageProbeAsset;
}

function findImageProbeAssetPath(): string {
  const candidates = [
    resolve(process.cwd(), 'packages/llm-client/src/assets', IMAGE_PROBE_FILE_NAME),
    resolve(process.cwd(), 'src/assets', IMAGE_PROBE_FILE_NAME),
    resolve(process.cwd(), 'dist/packages/llm-client/src/assets', IMAGE_PROBE_FILE_NAME),
    resolve(process.cwd(), '../../packages/llm-client/src/assets', IMAGE_PROBE_FILE_NAME),
    resolve(process.cwd(), '../packages/llm-client/src/assets', IMAGE_PROBE_FILE_NAME),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`model connectivity image probe asset not found: ${IMAGE_PROBE_FILE_NAME}`);
  }

  return found;
}

function normalizeProviderType(providerType: string): string {
  return providerType.trim().toLowerCase().replace(/_/gu, '-');
}

function normalizeInferenceParamsForProvider(
  model: InvokeLLMArgs['model'],
  params: LLMInferenceParams,
): LLMInferenceParams {
  if (normalizeProviderType(model.providerType) === 'anthropic') {
    return normalizeAnthropicInferenceParams(model.providerModelId, params);
  }

  return params;
}

function safeEvaluateJudgment(
  evaluator: NonNullable<InvokeLLMArgs['evaluateJudgment']>,
  parsed: unknown,
  rawResponse: string,
): LLMJudgmentOutcome {
  try {
    return evaluator({ parsed, rawResponse });
  } catch {
    return { decisionOutput: null, isCorrect: null, judgmentStatus: 'judge_error' };
  }
}

function logLLMRequest(
  logger: LLMCallLogger,
  args: InvokeLLMArgs,
  provider: LLMAdapter,
  providerArgs: AdapterInvokeArgs,
  estimatedTokens: number,
  maxRetries: number,
): void {
  const capped = capLLMLogPayload({
    ...buildBaseLogPayload(args),
    request: buildProviderRequestLog(provider, providerArgs),
    estimatedTokens,
    maxRetries,
  });

  logger.info(toLogObject(capped), 'llm_call_request_sent');
}

function logLLMSuccess(
  logger: LLMCallLogger,
  args: InvokeLLMArgs,
  result: AdapterInvokeResult,
  parsed: unknown,
  usage: { inputTokens: number; outputTokens: number },
  costEstimate: number,
  durationMs: number,
): void {
  const payload = buildBaseLogPayload(args, durationMs);
  const capped = capLLMLogPayload({
    ...payload,
    response: {
      content: result.content,
      raw: result.rawResponse,
      finish_reason: result.finishReason,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      },
    },
    parsed,
    costEstimate,
  });

  logger.info(toLogObject(capped), 'llm_call_completed');
}

function logLLMFailure(
  logger: LLMCallLogger,
  args: InvokeLLMArgs,
  error: ReturnType<typeof normalizeError>,
  durationMs: number,
): void {
  const capped = capLLMLogPayload({
    ...buildBaseLogPayload(args, durationMs),
    response: {
      outcome: 'failure',
      ...error,
      provider_error: parseProviderErrorBody(error.providerErrorBody),
    },
    ...error,
  });

  logger.error(toLogObject(capped), 'llm_call_failed');
}

function logProbeRequest(
  logger: LLMCallLogger,
  args: ModelConnectivityProbeArgs,
  provider: LLMAdapter,
  providerArgs: AdapterInvokeArgs,
  probeType: ConnectivityProbeType,
  estimatedTokens: number,
  imageRefs: unknown,
): void {
  const capped = capLLMLogPayload({
    requestId: args.requestId,
    model: {
      id: args.model.id,
      providerModelId: args.model.providerModelId,
      providerType: args.model.providerType,
      endpoint: safeEndpoint(args.model.endpoint),
      temperature: providerArgs.params.temperature,
      max_tokens: providerArgs.params.maxTokens,
    },
    messages: providerArgs.messages,
    request: buildProviderRequestLog(provider, providerArgs),
    image_refs: imageRefs,
    probeType,
    estimatedTokens,
  });

  logger.info(toLogObject(capped), 'model_connectivity_probe_request_sent');
}

function logProbeResponse(
  logger: LLMCallLogger,
  args: ModelConnectivityProbeArgs,
  result: AdapterInvokeResult,
  probeType: ConnectivityProbeType,
  durationMs: number,
  imageRefs: unknown,
): void {
  const capped = capLLMLogPayload({
    requestId: args.requestId,
    model: {
      id: args.model.id,
      providerModelId: args.model.providerModelId,
      providerType: args.model.providerType,
      endpoint: safeEndpoint(args.model.endpoint),
    },
    durationMs,
    probeType,
    image_refs: imageRefs,
    outcome: 'success',
    response: {
      content: result.content,
      raw: result.rawResponse,
      finish_reason: result.finishReason,
      usage: {
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
      },
    },
  });

  logger.info(toLogObject(capped), 'model_connectivity_probe_response_received');
}

function logProbeFailureResponse(
  logger: LLMCallLogger,
  args: ModelConnectivityProbeArgs,
  error: ReturnType<typeof normalizeError>,
  probeType: ConnectivityProbeType,
  durationMs: number,
  imageRefs: unknown,
): void {
  const capped = capLLMLogPayload({
    requestId: args.requestId,
    model: {
      id: args.model.id,
      providerModelId: args.model.providerModelId,
      providerType: args.model.providerType,
      endpoint: safeEndpoint(args.model.endpoint),
    },
    durationMs,
    probeType,
    image_refs: imageRefs,
    outcome: 'failure',
    response: {
      ...error,
      provider_error: parseProviderErrorBody(error.providerErrorBody),
    },
  });

  logger.info(toLogObject(capped), 'model_connectivity_probe_response_received');
}

function buildProviderRequestLog(provider: LLMAdapter, providerArgs: AdapterInvokeArgs): AdapterRequestLog {
  try {
    return provider.buildRequestLog?.(providerArgs) ?? buildFallbackRequestLog(providerArgs);
  } catch {
    return buildFallbackRequestLog(providerArgs);
  }
}

function buildFallbackRequestLog(providerArgs: AdapterInvokeArgs): AdapterRequestLog {
  const params = providerArgs.params;
  return {
    method: 'POST',
    url: safeEndpoint(providerArgs.model.endpoint),
    body: {
      ...(providerArgs.model.extraBody ?? {}),
      model: providerArgs.model.providerModelId,
      messages: providerArgs.messages ?? [{ role: 'user', content: providerArgs.prompt ?? '' }],
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      top_p: params.topP,
      tools: params.tools,
      response_format: params.responseFormat,
    },
    headers: { 'Content-Type': 'application/json' },
  };
}

function buildBaseLogPayload(args: InvokeLLMArgs, durationMs?: number): Record<string, unknown> {
  const params = args.params ?? {};

  return {
    model: {
      id: args.model.id,
      providerModelId: args.model.providerModelId,
      endpoint: safeEndpoint(args.model.endpoint),
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      top_p: params.topP,
    },
    messages: args.messages,
    prompt: args.prompt,
    tools: params.tools,
    response_format: params.responseFormat,
    image_refs: params.imageRefs,
    requestId: args.context?.requestId,
    dbosWorkflowId: args.context?.dbosWorkflowId,
    bullmqJobId: args.context?.bullmqJobId,
    bullmqQueue: args.context?.bullmqQueue,
    stepName: args.context?.stepName,
    runResultId: args.runResult?.id ?? args.context?.runResultId,
    promptId: args.context?.promptId,
    promptVersionId: args.runResult?.promptVersionId ?? args.context?.promptVersionId,
    source: args.runResult?.source ?? args.context?.source,
    attempt: args.runResult?.attempt ?? args.context?.attempt,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

function toLogObject<T>(capped: CappedPayload<T>): Record<string, unknown> {
  if (!capped.overflow && typeof capped.payload === 'object' && capped.payload !== null) {
    return capped.payload as Record<string, unknown>;
  }

  return {
    payload_overflow: true,
    payload: capped.payload,
  };
}

export function normalizeLLMError(error: unknown): {
  errorClass: string;
  errorMessage: string;
  httpStatus?: number;
  providerErrorBody?: string;
} {
  if (error instanceof LLMAdapterHttpError) {
    return {
      errorClass: error.name,
      errorMessage: extractProviderErrorMessage(error.providerErrorBody) ?? error.message,
      httpStatus: error.httpStatus,
      providerErrorBody: error.providerErrorBody,
    };
  }

  if (error instanceof Error) {
    return {
      errorClass: error.name,
      errorMessage: error.message,
    };
  }

  return {
    errorClass: 'UnknownError',
    errorMessage: String(error),
  };
}

const normalizeError = normalizeLLMError;

function extractProviderErrorMessage(providerErrorBody: string): string | undefined {
  try {
    const parsed = JSON.parse(providerErrorBody) as unknown;
    return findErrorMessage(parsed);
  } catch {
    return undefined;
  }
}

function parseProviderErrorBody(providerErrorBody: string | undefined): unknown {
  if (!providerErrorBody) return undefined;
  try {
    return JSON.parse(providerErrorBody) as unknown;
  } catch {
    return undefined;
  }
}

function findErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = findErrorMessage(item);
      if (message) return message;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ['message', 'errorMessage']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }

  return findErrorMessage(record['error']);
}

function safeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

function assertInvocationShape(args: InvokeLLMArgs): void {
  if (!args.messages && !args.prompt) {
    throw new Error('invokeLLM requires messages or prompt');
  }
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_BASE_BACKOFF_MS = 500;

interface RetryControl {
  maxRetries: number;
  signal: AbortSignal;
  logger: LLMCallLogger;
  context?: InvokeLLMArgs['context'];
  modelId: string;
  providerModelId: string;
}

// LLM call internal retry layer: retries only on retryable HTTP statuses + network errors, with exponential backoff + jitter.
// Reuses the same limiter.acquire quota (only one acquire/release inside the outer try).
// RateLimitExceededError / 4xx business errors / AbortError are all passed through, not swallowed.
async function invokeProviderWithRetry(
  provider: LLMAdapter,
  args: Parameters<LLMAdapter['invoke']>[0],
  control: RetryControl,
): Promise<AdapterInvokeResult> {
  let attempt = 0;
  while (true) {
    try {
      return await provider.invoke(args);
    } catch (error) {
      if (control.signal.aborted) throw error;
      if (attempt >= control.maxRetries || !isRetryableProviderError(error)) {
        throw error;
      }
      const backoffMs = computeRetryBackoff(attempt);
      const normalized = normalizeError(error);
      control.logger.info(
        {
          requestId: control.context?.requestId,
          dbosWorkflowId: control.context?.dbosWorkflowId,
          bullmqJobId: control.context?.bullmqJobId,
          model: { id: control.modelId, providerModelId: control.providerModelId },
          attempt: attempt + 1,
          maxRetries: control.maxRetries,
          nextBackoffMs: backoffMs,
          errorClass: normalized.errorClass,
          errorMessage: normalized.errorMessage,
          httpStatus: normalized.httpStatus,
        },
        'llm_call_retrying',
      );
      attempt += 1;
      await sleepMs(backoffMs, control.signal);
    }
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof RateLimitExceededError) return false;
  if (error instanceof LLMAdapterHttpError) {
    return RETRYABLE_HTTP_STATUSES.has(error.httpStatus);
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return false;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return true;
    }
    if (/fetch failed/iu.test(error.message)) return true;
  }
  return false;
}

function computeRetryBackoff(attempt: number): number {
  const exp = RETRY_BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * RETRY_BASE_BACKOFF_MS;
  return exp + jitter;
}

function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
