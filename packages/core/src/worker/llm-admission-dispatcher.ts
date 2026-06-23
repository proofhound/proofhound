import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { createLogger } from '@proofhound/logger';
import { deriveEffectiveConcurrency, type RateLimiter } from '@proofhound/limiter';
import { estimateLLMTokens, type LLMMessage } from '@proofhound/llm-client';
import type { LlmJobPayload, RuntimeLimits } from '@proofhound/orchestration-shared';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../shared/database/database.constants';
import { LlmAdmissionStore, type PendingLlmJob } from '../shared/llm-admission/llm-admission.store';
import { REDIS_LIMITER } from '../shared/redis/redis.constants';
import { RuntimeLimitsProvider } from '../server/common/contracts/runtime-limits.provider';

const DEFAULT_MAX_KEYS_PER_TICK = 128;
const DEFAULT_ACTIVE_TICK_MS = 50;
const DEFAULT_IDLE_TICK_MS = 750;
const DEFAULT_NOT_LEADER_TICK_MS = 1_000;
const DEFAULT_LEADER_TTL_MS = 5_000;
const DEFAULT_CONCURRENCY_RETRY_MS = 250;
const DEFAULT_LATENCY_EWMA_MS = 3_000;

interface ModelLimitRow {
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
  autoConcurrency: boolean;
  isActive: boolean;
}

@Injectable()
export class LlmAdmissionDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = createLogger('worker.llm-admission', { service: 'worker' });
  private readonly instanceId = randomUUID();
  private readonly maxKeysPerTick = positiveIntEnv('PH_LLM_ADMISSION_MAX_KEYS_PER_TICK', DEFAULT_MAX_KEYS_PER_TICK);
  private readonly activeTickMs = positiveIntEnv('PH_LLM_ADMISSION_ACTIVE_TICK_MS', DEFAULT_ACTIVE_TICK_MS);
  private readonly idleTickMs = positiveIntEnv('PH_LLM_ADMISSION_IDLE_TICK_MS', DEFAULT_IDLE_TICK_MS);
  private readonly notLeaderTickMs = positiveIntEnv('PH_LLM_ADMISSION_NOT_LEADER_TICK_MS', DEFAULT_NOT_LEADER_TICK_MS);
  private readonly leaderTtlMs = positiveIntEnv('PH_LLM_ADMISSION_LEADER_TTL_MS', DEFAULT_LEADER_TTL_MS);
  private readonly concurrencyRetryMs = positiveIntEnv('PH_LLM_ADMISSION_CONCURRENCY_RETRY_MS', DEFAULT_CONCURRENCY_RETRY_MS);
  private stopped = false;
  private loop?: Promise<void>;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_LIMITER) private readonly limiter: RateLimiter,
    @InjectQueue('llm') private readonly llmQueue: Queue<LlmJobPayload>,
    private readonly admissionStore: LlmAdmissionStore,
    private readonly runtimeLimitsProvider: RuntimeLimitsProvider,
  ) {}

  onApplicationBootstrap(): void {
    if (!llmAdmissionEnabled()) return;
    this.loop = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.loop?.catch(() => undefined);
  }

  async dispatchOnce(): Promise<number> {
    const dueKeys = await this.admissionStore.getDueFairnessKeys(this.maxKeysPerTick);
    let admitted = 0;
    for (const fairnessKey of dueKeys) {
      if (await this.dispatchFairnessKey(fairnessKey)) admitted += 1;
    }
    return admitted;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const isLeader = await this.admissionStore.acquireDispatcherLeadership(this.instanceId, this.leaderTtlMs);
        if (!isLeader) {
          await sleep(this.notLeaderTickMs);
          continue;
        }

        const admitted = await this.dispatchOnce();
        await sleep(admitted > 0 ? this.activeTickMs : this.idleTickMs);
      } catch (error) {
        this.logger.error({ error: (error as Error).message }, 'llm_admission_dispatch_loop_failed');
        await sleep(this.idleTickMs);
      }
    }
  }

  private async dispatchFairnessKey(fairnessKey: string): Promise<boolean> {
    const pending = await this.admissionStore.peekNextPendingJob(fairnessKey);
    if (!pending) return false;

    const existingReadyJob = await this.llmQueue.getJob(pending.jobId);
    if (existingReadyJob) {
      await this.admissionStore.markLlmJobReady(pending.jobId, fairnessKey);
      return false;
    }

    const decision = await this.buildAdmissionDecision(pending);
    if (!decision) {
      await this.addReadyJob(pending);
      return true;
    }

    const reservationId = randomUUID();
    const reserved = await this.admissionStore.tryReserveConcurrency(
      { fairnessKey, reservationId },
      decision.effectiveConcurrency,
    );
    if (!reserved) {
      await this.admissionStore.scheduleFairnessKey(fairnessKey, Date.now() + this.concurrencyRetryMs);
      return false;
    }

    try {
      await this.addReadyJob(pending, {
        fairnessKey,
        reservationId,
        leaseExpiresAt: new Date(Date.now() + this.admissionStore.defaultLeaseTtlMs).toISOString(),
        concurrencyLimit: decision.effectiveConcurrency,
      });
      return true;
    } catch (error) {
      if (!(error instanceof ReadyMarkFailedError)) {
        await this.admissionStore.releaseConcurrencyReservation({ fairnessKey, reservationId });
        await this.admissionStore.scheduleFairnessKey(fairnessKey, Date.now() + this.concurrencyRetryMs);
      }
      this.logger.warn(
        { jobId: pending.jobId, fairnessKey, error: (error as Error).message },
        'llm_admission_ready_enqueue_failed',
      );
      return false;
    }
  }

  private async addReadyJob(pending: PendingLlmJob, admission?: NonNullable<LlmJobPayload['admission']>): Promise<void> {
    const payload = admission ? { ...pending.payload, admission } : pending.payload;
    await this.llmQueue.add('llm-invoke', payload, { jobId: pending.jobId });
    try {
      await this.admissionStore.markLlmJobReady(pending.jobId, pending.fairnessKey);
    } catch (error) {
      throw new ReadyMarkFailedError((error as Error).message);
    }
    this.logger.debug(
      {
        jobId: pending.jobId,
        fairnessKey: pending.fairnessKey,
        admitted: admission !== undefined,
        concurrencyLimit: admission?.concurrencyLimit ?? null,
      },
      'llm_pending_job_admitted',
    );
  }

  private async buildAdmissionDecision(
    pending: PendingLlmJob,
  ): Promise<{ effectiveConcurrency: number } | null> {
    const model = await this.loadModelLimits(pending.payload.modelId);
    if (!model?.isActive) return null;

    const runtimeLimits = await this.runtimeLimitsProvider.mergeLlmLimits({
      project: { projectId: pending.payload.projectId, orgId: pending.payload.orgId, source: 'local' },
      modelId: pending.payload.modelId,
      source: pending.payload.source,
      limits: pending.payload.limits,
    });
    const merged = mergeLimits(model, runtimeLimits);
    const estimated = estimateLLMTokens({
      messages: pending.payload.renderedPrompt.messages as LLMMessage[] | undefined,
      prompt: pending.payload.renderedPrompt.prompt,
      tools: pending.payload.renderedPrompt.tools,
      responseFormat: pending.payload.renderedPrompt.responseFormat,
      maxTokens: pending.payload.inference?.maxTokens,
    });
    if (!model.autoConcurrency) return { effectiveConcurrency: merged.concurrencyLimit };

    const usage = await this.limiter.getUsage?.(pending.fairnessKey);
    return {
      effectiveConcurrency: deriveEffectiveConcurrency({
        rpmLimit: merged.rpmLimit,
        tpmLimit: merged.tpmLimit,
        ceiling: merged.concurrencyLimit,
        latencyEwmaMs: usage?.latencyEwmaMs ?? DEFAULT_LATENCY_EWMA_MS,
        tokensEwma: usage?.tokensEwma ?? estimated.totalTokens,
        backoffFactor: usage?.backoffFactor ?? 1,
      }),
    };
  }

  private async loadModelLimits(modelId: string): Promise<ModelLimitRow | null> {
    const [model] = await this.db
      .select({
        rpmLimit: schema.models.rpmLimit,
        tpmLimit: schema.models.tpmLimit,
        concurrencyLimit: schema.models.concurrencyLimit,
        autoConcurrency: schema.models.autoConcurrency,
        isActive: schema.models.isActive,
      })
      .from(schema.models)
      .where(eq(schema.models.id, modelId))
      .limit(1);
    return model ?? null;
  }
}

function mergeLimits(model: ModelLimitRow, runtime: RuntimeLimits | undefined): Pick<ModelLimitRow, 'rpmLimit' | 'tpmLimit' | 'concurrencyLimit'> {
  return {
    rpmLimit: mergeWindowLimit(model.rpmLimit, runtime?.rpmLimit),
    tpmLimit: mergeWindowLimit(model.tpmLimit, runtime?.tpmLimit),
    concurrencyLimit:
      typeof runtime?.concurrency === 'number' ? Math.min(model.concurrencyLimit, runtime.concurrency) : model.concurrencyLimit,
  };
}

function mergeWindowLimit(modelLimit: number, runtimeLimit: number | undefined): number {
  if (typeof runtimeLimit !== 'number' || runtimeLimit <= 0) return modelLimit;
  if (modelLimit <= 0) return runtimeLimit;
  return Math.min(modelLimit, runtimeLimit);
}

function llmAdmissionEnabled(): boolean {
  return process.env['PH_LLM_ADMISSION_ENABLED'] !== 'false';
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ReadyMarkFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadyMarkFailedError';
  }
}
