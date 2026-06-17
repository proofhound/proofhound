# 27 · Releases

## 1. Page Role

Releases is the unified production entry point under `/releases`, covering both the canary stage and the production state. Through releases, users wire a prompt version into a real upstream connector and gradually roll it out based on live run results, manual annotations, and business feedback.

The unified releases page solves three things:

- Wiring up live traffic for the first time.
- Adding a canary candidate on top of an existing production, supporting traffic split or dual run.
- Managing the production event stream, including promotion, configuration changes, rollback, and force stop.

Canary is no longer a separate page but a candidate lane within the release line. Production release is also no longer a separate page but a production lane within the release line.

## 2. Release Line Model

The unified releases page organizes production traffic by **release line**:

- A release line owns a release name that is unique within the project; duplicate names must be rejected at creation time.
- A release line is bound to one prompt and one upstream connector.
- The upstream connector is immutable after the release line is created; to switch the upstream, you must create a new release line.
- A release line has at most one current production lane.
- A release line has at most one running canary candidate lane at any time (an MVP constraint to avoid multiple candidate routes interfering with each other).
- Creating a new canary candidate on a release line that already has a running or stopped canary replaces the previous candidate event, while preserving that candidate's history and run results.
- A canary candidate must select some prompt version under the same prompt and may use a different model.
- A canary candidate may reuse the production downstream connectors, or add or switch to other downstream connectors; the upstream connector cannot be changed.

System label semantics:

- The canary candidate version receives the `canary` label.
- The current production version keeps holding the `production` label until the candidate version is promoted at split 100%.
- When the candidate is promoted, the `production` label moves to the candidate version, and the `canary` label is cleared or moved to the next candidate.

A prompt version is frozen immediately once it is referenced by a canary or production; freezing only constrains the version content from being modified and does not replace the release state machine.

## 3. Production State

A prompt's production state uses the current running production lane as the source of truth:

- A prompt has at most one production version at any time.
- When a prompt version becomes production, the `production` label on the prompt asset page moves to that version.
- Adding a canary candidate when there is already a production does not change the current production state.
- The current production version stays production until the candidate version fully takes over at split 100%.
- After the candidate version is promoted, the old production lane is marked `stopped(replaced)` and the new version becomes production.

Therefore, the "canary in progress" next version does not strip the current online version of its production state; production only switches once the 100% takeover is complete.

## 4. First-Time Release Path

### 4.1 Queue Connectors

Queue connectors such as Redis / Kafka start from canary by default on the first release:

1. The user selects the prompt version, model, upstream connector, downstream connectors, field mappings, external ID field, filter rules, and the initial traffic ratio.
2. The system freezes the target prompt version and moves the `canary` label to that version.
3. The release runner starts consuming live traffic per the configuration and writes run results.
4. The user manually adjusts the ratio based on metrics and annotation results.
5. Once the split ratio reaches 100%, the system changes the release line state to production, writes a `promote_canary` production event, and moves the prompt's `production` label to that version.

A first-time queue canary can be configured to observe only without pushing back to the business, or to push to a test downstream. Whether a real production downstream is wired in is explicitly configured by the user in the output connectors.

The user can also explicitly choose "go straight to production", which is equivalent to creating a release at split 100%.

### 4.2 Webhook Connectors

Webhook input connectors do not surface the canary concept on the first release and create production directly:

- Each webhook request is naturally an explicit call, so the first release does not face the problem of carving out part of the traffic from an existing queue production consumer.
- Once the first production is submitted it immediately enters `running`, and synchronous or asynchronous webhooks return results per the connector configuration.
- Afterwards, a canary candidate can be added on this production release line using split or dual_run.

## 5. Queue Traffic Configuration

A queue connector release must provide a complete live traffic routing configuration.

Required configuration:

- **Request external ID field**: an external ID must be mapped from the upstream message, and the run result writes `external_id` at the top level. The external ID is used for business lookback, dual-run comparison, and stable traffic splitting; it is not an idempotency key and not a uniqueness constraint.
- **Field mappings**: map upstream message fields to prompt variables. Every prompt variable in the selected prompt version snapshot must have a non-empty upstream source field before a canary or production release can be created or before an editable lane's input route can be saved. Mapping targets are constrained to prompt variables, except for the `target='id'` compatibility row derived from the request external ID field; the variable mappings must not reverse-override the external ID field.
- **Filter rules**: field-based boolean rules supporting nested AND / OR / NOT, with a maximum depth of 5 levels. Messages that do not match the filter do not enter the canary candidate.
- **Traffic ratio**: when creating a canary candidate, `0 < traffic_ratio <= 1`; subsequent adjustments allow `0 <= traffic_ratio <= 1`, where `0` means the canary candidate pauses receiving traffic and production retains 100%.
- **Traffic mode**: `split` or `dual_run`.
- **Canary stop conditions**: when creating a canary candidate, the user may keep manual stopping by leaving every automatic condition unselected, or select processed run-result count (`maxSamples`), elapsed runtime seconds (`maxDurationSeconds`), or both. The conditions are stored in the release event's run snapshot under `run_config.stopConditions`; no extra table column is introduced. When any configured condition is reached first, the runner marks the canary event `completed` and releases the canary slot without changing the current production lane.
- **Output connectors and output mappings**: can inherit from production, or be changed to a test downstream, an observation downstream, or an additional downstream. Each selected output connector owns its own output mapping rules; one lane can therefore deliver different JSON shapes to different downstream connectors.

Routing order:

1. Parse the upstream message.
2. Read the external ID; if it fails, record a configuration error and do not enter the LLM call.
3. Execute field filtering.
4. For filter-matched messages, perform stable hash bucketing by `external_id + release_line_events.id`.
5. Decide, based on the traffic mode, whether to enter the production lane, the canary candidate lane, or to dual-run both.

The goal of stable hashing is to keep the same external ID assigned as consistently as possible under the same canary candidate, avoiding the same business object repeatedly jumping groups when the user adjusts the ratio.

## 6. Traffic Modes

### 6.1 Split

`split` means carving out a portion of online production traffic and handing it to the candidate version:

- When there is a production lane, messages hitting the canary ratio are processed by the candidate version, and the rest continue to be processed by the current production version.
- In a first-time queue canary with no production lane, messages hitting the canary ratio are processed by the candidate version; messages that do not hit produce no ProofHound output. This mode suits wiring in mirrored traffic, test queues, or scenarios where the upstream can already tolerate partial takeover.
- Once the candidate ratio reaches 100%, the candidate version is automatically promoted to production, and the old production lane is marked `stopped(replaced)`.

Only `split` at 100% triggers promotion.

### 6.2 Dual Run

`dual_run` means the online production still processes and returns 100% of the primary results, and the candidate version only performs mirrored runs:

- When there is a production lane, production keeps the canonical output for all requests.
- The candidate version receives the same batch of inputs per the canary ratio, writes run results, and may push to an observation downstream or a test downstream.
- Adjusting the dual-run canary ratio only controls how much traffic is mirrored into the candidate lane; it does not imply or display a matching production ratio adjustment because production continues to handle 100% of primary traffic.
- The candidate run results are compared against the production results via `external_id` and routing metadata.
- Even when `dual_run` is dialed up to 100%, it is only a full dual run and does not promote automatically; the user must switch to split and complete a 100% takeover, or explicitly create a promotion action.

## 7. Adding a Canary on Production

A user can add a canary on a release line that is already in production:

- The canary candidate no longer separately displays, inputs, or saves a release name and description; the `submit_reason` of the current production release event remains the source of truth for the release name / description, and the candidate inherits the parent production's `submit_reason` when promoted at split 100%.
- The upstream connector inherits the current production and is immutable.
- The candidate version must belong to the same prompt and can only select a different version under that prompt; you cannot switch the prompt or upstream when adding a canary candidate.
- The request external ID field and field mappings inherit the current production and are locked; the user cannot re-select them when adding a canary candidate.
- The filter rules inherit the current production by default.
- The downstream connectors are constrained by the traffic mode: the `split` traffic-split mode locks the current production's output connectors; the `dual_run` dual-run mode must keep the current production's output connectors and allows additionally selecting an observation downstream or a test downstream.
- The current production prompt version stays in the production state until the candidate version reaches split 100%.
- During the canary period, the candidate version holds the canary state and label, without affecting the current production's prompt state.

Adding a canary supports two common paths:

- **Traffic split**: choose split to gradually carve out 0% to 100% from the current production traffic; traffic hitting the ratio is handed to the canary runner, and the remaining traffic continues to go to the production runner.
- **Dual run**: choose dual_run to let the production runner keep handling all online traffic while the candidate runner performs mirrored runs and metric comparison on the same batch of traffic that hits the ratio.

## 8. State Machine

Release events use `lane_type` to distinguish production from canary, and `status` only describes the lifecycle. The system no longer uses `pending`; after a release operation is submitted it directly enters `running`, and enters `failed` when it cannot run.

```text
running -> stopped -> running
        -> completed
        -> cancelled
        -> failed
        -> archived
```

Release line states:

```text
running -- stop line --> stopped
stopped -- start line --> running
stopped -- archive line --> archived
archived -- unarchive line --> stopped
```

Notes:

- `release_lines.status='running'` only means the release line has at least one currently running lane. Canary-only, production-only, and production-with-canary are derived from the current production / canary event pointers and their `lane_type`, not stored as line statuses.
- `current_production_event_id` and `active_canary_event_id` are also the detail-page slot pointers. They keep the latest visible production / canary slot snapshot when the line is stopped or archived, while the runner and webhook runtime only execute referenced events whose own `status='running'`.
- A stopped release line remains resumable. Starting a stopped line writes `resume_lane` event(s) from the stopped production and canary slot snapshots and re-enters `running` without modifying historical events or asking the user to reconfigure the route.
- An archived release line is non-runnable and hidden from active operation, but it can be unarchived. Archiving writes `archive_line` snapshot event(s) for the occupied production / canary slots and keeps those snapshots visible on the detail page. Unarchiving writes `unarchive_line` event(s), restores the same slots to `stopped`, and never resumes traffic directly; the user starts the line explicitly afterwards.
- `lane_type='canary' AND status='completed'` indicates the canary candidate has been promoted to production or finished observation and no longer occupies the canary slot.
- Stopping a canary only stops the candidate lane, not the current production lane. The release detail UI treats stop as the primary way to end the current canary attempt; a later "add canary" action can replace the stopped candidate with a new candidate.
- `cancel_canary` remains in the event stream for system and legacy API paths, and retains the run results already written.
- A production force stop also cancels the running canary candidate under that release line.

## 9. Release Event Stream

Every production release, canary creation, traffic adjustment, pause, resume, cancellation, promotion from canary, configuration change, rollback, and force stop is an operation record in `ph_releases.release_line_events`. The event stores the executable snapshot after the operation, used for running, rollback, history, and canvas display.

A newly written executable event inherits only the configuration snapshot, not the runtime counters of the old event. The `metrics` and `total_received` / `total_processed` / `total_filtered` / `total_correct` / `total_errors` of the new `release_line_events.id` produced by `traffic_updated`, `mode_updated`, `config_changed`, `promote_canary`, and `rollback` start from empty values or 0; the old event keeps its own run results and counters for historical traceability.

### 9.1 Release Versions

When a user views run results and creates annotation tasks, the core filter object is not a single event ID but a **release version**:

- A release version represents one publishable lifecycle unit within a release line. It binds the prompt version, model, and executable release snapshot family to a user-facing version label.
- Production release versions are numbered monotonically within the release line as `v1`, `v2`, `v3`, etc. The first production under a release line is always `v1`; rollback to an older executable snapshot creates the next production version number instead of reusing the old one.
- Canary release versions are candidate attempts for the next production version. Before `v1` exists, canary candidates are displayed as `v0.1`, `v0.2`, etc., meaning "candidate attempts looking for `v1`". After `v1`, candidates looking for `v2` are displayed as `v1.1`, `v1.2`, etc.; they are candidates under the `v1 -> v2` journey and are not production semantic-version minors.
- The database stores version structure rather than parsing the label: `kind='candidate' | 'production'`, `production_version_number`, `candidate_number`, `target_production_version_number`, and `promoted_from_release_version_id`. The user-facing label is derived from those fields.
- Creating a new canary candidate creates a new candidate release version. Going straight to production creates a new production release version. Promoting a canary through split 100% or an explicit promotion action creates a new production release version that points back to the candidate with `promoted_from_release_version_id`.
- Adjusting traffic ratio, switching between `split` / `dual_run`, pausing, resuming, cancelling, force-stopping, archiving, unarchiving, or changing only runtime controls such as RPM / TPM / concurrency reuses the existing release version.
- Restoring a historical event into the current production or canary slot creates a new release version, because it starts a new publishable lifecycle attempt from an old executable snapshot without rewriting that old snapshot's run results.
- `config_changed` creates a new release version when it changes a version-affecting execution dimension such as prompt version, model, output schema, downstream result mapping, or temperature; otherwise it reuses the current version.
- `release_line_events.release_version_id` points to the release version; `ph_runs.run_results.release_version_id` redundantly writes the same ID to facilitate run result queries and annotation task sampling.

Release versions are not a deduplicated prompt version + model lookup table. The same prompt version and model may appear in multiple release versions, for example when a rollback creates a new production version from an older snapshot or when a previously tested candidate is tried again later.

Promotion does not rewrite history. Run results written during canary keep the candidate release version, and run results written after promotion use the new production release version. The production version carries the relationship to the promoted candidate, so the UI can offer two useful scopes:

- **Exact version**: only run results whose `release_version_id` is the selected version.
- **Release journey**: for a production version, include the production version plus candidate versions whose `target_production_version_number` equals that production number; for a candidate version, include only that candidate unless the user switches to its target production journey.

Annotation tasks default to the exact-version scope and, in the new-task UI, use all current run results under the selected release version rather than asking the user to choose canary versus production data. A release-journey annotation task remains a backend-compatible scope and is allowed only when all included release versions have compatible annotation categories derived from their prompt version snapshots; otherwise the user must annotate one exact release version at a time.

### 9.2 Release Quality Metrics

The release detail page's Quality tab shows release-observation quality metrics, not annotation-task workbench progress. It must not display annotation task match rate, matched count, mismatched count, submitted count, or annotation-task totals as primary quality indicators; those values are for annotation operators and do not explain release quality well enough for production decision-making.

The Quality tab plots the following classification metrics:

- Recall
- Precision
- F1
- Accuracy

Quality scopes include the overall result and each concrete classification label present in the release quality metrics, for example `positive` and `negative`. The release version, scope, and metric controls are all multi-select dropdowns. The release version control provides quick selections for all production versions and all canary candidate versions. Changing any selected versions, scopes, or metrics updates the line chart; each selected scope + metric pair is rendered as its own trend series over the selected release versions. When many versions, scopes, or metrics are selected, the chart keeps a stable full-width plotting area, automatically reduces dense axis labels, and uses chart-native zoom / slider interactions instead of squeezing points into one side of the plot. The chart also supports zooming into a narrower release-event range and panning that visible range with plot drag, Shift + mouse-wheel movement, or the draggable range selector. The Y-axis adapts to the currently visible quality values with a small percentage buffer, so trends in a narrow range such as 80%-90% remain readable instead of being flattened by a fixed 0%-100% axis.

When a release line has no quality metrics yet, the Quality tab still displays the empty line-chart frame and tells the user to create an annotation task to produce quality metrics.

The chart distinguishes lane semantics in the legend only:

- Production points are green and filled.
- Canary candidate points are blue and hollow.

The lane legend labels are only "Production" and "Canary"; the filled / hollow marker shape communicates their visual meaning. The lane legend does not imply a separate production-data metric series. The plotted series is defined by the selected metrics and selected scopes; production/canary styling only describes which release lane produced each point.

Key dimensions:

- `lane_type='production' | 'canary'`: distinguishes the production lane from the canary lane.
- `operation`: distinguishes operations such as create, adjust ratio, pause, resume, cancel, promote, configuration change, rollback, take offline, and archive.
- `status='running' | 'stopped' | 'completed' | 'failed' | 'cancelled' | 'archived'`.

Operation types:

- `create_production`: create a production directly from a prompt version.
- `create_production_from_experiment`: create a production directly from experiment results.
- `create_canary`: create a canary candidate.
- `traffic_updated`: adjust the canary traffic ratio.
- `mode_updated`: switch between `split` / `dual_run`.
- `config_changed`: a configuration change that does not change the upstream connector.
- `stop_lane`: stop a production or canary lane.
- `resume_lane`: resume a stopped lane through compatibility API paths.
- `cancel_canary`: terminally cancel a canary candidate through system or legacy API paths.
- `promote_canary`: promote a running canary candidate to production after split 100% or through an explicit promotion action.
- `rollback`: roll back to a historical production event.
- `restore_to_production`: copy a historical release event snapshot into the current production slot. The operation replaces the current production event, releases the current canary slot, and writes a new production release version.
- `restore_to_canary`: copy a historical release event snapshot into the current canary slot. The operation replaces the current canary candidate, keeps the current production lane unchanged, and writes a new candidate release version.
- `force_stop`: force stop the current production.
- `archive_line`: archive the release line.
- `unarchive_line`: restore an archived release line to the stopped state.

Reasons for `stopped`:

- `replaced`
- `rolled_back`
- `force_stopped`
- `error`

Release events are retained while their release line exists; historical events are used for rollback, explaining where the current configuration came from, and explaining run results. Permanent deletion is allowed only at the release-line aggregate level. The release detail page exposes this destructive action from the settings tab's danger area, not in the primary operation buttons; the user must confirm by typing the release name before the delete request is sent.

## 10. Release Event Snapshot

Each `release_line_events` row stores a complete run snapshot:

- The prompt and prompt version snapshot.
- The model snapshot; a configuration change allows switching the model used by the current lane within the same release line.
- The upstream connector snapshot.
- The downstream connector list snapshot.
- The request external ID field.
- The field mappings.
- The filter rules.
- The output mappings. New release event snapshots store output mappings by output connector, using `connectorId` plus that connector's `source -> target` mapping rows. Older snapshots that store a single flat mapping array are still interpreted as a lane-wide fallback mapping for every selected output connector.
- The recording mode: `all` records every release run result; `selected_categories` records according to selected classification values that the current prompt version's output schema says `expected_output` may produce. The selected values are stored as `record_categories` and matched against the run result `decision_output`. When online traffic has no true `expected_output`, the release runner still parses the model output category and leaves correctness unknown. Recording mode must not mean "only correct" because online production traffic usually does not know the correct label at invocation time.
- Runtime constraints: RPM / TPM / concurrency / temperature. Image input capability is determined by the model's capabilities and the prompt / dataset content, and is not a runtime configuration item of the release lane.
- Canary stop conditions: manual, processed count, elapsed runtime, or both automatic conditions together. The release detail node details must display the configured condition for the canary lane.
- The change reason.

The upstream connector is part of the release line and may not be modified via `config_change`. If the user wants to switch the upstream connector, they must create a new release line; the old line can be kept, stopped, or deleted.

The model, downstream connectors, filter rules, field mappings, output mappings, recording mode, and runtime constraints can be updated via a new `config_change` event. In the topology canvas, the production release node details edit the production lane's input-route field mappings, request external ID field, filter rules, recording mode, and runtime parameters, while the canary release node details edit the canary lane's corresponding settings. The input route node details are reserved for traffic routing controls. The output route inspector opens the output route editor for the current production and canary lanes. The output editor lets the user select downstream connectors and configure one output mapping rule set per selected connector. The old running event is marked `stopped(replaced)` and the new event enters `running`.

After a production event is submitted, the following executes transactionally:

1. Validate that the prompt version, model, and connectors are available.
2. Validate that the upstream connector is not occupied by another active release line.
3. Generate `prompt_snapshot` / `prompt_version_snapshot` from the current prompt and prompt version.
4. Stop the old running production event of the same prompt, with the reason written as `replaced`.
5. Write the new release event with `lane_type='production' AND status='running'`.
6. Freeze the target prompt version.
7. Update `prompts.current_online_version_id` and move the system `production` label to the target version.
8. The release runner begins consuming and routing traffic per the event snapshot on the next tick.

## 11. Webhook Production

Webhook production is request-time routing:

- Synchronous webhook: the production lane returns the canonical response.
- Asynchronous webhook: the production lane returns a `call_id`, and the result is written to a short-lived receipt and the run result.
- When a split canary hits the candidate, the synchronous response returns the candidate result; when it does not hit, it returns the production result.
- A dual_run canary always returns the production result, and the candidate result is only written to run results and the observation downstream.
- Both the webhook and queue runners write run results uniformly per `release_line_events`: `source='release'`, `source_id=release_line_events.id`.

A first-time webhook release has no canary concept; the "add canary" entry only appears once a production already exists.

## 12. Rollback and Stop

Rollback selects a historical production event as the target and submits a `rollback` event:

- The current running production event is marked `stopped(rolled_back)`.
- The new running event replicates the target event's prompt version and runtime configuration.
- The rollback event creates a new production release version with the next production version number, and records the source version through the rollback target event. It never reuses the historical production version label.
- The upstream connector must still be the upstream of the same release line.
- If there is a running canary candidate, the candidate must be cancelled before the rollback, or cancelled by the system within the same transaction.

Rollback does not delete historical events, nor does it modify old run results.

A force stop writes a `force_stop` event and marks the current running production event as `stopped(force_stopped)`. The `force_stop` event must retain the upstream connector, downstream connectors, and runtime configuration snapshot of the stopped release line for list, history, and rollback context display; it does not itself occupy the upstream connector. A force stop moves the release line into `stopped` and cancels the running canary candidate under that line. The system does not automatically select a new version, and the prompt's aggregate state becomes offline.

## 13. List and Detail

The `/releases` list displays by release line:

- Release name.
- Prompt name.
- Upstream connector.
- Current production version and model.
- Current canary candidate version, mode, and ratio.
- Downstream connectors.
- Release line state: `running` / `stopped` / `archived`. The table still displays current production and canary candidate columns separately.
- Created time.
- Updated time.
- Operation column: stop a running line, archive a stopped line, and enter the release detail page.

Release lines can be archived or permanently deleted. Stopping only changes the line state and appends/updates historical events, and a stopped line must still be visible in the list. Permanent deletion is a separate dangerous action: after confirmation, any running lane of that line is force-stopped first (in its own transaction) so the runner stops dispatching before the rows are removed — a best-effort barrier against in-flight jobs racing the cascade — and then it removes the release line, release versions, events, release run results, and annotation tasks owned by that release. When a prompt is permanently deleted, running release lanes that depend on it are stopped, but the release line is not automatically erased.

Stopping production from the UI requires a second confirmation and requires the user to type an exact match of the release name before submission is allowed.

The unified release detail page includes:

- **Overview**: merges the release line and traffic configuration, displaying the upstream connector, current production version, canary candidate version, traffic mode, ratio, and state, along with the field filter, field mappings, external ID field, output mappings, and output connectors; the separate "line snapshot" card is no longer displayed. The upstream node details list the available upstream input fields. The production release and canary candidate node details show a compact input-route section for their own field mappings, request external ID field, and filter rules, and allow editing those settings via a `config_changed` event. The input route node details keep only the traffic ratio controls. In split mode, the traffic ratio editor shows the production and canary percentages as complementary values; in dual-run mode, it shows only the canary mirror ratio because production still handles 100% of primary traffic. The production lane card on the release detail page shows a read-only traffic ratio: `100% - canary candidate ratio` when there is a split canary candidate, and `100%` when there is none or when the canary is dual-run; the user can only change it by adjusting the canary candidate ratio or creating a new production release. The production release and canary candidate node details allow modifying the lane's model, runtime configuration, and recording mode via a `config_changed` event, and the model's upper limit for the currently selected model is shown to the right of the RPM / TPM inputs. The model and prompt identities in node details link to their corresponding detail pages. Canary candidate actions on the release detail page expose icon-only stop, promote, and create/replace canary controls in the node detail header; cancel and resume are not primary UI actions. Creating a new canary candidate from the detail page is allowed even when a current canary exists, and the new candidate replaces the current one.
- **Live metrics**: supports quick time-span shortcuts and custom time-range filters; the compact overview area at the top jointly displays the total count, processed count, filtered count, failed count, category counts such as production / canary, as well as the downstream delivery success count, failure count, and failure rate; the engineering metrics reuse the chart card style of the monitoring page, displaying by time bucket the source distribution and trends of RPM, TPM, average latency, P50 / P95 / P99 latency, cost, and failure rate; the primary value in the top-left of each engineering metric chart shows the maximum value of the corresponding time bucket within the selected time range, and the failure rate takes the maximum percentage of errors / requests per time bucket. The failure count and failure rate must follow the run result failure definition in [30 §1](30-run-results.md#1-page-role): `status='failed'`, `judgment_status='parse_error'`, or `judgment_status='judge_error'` all count as failures.
- **Run results**: by default displays the run results produced by the current production lane's and the current canary candidate lane's `release_line_events.id`, to avoid misreading stopped or completed historical events as current traffic; the list must display the release version, prompt version, and model, and supports filtering by release version, version scope, source, lane, release_line_event_id, prompt_version_id, external_id, assignment status, judgment value, error type, and time window. The release-dimension source is fixed to `release` and the event ID is fixed to `release_line_events.id`; day-to-day user filtering prefers exact `release_version_id`.
- **Quality metrics**: displays the quality trend aggregated from historical annotation tasks under this release line; each task with a submitted manual `expected_output` annotation adds a data point, and a "Create annotation" entry is provided; when there are no annotation results at all, it shows "Please annotate first". A manual annotation value represents the correct classification of the current sample, not a binary "correct or not" choice. In the current open-source edition, quality points are aggregated by "whether the manual annotation value equals the run result `decision_output`", and `precision` / `recall` / `f1` are temporarily filled uniformly as `matched / submitted`.
- **History**: production release, canary creation, traffic ratio adjustment, mode switch, configuration change, stop, resume, cancel, promotion, rollback, history restore, archive, and force stop events. Each history item shows the release version, whether it is a candidate or production version, the prompt version, model, traffic / mode, status, runtime counts, and event relationships such as source, superseded, or rollback target events. The detail expand action remains directly visible; run results, annotation creation, config-change display, and restore-to-production / restore-to-canary actions are grouped under the row's more-actions menu.

When the canary candidate lane on the release detail page has no slot occupied, the canary node shows a plus-sign entry; clicking it enters the add-canary-candidate page for that release line. When a current canary already exists, the detail page still offers a new canary action; submitting it replaces the current canary candidate and preserves the previous candidate's history.

## 14. Connectivity Test

A connectivity test must be supported once before starting a canary:

- Queue connectors validate the field structure from a Peek snapshot or a small sample.
- Webhook connectors use the sample payload the user enters.
- The test path covers: external ID extraction, filter rules, variable mapping, prompt rendering, the LLM call, output mapping, and downstream push.
- It returns success / warning / error for each step, avoiding discovering field mismatches only after startup.

## 15. Output Connector Contract

When a canary candidate or production configures an output connector, the release runner pushes a JSON envelope after the LLM worker writes `ph_runs.run_results`:

```json
{
  "external_id": "upstream-sample-id",
  "run_result_id": "uuid",
  "release_line_id": "uuid",
  "release_line_event_id": "uuid",
  "lane": "canary",
  "traffic_mode": "split",
  "status": "success",
  "result": { "label": "positive" },
  "raw_response": "{\"label\":\"positive\"}",
  "parsed_output": { "label": "positive" },
  "decision_output": "positive",
  "error": null,
  "metrics": {
    "latency_ms": 123,
    "input_tokens": 10,
    "output_tokens": 4,
    "cost_estimate": 0.001
  },
  "source": { "type": "release", "id": "release-line-event-id" },
  "created_at": "2026-05-21T10:00:00.000Z"
}
```

- `external_id` always comes from the request external ID field and is placed at the top level.
- `result` defaults to `parsed_output`, falling back to `decision_output` / `raw_response` in order when there is no structured output.
- When an output mapping is configured for a connector, the target object delivered to that connector is generated from `parsed_output` or built-in fields per `source -> target`. If a selected connector has an entry with no mapping rows (empty `outputMapping`), it receives the default result envelope shape. If an older lane-wide mapping snapshot is present (a single flat mapping array, or no mapping at all), the runner applies that mapping to every selected connector and falls back to the default result envelope. However, when the snapshot uses the per-connector form and a selected output connector has **no entry at all** for it, that connector is **excluded**: the runner delivers nothing to it (it does not receive the raw default envelope), preventing an unintended full-payload leak to a connector the operator did not map.
- A Redis List writes a JSON string; a Redis Stream writes the `payload` field and additionally writes `external_id` / `run_result_id` / `status`; a Kafka value writes the full JSON, and the message key prefers the connector-configured `partitionKey`, falling back to `external_id` / `run_result_id` when not configured. The Kafka output producer allows auto-creating topics by default; if auto-creation is disabled on the broker side, the topic must still be created in advance.

## 16. Key Constraints

- A prompt has at most one running production lane at any time.
- An upstream connector belongs to at most one active release line at any time.
- Release names are unique within the same project.
- The same release line can simultaneously have one running production lane and one running canary candidate lane.
- The same release line has at most one running canary candidate at any time.
- The upstream connector is immutable within a release line.
- A first-time webhook release goes straight to production; a canary can only be added afterwards.
- Only a queue release's split 100% automatically writes a `promote_canary` production event.
- The request external ID field is required for all live traffic releases.
- Configuration changes, rollback, and force stop must all go through the event stream.

## 17. Relationship to Other Features

- **Prompts**: a canary candidate or production references and freezes a prompt version; the `canary` / `production` labels are version pointers and do not replace the release state.
- **Connectors**: the upstream connector is exclusively owned by and immutable within the release line; downstream connectors can be configured per the production / canary lane.
- **Experiments**: an experiment can create a production directly via `from_experiment`.
- **Run results**: production and canary candidates uniformly write `source='release'`, `source_id=release_line_events.id`, and write `release_version_id`; dual-run is compared via `external_id`, `lane_type`, the release version, and the release event snapshot. Live release traffic only runs automatic judgment when the expected value can be retrieved from the input payload per `judgment_rules.expected_field` (default `expected_output`); when there is no expected value, `judgment_status` is empty and the quality judgment is left to the annotation task, and a missing ground truth must not be recorded as `judge_error`.
- **Annotation**: annotation tasks are only created manually via `/annotations/new`; canary releases, production releases, the queue runner, and the webhook runner do not auto-create annotation tasks. The create-annotation entry creates a task in the order task name → release name and release version → annotation data amount. Release name and release version are searchable dropdown menus; the release version option cannot display only a UUID and must display the release version label, prompt version, model, and run result count. The annotation data amount supports random sampling from all current run results under the selected version, or per-category counts based on the current `run_results.decision_output` distribution. Manual annotation uses a selection-type control to choose the correct classification of the current data sample, and the classification options are derived from the output schema of the prompt version bound to the selected release version or compatible release journey and written to the `expected_output` field.
