import { eq } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { RateLimiter } from '@proofhound/limiter';
import { testModelConnectivity, type LLMCallLogger, type ModelConnectivityProbeResult } from '@proofhound/llm-client';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { ProbeJobPayload } from '@proofhound/orchestration-shared';
import type { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import type { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import type { RuntimeLimitsProvider } from '../../server/common/contracts/runtime-limits.provider';
import { applyRuntimeLimits } from '../../shared/llm/runtime-limits';
import { loadModelInvocationConfig } from './llm-runner';
import type { ModelSecretResolver } from './model-secret';

export interface ProbeRunnerDependencies {
  db: DbClient;
  limiter: RateLimiter;
  limiterKeyStrategy: LimiterKeyStrategy;
  quotaPolicy: QuotaPolicyHook;
  runtimeLimitsProvider: RuntimeLimitsProvider;
  logger: LLMCallLogger;
  modelSecretResolver: ModelSecretResolver;
}

export function createProbeRunner(deps: ProbeRunnerDependencies) {
  return async function runProbeJob(input: ProbeJobPayload): Promise<ModelConnectivityProbeResult> {
    const model = await loadModelInvocationConfig(deps, input.modelId);
    const project = toProbeProjectContext(input);
    const mergedLimits = await deps.runtimeLimitsProvider.mergeLlmLimits({
      project,
      modelId: input.modelId,
      source: 'probe',
    });
    const effectiveModel = applyRuntimeLimits(model, mergedLimits);
    // Same key as the LLM runner so a probe shares the model's rate-limit counting space (§3.7).
    const limiterKey = deps.limiterKeyStrategy.buildModelKey(project, input.modelId);
    const result = await deps.quotaPolicy.withExecutionSlot(
      { project, source: 'probe', modelId: input.modelId, requestId: input.requestId },
      () =>
        testModelConnectivity(
          { model: effectiveModel, limiterKey, requestId: input.requestId, timeoutMs: input.timeoutMs },
          { limiter: deps.limiter, logger: deps.logger },
        ),
    );

    await deps.db
      .update(schema.models)
      .set({
        lastProbedAt: new Date(result.checkedAt),
        lastProbeError: result.ok ? null : (result.errorMessage ?? 'model connectivity probe failed'),
        updatedAt: new Date(),
      })
      .where(eq(schema.models.id, input.modelId));

    return result;
  };
}

function toProbeProjectContext(input: ProbeJobPayload): ProjectContext {
  if (input.projectId) {
    return input.orgId
      ? { projectId: input.projectId, orgId: input.orgId, source: 'local' }
      : { projectId: input.projectId, source: 'local' };
  }
  return input.orgId ? { ...LOCAL_PROJECT_CONTEXT, orgId: input.orgId } : LOCAL_PROJECT_CONTEXT;
}

export async function listActiveModelIdsForProbe(db: DbClient, options: { limit?: number } = {}): Promise<string[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await db
    .select({ id: schema.models.id })
    .from(schema.models)
    .where(eq(schema.models.isActive, true))
    .limit(limit);

  return rows.map((row) => row.id);
}
