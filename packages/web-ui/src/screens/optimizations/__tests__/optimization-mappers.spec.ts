import type { OptimizationListItemDto } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import { mapDtoToSummary } from '../optimization-mappers';

function baseDto(overrides: Partial<OptimizationListItemDto> = {}): OptimizationListItemDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    name: 'iter-alpha',
    description: 'fixture',
    strategy: 'error_pattern_analysis',
    promptLanguage: 'zh-CN',
    startingMode: 'from_experiment',
    status: 'running',
    objectiveStatus: 'pending',
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
    stopAfterNoImprovementRounds: 0,
    currentRound: 3,
    bestVersionId: null,
    bestVersionNumber: null,
    bestMetrics: null,
    summary: null,
    analysisFailureReason: null,
    dbosWorkflowId: null,
    createdBy: '77777777-7777-4777-8777-777777777777',
    createdByDisplayName: 'ZiqiXiao',
    createdByUsername: 'ziqixiao',
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-05-18T08:00:00.000Z',
    updatedAt: '2026-05-18T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('mapDtoToSummary', () => {
  it('maps from_experiment starting mode to origin=experiment with source experiment name', () => {
    const summary = mapDtoToSummary(baseDto());

    expect(summary.origin).toBe('experiment');
    expect(summary.originRef).toBe('exp-baseline');
    expect(summary.originHref).toBe('/experiments/33333333-3333-4333-8333-333333333333');
  });

  it('maps from_prompt_version starting mode to origin=prompt with prompt name and version link', () => {
    const summary = mapDtoToSummary(
      baseDto({
        startingMode: 'from_prompt_version',
        sourceExperimentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourceExperimentName: 'later-generated-experiment',
        promptId: '88888888-8888-4888-8888-888888888888',
        promptName: 'risk-judge',
        baseVersionId: '99999999-9999-4999-8999-999999999999',
        baseVersionNumber: 2,
      }),
    );

    expect(summary.origin).toBe('prompt');
    expect(summary.originRef).toBe('risk-judge · v2');
    expect(summary.originHref).toBe(
      '/prompts/88888888-8888-4888-8888-888888888888?version=99999999-9999-4999-8999-999999999999',
    );
  });

  it('maps from_dataset_only starting mode to origin=dataset with dataset name', () => {
    const summary = mapDtoToSummary(
      baseDto({
        startingMode: 'from_dataset_only',
        sourceExperimentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourceExperimentName: 'later-generated-experiment',
      }),
    );

    expect(summary.origin).toBe('dataset');
    expect(summary.originRef).toBe('risk-eval');
    expect(summary.originHref).toBe('/datasets/44444444-4444-4444-8444-444444444444');
  });

  it('carries objective stop summary fields for list badges', () => {
    const summary = mapDtoToSummary(
      baseDto({
        status: 'success',
        objectiveStatus: 'not_met',
        stopAfterNoImprovementRounds: 2,
        summary: {
          kind: 'success',
          reason: 'no_improvement',
          finalizedAt: '2026-05-18T10:00:00.000Z',
        },
      }),
    );

    expect(summary.objectiveStatus).toBe('not_met');
    expect(summary.stopAfterNoImprovementRounds).toBe(2);
    expect(summary.summary?.reason).toBe('no_improvement');
  });

  it('treats all-overall goals as goalScope.kind=overall', () => {
    const summary = mapDtoToSummary(
      baseDto({
        goals: [
          { metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'overall' },
          { metric: 'recall', comparator: 'gte', target: 0.75, scope: 'overall' },
        ],
      }),
    );

    expect(summary.goalScope).toEqual({ kind: 'overall' });
  });

  it('derives goalScope.kind=class with unique class labels when scopes include classes', () => {
    const summary = mapDtoToSummary(
      baseDto({
        goals: [
          { metric: 'accuracy', comparator: 'gte', target: 0.85, scope: 'high' },
          { metric: 'recall', comparator: 'gte', target: 0.8, scope: 'high' },
          { metric: 'recall', comparator: 'gte', target: 0.75, scope: 'mid' },
        ],
      }),
    );

    expect(summary.goalScope.kind).toBe('class');
    expect(summary.goalScope.classes).toEqual(['high', 'mid']);
  });

  it('maps comparator gte/gt/lte to >=/>/<=', () => {
    const summary = mapDtoToSummary(
      baseDto({
        goals: [
          { metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'overall' },
          { metric: 'precision', comparator: 'gt', target: 0.75, scope: 'overall' },
          { metric: 'fpr', comparator: 'lte', target: 0.1, scope: 'overall' },
        ],
      }),
    );

    expect(summary.goals.map((goal) => goal.comparator)).toEqual(['>=', '>', '<=']);
  });

  it('populates goal.current and bestMetricValue from bestMetrics when available', () => {
    const summary = mapDtoToSummary(
      baseDto({
        goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'overall' }],
        bestMetrics: { accuracy: 0.842 },
      }),
    );

    expect(summary.goals[0]?.current).toBeCloseTo(0.842);
    expect(summary.goals[0]?.status).toBe('hit');
    expect(summary.bestMetricLabel).toBe('accuracy');
    expect(summary.bestMetricValue).toBeCloseTo(0.842);
  });

  it('reads class-scoped best metrics from perClass rows', () => {
    const summary = mapDtoToSummary(
      baseDto({
        goals: [{ metric: 'precision', comparator: 'gte', target: 0.8, scope: 'good' }],
        bestMetrics: {
          precision: 0.5,
          perClass: [
            { label: 'bad', precision: 0.3 },
            { label: 'good', precision: 0.875 },
          ],
        },
      }),
    );

    expect(summary.goals[0]?.current).toBeCloseTo(0.875);
    expect(summary.goals[0]?.status).toBe('hit');
    expect(summary.bestMetricLabel).toBe('good · precision');
    expect(summary.bestMetricValue).toBeCloseTo(0.875);
  });

  it('leaves goal.current undefined and bestMetricValue undefined when bestMetrics missing the key', () => {
    const summary = mapDtoToSummary(
      baseDto({
        goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'overall' }],
        bestMetrics: null,
      }),
    );

    expect(summary.goals[0]?.current).toBeUndefined();
    expect(summary.goals[0]?.status).toBe('miss');
    expect(summary.bestMetricValue).toBeUndefined();
  });

  it('never populates trend or bestMetricDelta and defaults description to empty string', () => {
    const summary = mapDtoToSummary(baseDto({ description: null }));

    expect(summary.trend).toBeUndefined();
    expect(summary.bestMetricDelta).toBeUndefined();
    expect(summary.description).toBe('');
  });

  it('falls back to dataset name when source experiment + prompt names are absent', () => {
    const summary = mapDtoToSummary(
      baseDto({
        startingMode: 'from_dataset_only',
        sourceExperimentId: null,
        sourceExperimentName: null,
        promptId: null,
        promptName: null,
      }),
    );

    expect(summary.originRef).toBe('risk-eval');
  });
});
