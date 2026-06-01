import { computeMetrics, type ClassificationAggregateRow } from '@proofhound/metrics';
import type { ExperimentMetricsDto } from '@proofhound/shared';

export interface AggregateMetricsResult {
  metrics: ExperimentMetricsDto;
  totalCount: number;
  failedCount: number;
}

export interface ExperimentLatencyAggregate {
  averageMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

export function aggregateExperimentMetrics(
  rows: ClassificationAggregateRow[],
  latency?: ExperimentLatencyAggregate,
): AggregateMetricsResult {
  const latencyFields = {
    averageLatencyMs: latency?.averageMs ?? null,
    p50LatencyMs: latency?.p50Ms ?? null,
    p95LatencyMs: latency?.p95Ms ?? null,
  };
  const computed = computeMetrics('classification', rows);
  if (!computed) {
    if (latency && (latency.averageMs !== null || latency.p50Ms !== null || latency.p95Ms !== null)) {
      return { metrics: { ...latencyFields }, totalCount: 0, failedCount: 0 };
    }
    return { metrics: null, totalCount: 0, failedCount: 0 };
  }
  const metrics: ExperimentMetricsDto = {
    accuracy: computed.accuracy,
    precision: computed.macroPrecision,
    recall: computed.macroRecall,
    f1: computed.macroF1,
    perClass: computed.perClass.map((entry) => ({
      label: entry.label,
      precision: entry.precision,
      recall: entry.recall,
      f1: entry.f1,
      support: entry.support,
      tp: entry.tp,
      fn: entry.fn,
    })),
    inputTokens: computed.inputTokens,
    outputTokens: computed.outputTokens,
    costEstimate: computed.costEstimate,
    ...latencyFields,
  };
  return { metrics, totalCount: computed.total, failedCount: computed.failed };
}
