import { RateLimitExceededError } from '@proofhound/limiter';
import { DelayedError } from 'bullmq';
import { vi } from 'vitest';
import { LlmConsumer } from '../llm.consumer';
import { LocalLimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';
import { LocalQuotaPolicyHook } from '../../../server/common/contracts/quota-policy.hook';
import { LocalRuntimeLimitsProvider } from '../../../server/common/contracts/runtime-limits.provider';
import * as llmRunnerModule from '../../runners/llm-runner';
import * as runResultWriterModule from '../../runners/run-result-writer';

const validUuid = (suffix: string) => `a1b2c3d4-e5f6-4789-a012-3456789${suffix}`;

function buildJob(overrides: Partial<Record<string, unknown>> = {}) {
  const moveToDelayed = vi.fn<(when: number, token?: string) => Promise<void>>(async () => undefined);
  return {
    id: 'job-1',
    attemptsMade: 0,
    moveToDelayed,
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

function fakeRedis() {
  return {
    ttl: vi.fn().mockResolvedValue(-2),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

describe('LlmConsumer.process — RateLimitExceededError handling', () => {
  it('moves the job to delayed and throws DelayedError when limiter rejects', async () => {
    const runMock = vi.fn(async () => {
      throw new RateLimitExceededError('rpm', 1500);
    });
    vi.spyOn(llmRunnerModule, 'createLlmRunner').mockReturnValue(runMock);

    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
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
        status: 'error',
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
