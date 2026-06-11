import { probeJobPayloadSchema } from '@proofhound/orchestration-shared';
import { RateLimitExceededError } from '@proofhound/limiter';
import { DelayedError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { LocalLimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';
import { LocalQuotaPolicyHook } from '../../../server/common/contracts/quota-policy.hook';
import { LocalRuntimeLimitsProvider } from '../../../server/common/contracts/runtime-limits.provider';
import type { UsageMeteringHook } from '../../../server/common/contracts/usage-metering.hook';
import { ProbeConsumer } from '../probe.consumer';
import * as probeRunnerModule from '../../runners/probe-runner';

const validUuid = (suffix: string) => `a1b2c3d4-e5f6-4789-a012-3456789${suffix}`;

describe('probe.consumer payload contract', () => {
  it('accepts a probe payload with only modelId', () => {
    const result = probeJobPayloadSchema.safeParse({
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid modelId', () => {
    const result = probeJobPayloadSchema.safeParse({ modelId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('ProbeConsumer.process — RateLimitExceededError handling', () => {
  it('moves the job to delayed and records a rate-limited usage event', async () => {
    vi.spyOn(probeRunnerModule, 'createProbeRunner').mockReturnValue(async () => {
      throw new RateLimitExceededError('concurrency', 250);
    });
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const consumer = new ProbeConsumer(
      {} as never,
      {} as never,
      {} as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
      usageMetering,
    );
    const moveToDelayed = vi.fn(async () => undefined);
    const job = {
      id: 'probe-job-1',
      attemptsMade: 0,
      moveToDelayed,
      data: {
        projectId: validUuid('01111'),
        modelId: validUuid('04444'),
      },
    };

    await expect(consumer.process(job as never, 'tok-1')).rejects.toBeInstanceOf(DelayedError);

    expect(moveToDelayed).toHaveBeenCalledTimes(1);
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'job:probe:probe-job-1:1:job.rate_limited',
        dimension: 'job',
        eventType: 'job.rate_limited',
        projectId: validUuid('01111'),
        payload: expect.objectContaining({
          queue: 'probe',
          modelId: validUuid('04444'),
          status: 'rate_limited',
          errorKind: 'concurrency',
          retryAfterMs: 250,
        }),
      }),
    );
  });
});
