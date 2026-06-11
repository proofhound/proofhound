import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { ReleaseLineService } from '../release-line.service';
import type { ReleaseLineRepository } from '../release-line.repository';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import type { UsageMeteringHook } from '../../../common/contracts/usage-metering.hook';

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
  return {
    findProjectAccess: vi.fn().mockResolvedValue({ id: projectId }),
    updateActiveLaneRunConfig: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
  };
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
    status: 'production',
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
    const service = new ReleaseLineService(repo as unknown as ReleaseLineRepository, new LocalAccessControlService());

    await expect(service.recordLegacyProductionEvent(legacyProductionInput())).rejects.toThrow(
      new ConflictException('release_name_taken'),
    );
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('allows events for an existing release identity without treating the incoming event name as a rename', async () => {
    const repo = createRepoMock();
    repo.findByIdentity.mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777', name: 'risk-prod' });
    const service = new ReleaseLineService(repo as unknown as ReleaseLineRepository, new LocalAccessControlService());

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
    const service = new ReleaseLineService(repo as unknown as ReleaseLineRepository, new LocalAccessControlService());

    await expect(service.recordLegacyProductionEvent(legacyProductionInput())).rejects.toThrow(
      new ConflictException('release_name_taken'),
    );
  });

  it('records release line and release event metering after a mirrored event is written', async () => {
    const repo = createRepoMock();
    repo.record.mockResolvedValue(releaseLineDto());
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const service = new ReleaseLineService(
      repo as unknown as ReleaseLineRepository,
      new LocalAccessControlService(),
      usageMetering,
    );

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

describe('ReleaseLineService.updateRunConfig', () => {
  it('updates the selected active lane run config through the repository', async () => {
    const repo = createWritableRepoMock();
    const service = new ReleaseLineService(repo as unknown as ReleaseLineRepository, new LocalAccessControlService());
    const input = {
      laneType: 'production' as const,
      modelId: nextModelId,
      runConfig: { rpmLimit: 120, tpmLimit: 120_000, concurrency: 8, temperature: 0.5 },
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
    const service = new ReleaseLineService(repo as unknown as ReleaseLineRepository, new LocalAccessControlService());

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
