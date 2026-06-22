import { describe, expect, it } from 'vitest';
import { evaluateJudgment } from './index';

const baseContext = {
  outputSchema: { fields: [{ key: 'label', value: 'positive 或 negative', isJudgment: true }] },
  judgmentRules: { mode: 'exact_match', decision_field: 'label', expected_field: 'expected_output' },
  expectedOutput: 'positive',
};

describe('evaluateJudgment', () => {
  it('routes classification mode through registry', () => {
    const out = evaluateJudgment('classification', { label: 'positive' }, baseContext);
    expect(out.judgmentStatus).toBe('correct');
  });

  it('falls back to judge_error when project type unsupported', () => {
    const out = evaluateJudgment('generative', { label: 'positive' }, baseContext);
    expect(out.judgmentStatus).toBe('judge_error');
  });

  it('falls back to judge_error when mode unknown but still returns', () => {
    const out = evaluateJudgment('classification', { label: 'positive' }, {
      ...baseContext,
      judgmentRules: { mode: 'unknown_mode' },
    });
    expect(out.judgmentStatus).toBe('correct');
  });

  it('returns parse_error when parsed lacks decision field', () => {
    const out = evaluateJudgment('classification', { other: 'positive' }, baseContext);
    expect(out.judgmentStatus).toBe('parse_error');
  });

  it('infers decision field from outputSchema when judgment rules are empty', () => {
    const out = evaluateJudgment(
      'classification',
      { sentiment: 'negative' },
      {
        outputSchema: { fields: [{ key: 'sentiment', value: 'positive | negative', isJudgment: true }] },
        judgmentRules: { rules: [] },
        expectedOutput: 'negative',
      },
    );

    expect(out).toEqual({ decisionOutput: 'negative', isCorrect: true, judgmentStatus: 'correct' });
  });

  it('reads the prompt-editor rules array shape', () => {
    const out = evaluateJudgment(
      'classification',
      { sentiment: 'positive' },
      {
        outputSchema: { fields: [{ key: 'sentiment', value: 'positive | negative', isJudgment: true }] },
        judgmentRules: {
          rules: [{ field: 'sentiment', operator: 'exact_match', value: 'expected_output' }],
        },
        expectedOutput: 'positive',
      },
    );

    expect(out).toEqual({ decisionOutput: 'positive', isCorrect: true, judgmentStatus: 'correct' });
  });

  it('reads the canonical rules array shape', () => {
    const out = evaluateJudgment(
      'classification',
      { sentiment: 'positive' },
      {
        outputSchema: { fields: [{ key: 'sentiment', value: 'positive | negative', isJudgment: true }] },
        judgmentRules: {
          rules: [{ decisionField: 'sentiment', expectedField: 'gold', operator: 'exact_match' }],
        },
        expectedOutput: 'positive',
      },
    );

    expect(out).toEqual({ decisionOutput: 'positive', isCorrect: true, judgmentStatus: 'correct' });
  });

  it('reads legacy ruleName/config wrappers', () => {
    const out = evaluateJudgment(
      'classification',
      { decision: 'positive' },
      {
        outputSchema: { fields: [{ key: 'decision', value: 'positive | negative', isJudgment: true }] },
        judgmentRules: { ruleName: 'exact_match', expectedField: 'gold', config: { decisionField: 'decision' } },
        expectedOutput: 'positive',
      },
    );

    expect(out).toEqual({ decisionOutput: 'positive', isCorrect: true, judgmentStatus: 'correct' });
  });
});
