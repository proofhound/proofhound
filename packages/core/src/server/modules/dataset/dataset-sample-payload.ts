// DatasetSamplePayloadReader — the read seam for dataset-sample content (SPEC 22 §7.1, 08 §3.14).
//
// This is an adapter extension point. The OSS default stores every sample inline in
// `dataset_samples.data`, so it returns the inline value directly and never touches object storage.
// A SaaS deployment binds its own implementation (resolving an offloaded `payload_ref` from its
// object store) in its `contracts` module; that implementation lives in the SaaS repository.
import { Injectable } from '@nestjs/common';

/**
 * Stored in `dataset_samples.payload_ref`. Always `NULL` in OSS (a reserved, storage-agnostic slot);
 * a SaaS reader interprets its own ref shape. OSS code never reads it, so it is opaque here.
 */
export type DatasetSamplePayloadRef = unknown;

export interface DatasetSamplePayloadRow {
  data: unknown;
  payloadRef?: DatasetSamplePayloadRef | null;
}

/** Adapter token: resolve a dataset sample's content. */
export abstract class DatasetSamplePayloadReader {
  /** Resolve one sample's data. */
  abstract hydrate(row: DatasetSamplePayloadRow): Promise<unknown>;
  /** Batch resolve. */
  abstract hydrateMany(rows: DatasetSamplePayloadRow[]): Promise<unknown[]>;
}

/** OSS default: samples are always inline; `payload_ref` is never populated. */
@Injectable()
export class InlineDatasetSamplePayloadReader extends DatasetSamplePayloadReader {
  async hydrate(row: DatasetSamplePayloadRow): Promise<unknown> {
    return row.data ?? null;
  }

  async hydrateMany(rows: DatasetSamplePayloadRow[]): Promise<unknown[]> {
    return rows.map((row) => row.data ?? null);
  }
}
