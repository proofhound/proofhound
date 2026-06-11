import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { DbClient } from '@proofhound/db';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import type { ModelConnectivityProbeResult } from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import { probeJobPayloadSchema, type ProbeJobPayload } from '@proofhound/orchestration-shared';
import { LOCAL_PROJECT_ID } from '@proofhound/shared';
import { DelayedError, type Job } from 'bullmq';
import { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import { RuntimeLimitsProvider } from '../../server/common/contracts/runtime-limits.provider';
import { safeRecordUsageEvent, UsageMeteringHook } from '../../server/common/contracts/usage-metering.hook';
import { DATABASE_CLIENT } from '../../shared/database/database.constants';
import { MODEL_SECRET_RESOLVER } from '../infrastructure/llm/model-secret.provider';
import { REDIS_LIMITER } from '../../shared/redis/redis.constants';
import { createProbeRunner } from '../runners/probe-runner';
import type { ModelSecretResolver } from '../runners/model-secret';

@Processor('probe')
@Injectable()
export class ProbeConsumer extends WorkerHost {
  private readonly logger = createLogger('worker.probe', { service: 'worker' });
  private readonly runProbeJob: ReturnType<typeof createProbeRunner>;

  constructor(
    @Inject(DATABASE_CLIENT) db: DbClient,
    @Inject(REDIS_LIMITER) limiter: RateLimiter,
    @Inject(MODEL_SECRET_RESOLVER) modelSecretResolver: ModelSecretResolver,
    limiterKeyStrategy: LimiterKeyStrategy,
    quotaPolicy: QuotaPolicyHook,
    runtimeLimitsProvider: RuntimeLimitsProvider,
    private readonly usageMetering: UsageMeteringHook,
  ) {
    super();
    this.runProbeJob = createProbeRunner({
      db,
      limiter,
      limiterKeyStrategy,
      quotaPolicy,
      runtimeLimitsProvider,
      usageMetering,
      logger: this.logger,
      modelSecretResolver,
    });
  }

  async process(job: Job<unknown>, token?: string): Promise<ModelConnectivityProbeResult> {
    const payload = probeJobPayloadSchema.parse(job.data) satisfies ProbeJobPayload;
    try {
      return await this.runProbeJob(payload, {
        bullmqJobId: String(job.id),
        bullmqQueue: 'probe',
        attempt: job.attemptsMade + 1,
      });
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        const delayMs = Math.max(error.retryAfterMs, 1_000);
        await this.recordRateLimited(payload, job, error, delayMs);
        this.logger.info(
          {
            bullmqJobId: String(job.id),
            modelId: payload.modelId,
            reason: error.reason,
            retryAfterMs: error.retryAfterMs,
            delayMs,
          },
          'probe_job_throttled',
        );
        await job.moveToDelayed(Date.now() + delayMs, token);
        throw new DelayedError();
      }
      throw error;
    }
  }

  private async recordRateLimited(
    payload: ProbeJobPayload,
    job: Job<unknown>,
    error: RateLimitExceededError,
    delayMs: number,
  ): Promise<void> {
    const attempt = job.attemptsMade + 1;
    await safeRecordUsageEvent(
      this.usageMetering,
      {
        idempotencyKey: `job:probe:${String(job.id)}:${attempt}:job.rate_limited`,
        dimension: 'job',
        eventType: 'job.rate_limited',
        projectId: payload.projectId ?? LOCAL_PROJECT_ID,
        occurredAt: new Date(),
        source: 'worker',
        payload: {
          queue: 'probe',
          jobId: String(job.id),
          attempt,
          modelId: payload.modelId,
          source: 'probe',
          status: 'rate_limited',
          errorKind: error.reason,
          retryAfterMs: error.retryAfterMs,
          delayMs,
        },
      },
      this.logger,
    );
  }
}
