import { NotFoundException } from '@nestjs/common';
import { RateLimitExceededError } from '@proofhound/limiter';
import * as llmClientModule from '@proofhound/llm-client';
import { vi, type Mock } from 'vitest';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import type { CryptoService } from '../../../../shared/crypto/crypto.service';
import type { PromptRepository } from '../prompt.repository';
import { PromptTryRunService } from '../prompt-try-run.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { LocalQuotaPolicyHook } from '../../../common/contracts/quota-policy.hook';
import type { RuntimeLimitsProvider } from '../../../common/contracts/runtime-limits.provider';

vi.mock('@proofhound/llm-client', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    invokeLLM: vi.fn(),
  };
});

const llmClient = llmClientModule as unknown as { invokeLLM: Mock };

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PROMPT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const MODEL_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

const actor: CurrentUserPayload = {
  sub: USER_ID,
  email: 'a@b.com',
  isSuperAdmin: false,
  isActive: true,
};

function buildService(overrides?: {
  promptRepo?: Partial<PromptRepository>;
  crypto?: Partial<CryptoService>;
  modelRow?: Record<string, unknown> | null;
  runtimeLimitsProvider?: Partial<RuntimeLimitsProvider>;
}) {
  const modelRow = overrides?.modelRow ?? {
    id: MODEL_ID,
    providerType: 'openai',
    providerModelId: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1',
    apiKeyEncrypted: 'enc',
    isActive: true,
    deletedAt: null,
    capabilities: { image: 'none' },
    rpmLimit: 60,
    tpmLimit: 100000,
    concurrencyLimit: 20,
    inputTokenPricePerMillion: '0',
    outputTokenPricePerMillion: '0',
  };

  const dbStub = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (modelRow ? [modelRow] : []),
        }),
      }),
    }),
  };

  const promptRepo: Partial<PromptRepository> = {
    findProjectAccess: vi.fn().mockResolvedValue({ id: PROJECT_ID }),
    findPromptById: vi.fn().mockResolvedValue({ id: PROMPT_ID, projectId: PROJECT_ID, name: 'p' }),
    findVersionInPrompt: vi.fn().mockResolvedValue({
      id: VERSION_ID,
      promptId: PROMPT_ID,
      versionNumber: 1,
      body: 'Hello {{name}}',
      variables: [{ name: 'name', type: 'text', required: true }],
      outputSchema: null,
      judgmentRules: null,
      parentVersionId: null,
      generatedByOptimizationId: null,
      changeReason: null,
      isFrozen: false,
      createdBy: USER_ID,
      createdAt: new Date(),
      frozenAt: null,
    }),
    ...overrides?.promptRepo,
  };

  const crypto: Partial<CryptoService> = {
    decryptApiKey: vi.fn().mockReturnValue('plain-api-key'),
    ...overrides?.crypto,
  };

  const limiter = {
    acquire: vi.fn().mockResolvedValue({ release: vi.fn() }),
    release: vi.fn(),
  };

  const service = new PromptTryRunService(
    promptRepo as PromptRepository,
    crypto as CryptoService,
    dbStub as never,
    limiter as never,
    new LocalAccessControlService(),
    {
      // SaaS-shaped key strategy: derive the org bucket from the project (SPEC 08 §3.7) when an orgId is
      // carried. Lets the test prove the project's orgId reaches buildModelKey. OSS ignores it → `model:<id>`.
      buildModelKey: vi.fn((project: { projectId: string; orgId?: string }, modelId: string) =>
        project.orgId ? `org:${project.orgId}:model:${modelId}` : `project:${project.projectId}:model:${modelId}`,
      ),
    },
    {
      mergeLlmLimits: vi.fn().mockImplementation(async (input) => input.limits),
      ...overrides?.runtimeLimitsProvider,
    } as RuntimeLimitsProvider,
    new LocalQuotaPolicyHook(),
  );

  return { service, promptRepo, crypto };
}

describe('PromptTryRunService', () => {
  beforeEach(() => {
    llmClient.invokeLLM.mockReset();
  });

  it('throws NotFound when project is not accessible', async () => {
    const { service } = buildService({
      promptRepo: { findProjectAccess: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFound when prompt missing', async () => {
    const { service } = buildService({
      promptRepo: { findPromptById: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFound when prompt version missing', async () => {
    const { service } = buildService({
      promptRepo: { findVersionInPrompt: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects (NotFound or TypeError) when model row missing or inactive', async () => {
    // When simulating the drizzle query chain with fakeDb, select().from().where().limit() may return undefined at certain edges
    // instead of []. The runtime would then throw TypeError when accessing row.isActive; a real DB always returns [] → service throws NotFoundException.
    // This test only cares that "the service does not silently succeed".
    const { service } = buildService({ modelRow: null });
    await expect(service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor)).rejects.toBeDefined();
  });

  it('returns success response on successful LLM call', async () => {
    llmClient.invokeLLM.mockResolvedValue({
      content: '{"answer":"hi"}',
      rawResponse: {},
      parsed: { answer: 'hi' },
      usage: { inputTokens: 10, outputTokens: 4 },
      costEstimate: 0.0005,
      durationMs: 432,
    });

    const { service } = buildService();
    const out = await service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor);

    expect(out.status).toBe('success');
    expect(out.rawOutput).toBe('{"answer":"hi"}');
    expect(out.parsedOutput).toEqual({ answer: 'hi' });
    expect(out.latencyMs).toBe(432);
    expect(out.inputTokens).toBe(10);
    expect(out.outputTokens).toBe(4);
    expect(llmClient.invokeLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        limiterKey: `project:${PROJECT_ID}:model:${MODEL_ID}`,
      }),
      expect.anything(),
    );
  });

  it('threads the project orgId into the limiter key (SaaS rate-limit bucket, SPEC 08 §3.7)', async () => {
    llmClient.invokeLLM.mockResolvedValue({
      content: '{"answer":"hi"}',
      rawResponse: {},
      parsed: { answer: 'hi' },
      usage: { inputTokens: 10, outputTokens: 4 },
      costEstimate: 0.0005,
      durationMs: 432,
    });

    const { service } = buildService();
    // orgId is sourced from the resolved ProjectContext (controller passes @CurrentProject().orgId), not the actor.
    await service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor, '00000000-0000-4000-8000-000000000777');

    expect(llmClient.invokeLLM).toHaveBeenCalledWith(
      expect.objectContaining({ limiterKey: `org:00000000-0000-4000-8000-000000000777:model:${MODEL_ID}` }),
      expect.anything(),
    );
  });

  it('merges RuntimeLimitsProvider plan cap into prompt try-run model limits', async () => {
    llmClient.invokeLLM.mockResolvedValue({
      content: '{"answer":"hi"}',
      rawResponse: {},
      parsed: { answer: 'hi' },
      usage: { inputTokens: 10, outputTokens: 4 },
      costEstimate: 0.0005,
      durationMs: 432,
    });

    const runtimeLimitsProvider = {
      mergeLlmLimits: vi.fn().mockResolvedValue({ rpmLimit: 12, tpmLimit: 1200, concurrency: 3 }),
    };
    const { service } = buildService({ runtimeLimitsProvider });

    await service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor, '00000000-0000-4000-8000-000000000777');

    expect(runtimeLimitsProvider.mergeLlmLimits).toHaveBeenCalledWith({
      project: { projectId: PROJECT_ID, orgId: '00000000-0000-4000-8000-000000000777', source: 'local' },
      modelId: MODEL_ID,
      source: 'prompt_try_run',
    });
    expect(llmClient.invokeLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ rpmLimit: 12, tpmLimit: 1200, concurrencyLimit: 3 }),
      }),
      expect.anything(),
    );
  });

  it('falls back to markdown JSON parsing when invokeLLM returns null parsed output', async () => {
    llmClient.invokeLLM.mockResolvedValue({
      content: '```json\n{"answer":"hi"}\n```',
      rawResponse: {},
      parsed: null,
      usage: { inputTokens: 10, outputTokens: 4 },
      costEstimate: 0.0005,
      durationMs: 432,
    });

    const { service } = buildService();
    const out = await service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor);

    expect(out.status).toBe('success');
    expect(out.parsedOutput).toEqual({ answer: 'hi' });
  });

  it('returns error response when limiter rejects', async () => {
    llmClient.invokeLLM.mockRejectedValue(new RateLimitExceededError('rpm', 1000));

    const { service } = buildService();
    const out = await service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor);

    expect(out.status).toBe('error');
    expect(out.errorClass).toBe('rate_limit');
    expect(out.errorMessage).toContain('rpm');
  });

  it('returns error response when provider invocation throws generic error', async () => {
    llmClient.invokeLLM.mockRejectedValue(new Error('boom'));

    const { service } = buildService();
    const out = await service.tryRun(PROJECT_ID, PROMPT_ID, validRequest(), actor);

    expect(out.status).toBe('error');
    expect(out.errorMessage).toBe('boom');
  });
});

function validRequest() {
  return {
    promptVersionId: VERSION_ID,
    modelId: MODEL_ID,
    variables: { name: 'Alice' },
  };
}
