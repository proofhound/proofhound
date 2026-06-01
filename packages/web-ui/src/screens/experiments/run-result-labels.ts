import type { RunResultJudgmentStatusDto, RunResultStatusDto } from '@proofhound/shared';
import type { TranslationKey } from '../../i18n';

export type BinaryRunResultJudgmentStatus = Extract<RunResultJudgmentStatusDto, 'correct' | 'incorrect'>;

export interface RunResultLabelSource {
  status: RunResultStatusDto;
  judgmentStatus: RunResultJudgmentStatusDto | null;
  isCorrect: boolean | null;
  errorClass: string | null;
  errorMessage: string | null;
}

const RUN_RESULT_STATUS_LABEL_KEYS: Record<RunResultStatusDto, TranslationKey> = {
  success: 'experiments.runResult.status.success',
  error: 'experiments.runResult.status.error',
  timeout: 'experiments.runResult.status.timeout',
  rate_limited: 'experiments.runResult.status.rateLimited',
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

export function getRunResultStatusLabelKey(status: RunResultStatusDto): TranslationKey {
  return RUN_RESULT_STATUS_LABEL_KEYS[status];
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
  runResult: Pick<RunResultLabelSource, 'status' | 'judgmentStatus'>,
): TranslationKey | null {
  if (runResult.status !== 'success') return RUN_RESULT_STATUS_LABEL_KEYS[runResult.status];
  return runResult.judgmentStatus ? (RUN_RESULT_JUDGMENT_FAILURE_LABEL_KEYS[runResult.judgmentStatus] ?? null) : null;
}

export function formatRunResultFailureReason(
  runResult: RunResultLabelSource,
  t: (key: TranslationKey) => string,
): string | null {
  const message = cleanText(runResult.errorMessage);
  const errorClass = cleanText(runResult.errorClass);
  const failureLabelKey = getRunResultFailureLabelKey(runResult);
  const failureLabel = failureLabelKey ? t(failureLabelKey) : null;

  if (message && failureLabel) return `${failureLabel}: ${message}`;
  if (message && errorClass) return `${errorClass}: ${message}`;
  if (message) return message;
  if (failureLabel) return failureLabel;
  return errorClass;
}
