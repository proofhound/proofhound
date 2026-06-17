import { describe, expect, it } from 'vitest';
import type { CanaryReleaseListItemDto, ProductionReleaseListItemDto, ReleaseLineDto } from '@proofhound/shared';
import {
  buildReleaseLines,
  filterReleaseLines,
  getReleaseLineId,
  getReleaseStopConfirmationName,
  getReleaseResultSourceIds,
  mapReleaseLineDtos,
  summarizeReleaseLines,
} from './release-line-model';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const PROMPT_ID = '10000000-0000-4000-8000-000000000001';
const CONNECTOR_ID = '20000000-0000-4000-8000-000000000001';
const MODEL_ID = '30000000-0000-4000-8000-000000000001';
const VERSION_ID = '40000000-0000-4000-8000-000000000001';
const USER_ID = '50000000-0000-4000-8000-000000000001';
const LINE_ID = '90000000-0000-4000-8000-000000000001';

function production(overrides: Partial<ProductionReleaseListItemDto> = {}): ProductionReleaseListItemDto {
  const currentEvent: ProductionReleaseListItemDto['currentEvent'] = {
    id: '60000000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    promptId: PROMPT_ID,
    eventType: 'from_prompt',
    promptVersionId: VERSION_ID,
    modelId: MODEL_ID,
    inputConnectorId: CONNECTOR_ID,
    outputConnectorIds: ['70000000-0000-4000-8000-000000000001'],
    runConfig: { rpmLimit: 100, tpmLimit: 1000, concurrency: 2, temperature: 0.2 },
    variableMapping: { content: 'payload.text', id: 'payload.id' },
    filterRules: null,
    recordMode: 'all',
    recordCategories: [],
    externalIdField: 'payload.id',
    retentionDays: null,
    status: 'running',
    createdBy: USER_ID,
    submitReason: 'ship',
    sourceExperimentId: null,
    sourceCanaryId: null,
    sourceMetricsSnapshot: null,
    promptSnapshot: {},
    promptVersionSnapshot: {},
    rollbackTargetEventId: null,
    controlState: null,
    startedAt: '2026-05-20T00:00:00.000Z',
    finishedAt: null,
    stopReason: null,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:10:00.000Z',
  };

  return {
    promptId: PROMPT_ID,
    promptName: 'risk-judge',
    promptVersionLabel: 'v16',
    aggregateStatus: 'online',
    currentEvent,
    currentEventCreatedAt: currentEvent.createdAt,
    modelName: 'gpt-4o-mini',
    modelProvider: 'openai',
    inputConnectorName: 'risk.app.events',
    inputConnectorType: 'kafka',
    outputConnectors: [{ id: '70000000-0000-4000-8000-000000000001', name: 'risk-out', type: 'kafka' }],
    lastEventType: 'from_prompt',
    onlineDurationMs: 60_000,
    ...overrides,
  };
}

function canary(overrides: Partial<CanaryReleaseListItemDto> = {}): CanaryReleaseListItemDto {
  return {
    id: '80000000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    releaseLineId: LINE_ID,
    name: 'risk-judge-v17',
    description: 'try v17',
    promptVersionId: '40000000-0000-4000-8000-000000000002',
    modelId: MODEL_ID,
    inputConnectorId: CONNECTOR_ID,
    outputConnectorIds: ['70000000-0000-4000-8000-000000000002'],
    status: 'running',
    controlState: null,
    controlStatePayload: null,
    trafficRatio: 0.2,
    trafficMode: 'split',
    runMode: 'manual',
    stopConditions: null,
    recordMode: 'all',
    recordCategories: [],
    filterRules: null,
    variableMapping: [
      { source: 'payload.id', target: 'id', required: true },
      { source: 'payload.text', target: 'content', required: true },
    ],
    outputMapping: [],
    externalIdField: 'payload.id',
    annotationSchema: null,
    storageCategories: [],
    targetDatasetId: null,
    runConfig: { rpmLimit: 100, tpmLimit: 1000, concurrency: 2, temperature: 0.3 },
    totalReceived: 200,
    totalProcessed: 180,
    totalFiltered: 20,
    totalCorrect: 170,
    totalErrors: 10,
    metrics: null,
    startedAt: '2026-05-21T00:00:00.000Z',
    finishedAt: null,
    createdBy: USER_ID,
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T01:00:00.000Z',
    promptId: PROMPT_ID,
    promptName: 'risk-judge',
    promptVersionLabel: 'v17',
    modelName: 'claude-haiku-4-5',
    modelProvider: 'anthropic',
    inputConnectorName: 'risk.app.events',
    inputConnectorType: 'kafka',
    outputConnectors: [{ id: '70000000-0000-4000-8000-000000000002', name: 'canary-mirror', type: 'webhook' }],
    targetDatasetName: null,
    createdByName: 'alice',
    annotationTaskId: null,
    releaseVersionId: null,
    releaseVersionLabel: null,
    annotationProgress: { total: 30, claimed: 5, submitted: 12 },
    quality: null,
    ...overrides,
  };
}

function releaseLineEvent(
  overrides: Partial<NonNullable<ReleaseLineDto['currentProductionEvent']>> = {},
): NonNullable<ReleaseLineDto['currentProductionEvent']> {
  return {
    id: '60000000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    releaseLineId: LINE_ID,
    releaseVersionId: null,
    releaseVersionKind: 'production',
    releaseVersionLabel: 'v1',
    releaseVersionProductionNumber: 1,
    releaseVersionTargetProductionNumber: 1,
    releaseVersionCandidateNumber: null,
    annotationTaskId: null,
    laneType: 'production',
    operation: 'create_production',
    status: 'running',
    terminalReason: null,
    sourceEventId: null,
    sourceLegacySource: null,
    sourceLegacyId: null,
    supersedesEventId: null,
    rollbackTargetEventId: null,
    legacySource: null,
    legacySourceId: null,
    promptId: PROMPT_ID,
    promptName: 'risk-judge',
    promptVersionId: VERSION_ID,
    promptVersionNumber: 1,
    promptVersionLabel: 'v1',
    promptSnapshot: {},
    promptVersionSnapshot: {},
    modelId: MODEL_ID,
    modelName: 'gpt-4o-mini',
    modelProvider: 'openai',
    modelSnapshot: {},
    inputConnectorId: CONNECTOR_ID,
    inputConnectorName: 'risk.app.events',
    inputConnectorType: 'kafka',
    inputConnectorSnapshot: {},
    outputConnectorIds: ['70000000-0000-4000-8000-000000000001'],
    outputConnectors: [{ id: '70000000-0000-4000-8000-000000000001', name: 'risk-out', type: 'kafka' }],
    outputConnectorSnapshots: [],
    trafficMode: 'split',
    trafficRatio: null,
    runConfig: { rpmLimit: 100, tpmLimit: 1000, concurrency: 2, temperature: 0.2 },
    variableMapping: { id: 'payload.id' },
    outputMapping: [{ source: 'decision', target: 'decision' }],
    filterRules: null,
    recordMode: 'all',
    recordCategories: [],
    externalIdField: 'payload.id',
    retentionDays: null,
    sourceExperimentId: null,
    submitReason: 'ship',
    metrics: null,
    totalReceived: 0,
    totalProcessed: 0,
    totalFiltered: 0,
    totalCorrect: 0,
    totalErrors: 0,
    controlState: null,
    controlStatePayload: null,
    startedAt: '2026-05-20T00:00:00.000Z',
    finishedAt: null,
    createdBy: USER_ID,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:10:00.000Z',
    ...overrides,
  };
}

function releaseLineDto(overrides: Partial<ReleaseLineDto> = {}): ReleaseLineDto {
  const production = releaseLineEvent();
  return {
    id: LINE_ID,
    projectId: PROJECT_ID,
    name: 'risk-judge',
    description: null,
    promptId: PROMPT_ID,
    promptName: 'risk-judge',
    promptSnapshot: {},
    inputConnectorId: CONNECTOR_ID,
    inputConnectorName: 'risk.app.events',
    inputConnectorType: 'kafka',
    inputConnectorSnapshot: {},
    status: 'running',
    currentProductionEventId: production.id,
    activeCanaryEventId: null,
    currentProductionEvent: production,
    activeCanaryEvent: null,
    versions: [],
    outputConnectors: production.outputConnectors,
    latestEvent: production,
    createdBy: USER_ID,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:10:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('release line model', () => {
  it('groups production and canary by prompt and upstream connector', () => {
    const historicalCanary = canary({
      id: '80000000-0000-4000-8000-000000000002',
      status: 'completed',
      promptVersionLabel: 'v16.5',
      createdAt: '2026-05-20T22:00:00.000Z',
      updatedAt: '2026-05-20T23:00:00.000Z',
    });
    const currentCanary = canary();
    const lines = buildReleaseLines([production()], [currentCanary, historicalCanary]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: getReleaseLineId(PROMPT_ID, CONNECTOR_ID),
      status: 'running',
      productionVersionLabel: 'v16',
      canaryVersionLabel: 'v17',
      trafficRatio: 0.2,
      totalProcessed: 180,
    });
    expect(lines[0]?.canaryHistory.map((item) => item.id)).toEqual([historicalCanary.id, currentCanary.id]);
    expect(lines[0]?.outputConnectors.map((connector) => connector.name)).toEqual(['risk-out', 'canary-mirror']);
  });

  it('keeps canary-only lines and filters never-deployed production rows out', () => {
    const lines = buildReleaseLines([production({ currentEvent: null, aggregateStatus: 'offline' })], [canary()]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe('running');
    expect(lines[0]?.production).toBeNull();
  });

  it('does not expose completed canaries as the current adjustable candidate', () => {
    const lines = buildReleaseLines(
      [
        production({
          promptVersionLabel: 'v17',
          lastEventType: 'from_canary',
          currentEvent: {
            ...production().currentEvent!,
            eventType: 'from_canary',
            promptVersionId: '40000000-0000-4000-8000-000000000002',
            sourceCanaryId: '80000000-0000-4000-8000-000000000001',
            updatedAt: '2026-05-21T01:05:00.000Z',
          },
        }),
      ],
      [canary({ status: 'completed', trafficRatio: 1, finishedAt: '2026-05-21T01:00:00.000Z' })],
    );

    expect(lines[0]?.status).toBe('running');
    expect(lines[0]?.canary).toBeNull();
    expect(lines[0]?.trafficRatio).toBeNull();
    expect(lines[0]?.canaryHistory).toHaveLength(1);
    expect(lines[0] ? getReleaseResultSourceIds(lines[0]) : []).toEqual(['60000000-0000-4000-8000-000000000001']);
  });

  it('uses only current lane event ids for release run results', () => {
    const historicalCanary = canary({
      id: '80000000-0000-4000-8000-000000000002',
      status: 'completed',
      promptVersionLabel: 'v16.5',
      createdAt: '2026-05-20T22:00:00.000Z',
      updatedAt: '2026-05-20T23:00:00.000Z',
    });
    const currentCanary = canary();
    const promotedProduction = production({
      currentEvent: {
        ...production().currentEvent!,
        sourceCanaryId: historicalCanary.id,
      },
    });
    const [line] = buildReleaseLines([promotedProduction], [historicalCanary, currentCanary]);

    expect(line ? getReleaseResultSourceIds(line) : []).toEqual([
      promotedProduction.currentEvent!.id,
      currentCanary.id,
    ]);
  });

  it('uses the release line name for stop confirmation instead of the promotion event reason', () => {
    const promotedProduction = production({
      currentEvent: {
        ...production().currentEvent!,
        eventType: 'from_canary',
        submitReason: 'promote canary 100%',
      },
    });
    const [line] = buildReleaseLines([promotedProduction], []);

    expect(line ? getReleaseStopConfirmationName({ ...line, label: 'emotion category' }) : '').toBe('emotion category');
  });

  it('summarizes and filters visible release lines', () => {
    const stoppedProduction = production({
      promptId: '10000000-0000-4000-8000-000000000002',
      promptName: 'tag-extract',
      aggregateStatus: 'offline',
      currentEvent: {
        ...production().currentEvent!,
        id: '60000000-0000-4000-8000-000000000002',
        promptId: '10000000-0000-4000-8000-000000000002',
        inputConnectorId: '20000000-0000-4000-8000-000000000002',
        status: 'stopped',
        updatedAt: '2026-05-19T00:00:00.000Z',
      },
      inputConnectorName: 'tag.stream',
    });
    const lines = buildReleaseLines([production(), stoppedProduction], [canary()]);
    const summary = summarizeReleaseLines(lines);

    expect(summary).toMatchObject({
      total: 2,
      running: 1,
      productionCanary: 1,
      stopped: 1,
      totalProcessed: 180,
      totalErrors: 10,
      annotationOpen: 18,
    });
    expect(summary.failureRate).toBeCloseTo(10 / 180);
    expect(filterReleaseLines(lines, 'running', 'risk')).toHaveLength(1);
    expect(filterReleaseLines(lines, 'stopped', 'tag')).toHaveLength(1);
  });

  it('normalizes canonical output mappings before exposing release line views', () => {
    const outputConnectorId = '70000000-0000-4000-8000-000000000001';
    const event: NonNullable<ReleaseLineDto['currentProductionEvent']> = {
      id: '60000000-0000-4000-8000-000000000001',
      projectId: PROJECT_ID,
      releaseLineId: LINE_ID,
      releaseVersionId: null,
      releaseVersionKind: 'production',
      releaseVersionLabel: 'v1',
      releaseVersionProductionNumber: 1,
      releaseVersionTargetProductionNumber: 1,
      releaseVersionCandidateNumber: null,
      annotationTaskId: null,
      laneType: 'production',
      operation: 'create_production',
      status: 'running',
      terminalReason: null,
      sourceEventId: null,
      sourceLegacySource: null,
      sourceLegacyId: null,
      supersedesEventId: null,
      rollbackTargetEventId: null,
      legacySource: null,
      legacySourceId: null,
      promptId: PROMPT_ID,
      promptName: 'risk-judge',
      promptVersionId: VERSION_ID,
      promptVersionNumber: 1,
      promptVersionLabel: 'v1',
      promptSnapshot: {},
      promptVersionSnapshot: {},
      modelId: MODEL_ID,
      modelName: 'gpt-4o-mini',
      modelProvider: 'openai',
      modelSnapshot: {},
      inputConnectorId: CONNECTOR_ID,
      inputConnectorName: 'risk.app.events',
      inputConnectorType: 'kafka',
      inputConnectorSnapshot: {},
      outputConnectorIds: [outputConnectorId],
      outputConnectors: [{ id: outputConnectorId, name: 'risk-out', type: 'kafka' }],
      outputConnectorSnapshots: [],
      trafficMode: 'split',
      trafficRatio: null,
      runConfig: { rpmLimit: 100, tpmLimit: 1000, concurrency: 2, temperature: 0.2 },
      variableMapping: { id: 'payload.id' },
      outputMapping: [
        { source: 'decision', target: 'decision' },
        { source: 'missing-target' },
        null,
        { source: undefined, target: 'bad' },
      ],
      filterRules: null,
      recordMode: 'all',
      recordCategories: [],
      externalIdField: 'payload.id',
      retentionDays: null,
      sourceExperimentId: null,
      submitReason: 'ship',
      metrics: null,
      totalReceived: 0,
      totalProcessed: 0,
      totalFiltered: 0,
      totalCorrect: 0,
      totalErrors: 0,
      controlState: null,
      controlStatePayload: null,
      startedAt: '2026-05-20T00:00:00.000Z',
      finishedAt: null,
      createdBy: USER_ID,
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:10:00.000Z',
    };
    const [line] = mapReleaseLineDtos([
      {
        id: LINE_ID,
        projectId: PROJECT_ID,
        name: 'risk-judge',
        description: null,
        promptId: PROMPT_ID,
        promptName: 'risk-judge',
        promptSnapshot: {},
        inputConnectorId: CONNECTOR_ID,
        inputConnectorName: 'risk.app.events',
        inputConnectorType: 'kafka',
        inputConnectorSnapshot: {},
        status: 'running',
        currentProductionEventId: event.id,
        activeCanaryEventId: null,
        currentProductionEvent: event,
        activeCanaryEvent: null,
        versions: [],
        outputConnectors: event.outputConnectors,
        latestEvent: event,
        createdBy: USER_ID,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:10:00.000Z',
        archivedAt: null,
      },
    ]);

    expect(line?.productionOutputMapping).toEqual([{ source: 'decision', target: 'decision' }]);
  });

  it('aggregates production-only counts into the release line view', () => {
    const [line] = mapReleaseLineDtos([
      releaseLineDto({
        currentProductionEvent: releaseLineEvent({ totalReceived: 500, totalProcessed: 480, totalErrors: 5 }),
        activeCanaryEvent: null,
        activeCanaryEventId: null,
      }),
    ]);

    expect(line?.totalReceived).toBe(500);
    expect(line?.totalProcessed).toBe(480);
    expect(line?.totalErrors).toBe(5);
    expect(summarizeReleaseLines(line ? [line] : [])).toMatchObject({
      totalProcessed: 480,
      totalErrors: 5,
    });
  });

  it('aggregates canary-only counts when there is no production event', () => {
    const canaryEvent = releaseLineEvent({
      id: '60000000-0000-4000-8000-000000000002',
      laneType: 'canary',
      releaseVersionKind: 'candidate',
      operation: 'create_canary',
      totalReceived: 200,
      totalProcessed: 180,
      totalErrors: 10,
    });
    const [line] = mapReleaseLineDtos([
      releaseLineDto({
        currentProductionEvent: null,
        currentProductionEventId: null,
        activeCanaryEvent: canaryEvent,
        activeCanaryEventId: canaryEvent.id,
        latestEvent: canaryEvent,
      }),
    ]);

    expect(line?.totalReceived).toBe(200);
    expect(line?.totalProcessed).toBe(180);
    expect(line?.totalErrors).toBe(10);
  });

  it('sums production and canary counts when both lanes are present', () => {
    const canaryEvent = releaseLineEvent({
      id: '60000000-0000-4000-8000-000000000002',
      laneType: 'canary',
      releaseVersionKind: 'candidate',
      operation: 'create_canary',
      totalReceived: 200,
      totalProcessed: 180,
      totalErrors: 10,
    });
    const [line] = mapReleaseLineDtos([
      releaseLineDto({
        currentProductionEvent: releaseLineEvent({ totalReceived: 500, totalProcessed: 480, totalErrors: 5 }),
        activeCanaryEvent: canaryEvent,
        activeCanaryEventId: canaryEvent.id,
      }),
    ]);

    expect(line?.totalReceived).toBe(700);
    expect(line?.totalProcessed).toBe(660);
    expect(line?.totalErrors).toBe(15);
    expect(summarizeReleaseLines(line ? [line] : [])).toMatchObject({
      totalProcessed: 660,
      totalErrors: 15,
    });
  });
});
