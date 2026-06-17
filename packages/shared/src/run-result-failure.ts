import type { RunResultJudgmentStatusDto, RunResultStatusDto } from './dto/run-result.dto';

export const RUN_RESULT_FAILURE_JUDGMENT_STATUSES = ['parse_error', 'judge_error'] as const;
const EXPECTED_OUTPUT_NOT_PROVIDED = Symbol('expected_output_not_provided');

export function isRunResultFailure(
  status: RunResultStatusDto | string | null | undefined,
  judgmentStatus: RunResultJudgmentStatusDto | string | null | undefined,
  expectedOutput: unknown = EXPECTED_OUTPUT_NOT_PROVIDED,
): boolean {
  if (status === 'failed') return true;
  if (judgmentStatus === 'parse_error') return true;
  if (judgmentStatus !== 'judge_error') return false;
  return expectedOutput === EXPECTED_OUTPUT_NOT_PROVIDED || (expectedOutput !== null && expectedOutput !== undefined);
}
