import { describe, expect, it } from 'vitest';
import {
  type CompactionRow,
  computeOutputPreview,
  offloadFieldsForSource,
  planCompaction,
} from '../run-result-compaction';
import { type StoredObjectRef } from '../../../common/contracts/object-storage.provider';
import { type RunResultPayloadRow, encodeShard } from '../run-result-payload';
import { RunResultPayloadReader } from '../run-result-payload.reader';
import { ObjectStorageProvider } from '../../../common/contracts/object-storage.provider';

function row(i: number, over: Partial<CompactionRow> = {}): CompactionRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    createdAt: '2026-06-19T00:00:00.000Z',
    renderedPrompt: { prompt: `p${i}` },
    inputVariables: { v: i },
    rawResponse: `raw${i}`,
    parsedOutput: { label: `L${i}` },
    decisionOutput: `D${i}`,
    ...over,
  };
}

describe('offloadFieldsForSource (SPEC 30 §9.4)', () => {
  it('offloads all four fields for high-volume experiment / online', () => {
    expect(offloadFieldsForSource('experiment').sort()).toEqual(
      ['inputVariables', 'parsedOutput', 'rawResponse', 'renderedPrompt'].sort(),
    );
    expect(offloadFieldsForSource('online').sort()).toEqual(
      ['inputVariables', 'parsedOutput', 'rawResponse', 'renderedPrompt'].sort(),
    );
  });

  it('keeps raw/parsed inline for optimization / release / canary (background-read sources)', () => {
    for (const source of ['optimization_analysis', 'optimization_generate', 'release', 'canary']) {
      expect(offloadFieldsForSource(source).sort()).toEqual(['inputVariables', 'renderedPrompt'].sort());
    }
  });
});

describe('planCompaction', () => {
  it('packs rows into shards of maxRowsPerShard, preserving order + row index', () => {
    const rows = [row(0), row(1), row(2), row(3), row(4)];
    const plan = planCompaction(rows, offloadFieldsForSource('experiment'), 2);

    expect(plan.shards.map((s) => s.lines.length)).toEqual([2, 2, 1]); // 5 rows / 2 per shard
    expect(plan.assignments.map((a) => [a.shardSeq, a.rowIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
  });

  it('writes only the offloaded fields into shard lines', () => {
    const plan = planCompaction([row(0)], offloadFieldsForSource('canary'), 100);
    // canary offloads only renderedPrompt + inputVariables
    expect(plan.shards[0]?.lines[0]).toEqual({ renderedPrompt: { prompt: 'p0' }, inputVariables: { v: 0 } });
    expect(plan.clearedFields.sort()).toEqual(['inputVariables', 'renderedPrompt'].sort());
  });

  it('computes previews: input from input_variables, output prefers decision_output', () => {
    const plan = planCompaction([row(7)], offloadFieldsForSource('experiment'), 100);
    expect(plan.assignments[0]?.inputPreview).toBe(JSON.stringify({ v: 7 }));
    expect(plan.assignments[0]?.outputPreview).toBe('D7'); // decision_output preferred
  });

  it('output preview falls back to parsed_output when decision_output is empty', () => {
    expect(computeOutputPreview({ label: 'x' }, null)).toBe(JSON.stringify({ label: 'x' }));
    expect(computeOutputPreview({ label: 'x' }, '')).toBe(JSON.stringify({ label: 'x' }));
  });
});

// End-to-end: a planned shard, once encoded + stored, is read back correctly by the reader using the
// assignment's rowIndex — i.e. compactor output and reader input agree on the shard format.
class OneShardStorage extends ObjectStorageProvider {
  constructor(private readonly body: Buffer) {
    super();
  }
  isEnabled(): boolean {
    return true;
  }
  async getObject(): Promise<Buffer> {
    return this.body;
  }
  async putObject(): Promise<StoredObjectRef> {
    throw new Error('unused');
  }
  async getObjectStream(): Promise<never> {
    throw new Error('unused');
  }
  async deleteObjects(): Promise<void> {
    throw new Error('unused');
  }
  async createSignedDownloadUrl(): Promise<null> {
    return null;
  }
}

describe('compaction → reader round-trip', () => {
  it('reads each row back from its planned shard line', async () => {
    const rows = [row(0), row(1), row(2)];
    const plan = planCompaction(rows, offloadFieldsForSource('experiment'), 100);
    const body = await encodeShard(plan.shards[0]?.lines ?? [], 'gzip');
    const shardRef: StoredObjectRef = {
      provider: 'r2',
      bucket: 'b',
      key: 'orgs/o/run_result_shard/src/gen1/shard-0.jsonl.gz',
      bytes: body.byteLength,
      codec: 'gzip',
      resourceType: 'run_result_shard',
      resourceId: 'src',
    };
    const reader = new RunResultPayloadReader(new OneShardStorage(body));

    // Simulate the post-compaction DB row: inline offloaded fields cleared, payload_ref set.
    const dbRows: RunResultPayloadRow[] = plan.assignments.map((a) => ({
      renderedPrompt: null,
      inputVariables: null,
      rawResponse: null,
      parsedOutput: null,
      payloadRef: { shard: shardRef, rowIndex: a.rowIndex },
    }));

    const hydrated = await reader.hydrateMany(dbRows);
    expect(hydrated.map((h) => h.renderedPrompt)).toEqual([{ prompt: 'p0' }, { prompt: 'p1' }, { prompt: 'p2' }]);
    expect(hydrated.map((h) => h.rawResponse)).toEqual(['raw0', 'raw1', 'raw2']);
  });
});
