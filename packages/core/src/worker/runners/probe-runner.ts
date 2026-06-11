import { eq } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import { testModelConnectivity, type LLMCallLogger, type ModelConnectivityProbeResult } from '@proofhound/llm-client';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { ProbeJobPayload } from '@proofhound/orchestration-shared';
import type { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import type { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import type { RuntimeLimitsProvider } from '../../server/common/contracts/runtime-limits.provider';
import { safeRecordUsageEvent, type UsageMeteringHook } from '../../server/common/contracts/usage-metering.hook';
import { applyRuntimeLimits } from '../../shared/llm/runtime-limits';
import { loadModelInvocationConfig } from './llm-runner';
import type { ModelSecretResolver } from './model-secret';

export interface ProbeRunnerDependencies {
  db: DbClient;
  limiter: RateLimiter;
  limiterKeyStrategy: LimiterKeyStrategy;
  quotaPolicy: QuotaPolicyHook;
  runtimeLimitsProvider: RuntimeLimitsProvider;
  usageMetering: UsageMeteringHook;
  logger: LLMCallLogger;
  modelSecretResolver: ModelSecretResolver;
}

export interface ProbeRunnerJobContext {
  bullmqJobId: string;
  bullmqQueue: string;
  attempt: number;
}

export function createProbeRunner(deps: ProbeRunnerDependencies) {
  return async function runProbeJob(
    input: ProbeJobPayload,
    jobContext: ProbeRunnerJobContext,
  ): Promise<ModelConnectivityProbeResult> {
    const model = await loadModelInvocationConfig(deps, input.modelId);
    const project = toProbeProjectContext(input);
    const recordJobEvent = (eventType: string, payload: Record<string, unknown>) =>
      safeRecordUsageEvent(
        deps.usageMetering,
        {
          idempotencyKey: `job:${jobContext.bullmqQueue}:${jobContext.bullmqJobId}:${jobContext.attempt}:${eventType}`,
          dimension: 'job',
          eventType,
          projectId: project.projectId,
          occurredAt: new Date(),
          source: 'worker',
          payload: {
            queue: jobContext.bullmqQueue,
            jobId: jobContext.bullmqJobId,
            attempt: jobContext.attempt,
            modelId: input.modelId,
            source: 'probe',
            ...payload,
          },
        },
        deps.logger,
      );
    const mergedLimits = await deps.runtimeLimitsProvider.mergeLlmLimits({
      project,
      modelId: input.modelId,
      source: 'probe',
    });
    const effectiveModel = applyRuntimeLimits(model, mergedLimits);
    // Same key as the LLM runner so a probe shares the model's rate-limit counting space (§3.7).
    const limiterKey = deps.limiterKeyStrategy.buildModelKey(project, input.modelId);
    let result: ModelConnectivityProbeResult;
    try {
      result = await deps.quotaPolicy.withExecutionSlot(
        { project, source: 'probe', modelId: input.modelId, requestId: input.requestId },
        () =>
          testModelConnectivity(
            { model: effectiveModel, limiterKey, requestId: input.requestId, timeoutMs: input.timeoutMs },
            {
              limiter: deps.limiter,
              logger: deps.logger,
              rethrowRateLimit: true,
              onLimiterAcquired: (context) =>
                recordJobEvent('job.started', {
                  status: 'started',
                  limiterKey: context.key,
                  estimatedTokens: context.estimatedTokens,
                }),
            },
          ),
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError) throw error;
      await recordJobEvent('job.failed', {
        status: 'failed',
        errorKind: error instanceof Error ? error.name : 'Error',
      });
      throw error;
    }

    await recordJobEvent('job.completed', {
      status: result.ok ? 'completed' : 'failed',
      latencyMs: result.durationMs,
      errorKind: result.ok ? null : (result.errorClass ?? 'probe_failed'),
    });

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
