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

> A dataset being imported is **not written to the `datasets` table** until promotion succeeds (see [§3.1](#31-uploading-data)). The OSS upload is a single synchronous request: the server stream-parses the uploaded file into a staging table and atomically promotes it, so a dataset appears in its entirety or not at all — there is never a half-visible dataset on the list page. A failed upload returns an error and leaves nothing behind (staging rolled back, temp file deleted).

## 3. Available actions

### 3.1 Uploading data

Main supported forms:

- Tabular files (CSV / TSV / Excel)
- Line-delimited JSON (one JSON object per line)
- A single JSON array
- ZIP package (CSV/JSONL + images in the same package, automatically encoding images as base64 inlined into samples)

In V1, the current upload page only exposes formats that already have real parsing and backend ingestion wired up: CSV / TSV / JSONL / JSON array / ZIP. A ZIP package must contain one CSV / TSV / JSONL / JSON array data file, with an optional `manifest.json` to specify the data file via the `file` field; if there is no manifest, the parser picks the first data file at the shallowest level. Images in the same ZIP package are referenced by relative path from sample fields, and import parsing converts the images into `data:image/...;base64,...` inlined into the samples. Excel falls under the same upload semantics as a subsequent parser extension; before the corresponding parsing pipeline is wired up, the frontend must not fake "supported" status using sample files, fixed row counts, or fake previews.

Regardless of which path is taken, the user first selects, in the "field mapping wizard", which fields to ingest, then confirms the roles of the selected fields: text variable, image, image URL, image base64, metadata, expected output; at most one field per dataset may be marked as "expected output". Unselected fields are not written to the sample JSON, nor do they enter the field manifest.

**There is no hard upper limit on a dataset's total sample count in principle**, but the OSS self-hosted edition accepts a single uploaded file up to `DATASET_UPLOAD_MAX_BYTES` (default 100 MiB, env-configurable). Larger files, resumable / async upload, browser-direct-to-storage transfer, and object-storage tiering are **out of scope for the OSS trunk**; they are reachable only by replacing the `DatasetUploadInterface` adapter ([08 §3.13](08-adapter-extension-points.md#313-datasetuploadinterface)), and the OSS trunk does not embed them. The original uploaded file is not retained as a source of business truth after import; the ingested `dataset_samples.data` is the only data source for frontend display and experiment runs.

#### 3.1.1 The OSS upload path (single, synchronous)

OSS has exactly one upload path: a `multipart/form-data` file upload to NestJS that the server parses and promotes synchronously within the request.

| Step                       | Where                          | What                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview + field mapping    | Browser                        | Reads only a prefix of the local file to preview the first rows and drive the field-mapping wizard; the full file is never parsed in the browser                                                                           |
| Transfer                   | Browser → NestJS               | Submits the **original file** as `multipart/form-data` to `POST /datasets` (file part + `name` / `description` / `fieldMappings` / `sourceFormat`), with `axios` `onUploadProgress` driving the upload bar                 |
| Receive                    | NestJS (Multer `diskStorage`)  | The multipart file is streamed to a **temp file on disk** (never `memoryStorage`); `limits.fileSize = DATASET_UPLOAD_MAX_BYTES` rejects oversized uploads early                                                            |
| Parse → stage → promote    | NestJS, in-request             | The server stream-parses the temp file, applies field mappings, writes bounded batches into the `dataset_import_samples` staging table, infers field schema, then **atomically promotes** into `datasets` / `dataset_samples` in a single transaction |
| Return + cleanup           | NestJS                         | The response returns the created dataset; the temp file is deleted in `finally`; orphaned temp files (from a crashed request) are swept on startup                                                                         |

The backend parse is the source of truth; browser parsing is only for preview, field mapping, and the oversize pre-check. Parsing and promotion complete **synchronously within the HTTP request** — there is no client-streamed batching, no object-storage raw upload, no async BullMQ import job, and no import-status polling in the OSS trunk.

Because `apps/server` and `apps/worker` are separate processes / containers that **do not share a local filesystem**, a temp file received by the server cannot be handed to a separate worker; OSS therefore parses in the server process, which is exactly why the synchronous path (not a queue) is the OSS default.

**Staging → promote (kept):** streaming parse writes bounded batches into `dataset_import_samples` (memory-safe), and a single promote transaction creates the dataset row, batch-promotes staged samples into `dataset_samples` (reassigning primary keys), infers field types by sampling, computes the category distribution via SQL aggregation, writes the total sample count and `has_images`, and clears the staged samples. The dataset either appears in its entirety or not at all. The import row (anchoring the staging rows) is transient: created at the start of the request and resolved (completed / cleaned up) before the response — OSS does not persist an import session for client polling. The parse-to-staging and promote-staging-to-DB steps are exposed as **independently reusable units** so an override of `DatasetUploadInterface` can reuse them and append its own offload without forking the import logic.

Parser support:

- CSV / TSV: Node stream parser; quoted delimiters, quoted newlines, escaped quotes, and CRLF must work; per-line byte limit.
- JSONL: parsed line by line with a per-line byte limit.
- JSON array: bounded **buffered** parser only (size cap); oversized JSON arrays are rejected with a readable error instead of being loaded unbounded.
- ZIP: bounded **buffered** parser only (size cap). A package contains one CSV / TSV / JSONL / JSON data file, optionally selected by `manifest.json.file`; image references are resolved relative to the data file and inlined as data URLs.
- Excel: future parser extension; until the pipeline is wired the frontend must not fake "supported" status.

The upload page surfaces the current limits next to the file picker with an info icon: the `DATASET_UPLOAD_MAX_BYTES` cap, the supported formats, and the fact that JSON array / ZIP use a bounded buffered parser. The progress panel shows the browser upload progress (`onUploadProgress`); server-side parse / promote happens within the same request and does not expose a separate polling phase in OSS.

**Abort / failure:** because upload + import is one synchronous request, cancelling the request rolls back the (uncommitted) staging / promotion and the server deletes the temp file in `finally`. There is no half-finished dataset and no resumable session; to obtain the dataset, re-upload. A parse / validation / promotion failure returns an error with a readable code / message; staging is rolled back and the temp file is removed. Startup temp-file sweeping removes orphaned temp files left by a crashed request.

#### 3.1.2 Quota / policy hooks

Quota / policy hooks are invoked at the generic OSS write boundary only: dataset upload checks the incoming size / batch bytes before staging and confirms final usage at promotion. OSS uses permissive defaults; an override may replace `QuotaPolicyHook` without adding org / billing concepts to OSS code. The dataset path uses a single storage-quota source (`dataset_upload`).

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
- Stream-export all samples to CSV / JSONL (for manual sampling or external analysis). OSS streams the export directly from the API in keyset-paginated batches without materializing the whole file in memory.

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
- The OSS uploaded file is bounded by `DATASET_UPLOAD_MAX_BYTES`; CSV / TSV / JSONL parse as streams, JSON array / ZIP within the bounded buffered parser cap (see [§3.1.1](#311-the-oss-upload-path-single-synchronous))
- ZIP image inlining is performed by the backend parser; large ZIPs are accepted only up to the bounded ZIP parser threshold

## 7. Sample storage

OSS stores every sample fully inline in `ph_assets.dataset_samples.data` (PostgreSQL); `data` is `NOT NULL` and is the system of record. OSS performs no object-storage tiering, sharding, or offload — the OSS default reads `data` directly. Sample reads are funneled through a single `DatasetSampleRepository` adapter ([08 §3.14](08-adapter-extension-points.md)) whose OSS default (`LocalDatasetSampleRepository`) is exactly this inline read; an override may hydrate sample payloads from external storage without forking the OSS execution / preview / export paths. The adapter interface is neutral (input: sample ids / keyset cursor; output: `{ id, data }`) and OSS adds no `payload_ref` / offload columns.

### 7.1 Read path

Sample reads go through `DatasetSampleRepository` (§3.14); the OSS default `LocalDatasetSampleRepository` reads `dataset_samples.data` inline directly.

- **List / search / distribution** stay entirely in the DB: list reads `data`; search uses `data::text ILIKE`; classification / label distribution group by `data ->> <field>` on the configurable field.
- **Execution sampling** (experiment rendering, optimization rounds) and **export** read `data` through the repository. Rendering happens **server-side** at enqueue time: the experiment workflow reads sample `data`, renders the prompt, and enqueues the already-rendered prompt into BullMQ, so the worker never reads `dataset_samples` (it is not a consumer of the read seam). Export keyset-paginates `dataset_samples` in stable `(created_at, id)` order and streams CSV / JSONL without building a whole-file buffer.
</content>
