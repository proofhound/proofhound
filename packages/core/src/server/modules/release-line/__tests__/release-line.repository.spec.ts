import { describe, expect, it, vi } from 'vitest';
import type { ReleaseLineDto, ReleaseLineEventDto } from '@proofhound/shared';
import { ReleaseLineRepository } from '../release-line.repository';

const projectId = '11111111-1111-4111-8111-111111111111';
const releaseLineId = '22222222-2222-4222-8222-222222222222';
const productionEventId = '33333333-3333-4333-8333-333333333333';
const canaryEventId = '44444444-4444-4444-8444-444444444444';
const promptId = '55555555-5555-4555-8555-555555555555';
const promptVersionId = '66666666-6666-4666-8666-666666666666';
const modelId = '77777777-7777-4777-8777-777777777777';
const connectorId = '88888888-8888-4888-8888-888888888888';
const actorId = '99999999-9999-4999-8999-999999999999';

function event(overrides: Partial<ReleaseLineEventDto> = {}): ReleaseLineEventDto {
  const laneType = overrides.laneType ?? 'production';
  return {
    id: laneType === 'production' ? productionEventId : canaryEventId,
    projectId,
    releaseLineId,
    releaseVariantId: null,
    releaseVariantNumber: null,
    releaseVariantLabel: null,
    annotationTaskId: null,
    laneType,
    operation: laneType === 'production' ? 'create_production' : 'create_canary',
    status: 'running',
    terminalReason: null,
    sourceEventId: null,
    sourceLegacySource: null,
    sourceLegacyId: null,
    supersedesEventId: null,
    rollbackTargetEventId: null,
    legacySource: null,
    legacySourceId: null,
    promptId,
    promptName: 'sentiment',
    promptVersionId,
    promptVersionNumber: 1,
    promptVersionLabel: 'v1',
    promptSnapshot: { id: promptId, name: 'sentiment' },
    promptVersionSnapshot: { id: promptVersionId, promptId, versionNumber: 1 },
    modelId,
    modelName: 'model',
    modelProvider: 'openai',
    modelSnapshot: { id: modelId, name: 'model', providerType: 'openai' },
    inputConnectorId: connectorId,
    inputConnectorName: 'input',
    inputConnectorType: 'kafka',
    inputConnectorSnapshot: { id: connectorId, name: 'input', type: 'kafka' },
    outputConnectorIds: [],
    outputConnectors: [],
    outputConnectorSnapshots: [],
    trafficMode: laneType === 'canary' ? 'split' : null,
    trafficRatio: laneType === 'canary' ? 0.5 : null,
    runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 4 },
    variableMapping: { id: 'sample_id', text: 'text' },
    outputMapping: [],
    filterRules: null,
    recordMode: 'all',
    externalIdField: 'sample_id',
    retentionDays: null,
    sourceExperimentId: null,
    submitReason: 'initial',
    metrics: { downstreamDeliverySuccess: 23, downstreamDeliveryFailed: 2 },
    totalReceived: 100,
    totalProcessed: 80,
    totalFiltered: 20,
    totalCorrect: 70,
    totalErrors: 10,
    controlState: null,
    controlStatePayload: null,
    startedAt: '2026-05-23T10:00:00.000Z',
    finishedAt: null,
    createdBy: actorId,
    createdAt: '2026-05-23T10:00:00.000Z',
    updatedAt: '2026-05-23T10:05:00.000Z',
    ...overrides,
  };
}

function line(overrides: Partial<ReleaseLineDto> = {}): ReleaseLineDto {
  const production = event({ laneType: 'production' });
  const canary = event({ laneType: 'canary' });
  return {
    id: releaseLineId,
    projectId,
    name: 'sentiment release',
    description: null,
    promptId,
    promptName: 'sentiment',
    promptSnapshot: { id: promptId, name: 'sentiment' },
    inputConnectorId: connectorId,
    inputConnectorName: 'input',
    inputConnectorType: 'kafka',
    inputConnectorSnapshot: { id: connectorId, name: 'input', type: 'kafka' },
    status: 'production_with_canary',
    currentProductionEventId: production.id,
    activeCanaryEventId: canary.id,
    currentProductionEvent: production,
    activeCanaryEvent: canary,
    variants: [],
    outputConnectors: [],
    latestEvent: canary,
    createdBy: actorId,
    createdAt: '2026-05-23T10:00:00.000Z',
    updatedAt: '2026-05-23T10:05:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('ReleaseLineRepository event replacements', () => {
  it('starts a traffic update event with empty runtime counters', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line();
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.updateActiveCanaryTrafficRatio(projectId, releaseLineId, 0.48, actorId);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'traffic_updated',
        trafficRatio: 0.48,
        metrics: null,
        totalReceived: 0,
        totalProcessed: 0,
        totalFiltered: 0,
        totalCorrect: 0,
        totalErrors: 0,
      }),
    );
  });

  it('inherits the current production submit reason when promoting a canary', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line({
      currentProductionEvent: event({
        laneType: 'production',
        submitReason: 'emotion category\nstable production',
      }),
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    vi.spyOn(repo as unknown as { completeCanaryEvent: () => Promise<void> }, 'completeCanaryEvent').mockResolvedValue(
      undefined,
    );
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.updateActiveCanaryTrafficRatio(projectId, releaseLineId, 1, actorId);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'promote_canary',
        submitReason: 'emotion category\nstable production',
      }),
    );
  });

  it('uses the release line name and description for first production promotion', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line({
      name: 'emotion category',
      description: 'release description',
      status: 'canary',
      currentProductionEventId: null,
      currentProductionEvent: null,
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    vi.spyOn(repo as unknown as { completeCanaryEvent: () => Promise<void> }, 'completeCanaryEvent').mockResolvedValue(
      undefined,
    );
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.updateActiveCanaryTrafficRatio(projectId, releaseLineId, 1, actorId);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'promote_canary',
        submitReason: 'emotion category\nrelease description',
      }),
    );
  });

  it('does not carry a legacy generic promotion reason into a new production event', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line({
      name: 'emotion category',
      currentProductionEvent: event({
        laneType: 'production',
        submitReason: 'promote canary 100%',
      }),
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    vi.spyOn(repo as unknown as { completeCanaryEvent: () => Promise<void> }, 'completeCanaryEvent').mockResolvedValue(
      undefined,
    );
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.updateActiveCanaryTrafficRatio(projectId, releaseLineId, 1, actorId);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'promote_canary',
        submitReason: 'emotion category',
      }),
    );
  });

  it('starts a config change event with empty runtime counters', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line();
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.updateActiveLaneRunConfig(
      projectId,
      releaseLineId,
      {
        laneType: 'production',
        runConfig: { rpmLimit: 120, tpmLimit: 120_000, concurrency: 8, temperature: 0.2 },
      },
      actorId,
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'config_changed',
        supersedesEventId: productionEventId,
        metrics: null,
        totalReceived: 0,
        totalProcessed: 0,
        totalFiltered: 0,
        totalCorrect: 0,
        totalErrors: 0,
      }),
    );
  });
});
