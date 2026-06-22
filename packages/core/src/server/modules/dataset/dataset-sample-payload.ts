// DatasetSamplePayloadReader — the read seam for dataset-sample content (SPEC 22 §7.3).
//
// The worker hot paths (experiment rendering, optimization rounds) load a sample's full `data`. Once
// promote tiers it out, `data` is null and the authoritative content lives in an object-storage shard.
// This seam returns the inline value when present (a small-sample cache, or no offload), else reads
// the shard. Pure pass-through when storage is disabled / the row was never offloaded. It reuses the
// generic JSONL shard codec from the run-result seam (one data object per line).
import { Injectable } from '@nestjs/common';
import { ObjectStorageProvider } from '../../common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import { decodeShard } from '../run-result/run-result-payload';

/** Stored in `dataset_samples.payload_ref`: the shard holding this sample's data + its line. */
export interface DatasetSamplePayloadRef {
  shard: StoredObjectRef;
  rowIndex: number;
}

export interface DatasetSamplePayloadRow {
  data: unknown;
  payloadRef: DatasetSamplePayloadRef | null;
}

@Injectable()
export class DatasetSamplePayloadReader {
  constructor(private readonly storage: ObjectStorageProvider) {}

  /** Resolve one sample's data: inline when present, else from its shard. */
  async hydrate(row: DatasetSamplePayloadRow): Promise<unknown> {
    const ref = this.shardRef(row);
    if (!ref) return row.data ?? null;
    const lines = await decodeShard<Record<string, unknown>>(await this.storage.getObject(ref.shard), ref.shard.codec);
    return lines[ref.rowIndex] ?? null;
  }

  /** Batch: groups rows by shard so a 500-sample batch is one GET per shard, not one per sample. */
  async hydrateMany(rows: DatasetSamplePayloadRow[]): Promise<unknown[]> {
    const out: unknown[] = rows.map((r) => r.data ?? null);
    const byShard = new Map<string, { shard: StoredObjectRef; entries: Array<{ index: number; rowIndex: number }> }>();
    rows.forEach((row, index) => {
      const ref = this.shardRef(row);
      if (!ref) return;
      const key = shardKey(ref.shard);
      const group = byShard.get(key);
      if (group) group.entries.push({ index, rowIndex: ref.rowIndex });
      else byShard.set(key, { shard: ref.shard, entries: [{ index, rowIndex: ref.rowIndex }] });
    });

    await Promise.all(
      [...byShard.values()].map(async ({ shard, entries }) => {
        const lines = await decodeShard<Record<string, unknown>>(await this.storage.getObject(shard), shard.codec);
        for (const { index, rowIndex } of entries) out[index] = lines[rowIndex] ?? null;
      }),
    );
    return out;
  }

  /** The ref to read from, or null when the inline value should be used (cache / no offload / disabled). */
  private shardRef(row: DatasetSamplePayloadRow): DatasetSamplePayloadRef | null {
    if (row.data != null || row.payloadRef == null || !this.storage.isEnabled()) return null;
    return row.payloadRef;
  }
}

function shardKey(ref: StoredObjectRef): string {
  return `${ref.provider}:${ref.bucket ?? ''}:${ref.key}`;
}
