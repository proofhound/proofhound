import { z } from 'zod';
import { webhookAsyncCallContextSchema } from '../webhook-async-call';

export const LLM_SOURCES = ['experiment', 'optimization_analysis', 'optimization_generate', 'release'] as const;
export type LlmJobSource = (typeof LLM_SOURCES)[number];

const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
});

const renderedPromptSchema = z.object({
  messages: z.array(llmMessageSchema).optional(),
  prompt: z.string().optional(),
  tools: z.unknown().optional(),
  responseFormat: z.unknown().optional(),
  imageRefs: z.unknown().optional(),
});

const inferenceSchema = z.object({
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().optional(),
  apiVersion: z.string().optional(),
});

// Experiment-level / optimization-level "self-throttling" cap: the worker takes min(this, model-level quota) before invokeLLM;
// the model-level cap is always the ceiling (SPEC 21 §quota / SPEC 24 §4: all channels share the same model quota).
export const runtimeLimitsSchema = z.object({
  rpmLimit: z.number().int().positive().optional(),
  tpmLimit: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});
// Per-call runtime caps a RuntimeLimitsProvider may merge before enqueue (SaaS org-plan ceilings); OSS leaves them untouched.
export type RuntimeLimits = z.infer<typeof runtimeLimitsSchema>;

// Per-sample LLM call internal retry cap; does not affect BullMQ job-level attempts.
const runtimeRetrySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).optional(),
});

export const llmJudgmentContextSchema = z.object({
  outputSchema: z.unknown(),
  judgmentRules: z.unknown(),
  expectedOutput: z.unknown().optional(),
});
export type LlmJudgmentContext = z.infer<typeof llmJudgmentContextSchema>;

const llmAdmissionContextSchema = z.object({
  fairnessKey: z.string().min(1),
  reservationId: z.string().uuid(),
  leaseExpiresAt: z.string().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
});

export const llmJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  // SaaS-only org attribution: injected by the enqueue side (launcher → workflow → step / release runner)
  // from the resolved project's org, passed through by the worker into the org-scoped rate-limit key. OSS leaves it undefined and the
  // default LocalLimiterKeyStrategy ignores it. Same enqueue-inject / worker-passthrough pattern as webhookTokenId.
  orgId: z.string().uuid().optional(),
  source: z.enum(LLM_SOURCES),
  sourceId: z.string().uuid(),
  releaseVersionId: z.string().uuid().nullable().optional(),
  promptVersionId: z.string().uuid(),
  modelId: z.string().uuid(),
  runResultId: z.string().uuid().optional(),
  requestId: z.string().optional(),
  promptId: z.string().uuid().optional(),
  sampleId: z.string().uuid().nullable().optional(),
  externalId: z.string().nullable().optional(),
  // Injected by the enqueue side (experiment / optimization workflow obtains it via DBOS.workflowID inside a step),
  // passed through by the worker into the LLM call log and ph_runs.run_results.dbos_workflow_id; the release runner source is undefined
  dbosWorkflowId: z.string().optional(),
  // Webhook-entry attribution: set only when the run was triggered by a webhook token; the worker materializes it
  // into ph_runs.run_results.webhook_token_id. HTTP / MCP / internal release-runner sources leave it undefined → NULL.
  // See docs/specs/08-saas-adapter-boundary.md §3.4 / §5.
  webhookTokenId: z.string().uuid().nullable().optional(),
  renderedPrompt: renderedPromptSchema,
  inputVariables: z.unknown().optional(),
  inference: inferenceSchema.optional(),
  limits: runtimeLimitsSchema.optional(),
  retry: runtimeRetrySchema.optional(),
  judgment: llmJudgmentContextSchema.optional(),
  webhookAsyncCall: webhookAsyncCallContextSchema.optional(),
  // Internal queue-admission metadata: set only after the pending dispatcher has reserved a ready slot.
  admission: llmAdmissionContextSchema.optional(),
});

export type LlmJobPayload = z.infer<typeof llmJobPayloadSchema>;
