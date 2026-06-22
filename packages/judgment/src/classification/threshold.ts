// Threshold judgment: treats the judgment field as a number and compares it against judgment_rules.threshold
// See docs/specs/24-experiments.md §7
import type { JudgmentOutcome, JudgmentStrategy } from '../types';
import { extractDecisionValue, readDecisionField } from './expected-output';
import { normalizeJudgmentRules } from './rule-reader';

type ThresholdOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

function readOperator(rules: unknown): ThresholdOperator {
  const rule = normalizeJudgmentRules(rules)?.rules[0];
  if (rule) {
    const op = rule['thresholdOperator'] ?? rule['comparisonOperator'];
    if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte' || op === 'eq') return op;
  }
  return 'gte';
}

function readThreshold(rules: unknown): number | null {
  const rule = normalizeJudgmentRules(rules)?.rules[0];
  if (rule) {
    const raw = rule['threshold'];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export const thresholdStrategy: JudgmentStrategy = {
  projectType: 'classification',
  ruleName: 'threshold',
  evaluate(parsed, context): JudgmentOutcome {
    const decisionField = readDecisionField(context);
    const decisionOutput = extractDecisionValue(parsed, decisionField);
    if (decisionOutput === null) {
      return { decisionOutput: null, isCorrect: null, judgmentStatus: 'parse_error' };
    }
    const decisionNumber =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? toNumber((parsed as Record<string, unknown>)[decisionField])
        : null;
    if (decisionNumber === null) {
      return { decisionOutput, isCorrect: null, judgmentStatus: 'parse_error' };
    }
    const threshold = readThreshold(context.judgmentRules);
    if (threshold === null) {
      return { decisionOutput, isCorrect: null, judgmentStatus: 'judge_error' };
    }
    const operator = readOperator(context.judgmentRules);
    const isCorrect =
      operator === 'gt'
        ? decisionNumber > threshold
        : operator === 'gte'
          ? decisionNumber >= threshold
          : operator === 'lt'
            ? decisionNumber < threshold
            : operator === 'lte'
              ? decisionNumber <= threshold
              : decisionNumber === threshold;
    return { decisionOutput, isCorrect, judgmentStatus: isCorrect ? 'correct' : 'incorrect' };
  },
};
