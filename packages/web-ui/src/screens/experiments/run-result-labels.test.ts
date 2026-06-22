import { describe, expect, it } from 'vitest';
import {
  formatRunResultFailureReason,
  formatRunResultFailureReasonParts,
  getRunResultChainStatus,
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
    expect(getRunResultJudgmentLabelKey(runResult({ status: 'failed', isCorrect: false }))).toBe(
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
    expect(getRunResultJudgmentLabelKey(runResult({ status: 'failed', isCorrect: false }))).toBe(
      'experiments.runResult.judgment.incorrect',
    );
    expect(getRunResultJudgmentLabelKey(runResult({}))).toBe('experiments.runResult.judgment.incorrect');
  });

  it('keeps chain success separate from judgment correctness', () => {
    expect(getRunResultChainStatus(runResult({ judgmentStatus: 'incorrect', isCorrect: false }))).toBe('success');
    expect(getRunResultChainStatus(runResult({ status: 'failed', isCorrect: false }))).toBe('failed');
    expect(getRunResultChainStatus(runResult({ judgmentStatus: 'parse_error', isCorrect: false }))).toBe('failed');
    expect(getRunResultChainStatus(runResult({ judgmentStatus: 'judge_error', isCorrect: false }))).toBe('failed');
    expect(getRunResultChainStatus(runResult({ judgmentStatus: 'judge_error', expectedOutput: 'gold' }))).toBe('failed');
    expect(getRunResultChainStatus(runResult({ judgmentStatus: 'judge_error', expectedOutput: null }))).toBe('success');
    expect(getRunResultChainStatus(runResult({ status: 'running' }))).toBe('running');
  });

  it('routes parse and call failures to the failure reason label', () => {
    expect(formatRunResultFailureReason(runResult({ judgmentStatus: 'parse_error' }), t)).toBe(
      'experiments.runResult.judgment.parseError',
    );
    expect(
      formatRunResultFailureReason(runResult({ status: 'failed', errorMessage: 'provider down' }), t),
    ).toBe('experiments.runResult.status.failed: provider down');
  });

  it('does not show a failure reason for normal incorrect judgments', () => {
    expect(formatRunResultFailureReason(runResult({ judgmentStatus: 'incorrect', isCorrect: false }), t)).toBeNull();
    expect(formatRunResultFailureReason(runResult({ judgmentStatus: 'judge_error', expectedOutput: null }), t)).toBeNull();
  });

  it('formats failure reason as summary plus a detailed final stack line', () => {
    expect(
      formatRunResultFailureReasonParts(
        runResult({
          status: 'failed',
          errorClass: 'ProviderError',
          errorMessage: 'ProviderError: quota exceeded\n    at requestModel\n    at runSample',
        }),
        t,
      ),
    ).toEqual({
      summary: 'experiments.runResult.status.failed',
      detail: 'at runSample',
    });
  });
});
