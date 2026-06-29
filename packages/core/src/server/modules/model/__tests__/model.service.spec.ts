import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { RateLimiter, UsageSnapshot } from '@proofhound/limiter';
import { CryptoService } from '../../../../shared/crypto/crypto.service';
import { REDIS_LIMITER } from '../../../../shared/redis/redis.constants';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import {
  ModelRepository,
  type ModelContextWindowRow,
  type ModelRow,
  type ModelRowWithCreator,
} from '../model.repository';
import { ModelService } from '../model.service';
import { AccessControlService } from '../../../common/contracts/access-control.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { LimiterKeyStrategy } from '../../../common/contracts/limiter-key.strategy';
import { LocalQuotaPolicyHook, QuotaPolicyHook } from '../../../common/contracts/quota-policy.hook';
import { RuntimeLimitsProvider } from '../../../common/contracts/runtime-limits.provider';
import { UsageMeteringHook } from '../../../common/contracts/usage-metering.hook';
import { WorkflowAuthorizationHook } from '../../../common/contracts/workflow-authorization.hook';

vi.mock('@proofhound/llm-client', () => ({
  __esModule: true,
  testModelConnectivity: vi.fn(),
  openAIAdapter: { providerType: 'openai', invoke: vi.fn() },
  anthropicAdapter: { providerType: 'anthropic', invoke: vi.fn() },
  azureOpenAIAdapter: { providerType: 'azure-openai', invoke: vi.fn() },
}));

import { testModelConnectivity } from '@proofhound/llm-client';
import { vi, type Mocked, type Mock } from 'vitest';

const ACTOR: CurrentUserPayload = {
  sub: '00000000-0000-4000-8000-000000000010',
  email: 'local@example.test',
  isSuperAdmin: false,
  isActive: true,
};
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

function fakeContextWindow(overrides: Partial<ModelContextWindowRow> = {}): ModelContextWindowRow {
  return {
    providerModelId: 'gpt-4o-2024-08-06',
    contextWindowTokens: 128000,
    updatedBy: '11111111-1111-4111-8111-111111111111',
    updatedAt: new Date('2026-05-16T08:00:00Z'),
    ...overrides,
  };
}

function fakeRow(overrides: Partial<ModelRowWithCreator> = {}): ModelRowWithCreator {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    projectId: WORKSPACE_ID,
    name: 'GPT-4o',
    providerType: 'openai',
    providerModelId: 'gpt-4o',
    endpoint: 'https://api.openai.com/v1',
    apiKeyEncrypted: 'enc:sk-test-1234',
    contextWindowTokens: 128000,
    rpmLimit: 60,
    tpmLimit: 100000,
    concurrencyLimit: 10,
    autoConcurrency: true,
    inputTokenPricePerMillion: '2.5',
    outputTokenPricePerMillion: '10.0',
    capabilities: { image: 'url' },
    extraBody: {},
    isActive: true,
    lastProbedAt: null,
    lastProbeError: null,
    createdBy: ACTOR.sub,
    createdByDisplayName: null,
    createdAt: new Date('2026-05-15T00:00:00Z'),
    updatedAt: new Date('2026-05-15T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeRepo(): Mocked<ModelRepository> {
  return {
    listProjectModels: vi.fn(),
    listQuickStartGlobalModels: vi.fn(),
    findModelById: vi.fn(),
    findModelAccessibleToProject: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    updateProbeOutcome: vi.fn(),
    softDeleteModel: vi.fn(),
    getActiveReferenceCounts: vi.fn(),
    getTotalReferenceCounts: vi.fn(),
    findProjectAccess: vi.fn(),
    findContextWindows: vi.fn(),
    findContextWindowByProviderModelId: vi.fn(),
    upsertContextWindow: vi.fn(),
  } as unknown as Mocked<ModelRepository>;
}

function makeCrypto(): Mocked<CryptoService> {
  return {
    encryptApiKey: vi.fn((plain: string) => `enc:${plain}`),
    decryptApiKey: vi.fn((payload: string) => payload.replace(/^enc:/, '')),
    getCredentialTail: vi.fn((plain: string) => plain.slice(-4)),
  } as unknown as Mocked<CryptoService>;
}

function makeLimiter(snapshot: Partial<UsageSnapshot> = {}): Mocked<RateLimiter> {
  return {
    acquire: vi.fn(),
    release: vi.fn(),
    getUsage: vi.fn().mockResolvedValue({
      modelId: 'm',
      rpmUsed: 30,
      tpmUsed: 50000,
      concurrencyInUse: 5,
      windowMs: 60000,
      windowEndsAt: '2026-05-18T00:00:00Z',
      ...snapshot,
    }),
  } as unknown as Mocked<RateLimiter>;
}

function draftProbeDto() {
  return {
    name: 'Local',
    providerType: 'openai',
    providerModelId: 'gpt-4o',
    endpoint: 'https://api.openai.com/v1',
    apiKey: 'sk-draft',
    contextWindowTokens: 128000,
    rpm: { limit: 60 },
    tpm: { limit: 1000 },
    concurrency: { limit: 1 },
    autoConcurrency: true,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    capabilities: { image: 'none' as const },
    extraBody: {},
  };
}

describe('ModelService', () => {
  let service: ModelService;
  let repo: Mocked<ModelRepository>;
  let crypto: Mocked<CryptoService>;
  let limiter: Mocked<RateLimiter>;
  let limiterKeyStrategy: { buildModelKey: Mock };
  let runtimeLimitsProvider: { mergeLlmLimits: Mock };
  let workflowAuth: { assertCanStart: Mock };
  let usageMetering: UsageMeteringHook & { record: Mock };

  beforeEach(async () => {
    (testModelConnectivity as Mock).mockReset();
    repo = makeRepo();
    crypto = makeCrypto();
    limiter = makeLimiter();
    limiterKeyStrategy = {
      // A replacement-shaped key strategy: derive the org-scoped bucket from the project (SPEC 08 §3.7) when an
      // orgId is carried, otherwise fall back to the project key. Lets tests prove the project's orgId
      // reaches buildModelKey. OSS LocalLimiterKeyStrategy ignores the project and returns `model:<id>`.
      buildModelKey: vi.fn((project: { projectId: string; orgId?: string }, modelId: string) =>
        project.orgId ? `org:${project.orgId}:model:${modelId}` : `project:${project.projectId}:model:${modelId}`,
      ),
    };
    runtimeLimitsProvider = { mergeLlmLimits: vi.fn().mockImplementation(async (input) => input.limits) };
    workflowAuth = { assertCanStart: vi.fn().mockResolvedValue(undefined) };
    usageMetering = { record: vi.fn(async () => undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: ModelRepository, useValue: repo },
        { provide: CryptoService, useValue: crypto },
        { provide: REDIS_LIMITER, useValue: limiter },
        { provide: AccessControlService, useClass: LocalAccessControlService },
        { provide: LimiterKeyStrategy, useValue: limiterKeyStrategy },
        { provide: RuntimeLimitsProvider, useValue: runtimeLimitsProvider },
        { provide: WorkflowAuthorizationHook, useValue: workflowAuth },
        { provide: QuotaPolicyHook, useClass: LocalQuotaPolicyHook },
        { provide: UsageMeteringHook, useValue: usageMetering },
        ModelService,
      ],
    }).compile();
    service = module.get<ModelService>(ModelService);

    repo.findProjectAccess.mockResolvedValue({ id: WORKSPACE_ID });
    repo.getActiveReferenceCounts.mockResolvedValue({
      experiments: 0,
      optimizations: 0,
      canaryReleases: 0,
      productionReleases: 0,
    });
    repo.getTotalReferenceCounts.mockResolvedValue({
      experiments: 0,
      optimizations: 0,
      canaryReleases: 0,
      productionReleases: 0,
    });
  });

  it('lists local models with quota usage and credential tail', async () => {
    repo.listProjectModels.mockResolvedValue([
      fakeRow({ isActive: true, lastProbedAt: new Date('2026-05-17T12:00:00Z'), lastProbeError: null }),
    ]);

    const { data } = await service.listProjectModels(WORKSPACE_ID, ACTOR);

    expect(data[0]).toEqual(
      expect.objectContaining({
        status: 'enabled',
        probeStatus: 'success',
        credentialTail: '1234',
        rpm: expect.objectContaining({ limit: 60, current: 30, usage: 50 }),
        concurrency: expect.objectContaining({ limit: 10, current: 5, usage: 50 }),
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        capabilities: { image: 'url' },
      }),
    );
  });

  it('does not block list when limiter usage is unavailable', async () => {
    vi.useFakeTimers();
    try {
      (limiter.getUsage as Mock).mockImplementation(() => new Promise<UsageSnapshot>(() => undefined));
      repo.listProjectModels.mockResolvedValue([fakeRow(), fakeRow({ id: '00000000-0000-4000-8000-000000000102' })]);

      const result = service.listProjectModels(WORKSPACE_ID, ACTOR);
      await vi.advanceTimersByTimeAsync(1_000);

      const { data } = await result;
      expect(data).toHaveLength(2);
      expect(data[0]?.rpm.current).toBe(0);
      expect(data[0]?.tpm.current).toBe(0);
      expect(data[0]?.concurrency.current).toBe(0);
      expect(limiter.getUsage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a local model and encrypts the API key', async () => {
    repo.createModel.mockResolvedValue(fakeRow({ id: '00000000-0000-4000-8000-000000000103' }) as ModelRow);
    repo.findModelAccessibleToProject.mockResolvedValue(fakeRow({ id: '00000000-0000-4000-8000-000000000103' }));

    await service.createProjectModel(
      WORKSPACE_ID,
      {
        name: 'GPT',
        providerType: 'openai',
        providerModelId: 'gpt-4o',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'sk-secret-9999',
        rpm: { limit: 60 },
        tpm: { limit: 100000 },
        concurrency: { limit: 10 },
        autoConcurrency: true,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        capabilities: { image: 'url' },
        extraBody: {},
      },
      ACTOR,
    );

    expect(crypto.encryptApiKey).toHaveBeenCalledWith('sk-secret-9999');
    expect(repo.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyEncrypted: 'enc:sk-secret-9999', extraBody: {} }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'model',
        eventType: 'model.created',
        projectId: WORKSPACE_ID,
      }),
    );
  });

  it('maps create model name unique violations to model_name_taken', async () => {
    repo.createModel.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "idx_models_project_name_active"'), {
        code: '23505',
        constraint: 'idx_models_project_name_active',
      }),
    );

    await expect(
      service.createProjectModel(
        WORKSPACE_ID,
        {
          name: 'GPT',
          providerType: 'openai',
          providerModelId: 'gpt-4o',
          endpoint: 'https://api.openai.com/v1',
          apiKey: 'sk-secret-9999',
          rpm: { limit: 60 },
          tpm: { limit: 100000 },
          concurrency: { limit: 10 },
          autoConcurrency: true,
          pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
          capabilities: { image: 'url' },
          extraBody: {},
        },
        ACTOR,
      ),
    ).rejects.toThrow(new ConflictException('model_name_taken'));
  });

  it('creates a disabled model when saving as draft', async () => {
    repo.createModel.mockResolvedValue(
      fakeRow({ id: '00000000-0000-4000-8000-000000000106', isActive: false }) as ModelRow,
    );
    repo.findModelAccessibleToProject.mockResolvedValue(
      fakeRow({ id: '00000000-0000-4000-8000-000000000106', isActive: false }),
    );

    const result = await service.createProjectModel(
      WORKSPACE_ID,
      {
        name: 'Draft GPT',
        providerType: 'openai',
        providerModelId: 'gpt-4o',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'sk-secret-9999',
        rpm: { limit: 60 },
        tpm: { limit: 100000 },
        concurrency: { limit: 10 },
        autoConcurrency: true,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        capabilities: { image: 'url' },
        extraBody: {},
        status: 'disabled',
      },
      ACTOR,
    );

    expect(repo.createModel).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    expect(result.status).toBe('disabled');
  });

  it('records an initial draft probe outcome when creating a model', async () => {
    repo.createModel.mockResolvedValue(
      fakeRow({
        id: '00000000-0000-4000-8000-000000000107',
        lastProbedAt: new Date('2026-05-18T01:00:00.000Z'),
        lastProbeError: 'invalid_api_key',
      }) as ModelRow,
    );
    repo.findModelAccessibleToProject.mockResolvedValue(
      fakeRow({
        id: '00000000-0000-4000-8000-000000000107',
        lastProbedAt: new Date('2026-05-18T01:00:00.000Z'),
        lastProbeError: 'invalid_api_key',
      }),
    );

    const result = await service.createProjectModel(
      WORKSPACE_ID,
      {
        name: 'Probed GPT',
        providerType: 'openai',
        providerModelId: 'gpt-4o',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'sk-secret-9999',
        rpm: { limit: 60 },
        tpm: { limit: 100000 },
        concurrency: { limit: 10 },
        autoConcurrency: true,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        capabilities: { image: 'url' },
        extraBody: {},
        initialProbe: {
          status: 'failed',
          probedAt: '2026-05-18T01:00:00.000Z',
          error: 'invalid_api_key',
        },
      },
      ACTOR,
    );

    expect(repo.createModel).toHaveBeenCalledWith(
      expect.objectContaining({
        lastProbedAt: new Date('2026-05-18T01:00:00.000Z'),
        lastProbeError: 'invalid_api_key',
      }),
    );
    expect(result.probeStatus).toBe('failed');
    expect(result.lastProbeError).toBe('invalid_api_key');
  });

  it('probes a draft model without creating or recording it', async () => {
    (testModelConnectivity as Mock).mockResolvedValue({
      ok: false,
      modelId: 'draft',
      providerType: 'openai',
      providerModelId: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      durationMs: 900,
      checkedAt: '2026-05-18T01:00:00.000Z',
      errorMessage: 'invalid_api_key',
      errorClass: 'auth',
    });

    const result = await service.probeDraftProjectModel(WORKSPACE_ID, draftProbeDto(), ACTOR);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('invalid_api_key');
    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR.sub, actorKind: 'local_user' }),
      { projectId: WORKSPACE_ID, source: 'local' },
      'probe',
    );
    expect(testModelConnectivity).toHaveBeenCalledWith(
      expect.objectContaining({
        limiterKey: expect.stringContaining(`project:${WORKSPACE_ID}:model:`),
      }),
      expect.anything(),
    );
    expect(repo.createModel).not.toHaveBeenCalled();
    expect(repo.updateProbeOutcome).not.toHaveBeenCalled();
  });

  it('does not run a draft model probe when the workflow hook rejects', async () => {
    workflowAuth.assertCanStart.mockRejectedValueOnce(new Error('workflow_denied'));

    await expect(service.probeDraftProjectModel(WORKSPACE_ID, draftProbeDto(), ACTOR)).rejects.toThrow(
      'workflow_denied',
    );

    expect(testModelConnectivity).not.toHaveBeenCalled();
    expect(repo.createModel).not.toHaveBeenCalled();
    expect(repo.updateProbeOutcome).not.toHaveBeenCalled();
  });

  it('does not run a quick start draft probe when the workflow hook rejects', async () => {
    workflowAuth.assertCanStart.mockRejectedValueOnce(new Error('workflow_denied'));

    await expect(service.probeQuickStartDraftModel(draftProbeDto(), ACTOR)).rejects.toThrow('workflow_denied');

    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR.sub, actorKind: 'local_user' }),
      { projectId: WORKSPACE_ID, source: 'local' },
      'probe',
    );
    expect(testModelConnectivity).not.toHaveBeenCalled();
  });

  it('duplicates a model by decrypting the source key and creating a local copy', async () => {
    const source = fakeRow({ id: '00000000-0000-4000-8000-000000000104', name: 'Original' });
    repo.findModelAccessibleToProject.mockResolvedValueOnce(source);
    repo.createModel.mockResolvedValue(fakeRow({ id: '00000000-0000-4000-8000-000000000105' }) as ModelRow);
    repo.findModelAccessibleToProject.mockResolvedValueOnce(fakeRow({ id: '00000000-0000-4000-8000-000000000105' }));

    await service.duplicateProjectModel(WORKSPACE_ID, source.id, ACTOR);

    expect(crypto.decryptApiKey).toHaveBeenCalledWith('enc:sk-test-1234');
    expect(repo.createModel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Original 副本',
        apiKeyEncrypted: 'enc:sk-test-1234',
        lastProbedAt: null,
      }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'model',
        eventType: 'model.created',
        payload: expect.objectContaining({ duplicatedFromModelId: source.id }),
      }),
    );
  });

  it('maps update model name unique violations to model_name_taken', async () => {
    const row = fakeRow();
    repo.findModelById.mockResolvedValue(row);
    repo.updateModel.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "idx_models_project_name_active"'), {
        code: '23505',
        constraint: 'idx_models_project_name_active',
      }),
    );

    await expect(service.updateProjectModel(WORKSPACE_ID, row.id, { name: 'GPT' }, ACTOR)).rejects.toThrow(
      new ConflictException('model_name_taken'),
    );
  });

  it('blocks delete when the model has active references', async () => {
    repo.findModelById.mockResolvedValue(fakeRow());
    repo.getActiveReferenceCounts.mockResolvedValue({
      experiments: 2,
      optimizations: 0,
      canaryReleases: 0,
      productionReleases: 0,
    });

    await expect(service.deleteProjectModel(WORKSPACE_ID, 'model-1', { force: false }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.softDeleteModel).not.toHaveBeenCalled();
  });

  it('updates status=disabled into isActive=false', async () => {
    const row = fakeRow();
    const updated = fakeRow({
      isActive: false,
      updatedAt: new Date('2026-05-16T00:00:00Z'),
    });
    repo.findModelById.mockResolvedValue(row);
    repo.updateModel.mockResolvedValue(updated as ModelRow);
    repo.findModelAccessibleToProject.mockResolvedValue(updated);

    await service.updateProjectModel(WORKSPACE_ID, row.id, { status: 'disabled' }, ACTOR);

    expect(repo.updateModel).toHaveBeenCalledWith(row.id, expect.objectContaining({ isActive: false }));
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'model',
        eventType: 'model.activation_changed',
        payload: expect.objectContaining({ previousIsActive: true, isActive: false }),
      }),
    );
  });

  it('records model.updated and concurrency limit change events', async () => {
    const row = fakeRow({ concurrencyLimit: 10 });
    const updated = fakeRow({
      concurrencyLimit: 4,
      updatedAt: new Date('2026-05-16T00:00:00Z'),
    });
    repo.findModelById.mockResolvedValue(row);
    repo.updateModel.mockResolvedValue(updated as ModelRow);
    repo.findModelAccessibleToProject.mockResolvedValue(updated);

    await service.updateProjectModel(WORKSPACE_ID, row.id, { concurrency: { limit: 4 } }, ACTOR);

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'model',
        eventType: 'model.updated',
        payload: expect.objectContaining({ changedFields: ['concurrencyLimit'] }),
      }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'model',
        eventType: 'model.concurrency_limit_changed',
        payload: expect.objectContaining({ previousConcurrencyLimit: 10, concurrencyLimit: 4 }),
      }),
    );
  });

  it('records model.deleted when a local model is removed', async () => {
    vi.useFakeTimers();
    const row = fakeRow();
    const deletedAt = new Date('2026-05-19T08:30:00.000Z');
    vi.setSystemTime(deletedAt);
    try {
      repo.findModelById.mockResolvedValue(row);

      await service.deleteProjectModel(WORKSPACE_ID, row.id, { force: false }, ACTOR);

      expect(repo.softDeleteModel).toHaveBeenCalledWith(row.id);
      expect(usageMetering.record).toHaveBeenCalledWith(
        expect.objectContaining({
          dimension: 'model',
          eventType: 'model.deleted',
          projectId: WORKSPACE_ID,
          occurredAt: deletedAt,
          idempotencyKey: `model:${row.id}:model.deleted:${deletedAt.toISOString()}`,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('records probe outcome on existing model probe failure', async () => {
    repo.findModelAccessibleToProject.mockResolvedValue(fakeRow());
    (testModelConnectivity as Mock).mockResolvedValue({
      ok: false,
      modelId: 'model-1',
      providerType: 'openai',
      providerModelId: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      durationMs: 1200,
      checkedAt: '2026-05-18T01:00:00.000Z',
      errorMessage: 'invalid_api_key',
      errorClass: 'auth',
    });

    const result = await service.probeProjectModel(WORKSPACE_ID, 'model-1', ACTOR);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('invalid_api_key');
    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR.sub, actorKind: 'local_user' }),
      { projectId: WORKSPACE_ID, source: 'local' },
      'probe',
    );
    expect(testModelConnectivity).toHaveBeenCalledWith(
      expect.objectContaining({
        limiterKey: `project:${WORKSPACE_ID}:model:00000000-0000-4000-8000-000000000101`,
      }),
      expect.anything(),
    );
    expect(repo.updateProbeOutcome).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000101',
      new Date('2026-05-18T01:00:00.000Z'),
      'invalid_api_key',
    );
  });

  it('does not record an existing model probe when the workflow hook rejects', async () => {
    repo.findModelAccessibleToProject.mockResolvedValue(fakeRow());
    workflowAuth.assertCanStart.mockRejectedValueOnce(new Error('workflow_denied'));

    await expect(service.probeProjectModel(WORKSPACE_ID, 'model-1', ACTOR)).rejects.toThrow('workflow_denied');

    expect(testModelConnectivity).not.toHaveBeenCalled();
    expect(repo.updateProbeOutcome).not.toHaveBeenCalled();
  });

  // orgId (override-only; undefined in OSS) is the resolved project's rate-limit bucket (SPEC 08 §3.7). It is
  // sourced from the @CurrentProject ProjectContext at the controller and threaded all the way to
  // buildModelKey — on the probe WRITE path and the usage-snapshot READ path — so both hit the same key.
  it('threads the project orgId into the probe limiter key (override bucket, SPEC 08 §3.7)', async () => {
    repo.findModelAccessibleToProject.mockResolvedValue(fakeRow());
    (testModelConnectivity as Mock).mockResolvedValue({
      ok: true,
      modelId: 'model-1',
      providerType: 'openai',
      providerModelId: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      durationMs: 120,
      checkedAt: '2026-05-18T01:00:00.000Z',
    });

    await service.probeProjectModel(WORKSPACE_ID, 'model-1', ACTOR, 'api', '00000000-0000-4000-8000-000000000777');

    expect(testModelConnectivity).toHaveBeenCalledWith(
      expect.objectContaining({
        limiterKey: 'org:00000000-0000-4000-8000-000000000777:model:00000000-0000-4000-8000-000000000101',
      }),
      expect.anything(),
    );
  });

  it('merges RuntimeLimitsProvider plan cap into model probe limits', async () => {
    repo.findModelAccessibleToProject.mockResolvedValue(
      fakeRow({ rpmLimit: 60, tpmLimit: 100000, concurrencyLimit: 10 }),
    );
    runtimeLimitsProvider.mergeLlmLimits.mockResolvedValueOnce({ rpmLimit: 30, tpmLimit: 2000, concurrency: 2 });
    (testModelConnectivity as Mock).mockResolvedValue({
      ok: true,
      modelId: 'model-1',
      providerType: 'openai',
      providerModelId: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      durationMs: 120,
      checkedAt: '2026-05-18T01:00:00.000Z',
    });

    await service.probeProjectModel(WORKSPACE_ID, 'model-1', ACTOR, 'api', '00000000-0000-4000-8000-000000000777');

    expect(runtimeLimitsProvider.mergeLlmLimits).toHaveBeenCalledWith({
      project: { projectId: WORKSPACE_ID, orgId: '00000000-0000-4000-8000-000000000777', source: 'local' },
      modelId: '00000000-0000-4000-8000-000000000101',
      source: 'probe',
    });
    expect(testModelConnectivity).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ rpmLimit: 30, tpmLimit: 2000, concurrencyLimit: 2 }),
      }),
      expect.anything(),
    );
  });

  it('threads the project orgId into the usage-snapshot READ key on list (matches the worker WRITE key)', async () => {
    repo.listProjectModels.mockResolvedValue([fakeRow()]);

    await service.listProjectModels(WORKSPACE_ID, ACTOR, '00000000-0000-4000-8000-000000000777');

    expect(limiter.getUsage).toHaveBeenCalledWith(
      'org:00000000-0000-4000-8000-000000000777:model:00000000-0000-4000-8000-000000000101',
    );
  });

  it('threads the project orgId into the draft probe limiter key', async () => {
    (testModelConnectivity as Mock).mockResolvedValue({
      ok: true,
      modelId: 'draft',
      providerType: 'openai',
      providerModelId: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      durationMs: 90,
      checkedAt: '2026-05-18T01:00:00.000Z',
    });

    await service.probeDraftProjectModel(
      WORKSPACE_ID,
      draftProbeDto(),
      ACTOR,
      'api',
      '00000000-0000-4000-8000-000000000777',
    );

    expect(testModelConnectivity).toHaveBeenCalledWith(
      expect.objectContaining({
        limiterKey: expect.stringMatching(/^org:00000000-0000-4000-8000-000000000777:model:/),
      }),
      expect.anything(),
    );
  });

  it('keeps the OSS usage-snapshot key project-scoped when no orgId is supplied', async () => {
    repo.listProjectModels.mockResolvedValue([fakeRow()]);

    await service.listProjectModels(WORKSPACE_ID, ACTOR);

    expect(limiter.getUsage).toHaveBeenCalledWith(`project:${WORKSPACE_ID}:model:00000000-0000-4000-8000-000000000101`);
  });

  it('reads quick-start option usage with no org (endpoint is not project-scoped)', async () => {
    const globalRow = fakeRow({ id: '00000000-0000-4000-8000-000000000201' });
    repo.findModelById.mockResolvedValue(globalRow);

    await service.getQuickStartModelOption(globalRow.id, ACTOR);

    // Quick-start has no @CurrentProject, so no org is threaded → falls back to the project key, never org:*.
    expect(limiter.getUsage).toHaveBeenCalledWith(`project:${WORKSPACE_ID}:model:00000000-0000-4000-8000-000000000201`);
  });

  it('handles context window dictionary operations', async () => {
    repo.findContextWindows.mockResolvedValue([fakeContextWindow()]);
    repo.findContextWindowByProviderModelId.mockResolvedValue(undefined);
    repo.upsertContextWindow.mockResolvedValue(fakeContextWindow({ contextWindowTokens: 131072 }));

    await expect(service.listContextWindows({ limit: 50 })).resolves.toMatchObject({ total: 1 });
    await expect(service.lookupContextWindow('missing')).resolves.toBeNull();
    await expect(
      service.upsertContextWindow({ providerModelId: 'gpt-4o-2024-08-06', contextWindowTokens: 131072 }, ACTOR.sub),
    ).resolves.toMatchObject({ contextWindowTokens: 131072 });
  });
});
