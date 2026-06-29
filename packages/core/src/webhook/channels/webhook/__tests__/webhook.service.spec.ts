import { createHash } from 'node:crypto';
import {
  WEBHOOK_ASYNC_CALL_TTL_SECONDS,
  webhookAsyncCallKey,
  type WebhookAsyncCallReceipt,
} from '@proofhound/orchestration-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConnectorContextResolver,
  ConnectorResolveResult,
} from '../../../../server/common/contracts/connector-context.resolver';
import { LocalWorkflowAuthorizationHook } from '../../../../server/common/contracts/workflow-authorization.hook';
import type { BullmqService } from '../../../infrastructure/orchestration/bullmq.service';
import { LocalConnectorContextResolver } from '../local-connector-context.resolver';
import type { WebhookRepository, WebhookRunResultRow } from '../webhook.repository';
import { WebhookService } from '../webhook.service';

const TOKEN = 'ph_api_test_token';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const projectId = '11111111-1111-4111-8111-111111111111';
const connectorId = '22222222-2222-4222-8222-222222222222';
const tokenId = '33333333-3333-4333-8333-333333333333';
const releaseLineId = '44444444-4444-4444-8444-444444444440';
const releaseLineEventId = '44444444-4444-4444-8444-444444444444';
const promptVersionId = '55555555-5555-4555-8555-555555555555';
const promptId = '66666666-6666-4666-8666-666666666666';
const modelId = '77777777-7777-4777-8777-777777777777';
// Override-only org attribution; OSS resolver never sets it (see ProjectContext.orgId).
const orgId = '99999999-9999-4999-8999-999999999999';

const connector = {
  id: connectorId,
  projectId,
  name: 'sync-webhook-in',
  config: { webhookMode: 'sync', timeoutSeconds: 1 },
  webhookPath: 'a3a1b2c3-d4e5-4f60-8788-aabbccddeeff',
  ipWhitelist: null,
};

const tokenResult = {
  connector,
  tokenId,
  tokenExpiresAt: null,
};

const releaseEvent = {
  id: releaseLineEventId,
  releaseLineId,
  projectId,
  laneType: 'canary' as const,
  promptName: 'risk-canary',
  promptVersionId,
  promptId,
  modelId,
  inputConnectorId: connectorId,
  trafficRatio: 1,
  trafficMode: 'split' as const,
  variableMapping: [
    { source: 'id', target: 'id', required: true },
    { source: 'text', target: 'text', required: true },
  ],
  filterRules: null,
  externalIdField: 'id',
  runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 2 },
  promptBody: 'Classify {{text}}',
  promptVariables: [{ name: 'text', type: 'text', required: true }],
  promptOutputSchema: { fields: [] },
  promptJudgmentRules: null,
  promptLanguage: 'en-US',
};

const releaseLine = {
  id: releaseLineId,
  projectId,
  production: null,
  canary: releaseEvent,
};

const runResult: WebhookRunResultRow = {
  id: '88888888-8888-4888-8888-888888888888',
  createdAt: new Date('2026-05-21T00:00:00.000Z'),
  status: 'success',
  externalId: 'sample-1',
  renderedPrompt: { prompt: 'Classify hello' },
  inputVariables: { text: 'hello' },
  rawResponse: '{"label":"positive"}',
  parsedOutput: { label: 'positive' },
  decisionOutput: 'positive',
  expectedOutput: null,
  isCorrect: null,
  judgmentStatus: null,
  errorClass: null,
  errorMessage: null,
  latencyMs: 42,
  inputTokens: 10,
  outputTokens: 4,
  costEstimate: '0.000001',
};

function makeRepo() {
  return {
    findConnectorWithValidToken: vi.fn().mockResolvedValue(tokenResult),
    touchTokenLastUsed: vi.fn().mockResolvedValue(undefined),
    findActiveReleaseForConnector: vi.fn().mockResolvedValue(releaseLine),
    incrementReceived: vi.fn().mockResolvedValue(undefined),
    incrementFiltered: vi.fn().mockResolvedValue(undefined),
    findRunResult: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(runResult),
    attachResultToRelease: vi.fn().mockResolvedValue(true),
  };
}

function makeRedis() {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(WEBHOOK_ASYNC_CALL_TTL_SECONDS),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe('WebhookService', () => {
  let bullmq: Pick<BullmqService, 'enqueueLlmJob'>;
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(() => {
    bullmq = { enqueueLlmJob: vi.fn().mockResolvedValue('job-1') };
    redis = makeRedis();
  });

  function makeService(
    repo: ReturnType<typeof makeRepo>,
    workflowAuth = new LocalWorkflowAuthorizationHook(),
    // Default resolver delegates to the same repo, so the existing repo-call assertions
    // (findConnectorWithValidToken / touchTokenLastUsed / invalid|expired_webhook_token) still hold.
    // Tests that need an override-style org-scoped projectContext pass an override resolver.
    resolver: ConnectorContextResolver = new LocalConnectorContextResolver(
      repo as unknown as WebhookRepository,
    ),
  ) {
    return new WebhookService(
      repo as unknown as WebhookRepository,
      bullmq as BullmqService,
      redis as never,
      resolver,
      workflowAuth,
    );
  }

  // Stub resolver that returns a projectContext carrying an org id, mirroring how a replacement implementation's
  // RemoteConnectorContextResolver would resolve the webhook's project to its owning org.
  function makeOrgResolver(resolvedOrgId: string | undefined): ConnectorContextResolver {
    const result: ConnectorResolveResult = {
      connector,
      projectContext: { projectId, source: 'local', orgId: resolvedOrgId },
      actorContext: { actorId: connector.id, actorKind: 'system_webhook' },
      webhookTokenId: tokenId,
    };
    return {
      resolveFromWebhookToken: vi.fn().mockResolvedValue(result),
    } as unknown as ConnectorContextResolver;
  }

  it('authenticates a public webhook path and enqueues a release LLM job', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const response = await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(repo.findConnectorWithValidToken).toHaveBeenCalledWith('wh-a3a1b2c3', '', TOKEN_HASH);
    expect(repo.touchTokenLastUsed).toHaveBeenCalledWith(tokenId);
    expect(repo.incrementReceived).toHaveBeenCalledWith(releaseLineEventId);
    expect(bullmq.enqueueLlmJob).toHaveBeenCalledTimes(1);
    const [payload, jobId] = vi.mocked(bullmq.enqueueLlmJob).mock.calls[0]!;
    expect(jobId).toEqual(payload.runResultId);
    expect(payload.runResultId).toEqual(expect.any(String));
    expect(payload).toMatchObject({
      projectId,
      source: 'release',
      sourceId: releaseLineEventId,
      promptVersionId,
      promptId,
      modelId,
      externalId: 'sample-1',
      inputVariables: { text: 'hello' },
      limits: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 2 },
      webhookTokenId: tokenId,
    });
    expect(payload.judgment).toBeUndefined();
    expect(response).toMatchObject({
      status: 'success',
      external_id: 'sample-1',
      result: { label: 'positive' },
      raw_response: '{"label":"positive"}',
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('threads the resolved project context org id onto the release LLM job payload', async () => {
    const repo = makeRepo();
    const service = makeService(repo, new LocalWorkflowAuthorizationHook(), makeOrgResolver(orgId));

    await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(bullmq.enqueueLlmJob).toHaveBeenCalledTimes(1);
    const [payload] = vi.mocked(bullmq.enqueueLlmJob).mock.calls[0]!;
    expect(payload.orgId).toBe(orgId);
  });

  it('leaves the release payload org id undefined for the OSS default (no org)', async () => {
    const repo = makeRepo();
    // Real LocalConnectorContextResolver → projectContext has no orgId, so the payload carries none.
    const service = makeService(repo);

    await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(bullmq.enqueueLlmJob).toHaveBeenCalledTimes(1);
    const [payload] = vi.mocked(bullmq.enqueueLlmJob).mock.calls[0]!;
    expect(payload.orgId).toBeUndefined();
  });

  it('rejects an unknown slug / path / token combo with invalid_webhook_token', async () => {
    const repo = makeRepo();
    repo.findConnectorWithValidToken.mockResolvedValue(null);
    const service = makeService(repo);

    await expect(
      service.receive({
        webhookSlug: 'wh-a3a1b2c3',
        pathName: '',
        body: { id: 'sample-1', text: 'hello' },
        authorization: `Bearer ${TOKEN}`,
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ message: 'invalid_webhook_token' });
  });

  it('rejects an expired webhook token with expired_webhook_token', async () => {
    const repo = makeRepo();
    repo.findConnectorWithValidToken.mockResolvedValue({
      ...tokenResult,
      tokenExpiresAt: new Date(Date.now() - 1000),
    });
    const service = makeService(repo);

    await expect(
      service.receive({
        webhookSlug: 'wh-a3a1b2c3',
        pathName: '',
        body: { id: 'sample-1', text: 'hello' },
        authorization: `Bearer ${TOKEN}`,
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ message: 'expired_webhook_token' });
  });

  it('gates enqueue with WorkflowAuthorizationHook (throws => no job enqueued)', async () => {
    const repo = makeRepo();
    const denying = {
      assertCanStart: vi.fn().mockRejectedValue(new Error('workflow_forbidden')),
    } as unknown as LocalWorkflowAuthorizationHook;
    const service = makeService(repo, denying);

    await expect(
      service.receive({
        webhookSlug: 'wh-a3a1b2c3',
        pathName: '',
        body: { id: 'sample-1', text: 'hello' },
        authorization: `Bearer ${TOKEN}`,
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ message: 'workflow_forbidden' });
    expect(denying.assertCanStart).toHaveBeenCalledWith(
      { actorId: connectorId, actorKind: 'system_webhook' },
      { projectId, source: 'local' },
      'llm',
    );
    expect(bullmq.enqueueLlmJob).not.toHaveBeenCalled();
  });

  it('only enables automatic judgment when webhook payload carries expected output', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello', expected_output: 'positive' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    const [payload] = vi.mocked(bullmq.enqueueLlmJob).mock.calls[0]!;
    expect(payload.judgment).toMatchObject({
      outputSchema: releaseEvent.promptOutputSchema,
      judgmentRules: releaseEvent.promptJudgmentRules,
      expectedOutput: 'positive',
    });
  });

  it('returns the model output when inference succeeded but the optional judge step errored', async () => {
    const repo = makeRepo();
    // Successful inference (status='success') whose optional judge step errored: expected output was
    // provided but judgment failed. The sync caller must still receive the model output (success branch),
    // not the stripped error branch.
    const judgeErrored: WebhookRunResultRow = {
      ...runResult,
      status: 'success',
      judgmentStatus: 'judge_error',
      expectedOutput: 'positive',
      isCorrect: null,
      errorClass: null,
      errorMessage: null,
    };
    repo.findRunResult.mockReset();
    repo.findRunResult.mockResolvedValueOnce(null).mockResolvedValueOnce(judgeErrored);
    const service = makeService(repo);

    const response = await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello', expected_output: 'positive' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(response).toMatchObject({
      status: 'success',
      external_id: 'sample-1',
      result: { label: 'positive' },
      raw_response: '{"label":"positive"}',
      parsed_output: { label: 'positive' },
      decision_output: 'positive',
      judgment_status: 'judge_error',
    });
  });

  it('does not dedupe repeated webhook calls by external id', async () => {
    const repo = makeRepo();
    repo.findConnectorWithValidToken.mockResolvedValue({
      ...tokenResult,
      connector: { ...connector, config: { webhookMode: 'async' } },
    });
    const service = makeService(repo);

    const first = await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: null,
      userAgent: null,
    });
    const second = await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello again' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: null,
      userAgent: null,
    });

    expect(bullmq.enqueueLlmJob).toHaveBeenCalledTimes(2);
    const [firstPayload, firstJobId] = vi.mocked(bullmq.enqueueLlmJob).mock.calls[0]!;
    const [secondPayload, secondJobId] = vi.mocked(bullmq.enqueueLlmJob).mock.calls[1]!;
    expect(firstPayload.externalId).toBe('sample-1');
    expect(secondPayload.externalId).toBe('sample-1');
    expect(firstPayload.runResultId).toEqual(firstJobId);
    expect(secondPayload.runResultId).toEqual(secondJobId);
    expect(firstPayload.webhookAsyncCall).toMatchObject({
      callId: firstPayload.runResultId,
      runResultId: firstPayload.runResultId,
      projectId,
      connectorId,
      releaseLineEventId,
      externalId: 'sample-1',
    });
    expect(secondPayload.webhookAsyncCall).toMatchObject({
      callId: secondPayload.runResultId,
      runResultId: secondPayload.runResultId,
      projectId,
      connectorId,
      releaseLineEventId,
      externalId: 'sample-1',
    });
    expect(firstPayload.runResultId).not.toEqual(secondPayload.runResultId);
    expect(first).toMatchObject({
      status: 'accepted',
      call_id: firstPayload.runResultId,
      external_id: 'sample-1',
      expires_in_seconds: WEBHOOK_ASYNC_CALL_TTL_SECONDS,
    });
    expect(second).toMatchObject({
      status: 'accepted',
      call_id: secondPayload.runResultId,
      external_id: 'sample-1',
      expires_in_seconds: WEBHOOK_ASYNC_CALL_TTL_SECONDS,
    });
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith(
      webhookAsyncCallKey(firstPayload.runResultId!),
      expect.stringContaining('"status":"pending"'),
      'EX',
      WEBHOOK_ASYNC_CALL_TTL_SECONDS,
    );
    expect(repo.findRunResult).not.toHaveBeenCalled();
  });

  it('uses externalIdField as the canonical external id source', async () => {
    const repo = makeRepo();
    repo.findConnectorWithValidToken.mockResolvedValue({
      ...tokenResult,
      connector: { ...connector, config: { webhookMode: 'async' } },
    });
    repo.findActiveReleaseForConnector.mockResolvedValue({
      ...releaseLine,
      canary: {
        ...releaseEvent,
        externalIdField: 'sample_id',
        variableMapping: [
          { source: 'text', target: 'id', required: true },
          { source: 'text', target: 'text', required: true },
        ],
      },
    });
    const service = makeService(repo);

    const response = await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { sample_id: 'sample-1', text: 'hello' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: null,
      userAgent: null,
    });

    const [payload] = vi.mocked(bullmq.enqueueLlmJob).mock.calls[0]!;
    expect(payload.externalId).toBe('sample-1');
    expect(payload.inputVariables).toEqual({ text: 'hello' });
    expect(response).toMatchObject({ status: 'accepted', external_id: 'sample-1' });
  });

  it('returns cached async query results even when run_results is absent', async () => {
    const repo = makeRepo();
    repo.findRunResult.mockReset();
    repo.findRunResult.mockResolvedValue(null);
    const now = new Date('2026-05-21T00:00:00.000Z');
    const receipt: WebhookAsyncCallReceipt = {
      status: 'success',
      callId: runResult.id,
      runResultId: runResult.id,
      projectId,
      connectorId,
      releaseLineEventId,
      externalId: 'sample-1',
      acceptedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + WEBHOOK_ASYNC_CALL_TTL_SECONDS * 1000).toISOString(),
      updatedAt: now.toISOString(),
      completedAt: now.toISOString(),
      result: { label: 'positive' },
      rawResponse: '{"label":"positive"}',
      parsedOutput: { label: 'positive' },
      decisionOutput: 'positive',
      judgmentStatus: null,
      latencyMs: 42,
      inputTokens: 10,
      outputTokens: 4,
      costEstimate: 0.000001,
    };
    redis.get.mockResolvedValue(JSON.stringify(receipt));
    redis.ttl.mockResolvedValue(1700);
    const service = makeService(repo);

    const response = await service.getCallResult({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      callId: runResult.id,
      authorization: `Bearer ${TOKEN}`,
      ipAddress: null,
      userAgent: null,
    });

    expect(response).toMatchObject({
      status: 'success',
      call_id: runResult.id,
      external_id: 'sample-1',
      result: { label: 'positive' },
      expires_in_seconds: 1700,
    });
    expect(repo.findRunResult).not.toHaveBeenCalled();
  });

  it('returns expired when the async receipt has aged out', async () => {
    const repo = makeRepo();
    redis.get.mockResolvedValue(null);
    const service = makeService(repo);

    const response = await service.getCallResult({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      callId: runResult.id,
      authorization: `Bearer ${TOKEN}`,
      ipAddress: null,
      userAgent: null,
    });

    expect(response).toEqual({
      status: 'expired',
      call_id: runResult.id,
      expires_in_seconds: 0,
    });
    expect(repo.findRunResult).not.toHaveBeenCalled();
  });

  it('returns filtered without enqueueing when filter rules do not match', async () => {
    const repo = makeRepo();
    repo.findActiveReleaseForConnector.mockResolvedValue({
      ...releaseLine,
      canary: {
        ...releaseEvent,
        filterRules: { type: 'atom', field: 'kind', op: 'eq', value: 'eligible' },
      },
    });
    const service = makeService(repo);

    const response = await service.receive({
      webhookSlug: 'wh-a3a1b2c3',
      pathName: '',
      body: { id: 'sample-1', text: 'hello', kind: 'ignored' },
      authorization: `Bearer ${TOKEN}`,
      ipAddress: null,
      userAgent: null,
    });

    expect(response).toEqual({ status: 'filtered', filtered: true });
    expect(repo.incrementFiltered).toHaveBeenCalledWith(releaseLineEventId);
    expect(bullmq.enqueueLlmJob).not.toHaveBeenCalled();
  });
});
