import { describe, expect, it, vi } from 'vitest';
import type { CreateCanaryReleaseInputDto } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import type { ReleaseLineService } from '../../release-line/release-line.service';
import type { CanaryReleaseRepository, CanaryReleaseRowWithJoins } from '../canary-release.repository';
import { CanaryReleaseService } from '../canary-release.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import type { WorkflowAuthorizationHook } from '../../../common/contracts/workflow-authorization.hook';

const projectId = '11111111-1111-4111-8111-111111111111';
const promptId = '22222222-2222-4222-8222-222222222222';
const promptVersionId = '33333333-3333-4333-8333-333333333333';
const modelId = '44444444-4444-4444-8444-444444444444';
const inputConnectorId = '55555555-5555-4555-8555-555555555555';
const actorId = '66666666-6666-4666-8666-666666666666';
const canaryEventId = '77777777-7777-4777-8777-777777777777';
const releaseLineId = '99999999-9999-4999-8999-999999999999';
const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const actor: CurrentUserPayload = {
  sub: actorId,
  email: 'manager@example.com',
  isActive: true,
  isSuperAdmin: false,
};

const createInput: CreateCanaryReleaseInputDto = {
  name: 'canary_release_01',
  description: '',
  promptVersionId,
  modelId,
  inputConnectorId,
  outputConnectorIds: [],
  trafficRatio: 0.1,
  trafficMode: 'split',
  runMode: 'manual',
  recordMode: 'all',
  recordCategories: [],
  variableMapping: [{ source: 'msg.id', target: 'id', required: true }],
  outputMapping: [],
  filterRules: null,
  stopConditions: null,
  externalIdField: 'msg.id',
  annotationSchema: [],
  storageCategories: [],
  targetDatasetId: null,
  runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 4, temperature: 0.3 },
};

function canaryRow(overrides: Partial<CanaryReleaseRowWithJoins> = {}): CanaryReleaseRowWithJoins {
  const now = new Date('2026-05-20T00:00:00.000Z');
  return {
    id: canaryEventId,
    releaseLineId,
    projectId,
    name: createInput.name ?? null,
    description: null,
    promptVersionId,
    modelId,
    inputConnectorId,
    outputConnectorIds: [],
    status: 'running',
    controlState: null,
    controlStatePayload: null,
    trafficRatio: '0.1',
    trafficMode: 'split',
    runMode: 'manual',
    stopConditions: null,
    recordMode: 'all',
    recordCategories: [],
    filterRules: null,
    variableMapping: createInput.variableMapping,
    outputMapping: [],
    externalIdField: 'msg.id',
    annotationSchema: [],
    storageCategories: [],
    targetDatasetId: null,
    runConfig: createInput.runConfig,
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
    totalReceived: 0,
    totalProcessed: 0,
    totalFiltered: 0,
    totalCorrect: 0,
    totalErrors: 0,
    metrics: null,
    startedAt: now,
    finishedAt: null,
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    promptId,
    promptName: '分类提示词',
    promptVersionNumber: 3,
    modelName: 'gpt-test',
    modelProvider: 'openai',
    inputConnectorName: 'input',
    inputConnectorType: 'webhook',
    targetDatasetName: null,
    createdByName: null,
    annotationTaskId: '88888888-8888-4888-8888-888888888888',
    releaseVersionId: null,
    releaseVersionLabel: null,
    ...overrides,
  };
}

function repoMock(row = canaryRow()) {
  return {
    findProjectAccess: vi.fn().mockResolvedValue({ id: projectId }),
    findPromptVersionForProject: vi.fn().mockResolvedValue({
      id: promptVersionId,
      promptId,
      promptName: '分类提示词',
      promptDefaultDatasetId: null,
      versionNumber: 3,
      body: '判断 {{text}}',
      variables: [],
      outputSchema: null,
      judgmentRules: null,
      promptLanguage: 'zh-CN',
      isFrozen: false,
      createdBy: actorId,
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      frozenAt: null,
    }),
    findModelById: vi.fn().mockResolvedValue({ id: modelId, name: 'gpt-test', providerType: 'openai' }),
    findConnectorForProject: vi.fn().mockResolvedValue({
      id: inputConnectorId,
      name: 'input',
      type: 'webhook',
      direction: 'input',
    }),
    listConnectorsForProject: vi.fn().mockResolvedValue([]),
    findRunningProductionByInputConnector: vi.fn().mockResolvedValue(null),
    findRunningByInputConnector: vi.fn().mockResolvedValue(null),
    markPromptVersionCanary: vi.fn().mockResolvedValue(undefined),
    findByIdWithJoins: vi.fn().mockResolvedValue(row),
    aggregateUsageByCanaryIds: vi.fn().mockResolvedValue(new Map()),
  };
}

function releaseLineServiceMock(activeId = canaryEventId) {
  return {
    assertNameAvailable: vi.fn().mockResolvedValue(undefined),
    recordCanaryEvent: vi.fn().mockResolvedValue({
      id: releaseLineId,
      activeCanaryEvent: { id: activeId },
      latestEvent: { id: activeId },
    }),
    updateTrafficRatio: vi.fn().mockResolvedValue({
      id: releaseLineId,
      activeCanaryEvent: { id: activeId },
      latestEvent: { id: activeId },
    }),
  };
}

function workflowAuthMock(): WorkflowAuthorizationHook {
  return {
    assertCanStart: vi.fn().mockResolvedValue(undefined),
  };
}

describe('CanaryReleaseService.create', () => {
  it('records canary directly as a release line event with full prompt snapshot', async () => {
    const repo = repoMock();
    const releaseLines = releaseLineServiceMock();
    const workflowAuth = workflowAuthMock();
    const service = new CanaryReleaseService(
      repo as unknown as CanaryReleaseRepository,
      releaseLines as unknown as ReleaseLineService,
      new LocalAccessControlService(),
      workflowAuth,
    );

    const canary = await service.create(projectId, createInput, actor, orgId);

    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, actorKind: 'local_user' }),
      { projectId, orgId, source: 'local' },
      'release',
    );
    expect(releaseLines.recordCanaryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        promptVersionId,
        promptSnapshot: { id: promptId, name: '分类提示词', defaultDatasetId: null },
        promptVersionSnapshot: expect.objectContaining({
          id: promptVersionId,
          body: '判断 {{text}}',
          promptLanguage: 'zh-CN',
        }),
        trafficRatio: 0.1,
        status: 'running',
      }),
      'create_canary',
      'running',
    );
    expect(repo.markPromptVersionCanary).toHaveBeenCalledWith(promptId, promptVersionId, actorId);
    expect(canary.id).toBe(canaryEventId);
  });

  it('allows a new canary to replace the current active canary on the same release line', async () => {
    const repo = repoMock();
    repo.findRunningByInputConnector = vi.fn().mockResolvedValue(canaryRow());
    const releaseLines = releaseLineServiceMock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const workflowAuth = workflowAuthMock();
    const service = new CanaryReleaseService(
      repo as unknown as CanaryReleaseRepository,
      releaseLines as unknown as ReleaseLineService,
      new LocalAccessControlService(),
      workflowAuth,
    );

    await service.create(projectId, createInput, actor, orgId);

    expect(releaseLines.recordCanaryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        inputConnectorId,
        status: 'running',
      }),
      'create_canary',
      'running',
    );
  });

  it('does not record a running canary when the workflow hook rejects', async () => {
    const repo = repoMock();
    const releaseLines = releaseLineServiceMock();
    const workflowAuth = {
      assertCanStart: vi.fn().mockRejectedValue(new Error('workflow_denied')),
    };
    const service = new CanaryReleaseService(
      repo as unknown as CanaryReleaseRepository,
      releaseLines as unknown as ReleaseLineService,
      new LocalAccessControlService(),
      workflowAuth as unknown as WorkflowAuthorizationHook,
    );

    await expect(service.create(projectId, createInput, actor)).rejects.toThrow('workflow_denied');

    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, actorKind: 'local_user' }),
      { projectId, source: 'local' },
      'release',
    );
    expect(releaseLines.recordCanaryEvent).not.toHaveBeenCalled();
    expect(repo.markPromptVersionCanary).not.toHaveBeenCalled();
  });

  it('rejects canaries that do not map every prompt variable before starting workflow', async () => {
    const repo = repoMock();
    repo.findPromptVersionForProject.mockResolvedValue({
      id: promptVersionId,
      promptId,
      promptName: '分类提示词',
      promptDefaultDatasetId: null,
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
    const service = new CanaryReleaseService(
      repo as unknown as CanaryReleaseRepository,
      releaseLines as unknown as ReleaseLineService,
      new LocalAccessControlService(),
      workflowAuth,
    );

    await expect(service.create(projectId, createInput, actor)).rejects.toThrow(
      'release_variable_mapping_missing_prompt_variables:text',
    );

    expect(workflowAuth.assertCanStart).not.toHaveBeenCalled();
    expect(releaseLines.recordCanaryEvent).not.toHaveBeenCalled();
    expect(repo.markPromptVersionCanary).not.toHaveBeenCalled();
  });
});

describe('CanaryReleaseService.start', () => {
  it('does not resume a stopped canary when the workflow hook rejects', async () => {
    const repo = repoMock(canaryRow({ status: 'stopped', finishedAt: new Date('2026-05-20T01:00:00.000Z') }));
    const releaseLines = releaseLineServiceMock();
    const workflowAuth = {
      assertCanStart: vi.fn().mockRejectedValue(new Error('workflow_denied')),
    };
    const service = new CanaryReleaseService(
      repo as unknown as CanaryReleaseRepository,
      releaseLines as unknown as ReleaseLineService,
      new LocalAccessControlService(),
      workflowAuth as unknown as WorkflowAuthorizationHook,
    );

    await expect(service.start(projectId, canaryEventId, actor, orgId)).rejects.toThrow('workflow_denied');

    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, actorKind: 'local_user' }),
      { projectId, orgId, source: 'local' },
      'release',
    );
    expect(releaseLines.recordCanaryEvent).not.toHaveBeenCalled();
  });
});

describe('CanaryReleaseService.updateTrafficRatio', () => {
  it('delegates split traffic updates to the unified release line service', async () => {
    const repo = repoMock();
    const releaseLines = releaseLineServiceMock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    repo.findByIdWithJoins = vi
      .fn()
      .mockResolvedValueOnce(canaryRow())
      .mockResolvedValueOnce(canaryRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', trafficRatio: '0.25' }));
    const service = new CanaryReleaseService(
      repo as unknown as CanaryReleaseRepository,
      releaseLines as unknown as ReleaseLineService,
      new LocalAccessControlService(),
      workflowAuthMock(),
    );

    const canary = await service.updateTrafficRatio(projectId, canaryEventId, { trafficRatio: 0.25 }, actor);

    expect(releaseLines.updateTrafficRatio).toHaveBeenCalledWith(
      projectId,
      releaseLineId,
      { trafficRatio: 0.25 },
      actor,
    );
    expect(canary.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
