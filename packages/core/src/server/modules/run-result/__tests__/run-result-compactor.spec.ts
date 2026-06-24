import type { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ObjectStorageProvider,
  type PutObjectOptions,
  type ResourceLocator,
  type StoredObjectRef,
} from '../../../common/contracts/object-storage.provider';
import { type CompactionRow } from '../run-result-compaction';
import {
  type CommitCompactionInput,
  type CompactionTarget,
  type RunResultCompactionStore,
  RunResultCompactor,
} from '../run-result-compactor';

class FakeStorage extends ObjectStorageProvider {
  enabled = true;
  puts: Array<{ key: string; codec?: string }> = [];
  isEnabled(): boolean {
    return this.enabled;
  }
  async putObject(loc: ResourceLocator, _body: Buffer | Readable, opts?: PutObjectOptions): Promise<StoredObjectRef> {
    const key = `orgs/o/projects/${loc.project.projectId}/${loc.resourceType}/${loc.resourceId}/${loc.name}`;
    this.puts.push({ key, codec: opts?.codec });
    return {
      provider: 'r2',
      bucket: 'b',
      key,
      bytes: 1,
      codec: opts?.codec,
      resourceType: loc.resourceType,
      resourceId: loc.resourceId,
    };
  }
  async getObject(): Promise<Buffer> {
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

class FakeStore implements RunResultCompactionStore {
  committed: CommitCompactionInput | null = null;
  loadCalls = 0;
  pendingGroups: Array<{ projectId: string; source: string; sourceId: string }> = [];
  committedRows: number | null = null;
  constructor(
    private readonly rows: CompactionRow[],
    private readonly generation = 1,
  ) {}
  async nextGeneration(): Promise<number> {
    return this.generation;
  }
  async loadUncompacted(_target: CompactionTarget): Promise<CompactionRow[]> {
    this.loadCalls += 1;
    return this.rows;
  }
  async commit(input: CommitCompactionInput): Promise<number> {
    this.committed = input;
    return this.committedRows ?? input.assignments.length;
  }
  async findPendingGroups(): Promise<Array<{ projectId: string; source: string; sourceId: string }>> {
    return this.pendingGroups;
  }
}

function row(i: number): CompactionRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    createdAt: '2026-06-19T00:00:00.000Z',
    renderedPrompt: { p: i },
    inputVariables: { v: i },
    rawResponse: `r${i}`,
    parsedOutput: { l: i },
    decisionOutput: `D${i}`,
  };
}

const target: CompactionTarget = { projectId: 'proj-1', source: 'experiment', sourceId: 'src-1' };

describe('RunResultCompactor', () => {
  it('is a no-op when object storage is disabled (OSS-no-storage invariant)', async () => {
    const storage = new FakeStorage();
    storage.enabled = false;
    const store = new FakeStore([row(0)]);
    const out = await new RunResultCompactor(store, storage).compact(target);

    expect(out).toEqual({ compactedRows: 0, shards: 0, generation: null });
    expect(store.loadCalls).toBe(0);
    expect(storage.puts).toHaveLength(0);
  });

  it('does nothing when there are no uncompacted rows', async () => {
    const storage = new FakeStorage();
    const store = new FakeStore([]);
    const out = await new RunResultCompactor(store, storage).compact(target);

    expect(out.compactedRows).toBe(0);
    expect(storage.puts).toHaveLength(0);
    expect(store.committed).toBeNull();
  });

  it('writes a generation-keyed shard and commits the assignments', async () => {
    const storage = new FakeStorage();
    const store = new FakeStore([row(0), row(1)], 3);
    const out = await new RunResultCompactor(store, storage).compact(target);

    expect(out).toEqual({ compactedRows: 2, shards: 1, generation: 3 });
    expect(storage.puts).toEqual([
      { key: 'orgs/o/projects/proj-1/run_result_shard/src-1/gen3/shard-00000.jsonl.gz', codec: 'gzip' },
    ]);
    expect(store.committed?.generation).toBe(3);
    expect(store.committed?.assignments.map((a) => [a.shardSeq, a.rowIndex])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    // payload_ref shard carries the generation
    expect(store.committed?.shardRefs[0]?.version).toBe(3);
    // experiment offloads all four fields
    expect(store.committed?.clearedFields.sort()).toEqual(
      ['inputVariables', 'parsedOutput', 'rawResponse', 'renderedPrompt'].sort(),
    );
  });

  it('reports the number of rows actually committed by the store', async () => {
    const storage = new FakeStorage();
    const store = new FakeStore([row(0), row(1)], 3);
    store.committedRows = 1;

    const out = await new RunResultCompactor(store, storage).compact(target);

    expect(out).toEqual({ compactedRows: 1, shards: 1, generation: 3 });
    expect(store.committed?.assignments).toHaveLength(2);
  });

  it('compactPending compacts each pending group for the given sources', async () => {
    const storage = new FakeStorage();
    const store = new FakeStore([row(0)], 1);
    store.pendingGroups = [
      { projectId: 'p', source: 'online', sourceId: 's1' },
      { projectId: 'p', source: 'online', sourceId: 's2' },
    ];
    const out = await new RunResultCompactor(store, storage).compactPending(['online']);

    expect(out.groups).toBe(2);
    expect(out.compactedRows).toBe(2); // one row per group
    expect(storage.puts).toHaveLength(2); // one shard per group
  });

  it('compactPending is a no-op when storage is disabled', async () => {
    const storage = new FakeStorage();
    storage.enabled = false;
    const store = new FakeStore([row(0)]);
    store.pendingGroups = [{ projectId: 'p', source: 'online', sourceId: 's1' }];
    expect(await new RunResultCompactor(store, storage).compactPending(['online'])).toEqual({
      groups: 0,
      compactedRows: 0,
    });
  });
});
