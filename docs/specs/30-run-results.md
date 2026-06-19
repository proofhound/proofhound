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

## 9. Large-payload storage tiering

The four large fields of a run result — `rendered_prompt`, `input_variables`, `raw_response`, `parsed_output` — are the bulk of `run_results` byte size. When an `ObjectStorageProvider` is configured (`isEnabled()`), they may be tiered out of the partitioned table into compressed object-storage shards, leaving the row with an index + preview + pointer. When no provider is configured the behavior is exactly as before: every field stays inline in the DB. This tiering is a storage-location change only and does not alter the logical content of a run result — it is consistent with the immutability rule in §1 (the authoritative bytes never change; only where they live does).

### 9.1 Row shape after tiering

- `payload_ref jsonb` — a self-describing reference to the shard holding this row's offloaded fields (`StoredObjectRef` + `rowIndex`). `NULL` means the row is still fully inline (a fresh row, an older row, or a deployment with no object storage). When non-`NULL`, object storage is the system of record for the offloaded fields.
- `compaction_generation int` — generation guard for the shard the row points at (see §9.3). Read paths trust only the ref matching the row's current generation.
- `input_preview text` / `output_preview text` — short previews for the list (the model-output preview reuses the existing `decision_output` where present, with `output_preview` as the fallback). The list never needs the full fields.
- The big fields themselves stay nullable: after offload the large inline values are cleared. `rendered_prompt` drops its `NOT NULL` constraint so it can be cleared once its bytes live in a shard.

A small row whose offloaded fields serialize under a configured byte threshold may keep its inline copy as a read cache even after `payload_ref` is set; the cache is optional, droppable, and capped — `payload_ref` is always authoritative. (The cache threshold / cap policy is a deployment concern; the OSS default keeps the small-row inline cache, hosted deployments may tighten it.)

### 9.2 Read paths

- **List** serves preview-only: it stops selecting the four big fields and returns the index columns + `input_preview` / `output_preview` / `decision_output`. The list-item DTOs keep the big fields optional for backward compatibility; they are simply absent in list responses.
- **Detail** and every **background business read** (optimization analysis/generate reuse, canary/release output mapping, webhook receipts, annotation detail, strategy analysis) go through one seam — `RunResultPayloadReader` (`readRenderedPrompt` / `readInputVariables` / `readRawResponse` / `readParsedOutput` + batch variants). The seam returns the inline value when present, otherwise reads the row's shard (by `payload_ref` + `rowIndex`) and returns the field. No read path touches a tiered field directly.
- Reading a shard is a cheap object-storage GET with no egress cost; a cache miss costs only a few tens of milliseconds, not a DB egress charge.

### 9.3 Write path: compaction-at-finalize

Run results are still written **inline** by the per-row idempotent writer (`run_result_ids` reservation unchanged) — this inline window is the natural hot cache for running / recent rows. Offload happens later, at the run's batch boundary:

- **Experiment / optimization** runs compact at their workflow finalize step. Sources with no finalize step are compacted by a timer-driven sweep that finds `(project_id, source, source_id)` groups still inline and compacts each — **`online`** (production traffic), **`canary`**, and **`release`** (their lane-scoped reads — annotations, lists, details — all route through the reader seam).
- Compaction is generation-keyed and commit-safe (object stores have no atomic rename, so there is no post-commit promote step):
  1. Write each row's offloaded fields into a generation-exclusive shard key `…/run_result_shard/{sourceId}/gen{G}/shard-{seq}.<codec>` (immutable per generation; never reuses a prior key).
  2. `HeadObject` to confirm each shard exists.
  3. In a single DB transaction, set `payload_ref` (pointing at the gen `G` key) + `compaction_generation = G` and clear the now-offloaded inline fields. At commit the referenced object is already known to exist, so there is no window where a ref points at a missing object.
  4. Old generations are swept asynchronously after commit.
  5. A re-run that finds generation `G` already committed skips; otherwise it rewrites the not-yet-referenced gen `G` key region (or advances to `G+1`). It never overwrites a generation key already referenced by a committed row.

### 9.4 Offload scope

- `rendered_prompt` + `input_variables` are UI-read only → offloaded for **every** source.
- `raw_response` + `parsed_output` are offloaded only for **`experiment` + `online`** (the row-count bulk, with no background read of these fields).
- For `optimization_analysis` / `optimization_generate` / `release` / `canary`, `raw_response` + `parsed_output` stay inline in the DB: these sources are low-volume and their parsed/raw are read by background business logic (analysis reconstruction, output mapping, receipts). They are still read through the seam so the read entry point is uniform, but the seam finds them inline.

### 9.5 Search trade-off

After offload the DB can no longer `ILIKE` the full `raw_response` / `input_variables`. Searchable in the DB remain `decision_output` and the previews (label / prediction / error type / preview text). Full-payload free-text search is a separate, out-of-scope capability (a high-tier / cold query), not part of this tiering.
