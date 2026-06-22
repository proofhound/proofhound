import { describe, expect, it } from 'vitest';
import { containsStrategy, equalsStrategy, exactMatchStrategy } from './expected-output';

const baseContext = {
  outputSchema: { fields: [{ key: 'label', value: 'positive 或 negative', isJudgment: true }] },
  judgmentRules: { mode: 'exact_match', decision_field: 'label', expected_field: 'expected_output' },
  expectedOutput: 'positive',
};

describe('exactMatchStrategy', () => {
  it('returns correct when parsed.label equals expected', () => {
    const out = exactMatchStrategy.evaluate({ label: 'positive' }, baseContext);
    expect(out).toEqual({ decisionOutput: 'positive', isCorrect: true, judgmentStatus: 'correct' });
  });

  it('returns incorrect with case-insensitive trim', () => {
    const out = exactMatchStrategy.evaluate({ label: 'Negative' }, baseContext);
    expect(out).toEqual({ decisionOutput: 'Negative', isCorrect: false, judgmentStatus: 'incorrect' });
  });

  it('treats a parsed mismatch as normal incorrect instead of a run failure', () => {
    const out = exactMatchStrategy.evaluate({ label: 'bad' }, { ...baseContext, expectedOutput: 'good' });
    expect(out).toEqual({ decisionOutput: 'bad', isCorrect: false, judgmentStatus: 'incorrect' });
  });

  it('returns parse_error when decision field missing', () => {
    const out = exactMatchStrategy.evaluate({ other: 'positive' }, baseContext);
    expect(out.judgmentStatus).toBe('parse_error');
    expect(out.decisionOutput).toBeNull();
  });

  it('returns judge_error when expectedOutput missing', () => {
    const out = exactMatchStrategy.evaluate({ label: 'positive' }, { ...baseContext, expectedOutput: null });
    expect(out.judgmentStatus).toBe('judge_error');
    expect(out.decisionOutput).toBe('positive');
  });

  it('falls back to the outputSchema judgment field when rules omit decisionField', () => {
    const out = exactMatchStrategy.evaluate(
      { sentiment: 'positive' },
      {
        outputSchema: { fields: [{ key: 'sentiment', value: 'positive 或 negative', isJudgment: true }] },
        judgmentRules: { rules: [{ operator: 'exact_match' }] },
        expectedOutput: 'positive',
      },
    );
    expect(out).toEqual({ decisionOutput: 'positive', isCorrect: true, judgmentStatus: 'correct' });
  });
});

describe('containsStrategy', () => {
  it('returns correct when decision contains expected', () => {
    const out = containsStrategy.evaluate(
      { label: 'this is positive sentiment' },
      { ...baseContext, expectedOutput: 'positive' },
    );
    expect(out.isCorrect).toBe(true);
    expect(out.judgmentStatus).toBe('correct');
  });

  it('returns incorrect when expected substring absent', () => {
    const out = containsStrategy.evaluate({ label: 'neutral mood' }, { ...baseContext, expectedOutput: 'positive' });
    expect(out.isCorrect).toBe(false);
    expect(out.judgmentStatus).toBe('incorrect');
  });
});

describe('equalsStrategy', () => {
  it('returns correct for deep-equal objects', () => {
    const out = equalsStrategy.evaluate(
      { label: { kind: 'positive', score: 0.9 } },
      { ...baseContext, expectedOutput: { kind: 'positive', score: 0.9 } },
    );
    expect(out.isCorrect).toBe(true);
  });

  it('returns incorrect for different shape', () => {
    const out = equalsStrategy.evaluate(
      { label: { kind: 'positive', score: 0.9 } },
      { ...baseContext, expectedOutput: { kind: 'positive', score: 0.7 } },
    );
    expect(out.isCorrect).toBe(false);
  });
});
