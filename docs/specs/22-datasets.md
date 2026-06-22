# 22 · Datasets

## 1. The role of this page

A dataset is the "yardstick for evaluating prompt quality"—the foundation for regression testing, experiments, and optimization.

Each dataset is a collection of **samples**, and each sample has several fields (text, images, expected output, metadata, etc.). The platform does not enforce a fixed field table; whatever fields the user uploads are preserved.

Datasets have two existence states:

| Dataset state | Meaning                                               | New work allowed                                                                                                                                                                                                              | Existing work                                             |
| ------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `active`      | Normal usable dataset.                                | Can be selected for new experiments and optimizations, and can be bound to prompts for alignment / autocomplete / release pre-checks.                                                                                         | Existing experiments and optimizations continue normally. |
| `archived`    | Retained for history but removed from creation paths. | Cannot be selected for new experiments or optimizations; if it is still bound to a prompt, the prompt must be rebound to an active dataset before using dataset-dependent experiment / optimization / release creation flows. | Existing experiments and optimizations are not changed.   |

## 2. List and detail

The page has two levels:

- List level: all datasets within the instance, sorted by creation time, showing name, total sample count, category distribution, field modalities, creation time, update time, etc. **Field modalities are shown in aggregated form**: the set of modalities a dataset contains is derived from field roles (`text` comes from `role=text` fields, `image` comes from `role ∈ {image, image_url, image_base64}` fields); for multimodal datasets, multiple modality icons are shown side by side; purely structured datasets (only id / metadata / expected_output) fall back to a single `text` icon. The category distribution is computed from the scalar values in the "expected output" field, with a horizontal bar showing all category segments; hovering over a specific category segment shows the category name, count, and proportion, while the list also displays the total category count. Creation time / update time are uniformly displayed in the UI as `YYYY/MM/DD HH:mm:ss`.
- Detail level: click into a dataset to browse its samples. **Pagination and search are handled server-side** (`GET /datasets/:id/samples?page&pageSize&search`, LIMIT/OFFSET + cross-field `data::text ILIKE`); the detail page only ever loads the current page at any moment, so even a large dataset is never loaded all at once. Exports are full dumps, but the backend reads them with keyset-paginated batches and streams the file instead of materializing the entire dataset in memory. The sample table and edit cards display all stored fields, sorted by "ID → text variables → images → expected output → metadata", with the action column fixed on the right. The system creation time / update time fields are not displayed by default and can later be enabled via explicit column settings.

> A dataset being imported is **not written to the `datasets` table** until promotion succeeds (see [§3.1](#31-uploading-data)). In-progress import sessions **do not appear on the dataset list page**: progress and failure details are exposed through the dataset import status API and upload page. Only after the asynchronous import job reaches `completed` does a dataset appear as a formal dataset. Failed / aborted sessions are retained long enough for readable status and error display, while staging rows and temporary raw objects are cleaned up best-effort.

## 3. Available actions

### 3.1 Uploading data

Main supported forms:

- Tabular files (CSV / TSV / Excel)
- Line-delimited JSON (one JSON object per line)
- A single JSON array
- ZIP package (CSV/JSONL + images in the same package, automatically encoding images as base64 inlined into samples)

In V1, the current upload page only exposes formats that already have real parsing and backend ingestion wired up: CSV / TSV / JSONL / JSON array / ZIP. A ZIP package must contain one CSV / TSV / JSONL / JSON array data file, with an optional `manifest.json` to specify the data file via the `file` field; if there is no manifest, the parser picks the first data file at the shallowest level. Images in the same ZIP package are referenced by relative path from sample fields, and import parsing converts the images into `data:image/...;base64,...` inlined into the samples. Excel falls under the same upload semantics as a subsequent parser extension; before the corresponding parsing pipeline is wired up, the frontend must not fake "supported" status using sample files, fixed row counts, or fake previews.

Regardless of which path is taken, the user first selects, in the "field mapping wizard", which fields to ingest, then confirms the roles of the selected fields: text variable, image, image URL, image base64, metadata, expected output; at most one field per dataset may be marked as "expected output". Unselected fields are not written to the sample JSON, nor do they enter the field manifest.

**There is no hard upper limit on a dataset's total sample count**; large files are fully ingested through one of the import paths below. Only the synchronous path keeps a protective threshold on the "number of samples per request", and exceeding it guides the user to a streaming path—this is request-body protection, not a dataset-size limit. The original uploaded file is not retained as a source of business truth after import; the ingested `dataset_samples.data` or normalized object-storage shards are the only data source for frontend display and experiment runs.

The upload/import surface has three current paths:

| Path                          | Formats                              | Transport                                                                                                                                                            | When used                                                                                                                             |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Small-file synchronous upload | CSV / TSV / JSONL / JSON array / ZIP | Frontend parses the whole file and submits `POST /datasets`                                                                                                          | Files below the synchronous byte and sample thresholds, primarily for small manual uploads and tests                                  |
| Client-streamed batch import  | JSONL / CSV / TSV                    | Frontend streams/parses the local file, then sends bounded batches to `POST /dataset-imports/:id/batch`; server still atomically promotes from staging on `complete` | CSV / TSV / JSONL above the synchronous threshold but below the raw threshold, or when raw upload is unavailable                      |
| Raw upload + async import     | CSV / TSV / JSONL / small JSON / ZIP | Browser uploads the unmodified file to `ObjectStorageProvider`; server/worker finalizes, streams/parses, stages, then promotes in the background                     | CSV / TSV / JSONL at or above the raw threshold, and bounded JSON / ZIP when the configured provider supports browser upload sessions |

Browser parsing is used only for preview, field mapping, and small-file fallback. For raw import, the backend parse is the source of truth: the worker reads the stored object, applies field mappings, writes staging rows, and promotes the dataset. The raw import path is a generic OSS object-storage capability. It must depend only on `ObjectStorageProvider` and must not embed R2-specific APIs, SaaS plan gates, edition flags, tenant concepts, or billing logic.

`DATASET_RAW_UPLOAD_MAX_BYTES` configures the maximum accepted raw upload size. The OSS default is `2147483648` (2 GiB), and the upload UI also applies a 2 GiB hard cap before parsing so oversized files fail early. Self-hosted deployments may lower the raw maximum, but import still keeps the existing protective limits: single sample / line size, batch row count, batch byte size, decompressed payload size for formats that add compression later, stale import timeout, and cleanup of expired pending uploads.

The upload UI keeps `RAW_IMPORT_MIN_BYTES` at 500 MiB for streaming formats. CSV / TSV / JSONL below that threshold use the client-streamed batch path to avoid the object-storage round trip; at or above that threshold they use raw upload when the provider supports browser upload sessions. JSON arrays and ZIP packages do not have a true streaming frontend parser yet, so they may use raw import only within the bounded raw parser threshold.

The upload page must surface the current size limits next to the file picker with an info icon: the small-file synchronous threshold, the 500 MiB raw threshold for CSV / TSV / JSONL, the effective upload maximum, the supported raw formats, and the fact that JSON array / ZIP raw import uses a bounded buffered parser until a true streaming parser is introduced. The progress panel must name the active transfer stage: client batch import, raw object upload, server-side raw verification, queued, parsing, importing, finalizing, shard organization, and index commit.

Raw import sessions use the following state machine:

| State       | Meaning                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| `created`   | Import session exists and a raw upload session has been issued, but upload has not begun |
| `uploading` | Browser upload is in progress, or a client-batched session is accepting batches          |
| `uploaded`  | Raw upload was finalized and verified by `completeUpload`, but no import job is queued   |
| `queued`    | A `dataset-import` BullMQ job was enqueued                                               |
| `parsing`   | Worker has opened the raw object and is parsing/applying field mappings                  |
| `importing` | Worker is writing staging rows or promoting them into the final dataset                  |
| `completed` | Dataset row and samples are fully promoted; temporary raw object and staging are cleared |
| `failed`    | Import cannot continue; `error_code` / `error_message` explain why                       |
| `aborted`   | User or stale-session cleanup cancelled the import and removed temporary resources       |

`GET /dataset-imports/:id` returns this state plus progress: uploaded bytes when known, parsed/imported rows, declared total rows when supplied, total bytes, visible `phase`, `totalShards`, `completedShards`, `committedRows`, best-effort percentage, error fields, job id, and lifecycle timestamps. Percentage is informational; the authoritative state is the status string.

#### 3.1.1 Small-file synchronous upload

When a file is smaller than the synchronous threshold: the frontend parses it in full, previews the first few rows, and after the user completes the field mapping it submits; the server, within a single transaction, creates the dataset row and writes the samples one by one, making it immediately usable. The sample count, field manifest, and content modalities are maintained automatically by the platform.

#### 3.1.2 Raw upload + asynchronous backend import

When object storage is configured and supports browser-direct upload sessions, the raw path is used for large streaming files at or above the 500 MiB raw threshold and for bounded JSON / ZIP raw imports. The browser reads only a prefix for preview and field mapping, then transfers the original file bytes unchanged.

1. `POST /dataset-imports/raw` creates the import row and calls `ObjectStorageProvider.createUploadSession(...)` for `resourceType='dataset_raw'`. If the provider returns `null`, the deployment does not support raw upload and the frontend may fall back to the legacy client-batched path when feasible.
2. The browser uploads the raw file to the provider's upload URL. Entrypoint authentication and business validation stay in NestJS; the storage signature is only a short-lived byte-transfer capability.
3. `POST /dataset-imports/:id/upload-complete` finalizes the provider upload with `completeUpload(...)`, verifies size / ownership / optional checksum through the provider contract, stores the finalized `raw_object_ref`, and moves the session to `uploaded`.
4. `POST /dataset-imports/:id/complete` is asynchronous for raw sessions: it enqueues a `dataset-import` BullMQ job and returns the current import status instead of parsing the whole file in the HTTP request.
5. The worker opens `ObjectStorageProvider.getObjectStream(...)`, parses the raw file, applies the selected field mappings, writes bounded batches to `dataset_import_samples`, infers field schema from staged rows, and promotes everything into `datasets` / `dataset_samples` in a transaction.
6. On success, the raw object is deleted or made unreachable, staging rows are cleared, and the import row moves to `completed`.

Parser support:

- CSV / TSV: parsed with a Node stream parser; quoted delimiters, quoted newlines, escaped quotes, and CRLF must work.
- JSONL: parsed line by line with a per-line byte limit.
- JSON array: supported only under a bounded buffered parser threshold; oversized JSON arrays are rejected with a readable error instead of being loaded unbounded.
- ZIP: supported only under a bounded buffered parser threshold. A package contains one CSV / TSV / JSONL / JSON data file, optionally selected by `manifest.json.file`; image references are resolved relative to the data file and inlined as data URLs.

Abort and failure cleanup:

- `POST /dataset-imports/:id/abort` can be called until `completed`. Before promotion starts, it marks the session `aborted`, clears staging rows, aborts any pending upload session, and deletes any finalized raw object best-effort. During `finalizing` / `offloading` / `committing`, it becomes an abort request: the active promote loop observes the aborted session at shard / commit boundaries, rolls back DB writes, deletes any shards written in this attempt best-effort, then clears staging and temporary raw resources.
- If upload finalization, queue enqueue, parse, validation, staging, or promotion fails, the session moves to `failed`, stores an error code and readable message, clears staging rows, and deletes the temporary raw object best-effort.
- Leaving the upload page before `completed` cancels the import. The frontend guards in-app navigation, tab close, refresh, and history changes; confirmed departure sends an abort request (beacon on unload), and the backend clears staging/raw resources. If the abort notification is lost, stale import sweeping later marks the session aborted and performs the same cleanup.

Quota / policy hooks are invoked at generic OSS boundaries only: raw session creation pre-checks declared file size, upload completion verifies actual uploaded bytes, import batching/staging checks actual batch bytes, and completion/promotion confirms final usage. OSS uses permissive defaults; SaaS may replace the hooks later without adding org / billing concepts to OSS code.

#### 3.1.3 Client-streamed batched import

A CSV / TSV / JSONL file exceeding the synchronous threshold but below the raw threshold is not submitted all at once and does not take the object-storage path. It goes through a **client-driven batched import session**: samples first enter a staging table, and once collected they are atomically promoted to a formal dataset within a single transaction; during this period there is no "half-visible" dataset. This path does not depend on any object storage.

1. The frontend uses `File.slice` to read only the first few rows of the JSONL / CSV / TSV file for the preview + field mapping wizard, without reading the entire file into memory.
2. `POST /dataset-imports` creates an import session (recording the name, field mapping, and file metadata); at this point the **dataset row is not yet created**.
3. The frontend parses the file in a streaming fashion. JSONL is parsed line by line; CSV / TSV must use a mature streaming parser that correctly handles quoted commas, quoted newlines, escaped quotes, and CRLF. Each time the frontend accumulates a batch, it submits the batch to `POST /dataset-imports/:id/batch`; the server writes this batch of samples into the staging table `dataset_import_samples` (deduplicated by `(import_id, row_index)`, with idempotent resubmission of a single batch) and advances the session's collected-row count and heartbeat time. Batches must be submitted serially to guarantee that what has been ingested is a continuous prefix.
   - A batch is bounded by both row count and encoded JSON payload bytes, so the server can keep `SERVER_BODY_LIMIT` small (for example 10 MiB) instead of allowing arbitrary request bodies.
4. `POST /dataset-imports/:id/complete`: within **a single transaction** the server creates the formal dataset row, batch-promotes the session's staged samples to `dataset_samples` (reassigning sample primary keys), infers field types by sampling, computes the category distribution via SQL aggregation, writes the total sample count and `has_images`, and finally clears the session's staged samples. The dataset either appears in its entirety or not at all. During this promotion, the server updates the import session's progress JSON with `phase='finalizing' | 'offloading' | 'committing'`, shard counters, and committed-row counters; the frontend keeps the user on the upload page and polls `GET /dataset-imports/:id` while the complete request is in flight so the panel can show real messages such as "已整理 34/120 shards" or "正在提交索引" instead of a byte-transfer bar stuck at 100%. If the user confirms departure during this server promotion, the abort request must not directly delete staging under the active transaction; instead it marks the session aborted, lets promotion throw at the next cancellation checkpoint, rolls back DB writes, deletes any shards written during the attempt best-effort, and then clears staging. The response uses the same import-status DTO and ends at `completed` only after all durable writes are committed.

Constraints during import:

- **The user must stay on the new-dataset page until completion**: batched pushing is driven by that page's frontend loop, so leaving the page / closing or refreshing the tab interrupts the import. The frontend uses a route navigation guard + a `beforeunload` prompt to intercept accidental departures.
- **Interruption means invalidation, full cleanup, no resumption**: any confirmed departure before the import reaches `completed` (intentional departure, closing the page, network loss, crash) invalidates the import—the samples already written to the staging table are cleared, any promote-time shards written before cancellation are deleted best-effort, and the session moves to `aborted`, **leaving no half-finished dataset and offering no resumable import**; to obtain this dataset, you must re-upload.
  - Normal departure: the frontend uses `navigator.sendBeacon` to notify the server to clean up immediately (`POST /dataset-imports/:id/abort`, which is the action of the import panel's "Cancel" button).
  - Crash / network loss (beacon cannot be delivered): the server periodically sweeps and finds pre-complete sessions with no heartbeat for a long time, aborting them automatically (see [03 §3.5](03-orchestration.md#35-probe--export--dataset-import-cleanup)).
- Staged samples are attached to the import session via a foreign key with `ON DELETE CASCADE`, and the service also explicitly clears them on completed / failed / aborted outcomes; the formal `datasets` / `dataset_samples` are never written to throughout, so there is no risk of an "in-import dataset being mistakenly referenced by an experiment", and there is no need to introduce a `status` gate on the dataset.

### 3.2 Field role maintenance

After a dataset is created, the user can still adjust field roles (for example, changing a column from "text variable" to "expected output") without affecting the already-uploaded data.
At most one field per dataset may be marked as "expected output"; when switching to a new expected-output field, the old field must fall back to metadata or another non-expected-output role.
Field-role changes on the dataset detail page are applied immediately: choosing a new role saves the dataset field schema automatically and the UI reverts the local change if the save fails.

### 3.3 Expected output and output_schema

The detail page dynamically derives `output_schema` from the expected-output JSON of the current non-deleted samples. Uploading, editing, and deleting samples all cause this derived result to change immediately.

When editing the expected-output field, the UI provides an `output_schema` field dropdown for quick filling, but it does not restrict the user to saving only those fields; if the saved content contains fields outside the current `output_schema`, the UI must remind the user.

### 3.4 Sample management

- Edit a single sample (e.g., correcting a mislabel)
- Delete a single sample or batch delete
  - This is a **physical delete** (`dataset_samples` has no `deleted_at`; after DELETE the row no longer exists). Individual sample deletion is blocked while the dataset is referenced by any experiment / optimization (see §5), and keeping an additional delete marker at the sample level would increase storage and query-filtering overhead
  - Any deletion requires a second confirmation; when referenced by an experiment / optimization, deletion is rejected outright without a second confirmation
- Stream-export all samples to CSV / JSONL (for manual sampling or external analysis). When object storage can provide a signed download URL, the export artifact is written as `resourceType='export'` and the client is redirected to that URL; otherwise the API streams the same export directly.

### 3.5 The dataset itself

- Rename
- Archive / restore
  - Archiving writes `datasets.status='archived'` and `archived_at`; restoring writes `status='active'` and clears `archived_at`.
  - Archived datasets stay visible in history / archived filters but are omitted from "start experiment" and "start optimization" selectors.
- Permanently delete
  - A second confirmation is required, and the backend must first run the deletion hook described in [06 §1](06-database-schema.md#1-general-conventions).
  - The OSS hook returns an impact plan listing affected experiments, optimizations, prompt default-dataset bindings, and sample counts.
  - After confirmation, permanent deletion physically deletes the dataset and its `dataset_samples`, clears any prompt `default_dataset_id` bindings that point to it, and deletes affected experiments / optimizations plus their owned descendants.
- Directly "start an experiment" or "start an optimization" from the dataset page, automatically carrying in the current dataset. This action is only available when the dataset is `active`.

## 4. The meaning of field roles

Field roles determine the platform's runtime behavior:

- A "text variable" is rendered into the prompt along with the prompt template
- "Image / image URL / image base64" are assembled into a multimodal request
- "Expected output" is used for experiment judgment (correct / incorrect)
- "Metadata" does not enter the prompt and is only for frontend display and filtering

## 5. Relationship to other menus

- **Prompts**: variable names used in a prompt template must exist in the dataset fields; otherwise the pre-experiment "alignment check" will warn
- **Experiments**: an experiment is the Cartesian product of "prompt version × dataset × model", and the dataset is one of its fixed dimensions
- **Optimization**: each round of optimization runs one embedded experiment, reusing the same dataset
- **Releases**: do not reference datasets at all—both canary candidates and production consume live traffic
- **Archival / deletion**: archived datasets cannot be used to create new experiments or optimizations, nor for release creation paths that depend on a prompt-bound dataset, but existing objects continue unchanged. Permanent deletion is allowed only after the deletion hook previews impact; it deletes affected experiments / optimizations plus their owned descendants. Because prompt versions are self-describing ([23 §1](23-prompts.md#1-conceptual-layering)), retained release history still displays from prompt / release snapshots.
- **Sample-deletion refusal** (independent of dataset-level deletion): as long as the dataset is still referenced by any experiment or optimization (regardless of status), deletion of individual samples is refused (inline / batch / sidebar are all blocked); the frontend shows a refusal Dialog explaining the reason. Dataset-level permanent deletion is the explicit resource-erasure path and removes affected experiments / optimizations plus their owned descendants instead of leaving run results that point to missing sample rows

## 6. Multimodality and image handling

- A dataset's modalities are derived by the frontend from field roles as an ordered set `modalities: ('text' | 'image')[]`: `text=∃role=text`, `image=∃role ∈ {image, image_url, image_base64}`; when neither is present it falls back to `['text']` (a purely structured dataset is still handled via the text channel)
- The DB field `ph_assets.datasets.has_images` is used only as a backend boolean flag (for the experiment / prompt-version "has images but unused" hint) and is not exposed to UI modality rendering; the UI always derives from `fieldSchema`
- When a dataset has both "text fields + image fields", the list / detail modality badge shows two icons side by side (all using the `--modality-text-*` / `--modality-image-*` theme tokens; hardcoded Tailwind color classes are forbidden)
- Images can come from a URL, external base64, or a local file inside a ZIP package
- A single sample can contain multiple images, and two ingestion shapes are supported:
  - **Multi-field multi-image**: one field per image (e.g., `front_image_url` / `back_image_url`), with multiple fields all mapped to "image"
  - **Single-field multi-image**: the value of one image field is an image array; in JSONL / JSON arrays you write the array directly, while in CSV / TSV the cell must be written as a valid JSON array string (e.g., `["https://example.test/a.png","https://example.test/b.png?x=1,2"]`); the platform must not split URLs by ordinary separators such as commas, semicolons, or pipes, because these characters may appear in a URL path / query / data URL
- Elements in a single-field multi-image array accept only string image references; array elements may mix URL / data URL / other image reference strings. The backend infers the field as `image_url` / `image_base64` / `image` based on the first non-empty string in the array
- ZIP-package image references can likewise be used in a single-field multi-image array; array elements just write the relative path inside the ZIP, and after parsing they become an array of data URLs
- The upload page must make these image-ingestion shapes discoverable by offering downloadable sample files for each supported pattern: image URL fields, CSV / TSV single-field image arrays, data URL / base64 image fields, and ZIP packages with relative image paths. These samples are documentation aids only; they must not imply support for formats whose parser / ingestion path is not wired yet.
- The platform automatically decides whether to use a URL or base64 at inference time based on the model's capability declaration
- There is an upper limit on single-image size, and obviously oversized source files should be intercepted at upload time; before inference `llm-client` still applies fallback downscaling and re-encoding to base64 / data URL inlined images to avoid sending oversized images directly to the model provider
- Remote image URLs are not actively downloaded and rewritten at the LLM layer; if a model consumes images in URL form, the size and accessibility of the resource the URL points to are guaranteed by the dataset/connector source
- Large CSV / TSV / JSONL uploads use client-streamed batching below the raw threshold and raw object import at or above the raw threshold when the provider supports browser upload sessions (see [§3.1.2](#312-raw-upload--asynchronous-backend-import) and [§3.1.3](#313-client-streamed-batched-import))
- ZIP image inlining is performed by the backend raw parser for raw imports and by the frontend parser only for the small-file fallback; large ZIPs are accepted only up to the bounded ZIP parser threshold

## 7. Large-payload storage tiering

When an object-storage backend is configured, the bulk of a dataset's byte size — the full per-sample `data` — tiers out of `ph_assets.dataset_samples` into compressed shards, leaving the row with a queryable projection + a pointer. When no backend is configured every sample stays fully inline, exactly as before. This mirrors the run-result tiering in SPEC [30](30-run-results.md) §9; here object storage is the system of record for the offloaded sample content.

### 7.1 Row shape after tiering

- `payload_ref jsonb` — self-describing reference (shard + row index) to the offloaded `data`. `NULL` = the row is still fully inline (a fresh row, an older row, or no object storage configured).
- `data jsonb` (now nullable) — the full sample content; after offload it is cleared, kept only as an optional inline cache for small samples.
- `search_preview text` — the front ~1KB of the sample text, the search fallback once `data` is offloaded.
- `expected_output_scalar` / `label_scalar` / `category_scalar text` — role scalars materialized at promote from `datasets.field_schema` (the expected / label / category roles), each with a partial `(dataset_id, <col>)` index, so classification / label distribution and filtering stay in SQL.
- `index_values jsonb` — a small sidecar holding any other configurable distribution / filter field's scalar value (never the whole row), for fields beyond the three fixed roles.

### 7.2 Write path: shard-at-promote

The import staging → promote transaction is the natural batch boundary. On promote, normalized samples are written into compressed object-storage shards (the authoritative copy), the per-row queryable projection (preview + role scalars + `index_values` + `payload_ref`) is materialized into `dataset_samples`, and the inline `data` is cleared (or kept as a small-sample cache). `datasets.storage_prefix` records the shard key prefix. Object stores have no atomic rename, so `payload_ref` is committed only after the shard is confirmed written.

### 7.3 Read paths

- **List / search / distribution** stay entirely in the DB: list reads the projection; search degrades to `search_preview ILIKE`; classification / label distribution groups by the role scalar columns (or `index_values`). Full-payload free-text search is out of scope (a high-tier / cold capability), consistent with SPEC 30 §9.5.
- **Worker sampling** (experiment rendering, optimization rounds) goes through a `DatasetSamplePayloadReader` seam: inline `data` when present, else a batched shard read (one GET per shard for a batch).
- **Export** keyset-paginates `dataset_samples` in stable `(created_at, id)` order, resolves offloaded rows through `DatasetSamplePayloadReader`, and streams CSV / JSONL. CSV performs one bounded pass to collect schema + extra-field headers and a second bounded pass to write rows; JSONL writes in a single pass. The API does not build a whole-file `Buffer`.
