// MetricsStrategy interface — see docs/specs/07-code-structure.md §12.2
export type ProjectType = 'classification' | 'generative' | 'agent';

export type JudgmentStatus = 'correct' | 'incorrect' | 'parse_error' | 'judge_error';
export type RunStatus = 'running' | 'success' | 'failed';

/** One row of SQL aggregation output — already bucketed by (decisionOutput, expectedOutput, judgmentStatus, status) */
export interface ClassificationAggregateRow {
  decisionOutput: string | null;
  expectedOutput: string | null;
  judgmentStatus: JudgmentStatus | null;
  status: RunStatus;
  count: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
}

export interface ClassificationPerClassEntry {
  label: string;
  tp: number;
  fp: number;
  fn: number;
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ClassificationMetrics {
  total: number;
  correct: number;
  failed: number;
  accuracy: number | null;
  macroPrecision: number | null;
  macroRecall: number | null;
  macroF1: number | null;
  perClass: ClassificationPerClassEntry[];
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
}

export interface MetricsStrategy {
  projectType: ProjectType;
  metricName: string;
  compute(rows: ClassificationAggregateRow[]): unknown;
}
