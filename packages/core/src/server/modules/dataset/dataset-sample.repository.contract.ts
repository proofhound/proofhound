// DatasetSampleRepository — adapter extension point (08 §3.14): read dataset sample rows for
// execution rendering (experiment / optimization), detail-page preview / search / category distribution,
// and export.
//
// The OSS default (LocalDatasetSampleRepository) reads samples inline from `ph_assets.dataset_samples.data`
// via Drizzle. A replacement implementation binds its own repository — one that hydrates each sample's payload
// from external storage before returning — in its `contracts` module; that implementation lives outside the OSS
// trunk. The interface is intentionally neutral: input is sample ids / a keyset cursor, output is sample rows;
// no storage backend, payload ref, or offload concept appears here. The worker is not a consumer — the
// experiment workflow reads sample `data` on the server side at render time and enqueues an already-rendered
// prompt, so the read seam is server-side only.

export interface DatasetSampleRow {
  id: string;
  datasetId: string;
  data: unknown;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatasetSampleExportCursor {
  createdAt: string;
  id: string;
}

export interface DatasetSampleExportBatch {
  rows: DatasetSampleRow[];
  nextCursor: DatasetSampleExportCursor | null;
}

export abstract class DatasetSampleRepository {
  /** Keyset id page (ids only) for experiment batching. */
  abstract loadSampleIdBatch(datasetId: string, cursorId: string | null, batchSize: number): Promise<string[]>;

  /** Read sample payloads by id, for experiment render. */
  abstract readSamplesByIds(sampleIds: string[]): Promise<Array<{ id: string; data: Record<string, unknown> | null }>>;

  /** Read all sample payloads of a dataset in stable order, for optimization rounds. */
  abstract loadDatasetSamples(datasetId: string): Promise<Array<{ id: string; data: Record<string, unknown> }>>;

  /** Server-side paginated browse with optional cross-field search. */
  abstract listDatasetSamplesPage(
    datasetId: string,
    options: { limit: number; offset: number; search?: string },
  ): Promise<{ rows: DatasetSampleRow[]; total: number }>;

  /** Keyset batch for streaming export. */
  abstract listDatasetSamplesBatch(
    datasetId: string,
    options: { limit: number; cursor?: DatasetSampleExportCursor | null },
  ): Promise<DatasetSampleExportBatch>;

  /** SQL GROUP BY distribution over a scalar field of the inline sample data. */
  abstract aggregateCategoryDistribution(
    datasetId: string,
    fieldName: string,
  ): Promise<Array<{ label: string; count: number }>>;
}
