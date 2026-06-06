import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { DbClient } from '@proofhound/db';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import type { ModelConnectivityProbeResult } from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import { probeJobPayloadSchema, type ProbeJobPayload } from '@proofhound/orchestration-shared';
import { DelayedError, type Job } from 'bullmq';
import { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import { RuntimeLimitsProvider } from '../../server/common/contracts/runtime-limits.provider';
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
    runtimeLimitsProvider: RuntimeLimitsProvider,
  ) {
    super();
    this.runProbeJob = createProbeRunner({
      db,
      limiter,
      limiterKeyStrategy,
      runtimeLimitsProvider,
      logger: this.logger,
      modelSecretResolver,
    });
  }

  async process(job: Job<unknown>, token?: string): Promise<ModelConnectivityProbeResult> {
    const payload = probeJobPayloadSchema.parse(job.data) satisfies ProbeJobPayload;
    try {
      return await this.runProbeJob(payload);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        const delayMs = Math.max(error.retryAfterMs, 1_000);
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
}
