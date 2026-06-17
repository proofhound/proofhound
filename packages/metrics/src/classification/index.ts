// V1 classification metric aggregation — accuracy / precision / recall / F1 / per-class
// See docs/specs/24-experiments.md §6 + docs/specs/07-code-structure.md §12.2
import { registerMetric } from '../registry';
import type { ClassificationAggregateRow, ClassificationMetrics } from '../types';
import { accuracyStrategy, computeAccuracy } from './accuracy';
import { computeF1, f1Strategy } from './f1';
import { computePerClassConfusion, perClassStrategy } from './per-class';
import { computePrecisionRecall, precisionRecallStrategy } from './precision-recall';

registerMetric(accuracyStrategy);
registerMetric(perClassStrategy);
registerMetric(precisionRecallStrategy);
registerMetric(f1Strategy);

export function computeClassificationMetrics(rows: ClassificationAggregateRow[]): ClassificationMetrics {
  const { accuracy, correct, total } = computeAccuracy(rows);
  const confusion = computePerClassConfusion(rows);
  const { perClass: prEntries, macroPrecision, macroRecall } = computePrecisionRecall(confusion);
  const { perClass, macroF1 } = computeF1(prEntries);

  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costEstimate = 0;
  for (const row of rows) {
    if (isRunResultFailure(row)) failed += row.count;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    costEstimate += row.costEstimate;
  }

  return {
    total,
    correct,
    failed,
    accuracy,
    macroPrecision,
    macroRecall,
    macroF1,
    perClass,
    inputTokens,
    outputTokens,
    costEstimate,
  };
}

export { accuracyStrategy, computeAccuracy } from './accuracy';
export { computeF1, f1Strategy } from './f1';
export { computePerClassConfusion, perClassStrategy } from './per-class';
export { computePrecisionRecall, precisionRecallStrategy } from './precision-recall';

function isRunResultFailure(row: ClassificationAggregateRow): boolean {
  return (
    row.status === 'failed' ||
    row.judgmentStatus === 'parse_error' ||
    (row.judgmentStatus === 'judge_error' && row.expectedOutput !== null)
  );
}
