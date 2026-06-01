import { eq } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { RateLimiter } from '@proofhound/limiter';
import {
  testModelConnectivity,
  type LLMCallLogger,
  type ModelConnectivityProbeResult,
} from '@proofhound/llm-client';
import type { ProbeJobPayload } from '@proofhound/orchestration-shared';
import { loadModelInvocationConfig } from './llm-runner';
import type { ModelSecretResolver } from './model-secret';

export interface ProbeRunnerDependencies {
  db: DbClient;
  limiter: RateLimiter;
  logger: LLMCallLogger;
  modelSecretResolver: ModelSecretResolver;
}

export function createProbeRunner(deps: ProbeRunnerDependencies) {
  return async function runProbeJob(input: ProbeJobPayload): Promise<ModelConnectivityProbeResult> {
    const model = await loadModelInvocationConfig(deps, input.modelId);
    const result = await testModelConnectivity(
      { model, requestId: input.requestId, timeoutMs: input.timeoutMs },
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
