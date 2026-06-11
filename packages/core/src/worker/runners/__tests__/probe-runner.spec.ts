import { randomBytes } from 'node:crypto';
import { encryptApiKey } from '@proofhound/crypto';
import type { DbClient } from '@proofhound/db';
import { RateLimitExceededError } from '@proofhound/limiter';
import type { ProjectContext } from '@proofhound/shared';
import { LOCAL_PROJECT_ID } from '@proofhound/shared';
import { describe, expect, it, vi } from 'vitest';
import { createProbeRunner } from '../probe-runner';
import { LimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';
import { LocalQuotaPolicyHook, type QuotaPolicyHook } from '../../../server/common/contracts/quota-policy.hook';
import {
  LocalRuntimeLimitsProvider,
  RuntimeLimitsProvider,
} from '../../../server/common/contracts/runtime-limits.provider';
import { NoopUsageMeteringHook, type UsageMeteringHook } from '../../../server/common/contracts/usage-metering.hook';
import { createModelSecretResolver } from '../model-secret';

const testModelConnectivityMock = vi.hoisted(() => vi.fn());
vi.mock('@proofhound/llm-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, testModelConnectivity: testModelConnectivityMock };
});

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

const activeModel = {
  id: '11111111-1111-1111-1111-111111111111',
  providerType: 'openai',
  providerModelId: 'gpt-test',
  endpoint: 'https://llm.example.test/v1',
  apiKeyEncrypted: encryptApiKey('test-key', ENCRYPTION_KEY),
  isActive: true,
  rpmLimit: 60,
  tpmLimit: 1000,
  concurrencyLimit: 2,
  inputTokenPricePerMillion: '1.5',
  outputTokenPricePerMillion: '3.5',
  capabilities: { image: 'both' },
  extraBody: { top_k: 40 },
};

describe('runProbeJob — orgId 透传至限流 key 的 ProjectContext', () => {
  class SpyStrategy extends LimiterKeyStrategy {
    seen?: ProjectContext;
    buildModelKey(project: ProjectContext, modelId: string): string {
      this.seen = project;
      return `model:${modelId}`;
    }
  }

  it('forwards payload.orgId (and projectId) into buildModelKey project arg', async () => {
    testModelConnectivityMock.mockResolvedValue({
      ok: true,
      modelId: activeModel.id,
      providerType: 'openai',
      providerModelId: 'gpt-test',
      endpoint: activeModel.endpoint,
      durationMs: 1,
      checkedAt: '2026-05-21T00:00:00.000Z',
    });
    const spy = new SpyStrategy();
    const projectId = '22222222-2222-4222-8222-222222222222';
    const quotaPolicy = createSpyQuotaPolicy();
    const runProbeJob = createProbeRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: spy,
      quotaPolicy,
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
      usageMetering: new NoopUsageMeteringHook(),
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await runProbeJob(
      { modelId: activeModel.id, projectId, orgId: '00000000-0000-4000-8000-000000000777' },
      { bullmqJobId: 'probe-1', bullmqQueue: 'probe', attempt: 1 },
    );

    expect(spy.seen?.orgId).toBe('00000000-0000-4000-8000-000000000777');
    expect(spy.seen?.projectId).toBe(projectId);
    expect(quotaPolicy.withExecutionSlot).toHaveBeenCalledWith(
      {
        project: {
          projectId,
          orgId: '00000000-0000-4000-8000-000000000777',
          source: 'local',
        },
        source: 'probe',
        modelId: activeModel.id,
        requestId: undefined,
      },
      expect.any(Function),
    );
    expect(testModelConnectivityMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to LOCAL_PROJECT_CONTEXT when projectId is absent (OSS default)', async () => {
    testModelConnectivityMock.mockResolvedValue({
      ok: true,
      modelId: activeModel.id,
      providerType: 'openai',
      providerModelId: 'gpt-test',
      endpoint: activeModel.endpoint,
      durationMs: 1,
      checkedAt: '2026-05-21T00:00:00.000Z',
    });
    const spy = new SpyStrategy();
    const runProbeJob = createProbeRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: spy,
      quotaPolicy: new LocalQuotaPolicyHook(),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
      usageMetering: new NoopUsageMeteringHook(),
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await runProbeJob({ modelId: activeModel.id }, { bullmqJobId: 'probe-1', bullmqQueue: 'probe', attempt: 1 });

    expect(spy.seen?.projectId).toBe(LOCAL_PROJECT_ID);
    expect(spy.seen?.orgId).toBeUndefined();
  });
});

describe('runProbeJob — RuntimeLimitsProvider 把 plan cap 并入有效限制', () => {
  class CapProvider extends RuntimeLimitsProvider {
    async mergeLlmLimits(): Promise<{ rpmLimit: number; tpmLimit: number; concurrency: number }> {
      return { rpmLimit: 100, tpmLimit: 10_000, concurrency: 2 };
    }
  }

  it('applies positive plan caps to unlimited model rpm/tpm before testModelConnectivity', async () => {
    testModelConnectivityMock.mockResolvedValue({
      ok: true,
      modelId: activeModel.id,
      providerType: 'openai',
      providerModelId: 'gpt-test',
      endpoint: activeModel.endpoint,
      durationMs: 1,
      checkedAt: '2026-05-21T00:00:00.000Z',
    });
    const runProbeJob = createProbeRunner({
      db: fakeDb({ ...activeModel, rpmLimit: -1, tpmLimit: -1, concurrencyLimit: 4 }),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new (class extends LimiterKeyStrategy {
        buildModelKey(): string {
          return 'model:test';
        }
      })(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      runtimeLimitsProvider: new CapProvider(),
      usageMetering: new NoopUsageMeteringHook(),
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await runProbeJob(
      {
        modelId: activeModel.id,
        projectId: '22222222-2222-4222-8222-222222222222',
        orgId: '33333333-3333-4333-8333-333333333333',
      },
      { bullmqJobId: 'probe-1', bullmqQueue: 'probe', attempt: 1 },
    );

    expect(testModelConnectivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          rpmLimit: 100,
          tpmLimit: 10_000,
          concurrencyLimit: 2,
        }),
      }),
      expect.any(Object),
    );
  });
});

describe('runProbeJob — usage metering job lifecycle', () => {
  it('records started and completed events', async () => {
    testModelConnectivityMock.mockClear();
    testModelConnectivityMock.mockImplementation(async (_args, deps) => {
      await deps.onLimiterAcquired?.({ key: 'model:test', estimatedTokens: 8 });
      return {
        ok: true,
        modelId: activeModel.id,
        providerType: 'openai',
        providerModelId: 'gpt-test',
        endpoint: activeModel.endpoint,
        durationMs: 5,
        checkedAt: '2026-05-21T00:00:00.000Z',
      };
    });
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const runProbeJob = createProbeRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new (class extends LimiterKeyStrategy {
        buildModelKey(): string {
          return 'model:test';
        }
      })(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
      usageMetering,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await runProbeJob(
      { modelId: activeModel.id, projectId: '22222222-2222-4222-8222-222222222222' },
      { bullmqJobId: 'probe-job-1', bullmqQueue: 'probe', attempt: 1 },
    );

    expect(testModelConnectivityMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ rethrowRateLimit: true }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:probe:probe-job-1:1:job.started',
        eventType: 'job.started',
        payload: expect.objectContaining({ status: 'started', estimatedTokens: 8 }),
      }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:probe:probe-job-1:1:job.completed',
        eventType: 'job.completed',
        payload: expect.objectContaining({ status: 'completed', latencyMs: 5 }),
      }),
    );
  });

  it('records failed events and rethrows unexpected errors', async () => {
    testModelConnectivityMock.mockRejectedValue(new Error('probe crashed'));
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const runProbeJob = createProbeRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new (class extends LimiterKeyStrategy {
        buildModelKey(): string {
          return 'model:test';
        }
      })(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
      usageMetering,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await expect(
      runProbeJob(
        { modelId: activeModel.id, projectId: '22222222-2222-4222-8222-222222222222' },
        { bullmqJobId: 'probe-job-1', bullmqQueue: 'probe', attempt: 1 },
      ),
    ).rejects.toThrow('probe crashed');

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:probe:probe-job-1:1:job.failed',
        eventType: 'job.failed',
        payload: expect.objectContaining({ status: 'failed', errorKind: 'Error' }),
      }),
    );
  });

  it('rethrows rate-limit rejections without recording them as job.failed', async () => {
    const rateLimitError = new RateLimitExceededError('rpm', 1500);
    testModelConnectivityMock.mockRejectedValue(rateLimitError);
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const runProbeJob = createProbeRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new (class extends LimiterKeyStrategy {
        buildModelKey(): string {
          return 'model:test';
        }
      })(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
      usageMetering,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await expect(
      runProbeJob(
        { modelId: activeModel.id, projectId: '22222222-2222-4222-8222-222222222222' },
        { bullmqJobId: 'probe-job-1', bullmqQueue: 'probe', attempt: 1 },
      ),
    ).rejects.toBe(rateLimitError);

    expect(usageMetering.record).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'job.failed',
      }),
    );
  });
});

// Supports both loadModelInvocationConfig's select(...).limit() read and the probe's update(...).where() write.
function fakeDb(row: typeof activeModel | undefined): DbClient {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  } as unknown as DbClient;
}

function createSpyQuotaPolicy(): QuotaPolicyHook {
  return {
    assertCanStore: vi.fn(async () => undefined),
    withExecutionSlot: vi.fn(async (_input, run) => run()),
  };
}
