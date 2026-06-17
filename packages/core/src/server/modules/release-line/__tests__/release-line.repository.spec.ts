import { describe, expect, it, vi } from 'vitest';
import { schema } from '@proofhound/db';
import type { ReleaseLineDto, ReleaseLineEventDto } from '@proofhound/shared';
import { ReleaseLineRepository } from '../release-line.repository';

const { releaseLineEvents, releaseLines } = schema;

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
    releaseVersionId: null,
    releaseVersionKind: null,
    releaseVersionLabel: null,
    releaseVersionProductionNumber: null,
    releaseVersionTargetProductionNumber: null,
    releaseVersionCandidateNumber: null,
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
    recordCategories: [],
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
    status: 'running',
    currentProductionEventId: production.id,
    activeCanaryEventId: canary.id,
    currentProductionEvent: production,
    activeCanaryEvent: canary,
    versions: [],
    outputConnectors: [],
    latestEvent: canary,
    createdBy: actorId,
    createdAt: '2026-05-23T10:00:00.000Z',
    updatedAt: '2026-05-23T10:05:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

interface UpdateLinePointersTx {
  lineRows: Array<{ status: string | null; archivedAt: Date | null }>;
  productionRows: Array<{ id: string; status: string }>;
  canaryRows: Array<{ id: string; status: string }>;
}

function createUpdateLinePointersTx(config: UpdateLinePointersTx) {
  const captured: { set?: Record<string, unknown> } = {};
  let eventSelectCount = 0;

  function makeSelectChain(rows: unknown[]) {
    const chain = {
      from(table: unknown) {
        if (table === releaseLines) return makeSelectChain(config.lineRows);
        if (table === releaseLineEvents) {
          const rowsForCall = eventSelectCount === 0 ? config.productionRows : config.canaryRows;
          eventSelectCount += 1;
          return makeSelectChain(rowsForCall);
        }
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return Promise.resolve(rows);
      },
    };
    return chain;
  }

  const tx = {
    select() {
      return makeSelectChain([]);
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          captured.set = values;
          return {
            where() {
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
  };

  return { tx, captured };
}

describe('ReleaseLineRepository.updateLinePointers archived guard', () => {
  const eventRow = (overrides: Partial<{ operation: string; laneType: string }> = {}) =>
    ({
      id: productionEventId,
      operation: 'create_production',
      laneType: 'production',
      ...overrides,
    }) as never;

  it('never resurrects an archived line when a mirror production event is recorded', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const archivedAt = new Date('2026-05-22T00:00:00.000Z');
    const { tx, captured } = createUpdateLinePointersTx({
      lineRows: [{ status: 'archived', archivedAt }],
      productionRows: [{ id: productionEventId, status: 'running' }],
      canaryRows: [],
    });

    await (
      repo as unknown as {
        updateLinePointers: (tx: unknown, releaseLineId: string, event: unknown, now: Date) => Promise<void>;
      }
    ).updateLinePointers(tx, releaseLineId, eventRow(), new Date('2026-05-23T00:00:00.000Z'));

    expect(captured.set).toMatchObject({ status: 'archived', archivedAt });
  });

  it('keeps the line running for a normal event on a non-archived line', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const { tx, captured } = createUpdateLinePointersTx({
      lineRows: [{ status: 'running', archivedAt: null }],
      productionRows: [{ id: productionEventId, status: 'running' }],
      canaryRows: [],
    });

    await (
      repo as unknown as {
        updateLinePointers: (tx: unknown, releaseLineId: string, event: unknown, now: Date) => Promise<void>;
      }
    ).updateLinePointers(tx, releaseLineId, eventRow(), new Date('2026-05-23T00:00:00.000Z'));

    expect(captured.set).toMatchObject({ status: 'running', archivedAt: null });
  });

  it('allows an explicit unarchive event to leave the archived state', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const { tx, captured } = createUpdateLinePointersTx({
      lineRows: [{ status: 'archived', archivedAt: new Date('2026-05-22T00:00:00.000Z') }],
      productionRows: [{ id: productionEventId, status: 'stopped' }],
      canaryRows: [],
    });

    await (
      repo as unknown as {
        updateLinePointers: (tx: unknown, releaseLineId: string, event: unknown, now: Date) => Promise<void>;
      }
    ).updateLinePointers(tx, releaseLineId, eventRow({ operation: 'unarchive_line' }), new Date('2026-05-23T00:00:00.000Z'));

    expect(captured.set).toMatchObject({ status: 'stopped', archivedAt: null });
  });
});

describe('ReleaseLineRepository event replacements', () => {
  it('resumes both stopped production and canary slot snapshots', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line({
      status: 'stopped',
      currentProductionEvent: event({ laneType: 'production', status: 'stopped' }),
      activeCanaryEvent: event({ laneType: 'canary', status: 'stopped' }),
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    vi.spyOn(
      repo as unknown as { setPromptProductionVersion: () => Promise<void> },
      'setPromptProductionVersion',
    ).mockResolvedValue(undefined);
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.startLine(projectId, releaseLineId, 'resume after unarchive', actorId);

    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        laneType: 'production',
        operation: 'resume_lane',
        status: 'running',
        supersedesEventId: productionEventId,
      }),
    );
    expect(record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        laneType: 'canary',
        operation: 'resume_lane',
        status: 'running',
        supersedesEventId: canaryEventId,
      }),
    );
  });

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
      status: 'running',
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

  it('explicitly promotes a running dual-run canary', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line({
      activeCanaryEvent: event({
        laneType: 'canary',
        trafficMode: 'dual_run',
        trafficRatio: 1,
      }),
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    vi.spyOn(repo as unknown as { completeCanaryEvent: () => Promise<void> }, 'completeCanaryEvent').mockResolvedValue(
      undefined,
    );
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.promoteActiveCanary(projectId, releaseLineId, actorId);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        laneType: 'production',
        operation: 'promote_canary',
        sourceEventId: canaryEventId,
        trafficMode: null,
        trafficRatio: null,
      }),
    );
  });

  it('restores a history event to the production slot with a new release version', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const source = event({ laneType: 'canary', releaseVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const current = line();
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    vi.spyOn(repo, 'findEventById').mockResolvedValue(source);
    vi.spyOn(
      repo as unknown as { setPromptProductionVersion: () => Promise<void> },
      'setPromptProductionVersion',
    ).mockResolvedValue(undefined);
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.restoreHistoryToLane(projectId, releaseLineId, source.id, 'production', 'restore prod', actorId);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        laneType: 'production',
        operation: 'restore_to_production',
        status: 'running',
        releaseVersionId: null,
        sourceEventId: source.id,
        rollbackTargetEventId: source.id,
        trafficMode: null,
        trafficRatio: null,
      }),
    );
  });

  it('restores a history event to the canary slot with inherited canary traffic settings', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const source = event({ laneType: 'production', releaseVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const current = line({
      activeCanaryEvent: event({ laneType: 'canary', trafficMode: 'dual_run', trafficRatio: 0.25 }),
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    vi.spyOn(repo, 'findEventById').mockResolvedValue(source);
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.restoreHistoryToLane(projectId, releaseLineId, source.id, 'canary', 'restore canary', actorId);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        laneType: 'canary',
        operation: 'restore_to_canary',
        status: 'running',
        releaseVersionId: null,
        sourceEventId: source.id,
        trafficMode: 'dual_run',
        trafficRatio: 0.25,
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
        recordMode: 'selected_categories',
        recordCategories: ['refund'],
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
        recordMode: 'selected_categories',
        recordCategories: ['refund'],
      }),
    );
  });

  it('starts an output route config change event with the next connector and mapping snapshot', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line({
      currentProductionEvent: event({
        laneType: 'production',
        releaseVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        outputConnectorIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
        outputMapping: [{ source: 'decision', target: 'old_decision' }],
      }),
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.updateActiveLaneOutputRoute(
      projectId,
      releaseLineId,
      {
        laneType: 'production',
        outputConnectorIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
        outputMapping: [
          {
            connectorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            outputMapping: [{ source: 'decision', target: 'decision' }],
          },
        ],
      },
      actorId,
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseVersionId: null,
        operation: 'config_changed',
        supersedesEventId: productionEventId,
        outputConnectorIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
        outputMapping: [
          {
            connectorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            outputMapping: [{ source: 'decision', target: 'decision' }],
          },
        ],
        metrics: null,
        totalReceived: 0,
        totalProcessed: 0,
        totalFiltered: 0,
        totalCorrect: 0,
        totalErrors: 0,
      }),
    );
  });

  it('starts an input route config change event with the next mapping and filter snapshot', async () => {
    const repo = new ReleaseLineRepository({} as never);
    const current = line({
      activeCanaryEvent: event({
        laneType: 'canary',
        releaseVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        variableMapping: [
          { source: 'sample_id', target: 'id', required: true },
          { source: 'text', target: 'text', required: true },
        ],
        filterRules: null,
        externalIdField: 'sample_id',
      }),
    });
    vi.spyOn(repo, 'findById').mockResolvedValue(current);
    const record = vi.spyOn(repo, 'record').mockResolvedValue(current);

    await repo.updateActiveLaneInputRoute(
      projectId,
      releaseLineId,
      {
        laneType: 'canary',
        variableMapping: [
          { source: 'sample_id', target: 'id', required: true },
          { source: 'body.text', target: 'text', required: true },
        ],
        filterRules: { type: 'atom', field: 'country', op: 'eq', value: 'US' },
        externalIdField: 'sample_id',
      },
      actorId,
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseVersionId: null,
        operation: 'config_changed',
        supersedesEventId: canaryEventId,
        variableMapping: [
          { source: 'sample_id', target: 'id', required: true },
          { source: 'body.text', target: 'text', required: true },
        ],
        filterRules: { type: 'atom', field: 'country', op: 'eq', value: 'US' },
        externalIdField: 'sample_id',
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
