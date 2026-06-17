import type { PromptLanguageDto } from '@proofhound/shared';

export type LLMSource = 'experiment' | 'optimization_analysis' | 'optimization_generate' | 'release';
export type LLMRunStatus = 'running' | 'success' | 'failed';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>>;
  name?: string;
  toolCallId?: string;
}

export interface LLMInferenceParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: unknown;
  responseFormat?: unknown;
  imageRefs?: unknown;
  imagePreprocess?: LLMImagePreprocessOptions | false;
  apiVersion?: string;
}

export interface LLMImagePreprocessOptions {
  maxEdgePixels?: number;
  maxOutputBytes?: number;
  maxInputBytes?: number;
  jpegQuality?: number;
  minJpegQuality?: number;
}

export interface ModelInvocationConfig {
  id: string;
  providerType: string;
  providerModelId: string;
  endpoint: string;
  apiKey: string;
  capabilities?: ModelInvocationCapabilities;
  rpmLimit: number;
  tpmLimit: number;
  // Concurrency ceiling. When autoConcurrency is true, the limiter auto-derives the effective
  // concurrency within [1, concurrencyLimit]. See docs/specs/21-models.md §6.1
  concurrencyLimit: number;
  autoConcurrency: boolean;
  inputTokenPricePerMillion: number | string;
  outputTokenPricePerMillion: number | string;
  extraBody?: Record<string, unknown>;
}

export type ModelImageCapability = 'none' | 'url' | 'base64' | 'both';

export interface ModelInvocationCapabilities {
  image: ModelImageCapability;
}

export interface LLMCallContext {
  requestId?: string;
  dbosWorkflowId?: string;
  bullmqJobId?: string;
  bullmqQueue?: string;
  stepName?: string;
  runResultId?: string;
  promptId?: string;
  promptVersionId?: string;
  promptLanguage?: PromptLanguageDto;
  source?: LLMSource;
  attempt?: number;
}

export interface RunResultContext {
  id: string;
  projectId: string;
  source: LLMSource;
  sourceId: string;
  releaseVersionId?: string | null;
  promptVersionId: string;
  modelId: string;
  sampleId?: string | null;
  externalId?: string | null;
  renderedPrompt: unknown;
  inputVariables?: unknown;
  expectedOutput?: string | null;
  dbosWorkflowId?: string | null;
  bullmqJobId?: string | null;
  attempt: number;
  // Used by optimization LLM calls: round index (0-based) for optimization_analysis / optimization_generate.
  // The detail page's listOptimizationLlmRunResults filters by isNotNull(round_index); missing values cause the whole row to be dropped.
  roundIndex?: number | null;
  // Webhook-entry attribution: set only for webhook-triggered runs; other entries leave it undefined → NULL.
  webhookTokenId?: string | null;
}

export interface LLMJudgmentOutcome {
  decisionOutput?: string | null;
  isCorrect?: boolean | null;
  judgmentStatus?: LLMJudgmentStatus | null;
}

export interface InvokeLLMArgs {
  model: ModelInvocationConfig;
  /**
   * Opaque rate-limit key, built by the caller via LimiterKeyStrategy (SPEC 08 §3.7).
   * llm-client forwards it to the limiter and never inspects project/actor.
   */
  limiterKey: string;
  messages?: LLMMessage[];
  prompt?: string;
  params?: LLMInferenceParams;
  context?: LLMCallContext;
  runResult?: RunResultContext;
  timeoutMs?: number;
  /**
   * Per-sample internal retry count (applies to retryable HTTP statuses + network errors).
   * Does not affect BullMQ job-level attempts; RateLimitExceededError passes through and is not swallowed.
   * Defaults to 0 (backward compatible).
   */
  maxRetries?: number;
  parseResponse?: (content: string) => unknown;
  evaluateJudgment?: (args: { parsed: unknown; rawResponse: string }) => LLMJudgmentOutcome;
}

export interface AdapterInvokeArgs {
  model: ModelInvocationConfig;
  messages?: LLMMessage[];
  prompt?: string;
  params: LLMInferenceParams;
  signal?: AbortSignal;
}

export interface AdapterInvokeResult {
  content: string;
  rawResponse: unknown;
  finishReason?: string | null;
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
  };
}

export interface AdapterRequestLog {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface LLMAdapter {
  providerType: string;
  invoke(args: AdapterInvokeArgs): Promise<AdapterInvokeResult>;
  buildRequestLog?(args: AdapterInvokeArgs): AdapterRequestLog;
}

export type LLMJudgmentStatus = 'correct' | 'incorrect' | 'parse_error' | 'judge_error';

export interface LLMRunResultRecord {
  id: string;
  projectId: string;
  source: LLMSource;
  sourceId: string;
  releaseVersionId?: string | null;
  promptVersionId: string;
  modelId: string;
  sampleId?: string | null;
  externalId?: string | null;
  renderedPrompt: unknown;
  inputVariables?: unknown;
  rawResponse?: string | null;
  parsedOutput?: unknown;
  decisionOutput?: string | null;
  expectedOutput?: string | null;
  isCorrect?: boolean | null;
  judgmentStatus?: LLMJudgmentStatus | null;
  status: LLMRunStatus;
  errorClass?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costEstimate?: number | null;
  attempt: number;
  dbosWorkflowId?: string | null;
  bullmqJobId?: string | null;
  // Used by optimization LLM calls; see the comment on RunResultContext.roundIndex.
  roundIndex?: number | null;
  // Webhook-entry attribution; see the comment on RunResultContext.webhookTokenId.
  webhookTokenId?: string | null;
}

export interface LLMRunResultWriter {
  writeRunResult(record: LLMRunResultRecord): Promise<void>;
}

export interface RateLimiterAcquireResult {
  effectiveConcurrency: number;
  backoffFactor: number;
  latencyEwmaMs: number;
}

export interface RateLimiterLike {
  // `key` is the opaque rate-limit key built by the runtime via LimiterKeyStrategy. llm-client never
  // builds it and stays project/actor-unaware (SPEC 08 §3.7 / §8); it just forwards the key.
  acquire(args: {
    key: string;
    estimatedTokens: number;
    limits: {
      rpmLimit: number;
      tpmLimit: number;
      concurrencyLimit: number;
    };
    autoConcurrency?: boolean;
  }): Promise<RateLimiterAcquireResult | void>;
  release(args: { key: string }): Promise<void>;
  reportOutcome?(args: {
    key: string;
    kind: 'success' | 'upstream_throttle';
    latencyMs?: number;
    tokens?: number;
  }): Promise<void>;
}

export interface LimiterAcquiredContext {
  key: string;
  estimatedTokens: number;
  acquireResult?: RateLimiterAcquireResult | void;
}

export interface LLMCallLogger {
  debug?(payload: Record<string, unknown>, message: string): void;
  info(payload: Record<string, unknown>, message: string): void;
  warn?(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface InvokeLLMDependencies {
  limiter: RateLimiterLike;
  logger: LLMCallLogger;
  runResultWriter?: LLMRunResultWriter;
  adapters?: LLMAdapter[];
  now?: () => number;
  onLimiterAcquired?(context: LimiterAcquiredContext): Promise<void> | void;
  rethrowRateLimit?: boolean;
}

export interface InvokeLLMResult {
  runResultId?: string;
  content: string;
  rawResponse: unknown;
  parsed?: unknown;
  decisionOutput?: string | null;
  isCorrect?: boolean | null;
  judgmentStatus?: LLMJudgmentStatus | null;
  finishReason?: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  costEstimate: number;
  durationMs: number;
}

export interface ModelConnectivityProbeArgs {
  model: ModelInvocationConfig;
  /** Opaque rate-limit key built by the caller via LimiterKeyStrategy (SPEC 08 §3.7). */
  limiterKey: string;
  requestId?: string;
  timeoutMs?: number;
}

export interface ModelConnectivityProbeResult {
  ok: boolean;
  modelId: string;
  providerType: string;
  providerModelId: string;
  endpoint: string;
  durationMs: number;
  checkedAt: string;
  responsePreview?: string;
  errorClass?: string;
  errorMessage?: string;
  httpStatus?: number;
  providerErrorBody?: string;
}
