import { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ObjectStorageProvider, type StoredObjectRef } from '../../../common/contracts/object-storage.provider';
import { encodeShard } from '../../run-result/run-result-payload';
import { type DatasetSamplePayloadRow, DatasetSamplePayloadReader } from '../dataset-sample-payload';

class FakeStorage extends ObjectStorageProvider {
  getObjectCalls = 0;
  constructor(
    private readonly enabled: boolean,
    private readonly shards: Map<string, Buffer> = new Map(),
  ) {
    super();
  }
  isEnabled(): boolean {
    return this.enabled;
  }
  async getObject(ref: StoredObjectRef): Promise<Buffer> {
    this.getObjectCalls += 1;
    const body = this.shards.get(ref.key);
    if (!body) throw new Error(`no shard for ${ref.key}`);
    return body;
  }
  async putObject(): Promise<StoredObjectRef> {
    throw new Error('unused');
  }
  async getObjectStream(): Promise<Readable> {
    throw new Error('unused');
  }
  async deleteObjects(): Promise<void> {
    throw new Error('unused');
  }
  async createSignedDownloadUrl(): Promise<null> {
    return null;
  }
}

function ref(key: string, rowIndex: number) {
  const shard: StoredObjectRef = {
    provider: 'r2',
    bucket: 'b',
    key,
    bytes: 0,
    codec: 'gzip',
    resourceType: 'dataset_normalized',
    resourceId: 'ds',
  };
  return { shard, rowIndex };
}

function row(over: Partial<DatasetSamplePayloadRow>): DatasetSamplePayloadRow {
  return { data: null, payloadRef: null, ...over };
}

describe('DatasetSamplePayloadReader', () => {
  it('returns inline data without touching storage when present', async () => {
    const storage = new FakeStorage(true);
    const reader = new DatasetSamplePayloadReader(storage);
    expect(await reader.hydrate(row({ data: { a: 1 } }))).toEqual({ a: 1 });
    expect(storage.getObjectCalls).toBe(0);
  });

  it('never reads a shard when storage is disabled', async () => {
    const storage = new FakeStorage(false);
    const reader = new DatasetSamplePayloadReader(storage);
    expect(await reader.hydrate(row({ data: null, payloadRef: ref('k', 0) }))).toBeNull();
    expect(storage.getObjectCalls).toBe(0);
  });

  it('reads the sample data from the shard when data is null', async () => {
    const shards = new Map([['k0', await encodeShard([{ q: 'first' }, { q: 'second' }], 'gzip')]]);
    const reader = new DatasetSamplePayloadReader(new FakeStorage(true, shards));
    expect(await reader.hydrate(row({ payloadRef: ref('k0', 1) }))).toEqual({ q: 'second' });
  });

  it('prefers the inline cache over the shard', async () => {
    const shards = new Map([['k0', await encodeShard([{ from: 'shard' }], 'gzip')]]);
    const reader = new DatasetSamplePayloadReader(new FakeStorage(true, shards));
    expect(await reader.hydrate(row({ data: { from: 'cache' }, payloadRef: ref('k0', 0) }))).toEqual({ from: 'cache' });
  });

  it('batch-hydrates a 3-sample batch sharing one shard with a single GET', async () => {
    const shards = new Map([['batch', await encodeShard([{ i: 0 }, { i: 1 }, { i: 2 }], 'gzip')]]);
    const storage = new FakeStorage(true, shards);
    const reader = new DatasetSamplePayloadReader(storage);
    const rows = [
      row({ payloadRef: ref('batch', 0) }),
      row({ payloadRef: ref('batch', 1) }),
      row({ payloadRef: ref('batch', 2) }),
      row({ data: { i: 'inline' } }),
    ];
    expect(await reader.hydrateMany(rows)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }, { i: 'inline' }]);
    expect(storage.getObjectCalls).toBe(1);
  });
});
