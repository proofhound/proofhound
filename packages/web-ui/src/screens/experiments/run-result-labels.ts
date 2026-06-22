import { isRunResultFailure, type RunResultJudgmentStatusDto, type RunResultStatusDto } from '@proofhound/shared';
import type { TranslationKey } from '../../i18n';

export type BinaryRunResultJudgmentStatus = Extract<RunResultJudgmentStatusDto, 'correct' | 'incorrect'>;
export type RunResultChainStatus = RunResultStatusDto;

export interface RunResultLabelSource {
  status: RunResultStatusDto;
  judgmentStatus: RunResultJudgmentStatusDto | null;
  isCorrect: boolean | null;
  expectedOutput?: string | null;
  errorClass: string | null;
  errorMessage: string | null;
}

export interface RunResultFailureReasonParts {
  summary: string;
  detail: string | null;
}

const RUN_RESULT_STATUS_LABEL_KEYS: Record<RunResultStatusDto, TranslationKey> = {
  running: 'experiments.runResult.status.running',
  success: 'experiments.runResult.status.success',
  failed: 'experiments.runResult.status.failed',
};

const RUN_RESULT_CHAIN_STATUS_LABEL_KEYS: Record<RunResultChainStatus, TranslationKey> = {
  running: 'experiments.runResult.chainStatus.running',
  success: 'experiments.runResult.chainStatus.success',
  failed: 'experiments.runResult.chainStatus.failed',
};

const RUN_RESULT_JUDGMENT_LABEL_KEYS: Record<BinaryRunResultJudgmentStatus, TranslationKey> = {
  correct: 'experiments.runResult.judgment.correct',
  incorrect: 'experiments.runResult.judgment.incorrect',
};

const RUN_RESULT_JUDGMENT_FAILURE_LABEL_KEYS: Partial<Record<RunResultJudgmentStatusDto, TranslationKey>> = {
  parse_error: 'experiments.runResult.judgment.parseError',
  judge_error: 'experiments.runResult.judgment.judgeError',
};

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function lastMeaningfulLine(value: string | null): string | null {
  if (!value) return null;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? null;
}

function sameText(left: string | null, right: string | null) {
  return left !== null && right !== null && left.toLowerCase() === right.toLowerCase();
}

export function getRunResultStatusLabelKey(status: RunResultStatusDto): TranslationKey {
  return RUN_RESULT_STATUS_LABEL_KEYS[status];
}

export function getRunResultChainStatus(
  runResult: Pick<RunResultLabelSource, 'status' | 'judgmentStatus' | 'expectedOutput'>,
): RunResultChainStatus {
  if (runResult.status === 'running') return 'running';
  return isRunResultFailure(runResult.status, runResult.judgmentStatus, runResult.expectedOutput) ? 'failed' : 'success';
}

export function getRunResultChainStatusLabelKey(status: RunResultChainStatus): TranslationKey {
  return RUN_RESULT_CHAIN_STATUS_LABEL_KEYS[status];
}

export function getBinaryRunResultJudgmentStatus(
  runResult: Pick<RunResultLabelSource, 'status' | 'judgmentStatus' | 'isCorrect'>,
): BinaryRunResultJudgmentStatus {
  if (runResult.status === 'success' && (runResult.judgmentStatus === 'correct' || runResult.isCorrect === true)) {
    return 'correct';
  }
  return 'incorrect';
}

export function getRunResultJudgmentLabelKey(
  runResult: Pick<RunResultLabelSource, 'status' | 'judgmentStatus' | 'isCorrect'>,
): TranslationKey {
  const status = getBinaryRunResultJudgmentStatus(runResult);
  return RUN_RESULT_JUDGMENT_LABEL_KEYS[status];
}

export function getRunResultFailureLabelKey(
  runResult: Pick<RunResultLabelSource, 'status' | 'judgmentStatus' | 'expectedOutput'>,
): TranslationKey | null {
  if (!isRunResultFailure(runResult.status, runResult.judgmentStatus, runResult.expectedOutput)) return null;
  if (runResult.status === 'failed') return RUN_RESULT_STATUS_LABEL_KEYS[runResult.status];
  return runResult.judgmentStatus ? (RUN_RESULT_JUDGMENT_FAILURE_LABEL_KEYS[runResult.judgmentStatus] ?? null) : null;
}

export function formatRunResultFailureReason(
  runResult: RunResultLabelSource,
  t: (key: TranslationKey) => string,
): string | null {
  const parts = formatRunResultFailureReasonParts(runResult, t);
  if (!parts) return null;
  return parts.detail ? `${parts.summary}: ${parts.detail}` : parts.summary;
}

export function formatRunResultFailureReasonParts(
  runResult: RunResultLabelSource,
  t: (key: TranslationKey) => string,
): RunResultFailureReasonParts | null {
  if (getRunResultChainStatus(runResult) !== 'failed') return null;

  const message = cleanText(runResult.errorMessage);
  const errorClass = cleanText(runResult.errorClass);
  const failureLabelKey = getRunResultFailureLabelKey(runResult);
  const failureLabel = failureLabelKey ? t(failureLabelKey) : null;
  const detail = lastMeaningfulLine(message) ?? errorClass;
  const summary = failureLabel ?? errorClass ?? detail;

  if (!summary) return null;
  return {
    summary,
    detail: sameText(summary, detail) ? null : detail,
  };
}
