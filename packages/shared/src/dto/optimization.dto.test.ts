import { describe, expect, it } from 'vitest';
import {
  optimizationListQuerySchema,
  optimizationLoopLimitsSchema,
  optimizationBestMetricsSchema,
  createOptimizationSchema,
} from './optimization.dto';

const validBase = {
  name: 'iter-x',
  strategy: 'error_pattern_analysis',
  startingMode: 'from_dataset_only' as const,
  datasetId: 'c1111111-1111-4111-8111-111111111111',
  experimentModelId: 'd1111111-1111-4111-8111-111111111111',
  analysisModelId: 'd2222222-2222-4222-8222-222222222222',
  goals: [{ metric: 'accuracy' as const, comparator: 'gte' as const, target: 0.8, scope: 'overall' }],
  loopLimits: { maxRounds: 5, stopAfterNoImprovementRounds: 0 },
};

describe('optimizationLoopLimitsSchema', () => {
  it('accepts stopAfterNoImprovementRounds = 0 (no-limit sentinel)', () => {
    expect(() => optimizationLoopLimitsSchema.parse({ maxRounds: 5, stopAfterNoImprovementRounds: 0 })).not.toThrow();
  });

  it('rejects negative stopAfterNoImprovementRounds', () => {
    expect(() => optimizationLoopLimitsSchema.parse({ maxRounds: 5, stopAfterNoImprovementRounds: -1 })).toThrow();
  });

  it('rejects regressionThresholdPp (field removed)', () => {
    const parsed = optimizationLoopLimitsSchema.parse({
      maxRounds: 5,
      stopAfterNoImprovementRounds: 2,
      regressionThresholdPp: 3,
    });
    expect('regressionThresholdPp' in parsed).toBe(false);
  });
});

describe('optimizationBestMetricsSchema', () => {
  it('accepts overall metrics plus per-class rows', () => {
    expect(
      optimizationBestMetricsSchema.parse({
        precision: 0.5,
        perClass: [{ label: 'good', precision: 0.875, recall: 0.9 }],
      }),
    ).toEqual({
      precision: 0.5,
      perClass: [{ label: 'good', precision: 0.875, recall: 0.9 }],
    });
  });
});

describe('createOptimizationSchema', () => {
  it('accepts experimentModelId and rejects taskModelId', () => {
    const parsed = createOptimizationSchema.parse(validBase);
    expect(parsed.experimentModelId).toBe(validBase.experimentModelId);
  });

  it('forwards strategyConfig for from_dataset_only sampling params', () => {
    const parsed = createOptimizationSchema.parse({
      ...validBase,
      strategyConfig: { initialSamplingRounds: 2, initialSamplesPerRound: 30 },
    });
    expect(parsed.strategyConfig).toEqual({ initialSamplingRounds: 2, initialSamplesPerRound: 30 });
  });

  it('trims optional optimizationHint and enforces the length cap', () => {
    const parsed = createOptimizationSchema.parse({
      ...validBase,
      optimizationHint: '  保持提示词简洁  ',
    });
    expect(parsed.optimizationHint).toBe('保持提示词简洁');
    expect(() => createOptimizationSchema.parse({ ...validBase, optimizationHint: 'x'.repeat(4001) })).toThrow();
  });

  it('rejects unsupported optimization goal metrics on create', () => {
    for (const metric of ['f1', 'fpr']) {
      expect(() =>
        createOptimizationSchema.parse({
          ...validBase,
          goals: [{ metric, comparator: 'gte', target: 0.8, scope: 'overall' }],
        }),
      ).toThrow();
    }
  });

  it('rejects class-scoped accuracy goals on create', () => {
    expect(() =>
      createOptimizationSchema.parse({
        ...validBase,
        goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'good' }],
      }),
    ).toThrow(/class_goal_metric_unsupported/);

    expect(
      createOptimizationSchema.parse({
        ...validBase,
        goals: [{ metric: 'precision', comparator: 'gte', target: 0.8, scope: 'good' }],
      }).goals[0],
    ).toEqual({ metric: 'precision', comparator: 'gte', target: 0.8, scope: 'good' });
  });
});

describe('optimizationListQuerySchema', () => {
  it('accepts updated as the default list sort key', () => {
    expect(optimizationListQuerySchema.parse({ sort: 'updated' })).toEqual({ sort: 'updated' });
  });
});
