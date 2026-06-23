import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { ReleaseLineService } from '../release-line.service';
import type { ReleaseLineRepository } from '../release-line.repository';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import type { UsageMeteringHook } from '../../../common/contracts/usage-metering.hook';
import { type ObjectStorageProvider, type StoredObjectRef } from '../../../common/contracts/object-storage.provider';

const projectId = '11111111-1111-4111-8111-111111111111';
const promptId = '22222222-2222-4222-8222-222222222222';
const promptVersionId = '33333333-3333-4333-8333-333333333333';
const modelId = '44444444-4444-4444-8444-444444444444';
const nextModelId = '44444444-4444-4444-8444-555555555555';
const inputConnectorId = '55555555-5555-4555-8555-555555555555';
const actorId = '66666666-6666-4666-8666-666666666666';

const actor: CurrentUserPayload = {
  sub: actorId,
  email: 'manager@example.com',
  isActive: true,
  isSuperAdmin: false,
};

function createRepoMock() {
  return {
    findByIdentity: vi.fn().mockResolvedValue(null),
    findByName: vi.fn().mockResolvedValue(null),
    record: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
  };
}

function createWritableRepoMock() {
  const now = '2026-05-23T00:00:00.000Z';
  const editableEvent = {
    id: '99999999-9999-4999-8999-999999999999',
    status: 'running',
    promptVersionSnapshot: {
      id: promptVersionId,
      variables: [{ name: 'text', type: 'text', required: true }],
    },
    variableMapping: [
      { source: 'sample_id', target: 'id', required: true },
      { source: 'text', target: 'text', required: true },
    ],
    externalIdField: 'sample_id',
    createdAt: now,
    updatedAt: now,
  };
  return {
    findProjectAccess: vi.fn().mockResolvedValue({ id: projectId }),
    findById: vi.fn().mockResolvedValue({
      id: '77777777-7777-4777-8777-777777777777',
      projectId,
      name: 'risk-prod',
      status: 'running',
      currentProductionEvent: { ...editableEvent, laneType: 'production' },
      activeCanaryEvent: { ...editableEvent, laneType: 'canary' },
    }),
    promoteActiveCanary: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    stopLine: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    startLine: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    archiveLine: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    unarchiveLine: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    restoreHistoryToLane: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    forceStopRunningLanesForDelete: vi.fn().mockResolvedValue(undefined),
    hardDeleteLine: vi.fn().mockResolvedValue({ deleted: 1, payloadRefs: [] }),
    updateActiveLaneRunConfig: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    updateActiveLaneOutputRoute: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    updateActiveLaneInputRoute: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    updateCurrentProductionRetention: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
    listConnectorsForProject: vi.fn().mockResolvedValue([]),
  };
}

function createDeletionHookMock() {
  return {
    prepareReleaseLineDeletion: vi.fn().mockResolvedValue({
      releaseLineId: '77777777-7777-4777-8777-777777777777',
      lineName: 'risk-prod',
      events: [],
      versions: [],
      annotationTasks: [],
      runResults: 0,
      total: 0,
    }),
  };
}

function createService(repo: unknown, usageMetering?: UsageMeteringHook, objectStorage?: ObjectStorageProvider) {
  return new ReleaseLineService(
    repo as unknown as ReleaseLineRepository,
    new LocalAccessControlService(),
    createDeletionHookMock() as never,
    usageMetering,
    objectStorage,
  );
}

function legacyProductionInput() {
  const now = new Date('2026-05-23T00:00:00.000Z');
  return {
    id: '88888888-8888-4888-8888-888888888888',
    projectId,
    promptId,
    eventType: 'from_prompt',
    promptVersionId,
    promptVersionNumber: 3,
    modelId,
    inputConnectorId,
    outputConnectorIds: [],
    runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 4, temperature: 0.3 },
    variableMapping: {},
    filterRules: null,
    recordMode: 'all' as const,
    recordCategories: [],
    externalIdField: null,
    retentionDays: null,
    status: 'running',
    createdBy: actorId,
    submitReason: 'risk-prod\ninitial production',
    sourceExperimentId: null,
    sourceCanaryId: null,
    sourceMetricsSnapshot: null,
    promptSnapshot: { id: promptId, name: 'risk-prompt' },
    promptVersionSnapshot: { id: promptVersionId, promptId, versionNumber: 3 },
    rollbackTargetEventId: null,
    startedAt: now,
    finishedAt: null,
    stopReason: null,
    createdAt: now,
    updatedAt: now,
    promptName: 'risk-prompt',
    modelName: 'gpt-test',
    modelProvider: 'openai',
    inputConnectorName: 'risk-input',
    inputConnectorType: 'webhook',
  };
}

function releaseLineDto() {
  const now = '2026-05-23T00:00:00.000Z';
  return {
    id: '77777777-7777-4777-8777-777777777777',
    projectId,
    name: 'risk-prod',
    status: 'running',
    currentProductionEventId: '99999999-9999-4999-8999-999999999999',
    activeCanaryEventId: null,
    currentProductionEvent: null,
    activeCanaryEvent: null,
    latestEvent: {
      id: '99999999-9999-4999-8999-999999999999',
      releaseLineId: '77777777-7777-4777-8777-777777777777',
      laneType: 'production',
      operation: 'submit',
      status: 'running',
      terminalReason: null,
      sourceEventId: null,
      supersedesEventId: null,
      rollbackTargetEventId: null,
      promptVersionId,
      modelId,
      inputConnectorId,
      outputConnectorIds: [],
      createdAt: now,
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  } as never;
}

describe('ReleaseLineService.release name uniqueness', () => {
  it('rejects a duplicate release name for a new release identity', async () => {
    const repo = createRepoMock();
    repo.findByName.mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999', name: 'risk-prod' });
    const service = createService(repo);

    await expect(service.recordLegacyProductionEvent(legacyProductionInput())).rejects.toThrow(
      new ConflictException('release_name_taken'),
    );
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('allows events for an existing release identity without treating the incoming event name as a rename', async () => {
    const repo = createRepoMock();
    repo.findByIdentity.mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777', name: 'risk-prod' });
    const service = createService(repo);

    await service.recordLegacyProductionEvent({
      ...legacyProductionInput(),
      submitReason: 'new event reason',
    });

    expect(repo.findByName).not.toHaveBeenCalled();
    expect(repo.record).toHaveBeenCalledWith(expect.objectContaining({ lineName: 'new event reason' }));
  });

  it('maps the database unique index violation to release_name_taken', async () => {
    const repo = createRepoMock();
    repo.record.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "uniq_release_lines_project_name"'), {
        code: '23505',
        constraint: 'uniq_release_lines_project_name',
      }),
    );
    const service = createService(repo);

    await expect(service.recordLegacyProductionEvent(legacyProductionInput())).rejects.toThrow(
      new ConflictException('release_name_taken'),
    );
  });

  it('maps a concurrent production version-number collision to release_version_conflict', async () => {
    const repo = createRepoMock();
    repo.record.mockRejectedValue(
      Object.assign(
        new Error('duplicate key value violates unique constraint "uniq_release_versions_line_production_number"'),
        { code: '23505', constraint: 'uniq_release_versions_line_production_number' },
      ),
    );
    const service = createService(repo);

    await expect(service.recordLegacyProductionEvent(legacyProductionInput())).rejects.toThrow(
      new ConflictException('release_version_conflict'),
    );
  });

  it('maps a concurrent candidate version-number collision to release_version_conflict', async () => {
    const repo = createRepoMock();
    repo.record.mockRejectedValue(
      Object.assign(
        new Error('duplicate key value violates unique constraint "uniq_release_versions_line_candidate_number"'),
        { code: '23505', constraint: 'uniq_release_versions_line_candidate_number' },
      ),
    );
    const service = createService(repo);

    await expect(service.recordLegacyProductionEvent(legacyProductionInput())).rejects.toThrow(
      new ConflictException('release_version_conflict'),
    );
  });

  it('records release line and release event metering after a mirrored event is written', async () => {
    const repo = createRepoMock();
    repo.record.mockResolvedValue(releaseLineDto());
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const service = createService(repo, usageMetering);

    await service.recordLegacyProductionEvent(legacyProductionInput());

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'release',
        eventType: 'release_line.created',
        idempotencyKey: 'release_line:77777777-7777-4777-8777-777777777777:created',
        projectId,
      }),
    );
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'release',
        eventType: 'release_event.created',
        idempotencyKey: 'release_event:99999999-9999-4999-8999-999999999999:created',
        projectId,
      }),
    );
  });
});

describe('ReleaseLineService.promoteCanary', () => {
  it('promotes the active canary through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.promoteCanary(projectId, '77777777-7777-4777-8777-777777777777', actor);

    expect(repo.promoteActiveCanary).toHaveBeenCalledWith(projectId, '77777777-7777-4777-8777-777777777777', actorId);
  });

  it('rejects when there is no promotable canary lane', async () => {
    const repo = createWritableRepoMock();
    repo.promoteActiveCanary.mockResolvedValue(null);
    const service = createService(repo);

    await expect(service.promoteCanary(projectId, '77777777-7777-4777-8777-777777777777', actor)).rejects.toThrow(
      'has no promotable canary lane',
    );
  });
});

describe('ReleaseLineService.stopLine', () => {
  it('stops the release line through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.stopLine(projectId, '77777777-7777-4777-8777-777777777777', { reason: 'operator stop' }, actor);

    expect(repo.stopLine).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      'operator stop',
      actorId,
    );
  });

  it('rejects when there is no running lane to stop', async () => {
    const repo = createWritableRepoMock();
    repo.stopLine.mockResolvedValue(null);
    const service = createService(repo);

    await expect(
      service.stopLine(projectId, '77777777-7777-4777-8777-777777777777', { reason: 'operator stop' }, actor),
    ).rejects.toThrow('has no running lane to stop');
  });
});

describe('ReleaseLineService.startLine', () => {
  it('starts a stopped release line through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.startLine(projectId, '77777777-7777-4777-8777-777777777777', { reason: 'operator start' }, actor);

    expect(repo.startLine).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      'operator start',
      actorId,
    );
  });

  it('rejects when there is no stopped lane to start', async () => {
    const repo = createWritableRepoMock();
    repo.startLine.mockResolvedValue(null);
    const service = createService(repo);

    await expect(service.startLine(projectId, '77777777-7777-4777-8777-777777777777', {}, actor)).rejects.toThrow(
      'has no stopped lane to start',
    );
  });
});

describe('ReleaseLineService.archiveLine', () => {
  it('archives the release line through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.archiveLine(projectId, '77777777-7777-4777-8777-777777777777', { reason: 'operator archive' }, actor);

    expect(repo.archiveLine).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      'operator archive',
      actorId,
    );
  });

  it('rejects when the release line has not been stopped before archive', async () => {
    const repo = createWritableRepoMock();
    repo.archiveLine.mockResolvedValue(null);
    const service = createService(repo);

    await expect(service.archiveLine(projectId, '77777777-7777-4777-8777-777777777777', {}, actor)).rejects.toThrow(
      'must be stopped before archive',
    );
  });
});

describe('ReleaseLineService.unarchiveLine', () => {
  it('unarchives the release line through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.unarchiveLine(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      { reason: 'operator restore' },
      actor,
    );

    expect(repo.unarchiveLine).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      'operator restore',
      actorId,
    );
  });

  it('rejects when the release line is not archived', async () => {
    const repo = createWritableRepoMock();
    repo.unarchiveLine.mockResolvedValue(null);
    const service = createService(repo);

    await expect(service.unarchiveLine(projectId, '77777777-7777-4777-8777-777777777777', {}, actor)).rejects.toThrow(
      'is not archived',
    );
  });
});

describe('ReleaseLineService.restoreHistoryToSlot', () => {
  const sourceEventId = '88888888-8888-4888-8888-888888888888';

  it('restores a history event to the production slot through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.restoreHistoryToProduction(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      { sourceEventId, reason: 'operator restore production' },
      actor,
    );

    expect(repo.restoreHistoryToLane).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      sourceEventId,
      'production',
      'operator restore production',
      actorId,
    );
  });

  it('restores a history event to the canary slot through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.restoreHistoryToCanary(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      { sourceEventId, reason: 'operator restore canary' },
      actor,
    );

    expect(repo.restoreHistoryToLane).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      sourceEventId,
      'canary',
      'operator restore canary',
      actorId,
    );
  });

  it('rejects when the history event cannot be restored', async () => {
    const repo = createWritableRepoMock();
    repo.restoreHistoryToLane.mockResolvedValue(null);
    const service = createService(repo);

    await expect(
      service.restoreHistoryToProduction(projectId, '77777777-7777-4777-8777-777777777777', { sourceEventId }, actor),
    ).rejects.toThrow('cannot restore that history event');
  });

  it('maps a production restore that conflicts with a running prompt to release_line_restore_conflict', async () => {
    const repo = createWritableRepoMock();
    repo.restoreHistoryToLane.mockRejectedValue(
      Object.assign(
        new Error('duplicate key value violates unique constraint "uniq_running_production_event_per_prompt"'),
        { code: '23505', constraint: 'uniq_running_production_event_per_prompt' },
      ),
    );
    const service = createService(repo);

    await expect(
      service.restoreHistoryToProduction(projectId, '77777777-7777-4777-8777-777777777777', { sourceEventId }, actor),
    ).rejects.toThrow(new ConflictException('release_line_restore_conflict'));
  });

  it('maps a canary restore that conflicts with an active canary to release_line_restore_conflict', async () => {
    const repo = createWritableRepoMock();
    repo.restoreHistoryToLane.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "uniq_active_canary_event_per_line"'), {
        code: '23505',
        constraint: 'uniq_active_canary_event_per_line',
      }),
    );
    const service = createService(repo);

    await expect(
      service.restoreHistoryToCanary(projectId, '77777777-7777-4777-8777-777777777777', { sourceEventId }, actor),
    ).rejects.toThrow(new ConflictException('release_line_restore_conflict'));
  });
});

describe('ReleaseLineService.deleteLine', () => {
  it('permanently deletes the release line after name confirmation', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.deleteLine(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      { confirmationName: 'risk-prod', reason: 'cleanup' },
      actor,
    );

    expect(repo.forceStopRunningLanesForDelete).toHaveBeenCalledWith(projectId, '77777777-7777-4777-8777-777777777777');
    expect(repo.hardDeleteLine).toHaveBeenCalledWith(projectId, '77777777-7777-4777-8777-777777777777');
    // Barrier first: the force-stop must run before the physical delete.
    expect(repo.forceStopRunningLanesForDelete.mock.invocationCallOrder[0]!).toBeLessThan(
      repo.hardDeleteLine.mock.invocationCallOrder[0]!,
    );
  });

  it('cleans offloaded release run-result payload refs after permanent deletion', async () => {
    const repo = createWritableRepoMock();
    const payloadRef: StoredObjectRef = {
      provider: 'r2',
      bucket: 'proofhound-dev',
      key: 'orgs/org-1/projects/project-1/run_result_shard/99999999-9999-4999-8999-999999999999/gen1/shard-00000.jsonl.gz',
      bytes: 7114,
      codec: 'gzip',
      resourceType: 'run_result_shard',
      resourceId: '99999999-9999-4999-8999-999999999999',
    };
    const objectStorage = {
      isEnabled: vi.fn(() => true),
      deleteObjects: vi.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStorageProvider;
    repo.hardDeleteLine.mockResolvedValue({ deleted: 1, payloadRefs: [payloadRef] });
    const service = createService(repo, undefined, objectStorage);

    await service.deleteLine(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      { confirmationName: 'risk-prod', reason: 'cleanup' },
      actor,
    );

    expect(objectStorage.deleteObjects).toHaveBeenCalledWith([payloadRef]);
  });

  it('rejects permanent deletion when the confirmation name does not match', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await expect(
      service.deleteLine(projectId, '77777777-7777-4777-8777-777777777777', { confirmationName: 'wrong-name' }, actor),
    ).rejects.toThrow('release_line_delete_confirmation_mismatch');
    expect(repo.hardDeleteLine).not.toHaveBeenCalled();
  });
});

describe('ReleaseLineService.updateRunConfig', () => {
  it('updates the selected active lane run config through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);
    const input = {
      laneType: 'production' as const,
      modelId: nextModelId,
      runConfig: { rpmLimit: 120, tpmLimit: 120_000, concurrency: 8, temperature: 0.5 },
      recordMode: 'selected_categories' as const,
      recordCategories: ['refund'],
    };

    await service.updateRunConfig(projectId, '77777777-7777-4777-8777-777777777777', input, actor);

    expect(repo.updateActiveLaneRunConfig).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      input,
      actorId,
    );
  });

  it('rejects when the requested lane is not editable', async () => {
    const repo = createWritableRepoMock();
    repo.updateActiveLaneRunConfig.mockResolvedValue(null);
    const service = createService(repo);

    await expect(
      service.updateRunConfig(
        projectId,
        '77777777-7777-4777-8777-777777777777',
        {
          laneType: 'canary',
          runConfig: { rpmLimit: 120, tpmLimit: 120_000, concurrency: 8, temperature: 0.5 },
        },
        actor,
      ),
    ).rejects.toThrow('has no editable canary lane');
  });
});

describe('ReleaseLineService.updateOutputRoute', () => {
  it('updates the selected active lane output route through the repository', async () => {
    const repo = createWritableRepoMock();
    repo.listConnectorsForProject.mockResolvedValue([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'out', type: 'redis', direction: 'output' },
    ]);
    const service = createService(repo);
    const input = {
      laneType: 'canary' as const,
      outputConnectorIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      outputMapping: [
        {
          connectorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          outputMapping: [{ source: 'decision', target: 'decision' }],
        },
      ],
    };

    await service.updateOutputRoute(projectId, '77777777-7777-4777-8777-777777777777', input, actor);

    expect(repo.listConnectorsForProject).toHaveBeenCalledWith(projectId, input.outputConnectorIds);
    expect(repo.updateActiveLaneOutputRoute).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      input,
      actorId,
    );
  });

  it('rejects input connectors in the output route', async () => {
    const repo = createWritableRepoMock();
    repo.listConnectorsForProject.mockResolvedValue([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'in', type: 'kafka', direction: 'input' },
    ]);
    const service = createService(repo);

    await expect(
      service.updateOutputRoute(
        projectId,
        '77777777-7777-4777-8777-777777777777',
        {
          laneType: 'production',
          outputConnectorIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
          outputMapping: [],
        },
        actor,
      ),
    ).rejects.toThrow('is not an output connector');
  });

  it('rejects output mappings for connectors that are not selected', async () => {
    const repo = createWritableRepoMock();
    repo.listConnectorsForProject.mockResolvedValue([
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'out', type: 'redis', direction: 'output' },
    ]);
    const service = createService(repo);

    await expect(
      service.updateOutputRoute(
        projectId,
        '77777777-7777-4777-8777-777777777777',
        {
          laneType: 'production',
          outputConnectorIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
          outputMapping: [
            {
              connectorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              outputMapping: [{ source: 'decision', target: 'decision' }],
            },
          ],
        },
        actor,
      ),
    ).rejects.toThrow('is not selected');
  });
});

describe('ReleaseLineService.updateInputRoute', () => {
  it('updates the selected active lane input route through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);
    const input = {
      laneType: 'canary' as const,
      variableMapping: [
        { source: 'sample_id', target: 'id', required: true },
        { source: 'text', target: 'text', required: true },
      ],
      filterRules: { type: 'atom' as const, field: 'country', op: 'eq' as const, value: 'US' },
      externalIdField: 'sample_id',
    };

    await service.updateInputRoute(projectId, '77777777-7777-4777-8777-777777777777', input, actor);

    expect(repo.updateActiveLaneInputRoute).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      input,
      actorId,
    );
  });

  it('rejects when the requested input route lane is not editable', async () => {
    const repo = createWritableRepoMock();
    repo.updateActiveLaneInputRoute.mockResolvedValue(null);
    const service = createService(repo);

    await expect(
      service.updateInputRoute(
        projectId,
        '77777777-7777-4777-8777-777777777777',
        {
          laneType: 'production',
          variableMapping: { id: 'sample_id', text: 'text' },
          filterRules: null,
          externalIdField: 'sample_id',
        },
        actor,
      ),
    ).rejects.toThrow('has no editable production lane');
  });

  it('rejects input route mappings that miss a prompt variable', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await expect(
      service.updateInputRoute(
        projectId,
        '77777777-7777-4777-8777-777777777777',
        {
          laneType: 'canary',
          variableMapping: [{ source: 'sample_id', target: 'id', required: true }],
          filterRules: null,
          externalIdField: 'sample_id',
        },
        actor,
      ),
    ).rejects.toThrow('release_variable_mapping_missing_prompt_variables:text');
    expect(repo.updateActiveLaneInputRoute).not.toHaveBeenCalled();
  });
});

describe('ReleaseLineService.updateRetention', () => {
  it('updates the current production retention through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = createService(repo);

    await service.updateRetention(projectId, '77777777-7777-4777-8777-777777777777', { retentionDays: 7 }, actor);

    expect(repo.updateCurrentProductionRetention).toHaveBeenCalledWith(
      projectId,
      '77777777-7777-4777-8777-777777777777',
      7,
    );
  });

  it('rejects when there is no editable production lane', async () => {
    const repo = createWritableRepoMock();
    repo.updateCurrentProductionRetention.mockResolvedValue(null);
    const service = createService(repo);

    await expect(
      service.updateRetention(projectId, '77777777-7777-4777-8777-777777777777', { retentionDays: null }, actor),
    ).rejects.toThrow('has no editable production lane');
  });
});
