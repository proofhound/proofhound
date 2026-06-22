import { describe, expect, it } from 'vitest';
import {
  normalizePromptJudgmentRules,
  promptVersionLabelNameSchema,
  readPromptJudgmentDecisionField,
  readPromptJudgmentExpectedField,
} from './prompt.dto';

describe('promptVersionLabelNameSchema', () => {
  it('accepts Chinese prompt version labels', () => {
    expect(promptVersionLabelNameSchema.safeParse('回归集').success).toBe(true);
    expect(promptVersionLabelNameSchema.safeParse('客户A:灰度-1').success).toBe(true);
  });

  it('keeps rejecting labels with unsupported separators or leading punctuation', () => {
    expect(promptVersionLabelNameSchema.safeParse('灰度 发布').success).toBe(false);
    expect(promptVersionLabelNameSchema.safeParse('-灰度').success).toBe(false);
  });
});

describe('prompt judgment rules normalization', () => {
  it('keeps canonical decisionField and expectedField rules', () => {
    expect(
      normalizePromptJudgmentRules({
        rules: [{ decisionField: 'label', expectedField: 'gold', operator: 'exact_match' }],
      }),
    ).toEqual({
      rules: [{ decisionField: 'label', expectedField: 'gold', operator: 'exact_match' }],
    });
  });

  it('normalizes top-level snake_case aliases into one canonical rule', () => {
    expect(
      normalizePromptJudgmentRules({
        mode: 'contains',
        decision_field: 'answer',
        expected_field: 'expected_answer',
      }),
    ).toEqual({
      rules: [{ decisionField: 'answer', expectedField: 'expected_answer', operator: 'contains' }],
    });
  });

  it('normalizes first-rule field and value aliases', () => {
    expect(
      normalizePromptJudgmentRules({
        rules: [{ field: 'label', value: 'gold_label', operator: 'exact_match' }],
      }),
    ).toEqual({
      rules: [{ decisionField: 'label', expectedField: 'gold_label', operator: 'exact_match' }],
    });
  });

  it('reads legacy ruleName/config wrappers', () => {
    const rules = { ruleName: 'exact_match', expectedField: 'expected', config: { decisionField: 'decision' } };
    expect(readPromptJudgmentDecisionField(rules)).toBe('decision');
    expect(readPromptJudgmentExpectedField(rules)).toBe('expected');
    expect(normalizePromptJudgmentRules(rules)).toEqual({
      rules: [{ decisionField: 'decision', expectedField: 'expected', operator: 'exact_match' }],
    });
  });

  it('uses caller fallbacks when rules have no explicit fields', () => {
    const rules = { rules: [{ operator: 'exact_match' }] };
    expect(readPromptJudgmentDecisionField(rules, 'sentiment')).toBe('sentiment');
    expect(readPromptJudgmentExpectedField(rules, 'gold')).toBe('gold');
    expect(normalizePromptJudgmentRules(rules)).toEqual({
      rules: [{ decisionField: 'label', expectedField: 'expected_output', operator: 'exact_match' }],
    });
  });

  it('unwraps config.rules wrappers', () => {
    expect(
      normalizePromptJudgmentRules({
        ruleName: 'default',
        config: { rules: [{ decisionField: 'label', expectedField: 'gold', operator: 'exact_match' }] },
      }),
    ).toEqual({
      rules: [{ decisionField: 'label', expectedField: 'gold', operator: 'exact_match' }],
    });
  });

  it('preserves threshold comparison operators', () => {
    expect(
      normalizePromptJudgmentRules({
        ruleName: 'default',
        config: {
          mode: 'threshold',
          decision_field: 'score',
          expected_field: 'score_expected',
          operator: 'gte',
          threshold: 0.8,
        },
      }),
    ).toEqual({
      rules: [
        {
          decisionField: 'score',
          expectedField: 'score_expected',
          operator: 'threshold',
          threshold: 0.8,
          thresholdOperator: 'gte',
        },
      ],
    });
  });
});
