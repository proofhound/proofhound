import { describe, expect, it } from 'vitest';
import type { CanaryReleaseListItemDto, ProductionReleaseListItemDto } from '@proofhound/shared';
import {
  buildReleaseLines,
  filterReleaseLines,
  getReleaseLineId,
  getReleaseStopConfirmationName,
  getReleaseResultSourceIds,
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
    releaseVariantId: null,
    releaseVariantNumber: null,
    releaseVariantLabel: null,
    annotationProgress: { total: 30, claimed: 5, submitted: 12 },
    quality: null,
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
      status: 'production_canary',
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
    expect(lines[0]?.status).toBe('canary');
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

    expect(lines[0]?.status).toBe('production');
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

    expect(line ? getReleaseStopConfirmationName({ ...line, label: 'emotion category' }) : '').toBe(
      'emotion category',
    );
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
      productionCanary: 1,
      stopped: 1,
      totalProcessed: 180,
      totalErrors: 10,
      annotationOpen: 18,
    });
    expect(summary.failureRate).toBeCloseTo(10 / 180);
    expect(filterReleaseLines(lines, 'production_canary', 'risk')).toHaveLength(1);
    expect(filterReleaseLines(lines, 'stopped', 'tag')).toHaveLength(1);
  });
});
