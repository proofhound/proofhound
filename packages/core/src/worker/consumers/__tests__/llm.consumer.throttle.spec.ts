import { RateLimitExceededError } from '@proofhound/limiter';
import { DelayedError } from 'bullmq';
import { afterEach, vi } from 'vitest';
import { LlmConsumer } from '../llm.consumer';
import { LocalLimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';
import { LocalQuotaPolicyHook } from '../../../server/common/contracts/quota-policy.hook';
import { LocalRuntimeLimitsProvider } from '../../../server/common/contracts/runtime-limits.provider';
import { NoopUsageMeteringHook, type UsageMeteringHook } from '../../../server/common/contracts/usage-metering.hook';
import * as llmRunnerModule from '../../runners/llm-runner';
import * as runResultWriterModule from '../../runners/run-result-writer';

const validUuid = (suffix: string) => `a1b2c3d4-e5f6-4789-a012-3456789${suffix}`;

function buildJob(overrides: Partial<Record<string, unknown>> = {}) {
  const moveToDelayed = vi.fn<(when: number, token?: string) => Promise<void>>(async () => undefined);
  const updateData = vi.fn<(data: unknown) => Promise<void>>(async () => undefined);
  return {
    id: 'job-1',
    attemptsMade: 0,
    moveToDelayed,
    updateData,
    data: {
      projectId: validUuid('01111'),
      source: 'experiment' as const,
      sourceId: validUuid('02222'),
      promptVersionId: validUuid('03333'),
      modelId: validUuid('04444'),
      renderedPrompt: { messages: [{ role: 'user', content: 'hi' }] },
    },
    ...overrides,
  };
}

function successResult() {
  return {
    runResultId: validUuid('05555'),
    content: 'ok',
    usage: { inputTokens: 1, outputTokens: 1 },
    costEstimate: 0,
    durationMs: 1,
  };
}

function fakeRedis() {
  return {
    ttl: vi.fn().mockResolvedValue(-2),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LlmConsumer.process — RateLimitExceededError handling', () => {
  it('releases an admission reservation after processing an admitted job', async () => {
    const runMock = vi.fn(async () => successResult());
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(runMock);
    const admissionStore = {
      defaultLeaseTtlMs: 600_000,
      extendConcurrencyReservation: vi.fn(async () => true),
      releaseConcurrencyReservation: vi.fn(async () => undefined),
    };
    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      new NoopUsageMeteringHook(),
      admissionStore as never,
    );

    await consumer.process(
      buildJob({
        data: {
          ...buildJob().data,
          admission: {
            fairnessKey: 'model:test',
            reservationId: '00000000-0000-4000-8000-000000000007',
          },
        },
      }) as never,
    );

    expect(admissionStore.releaseConcurrencyReservation).toHaveBeenCalledWith({
      fairnessKey: 'model:test',
      reservationId: '00000000-0000-4000-8000-000000000007',
    });
  });

  it('extends an admission reservation while an admitted job is running', async () => {
    vi.useFakeTimers();
    let finishRun!: (result: ReturnType<typeof successResult>) => void;
    const runPromise = new Promise<ReturnType<typeof successResult>>((resolve) => {
      finishRun = resolve;
    });
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(vi.fn(() => runPromise));
    const admissionStore = {
      defaultLeaseTtlMs: 3_000,
      extendConcurrencyReservation: vi.fn(async () => true),
      releaseConcurrencyReservation: vi.fn(async () => undefined),
    };
    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      new NoopUsageMeteringHook(),
      admissionStore as never,
    );
    const job = buildJob({
      data: {
        ...buildJob().data,
        admission: {
          fairnessKey: 'model:test',
          reservationId: '00000000-0000-4000-8000-000000000007',
        },
      },
    });

    const processPromise = consumer.process(job as never);
    await vi.advanceTimersByTimeAsync(999);
    expect(admissionStore.extendConcurrencyReservation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(admissionStore.extendConcurrencyReservation).toHaveBeenCalledWith({
      fairnessKey: 'model:test',
      reservationId: '00000000-0000-4000-8000-000000000007',
    });

    finishRun(successResult());
    await processPromise;
    const heartbeatCount = admissionStore.extendConcurrencyReservation.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);

    expect(admissionStore.extendConcurrencyReservation).toHaveBeenCalledTimes(heartbeatCount);
    expect(admissionStore.releaseConcurrencyReservation).toHaveBeenCalledTimes(1);
  });

  it('moves the job to delayed and throws DelayedError when limiter rejects', async () => {
    const runMock = vi.fn(async () => {
      throw new RateLimitExceededError('rpm', 1500);
    });
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(runMock);
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;

    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      usageMetering,
    );
    const job = buildJob();

    await expect(consumer.process(job as never, 'tok-1')).rejects.toBeInstanceOf(DelayedError);

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    const call = job.moveToDelayed.mock.calls[0]!;
    const whenMs = call[0];
    const token = call[1];
    expect(typeof whenMs).toBe('number');
    expect(whenMs).toBeGreaterThan(Date.now());
    expect(token).toBe('tok-1');
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:llm:job-1:1:job.rate_limited',
        dimension: 'job',
        eventType: 'job.rate_limited',
        projectId: validUuid('01111'),
        source: 'worker',
        payload: expect.objectContaining({
          queue: 'llm',
          modelId: validUuid('04444'),
          status: 'rate_limited',
          errorKind: 'rpm',
          retryAfterMs: 1500,
        }),
      }),
    );
  });

  it('strips stale admission metadata before delaying an admitted rate-limited job', async () => {
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(async () => {
      throw new RateLimitExceededError('rpm', 1500);
    });
    const admissionStore = {
      defaultLeaseTtlMs: 600_000,
      extendConcurrencyReservation: vi.fn(async () => true),
      releaseConcurrencyReservation: vi.fn(async () => undefined),
    };
    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      new NoopUsageMeteringHook(),
      admissionStore as never,
    );
    const job = buildJob({
      data: {
        ...buildJob().data,
        admission: {
          fairnessKey: 'model:test',
          reservationId: '00000000-0000-4000-8000-000000000007',
        },
      },
    });

    await expect(consumer.process(job as never, 'tok-1')).rejects.toBeInstanceOf(DelayedError);

    expect(job.updateData).toHaveBeenCalledTimes(1);
    const retryPayload = job.updateData.mock.calls[0]![0] as Record<string, unknown>;
    expect(retryPayload).not.toHaveProperty('admission');
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(admissionStore.releaseConcurrencyReservation).toHaveBeenCalledWith({
      fairnessKey: 'model:test',
      reservationId: '00000000-0000-4000-8000-000000000007',
    });
  });

  it('uses a 1s floor when retryAfterMs is smaller', async () => {
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(async () => {
      throw new RateLimitExceededError('concurrency', 100);
    });

    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      new NoopUsageMeteringHook(),
    );
    const job = buildJob();
    const before = Date.now();

    await expect(consumer.process(job as never)).rejects.toBeInstanceOf(DelayedError);

    const whenMs = job.moveToDelayed.mock.calls[0]![0];
    expect(whenMs - before).toBeGreaterThanOrEqual(1_000);
  });

  it('rethrows non-RateLimit errors so BullMQ can apply the default attempts policy', async () => {
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(async () => {
      throw new Error('provider 500');
    });

    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      new NoopUsageMeteringHook(),
    );
    const job = buildJob();

    await expect(consumer.process(job as never)).rejects.toThrow('provider 500');
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });
});

describe('LlmConsumer.onFailed — final-error run_result write on attempts exhaustion', () => {
  it('writes a single error row only after BullMQ has used up all attempts', async () => {
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(async () => undefined as never);
    const writeRunResult = vi.fn(async () => undefined);
    vi.spyOn(runResultWriterModule.DrizzleRunResultWriter.prototype, 'writeRunResult').mockImplementation(
      writeRunResult,
    );

    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      new NoopUsageMeteringHook(),
    );

    const job = {
      id: 'job-final-1',
      attemptsMade: 5,
      failedReason: 'provider 500',
      opts: { attempts: 5 },
      data: {
        projectId: validUuid('01111'),
        source: 'experiment' as const,
        sourceId: validUuid('02222'),
        promptVersionId: validUuid('03333'),
        modelId: validUuid('04444'),
        runResultId: validUuid('05555'),
        renderedPrompt: { messages: [{ role: 'user', content: 'hi' }] },
      },
    };

    await consumer.onFailed(job as never, new Error('provider 500'));

    expect(writeRunResult).toHaveBeenCalledTimes(1);
    expect(writeRunResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: validUuid('05555'),
        projectId: validUuid('01111'),
        status: 'failed',
        errorClass: 'Error',
        errorMessage: 'provider 500',
        attempt: 5,
        bullmqJobId: 'job-final-1',
      }),
    );
  });

  it('does NOT write the final error row when more attempts remain', async () => {
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(async () => undefined as never);
    const writeRunResult = vi.fn(async () => undefined);
    vi.spyOn(runResultWriterModule.DrizzleRunResultWriter.prototype, 'writeRunResult').mockImplementation(
      writeRunResult,
    );

    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      new NoopUsageMeteringHook(),
    );

    const job = {
      id: 'job-mid-1',
      attemptsMade: 2,
      failedReason: 'provider 500',
      opts: { attempts: 5 },
      data: {
        projectId: validUuid('01111'),
        source: 'experiment' as const,
        sourceId: validUuid('02222'),
        promptVersionId: validUuid('03333'),
        modelId: validUuid('04444'),
        renderedPrompt: { messages: [{ role: 'user', content: 'hi' }] },
      },
    };

    await consumer.onFailed(job as never, new Error('provider 500'));

    expect(writeRunResult).not.toHaveBeenCalled();
  });
});
