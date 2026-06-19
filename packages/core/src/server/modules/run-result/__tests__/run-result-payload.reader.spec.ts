import { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  type GetObjectRange,
  ObjectStorageProvider,
  type ResourceLocator,
  type StoredObjectRef,
} from '../../../common/contracts/object-storage.provider';
import {
  type RunResultPayloadRef,
  type RunResultPayloadRow,
  type RunResultShardLine,
  encodeShard,
} from '../run-result-payload';
import { RunResultPayloadReader } from '../run-result-payload.reader';

// Minimal fake: only isEnabled + getObject are exercised; getObject serves a pre-built shard by key
// and counts calls so we can assert "one GET per shard, not per row".
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
  async getObject(ref: StoredObjectRef, _range?: GetObjectRange): Promise<Buffer> {
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

function shardRef(key: string): StoredObjectRef {
  return { provider: 'r2', bucket: 'b', key, bytes: 0, codec: 'gzip', resourceType: 'run_result_shard', resourceId: 'src' };
}

function ref(key: string, rowIndex: number): RunResultPayloadRef {
  return { shard: shardRef(key), rowIndex };
}

function inlineRow(fields: Partial<RunResultPayloadRow>): RunResultPayloadRow {
  return {
    renderedPrompt: null,
    inputVariables: null,
    rawResponse: null,
    parsedOutput: null,
    payloadRef: null,
    ...fields,
  };
}

async function shardOf(lines: RunResultShardLine[]): Promise<Buffer> {
  return encodeShard(lines, 'gzip');
}

describe('RunResultPayloadReader', () => {
  it('passes inline fields through without touching storage when there is no payload_ref', async () => {
    const storage = new FakeStorage(true);
    const reader = new RunResultPayloadReader(storage);
    const row = inlineRow({ renderedPrompt: { a: 1 }, rawResponse: 'hi', parsedOutput: { ok: true } });

    const out = await reader.hydrate(row);

    expect(out).toEqual({ renderedPrompt: { a: 1 }, inputVariables: null, rawResponse: 'hi', parsedOutput: { ok: true } });
    expect(storage.getObjectCalls).toBe(0);
  });

  it('never reads a shard when the provider is disabled (OSS-no-storage invariant)', async () => {
    const storage = new FakeStorage(false);
    const reader = new RunResultPayloadReader(storage);
    const row = inlineRow({ renderedPrompt: { kept: true }, payloadRef: ref('orgs/o/shard-0.gz', 0) });

    const out = await reader.hydrate(row);

    expect(out.renderedPrompt).toEqual({ kept: true });
    expect(storage.getObjectCalls).toBe(0);
  });

  it('reads the offloaded field from the shard when the inline value is null', async () => {
    const shards = new Map([['k0', await shardOf([{ renderedPrompt: { full: 'prompt' }, inputVariables: { v: 1 } }])]]);
    const storage = new FakeStorage(true, shards);
    const reader = new RunResultPayloadReader(storage);
    const row = inlineRow({ payloadRef: ref('k0', 0) });

    const out = await reader.hydrate(row);

    expect(out.renderedPrompt).toEqual({ full: 'prompt' });
    expect(out.inputVariables).toEqual({ v: 1 });
    expect(storage.getObjectCalls).toBe(1);
  });

  it('prefers the inline cache over the shard when both are present (small-row cache)', async () => {
    const shards = new Map([['k0', await shardOf([{ parsedOutput: { from: 'shard' } }])]]);
    const storage = new FakeStorage(true, shards);
    const reader = new RunResultPayloadReader(storage);
    // raw_response stays inline (a not-offloaded source); parsed_output offloaded.
    const row = inlineRow({ rawResponse: 'inline-raw', payloadRef: ref('k0', 0) });

    const out = await reader.hydrate(row);

    expect(out.rawResponse).toBe('inline-raw');
    expect(out.parsedOutput).toEqual({ from: 'shard' });
  });

  it('batch-hydrates a page sharing one shard with a single GET', async () => {
    const shards = new Map([
      ['page-shard', await shardOf([{ renderedPrompt: 'p0' }, { renderedPrompt: 'p1' }, { renderedPrompt: 'p2' }])],
    ]);
    const storage = new FakeStorage(true, shards);
    const reader = new RunResultPayloadReader(storage);
    const rows = [
      inlineRow({ payloadRef: ref('page-shard', 0) }),
      inlineRow({ payloadRef: ref('page-shard', 1) }),
      inlineRow({ payloadRef: ref('page-shard', 2) }),
      inlineRow({ renderedPrompt: 'inline-only' }), // no ref → untouched
    ];

    const out = await reader.hydrateMany(rows);

    expect(out.map((o) => o.renderedPrompt)).toEqual(['p0', 'p1', 'p2', 'inline-only']);
    expect(storage.getObjectCalls).toBe(1); // one GET for the whole page, not four
  });

  it('exposes single-field convenience readers', async () => {
    const shards = new Map([['k', await shardOf([{ parsedOutput: { label: 'x' }, rawResponse: 'raw' }])]]);
    const storage = new FakeStorage(true, shards);
    const reader = new RunResultPayloadReader(storage);
    const row = inlineRow({ payloadRef: ref('k', 0) });

    expect(await reader.readParsedOutput(row)).toEqual({ label: 'x' });
    expect(await reader.readRawResponse(row)).toBe('raw');
  });
});
