# 25 · Optimization

## 1. The role of this page

Optimization is an **automated loop**: an analysis LLM repeatedly inspects the failing samples of an experiment, automatically generates better prompt versions, then reruns the experiment, until it reaches the configured goals or the loop limit.

It compresses the workflow of "have a prompt engineer manually inspect failing samples → revise the prompt → rerun the experiment" into an automated process inside the platform.

Optimization names must be unique within a project; when creating an optimization, the name must not collide with any undeleted optimization task in the same project. When the user enters a name, the frontend should prompt "this name is already in use" if it detects a duplicate within the project, while the backend still enforces it via a uniqueness constraint as a backstop.

At the implementation level, the entire loop is a long-running **DBOS workflow** (`OptimizationWorkflow`); each round is a DBOS step (which embeds one `ExperimentWorkflow` sub-workflow). The loop context (best version, goal progress) is persisted in DBOS workflow state (the Postgres system tables DBOS manages itself) and can be paused / resumed / cancelled.

## 2. Three starting points

Different businesses have different starting points; the platform supports three modes:

| Starting point          | Applicable scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing experiment     | You already have a prompt that has run an experiment with a baseline metric, and you want targeted improvement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Existing prompt version | You have already written a prompt but have not run an experiment yet. The system first runs a baseline experiment (not counted as an optimization round); on success it backfills that experiment into `optimizations.source_experiment_id`, and the subsequent flow is identical to the "Existing experiment" starting point. The frontend offers a two-pane selector ("prompts on the left / prompt versions on the right") for picking the starting point, and displays the selected version's template variables, output schema, prompt language, and a prompt preview; on submit it sends `promptId` + `baseVersionId`, and can explicitly override the `promptLanguage` used for this optimization. If an API / MCP caller omits `baseVersionId`, the server selects one automatically as a backstop — preferring `prompts.current_online_version_id`, and falling back to the version with the highest version number for that prompt |
| Dataset only            | Starting from nothing; the platform automatically generates the first prompt version and then begins optimizing. At `createOptimization` time it automatically creates an empty prompt (a `prompts` row only, with no `prompt_versions` row) as the carrier entity; after the workflow starts it uses `analysisModelId` to randomly draw `initialSamplingRounds × initialSamplesPerRound` samples from the dataset, derives and generates the first prompt version in this task's `promptLanguage` and freezes it. The frontend only sends `datasetId` + `analysisModelId` + `taskModelId` + `goals`, and **does not send** `promptId` / `baseVersionId`. See §2.1 for the detailed contract                                                                                                                                                                                                                                                 |

### 2.0 Prompt language snapshot

At optimization creation time it holds `prompt_language ∈ {'zh-CN','en-US'}`, which is a task-level snapshot that cannot be modified by editing the task config after creation. This field controls all **LLM-facing platform-generated text**:

- The system / user prompt for the `from_dataset_only` first-version generation
- The system / user prompts for each round's `analyze / summarize / generate` stages
- The output-format instruction section assembled from `output_schema` in the generation stage
- The `prompt_versions.prompt_language` of the new versions the optimization generates and freezes

Default rules:

- `from_experiment` / `from_prompt_version`: when the caller does not pass `promptLanguage`, the server inherits the baseline prompt version's `prompt_language`
- `from_dataset_only`: when the caller does not pass it, the default is `zh-CN`; the quick start page must explicitly pass the language selection
- When the caller explicitly passes `promptLanguage`, the new versions generated by this task use that language; the baseline experiment is still executed in the referenced prompt version's own `prompt_language`, to avoid changing the runtime semantics of historical versions

`prompt_language` does **not** translate the user-written `optimizationHint`, the task description, dataset samples, classification labels, variable names, JSON keys, or existing prompt bodies; these enter the LLM context verbatim as the user wrote them.

### 2.1 `from_dataset_only` first-version generation contract

Triggered only when `startingMode = 'from_dataset_only'`, executed by the `OptimizationWorkflow`'s dedicated step `generateFirstVersionStep` (see [03 §3.2](03-orchestration.md#32-optimizationworkflow) for its registration location); this step belongs to the **round 0 baseline round** of the from_dataset_only path: it first generates the first prompt version, then runs a baseline experiment with that first version. Only on success does it enter the standard single-round optimization flow in §5, with the first optimization round being `round_index=1`.

**Automatic prompt creation (service side)**:

In this mode, `createOptimization` immediately creates an empty prompt row (a single `ph_assets.prompts` row, **not creating** any `prompt_versions`); the returned promptId is written to `optimizations.prompt_id`, and `base_version_id` stays `NULL` waiting for the workflow to backfill it:

- `name`: `optimization-${datasetName}-${ISO timestamp to the minute}` (e.g. `optimization-customer-feedback-2026-05-20T14:30`)
- `default_dataset_id`: reuses the input parameter `datasetId`
- `created_by`: the user who triggered the optimization
- The auto-created prompt carries no `description` (the `ph_assets.prompts` table currently has no description column); the optimization task's description is only passed through to the user prompt of the first-version generation LLM
- Naming conflict (collision with the prompt name uniqueness constraint): the service automatically appends a `-${shortHash(optimizationName+timestamp)}` suffix and retries once; if it still conflicts on the second attempt → throw `prompt_name_collision_v1`

**User generation guidance (shared by all starting points)**:

When creating an optimization the user may optionally fill in `optimizationHint` (up to 4000 characters; an empty string is normalized to `NULL`). This field is a snapshot at creation time and cannot be modified while the task is running; it only enters the prompt generation steps:

- `from_dataset_only`'s `generateFirstVersionStep`: as the "user generation guidance" section of the first-version prompt generation LLM
- Each round's `generate_prompt`: as the "user generation guidance" section of the new-version prompt generation LLM

`optimizationHint` does **not** enter the error analysis / summarize / metric judgment / field whitelist / output schema / judgment rules logic; it is a soft constraint and must not bypass the variable whitelist, the evidence chain, or the output contract. The task `description` is still the task note and the first-version task description, and cannot replace `optimizationHint`.

**First-version LLM call contract (workflow side)**:

- **Model**: `analysisModelId` (reuses the same model as the analysis LLM in subsequent rounds; no new field is introduced)
- **Input**:
  - `samples`: from the full set of samples in `loadDatasetSamples(datasetId)`, **randomly draw** N = `initialSamplingRounds × initialSamplesPerRound`; if there are fewer than N samples, send all of them and log a warn
  - `description`: the optimization task description; when empty, the template falls back to "The user did not provide a task description; please infer the business from the samples"
  - `optimizationHint`: the user generation guidance; when empty it does not affect generation
  - `promptLanguage`: this task's prompt language snapshot, which determines the system / user prompt language of the first-version generation LLM
  - `goals`: the same optimization goal list as the subsequent N rounds
  - `fieldWhitelist`: the trio of `inputFields` / `metaFields` / `promptVariables`, which determines which placeholders and fields the LLM may use
- **Output (strict JSON)**: `{ promptBody: string, variables: PromptVariableDto[], outputSchema: PromptOutputSchemaDto, changeSummary: string }`; a parse failure / schema mismatch → treated as a first-version generation failure
- **Logging contract**: consistent with the subsequent N rounds' analysis LLM calls — `invokeLLM` internally first emits `llm_call_completed` to stdout, then writes one `ph_runs.run_results` row through `runResultWriter` (`source='optimization_generate'`, `round_index=0`, `source_id=optimizationId`, `run_result_id = uuidv5(optimizationId, NS, ':first-generate')`). It also writes one `optimization_round_steps` row with `step='generate_prompt'`, `round_index=0`, and a `status` that follows the step state machine
- **Persistence**: on success, call `PromptRepository.createOptimizationFrozenVersion({ versionId, promptId, parentVersionId: null, promptLanguage, ... })` to create the first frozen `prompt_versions` row, with `versionId = uuidv5(optimizationId, NS, ':first-version')`; this method has "select existing first" idempotency logic for the same versionId, ensuring DBOS step replay safety
- **Backfill**: `OptimizationRepository.updateBaseVersionId(optimizationId, versionId)` with a `WHERE base_version_id IS NULL` guard, so a replay will not overwrite an already-written value

**Failure reason codes**: the following reasons all land in `optimizations.analysis_failure_reason` and the finalize step's `reason` field:

| Reason code                          | Trigger condition                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `first_version_dataset_empty_v1`     | The dataset has 0 samples                                                                                                  |
| `first_version_parse_failed_v1`      | The LLM output cannot be parsed into the target JSON / fails schema validation (still failing after 1 format-repair retry) |
| `first_version_generation_failed_v1` | The LLM call failed overall (other uncategorized errors)                                                                   |
| `prompt_name_collision_v1`           | The auto-created prompt collided on naming a second time                                                                   |

(The old reason code `starting_mode_unsupported_v1` is, after this change, retained **only** as a backstop — returned when starting_mode is an unknown enum value; from_dataset_only no longer returns this reason, which is considered deprecated)

**Idempotency**: all write keys inside the first-version generation step (`versionId` / `runResultId` / the `optimization_round_steps` row key) are deterministic UUIDs generated via `uuidv5(optimizationId, NS, suffix)`, ensuring that on DBOS replay it does not re-freeze / double-charge tokens / re-write logs.

**Frontend display**: before first-version generation completes, the detail page has `baseVersionId === null`, the status bar shows "Generating the first prompt version...", and the evolution timeline renders a `round_index=0` "baseline" card (data source `optimization_round_steps`); after first-version generation completes and the baseline experiment is created, the `round_index=0` baseline card reuses the standard round card's experiment-progress and metrics sections, but does not display the "error pattern analysis", "improvement suggestions", or prompt diff blocks. Instead it displays the "starting from a dataset" context, the first-version generation summary, and the full body of the generated baseline prompt (which must include the "output format" instruction section assembled from `output_schema`). Only afterwards does `round_index=1` become the first optimization round.

## 3. Optimization strategy

Optimization is **strategy-pluggable** — the same dataset / same prompt can try different strategies. Each strategy decides "how to analyze failures, how to generate new versions, and which additional run configuration it needs".

| Strategy                     | Status       | Applicable scenario                                                                                            | Configuration items                          |
| ---------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **`error_pattern_analysis`** | V1 (default) | Classification problems; the model has a judgment field and can enumerate failure patterns                     | None                                         |
| `pairwise_preference`        | Roadmap      | Generative tasks; compares multiple candidate versions via LLM-as-judge to pick the best                       | Candidates per round / judge model           |
| `reflective_critique`        | Roadmap      | Any task; lets the model self-critique its output and revise the prompt                                        | Self-critique rounds / critique template     |
| `score_optimization`         | Roadmap      | Scenarios with a scalar score (rating / scoring); uses historical scores to guide generation (APE / OPRO idea) | History window length / temperature schedule |
| `beam_search`                | Roadmap      | When compute budget is ample; keeps the Top-K versions and expands them in parallel                            | Beam width / pruning threshold               |

When creating an optimization the user must explicitly select a strategy; the default is `error_pattern_analysis`. The open-source edition currently only lands classification semantics; if generative / agent is supported in the future, it should be extended via a strategy package.

At the implementation level, each strategy is a registration entry inside `packages/optimization-strategy/` ([07 §7](07-code-structure.md#7-packages--shared-packages)): an independent two-stage function for "error analysis + new-version generation" plus a Zod config schema.

## 4. Optimization goals

The user must declare what "success" is:

- Metrics: Accuracy, Precision, Recall; F1, false positive rate, and other metrics are not yet opened as optimization goals
- Comparison: ≥, ≤, >
- Target value: a decimal between 0 and 1
- Scope: a metric over the whole or over a single class (essential for multi-class businesses)

You can set multiple goals at once — **all** must be met for it to count as success.

> The above is the classification metric set; in the future generative / agent will introduce corresponding metrics (subjective scores, task completion rate, etc.), and the strategy package decides which options the UI exposes.

## 5. Single-round flow (default strategy `error_pattern_analysis`)

The internal steps of each optimization round:

```
1. Read the experiment results and metrics corresponding to this round's optimization baseline: default `bestVersion` (best-first); if the just-completed previous round's experiment is worse than its generation baseline, this round falls back to the previous round's parent prompt as the baseline
2. Bucket by confusion pair / regression sample; the bucket-level analysis LLM only outputs `errorPatterns` with sample evidence and candidate `suggestedChanges`
3. The global summarize LLM deduplicates, weights, and arbitrates conflicts over the bucket-level candidates, producing a structured `evidenceBundle`
4. The generate LLM may only rewrite the prompt based on `evidenceBundle.suggestedChanges`, may reference the user generation guidance in `optimizationHint` from creation time, and conversely outputs `appliedChanges` / `unappliedSuggestions`
5. Persist the new version (automatically tagged "generated by optimization")
6. Start an experiment with the new version, and get the metrics once it finishes
7. Compare separately against this round's generation baseline and the historical best metric: if worse than the generation baseline, the next round must re-improve on the generation baseline prompt and use this round's regressed samples as regression evidence; if it exceeds the historical best, update the best pointer
8. Check whether all goals are met → yes ↦ finish with `objective_status='met'`; no ↦ check the no-improvement / max-round limits, then either finish with `objective_status='not_met'` or enter the next round
```

> **Cross-round context for non-first rounds (roundIndex ≥ 2)**: all LLM calls in steps 2 / 3 / 4 (confusion bucketing, regression bucketing, summarize, generate) additionally include `roundHistory[]` in their inputs — a list of completed rounds aggregated by `optimization_id`, of "metrics + delta + changeSummary + appliedChanges + isBest", ordered chronologically. This lets the LLM recognize "the change in direction X in the previous round has been falsified (Δ<0)" and avoid retrying it, or continue amplifying the effective direction of the current best round. If the previous round's experiment regressed relative to its parent prompt, this round's analyze stage must simultaneously see "the regressed round's prompt + the parent prompt + the regressed samples", and the generate stage re-improves on the parent prompt. See §11.3 "Cross-round history injection" for the field set and degradation strategy, and §11.5 for the aggregation implementation.

The single-round flow of other strategies is different — the common thread is "read the current optimization target → generate a new version → run an experiment → evaluate → decide whether to continue".

Each step streams tokens and round-switch events to the frontend via **NestJS SSE** (`/sse/optimization/{taskId}/stream`), so the user can see the analysis process, the generation process, and the experiment progress (see [04 §5](04-postgresql.md#5-frontend-refresh)). The experiment progress itself follows the 5-second polling of the experiment detail page.

Each optimization round **is itself a new experiment** — this round's metrics, prompt version, status, and start/end times all land on that `ph_runs.experiments` row (pointing back to the main task via the two columns `optimization_id` + `round_index`); no separate "optimization round" table is set up. The two LLM calls for analysis / generation each land one `ph_runs.run_results` row, likewise carrying `round_index`, distinguished by `source ∈ {optimization_analysis, optimization_generate}`; both the detail page's evolution timeline and the list page's trend sparkline directly join and aggregate `experiments` + `run_results`. See §11.

The baseline / sub-experiment names auto-created by optimization use the formats `{optimizationName} · baseline` and `{optimizationName} · R{roundIndex}` (`baseline` is used as a persisted name fragment and does not go through frontend i18n), prioritizing readability; the real ownership and round of an experiment are still expressed by `optimization_id + round_index`. When a name exceeds the experiment-name length limit, `optimizationName` is truncated while keeping the round suffix; if it collides with another undeleted experiment in the same project, a deterministic short hash suffix is appended. The `ph_runs.experiments(project_id, name)` active unique index still backstops project-internal uniqueness.

## 5. List page

Displays all optimization tasks within the instance:

- Name, starting point mode, current round, max rounds
- Task status: **running / success / failed / stopped / cancelled**
- Objective status: **pending / met / not_met / unknown**, displayed independently from task status
- Best metric + corresponding version
- Supports create, delete, stop, resume
- Delete / bulk delete must show a confirmation first; after confirmation the backend permanently deletes the optimization as a child work item. This does not modify the upstream prompt or dataset. The deletion plan removes optimization round steps, optimization analysis / generation run results, and generated sub-experiments owned by the optimization together with their owned descendants.

## 6. Detail page

The detail page displays an **evolution timeline**:

- One card per round, in reverse chronological order
- Inside the card: error analysis summary, the generated new version (with diff view), a link to this round's experiment, and this round's metrics
- The quality metrics inside the card show only this round's value by default; the timeline toolbar provides a "show comparison" toggle. When enabled, next to each metric value a small label shows the delta relative to the source experiment baseline, instead of using a separate `vs baseline` column.
- Overall trend chart: the metric curve changing with rounds
- The "best version" pointer is highlighted separately and may not be the latest round; the baseline is also included as a currently-known best candidate (when metrics regress it falls back to the historical best or the baseline)
- While the task is still running, the content of the latest round is presented as a streaming increment

> **dev-only mock backstop (transitional)**: before the optimization DBOS workflow lands, `ph_runs.optimizations.run_config.devMockTimeline` (an optional jsonb sub-field; its shape is in `@proofhound/shared`'s `optimizationDevMockTimelineSchema`) is pre-filled by the dev seed with `trend / rounds / bestVersion / goalProgress / controlStrip / baselineMetrics / bestRoundLabel / trendBaselineRef`; the server detail endpoint parses it out via zod safeParse in `toDetail` and fills it into `OptimizationDetailDto`, so the detail page's evolution timeline is visualizable on demo data. In production this field is empty, the detail endpoint returns empty aggregation fields, and the frontend degrades to the "no ... data" empty state. After the workflow lands and the `run_results.round_index` field is filled in, the detail endpoint changes to truly aggregate from `run_results`, and this field is deprecated.

## 7. State machine and control

```
running on creation → success     task completed normally (goals met, max rounds reached, or no-improvement stop reached)
                    ↘ failed       fatal analysis-LLM error / launch failure / other system error
running → stopped (user pauses) → resume → running
running → cancelled (user terminates, not resumable)
```

The optimization task lifecycle keeps five legal states, `running / success / failed / stopped / cancelled`, with **no `pending`**. This lifecycle answers whether the workflow itself executed successfully; it does **not** answer whether the user's optimization objective was achieved. Objective achievement is tracked separately by `objective_status ∈ pending / met / not_met / unknown`:

- `pending`: the task is still running or has been resumed
- `met`: the workflow finalized with `reason='goals_met'`
- `not_met`: the workflow completed or was stopped/cancelled before all goals were met (`max_rounds`, `no_improvement`, `control_stop`, `control_cancel`)
- `unknown`: the workflow failed before a trustworthy objective result can be computed

Therefore reaching `max_rounds` is a successful task completion with an unmet objective (`status='success'`, `objective_status='not_met'`), not a task failure.

Its child experiments follow the experiment state machine ([24 §5](24-experiments.md#5-state-machine)): `cancel` on a child experiment is folded into `stopped`, while `cancel` on the parent optimization remains a non-resumable optimization terminal state. The moment of creation is considered running (the DBOS workflow's internal `markStarted` step still idempotently writes `started_at`, written together with the status as the same value). When `launcher.launch` throws, the service's catch sets the status directly to `failed`, so the user's view will not show an intermediate state of "pending the instant after creation, then advancing". When the launcher that starts a sub-experiment in each optimization round's `runRoundStep` fails, the catch must likewise distinguish a DBOS workflow id collision (the normal replay path, swallowed) from a real launch failure (set the sub-experiment to `failed` and throw so the step enters a failed retry).

- stopped: the parent workflow detects `control_state='stop'` at a round boundary or between sub-experiment polls, **and links it to stop the sub-experiment** (see "dual-path linkage" below); after landing `stopped` it can be resumed by the user
- cancelled: the same path links the sub-experiment with an experiment `cancel` action, which is normalized to `stopped` on the child; the parent optimization state machine switches to the `cancelled` terminal state, which is not resumable

**Dual-path stop / cancel linkage to the sub-experiment**:

1. **service immediate linkage**: after `controlOptimization('stop' | 'cancel')` writes the parent `control_state`, it immediately (outside the same transaction) calls `experimentService.controlExperiment(activeChildExpId, action, SYSTEM_ACTOR, 'system')` to stop the current round's active sub-experiment (`cancel` is a stop alias for experiments). On failure (the sub-experiment is already terminal / the row was not created) → log a warn and swallow it, without blocking the parent control from persisting.
2. **workflow poll backstop**: before each poll of the sub-experiment status, `waitForExperimentTerminal` also reads the parent `control_state`; on seeing stop / cancel → likewise call `controlChildExperimentStep` to link it, and keep polling until the sub-experiment is truly terminal before returning. The parent workflow finalizes at the top of the next loop in `readControlState`.

Either path taking effect satisfies the invariant "parent stop → child also ends up terminal"; the two paths are redundant to guard against the race between the service's immediate call and the workflow's advancement.

**Resume granularity: continue from the sub-experiment checkpoint**:

When resuming a `stopped` optimization, it does **not** skip this round and go straight to the next round, but continues from this round's sub-experiment checkpoint:

- `loadConfigImpl`'s `nextRound` derivation rule: scan the persisted rounds; a `status ∈ {success, failed}` is treated as completed (`nextRound = roundIndex + 1`); a `status ∈ {stopped, running}` is treated as "interrupted", `nextRound = roundIndex` (**rerun this round**), and it carries a `resumeChildExpId` so that `runImpl` skips re-doing `DBOS.startWorkflow` for that sub-experiment, and instead: if the sub-experiment is `stopped` → call `controlChildExperimentStep(..., 'resume')` to let the sub-workflow continue; if it is already `running` / terminal → go straight to `finalizeRoundStep` and wait for the result.
- The sub-experiment's own BullMQ job stop semantics follow [24 §5](24-experiments.md#5-state-machine): already-enqueued sample jobs are not aborted (let the worker finish them), and a new batch is enqueued continuing from the cursor — so "continue from checkpoint" actually means "the not-yet-enqueued samples start from the unprocessed cursor".
- This round's analysis / generation LLM results are not re-charged for tokens, via the reuse mechanism in §11 (see §11.5).

The DBOS workflow id is named `optimization:${optimizationId}:${kind}:${ts}`, with `kind ∈ start | resume | retry` (same pattern as the experiment workflow). `resume` / `retry` **start a new workflow id** instead of reusing the old id, making it easy to distinguish executions by id. Each round's sub-experiment starts an independent DBOS workflow (id `optimization:${optimizationId}:round:${n}:exp:${ts}`), dispatched by `DBOS.startWorkflow(experimentRegistrar)`, with the parent workflow waiting via handle.getResult() — the sub-experiment can therefore be resumed / observed and have its control_state checked independently, and the experiment entity itself (the `ph_runs.experiments` row) points back to the current round of the current optimization via the `optimization_id` + `round_index` columns. See §11 and [03 §3.2](03-orchestration.md#32-optimizationworkflow).

## 8. Concurrency limits

The same instance can run multiple optimization tasks at once; resource contention between the analysis LLM and the experiment model is uniformly backstopped by the model-side RPM / TPM / concurrency limits ([21 §6](21-models.md#6-rpm--tpm--concurrency)) via Redis centralized rate limiting. When a model has auto-concurrency enabled, the concurrency limit is self-adjusted by the system within `[1, concurrency_limit]` ([21 §6.1](21-models.md#61-auto-concurrency)), while RPM / TPM remain the hard quota ceilings.

## 9. Field whitelist

At creation time you can restrict:

- Which dataset fields the analysis LLM can see (to avoid exposing metadata to the model)
- Which parts of the prompt the analysis LLM can modify (e.g. only the instructions, not the output schema)

## 10. Relationship to other menus

- **Prompt**: optimization continuously appends new versions under the prompt, giving a clear version evolution chain
- **Experiment**: each round embeds one experiment, which you can jump to directly to see the full results
- **Dataset / Model**: input dimensions, isomorphic to the experiment
- **Release**: the best version can directly enter a canary candidate, or create a production release via `from_experiment`
- **MCP / Agent**: optimization is the core entry point for an Agent to self-drive prompt optimization

## 11. Persistence and orchestration

### 11.0 Sub-experiment runConfig inheritance

When inserting each round's sub-experiment `experiments.run_config`, it directly reuses `optimizations.run_config` (no longer merging the source experiment's run parameters, and no per-round override is allowed). Semantically equivalent to:

```
experiments[round_N].run_config = optimizations.run_config
```

To support this direct reuse, `optimizationRunConfigSchema` and `experimentRunConfigSchema` **keep the same field set** (`temperature / concurrency / rpmLimit / tpmLimit / sampleTimeoutSeconds / retries / imageEncoding`, without `description` — that is the experiment-level description, while optimization has its own `description` field).

On the new-optimization page (`OptimizationNewPage`), if a source experiment is selected, the frontend defaults to copying the full 7 fields from the source experiment's `runConfig` as the initial values, which the user can manually override; if the starting point is not an experiment (`from_prompt_version` / `from_dataset_only`), it uses the model default limits + hardcoded fallbacks (`sampleTimeoutSeconds=20`, `retries=0`, `imageEncoding='url'`).

Workflow implementation: `loadConfigImpl` projects `optimizations.run_config` into an `ExperimentRunConfigDto` via the pure function `parseChildRunConfigFromOptimization` (undeclared fields pass through into the catchall but are invisible in the frontend types), fills it into `WorkflowConfigSnapshot.childRunConfig`, and `prepareRoundImpl` passes it verbatim to `createChildExperimentRow`.

### 11.1 Reuse experiments + run_results, no new sub-table

Each optimization round itself creates a new experiment, and this round's metrics / status / start-end times / prompt version are already part of the experiment semantics. The platform **does not build a separate table for optimization rounds**, but instead adds a few columns to each of the two existing tables:

**Add two columns to `ph_runs.experiments`**

| Column            | Type         | Meaning                                                                                                                 |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `optimization_id` | uuid null fk | Which optimization this experiment belongs to (NULL if none, i.e. a standalone experiment created manually by the user) |
| `round_index`     | int null     | The optimization's 0-based round index; NULL together with `optimization_id` or NOT NULL together with it               |

The index `(optimization_id, round_index)` is partial unique where `optimization_id IS NOT NULL`, guaranteeing **at most one** experiment per optimization per round.

**Add one column to `ph_runs.run_results`**

| Column        | Type     | Meaning                                                                                                                                |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `round_index` | int null | When `source ∈ {optimization_analysis, optimization_generate}`, indicates which round this call belongs to; NULL for sample-type calls |

**Add columns to the main table `ph_runs.optimizations`**

| Column                             | Type       | Meaning                                                                                                                                    |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `objective_status`                 | text       | Independent objective-achievement state: `pending / met / not_met / unknown`; it is not derived from task `status` at read time            |
| `summary`                          | jsonb null | At finish, lands aggregates such as total cost / tokens / best diff (not per-round metrics, which the service aggregates in real time)     |
| `analysis_failure_reason`          | text null  | Recorded when the entire optimization is terminated by a fatal analysis-LLM error                                                          |
| `prompt_language`                  | text       | The prompt language snapshot at creation time, valued `zh-CN` / `en-US`, controlling all platform-generated prompt languages for this task |
| `stop_after_no_improvement_rounds` | int        | The persisted no-improvement limit selected at creation time; `0` disables this stop condition                                             |

### 11.2 Detail page / list page aggregation (service real-time join)

- **trend\[]**: `SELECT round_index, metrics FROM experiments WHERE optimization_id = $1 ORDER BY round_index` → map to the first declared goal's concrete metric and scope (overall or class-level). If `optimizations.source_experiment_id` is non-empty (`from_experiment` directly uses the experiment the user selected; `from_prompt_version` uses the baseline experiment the workflow auto-created and backfilled), the service also pulls the source experiment's `metrics` and takes the corresponding primary metric as the **0th point** (baseline) of that series; the series outputs `hasBaseline: true`, the frontend renders the X axis as `B → R1 → R2 …`, and `bestRoundIndex` still points to the best index within the round set (excluding the baseline). `from_dataset_only` is an exception: after the first version is auto-generated, the source experiment is the `round_index=0` baseline round; the service uses it as the baseline point and no longer inserts an extra static baseline point; subsequent optimization rounds start from `round_index=1`. When there is no source experiment, the series contains only round values, `hasBaseline: false`, and the X axis renders as `R1 → R2 …`. **The list page's LiveCard sparkline reuses the same semantics**: `OptimizationListItemDto.trend[0]` is the baseline primary metric value (when `trendHasBaseline=true`); the sparkline X axis draws `B` in slot 0 and R1 / R2 / … in slots 1+.
- **Detail page metric trend**: by default the detail page chart displays the optimization scope selected at task creation (overall or the first goal category) and the first concrete metric corresponding to the optimization goal; the user can switch to other categories at the top right of the chart, as well as other quality metrics derivable from `rounds[].experimentResult` / `baseline.experimentResult` (accuracy / precision / recall / F1 / FPR). The metric dropdown only lists concrete quality metrics and does not provide an "optimization goal" aggregate item. Category-level trends take precision / recall / optional accuracy / FPR from `classRows` and can derive F1; overall trends take values from the overall row and the round metric cells.
- **Progress stats**: the `currentRound` on the list / detail pages counts only real optimization rounds; the `from_experiment` source-experiment baseline, the `from_prompt_version` auto baseline, and any baseline round with `round_index<=0` or marked `isBaseline=true` do not advance the progress bar, the remaining-rounds estimate, or the current-round label. The first optimization round is always counted starting from R1.
- **rounds\[]**: on top of the trend above, for each `round_index` further LEFT JOIN `run_results WHERE source='optimization_analysis' AND round_index = $r` (to get the analysis LLM's `parsed_output` → error clustering, analysis_summary) and `source='optimization_generate'` (to get the generate LLM's `parsed_output` → new editable version / change description)
- **bestVersion**: taking the source experiment baseline + all optimization rounds as candidates, select the currently-known best per the §4 goals comparison rules; if the best comes from the baseline, the DTO still returns `bestVersion`, but with `generatedAtRoundLabel='baseline'`, `generatedAtRoundIndex=0`, and `experimentRef` pointing to the baseline experiment. When the baseline meets the goal or all subsequent rounds regress, it does not display "no best version yet".
- **goalProgress**: computed in real time (not persisted) from the metrics of the currently-known best (including the baseline candidate) vs goals. Class-scoped goals must read `best_metrics.perClass[]` / round metric `perClass[]` for that label, not the overall metric with the same name.
- **improvement_delta**: the service uniformly computes the difference using the source experiment's `metrics` as the baseline (no longer using the adjacent round). Each round's metric row retains the compatibility field `vsDelta = round_N.primaryMetric - sourceExperiment.primaryMetric`, and also emits the delta of each comparable metric under `deltas.{accuracy|precision|recall}`. If `optimizations.source_experiment_id` is empty (currently only possible before `from_dataset_only` first-version generation completes), the corresponding delta is empty and the frontend does not display it by default; even after the user opens "show comparison", the small delta label is only shown next to metrics that have baseline data.

→ The entire aggregation process **does not read a "round table"**, because it does not exist.

#### round card DTO field mapping (`OptimizationDetailIterationRoundDto`)

The visible blocks of each round card in the detail page's "evolution timeline" are joined in real time by the backend aggregator, **not relying on any "round complete" marker** — they become visible as soon as the data source is persisted. So while a round is in `running` status, the ready intermediate products (error samples, improvement suggestions, prompt diff, current experiment metrics) are all exposed in sync:

| DTO field                | Data source                                                                                                                                                                                                                                                         | When ready                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `metrics`                | `experiments.metrics`                                                                                                                                                                                                                                               | Updated in real time while the experiment runs                                                                              |
| `experimentResult`       | `experiments.{status, processed_samples, failed_samples, total_samples, metrics, started_at, finished_at}`                                                                                                                                                          | Visible when the sub-experiment is created (with a progress bar), fully populated with classification metrics when finished |
| `errorPatterns`          | `run_results.parsed_output.errorPatterns` (`source='optimization_analysis'`)                                                                                                                                                                                        | When the analysis LLM completes                                                                                             |
| `improvementSuggestions` | `run_results.parsed_output.suggestedChanges` (`source='optimization_analysis'`)                                                                                                                                                                                     | When the analysis LLM completes (same source as errorPatterns)                                                              |
| `promptDiff.toText`      | `run_results.parsed_output.newPromptBody` (`source='optimization_generate'`)                                                                                                                                                                                        | When the generate LLM completes                                                                                             |
| `promptDiff.fromText`    | The actual generation baseline of the current version, `prompt_versions.body` (prefer the current `prompt_versions.parent_version_id`; during generation use the generate `run_results.prompt_version_id`; old data falls back to the previous round / baseVersion) | When the generate LLM completes (at the same time as toText)                                                                |
| `summaryFallback`        | Analysis LLM `parsed_output.summary` / truncated `rawResponse`                                                                                                                                                                                                      | When the analysis LLM completes; only degraded display when there is no structured field                                    |
| `status`                 | Derived from `round_steps` (preferred), otherwise mapped from `experiments.status` (fallback)                                                                                                                                                                       | Throughout; steps data is visible before the experiment row (see §12)                                                       |
| `steps`                  | `ph_runs.optimization_round_steps` rows by `round_index`                                                                                                                                                                                                            | Visible from the analysis stage (the error_analysis=running row appears earliest)                                           |

A single `improvementSuggestions` entry has the structure `{ section, title, detail?, priority? }`: `section` comes from the strategy package parser's `SuggestedChange.section` (pointing to which prompt section), `title` comes from `change` (a one-sentence action), `detail` comes from `rationale`, and `priority` passes through `high | medium | low`. The frontend colors by priority, as an independent collapsible block immediately between `errorPatterns` and `promptDiff`.

The source of `rounds[]` itself is also extended to **`experiments ∪ round_steps`** merged by `round_index` — even if this round's `experiments` row has not yet been created, as long as `round_steps` has data (error analysis or generation stage already written), the detail page will show that round's card and expose the current step and failure reason via `steps[]`. See §12.

### 11.3 The evidence chain from error analysis to prompt generation

The data flow of the default strategy `error_pattern_analysis` is fixed as:

`failing samples bucketing → bucket-level errorPatterns / suggestedChanges → global summarize weighting and conflict arbitration → evidenceBundle → generate → appliedChanges + newPromptBody`

The evidence chain structure adds no DB fields and continues to be written into `run_results.parsed_output`:

- `optimization_analysis.parsed_output.errorPatterns[]` adds `patternId / source / bucketKey / affectedCount / exampleSampleIds`. When the old format lacks an ID, the parser generates a stable fallback ID by source, bucket, and order.
- `optimization_analysis.parsed_output.suggestedChanges[]` adds `changeId / addressesPatternIds / evidenceSampleIds / affectedCount / priority / conflictGroup? / resolutionReason?`. Bucket-level suggestions are only candidates; the global summarize is responsible for deduplication, ordering, and conflict arbitration.
- `optimization_analysis.parsed_output.evidenceBundle` is the main input of the generate stage, containing `summary / errorPatterns / suggestedChanges / conflicts / sourceStats`, with `evidenceBundleVersion = 1`.
- `optimization_generate.parsed_output.appliedChanges[]` must reference existing `suggestedChanges[].changeId` and declare the `patternIds` it covers; `unappliedSuggestions[]` explains why each was not adopted. A generation result referencing a nonexistent `changeId` is treated as invalid output.
- `optimization_generate.newPromptBody` must **retain the `{{var}}` placeholders that the base version already used and that are still within `fieldWhitelist.promptVariables`** — losing them is treated as invalid output (`InvalidVariableUsageError`; this round's `generate_prompt` step lands `failed` directly). Rationale: the variables already used by the base are the only connection point between sample input and the prompt; if lost, the business model literally cannot see the sample during inference, and the output immediately collapses to the prior (a typical symptom: the entire batch of samples is all judged as the same label). Whitelisted variables that the base does not use (such as the ground-truth `expected_output`) are not in the forced-retention list, to avoid leaking the answer.
- The detail page's existing `errorPatterns / improvementSuggestions / promptDiff` stay compatible; the subsequent UI can additionally display the evidence coverage relationship of `appliedChanges`.

When tokens exceed the limit, the generate stage preferentially retains evidence with `priority=high`, high `affectedCount`, and a larger gap to the corresponding unmet goal; it no longer does an unweighted truncation of the entire natural-language summary.

#### Cross-round history injection (roundIndex ≥ 2)

The four kinds of user prompts `confusion / regression / summarize / generate` append a "## Historical optimization trajectory" section after the "## Optimization goal vs current actual" section, rendering `roundHistory[]`. Structure:

`RoundHistoryEntry = { roundIndex, metrics, deltaFromPrev, changeSummary, appliedChanges, appliedTips, isBest, generatedFromBaseVersionId }`

- `metrics` comes from `experiments.metrics`; `deltaFromPrev` is computed by iterating over the `goals[0]` primary metric (the first entry is `null`)
- `changeSummary` / `appliedChanges` / `appliedTips` come from `run_results.parsed_output` (`source='optimization_generate'`, `status='success'`); on parse failure they fall back to an empty string / `[]` (without blocking the main path). The rotation mechanism of `appliedTips` is detailed in the "Toolbox rotation hint" subsection at the end of this section
- `isBest` is anchored by `optimizations.best_version_id`
- `generatedFromBaseVersionId` takes `prompt_versions.parent_version_id`, used to let the LLM distinguish "this round derived from best vs derived from the previous round"
- Ordered chronologically; for the first round (roundIndex=1), `roundHistory=[]` does not render the history section, preserving backward compatibility

When the token budget is insufficient, it degrades by "compress earlier rounds first": L0 full → L1 earlier rounds' `changeSummary` truncated at 200 characters + `appliedChanges` keeping only `changeId` → L2 the first N−3 rounds single-lined (`- round K (Δ +0.02) accuracy 0.71 → c2,c4`) → L3 the extreme case retaining only the metric curve + the most recent 1 round's changeSummary. The final degradation level is written into `run_results.parsed_output.budget.roundHistoryFittedLevel` (0/1/2/3), and the same section also lands `roundHistoryEntryCount / roundHistoryBudgetTokens / roundHistoryTruncated` for later observation.

The system prompt simultaneously constrains the LLM: (a) if history shows a direction has Δ<0, do not repeat the same direction; (b) if the best round's direction still has room, prioritize incrementing in that direction; (c) `appliedChanges.changeId` may still only reference IDs in the **current round's** `evidenceBundle.suggestedChanges`, and cross-round ID chaining is prohibited.

#### Toolbox rotation hint (soft guidance to switch techniques after 2 consecutive rounds without improvement)

Cross-round history also bears the responsibility of "preventing the LLM from spinning in place on a certain combination of optimization techniques". It introduces a "toolbox" = the 8 optimization techniques in `error_pattern_analysis/prompts/optimization-tips.md` (chain of thought / few-shot examples / terminology category disambiguation / hardening output constraints / step-by-step reasoning / error-avoidance examples / Chain-of-Verification / negative-example guidance), whose display names are fixed as the constant `OPTIMIZATION_TIP_NAMES`, in one-to-one correspondence with the 8 section titles of `optimization-tips.md`.

- The `RoundHistoryEntry` field set appends `appliedTips: string[]`: reverse-aggregated from `run_results.parsed_output.appliedTips` (the "optimization techniques referenced" self-reported by the generate LLM); on parse failure / old data it falls back to `[]`
- `formatRoundHistory` appends `appliedTips: [...]` at the end of each line, so the LLM can see in the history section "which round used which techniques, and how the corresponding metrics fared"
- Trigger: before assembling the `generate` user prompt, count consecutive `!isBest` entries from the end backward over the currently-accumulated `roundHistory[]` (`computeNoBestStreak`); if ≥ 2, inject a "## Toolbox rotation hint" section after the "## Historical optimization trajectory" section of that user prompt, with fixed content:
  - List the deduplicated union of `appliedTips` from the last 2 rounds (i.e. "techniques already tried that did not refresh the best")
  - List all technique names in `OPTIMIZATION_TIP_NAMES`
  - Suggested wording: "This round it is suggested to preferentially pick a technique from the toolbox that has **not been tried**, to avoid repeatedly polishing a direction that has already been falsified"
- Soft constraint: `generate.system.md` adds no hard constraint, `parseGenerateOutput` / `validatePromptVariables` do not validate whether `appliedTips` actually switched; when triggered, the workflow records an `optimization_toolbox_switch_triggered` (containing `streak / recentlyUsedTips`) for observation, but does not block the main path
- Adjusting `OPTIMIZATION_TIP_NAMES`: when adding / renaming toolbox entries, this constant and this subsection must be updated in sync

Design trade-off: a hard constraint (requiring appliedTips to include an untried technique) would sacrifice the LLM's flexibility to polish a direction over multiple rounds; this section only breaks the blind repetition caused by "the LLM not seeing its own technique history", without forcibly prohibiting the LLM from actively choosing to keep optimizing in the same direction.

### 11.4 The analysis / generation LLM calls invokeLLM directly inside the step

The optimization's analysis / generation LLM calls and the experiment's sample calls take two different paths — **experiment samples are large-batch parallel calls** (consumed by workers via the BullMQ `llm` queue), while **optimization has only 1 analysis + 1 generation call per round**, which need not queue. So `OptimizationWorkflow` calls `@proofhound/llm-client.invokeLLM` directly inside a DBOS step, while rate limiting / logging / run_results writing remain unified:

- **Redis centralized rate limiting**: `OptimizationWorkflow` builds the analysis model's opaque limiter key via `LimiterKeyStrategy` and passes it into `@proofhound/optimization-strategy` as `analysisLimiterKey`; the strategy package forwards that key to `invokeLLM` and never reconstructs `model:<modelId>` internally. `invokeLLM`'s dependency-injected `RateLimiterLike` therefore shares the same Redis counting space with the worker, uniformly applied to both experiment and optimization calls ([21 §4](21-models.md#4-endpoint-compatibility-rules), [08 §3.7](08-saas-adapter-boundary.md#37-limiterkeystrategy))
- **Application logging contract**: `invokeLLM` internally writes the full `llm_call_completed` / `llm_call_failed` per [05 §6](05-logging.md#6-llm-call-logging-contract)
- **run_results writing**: when passed a `runResultWriter`, `invokeLLM` automatically writes one `ph_runs.run_results` row (immutable)
- **Streaming chunks**: `invokeLLM` writes `ph_streaming.streaming_events` via the streaming writer, and the server SSE fans them out

`run_results.source` uses the two enums after the split:

- `source = 'optimization_analysis'`: the analysis LLM outputs error pattern clustering (the `parsed_output` shape is defined by a zod schema in the strategy package)
- `source = 'optimization_generate'`: the generate LLM outputs the new version content (`parsed_output` at least contains `body` / `variables` / change description)

For both, `sourceId = optimizationId`, the `round_index` column is filled with this round's index; `runResultId = uuidv5(optimizationId:roundIndex:'analysis' | 'generate')` is stable across restarts (on DBOS step restart, `invokeLLM` writes with the same id, and `run_results`' `INSERT ... WHERE NOT EXISTS` backstops idempotency); in the call context, `dbosWorkflowId` passes through the parent `OptimizationWorkflow` id.

### 11.5 DBOS workflow orchestration

`OptimizationWorkflow` is a long-running DBOS workflow; see §7 for the workflow id naming, and [03 §3.2](03-orchestration.md#32-optimizationworkflow) for the step breakdown.

Main loop: `bootstrap → for r in 1..maxRounds → readControl → analysis+generate → child experiment → compare → if goals met / no-improvement limit reached break → finalize`; after the loop is exhausted, finalization still lands `status='success'` and `objective_status='not_met'` with `reason='max_rounds'`.

Each round's embedded sub-experiment is dispatched via `DBOS.startWorkflow(experimentRegistrar).runWorkflow(experimentId)` (a detached child), and the parent workflow waits via handle.getResult() — the benefit is that the sub-experiment has an independent workflow id, so faults / recovery are independently observable; when the parent workflow restarts, it idempotently looks up the already-created sub-experiment based on `experiments WHERE optimization_id = $1 AND round_index = $r`, retrieves the handle back via DBOS `retrieveWorkflow`, and does not rerun the already-completed sub-experiment.

The loop context (best_version, goal progress) is held by DBOS workflow state (the Postgres `dbos.*` system tables) and can be paused / resumed / cancelled; the round trajectory lands in the columns of the two tables `experiments` + `run_results` per §11.1. **The cross-round `roundHistory` is not placed in workflow state** — it is aggregated on the fly by a dedicated `@DBOS.step loadRoundHistoryStep(optimizationId, beforeRoundIndex)` inside `prepareRoundImpl`, from `experiments` JOIN `run_results (source='optimization_generate', status='success')`, ensuring it is consistent with the latest DB on replay; drift of `best_version_id` changes the history content but does not affect this round's idempotency (the runResultId is locked by `uuidv5(optimizationId:roundIndex:'analysis' | 'generate')`, so the LLM is not really re-called on replay).

The analysis input must be consistent with this round's optimization baseline, and explicitly handle regressed rounds:

- By default continue best-first; `prepareRoundImpl` optimizes the current `bestVersion`.
- If the previous round's successful experiment has a worse metric than its parent prompt's corresponding experiment (judged by the `goals[0]` primary metric direction), this round enters a "regression retry": `generate`'s `currentVersion` falls back to the previous round's parent prompt; `analyze`'s `currentVersion/currentRunResults/metrics` use the regressed round's prompt and the regressed round's experiment results, and `previousVersion/previousRunResults` use the parent prompt and the parent experiment results, so as to analyze "which specific samples the previous round regressed".
- If `bestVersion` comes from a certain optimization round, read that round's corresponding `experiments.run_results` as `currentRunResults`.
- If `bestVersion` is the baseVersion, read the `sourceExperiment`'s `run_results`.
- The regression comparison baseline is uniformly the source experiment (i.e. the baseline experiment): from the first round onward, each round's `vsDelta` is `round_N.metric - sourceExperiment.metric`, rather than "against the previous round". The `from_prompt_version` source experiment is backfilled by the workflow after first running the baseline experiment; if `optimizations.source_experiment_id` is still empty (currently only possible before `from_dataset_only` first-version generation completes), it does not participate in the regression comparison, `vsDelta` emits `null`, the frontend renders `—`, and the analysis LLM must not be allowed to guess "which change caused the regression".

#### 11.5.1 Reuse of LLM results across restarts / across resume

`prepareRoundImpl` is a single DBOS step that internally calls `analyzeFailures` + `generateNextVersion` consecutively. After a crash / restart / resume, the DBOS step **replays** the entire step function — the `run_results` rows are not duplicated thanks to the deterministic `runResultId` (`uuidv5(optimizationId:roundIndex:'analysis' | 'generate')`) + `INSERT ... WHERE NOT EXISTS`, but the LLM API would really be called again.

To avoid re-charging tokens on the resume / DBOS recovery path, `prepareRoundImpl` **first queries `run_results` with a dedicated step** before each LLM call (`peekOptimizationRunResultStep(optimizationId, roundIndex, source)`, strictly filtering `status='success'`):

- Hit → use the module-level helpers `reconstructAnalysisFromRunResult` / `reconstructGenerateFromRunResult` to rebuild the structure the strategy package needs from `parsed_output`, **skipping the LLM call**. Prefer rebuilding from `parsed_output.evidenceBundle`; old data falls back to `summary ?? rawResponse ?? ''` and wraps the old `errorPatterns / suggestedChanges` into `evidenceBundleVersion=1`. On the reuse path, `batches / confusionPairs / regressionGroups` are given empty values — the detail page reads `run_results.parsed_output` directly and does not depend on the workflow runtime memory.
- Miss → take the original LLM call path; the write path is unchanged.

Whether this round's LLM call failed, whether it is still running, and the failure reason are uniformly expressed via the `ph_runs.optimization_round_steps` sub-table in §12 — no longer by writing a supplementary status='error' run_results row (the helper `writeOptimizationErrorRunResult` has been retired).

---

## 12. Intra-round step status (`ph_runs.optimization_round_steps` sub-table)

The `experiments` + `run_results` of §11.1 can only aggregate a round card **after the whole analyze → generate → experiment set has finished running** (the experiments row is not created until the end of `prepareRoundImpl`). To let the user see the current round card and the step in progress during the error analysis and prompt generation stages too, `ph_runs.optimization_round_steps` is added:

| Column             | Type                     | Meaning                                                                                                                                       |
| ------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | uuid pk                  | Primary key                                                                                                                                   |
| `optimization_id`  | uuid not null fk         | The owning optimization (`ON DELETE CASCADE`)                                                                                                 |
| `round_index`      | int not null             | 0-based round index                                                                                                                           |
| `step`             | text not null + check    | One of `error_analysis` / `generate_prompt` / `experiment`                                                                                    |
| `status`           | text not null + check    | `pending` / `running` / `success` / `failed` / `skipped`                                                                                      |
| `error_class`      | text null                | The normalized error class name when the step fails (`Error.name` or `'Error'`)                                                               |
| `error_message`    | text null                | The step failure message (≤1000 characters, to avoid stuffing a large stack into the DB)                                                      |
| `run_result_id`    | uuid null                | For navigation: the run_results row id associated with the analysis / generate step (no FK, since run_results is a monthly-partitioned table) |
| `experiment_id`    | uuid null                | For navigation: the experiments row id associated with the experiment step                                                                    |
| `started_at`       | tstz null                | Step start time                                                                                                                               |
| `finished_at`      | tstz null                | The time the step's terminal state was written                                                                                                |
| `attempt`          | int not null default 0   | DBOS step retry count (to observe where the workflow is stuck)                                                                                |
| `dbos_workflow_id` | text null                | The parent workflow id, for log correlation                                                                                                   |
| `created_at`       | tstz not null defaultNow | Row creation time                                                                                                                             |
| `updated_at`       | tstz not null defaultNow | Row last-updated time                                                                                                                         |

The unique constraint `unique(optimization_id, round_index, step)` is the core of upsert idempotency: on DBOS step retry / replay, multiple `upsertRoundStep` calls do not write duplicate rows; fields not provided are backstopped with `COALESCE(EXCLUDED.x, x)`, to avoid overwriting the previously-written `finished_at` / `run_result_id` to null.

### 12.1 State machine

```
                  ┌─────────────┐
                  │   pending   │   (implicit: the row not yet created)
                  └──────┬──────┘
                         ↓ when calling the LLM / creating the sub-experiment
                  ┌─────────────┐
                  │   running   │
                  └──────┬──────┘
                  ┌──────┴──────┬─────────────┐
                  ↓             ↓             ↓
            ┌─────────┐   ┌─────────┐   ┌─────────┐
            │ success │   │ failed  │   │ skipped │
            └─────────┘   └─────────┘   └─────────┘
                          (LLM throws /      (user cancels /
                           parse fails /      experiment stopped)
                           launch_failed)
```

### 12.2 Workflow write boundaries

`OptimizationWorkflow.prepareRoundImpl` calls `repo.upsertRoundStep` (wrapped in a layer of `upsertStepSafe`, which only logs a warn without blocking the main path when the upsert fails) at the following boundaries:

| Node                                            | step              | status  | Additional fields                                                             |
| ----------------------------------------------- | ----------------- | ------- | ----------------------------------------------------------------------------- |
| `prepareRoundImpl` start (pre-check passed)     | `error_analysis`  | running | `started_at`, `dbos_workflow_id`                                              |
| `analyzeFailures` success                       | `error_analysis`  | success | `finished_at`, `run_result_id = analysisRunResultId`                          |
| `analyzeFailures` throws                        | `error_analysis`  | failed  | `finished_at`, `error_class`, `error_message`                                 |
| Before calling `generateNextVersion`            | `generate_prompt` | running | `started_at`                                                                  |
| `generateNextVersion` success                   | `generate_prompt` | success | `finished_at`, `run_result_id = generateRunResultId`                          |
| `generateNextVersion` throws                    | `generate_prompt` | failed  | `finished_at`, `error_class`, `error_message`                                 |
| `createChildExperimentRow` success              | `experiment`      | running | `started_at`, `experiment_id`                                                 |
| `markChildLaunchFailedStep`                     | `experiment`      | failed  | `finished_at`, `error_class='LaunchFailed'`, `error_message=launch_failed: …` |
| `finalizeRoundImpl` gets sub-experiment success | `experiment`      | success | `finished_at`                                                                 |
| `finalizeRoundImpl` gets sub-experiment failed  | `experiment`      | failed  | `finished_at`, `error_message='experiment_failed'`                            |
| `finalizeRoundImpl` gets sub-experiment stopped | `experiment`      | skipped | `finished_at`                                                                 |

`error_class` / `error_message` are uniformly normalized by the module-level helper `normalizeErrorForStep`, with `error_message` truncated to 1000 characters.

### 12.3 Detail page aggregation rule overhaul

`OptimizationService.getOptimization` concurrently fetches all three of `experiments` + `run_results` + `optimization_round_steps`, and `toDetail`'s "real data" determination is changed to `rounds.length > 0 || roundSteps.length > 0` — if either source is non-empty it goes through real aggregation:

- `rounds[]` is `experiments ∪ round_steps` merged by `round_index`; a round appearing in either source generates a card
- Under `from_dataset_only`, the baseline experiment that `source_experiment_id` points to is also merged into `rounds[]` as the `round_index=0` baseline round; if in the future that experiment already carries `optimization_id + round_index=0` pointing back, the latter takes precedence for deduplication
- `round.status` is derived from steps: any step running → `running`; any step failed → `failed`; all success → `success`; all skipped → `paused`; with no steps data, it falls back to the old experiment.status logic
- `round.experimentResult` is only populated when the experiment row exists, otherwise `undefined` (the frontend uses a stepper + error banner instead)
- `round.steps[]` is output in a fixed order (`error_analysis` → `generate_prompt` → `experiment`); a missing step is treated as pending (the frontend uses a muted dot as a placeholder)
- `round.promptDiff` can also be constructed as a backstop from the generate run_result when the experiment row is missing (`buildPromptDiffWithoutExperiment`)

### 12.4 Frontend display

The detail page's `TimelineRoundCard` header introduces a `RoundStepIndicator` (three dots + a connecting line):

- pending → muted hollow + gray step name
- running → info solid + animate-pulse
- success → positive solid + ✓
- failed → danger solid + ⚠
- skipped → muted hollow + semi-transparent

When each step fails, a `StepErrorBanner` (error class name + error message) is displayed at the bottom of the corresponding block, covering:

- End of `ErrorPatternBlock` → displays the `error_analysis` step error
- End of `PromptDiffBlock` → displays the `generate_prompt` step error
- The outer layer of `ExperimentResult` (or the fallback view) → displays the `experiment` step error

`ImprovementSuggestionsBlock` and `ErrorPatternBlock` share the same `error_analysis` LLM call and do not re-render the banner.

### 12.5 Recovery (subsequent PR)

A mid-flight workflow crash may leave a step stuck in `running` forever. On startup, `OptimizationRecoveryService` scans round_steps rows with `status='running'` whose corresponding `optimization.status` is already finalized, and writes them back to `skipped`. The current version does not block the first release; a subsequent PR will handle it.
