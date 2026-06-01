import type { OptimizationListItemDto } from '@proofhound/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  getOptimizationDetailQueryKey,
  getOptimizationListQueryKey,
  handleOptimizationCreated,
} from './optimization';

vi.mock('@proofhound/api-client', () => ({
  optimizationClient: {},
}));

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OPTIMIZATION_ID = '11111111-1111-4111-8111-111111111111';

function createdOptimization(overrides: Partial<OptimizationListItemDto> = {}): OptimizationListItemDto {
  return {
    id: OPTIMIZATION_ID,
    projectId: PROJECT_ID,
    name: 'iter-alpha',
    description: null,
    strategy: 'error_pattern_analysis',
    promptLanguage: 'zh-CN',
    startingMode: 'from_experiment',
    status: 'running',
    controlState: null,
    sourceExperimentId: '33333333-3333-4333-8333-333333333333',
    sourceExperimentName: 'exp-baseline',
    promptId: null,
    promptName: null,
    baseVersionId: null,
    baseVersionNumber: null,
    datasetId: '44444444-4444-4444-8444-444444444444',
    datasetName: 'risk-eval',
    datasetSamples: 1200,
    experimentModelId: '55555555-5555-4555-8555-555555555555',
    experimentModelName: 'gpt-4o-mini',
    analysisModelId: '66666666-6666-4666-8666-666666666666',
    analysisModelName: 'gpt-4o',
    goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'overall' }],
    fieldWhitelist: null,
    runConfig: {},
    maxRounds: 10,
    currentRound: 0,
    bestVersionId: null,
    bestVersionNumber: null,
    bestMetrics: null,
    trend: null,
    summary: null,
    analysisFailureReason: null,
    dbosWorkflowId: null,
    createdBy: '77777777-7777-4777-8777-777777777777',
    createdByDisplayName: 'ZiqiXiao',
    createdByUsername: 'ziqixiao',
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-05-18T08:00:00.000Z',
    updatedAt: '2026-05-18T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('handleOptimizationCreated', () => {
  it('invalidates list cache without seeding detail cache with a list item', async () => {
    const queryClient = new QueryClient();
    const listKey = getOptimizationListQueryKey(PROJECT_ID);
    const detailKey = getOptimizationDetailQueryKey(PROJECT_ID, OPTIMIZATION_ID);

    queryClient.setQueryData(listKey, { data: [], total: 0 });

    await handleOptimizationCreated(queryClient, PROJECT_ID, createdOptimization());

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
  });
});
