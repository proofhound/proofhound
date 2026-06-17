import { describe, expect, it, vi } from 'vitest';
import type { CreateProductionReleaseInputDto } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import type { ReleaseLineService } from '../../release-line/release-line.service';
import type { ProductionReleaseEventRowWithJoins, ProductionReleaseRepository } from '../production-release.repository';
import { ProductionReleaseService } from '../production-release.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import type { WorkflowAuthorizationHook } from '../../../common/contracts/workflow-authorization.hook';

const projectId = '11111111-1111-4111-8111-111111111111';
const promptId = '22222222-2222-4222-8222-222222222222';
const promptVersionId = '33333333-3333-4333-8333-333333333333';
const modelId = '44444444-4444-4444-8444-444444444444';
const inputConnectorId = '55555555-5555-4555-8555-555555555555';
const actorId = '66666666-6666-4666-8666-666666666666';
const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const actor: CurrentUserPayload = {
  sub: actorId,
  email: 'manager@example.com',
  isActive: true,
  isSuperAdmin: false,
};

const createInput: CreateProductionReleaseInputDto = {
  promptId,
  promptVersionId,
  modelId,
  inputConnectorId,
  outputConnectorIds: [],
  eventType: 'from_prompt',
  runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 4, temperature: 0.3 },
  variableMapping: {},
  filterRules: null,
  recordMode: 'all',
  recordCategories: [],
  externalIdField: null,
  retentionDays: null,
  submitReason: '上线新版本',
  sourceExperimentId: null,
  sourceCanaryId: null,
  sourceMetricsSnapshot: null,
  rollbackTargetEventId: null,
};

function releaseRow(overrides: Partial<ProductionReleaseEventRowWithJoins> = {}): ProductionReleaseEventRowWithJoins {
  const now = new Date('2026-05-20T00:00:00.000Z');
  return {
    id: '77777777-7777-4777-8777-777777777777',
    projectId,
    promptId,
    eventType: 'from_prompt',
    promptVersionId,
    modelId,
    inputConnectorId,
    outputConnectorIds: [],
    runConfig: createInput.runConfig,
    variableMapping: {},
    filterRules: null,
    recordMode: 'all',
    recordCategories: [],
    externalIdField: null,
    retentionDays: null,
    status: 'running',
    createdBy: actorId,
    submitReason: createInput.submitReason,
    sourceExperimentId: null,
    sourceCanaryId: null,
    sourceMetricsSnapshot: null,
    promptSnapshot: { id: promptId, name: '分类提示词', defaultDatasetId: null },
    promptVersionSnapshot: {
      id: promptVersionId,
      promptId,
      versionNumber: 3,
      body: '判断 {{text}}',
      variables: [],
      outputSchema: null,
      judgmentRules: null,
      promptLanguage: 'zh-CN',
    },
    rollbackTargetEventId: null,
    controlState: null,
    startedAt: now,
    finishedAt: null,
    stopReason: null,
    createdAt: now,
    updatedAt: now,
    promptName: '分类提示词',
    promptVersionNumber: 3,
    modelName: 'gpt-test',
    modelProvider: 'openai',
    inputConnectorName: 'input',
    inputConnectorType: 'webhook',
    createdByName: null,
    ...overrides,
  };
}

function createRepoMock(isFrozen: boolean) {
  const row = releaseRow();
  return {
    findProjectAccess: vi.fn().mockResolvedValue({ id: projectId }),
    findPromptForProject: vi.fn().mockResolvedValue({ id: promptId, name: '分类提示词', defaultDatasetId: null }),
    findPromptVersionForPrompt: vi.fn().mockResolvedValue({
      id: promptVersionId,
      promptId,
      versionNumber: 3,
      body: '判断 {{text}}',
      variables: [],
      outputSchema: null,
      judgmentRules: null,
      promptLanguage: 'zh-CN',
      isFrozen,
      createdBy: actorId,
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      frozenAt: null,
    }),
    freezePromptVersionIfNeeded: vi.fn().mockResolvedValue(undefined),
    markPromptVersionProduction: vi.fn().mockResolvedValue(undefined),
    clearPromptProductionVersion: vi.fn().mockResolvedValue(undefined),
    findModelById: vi.fn().mockResolvedValue({ id: modelId, name: 'gpt-test', providerType: 'openai' }),
    findConnectorForProject: vi.fn().mockResolvedValue({
      id: inputConnectorId,
      name: 'input',
      type: 'webhook',
      direction: 'input',
    }),
    listConnectorsForProject: vi.fn().mockResolvedValue([]),
    findRunningByInputConnector: vi.fn().mockResolvedValue(null),
    findEventById: vi.fn().mockResolvedValue(row),
  };
}

function releaseLineServiceMock(eventId = '77777777-7777-4777-8777-777777777777') {
  return {
    assertNameAvailable: vi.fn().mockResolvedValue(undefined),
    recordProductionEvent: vi.fn().mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      currentProductionEvent: { id: eventId },
      latestEvent: { id: eventId },
    }),
  };
}

function workflowAuthMock(): WorkflowAuthorizationHook {
  return {
    assertCanStart: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ProductionReleaseService.create', () => {
  it('records production directly as a release line event with prompt snapshots', async () => {
    const repo = createRepoMock(false);
    const releaseLines = releaseLineServiceMock();
    const workflowAuth = workflowAuthMock();
    const service = new ProductionReleaseService(
      repo as unknown as ProductionReleaseRepository,
      new LocalAccessControlService(),
      workflowAuth,
      releaseLines as unknown as ReleaseLineService,
    );

    const event = await service.create(projectId, createInput, actor, orgId);

    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, actorKind: 'local_user' }),
      { projectId, orgId, source: 'local' },
      'release',
    );
    expect(repo.freezePromptVersionIfNeeded).toHaveBeenCalledWith(promptVersionId);
    expect(releaseLines.recordProductionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId,
        promptVersionId,
        promptVersionNumber: 3,
        promptSnapshot: { id: promptId, name: '分类提示词', defaultDatasetId: null },
        promptVersionSnapshot: expect.objectContaining({
          id: promptVersionId,
          body: '判断 {{text}}',
          promptLanguage: 'zh-CN',
        }),
        status: 'running',
      }),
    );
    expect(repo.markPromptVersionProduction).toHaveBeenCalledWith(promptId, promptVersionId, actorId);
    expect(event.promptVersionId).toBe(promptVersionId);
  });

  it('does not freeze an already frozen prompt version before recording', async () => {
    const repo = createRepoMock(true);
    const releaseLines = releaseLineServiceMock();
    const service = new ProductionReleaseService(
      repo as unknown as ProductionReleaseRepository,
      new LocalAccessControlService(),
      workflowAuthMock(),
      releaseLines as unknown as ReleaseLineService,
    );

    await service.create(projectId, createInput, actor);

    expect(repo.freezePromptVersionIfNeeded).not.toHaveBeenCalled();
    expect(releaseLines.recordProductionEvent).toHaveBeenCalled();
  });

  it('does not freeze or record a running production release when the workflow hook rejects', async () => {
    const repo = createRepoMock(false);
    const releaseLines = releaseLineServiceMock();
    const workflowAuth = {
      assertCanStart: vi.fn().mockRejectedValue(new Error('workflow_denied')),
    };
    const service = new ProductionReleaseService(
      repo as unknown as ProductionReleaseRepository,
      new LocalAccessControlService(),
      workflowAuth as unknown as WorkflowAuthorizationHook,
      releaseLines as unknown as ReleaseLineService,
    );

    await expect(service.create(projectId, createInput, actor)).rejects.toThrow('workflow_denied');

    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, actorKind: 'local_user' }),
      { projectId, source: 'local' },
      'release',
    );
    expect(repo.freezePromptVersionIfNeeded).not.toHaveBeenCalled();
    expect(releaseLines.recordProductionEvent).not.toHaveBeenCalled();
    expect(repo.markPromptVersionProduction).not.toHaveBeenCalled();
  });

  it('rejects releases that do not map every prompt variable before starting workflow', async () => {
    const repo = createRepoMock(false);
    repo.findPromptVersionForPrompt.mockResolvedValue({
      id: promptVersionId,
      promptId,
      versionNumber: 3,
      body: '判断 {{text}}',
      variables: [{ name: 'text', type: 'text', required: true }],
      outputSchema: null,
      judgmentRules: null,
      promptLanguage: 'zh-CN',
      isFrozen: false,
      createdBy: actorId,
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      frozenAt: null,
    });
    const releaseLines = releaseLineServiceMock();
    const workflowAuth = workflowAuthMock();
    const service = new ProductionReleaseService(
      repo as unknown as ProductionReleaseRepository,
      new LocalAccessControlService(),
      workflowAuth,
      releaseLines as unknown as ReleaseLineService,
    );

    await expect(service.create(projectId, createInput, actor)).rejects.toThrow(
      'release_variable_mapping_missing_prompt_variables:text',
    );

    expect(workflowAuth.assertCanStart).not.toHaveBeenCalled();
    expect(repo.freezePromptVersionIfNeeded).not.toHaveBeenCalled();
    expect(releaseLines.recordProductionEvent).not.toHaveBeenCalled();
  });
});

describe('ProductionReleaseService.stop', () => {
  it('records force_stop as a release line event and clears production pointer', async () => {
    const current = releaseRow();
    const stopped = releaseRow({
      id: '99999999-9999-4999-8999-999999999999',
      eventType: 'force_stop',
      status: 'stopped',
      stopReason: 'force_stopped',
      submitReason: '手动停止',
      finishedAt: new Date('2026-05-20T00:30:00.000Z'),
    });
    const repo = createRepoMock(true);
    repo.findEventById = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(stopped);
    const releaseLines = releaseLineServiceMock(stopped.id);
    const service = new ProductionReleaseService(
      repo as unknown as ProductionReleaseRepository,
      new LocalAccessControlService(),
      workflowAuthMock(),
      releaseLines as unknown as ReleaseLineService,
    );

    const event = await service.stop(projectId, current.id, { reason: '手动停止' }, actor);

    expect(releaseLines.recordProductionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'force_stop',
        status: 'stopped',
        stopReason: 'force_stopped',
        inputConnectorId,
      }),
    );
    expect(repo.clearPromptProductionVersion).toHaveBeenCalledWith(promptId);
    expect(event.status).toBe('stopped');
  });
});
