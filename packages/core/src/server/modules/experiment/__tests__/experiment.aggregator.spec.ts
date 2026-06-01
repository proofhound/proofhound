import { aggregateExperimentMetrics } from '../experiment.aggregator';

describe('aggregateExperimentMetrics', () => {
  it('maps classification metrics into ExperimentMetricsDto shape', () => {
    const result = aggregateExperimentMetrics([
      {
        decisionOutput: 'positive',
        expectedOutput: 'positive',
        judgmentStatus: 'correct',
        status: 'success',
        count: 4,
        inputTokens: 200,
        outputTokens: 50,
        costEstimate: 0.02,
      },
      {
        decisionOutput: 'negative',
        expectedOutput: 'negative',
        judgmentStatus: 'correct',
        status: 'success',
        count: 3,
        inputTokens: 150,
        outputTokens: 40,
        costEstimate: 0.018,
      },
      {
        decisionOutput: 'positive',
        expectedOutput: 'negative',
        judgmentStatus: 'incorrect',
        status: 'success',
        count: 1,
        inputTokens: 80,
        outputTokens: 20,
        costEstimate: 0.008,
      },
      {
        decisionOutput: null,
        expectedOutput: 'negative',
        judgmentStatus: null,
        status: 'error',
        count: 1,
        inputTokens: 0,
        outputTokens: 0,
        costEstimate: 0,
      },
      {
        decisionOutput: null,
        expectedOutput: 'negative',
        judgmentStatus: 'parse_error',
        status: 'success',
        count: 2,
        inputTokens: 20,
        outputTokens: 2,
        costEstimate: 0.002,
      },
      {
        decisionOutput: null,
        expectedOutput: 'negative',
        judgmentStatus: 'judge_error',
        status: 'success',
        count: 1,
        inputTokens: 10,
        outputTokens: 1,
        costEstimate: 0.001,
      },
    ]);

    expect(result.totalCount).toBe(12);
    expect(result.failedCount).toBe(4);
    expect(result.metrics).not.toBeNull();
    const metrics = result.metrics!;
    expect(metrics.accuracy).toBeCloseTo(7 / 12);
    expect(metrics.inputTokens).toBe(460);
    expect(metrics.outputTokens).toBe(113);
    expect(metrics.costEstimate).toBeCloseTo(0.049);
    expect(metrics.perClass).toHaveLength(2);
    const labels = metrics.perClass?.map((entry) => entry.label).sort();
    expect(labels).toEqual(['negative', 'positive']);
    // tp / fn must be exposed; the frontend Confusion MiniBar depends on these two fields
    for (const entry of metrics.perClass ?? []) {
      expect(typeof entry.tp).toBe('number');
      expect(typeof entry.fn).toBe('number');
      expect(entry.support).toBe((entry.tp ?? 0) + (entry.fn ?? 0));
    }
    // When latency is not provided, all three fields should be null
    expect(metrics.averageLatencyMs).toBeNull();
    expect(metrics.p50LatencyMs).toBeNull();
    expect(metrics.p95LatencyMs).toBeNull();
  });

  it('returns null metrics when input is empty', () => {
    const result = aggregateExperimentMetrics([]);
    expect(result.totalCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.metrics?.accuracy).toBeNull();
    expect(result.metrics?.inputTokens).toBe(0);
  });

  it('merges latency aggregate into metrics output', () => {
    const result = aggregateExperimentMetrics(
      [
        {
          decisionOutput: 'positive',
          expectedOutput: 'positive',
          judgmentStatus: 'correct',
          status: 'success',
          count: 2,
          inputTokens: 10,
          outputTokens: 5,
          costEstimate: 0.001,
        },
      ],
      { averageMs: 1500, p50Ms: 1200, p95Ms: 3800 },
    );
    expect(result.metrics?.averageLatencyMs).toBe(1500);
    expect(result.metrics?.p50LatencyMs).toBe(1200);
    expect(result.metrics?.p95LatencyMs).toBe(3800);
  });
});
