// Compares the LLM output against the sample's expected output
// See docs/specs/24-experiments.md §7
import type { JudgmentContext, JudgmentOutcome, JudgmentStrategy } from '../types';
import { readJudgmentDecisionField } from './rule-reader';

const DEFAULT_DECISION_FIELD = 'label';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStringField(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function readDecisionFieldFromOutputSchema(outputSchema: unknown): string | null {
  if (!isRecord(outputSchema)) return null;
  const fields = outputSchema['fields'];
  if (!Array.isArray(fields)) return null;
  const judgmentField = fields.find((field): field is Record<string, unknown> => {
    if (!isRecord(field)) return false;
    return field['isJudgment'] === true || field['is_decision'] === true || field['judgment'] === true;
  });
  return judgmentField ? readStringField(judgmentField, ['key', 'name']) : null;
}

export function extractDecisionValue(parsed: unknown, decisionField: string): string | null {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>)[decisionField];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function readDecisionField(context: JudgmentContext): string {
  return readJudgmentDecisionField(
    context.judgmentRules,
    readDecisionFieldFromOutputSchema(context.outputSchema) ?? DEFAULT_DECISION_FIELD,
  );
}

function normalizeForCompare(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value).trim().toLowerCase();
}

function expectedOutputAsString(context: JudgmentContext): string | null {
  if (context.expectedOutput === undefined || context.expectedOutput === null) return null;
  if (typeof context.expectedOutput === 'string') return context.expectedOutput;
  return String(context.expectedOutput);
}

export const exactMatchStrategy: JudgmentStrategy = {
  projectType: 'classification',
  ruleName: 'exact_match',
  evaluate(parsed, context): JudgmentOutcome {
    const decisionField = readDecisionField(context);
    const decisionOutput = extractDecisionValue(parsed, decisionField);
    if (decisionOutput === null) {
      return { decisionOutput: null, isCorrect: null, judgmentStatus: 'parse_error' };
    }
    const expected = expectedOutputAsString(context);
    if (expected === null) {
      return { decisionOutput, isCorrect: null, judgmentStatus: 'judge_error' };
    }
    const isCorrect = normalizeForCompare(decisionOutput) === normalizeForCompare(expected);
    return { decisionOutput, isCorrect, judgmentStatus: isCorrect ? 'correct' : 'incorrect' };
  },
};

export const containsStrategy: JudgmentStrategy = {
  projectType: 'classification',
  ruleName: 'contains',
  evaluate(parsed, context): JudgmentOutcome {
    const decisionField = readDecisionField(context);
    const decisionOutput = extractDecisionValue(parsed, decisionField);
    if (decisionOutput === null) {
      return { decisionOutput: null, isCorrect: null, judgmentStatus: 'parse_error' };
    }
    const expected = expectedOutputAsString(context);
    if (expected === null) {
      return { decisionOutput, isCorrect: null, judgmentStatus: 'judge_error' };
    }
    const isCorrect = (normalizeForCompare(decisionOutput) ?? '').includes(normalizeForCompare(expected) ?? '');
    return { decisionOutput, isCorrect, judgmentStatus: isCorrect ? 'correct' : 'incorrect' };
  },
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqual(item, b[idx]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).sort();
  const bKeys = Object.keys(bo).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (aKeys.some((k, idx) => k !== bKeys[idx])) return false;
  return aKeys.every((k) => deepEqual(ao[k], bo[k]));
}

export const equalsStrategy: JudgmentStrategy = {
  projectType: 'classification',
  ruleName: 'equals',
  evaluate(parsed, context): JudgmentOutcome {
    const decisionField = readDecisionField(context);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { decisionOutput: null, isCorrect: null, judgmentStatus: 'parse_error' };
    }
    const decisionRaw = (parsed as Record<string, unknown>)[decisionField];
    if (decisionRaw === undefined) {
      return { decisionOutput: null, isCorrect: null, judgmentStatus: 'parse_error' };
    }
    const decisionOutput = extractDecisionValue(parsed, decisionField);
    if (context.expectedOutput === undefined || context.expectedOutput === null) {
      return { decisionOutput, isCorrect: null, judgmentStatus: 'judge_error' };
    }
    const isCorrect = deepEqual(decisionRaw, context.expectedOutput);
    return { decisionOutput, isCorrect, judgmentStatus: isCorrect ? 'correct' : 'incorrect' };
  },
};
