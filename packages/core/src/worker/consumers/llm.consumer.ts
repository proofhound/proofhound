import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { DbClient } from '@proofhound/db';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import { normalizeLLMError } from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import {
  llmJobPayloadSchema,
  remainingWebhookAsyncCallTtlSeconds,
  webhookAsyncCallKey,
  type LlmJobPayload,
  type WebhookAsyncCallContext,
  type WebhookAsyncCallErrorReceipt,
  type WebhookAsyncCallSuccessReceipt,
} from '@proofhound/orchestration-shared';
import { DelayedError, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import { RuntimeLimitsProvider } from '../../server/common/contracts/runtime-limits.provider';
import { UsageMeteringHook } from '../../server/common/contracts/usage-metering.hook';
import { safeRecordUsageEvent } from '../../server/common/contracts/usage-metering.hook';
import { DATABASE_CLIENT } from '../../shared/database/database.constants';
import { LlmAdmissionStore } from '../../shared/llm-admission/llm-admission.store';
import { MODEL_SECRET_RESOLVER, modelSecretResolverFactory } from '../infrastructure/llm/model-secret.provider';
import { REDIS_CLIENT, REDIS_LIMITER } from '../../shared/redis/redis.constants';
import { resolveWorkerConcurrency } from '../config/worker-concurrency';
import { createLlmRunner, type LlmRunnerResult } from '../runners/llm-runner';
import type { ModelSecretResolver } from '../runners/model-secret';
import { DrizzleRunResultWriter } from '../runners/run-result-writer';

export const LLM_WORKER_CONCURRENCY = resolveWorkerConcurrency();

@Processor('llm', { concurrency: LLM_WORKER_CONCURRENCY })
@Injectable()
export class LlmConsumer extends WorkerHost {
  private readonly logger = createLogger('worker.llm', { service: 'worker' });
  private readonly runLlmJob: ReturnType<typeof createLlmRunner>;
  private readonly runResultWriter: DrizzleRunResultWriter;

  constructor(
    @Inject(DATABASE_CLIENT) db: DbClient,
    @Inject(REDIS_LIMITER) limiter: RateLimiter,
    @Inject(MODEL_SECRET_RESOLVER) modelSecretResolver: ModelSecretResolver,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    limiterKeyStrategy: LimiterKeyStrategy,
    quotaPolicy: QuotaPolicyHook,
    runtimeLimitsProvider: RuntimeLimitsProvider,
    private readonly usageMetering: UsageMeteringHook,
    @Optional() private readonly admissionStore?: LlmAdmissionStore,
  ) {
    super();
    this.runLlmJob = createLlmRunner({
      db,
      limiter,
      limiterKeyStrategy,
      quotaPolicy,
      runtimeLimitsProvider,
      usageMetering,
      logger: this.logger,
      modelSecretResolver,
    });
    this.runResultWriter = new DrizzleRunResultWriter(db, quotaPolicy, usageMetering);
  }

  async process(job: Job<unknown>, token?: string): Promise<LlmRunnerResult> {
    const payload = llmJobPayloadSchema.parse(job.data) satisfies LlmJobPayload;
    const stopAdmissionHeartbeat = this.startAdmissionHeartbeat(payload.admission);
    try {
      const result = await this.runLlmJob(payload, {
        bullmqJobId: String(job.id),
        bullmqQueue: 'llm',
        attempt: job.attemptsMade + 1,
        dbosWorkflowId: payload.dbosWorkflowId,
      });
      if (payload.webhookAsyncCall) {
        await this.writeWebhookAsyncSuccess(payload.webhookAsyncCall, result).catch((cacheError) => {
          this.logger.error(
            {
              bullmqJobId: String(job.id),
              runResultId: result.runResultId,
              error: (cacheError as Error).message,
            },
            'webhook_async_call_success_cache_write_failed',
          );
        });
      }
      return result;
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        // Rate-limit hit: defer to the next time window, do NOT consume an attempt — SPEC 03 §4.2's attempts=5 is reserved for real errors
        const delayMs = Math.max(error.retryAfterMs, 1_000);
        await this.stripAdmissionForDelayedRetry(job, payload);
        await this.recordJobEvent(payload, job, 'job.rate_limited', {
          status: 'rate_limited',
          errorKind: error.reason,
          retryAfterMs: error.retryAfterMs,
          delayMs,
        });
        this.logger.info(
          {
            bullmqJobId: String(job.id),
            modelId: payload.modelId,
            reason: error.reason,
            retryAfterMs: error.retryAfterMs,
            delayMs,
          },
          'llm_job_throttled',
        );
        await job.moveToDelayed(Date.now() + delayMs, token);
        throw new DelayedError();
      }
      throw error;
    } finally {
      stopAdmissionHeartbeat();
      await this.releaseAdmission(payload.admission);
    }
  }

  // BullMQ only fires the 'failed' event after attempts are exhausted; here we write the final error row once (DrizzleRunResultWriter has
  // an INSERT...WHERE NOT EXISTS backstop: if a previous attempt already wrote a success row, this error row will not overwrite it).
  @OnWorkerEvent('failed')
  async onFailed(job: Job<unknown>, error: Error): Promise<void> {
    const parsed = llmJobPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error({ bullmqJobId: String(job.id), error: error.message }, 'llm_job_final_failure_payload_invalid');
      return;
    }
    const payload = parsed.data;
    if ((job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) {
      // Retries can continue; this failure must not produce a final error row
      return;
    }

    const runResultId = payload.runResultId ?? randomUUID();
    // LLMAdapterHttpError.message is a fixed string; the real provider error body lives in providerErrorBody and must be restored before being persisted
    const normalized = normalizeLLMError(error);
    const errorClass = normalized.errorClass || error.name || 'Error';
    const errorMessage = (normalized.errorMessage || job.failedReason || 'job failed').slice(0, 2000);

    try {
      await this.runResultWriter.writeRunResult({
        id: runResultId,
        projectId: payload.projectId,
        orgId: payload.orgId ?? null,
        source: payload.source,
        sourceId: payload.sourceId,
        releaseVersionId: payload.releaseVersionId ?? null,
        promptVersionId: payload.promptVersionId,
        modelId: payload.modelId,
        sampleId: payload.sampleId ?? null,
        externalId: payload.externalId ?? null,
        renderedPrompt: payload.renderedPrompt,
        inputVariables: payload.inputVariables,
        rawResponse: null,
        parsedOutput: null,
        status: 'failed',
        errorClass,
        errorMessage,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        costEstimate: null,
        attempt: job.attemptsMade ?? 1,
        dbosWorkflowId: payload.dbosWorkflowId ?? null,
        bullmqJobId: String(job.id),
        webhookTokenId: payload.webhookTokenId ?? null,
      });
      this.logger.info(
        {
          bullmqJobId: String(job.id),
          runResultId,
          attempts: job.attemptsMade,
          errorClass,
        },
        'llm_job_final_error_persisted',
      );
      await this.recordJobEvent(payload, job, 'job.failed', {
        status: 'failed',
        runResultId,
        errorKind: errorClass,
      });
    } catch (writeError) {
      this.logger.error(
        {
          bullmqJobId: String(job.id),
          runResultId,
          error: (writeError as Error).message,
        },
        'llm_job_final_error_write_failed',
      );
    }

    if (payload.webhookAsyncCall) {
      await this.writeWebhookAsyncError(payload.webhookAsyncCall, {
        runResultId,
        runStatus: 'failed',
        errorClass,
        errorMessage,
      }).catch((cacheError) => {
        this.logger.error(
          {
            bullmqJobId: String(job.id),
            runResultId,
            error: (cacheError as Error).message,
          },
          'webhook_async_call_error_cache_write_failed',
        );
      });
    }
  }

  private async writeWebhookAsyncSuccess(call: WebhookAsyncCallContext, result: LlmRunnerResult): Promise<void> {
    const ttl = await this.getWebhookAsyncCallTtl(call);
    if (ttl <= 0) return;
    const completedAt = new Date().toISOString();
    const receipt: WebhookAsyncCallSuccessReceipt = {
      ...call,
      status: 'success',
      updatedAt: completedAt,
      completedAt,
      result: result.parsed ?? result.content ?? result.decisionOutput ?? null,
      rawResponse: result.content,
      parsedOutput: result.parsed ?? null,
      decisionOutput: result.decisionOutput ?? null,
      judgmentStatus: result.judgmentStatus ?? null,
      latencyMs: result.durationMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costEstimate: result.costEstimate,
    };
    await this.redis.set(webhookAsyncCallKey(call.callId), JSON.stringify(receipt), 'EX', ttl);
  }

  private async writeWebhookAsyncError(
    call: WebhookAsyncCallContext,
    input: {
      runResultId: string;
      runStatus: string;
      errorClass: string | null;
      errorMessage: string | null;
    },
  ): Promise<void> {
    const ttl = await this.getWebhookAsyncCallTtl(call);
    if (ttl <= 0) return;
    const completedAt = new Date().toISOString();
    const receipt: WebhookAsyncCallErrorReceipt = {
      ...call,
      runResultId: input.runResultId,
      status: 'error',
      updatedAt: completedAt,
      completedAt,
      runStatus: input.runStatus,
      errorClass: input.errorClass,
      errorMessage: input.errorMessage,
      latencyMs: null,
    };
    await this.redis.set(webhookAsyncCallKey(call.callId), JSON.stringify(receipt), 'EX', ttl);
  }

  private async getWebhookAsyncCallTtl(call: WebhookAsyncCallContext): Promise<number> {
    const ttl = await this.redis.ttl(webhookAsyncCallKey(call.callId));
    if (ttl > 0) return ttl;
    if (ttl === -2) return 0;
    return remainingWebhookAsyncCallTtlSeconds(call.expiresAt);
  }

  private async recordJobEvent(
    payload: LlmJobPayload,
    job: Job<unknown>,
    eventType: string,
    eventPayload: Record<string, unknown>,
  ): Promise<void> {
    const attempt = (job.attemptsMade ?? 0) + (eventType === 'job.failed' ? 0 : 1);
    await safeRecordUsageEvent(
      this.usageMetering,
      {
        idempotencyKey: `job:llm:${String(job.id)}:${attempt}:${eventType}`,
        dimension: 'job',
        eventType,
        projectId: payload.projectId,
        occurredAt: new Date(),
        source: 'worker',
        payload: {
          queue: 'llm',
          jobId: String(job.id),
          attempt,
          runResultId: payload.runResultId ?? null,
          modelId: payload.modelId,
          source: payload.source,
          ...eventPayload,
        },
      },
      this.logger,
    );
  }

  private async stripAdmissionForDelayedRetry(job: Job<unknown>, payload: LlmJobPayload): Promise<void> {
    if (!payload.admission) return;
    const retryPayload = { ...payload };
    delete retryPayload.admission;
    try {
      await job.updateData(retryPayload);
    } catch (error) {
      this.logger.warn(
        {
          bullmqJobId: String(job.id),
          fairnessKey: payload.admission.fairnessKey,
          reservationId: payload.admission.reservationId,
          error: (error as Error).message,
        },
        'llm_admission_delay_payload_update_failed',
      );
      throw error;
    }
  }

  private startAdmissionHeartbeat(admission: LlmJobPayload['admission']): () => void {
    if (!admission || !this.admissionStore) return () => undefined;
    const intervalMs = Math.max(1_000, Math.floor(this.admissionStore.defaultLeaseTtlMs / 3));
    const timer = setInterval(() => {
      this.admissionStore
        ?.extendConcurrencyReservation({
          fairnessKey: admission.fairnessKey,
          reservationId: admission.reservationId,
        })
        .catch((error) => {
          this.logger.warn(
            { fairnessKey: admission.fairnessKey, reservationId: admission.reservationId, error: error.message },
            'llm_admission_heartbeat_failed',
          );
        });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async releaseAdmission(admission: LlmJobPayload['admission']): Promise<void> {
    if (!admission || !this.admissionStore) return;
    await this.admissionStore
      .releaseConcurrencyReservation({
        fairnessKey: admission.fairnessKey,
        reservationId: admission.reservationId,
      })
      .catch((error) => {
        this.logger.warn(
          { fairnessKey: admission.fairnessKey, reservationId: admission.reservationId, error: error.message },
          'llm_admission_release_failed',
        );
      });
  }
}

export const llmConsumerProviders = [
  {
    provide: MODEL_SECRET_RESOLVER,
    useFactory: modelSecretResolverFactory,
  },
];
