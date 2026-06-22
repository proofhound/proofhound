// Offload-at-promote orchestration (SPEC 22 §7.2) — pure of DB / storage so it unit-tests with fakes.
//
// Streams the import's staging rows in bounded batches; each batch becomes one shard, and each row is
// inserted with its queryable projection + a pointer at its line in the shard, with inline data cleared.
// The shard is written before the rows that reference it (object stores have no atomic rename); a
// caller-side rollback may orphan the just-written shard until an operator storage-lifecycle cleanup reclaims it.
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
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

export interface OffloadShardManifest {
  shardSeq: number;
  rowStart: number;
  rowCount: number;
  shardRef: StoredObjectRef;
}

export interface OffloadStagingProgress {
  completedShards: number;
  totalShards: number;
  processedRows: number;
  avgPutMs: number;
  p95PutMs: number;
}

export interface OffloadStagingMetrics {
  totalShards: number;
  completedShards: number;
  dbReadBatchMs: number;
  gzipEncodeMs: number;
  putMs: number;
  insertRowsMs: number;
  avgPutMs: number;
  p95PutMs: number;
}

export interface OffloadStagingOptions {
  datasetId: string;
  sampleCount: number;
  batchSize: number;
  fieldSchema: DatasetFieldSchemaDto[];
  codec?: ObjectCodec;
  concurrency?: number;
  progressIntervalShards?: number;
  readBatch: (offset: number, limit: number) => Promise<StagingSample[]>;
  putShard: (name: string, body: Buffer) => Promise<StoredObjectRef>;
  insertRows?: (rows: DatasetSampleOffloadRow[]) => Promise<void>;
  onProgress?: (progress: OffloadStagingProgress) => Promise<void> | void;
}

export async function offloadStagingToShards(
  opts: OffloadStagingOptions,
): Promise<{
  shards: number;
  storagePrefix: string | null;
  manifests: OffloadShardManifest[];
  metrics: OffloadStagingMetrics;
}> {
  const codec = opts.codec ?? 'gzip';
  const totalShards = Math.ceil(opts.sampleCount / opts.batchSize);
  const concurrency = Math.min(normalizeConcurrency(opts.concurrency), Math.max(totalShards, 1));
  const progressInterval = Math.max(1, opts.progressIntervalShards ?? 100);
  const manifests: OffloadShardManifest[] = [];
  const putDurations: number[] = [];
  const metrics = {
    totalShards,
    completedShards: 0,
    dbReadBatchMs: 0,
    gzipEncodeMs: 0,
    putMs: 0,
    insertRowsMs: 0,
    avgPutMs: 0,
    p95PutMs: 0,
  };
  let nextShardSeq = 0;
  let processedRows = 0;
  let failure: unknown;

  const claimShardSeq = () => {
    if (failure !== undefined) return null;
    if (nextShardSeq >= totalShards) return null;
    const shardSeq = nextShardSeq;
    nextShardSeq += 1;
    return shardSeq;
  };

  const worker = async () => {
    for (;;) {
      const shardSeq = claimShardSeq();
      if (shardSeq === null) return;

      try {
        const rowStart = shardSeq * opts.batchSize;
        const readStartedAt = nowMs();
        const batch = await opts.readBatch(rowStart, opts.batchSize);
        metrics.dbReadBatchMs += elapsedMs(readStartedAt);
        if (batch.length === 0) return;

        const encodeStartedAt = nowMs();
        const body = await encodeShard(
          batch.map((row) => row.data),
          codec,
        );
        metrics.gzipEncodeMs += elapsedMs(encodeStartedAt);

        const putStartedAt = nowMs();
        const shardRef = await opts.putShard(`shard-${String(shardSeq).padStart(5, '0')}.jsonl.gz`, body);
        const putMs = elapsedMs(putStartedAt);
        putDurations.push(putMs);
        metrics.putMs += putMs;

        if (opts.insertRows) {
          const insertStartedAt = nowMs();
          await opts.insertRows(buildDatasetSampleOffloadRows(opts.datasetId, opts.fieldSchema, batch, shardRef));
          metrics.insertRowsMs += elapsedMs(insertStartedAt);
        }

        manifests[shardSeq] = { shardSeq, rowStart, rowCount: batch.length, shardRef };
        metrics.completedShards += 1;
        processedRows += batch.length;
        metrics.avgPutMs = average(putDurations);
        metrics.p95PutMs = percentile(putDurations, 0.95);
        if (metrics.completedShards % progressInterval === 0 || metrics.completedShards === totalShards) {
          await opts.onProgress?.({
            completedShards: metrics.completedShards,
            totalShards,
            processedRows,
            avgPutMs: metrics.avgPutMs,
            p95PutMs: metrics.p95PutMs,
          });
        }
      } catch (error) {
        failure = error;
        throw error;
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  const results = await Promise.allSettled(workers);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) throw rejected.reason;

  const orderedManifests = manifests.filter((manifest): manifest is OffloadShardManifest => manifest !== undefined);
  const offloadedRows = orderedManifests.reduce((sum, manifest) => sum + manifest.rowCount, 0);
  if (offloadedRows !== opts.sampleCount) {
    throw new Error('dataset_import_staging_read_incomplete');
  }
  const firstShardKey = orderedManifests[0]?.shardRef.key ?? null;

  return {
    shards: orderedManifests.length,
    storagePrefix: firstShardKey ? firstShardKey.slice(0, firstShardKey.lastIndexOf('/') + 1) : null,
    manifests: orderedManifests,
    metrics,
  };
}

export function buildDatasetSampleOffloadRows(
  datasetId: string,
  fieldSchema: DatasetFieldSchemaDto[],
  batch: StagingSample[],
  shardRef: StoredObjectRef,
): DatasetSampleOffloadRow[] {
  return batch.map((row, rowIndex) => {
    const data = (row.data ?? null) as Record<string, unknown> | null;
    const projection = projectDatasetSample(data, fieldSchema);
    return {
      datasetId,
      data: null,
      externalId: row.externalId,
      payloadRef: { shard: shardRef, rowIndex },
      searchPreview: projection.searchPreview,
      expectedOutputScalar: projection.expectedOutputScalar,
      labelScalar: projection.labelScalar,
      categoryScalar: projection.categoryScalar,
      indexValues: projection.indexValues,
    };
  });
}

function normalizeConcurrency(value: number | undefined) {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : 1;
}

function nowMs() {
  return performance.now();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, performance.now() - startedAt);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index] ?? 0;
}
