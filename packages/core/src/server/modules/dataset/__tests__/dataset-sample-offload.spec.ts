import { Buffer } from 'node:buffer';
import type { DatasetFieldSchemaDto } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import type { StoredObjectRef } from '../../../common/contracts/object-storage.provider';
import { decodeShard } from '../../run-result/run-result-payload';
import { type DatasetSampleOffloadRow, type StagingSample, offloadStagingToShards } from '../dataset-sample-offload';

const fieldSchema: DatasetFieldSchemaDto[] = [
  { name: 'q', role: 'text', type: 'string' },
  { name: 'label', role: 'expected_output', type: 'string' },
];

function staging(n: number): StagingSample[] {
  return Array.from({ length: n }, (_, i) => ({ data: { q: `q${i}`, label: i % 2 === 0 ? 'a' : 'b' }, externalId: `ext-${i}` }));
}

function run(samples: StagingSample[], batchSize: number) {
  const all = samples;
  const shards: Array<{ name: string; body: Buffer }> = [];
  const inserted: DatasetSampleOffloadRow[] = [];
  return offloadStagingToShards({
    datasetId: 'ds-1',
    sampleCount: all.length,
    batchSize,
    fieldSchema,
    readBatch: async (offset, limit) => all.slice(offset, offset + limit),
    putShard: async (name, body) => {
      shards.push({ name, body });
      const ref: StoredObjectRef = {
        provider: 'r2',
        bucket: 'b',
        key: `orgs/o/projects/p/dataset_normalized/ds-1/${name}`,
        bytes: body.byteLength,
        codec: 'gzip',
        resourceType: 'dataset_normalized',
        resourceId: 'ds-1',
      };
      return ref;
    },
    insertRows: async (rows) => {
      inserted.push(...rows);
    },
  }).then((result) => ({ result, shards, inserted }));
}

describe('offloadStagingToShards', () => {
  it('packs staging into batch-sized shards and inserts one projected row per sample', async () => {
    const { result, shards, inserted } = await run(staging(5), 2);

    expect(result.shards).toBe(3); // 5 samples / 2 per shard
    expect(shards.map((s) => s.name)).toEqual([
      'shard-00000.jsonl.gz',
      'shard-00001.jsonl.gz',
      'shard-00002.jsonl.gz',
    ]);
    expect(inserted).toHaveLength(5);
    expect(result.storagePrefix).toBe('orgs/o/projects/p/dataset_normalized/ds-1/');
  });

  it('clears inline data and points each row at its line in the right shard', async () => {
    const { inserted } = await run(staging(3), 2);
    // sample 0,1 -> shard 0 rows 0,1 ; sample 2 -> shard 1 row 0
    expect(inserted.map((r) => [r.payloadRef.shard.key.split('/').pop(), r.payloadRef.rowIndex])).toEqual([
      ['shard-00000.jsonl.gz', 0],
      ['shard-00000.jsonl.gz', 1],
      ['shard-00001.jsonl.gz', 0],
    ]);
    expect(inserted.every((r) => r.data === null)).toBe(true);
    expect(inserted[0]?.expectedOutputScalar).toBe('a'); // projection materialized
    expect(inserted[0]?.searchPreview).toContain('q0');
  });

  it('round-trips: a shard decodes back to the batch samples at the recorded row index', async () => {
    const { shards, inserted } = await run(staging(3), 2);
    const shard0 = await decodeShard<Record<string, unknown>>(shards[0]!.body, 'gzip');
    // inserted[1] points at shard 0 row 1 → its data is the original sample 1
    expect(shard0[inserted[1]!.payloadRef.rowIndex]).toEqual({ q: 'q1', label: 'b' });
  });

  it('does nothing for an empty import', async () => {
    const { result, shards, inserted } = await run([], 2);
    expect(result).toEqual({ shards: 0, storagePrefix: null });
    expect(shards).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });
});
