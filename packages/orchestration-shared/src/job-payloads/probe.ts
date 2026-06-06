import { z } from 'zod';

export const probeJobPayloadSchema = z.object({
  modelId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  // SaaS-only org attribution; a probe shares the model's rate-limit counting space, so it must land in the same
  // org-scoped bucket as LLM calls. OSS leaves it undefined and the default LocalLimiterKeyStrategy ignores it.
  orgId: z.string().uuid().optional(),
  requestId: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type ProbeJobPayload = z.infer<typeof probeJobPayloadSchema>;
