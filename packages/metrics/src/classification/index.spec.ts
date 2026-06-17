import { describe, expect, it } from 'vitest';
import type { ClassificationAggregateRow } from '../types';
import { computeAccuracy } from './accuracy';
import { computeClassificationMetrics } from './index';
import { computePerClassConfusion } from './per-class';
import { computePrecisionRecall } from './precision-recall';
import { computeF1 } from './f1';

function row(partial: Partial<ClassificationAggregateRow>): ClassificationAggregateRow {
  return {
    decisionOutput: null,
    expectedOutput: null,
    judgmentStatus: null,
    status: 'success',
    count: 1,
    inputTokens: 0,
    outputTokens: 0,
    costEstimate: 0,
    ...partial,
  };
}

describe('computeAccuracy', () => {
  it('returns null on empty input', () => {
    expect(computeAccuracy([])).toEqual({ accuracy: null, correct: 0, total: 0 });
  });

  it('counts only success+correct rows as correct', () => {
    const rows = [
      row({ status: 'success', judgmentStatus: 'correct', count: 3 }),
      row({ status: 'success', judgmentStatus: 'incorrect', count: 1 }),
      row({ status: 'failed', count: 1 }),
    ];
    expect(computeAccuracy(rows)).toEqual({ accuracy: 3 / 5, correct: 3, total: 5 });
  });
});

describe('computePerClassConfusion', () => {
  it('builds tp/fp/fn buckets', () => {
    const rows = [
      row({ status: 'success', judgmentStatus: 'correct', decisionOutput: 'A', expectedOutput: 'A', count: 5 }),
      row({ status: 'success', judgmentStatus: 'correct', decisionOutput: 'B', expectedOutput: 'B', count: 3 }),
      row({ status: 'success', judgmentStatus: 'incorrect', decisionOutput: 'A', expectedOutput: 'B', count: 2 }),
      row({ status: 'success', judgmentStatus: 'incorrect', decisionOutput: 'B', expectedOutput: 'A', count: 1 }),
    ];
    const confusion = computePerClassConfusion(rows);
    expect(confusion).toEqual({
      A: { tp: 5, fp: 2, fn: 1, support: 6 },
      B: { tp: 3, fp: 1, fn: 2, support: 5 },
    });
  });

  it('skips parse_error and judge_error rows', () => {
    const rows = [
      row({ status: 'success', judgmentStatus: 'parse_error', decisionOutput: 'A', count: 2 }),
      row({ status: 'success', judgmentStatus: 'judge_error', decisionOutput: null, count: 1 }),
    ];
    expect(computePerClassConfusion(rows)).toEqual({});
  });
});

describe('computePrecisionRecall + computeF1', () => {
  it('computes macro averages', () => {
    const confusion = {
      A: { tp: 5, fp: 2, fn: 1, support: 6 },
      B: { tp: 3, fp: 1, fn: 2, support: 5 },
    };
    const { perClass, macroPrecision, macroRecall } = computePrecisionRecall(confusion);
    expect(perClass).toHaveLength(2);
    const entryA = perClass.find((e) => e.label === 'A')!;
    expect(entryA.precision).toBeCloseTo(5 / 7);
    expect(entryA.recall).toBeCloseTo(5 / 6);
    expect(macroPrecision).toBeCloseTo((5 / 7 + 3 / 4) / 2);
    expect(macroRecall).toBeCloseTo((5 / 6 + 3 / 5) / 2);

    const { perClass: f1Entries, macroF1 } = computeF1(perClass);
    const f1A = f1Entries.find((e) => e.label === 'A')!.f1!;
    expect(f1A).toBeCloseTo((2 * (5 / 7) * (5 / 6)) / (5 / 7 + 5 / 6));
    expect(macroF1).not.toBeNull();
  });
});

describe('computeClassificationMetrics', () => {
  it('sums tokens and cost across all rows including failures', () => {
    const rows = [
      row({
        status: 'success',
        judgmentStatus: 'correct',
        decisionOutput: 'A',
        expectedOutput: 'A',
        count: 2,
        inputTokens: 100,
        outputTokens: 20,
        costEstimate: 0.01,
      }),
      row({ status: 'failed', count: 1, inputTokens: 50, outputTokens: 0, costEstimate: 0.005 }),
      row({
        status: 'success',
        judgmentStatus: 'parse_error',
        count: 2,
        inputTokens: 20,
        outputTokens: 2,
        costEstimate: 0.002,
      }),
      row({
        status: 'success',
        judgmentStatus: 'judge_error',
        expectedOutput: null,
        count: 1,
        inputTokens: 10,
        outputTokens: 1,
        costEstimate: 0.001,
      }),
      row({
        status: 'success',
        judgmentStatus: 'judge_error',
        expectedOutput: 'A',
        count: 1,
        inputTokens: 10,
        outputTokens: 1,
        costEstimate: 0.001,
      }),
    ];
    const metrics = computeClassificationMetrics(rows);
    expect(metrics.total).toBe(7);
    expect(metrics.correct).toBe(2);
    expect(metrics.failed).toBe(4);
    expect(metrics.accuracy).toBeCloseTo(2 / 7);
    expect(metrics.inputTokens).toBe(190);
    expect(metrics.outputTokens).toBe(24);
    expect(metrics.costEstimate).toBeCloseTo(0.019);
  });
});
