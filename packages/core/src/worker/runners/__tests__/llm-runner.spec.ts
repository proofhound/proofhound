import { randomBytes } from 'node:crypto';
import { encryptApiKey } from '@proofhound/crypto';
import type { DbClient } from '@proofhound/db';
import type { ModelInvocationConfig } from '@proofhound/llm-client';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectContext } from '@proofhound/shared';
import { applyExperimentLimits, createLlmRunner, loadModelInvocationConfig } from '../llm-runner';
import { LimiterKeyStrategy, LocalLimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';
import { LocalQuotaPolicyHook, type QuotaPolicyHook } from '../../../server/common/contracts/quota-policy.hook';
import {
  LocalRuntimeLimitsProvider,
  RuntimeLimitsProvider,
} from '../../../server/common/contracts/runtime-limits.provider';
import { NoopUsageMeteringHook, type UsageMeteringHook } from '../../../server/common/contracts/usage-metering.hook';
import { createModelSecretResolver } from '../model-secret';

const invokeLLMMock = vi.hoisted(() => vi.fn());
vi.mock('@proofhound/llm-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, invokeLLM: invokeLLMMock };
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

describe('loadModelInvocationConfig', () => {
  it('loads an active model and decrypts its api key via @proofhound/crypto', async () => {
    const config = await loadModelInvocationConfig(
      {
        db: fakeDb(activeModel),
        modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      },
      activeModel.id,
    );

    expect(config).toEqual(
      expect.objectContaining({
        id: activeModel.id,
        providerType: 'openai',
        providerModelId: 'gpt-test',
        apiKey: 'test-key',
        capabilities: { image: 'both' },
        extraBody: { top_k: 40 },
      }),
    );
  });

  it('rejects missing or inactive models as validation errors', async () => {
    await expect(
      loadModelInvocationConfig(
        {
          db: fakeDb({ ...activeModel, isActive: false }),
          modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
        },
        activeModel.id,
      ),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    await expect(
      loadModelInvocationConfig(
        {
          db: fakeDb(undefined),
          modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
        },
        activeModel.id,
      ),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

describe('runLlmJob — webhook 入口归因透传', () => {
  it('forwards payload.webhookTokenId into the run_result record on the success path', async () => {
    invokeLLMMock.mockResolvedValue({
      content: '{"ok":true}',
      parsed: { ok: true },
      decisionOutput: null,
      isCorrect: null,
      judgmentStatus: null,
      usage: { inputTokens: 1, outputTokens: 1 },
      costEstimate: 0,
      durationMs: 1,
    });
    const quotaPolicy = createSpyQuotaPolicy();
    const runLlmJob = createLlmRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new LocalLimiterKeyStrategy(),
      quotaPolicy,
      usageMetering: new NoopUsageMeteringHook(),
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
    });
    const webhookTokenId = '99999999-9999-4999-8999-999999999999';

    await runLlmJob(
      {
        projectId: '22222222-2222-4222-8222-222222222222',
        source: 'release',
        sourceId: '33333333-3333-4333-8333-333333333333',
        promptVersionId: '44444444-4444-4444-8444-444444444444',
        modelId: activeModel.id,
        runResultId: '11111111-1111-4111-8111-111111111111',
        renderedPrompt: { prompt: 'hi' },
        webhookTokenId,
      } as never,
      { bullmqJobId: 'job-1', bullmqQueue: 'llm', attempt: 1 },
    );

    expect(invokeLLMMock).toHaveBeenCalledTimes(1);
    const [args] = invokeLLMMock.mock.calls[0]!;
    expect(args.runResult).toMatchObject({ webhookTokenId });
    expect(quotaPolicy.withExecutionSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          projectId: '22222222-2222-4222-8222-222222222222',
          source: 'local',
        }),
        source: 'release',
        modelId: activeModel.id,
        requestId: undefined,
      }),
      expect.any(Function),
    );
  });
});

describe('runLlmJob — orgId 透传至限流 key 的 ProjectContext', () => {
  class SpyStrategy extends LimiterKeyStrategy {
    seen?: ProjectContext;
    buildModelKey(project: ProjectContext, modelId: string): string {
      this.seen = project;
      return `model:${modelId}`;
    }
  }

  it('forwards payload.orgId (and projectId) into buildModelKey project arg', async () => {
    invokeLLMMock.mockResolvedValue({
      content: '{"ok":true}',
      parsed: { ok: true },
      decisionOutput: null,
      isCorrect: null,
      judgmentStatus: null,
      usage: { inputTokens: 1, outputTokens: 1 },
      costEstimate: 0,
      durationMs: 1,
    });
    const spy = new SpyStrategy();
    const projectId = '22222222-2222-4222-8222-222222222222';
    const runLlmJob = createLlmRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: spy,
      quotaPolicy: new LocalQuotaPolicyHook(),
      usageMetering: new NoopUsageMeteringHook(),
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
    });

    await runLlmJob(
      {
        projectId,
        orgId: '00000000-0000-4000-8000-000000000777',
        source: 'experiment',
        sourceId: '33333333-3333-4333-8333-333333333333',
        promptVersionId: '44444444-4444-4444-8444-444444444444',
        modelId: activeModel.id,
        runResultId: '11111111-1111-4111-8111-111111111111',
        renderedPrompt: { prompt: 'hi' },
      } as never,
      { bullmqJobId: 'job-1', bullmqQueue: 'llm', attempt: 1 },
    );

    expect(spy.seen?.orgId).toBe('00000000-0000-4000-8000-000000000777');
    expect(spy.seen?.projectId).toBe(projectId);
  });
});

describe('runLlmJob — usage metering job lifecycle', () => {
  it('records started and completed events without changing the runner result', async () => {
    invokeLLMMock.mockClear();
    invokeLLMMock.mockImplementation(async (_args, deps) => {
      await deps.onLimiterAcquired?.({
        key: 'model:test',
        estimatedTokens: 42,
        acquireResult: { effectiveConcurrency: 2, backoffFactor: 1, latencyEwmaMs: 3000 },
      });
      return {
        content: '{"ok":true}',
        parsed: { ok: true },
        decisionOutput: null,
        isCorrect: null,
        judgmentStatus: null,
        usage: { inputTokens: 3, outputTokens: 4 },
        costEstimate: 0.0001,
        durationMs: 12,
      };
    });
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const runLlmJob = createLlmRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new LocalLimiterKeyStrategy(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      usageMetering,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
    });

    const result = await runLlmJob(
      {
        projectId: '22222222-2222-4222-8222-222222222222',
        source: 'experiment',
        sourceId: '33333333-3333-4333-8333-333333333333',
        promptVersionId: '44444444-4444-4444-8444-444444444444',
        modelId: activeModel.id,
        runResultId: '11111111-1111-4111-8111-111111111111',
        renderedPrompt: { prompt: 'hi' },
      } as never,
      { bullmqJobId: 'job-1', bullmqQueue: 'llm', attempt: 2 },
    );

    expect(result.runResultId).toBe('11111111-1111-4111-8111-111111111111');
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:llm:job-1:2:job.started',
        eventType: 'job.started',
        payload: expect.objectContaining({
          status: 'started',
          estimatedTokens: 42,
          effectiveConcurrency: 2,
        }),
      }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:llm:job-1:2:job.completed',
        eventType: 'job.completed',
        payload: expect.objectContaining({
          status: 'completed',
          latencyMs: 12,
          inputTokens: 3,
          outputTokens: 4,
        }),
      }),
    );
  });

  it('records failed events while preserving the original error', async () => {
    invokeLLMMock.mockClear();
    invokeLLMMock.mockRejectedValue(new Error('provider down'));
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const runLlmJob = createLlmRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new LocalLimiterKeyStrategy(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      usageMetering,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      runtimeLimitsProvider: new LocalRuntimeLimitsProvider(),
    });

    await expect(
      runLlmJob(
        {
          projectId: '22222222-2222-4222-8222-222222222222',
          source: 'experiment',
          sourceId: '33333333-3333-4333-8333-333333333333',
          promptVersionId: '44444444-4444-4444-8444-444444444444',
          modelId: activeModel.id,
          runResultId: '11111111-1111-4111-8111-111111111111',
          renderedPrompt: { prompt: 'hi' },
        } as never,
        { bullmqJobId: 'job-1', bullmqQueue: 'llm', attempt: 1 },
      ),
    ).rejects.toThrow('provider down');

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:llm:job-1:1:job.attempt_failed',
        eventType: 'job.attempt_failed',
        payload: expect.objectContaining({
          status: 'failed',
          errorKind: 'Error',
        }),
      }),
    );
  });
});

function fakeDb(row: typeof activeModel | undefined): DbClient {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
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

describe('runLlmJob — RuntimeLimitsProvider 把 plan cap 并入有效限制', () => {
  class CapProvider extends RuntimeLimitsProvider {
    async mergeLlmLimits(): Promise<{ rpmLimit: number; tpmLimit: number; concurrency: number }> {
      return { rpmLimit: 100, tpmLimit: 10_000, concurrency: 1 };
    }
  }

  it('applies min(model, planCap) before invokeLLM (SaaS RuntimeLimitsProvider lowers concurrency)', async () => {
    invokeLLMMock.mockResolvedValue({
      content: '{}',
      parsed: {},
      decisionOutput: null,
      isCorrect: null,
      judgmentStatus: null,
      usage: { inputTokens: 1, outputTokens: 1 },
      costEstimate: 0,
      durationMs: 1,
    });
    const runLlmJob = createLlmRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new LocalLimiterKeyStrategy(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      usageMetering: new NoopUsageMeteringHook(),
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      runtimeLimitsProvider: new CapProvider(),
    });

    await runLlmJob(
      {
        projectId: '22222222-2222-4222-8222-222222222222',
        source: 'experiment',
        sourceId: '33333333-3333-4333-8333-333333333333',
        promptVersionId: '44444444-4444-4444-8444-444444444444',
        modelId: activeModel.id,
        runResultId: '11111111-1111-4111-8111-111111111111',
        renderedPrompt: { prompt: 'hi' },
      } as never,
      { bullmqJobId: 'job-cap', bullmqQueue: 'llm', attempt: 1 },
    );

    // activeModel.concurrencyLimit is 2; the provider caps concurrency to 1 → effective min is 1.
    const lastCall = invokeLLMMock.mock.calls.at(-1)!;
    expect(lastCall[0].model.concurrencyLimit).toBe(1);
  });

  it('applies positive plan caps to unlimited model rpm/tpm before invokeLLM', async () => {
    invokeLLMMock.mockResolvedValue({
      content: '{}',
      parsed: {},
      decisionOutput: null,
      isCorrect: null,
      judgmentStatus: null,
      usage: { inputTokens: 1, outputTokens: 1 },
      costEstimate: 0,
      durationMs: 1,
    });
    const runLlmJob = createLlmRunner({
      db: fakeDb({ ...activeModel, rpmLimit: -1, tpmLimit: -1, concurrencyLimit: 4 }),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: new LocalLimiterKeyStrategy(),
      quotaPolicy: new LocalQuotaPolicyHook(),
      usageMetering: new NoopUsageMeteringHook(),
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      runtimeLimitsProvider: new CapProvider(),
    });

    await runLlmJob(
      {
        projectId: '22222222-2222-4222-8222-222222222222',
        source: 'experiment',
        sourceId: '33333333-3333-4333-8333-333333333333',
        promptVersionId: '44444444-4444-4444-8444-444444444444',
        modelId: activeModel.id,
        runResultId: '11111111-1111-4111-8111-111111111112',
        renderedPrompt: { prompt: 'hi' },
      } as never,
      { bullmqJobId: 'job-unlimited-cap', bullmqQueue: 'llm', attempt: 1 },
    );

    const lastCall = invokeLLMMock.mock.calls.at(-1)!;
    expect(lastCall[0].model).toMatchObject({
      rpmLimit: 100,
      tpmLimit: 10_000,
      concurrencyLimit: 1,
    });
  });
});

describe('applyExperimentLimits — 实验级与模型级取 min', () => {
  const base: ModelInvocationConfig = {
    id: 'm-1',
    providerType: 'openai',
    providerModelId: 'gpt-test',
    endpoint: 'https://x',
    apiKey: 'k',
    capabilities: { image: 'none' },
    rpmLimit: 100,
    tpmLimit: 10_000,
    concurrencyLimit: 8,
    autoConcurrency: true,
    inputTokenPricePerMillion: 0,
    outputTokenPricePerMillion: 0,
  };

  it('payload.limits 为 undefined → 原 model 不变', () => {
    expect(applyExperimentLimits(base, undefined)).toEqual(base);
  });

  it('实验级收紧 concurrency 后 autoConcurrency 仍由模型级决定（实验不覆盖开关）', () => {
    const eff = applyExperimentLimits(base, { concurrency: 3 });
    expect(eff.concurrencyLimit).toBe(3);
    expect(eff.autoConcurrency).toBe(true);
  });

  it('payload.limits 完整 → 三字段独立取 min', () => {
    const eff = applyExperimentLimits(base, { rpmLimit: 10, tpmLimit: 5000, concurrency: 2 });
    expect(eff.rpmLimit).toBe(10);
    expect(eff.tpmLimit).toBe(5000);
    expect(eff.concurrencyLimit).toBe(2);
  });

  it('实验级 > 模型级 → 仍取模型级（self-throttle 只能向下）', () => {
    const eff = applyExperimentLimits(base, { rpmLimit: 500, tpmLimit: 100_000, concurrency: 99 });
    expect(eff.rpmLimit).toBe(100);
    expect(eff.tpmLimit).toBe(10_000);
    expect(eff.concurrencyLimit).toBe(8);
  });

  it('只填部分字段 → 其它字段回退到模型级', () => {
    const eff = applyExperimentLimits(base, { rpmLimit: 10 });
    expect(eff.rpmLimit).toBe(10);
    expect(eff.tpmLimit).toBe(10_000);
    expect(eff.concurrencyLimit).toBe(8);
  });
});
