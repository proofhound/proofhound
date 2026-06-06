import 'reflect-metadata';
import { llmJobPayloadSchema, webhookAsyncCallKey, type LlmJobPayload } from '@proofhound/orchestration-shared';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKER_CONCURRENCY, resolveWorkerConcurrency } from '../../config/worker-concurrency';
import type { LlmRunnerResult } from '../../runners/llm-runner';
import { LocalLimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';
import { LocalQuotaPolicyHook } from '../../../server/common/contracts/quota-policy.hook';
import { LocalRuntimeLimitsProvider } from '../../../server/common/contracts/runtime-limits.provider';
import { LLM_WORKER_CONCURRENCY, LlmConsumer } from '../llm.consumer';

const validUuid = (suffix: string) => `a1b2c3d4-e5f6-4789-a012-3456789${suffix}`;

describe('llm.consumer payload contract', () => {
  it('accepts a well-formed LLM job payload', () => {
    const result = llmJobPayloadSchema.safeParse({
      projectId: validUuid('01111'),
      source: 'experiment',
      sourceId: validUuid('02222'),
      promptVersionId: validUuid('03333'),
      modelId: validUuid('04444'),
      renderedPrompt: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an LLM job payload with a bad uuid', () => {
    const result = llmJobPayloadSchema.safeParse({
      projectId: 'not-a-uuid',
      source: 'experiment',
      sourceId: validUuid('02222'),
      promptVersionId: validUuid('03333'),
      modelId: validUuid('04444'),
      renderedPrompt: { prompt: 'hi' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown source value', () => {
    const result = llmJobPayloadSchema.safeParse({
      projectId: validUuid('01111'),
      source: 'unknown-source',
      sourceId: validUuid('02222'),
      promptVersionId: validUuid('03333'),
      modelId: validUuid('04444'),
      renderedPrompt: { prompt: 'hi' },
    });
    expect(result.success).toBe(false);
  });
});

describe('LlmConsumer worker concurrency', () => {
  it('resolves a positive integer concurrency value', () => {
    expect(resolveWorkerConcurrency('8')).toBe(8);
    expect(resolveWorkerConcurrency(3)).toBe(3);
  });

  it('falls back to the default for missing or invalid values', () => {
    expect(resolveWorkerConcurrency(undefined)).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(resolveWorkerConcurrency('0')).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(resolveWorkerConcurrency('-1')).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(resolveWorkerConcurrency('1.5')).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(resolveWorkerConcurrency('not-a-number')).toBe(DEFAULT_WORKER_CONCURRENCY);
  });

  it('passes the resolved value to the BullMQ worker options metadata', () => {
    expect(Reflect.getMetadata('bullmq:worker_metadata', LlmConsumer)).toMatchObject({
      concurrency: LLM_WORKER_CONCURRENCY,
    });
  });
});

describe('LlmConsumer webhook async receipts', () => {
  it('writes a success receipt without reading run_results', async () => {
    const redis = {
      ttl: vi.fn().mockResolvedValue(1200),
      set: vi.fn().mockResolvedValue('OK'),
    };
    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      redis as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
    );
    const result: LlmRunnerResult = {
      runResultId: validUuid('05555'),
      content: '{"label":"low"}',
      parsed: { label: 'low' },
      decisionOutput: 'low',
      isCorrect: null,
      judgmentStatus: null,
      usage: { inputTokens: 10, outputTokens: 4 },
      costEstimate: 0.000001,
      durationMs: 42,
    };
    (consumer as unknown as { runLlmJob: () => Promise<LlmRunnerResult> }).runLlmJob = vi
      .fn()
      .mockResolvedValue(result);

    const payload = makeWebhookPayload();
    await consumer.process({ id: payload.runResultId, data: payload, attemptsMade: 0 } as Job<unknown>);

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, raw, ex, ttl] = redis.set.mock.calls[0]!;
    expect(key).toBe(webhookAsyncCallKey(payload.webhookAsyncCall!.callId));
    expect(ex).toBe('EX');
    expect(ttl).toBe(1200);
    expect(JSON.parse(raw as string)).toMatchObject({
      status: 'success',
      callId: payload.webhookAsyncCall!.callId,
      runResultId: payload.runResultId,
      externalId: 'sample-1',
      result: { label: 'low' },
      rawResponse: '{"label":"low"}',
    });
  });

  it('writes an error receipt on final failure even if run_results persistence is separate', async () => {
    const redis = {
      ttl: vi.fn().mockResolvedValue(900),
      set: vi.fn().mockResolvedValue('OK'),
    };
    const consumer = new LlmConsumer(
      {} as never,
      {} as never,
      {} as never,
      redis as never,
      new LocalLimiterKeyStrategy(),
      new LocalQuotaPolicyHook(),
      new LocalRuntimeLimitsProvider(),
    );
    const writeRunResult = vi.fn().mockResolvedValue(undefined);
    (consumer as unknown as { runResultWriter: { writeRunResult: typeof writeRunResult } }).runResultWriter = {
      writeRunResult,
    };

    const payload = makeWebhookPayload();
    await consumer.onFailed(
      {
        id: payload.runResultId,
        data: payload,
        attemptsMade: 5,
        opts: { attempts: 5 },
        failedReason: 'provider down',
      } as Job<unknown>,
      new Error('provider down'),
    );

    expect(writeRunResult).toHaveBeenCalledTimes(1);
    expect(writeRunResult).toHaveBeenCalledWith(expect.objectContaining({ webhookTokenId: validUuid('08888') }));
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [, raw, ex, ttl] = redis.set.mock.calls[0]!;
    expect(ex).toBe('EX');
    expect(ttl).toBe(900);
    expect(JSON.parse(raw as string)).toMatchObject({
      status: 'error',
      callId: payload.webhookAsyncCall!.callId,
      runResultId: payload.runResultId,
      errorClass: 'Error',
      errorMessage: 'provider down',
    });
  });
});

function makeWebhookPayload(): LlmJobPayload {
  const callId = validUuid('05555');
  return {
    projectId: validUuid('01111'),
    source: 'release',
    sourceId: validUuid('02222'),
    promptVersionId: validUuid('03333'),
    modelId: validUuid('04444'),
    runResultId: callId,
    promptId: validUuid('06666'),
    externalId: 'sample-1',
    webhookTokenId: validUuid('08888'),
    renderedPrompt: { prompt: 'hello' },
    webhookAsyncCall: {
      callId,
      runResultId: callId,
      projectId: validUuid('01111'),
      connectorId: validUuid('07777'),
      releaseLineEventId: validUuid('02222'),
      externalId: 'sample-1',
      acceptedAt: '2026-05-21T00:00:00.000Z',
      expiresAt: '2026-05-21T00:30:00.000Z',
    },
  };
}
