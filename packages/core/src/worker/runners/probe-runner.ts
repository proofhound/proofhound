import { eq } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { RateLimiter } from '@proofhound/limiter';
import {
  testModelConnectivity,
  type LLMCallLogger,
  type ModelConnectivityProbeResult,
} from '@proofhound/llm-client';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import type { ProbeJobPayload } from '@proofhound/orchestration-shared';
import { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import { loadModelInvocationConfig } from './llm-runner';
import type { ModelSecretResolver } from './model-secret';

export interface ProbeRunnerDependencies {
  db: DbClient;
  limiter: RateLimiter;
  limiterKeyStrategy: LimiterKeyStrategy;
  logger: LLMCallLogger;
  modelSecretResolver: ModelSecretResolver;
}

export function createProbeRunner(deps: ProbeRunnerDependencies) {
  return async function runProbeJob(input: ProbeJobPayload): Promise<ModelConnectivityProbeResult> {
    const model = await loadModelInvocationConfig(deps, input.modelId);
    // Same key as the LLM runner so a probe shares the model's rate-limit counting space (§3.7).
    const limiterKey = deps.limiterKeyStrategy.buildModelKey(
      input.projectId ? { projectId: input.projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT,
      input.modelId,
    );
    const result = await testModelConnectivity(
      { model, limiterKey, requestId: input.requestId, timeoutMs: input.timeoutMs },
      { limiter: deps.limiter, logger: deps.logger },
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

export async function listActiveModelIdsForProbe(
  db: DbClient,
  options: { limit?: number } = {},
): Promise<string[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await db
    .select({ id: schema.models.id })
    .from(schema.models)
    .where(eq(schema.models.isActive, true))
    .limit(limit);

  return rows.map((row) => row.id);
}
