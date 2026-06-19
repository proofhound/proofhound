// Offload-at-promote orchestration (SPEC 22 §7.2) — pure of DB / storage so it unit-tests with fakes.
//
// Streams the import's staging rows in bounded batches; each batch becomes one shard, and each row is
// inserted with its queryable projection + a pointer at its line in the shard, with inline data cleared.
// The shard is written before the rows that reference it (object stores have no atomic rename); a
// caller-side rollback orphans the shard, which the sweeper reclaims.
import { Buffer } from 'node:buffer';
import type { DatasetFieldSchemaDto } from '@proofhound/shared';
import type { ObjectCodec, StoredObjectRef } from '../../common/contracts/object-storage.provider';
import { encodeShard } from '../run-result/run-result-payload';
import { projectDatasetSample } from './dataset-sample-projection';

export interface StagingSample {
  data: unknown;
  externalId: string | null;
}

export interface DatasetSampleOffloadRow {
  datasetId: string;
  data: null;
  externalId: string | null;
  payloadRef: { shard: StoredObjectRef; rowIndex: number };
  searchPreview: string | null;
  expectedOutputScalar: string | null;
  labelScalar: string | null;
  categoryScalar: string | null;
  indexValues: Record<string, string> | null;
}

export interface OffloadStagingOptions {
  datasetId: string;
  sampleCount: number;
  batchSize: number;
  fieldSchema: DatasetFieldSchemaDto[];
  codec?: ObjectCodec;
  readBatch: (offset: number, limit: number) => Promise<StagingSample[]>;
  putShard: (name: string, body: Buffer) => Promise<StoredObjectRef>;
  insertRows: (rows: DatasetSampleOffloadRow[]) => Promise<void>;
}

export async function offloadStagingToShards(
  opts: OffloadStagingOptions,
): Promise<{ shards: number; storagePrefix: string | null }> {
  const codec = opts.codec ?? 'gzip';
  let shardSeq = 0;
  let offset = 0;
  let firstShardKey: string | null = null;

  while (offset < opts.sampleCount) {
    const batch = await opts.readBatch(offset, opts.batchSize);
    if (batch.length === 0) break;

    const body = await encodeShard(
      batch.map((row) => row.data),
      codec,
    );
    const shardRef = await opts.putShard(`shard-${String(shardSeq).padStart(5, '0')}.jsonl.gz`, body);
    firstShardKey ??= shardRef.key;

    await opts.insertRows(
      batch.map((row, rowIndex) => {
        const data = (row.data ?? null) as Record<string, unknown> | null;
        const projection = projectDatasetSample(data, opts.fieldSchema);
        return {
          datasetId: opts.datasetId,
          data: null,
          externalId: row.externalId,
          payloadRef: { shard: shardRef, rowIndex },
          searchPreview: projection.searchPreview,
          expectedOutputScalar: projection.expectedOutputScalar,
          labelScalar: projection.labelScalar,
          categoryScalar: projection.categoryScalar,
          indexValues: projection.indexValues,
        };
      }),
    );

    offset += batch.length;
    shardSeq += 1;
  }

  return {
    shards: shardSeq,
    storagePrefix: firstShardKey ? firstShardKey.slice(0, firstShardKey.lastIndexOf('/') + 1) : null,
  };
}
