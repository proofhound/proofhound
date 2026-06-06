import type { ModelInvocationConfig } from '@proofhound/llm-client';
import type { RuntimeLimits } from '@proofhound/orchestration-shared';

export function applyRuntimeLimits(
  model: ModelInvocationConfig,
  limits: RuntimeLimits | undefined,
): ModelInvocationConfig {
  if (!limits) return model;
  return {
    ...model,
    rpmLimit: mergeTokenBucketLimit(model.rpmLimit, limits.rpmLimit),
    tpmLimit: mergeTokenBucketLimit(model.tpmLimit, limits.tpmLimit),
    concurrencyLimit:
      typeof limits.concurrency === 'number'
        ? Math.min(model.concurrencyLimit, limits.concurrency)
        : model.concurrencyLimit,
  };
}

function mergeTokenBucketLimit(modelLimit: number, runtimeLimit: number | undefined): number {
  if (typeof runtimeLimit !== 'number' || runtimeLimit <= 0) return modelLimit;
  if (modelLimit <= 0) return runtimeLimit;
  return Math.min(modelLimit, runtimeLimit);
}
