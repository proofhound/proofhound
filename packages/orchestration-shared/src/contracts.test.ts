import { describe, expect, it } from 'vitest';
import { LOCAL_PROJECT_ID } from '@proofhound/shared';
import { BULLMQ_QUEUES } from './bullmq-queues';
import { DBOS_WORKFLOW_NAMES } from './dbos-workflow-ids';
import { NON_RETRYABLE_ERROR_TYPES, isNonRetryableError } from './errors';
import { llmJobPayloadSchema, probeJobPayloadSchema } from './job-payloads';
import {
  WEBHOOK_ASYNC_CALL_TTL_SECONDS,
  remainingWebhookAsyncCallTtlSeconds,
  webhookAsyncCallKey,
  webhookAsyncCallReceiptSchema,
} from './webhook-async-call';

describe('orchestration-shared contracts', () => {
  it('exposes the llm and probe queues', () => {
    expect(BULLMQ_QUEUES).toContain('llm');
    expect(BULLMQ_QUEUES).toContain('probe');
  });

  it('exposes the experiment and optimization DBOS workflow names', () => {
    expect(DBOS_WORKFLOW_NAMES).toEqual(['ExperimentWorkflow', 'OptimizationWorkflow']);
  });

  it('keeps validation errors non-retryable for handlers', () => {
    expect(NON_RETRYABLE_ERROR_TYPES).toContain('ValidationError');

    const validationError = new Error('bad input');
    validationError.name = 'ValidationError';
    expect(isNonRetryableError(validationError)).toBe(true);

    expect(isNonRetryableError(new Error('transient'))).toBe(false);
  });

  it('parses a minimal valid LLM job payload', () => {
    const result = llmJobPayloadSchema.safeParse({
      projectId: 'a1b2c3d4-e5f6-4789-a012-345678901111',
      source: 'experiment',
      sourceId: 'a1b2c3d4-e5f6-4789-a012-345678902222',
      promptVersionId: 'a1b2c3d4-e5f6-4789-a012-345678903333',
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
      renderedPrompt: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts the fixed self-hosted local project id in LLM payloads', () => {
    const result = llmJobPayloadSchema.safeParse({
      projectId: LOCAL_PROJECT_ID,
      source: 'experiment',
      sourceId: 'a1b2c3d4-e5f6-4789-a012-345678902222',
      promptVersionId: 'a1b2c3d4-e5f6-4789-a012-345678903333',
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
      renderedPrompt: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an LLM payload missing required fields', () => {
    const result = llmJobPayloadSchema.safeParse({
      projectId: 'a1b2c3d4-e5f6-4789-a012-345678901111',
      source: 'experiment',
      renderedPrompt: { prompt: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('parses a minimal valid probe job payload', () => {
    const result = probeJobPayloadSchema.safeParse({
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a probe payload with an invalid model id', () => {
    expect(probeJobPayloadSchema.safeParse({ modelId: 'not-a-uuid' }).success).toBe(false);
  });

  it('parses an optional webhookTokenId on LLM jobs and rejects a non-uuid', () => {
    const base = {
      projectId: 'a1b2c3d4-e5f6-4789-a012-345678901111',
      source: 'release' as const,
      sourceId: 'a1b2c3d4-e5f6-4789-a012-345678902222',
      promptVersionId: 'a1b2c3d4-e5f6-4789-a012-345678903333',
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
      renderedPrompt: { prompt: 'hello' },
    };
    const withToken = llmJobPayloadSchema.safeParse({
      ...base,
      webhookTokenId: 'a1b2c3d4-e5f6-4789-a012-345678907777',
    });
    expect(withToken.success).toBe(true);
    if (withToken.success) {
      expect(withToken.data.webhookTokenId).toBe('a1b2c3d4-e5f6-4789-a012-345678907777');
    }
    expect(llmJobPayloadSchema.safeParse({ ...base, webhookTokenId: 'nope' }).success).toBe(false);
  });

  it('keeps an optional UUID orgId on LLM jobs, parses fine without it, and rejects a non-UUID (override-only attribution)', () => {
    const base = {
      projectId: 'a1b2c3d4-e5f6-4789-a012-345678901111',
      source: 'experiment' as const,
      sourceId: 'a1b2c3d4-e5f6-4789-a012-345678902222',
      promptVersionId: 'a1b2c3d4-e5f6-4789-a012-345678903333',
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
      renderedPrompt: { prompt: 'hello' },
    };
    const orgId = 'a1b2c3d4-e5f6-4789-a012-3456789055aa';
    const withOrg = llmJobPayloadSchema.safeParse({ ...base, orgId });
    expect(withOrg.success).toBe(true);
    if (withOrg.success) {
      expect(withOrg.data.orgId).toBe(orgId);
    }
    const withoutOrg = llmJobPayloadSchema.safeParse(base);
    expect(withoutOrg.success).toBe(true);
    if (withoutOrg.success) {
      expect(withoutOrg.data.orgId).toBeUndefined();
    }
    expect(llmJobPayloadSchema.safeParse({ ...base, orgId: 'not-a-uuid' }).success).toBe(false);
  });

  it('keeps an optional UUID orgId on probe jobs, parses fine without it, and rejects a non-UUID (override-only attribution)', () => {
    const base = { modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444' };
    const orgId = 'a1b2c3d4-e5f6-4789-a012-3456789055aa';
    const withOrg = probeJobPayloadSchema.safeParse({ ...base, orgId });
    expect(withOrg.success).toBe(true);
    if (withOrg.success) {
      expect(withOrg.data.orgId).toBe(orgId);
    }
    const withoutOrg = probeJobPayloadSchema.safeParse(base);
    expect(withoutOrg.success).toBe(true);
    if (withoutOrg.success) {
      expect(withoutOrg.data.orgId).toBeUndefined();
    }
    expect(probeJobPayloadSchema.safeParse({ ...base, orgId: 'not-a-uuid' }).success).toBe(false);
  });

  it('parses webhook async call context on LLM jobs', () => {
    const call = {
      callId: 'a1b2c3d4-e5f6-4789-a012-345678905555',
      runResultId: 'a1b2c3d4-e5f6-4789-a012-345678905555',
      projectId: 'a1b2c3d4-e5f6-4789-a012-345678901111',
      connectorId: 'a1b2c3d4-e5f6-4789-a012-345678906666',
      releaseLineEventId: 'a1b2c3d4-e5f6-4789-a012-345678902222',
      externalId: 'sample-1',
      acceptedAt: '2026-05-21T00:00:00.000Z',
      expiresAt: '2026-05-21T00:30:00.000Z',
    };
    const result = llmJobPayloadSchema.safeParse({
      projectId: call.projectId,
      source: 'release',
      sourceId: call.releaseLineEventId,
      promptVersionId: 'a1b2c3d4-e5f6-4789-a012-345678903333',
      modelId: 'a1b2c3d4-e5f6-4789-a012-345678904444',
      runResultId: call.runResultId,
      renderedPrompt: { prompt: 'hello' },
      webhookAsyncCall: call,
    });
    expect(result.success).toBe(true);
    expect(webhookAsyncCallKey(call.callId)).toBe('ph:webhook:call:a1b2c3d4-e5f6-4789-a012-345678905555');
    expect(WEBHOOK_ASYNC_CALL_TTL_SECONDS).toBe(1800);
  });

  it('parses webhook async receipts and computes remaining TTL', () => {
    const result = webhookAsyncCallReceiptSchema.safeParse({
      status: 'pending',
      callId: 'a1b2c3d4-e5f6-4789-a012-345678905555',
      runResultId: 'a1b2c3d4-e5f6-4789-a012-345678905555',
      projectId: 'a1b2c3d4-e5f6-4789-a012-345678901111',
      connectorId: 'a1b2c3d4-e5f6-4789-a012-345678906666',
      releaseLineEventId: 'a1b2c3d4-e5f6-4789-a012-345678902222',
      externalId: null,
      acceptedAt: '2026-05-21T00:00:00.000Z',
      expiresAt: '2026-05-21T00:30:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    expect(
      remainingWebhookAsyncCallTtlSeconds('2026-05-21T00:30:00.000Z', Date.parse('2026-05-21T00:00:01.000Z')),
    ).toBe(1799);
  });
});
