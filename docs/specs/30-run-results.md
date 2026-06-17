# 30 · Run results

## 1. Page role

Run results are the fact table for all LLM calls and the entry point for troubleshooting. Calls produced by experiments, optimizations, release canary candidates, and the production lane are all written to `ph_runs.run_results`.

Run results are immutable once written; manual annotations are written to `ph_runs.annotations`.

`runResultId` is stable across DBOS / BullMQ retries. Writers reserve the id in `ph_runs.run_result_ids` before writing the partitioned `ph_runs.run_results` row; a retry for an already reserved id does not create or overwrite a run result.

All run-result-based "failure count / failed samples / failure rate" metrics use one and the same definition:

- An LLM call failure causes `run_results.status = 'failed'`.
- The run result status is `failed`; `running` is an in-progress state and is not counted as failure.
- Structured output parsing failed, `judgment_status = 'parse_error'`.
- An expected result exists and the judgment logic failed to run, `judgment_status = 'judge_error'`.

Therefore the run failure rate is uniformly defined as:

```text
failed_run_results / total_run_results
```

Here `failed_run_results` is counted only under the run-result failure definition above; `incorrect` is a quality judgment result and is not equivalent to a run failure. When the model produces output normally but the output does not match the expected result, only the quality judgment is written — it is not counted in the failure count / failure rate. Downstream delivery success / failure belongs to the delivery-path metrics and must be named explicitly as downstream delivery metrics; do not reuse "failure rate" for the run failure rate definition.

The run result status state machine has only `running` / `success` / `failed`. Failure forms such as `error`, `time_out`, and `rate_limit` are represented as error type / error detail under `status='failed'`; they are not separate run-result states.

## 2. List

Each row shows:

- Time
- Source: experiment / optimization / canary candidate / production
- Source object
- Release version (release source)
- Prompt version
- Model
- Input preview
- Model output preview
- Judgment value
- Whether correct
- Latency
- Token usage
- Cost estimate
- Status
- Whether a manual annotation exists

## 3. Filtering

- Time window
- Source type
- Release version
- Prompt / prompt version / model
- Status / error type
- Judgment value
- Whether correct
- Whether annotated
- External ID
- Text search

## 4. Experiment dimension interface

The experiment dimension query is currently implemented:

```text
GET /experiments/:experimentId/run-results
GET /experiments/:experimentId/run-results/:runResultId
```

Pagination query parameters:

- `page`
- `pageSize`
- `status[]`
- `judgmentStatus[]`
- `isCorrect`
- `search`
- `sort`

Results are shown in descending order of creation time by default, i.e. the most recently written run results appear first.

MCP:

- `run_result_list_for_experiment`
- `run_result_get`

The release dimension queries on `source='release' + source_id=release_line_events.id`; the lane is derived from the release event's `lane_type`.

The unified release detail page currently provides the release dimension list entry point:

```text
GET /run-results/releases
```

Pagination query parameters:

- `page`
- `pageSize`
- `status[]`
- `judgmentStatus[]`
- `isCorrect`
- `search`
- `sort`
- `sourceIds[]`: `release_line_events.id`.
- `releaseVersionIds[]`: release version ID; exact release version filtering is preferred for day-to-day release result review.
- `releaseVersionScope`: `exact` / `journey`. `exact` only includes the selected `releaseVersionIds[]`; `journey` expands a selected production version to its related candidate versions plus the production version when annotation categories are compatible.
- `promptVersionIds[]`
- `lane[]`: `production` / `canary`
- `externalId`
- `from`
- `to`

Results are shown in descending order of creation time by default, i.e. the most recently written run results appear first.

MCP:

- `run_result_list_for_release`

The release run results list must show the release version label, prompt version, and model name together; users should not see only a UUID.

## 5. Detail

The detail view shows:

- The rendered prompt.
- Input variables.
- The model's raw output.
- The parsed structured output.
- The judgment result.
- Latency, tokens, cost.
- Error type and error message.
- `dbosWorkflowId` / `bullmqJobId`.
- Navigation to the source object.

## 6. Annotation

Annotations are used for manual correction or to supplement the judgment:

- Annotation records are written to `ph_runs.annotations`.
- An annotation can be associated with a release-version annotation task; tasks are created manually by the user and are not generated automatically by a release or runner. New tasks sample from all current run results under the selected release version by default; compatibility tasks may still target only canary or production lane data.
- The manual annotation field is fixed as `expected_output`, representing the correct business classification / field value for the current data sample, rather than a binary judgment of "whether the model output is correct".
- Classification annotation uses a single-select control; the available classifications are derived from the `output_schema.fields[].value` of the prompt version bound to the annotation task, preferring the output field with `isJudgment=true`. The single-select result is written to `fields.expected_output` by classification label.
- Annotation task sampling supports `random` sampling by total count and `per_category` sampling by requested counts per prompt classification category. Per-category availability is counted from the current `run_results.decision_output` distribution under the selected release version.
- An annotation sample can be claimed and locked first and then submitted, or submitted directly from an unlocked or expired-lock state; on direct submission the server atomically claims the sample and writes the annotation. It still cannot submit a sample currently held under a valid lock by another user.
- Annotations do not update the business result fields of `run_results`.

## 7. Retention policy

- Raw run results are retained permanently by default.
- The webhook asynchronous `call_id` receipt is written to a short-lived Redis cache with a fixed expiry; it does not change the `run_results` retention policy.

## 8. Real-time behavior

The run results list refreshes by polling alongside its parent page. While an experiment is running it is typically every 5 seconds; polling stops once the terminal state is reached. The optimization and release pages may decide whether to enable polling based on their own state.
