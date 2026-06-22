# 23 · Prompts

## 1. Conceptual layering

Prompts are split into two layers in the platform:

- **Prompt (the shell)**: a logical object that users can name and reference, e.g. "Content Moderation Prompt". It carries no body text itself; the user-facing surface only displays and selects the prompt by name, and does not require the user to maintain extra "identifier" or "description" fields. The shell layer also holds a **bound dataset** field (`default_dataset_id`, **nullable**, can be bound later in the editor), representing the dataset that all versions of this prompt align with by default — used for variable autocompletion in the editor, the default data source for optimization, and pre-checks before experiments / releases. When unbound, every capability that depends on this field (variable autocompletion, judgment field derivation, alignment validation) falls back to an empty state or placeholder.
- **Prompt version**: the actual content snapshot, containing the template body, the **variable list**, output field definitions, and judgment rules. Every edit produces a new version, and versions are immutable.

Prompt shells have two existence states:

| Prompt state | Meaning                                               | New work allowed                                                                                      | Existing work                                                                                                                                |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`     | Normal usable prompt.                                 | Can create new versions, experiments, optimizations, canary releases, and production releases.        | Existing objects continue normally.                                                                                                          |
| `archived`   | Retained for history but removed from creation paths. | Cannot create new versions or new downstream experiments / optimizations / releases from this prompt. | Existing experiments, optimizations, releases, and run results continue from the prompt version / release snapshots they already referenced. |

Prompt names are unique within a project; when creating a prompt, or when a from_dataset_only optimization auto-creates a prompt, the name must not collide with a non-deleted prompt in the same project. When the user enters a name, if the frontend detects a duplicate within the project it should prompt "This name is already in use", and the backend still enforces this via a uniqueness constraint as a fallback.

> The point of immutability: once an experiment, canary release, or production release references a particular version, the metrics shown will always correspond to the prompt content at that moment; you will never end up in a situation where "the metrics look good, but someone has quietly changed the prompt."

**Self-description principle**: once a prompt version is frozen it is **fully self-describing** — `body` + `variables` (the interface contract) + `output_schema` + `judgment_rules` + `prompt_language` together are enough for every experiment / release canary candidate / production that references it to understand its shape and the platform-generated instruction language **independently of the dataset and connector**. Even if the corresponding dataset is force-deleted, every downstream object referencing this version can still correctly display what input this prompt requires and what structure it produces.

**Prompt language**: each prompt version additionally holds `prompt_language ∈ {'zh-CN','en-US'}`, representing the language of the platform-generated LLM-facing instructions — including the output-format section assembled at runtime from `output_schema`, the full prompt preview, and the default generation language used when an optimization continues rewriting on top of this version. `prompt_language` is part of the version's execution contract and cannot be modified after freezing; it is **not the same as the frontend UI language**, and it does **not automatically translate** the user-written body, dataset content, classification labels, or JSON field names. Historical versions default to `zh-CN`.

## 2. Version freeze semantics

Prompt versions no longer have a "draft / experimenting / canary / released" version state machine. All newly created versions are **editable versions** by default; once a version is referenced by an experiment, canary release, production release, or optimization run result, the system immediately marks the version as **frozen** (`is_frozen=true`) and writes `frozen_at`.

Freezing answers exactly one question: can this version's execution contract still be modified.

- `is_frozen=false`: editable. Modifying `body / variables / output_schema / judgment_rules / prompt_language` is allowed, and hard deletion is allowed.
- `is_frozen=true`: frozen. No execution-contract field can be modified any more; to make changes you can only copy it into a new version.

Experiment state is expressed by the `ph_runs.experiments` table; canary and production releases are uniformly expressed by the `ph_releases.release_lines` / `ph_releases.release_line_events` tables. The legacy `canary_releases` / `production_release_events` tables are no longer the source of business reads/writes or queries; once historical data has been backfilled into release line events, the old tables can be cleared. The prompt asset page only shows freeze status, label pointers, and the current live version, and no longer folds release transitions into a prompt version status.

## 3. List page

Lists all prompts within the instance, with each row showing:

- Name, current latest version number
- Current canary version number, current production version number
- User-defined labels (the system labels `latest / canary / production` are not shown in this column)
- Created time, last updated time

The list page only provides a table view, and no longer provides a board view. The OSS UI does not show a "creator" column; the platform edition can keep `created_by / created_by_display_name` as an extension hook, but when actually displayed it must use the user's name / display name and must not directly display the user id.

Available actions:

- Create a new prompt (the dialog on the list page only asks for the **name**; the bound dataset is no longer chosen in the dialog — binding is instead done at any time inside the editor, and when unbound the top of the editor shows a red "No dataset bound" notice using the destructive token. On submit, an empty editable v1 is automatically generated and the user is redirected to the editor).
- Archive / restore. Archiving writes `prompts.status='archived'` and `archived_at`; restoring writes `status='active'` and clears `archived_at`. Archiving does not touch existing experiments, optimizations, release lanes, or run results.
- Permanently delete. Before deletion, the deletion hook described in [06 §1](06-database-schema.md#1-general-conventions) must return an impact plan. The OSS plan lists affected release lines first, then experiments and optimizations; release impact is shown only at release-line granularity, not as individual canary / production events. After confirmation, the prompt and its versions are physically deleted, affected experiments / optimizations plus their owned descendants are deleted, and any running release lane that depends on the prompt is stopped. Stopped releases keep their snapshots for history unless the release itself is permanently deleted.
- Directly "start experiment / start optimization / create release / add canary on production" from a row, prefilling that prompt + its latest version. These actions are only available when the prompt is `active`.

## 4. Detail page (core interaction)

The detail page is built around a specific prompt, split into two blocks by tabs:

### 4.1 Versions tab

- The Versions tab carries both prompt body editing and version control, and no longer makes "versions" a standalone page. The left side of the page is the version list and version actions, the right side is the main workspace for the currently active version; clicking any version switches the right side to that version, with frozen versions shown read-only. On narrow screens the version list can collapse above the main workspace.
- The main workspace on the right provides sub-tabs:
  - **Prompt**: edit the body and output schema, view the variable list and full prompt preview
  - **Config**: configure the prompt language and bound dataset
- The Config sub-tab shows the dataset currently bound to the prompt, switchable in a picker; actions within Config (switching the bound dataset, switching the prompt language) are **persisted immediately** and do not depend on the manual save in the Prompt sub-tab. Switching the dataset writes to `prompts.default_dataset_id` and synchronously saves the version's variable list and dataset-derived judgment fields.
- When `default_dataset_id` is empty (newly created but unbound / the bound dataset was force-deleted), a red banner using the destructive token above the picker in the Config sub-tab clearly shows "No dataset bound", reminding the user that pre-checks before experiments / optimizations / releases will be blocked as a result.
- The variable list card in the Prompt sub-tab shows a shortcut action when no dataset is bound; when the current project already has datasets it is "Bind dataset", and when no usable dataset exists it becomes "Upload dataset" and redirects to the upload page.
- Writing the prompt body: variable references (`{{variableName}}`) are supported, and can be autocompleted from dataset fields.
- Declaring the **variable list**: the editor automatically extracts all `{{variableName}}` from the body, and the user supplements each variable with a type (text / image / image URL / image base64 / number), whether it is required, and explanatory text. This list is the prompt's "interface contract" and exists independently of the dataset.
- Configuring the **output schema**: declare the list of expected output fields. Each field is a `{ key, value }` pair:
  - `key`: the JSON field name the model must return
  - `value`: the placeholder description spliced into the prompt to tell the model what to fill in for that field (plain text, not parsed by the model as a type)
  - The user-facing surface only shows the key + value input boxes; it no longer selects a field type / enum values / field description, nor does the user tick "is judgment field"
- **Judgment field derivation rule** (automatic, read-only):
  - When the dataset bound to the prompt has a field with the `role=expected_output` role, the output schema automatically derives a **judgment field**:
    - `key` = the dataset's expected_output role field name (e.g. `label`)
    - `value` = all enum values that have appeared for that field in the dataset, joined with the literal separator `或` (Chinese for "or"; e.g. `true 或 false`), with data sourced from `dataset.categoryDistribution.categories[].label`
  - When no dataset is bound / there is no expected_output field, it falls back to a placeholder item: `key=expected_output` / `value=expected_output`
  - The judgment field is completely non-editable and non-deletable in the UI; it refreshes in real time when dataset fields or enum values change; on saving the version it is solidified into jsonb according to the dataset state at that time, and is frozen along with the version after freezing
- Configuring **judgment rules**: declare "what kind of output counts as correct (a hit)" — e.g. "enum value matches certain values", "numeric value exceeds a threshold", "equals the expected output", etc. New writes use the canonical JSON shape `judgment_rules = { rules: [{ decisionField, expectedField, operator, ... }] }`:
  - `decisionField`: the model output JSON field to judge. By default this is the derived judgment output field in `output_schema`.
  - `expectedField`: the dataset sample field from which the run-time `expectedOutput` value is read. When a dataset is bound, this is automatically set to the dataset field whose role is `expected_output`; when none is available it falls back to the legacy literal `expected_output`.
  - `expectedOutput`: not stored on the prompt version. It is the per-sample value resolved at experiment / optimization / release run time and then persisted on `ph_runs.run_results.expected_output`.
  - Legacy stored JSON such as top-level `expected_field / decision_field`, camelCase top-level keys, and first-rule `field / value` is supported on read only. New frontend and backend writes must emit the canonical camelCase rule shape.
- **Full prompt preview**: a standalone read-only preview area at the bottom of the editor, displaying the final prompt assembled as `body + output schema`; variables keep the `{{variableName}}` placeholder and are not rendered with sample values, making it convenient to proofread the overall template effect.
- **Prompt language**: the Config sub-tab provides a version-level language selection (V1 supports Chinese / English). Editable versions can switch and save immediately; frozen versions are shown read-only. Switching the language only affects the platform-assembled output-format instructions and the direction of subsequent optimization generation, and does not rewrite the body content.
- When generating a response, the model is forced to return JSON conforming to the schema, and the platform automatically parses it and judges it by the rules.

**Legacy version data compatibility**: the `output_schema` jsonb of early versions may contain `type / is_decision / enum_values / description` fields; on read, only `name → key`, `description → value`, and `is_decision → isJudgment` are retained, and the remaining fields are discarded. New writes only use the three fields `{ key, value, isJudgment }`.

### 4.2 Version control panel

The version control approach references Langfuse's "immutable versions + movable labels" model, but retains ProofHound's canary release / production business semantics:

- **Versions** form a history chain via `version_number`; unfrozen versions can continue to be edited, and after freezing the body, variables, output schema, judgment rules, and prompt language cannot be modified
- **Labels** are movable pointers to a specific version. The system reserves three labels — `latest`, `canary`, `production`:
  - `latest` is automatically derived by the system, always points to the version with the highest version number, and cannot be moved or deleted manually
  - `canary` represents the current canary candidate version on the unified release page; it does not replace the candidate lane state machine in the release line
  - `production` represents the version the current production lane is using; when the next version is still in canary or dual-run, this label stays on the current production version until the candidate's split is promoted to 100%
- Users can add custom labels, e.g. `回归集`, `staging`, `ab-a`, `tenant-demo`. Within the same prompt, a label can point to only one version at a time; assigning a label to a new version moves the same-named label off the old version
- Custom labels may only contain Chinese characters, letters, digits, underscores, dots, colons, and hyphens; the first character must be a Chinese character, letter, or digit; the length is 1-64; and they cannot use system semantics beyond the reserved label names
- The version row shows freeze status, label, creator, whether it was generated by an optimization, the reason for change, and a variable type overview; labels and freeze status are displayed separately to avoid conflating "whether a version is editable" with "human-movable pointers"

- Displays all versions in reverse chronological order
- Each version shows freeze status, label, creator, whether it was generated by an optimization, and the reason for change
- Each version shows a "variable type overview" pill group on the same row (derived by deduplicating the `variables[].type` declared on that version: text / image / image_url / image_base64 / number; the three image subtypes are uniformly rendered as an image pill), using the `--modality-*` theme tokens consistent with the dataset modality badge colors
- When the dataset bound in the Versions tab context has `hasImages=true` but the current version's variables declare no image type (none of `image` / `image_url` / `image_base64`), add `<UnusedImagesBadge scope="promptVersion">` (gray outline + `ImageOff` + tooltip) next to the "Bind dataset" heading in the Config sub-tab, indicating "has images, unused"
- Comparing the diff of two selected versions is supported; the diff is no longer a permanently resident page area, but is instead shown in a dialog after clicking "Compare diff", making it convenient for the editor and version list to share one screen
- The "New version" button in the left-hand version list creates an **editable version with an empty body** by default: `body=''`, `parent_version_id=null`, used to explore a new branch from scratch; if the current editing context already has a bound dataset selected, the new version inherits the variable list and judgment fields derived from that dataset
- The top-right corner of the current editor provides **Copy as new**: copy a derived new version based on the currently active version. The new version inherits body / variables / output_schema / judgment_rules / prompt_language, with `parent_version_id` pointing to the copied version; multiple unfrozen versions are allowed to coexist within the same prompt
- Physical deletion of an individual prompt version is supported as a separate advanced action. Freeze status only constrains whether the execution contract can be edited, and no longer blocks deletion.
- Before deleting a version, the affected release lines, experiments, and optimizations must be queried and displayed in that order; release impact is shown only at release-line granularity, not as individual canary / production events. After confirmation, the version is deleted according to the same permanent-delete impact semantics as prompt deletion, scoped to that version. Stopping running lanes is itself scoped to the version: only lanes whose live production / canary slot runs the deleted version are force-stopped, after which each affected release line's aggregate status is recomputed from its slot pointers — a line whose live slot runs a different version stays `running` (the line status can never disagree with the events the runner actually executes). This is intentionally different from archiving the prompt shell: prompt archival keeps versions for history, while version deletion can remove the exact execution snapshot used by downstream objects and therefore must show the affected object list first.
- Both deleting a version and copying a version must be completed within the same transaction; on transaction rollback the whole thing is reverted.

### 4.3 Metrics tab

The Metrics tab aggregates `ph_runs.run_results` by prompt version:

- Version number, freeze status, label, first / most recent run time
- generation count, success count, error count
- median latency, median input tokens, median output tokens
- total input / output tokens, total cost estimate
- Hit rate based on `is_correct`: the denominator only counts results where `is_correct IS TRUE/FALSE`, and does not mix parse error / judge error into human-judgeable samples
- Cross-version comparison is supported, showing all versions in reverse chronological order by default; versions with no run results remain in the list and show an empty state

Metrics only shows factual data that has been written to the run results table; try-run does not write `ph_runs.run_results`, so it does not enter Metrics.

### 4.4 Preview capability

- Without actually calling the LLM, take a sample from the dataset to pre-render the prompt, letting the user proofread the template effect
- This differs from the "full prompt preview" at the bottom of the Prompt sub-tab: the bottom of the Prompt sub-tab only shows the literal template (variables stay as placeholders), while the preview capability actually injects the sample fields

### 4.5 Try-run (landed 2026-05-19)

- Synchronously calls `POST /prompts/:promptId/try-run`; given `promptVersionId + modelId + variables` it runs a single real LLM call without writing `ph_runs.run_results`
- Use cases: the run button of the "prompt preview" in the bottom-right corner of the experiment detail page; the prompt editor can reuse the same endpoint later
- Before calling, it passes through Redis centralized rate limiting (sharing the same quota as a normal experiment), and the log writes the full LLM input / response per [SPEC 05 §6](05-logging.md#6-llm-call-logging-contract); it **does not write the run results table** (this is an ad-hoc call, not an experiment run)
- On failure, it returns per the unified error classification: `rate_limit` / `parse` / `timeout` / `internal`
- MCP: `prompt_try_run`

## 5. Version editing rules

- Only **unfrozen** versions can change body / variable list / output schema / judgment rules / prompt language
- Once a version is referenced by an experiment / release canary candidate / production or optimization it is **frozen** — to make changes you can only "create a new version based on it"
- After freezing, `body / variables / output_schema / judgment_rules / prompt_language` (the interface and execution contract) is protected by a DB trigger layer that rejects changes as a fallback, so even an application-layer bug cannot bypass it
- New versions form a "parent version chain", and the UI can trace the evolution process back from any version
- Versions generated by an optimization are tagged with a special marker, recognizable at a glance in the list
- **Multiple unfrozen versions are allowed to coexist** within the same prompt — the platform does not limit the number of parallel exploration branches, making it convenient for users to explore several modification branches off the same live version at once; the UI reconstructs the parent-child relationship via `parent_version_id`

## 6. Pre-release pre-check

Before attempting to wire a version into a real release line, the platform provides a **pre-check view** listing blocking items:

- Whether a production already exists for the same prompt; if so, the new version should by default enter split or dual-run as a canary candidate under that production line
- Whether a dataset is already bound (when `default_dataset_id` is empty it directly blocks, prompting the user to go back to the editor and bind one)
- Whether the bound model / upstream connector is still available
- Whether the expected output fields align with the dataset
- Whether the request's external ID field can be parsed from the sample messages
- Whether the variable mapping covers the prompt version's required variables
- Whether the target upstream connector is already occupied by another active release line; if you are adding a canary on an existing production, you must reuse that line's upstream

The purpose of the pre-check is to surface "release failures" before the operation, avoiding exposing problems only on the production path.

## 7. Relationships with other menus

- **Datasets**: a prompt can optionally bind one dataset (`prompts.default_dataset_id`, nullable) — once bound, experiments / optimizations start from the bound dataset by default, and variables must have corresponding fields findable in that dataset, otherwise the experiment alignment validation will warn; when unbound, these linked capabilities degrade to an empty state, and the pre-release pre-check lists "No dataset bound" as one of the blocking items
- **Experiments**: an experiment runs on a particular prompt version × dataset × model
- **Optimizations**: optimizations automatically produce new versions and tag them
- **Releases**: select a version as the canary candidate or production target; the `production` label is moved only after the canary candidate's split reaches 100%
