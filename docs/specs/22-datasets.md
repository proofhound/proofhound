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
- Detail level: click into a dataset to browse its samples. **Pagination and search are handled server-side** (`GET /datasets/:id/samples?page&pageSize&search`, LIMIT/OFFSET + cross-field `data::text ILIKE`); the detail page only ever loads the current page at any moment, so even a large dataset is never loaded all at once; exports still go through a full dump. The sample table and edit cards display all stored fields, sorted by "ID → text variables → images → expected output → metadata", with the action column fixed on the right. The system creation time / update time fields are not displayed by default and can later be enabled via explicit column settings.

> A dataset being imported is **not written to the `datasets` table** until promotion succeeds (see [§3.1](#31-uploading-data)). In-progress import sessions **do not appear on the dataset list page**: progress and failure details are exposed through the dataset import status API and upload page. Only after the import session reaches `completed` does a dataset appear as a formal dataset. Failed / aborted sessions are retained long enough for readable status and error display, while staging rows are cleaned up best-effort.

## 3. Available actions

### 3.1 Uploading data

Main supported forms:

- Tabular files (CSV / TSV / Excel)
- Line-delimited JSON (one JSON object per line)
- ZIP package (CSV / TSV / JSONL + images in the same package, automatically encoding images as base64 inlined into samples)

In V1, the current upload page only exposes formats that already have real parsing and backend ingestion wired up: CSV / TSV / JSONL / ZIP. Standalone JSON array uploads are intentionally not exposed until the product has a clearer large-file story for that format. A ZIP package must contain one CSV / TSV / JSONL data file, with an optional `manifest.json` to specify the data file via the `file` field; if there is no manifest, the parser picks the first data file at the shallowest level. Images in the same ZIP package are referenced by relative path from sample fields, and import parsing converts the images into `data:image/...;base64,...` inlined into the samples. Excel falls under the same upload semantics as a subsequent parser extension; before the corresponding parsing pipeline is wired up, the frontend must not fake "supported" status using sample files, fixed row counts, or fake previews.

Regardless of which path is taken, the user first selects, in the "field mapping wizard", which fields to ingest, then confirms the roles of the selected fields: text variable, image, image URL, image base64, metadata, expected output; at most one field per dataset may be marked as "expected output". Unselected fields are not written to the sample JSON, nor do they enter the field manifest.

**There is no hard upper limit on a dataset's total sample count**; large CSV / TSV / JSONL files are ingested through streaming client batches up to the default 2 GiB source-file limit. The server keeps protective thresholds on each batch request—row count and encoded byte size—but those are request-body protections, not dataset-size limits. The original uploaded file is not retained as a source of business truth after import; the ingested `dataset_samples.data` or normalized object-storage shards are the only data source for frontend display and experiment runs.

The Web upload page always goes through a **dataset import session**. It no longer calls `POST /datasets` to synchronously create a dataset, even for small files. `POST /datasets` remains available for API / MCP / internal small-data creation paths, but the browser upload workflow uses staging plus atomic promote so the page has one consistent failure / cleanup model.

The OSS upload/import surface has one conservative path:

| Path                       | Formats                 | Transport                                                                                                                                            | When used                                                                                    |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Client-driven batch import | CSV / TSV / JSONL / ZIP | Frontend parses the local file and sends bounded batches to `POST /dataset-imports/:id/batch`; server atomically promotes from staging on `complete` | All OSS Web uploads. CSV / TSV / JSONL stream from the local file; ZIP uses a bounded parser |

Uppy owns generic browser file-source behavior in the Web page: file and folder selection, drag/drop normalization, relative path preservation, duplicate / restriction errors, selected-file state, cancellation affordances, and generic progress state. ProofHound owns dataset semantics: selecting the dataset data file from a directory or ZIP manifest, preview parsing, field mapping, CSV / TSV / JSONL / ZIP parsing, image inlining for ZIP packages, bounded batch append, import completion, abort, cleanup, and the final dataset shape used by experiments and optimizations.

The OSS repository does **not** implement a raw direct-to-object-storage dataset upload path. Object storage remains a generic infrastructure provider for export artifacts and normalized sample payload tiering, but browser-direct raw dataset transfer, multipart/resumable upload policy, provider-specific R2/S3/MinIO behavior, SaaS quota presentation, and hosted progress models belong to a host-owned upload page outside the OSS shared upload page. A SaaS app may route-level override `/datasets/new` and call the stable dataset import / commit primitives without changing the OSS upload screen.

CSV / TSV / JSONL stream from the browser file into batch append without loading the whole file into memory and are accepted up to the default 2 GiB source-file limit. ZIP inputs do not yet have a true streaming frontend parser, so the OSS page accepts ZIP only up to the bounded 1 GiB parser threshold; oversized ZIP inputs are rejected with a readable error instead of being loaded unbounded. Standalone JSON array upload is not exposed in the current OSS upload page. Import still keeps protective limits: single sample / line size, batch row count, batch byte size, decompressed payload size for ZIP, stale import timeout, and cleanup of abandoned sessions.

The upload page must surface the current limits next to the file picker with an info icon: CSV / TSV / JSONL accept up to 2 GiB; ZIP accepts up to 1 GiB; preview parsing is row-bounded rather than byte-thresholded and parses at most the first 100 rows for field mapping, with the visible preview paginated at 10 rows per page; CSV / TSV / JSONL continue through client-streamed batch import as long as the page stays open. The progress panel names the active transfer stage: client batch import, object-storage shard offload when enabled for normalized sample payloads, and final dataset commit.

Import sessions use the following state machine:

| State       | Meaning                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `uploading` | Client-batched session exists and is accepting batches                            |
| `importing` | Server has received at least one batch, or is promoting staged rows               |
| `completed` | Dataset row and samples are fully promoted; staging rows are cleared              |
| `failed`    | Import cannot continue; `error_code` / `error_message` explain why                |
| `aborted`   | User or stale-session cleanup cancelled the import and removed staged sample rows |

`GET /dataset-imports/:id` returns this state plus progress: parsed/imported rows, declared total rows when supplied, total bytes, best-effort percentage, error fields, and lifecycle timestamps. Percentage is informational; the authoritative state is the status string.

#### 3.1.1 Client-driven batched import

Every OSS Web upload goes through a **client-driven batched import session**: samples first enter a staging table, and once collected they are atomically promoted to a formal dataset within a single transaction; during this period there is no "half-visible" dataset. The transport does not depend on raw object upload.

1. The frontend parses at most the first 100 rows of the JSONL / CSV / TSV file for the preview + field mapping wizard, displays those preview rows 10 per page, and does not use a source-file byte threshold or read the entire file into memory.
2. `POST /dataset-imports` creates an import session (recording the name, field mapping, and file metadata); at this point the **dataset row is not yet created**.
3. The frontend parses the file in a streaming fashion. JSONL is parsed line by line; CSV / TSV must use a mature streaming parser that correctly handles quoted commas, quoted newlines, escaped quotes, and CRLF. Each time the frontend accumulates a batch, it submits the batch to `POST /dataset-imports/:id/batch`; the server writes this batch of samples into the staging table `dataset_import_samples` (deduplicated by `(import_id, row_index)`, with idempotent resubmission of a single batch) and advances the session's collected-row count and heartbeat time. Batches must be submitted serially to guarantee that what has been ingested is a continuous prefix.
   - A batch is bounded by both row count and encoded JSON payload bytes, so the server can keep `SERVER_BODY_LIMIT` small (for example 10 MiB) instead of allowing arbitrary request bodies.
4. `POST /dataset-imports/:id/complete`: the server preflights the import, offloads staged rows to object-storage shards when storage is enabled for normalized sample payloads, and then uses a short database transaction to create the formal dataset row, insert the `dataset_samples` pointer rows (or copy inline rows when storage is disabled), mark the import `completed`, and clear staging. The dataset either appears in its entirety or not at all. The response uses the same import-status DTO and ends at `completed`.

Constraints during import:

- **The user must stay on the new-dataset page until completion**: batched pushing is driven by that page's frontend loop, so leaving the page / closing or refreshing the tab interrupts the import. The frontend uses a route navigation guard + a `beforeunload` prompt to intercept accidental departures.
- **Interruption means invalidation, full cleanup, no resumption**: any departure that does not reach `complete` (intentional departure, closing the page, network loss, crash) invalidates the import—the samples already written to the staging table are cleared and the session moves to `aborted`, **leaving no half-finished dataset and offering no resumable import**; to obtain this dataset, you must re-upload.
  - Normal departure: the frontend uses `navigator.sendBeacon` to notify the server to clean up immediately (`POST /dataset-imports/:id/abort`, which is the action of the import panel's "Cancel" button).
  - Crash / network loss (beacon cannot be delivered): the server periodically sweeps and finds pre-complete sessions with no heartbeat for a long time, aborting them automatically (see [03 §3.5](03-orchestration.md#35-probe--export--dataset-import-cleanup)).
- Staged samples are attached to the import session via a foreign key with `ON DELETE CASCADE`, and the service also explicitly clears them on completed / failed / aborted outcomes; the formal `datasets` / `dataset_samples` are never written to before promote completes, so there is no risk of an "in-import dataset being mistakenly referenced by an experiment", and there is no need to introduce a `status` gate on the dataset.

Quota / policy hooks are invoked at generic OSS boundaries only: import session creation pre-checks declared file size, import batching/staging checks actual batch bytes, and completion/promotion confirms final usage. OSS uses permissive defaults; SaaS may replace the hooks later without adding org / billing concepts to OSS code.

### 3.2 Field role maintenance

After a dataset is created, the user can still adjust field roles (for example, changing a column from "text variable" to "expected output") without affecting the already-uploaded data.
At most one field per dataset may be marked as "expected output"; when switching to a new expected-output field, the old field must fall back to metadata or another non-expected-output role.

### 3.3 Expected output and output_schema

The detail page dynamically derives `output_schema` from the expected-output JSON of the current non-deleted samples. Uploading, editing, and deleting samples all cause this derived result to change immediately.

When editing the expected-output field, the UI provides an `output_schema` field dropdown for quick filling, but it does not restrict the user to saving only those fields; if the saved content contains fields outside the current `output_schema`, the UI must remind the user.

### 3.4 Sample management

- Edit a single sample (e.g., correcting a mislabel)
- Delete a single sample or batch delete
  - This is a **physical delete** (`dataset_samples` has no `deleted_at`; after DELETE the row no longer exists). Individual sample deletion is blocked while the dataset is referenced by any experiment / optimization (see §5), and keeping an additional delete marker at the sample level would increase storage and query-filtering overhead
  - Any deletion requires a second confirmation; when referenced by an experiment / optimization, deletion is rejected outright without a second confirmation
- Stream-export all samples to CSV / JSONL (for manual sampling or external analysis); the export file is written to Storage and then a signed URL is provided

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
  - **Single-field multi-image**: the value of one image field is an image array; in JSONL you write the array directly, while in CSV / TSV the cell must be written as a valid JSON array string (e.g., `["https://example.test/a.png","https://example.test/b.png?x=1,2"]`); the platform must not split URLs by ordinary separators such as commas, semicolons, or pipes, because these characters may appear in a URL path / query / data URL
- Elements in a single-field multi-image array accept only string image references; array elements may mix URL / data URL / other image reference strings. The backend infers the field as `image_url` / `image_base64` / `image` based on the first non-empty string in the array
- ZIP-package image references can likewise be used in a single-field multi-image array; array elements just write the relative path inside the ZIP, and after parsing they become an array of data URLs
- The upload page must make these image-ingestion shapes discoverable by offering downloadable sample files for each supported pattern: image URL fields, CSV / TSV single-field image arrays, data URL / base64 image fields, and ZIP packages with relative image paths. These samples are documentation aids only; they must not imply support for formats whose parser / ingestion path is not wired yet.
- The platform automatically decides whether to use a URL or base64 at inference time based on the model's capability declaration
- There is an upper limit on single-image size, and obviously oversized source files should be intercepted at upload time; before inference `llm-client` still applies fallback downscaling and re-encoding to base64 / data URL inlined images to avoid sending oversized images directly to the model provider
- Remote image URLs are not actively downloaded and rewritten at the LLM layer; if a model consumes images in URL form, the size and accessibility of the resource the URL points to are guaranteed by the dataset/connector source
- Large CSV / TSV / JSONL uploads use client-streamed batching through the dataset import session (see [§3.1.1](#311-client-driven-batched-import)).
- ZIP image inlining is performed by the frontend parser in the OSS upload page; ZIPs are accepted only up to the bounded ZIP parser threshold.

## 7. Large-payload storage tiering

When an object-storage backend is configured, the bulk of a dataset's byte size — the full per-sample `data` — tiers out of `ph_assets.dataset_samples` into compressed shards, leaving the row with a queryable projection + a pointer. When no backend is configured every sample stays fully inline, exactly as before. This mirrors the run-result tiering in SPEC [30](30-run-results.md) §9; here object storage is the system of record for the offloaded sample content.

### 7.1 Row shape after tiering

- `payload_ref jsonb` — self-describing reference (shard + row index) to the offloaded `data`. `NULL` = the row is still fully inline (a fresh row, an older row, or no object storage configured).
- `data jsonb` (now nullable) — the full sample content; after offload it is cleared, kept only as an optional inline cache for small samples.
- `search_preview text` — the front ~1KB of the sample text, the search fallback once `data` is offloaded.
- `expected_output_scalar` / `label_scalar` / `category_scalar text` — role scalars materialized at promote from `datasets.field_schema` (the expected / label / category roles), each with a partial `(dataset_id, <col>)` index, so classification / label distribution and filtering stay in SQL.
- `index_values jsonb` — a small sidecar holding any other configurable distribution / filter field's scalar value (never the whole row), for fields beyond the three fixed roles.

### 7.2 Write path: shard-at-promote

Import completion uses a two-phase offload plus short transaction:

1. **Preflight**: generate the target `dataset_id`, confirm the import still belongs to the current project and is in an importable state, confirm the dataset name is not already taken, confirm staged sample count is greater than zero, and infer the field schema from the staged prefix.
2. **Object-storage offload**: when `ObjectStorageProvider.isEnabled()` is true, read staging rows in `PROMOTE_SHARD_BATCH=200` row batches, gzip each batch into a shard, and write shards outside any database transaction. `DATASET_PROMOTE_STORAGE_CONCURRENCY` controls the bounded worker pool for shard PUTs; the OSS default is `4`, invalid values fall back to `4`, and values above `32` are capped at `32`. The implementation must not use unbounded `Promise.all`; at most `concurrency * 200` rows are held by active shard workers.
3. **Short commit transaction**: after every shard succeeds, insert the dataset row, insert `dataset_samples` pointer rows with `payload_ref`, mark the import `completed`, and delete staging rows in a database-only transaction. When storage is disabled, the same short transaction copies the staged inline sample `data` into `dataset_samples` and keeps the DB-only behavior.

The offload stage returns a manifest per shard (`shardSeq`, `rowStart`, `rowCount`, `shardRef`); the commit phase uses that manifest to insert the `dataset_samples` pointer rows without holding all rows in memory at once. `datasets.storage_prefix` records the shard key prefix. Object stores have no atomic rename, so `payload_ref` is committed only after the shard is confirmed written. If any shard PUT fails, the import is marked `failed` with `dataset_import_offload_failed`; already uploaded shards are deleted best-effort via `ObjectStorageProvider.deleteObjects(...)`, and longer-term deployments may additionally rely on provider registry / GC cleanup for orphaned `dataset_normalized` objects that were never committed to a dataset.

Promote logs must make the bottleneck observable. At minimum, stdout JSON logs record `dataset_import_complete_started`, `dataset_import_offload_started`, periodic `dataset_import_offload_progress` with `completedShards`, `totalShards`, `avgPutMs`, and `p95PutMs`, and `dataset_import_completed` with total duration. Offload metrics separately track DB read batch time, gzip encode time, object-storage PUT time, `dataset_samples` insert time, and total complete time.

### 7.3 Read paths

- **List / search / distribution** stay entirely in the DB: list reads the projection; search degrades to `search_preview ILIKE`; classification / label distribution groups by the role scalar columns (or `index_values`). Full-payload free-text search is out of scope (a high-tier / cold capability), consistent with SPEC 30 §9.5.
- **Worker sampling** (experiment rendering, optimization rounds) goes through a `DatasetSamplePayloadReader` seam: inline `data` when present, else a batched shard read (one GET per shard for a batch).
- **Export** streams the shards directly rather than re-reading rows.
