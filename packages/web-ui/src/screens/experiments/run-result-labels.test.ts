import { describe, expect, it } from 'vitest';
import {
  formatRunResultFailureReason,
  getRunResultJudgmentLabelKey,
  type RunResultLabelSource,
} from './run-result-labels';
import type { TranslationKey } from '../../i18n';

const t = (key: TranslationKey) => key;

function runResult(overrides: Partial<RunResultLabelSource>): RunResultLabelSource {
  return {
    status: 'success',
    judgmentStatus: null,
    isCorrect: null,
    errorClass: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('run result labels', () => {
  it('keeps the judgment field binary', () => {
    expect(getRunResultJudgmentLabelKey(runResult({ judgmentStatus: 'correct', isCorrect: true }))).toBe(
      'experiments.runResult.judgment.correct',
    );
    expect(getRunResultJudgmentLabelKey(runResult({ judgmentStatus: 'incorrect', isCorrect: false }))).toBe(
      'experiments.runResult.judgment.incorrect',
    );
    expect(getRunResultJudgmentLabelKey(runResult({ judgmentStatus: 'parse_error', isCorrect: false }))).toBe(
      'experiments.runResult.judgment.incorrect',
    );
    expect(getRunResultJudgmentLabelKey(runResult({ status: 'error', isCorrect: false }))).toBe(
      'experiments.runResult.judgment.incorrect',
    );
  });

  it('falls back to incorrect when a result is not correct', () => {
    expect(getRunResultJudgmentLabelKey(runResult({ isCorrect: true }))).toBe(
      'experiments.runResult.judgment.correct',
    );
    expect(getRunResultJudgmentLabelKey(runResult({ isCorrect: false }))).toBe(
      'experiments.runResult.judgment.incorrect',
    );
    expect(getRunResultJudgmentLabelKey(runResult({ status: 'timeout', isCorrect: false }))).toBe(
      'experiments.runResult.judgment.incorrect',
    );
    expect(getRunResultJudgmentLabelKey(runResult({}))).toBe('experiments.runResult.judgment.incorrect');
  });

  it('routes parse and call failures to the failure reason label', () => {
    expect(formatRunResultFailureReason(runResult({ judgmentStatus: 'parse_error' }), t)).toBe(
      'experiments.runResult.judgment.parseError',
    );
    expect(
      formatRunResultFailureReason(runResult({ status: 'error', errorMessage: 'provider down' }), t),
    ).toBe('experiments.runResult.status.error: provider down');
  });
});
