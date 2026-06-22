// RunResultPayloadReader — the single read seam for run-result large fields (SPEC 30 §9.2).
//
// Every detail / background read of rendered_prompt / input_variables / raw_response / parsed_output
// goes through here. It returns the inline value when present (a fresh row, a not-offloaded field, or
// a small-row cache) and otherwise reads the row's shard. When object storage is disabled or the row
// has no payload_ref, it is a pure pass-through of the inline fields, so behaviour is unchanged on an
// OSS deployment with no storage configured.
import { Injectable } from '@nestjs/common';
import { ObjectStorageProvider } from '../../common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import {
  type RunResultPayloadFields,
  type RunResultPayloadRef,
  type RunResultPayloadRow,
  type RunResultShardLine,
  decodeShard,
  pickPayloadFields,
} from './run-result-payload';

@Injectable()
export class RunResultPayloadReader {
  constructor(private readonly storage: ObjectStorageProvider) {}

  /** Resolve all four fields for one row, fetching its shard at most once. */
  async hydrate(row: RunResultPayloadRow): Promise<RunResultPayloadFields> {
    if (!this.needsShard(row)) return pickPayloadFields(row);
    const line = await this.loadShardLine(row.payloadRef as RunResultPayloadRef);
    return mergeInlineOverShard(row, line);
  }

  /**
   * Batch variant: groups rows by shard object so each shard is fetched exactly once. The dominant
   * pattern (a page / batch of rows from one run) shares a shard, so this is one GET, not one per row.
   */
  async hydrateMany(rows: RunResultPayloadRow[]): Promise<RunResultPayloadFields[]> {
    const out: RunResultPayloadFields[] = rows.map((row) => pickPayloadFields(row));
    const byShard = new Map<string, { shard: StoredObjectRef; entries: Array<{ index: number; rowIndex: number }> }>();
    rows.forEach((row, index) => {
      if (!this.needsShard(row)) return;
      const pref = row.payloadRef as RunResultPayloadRef;
      const key = shardKey(pref.shard);
      const group = byShard.get(key);
      if (group) group.entries.push({ index, rowIndex: pref.rowIndex });
      else byShard.set(key, { shard: pref.shard, entries: [{ index, rowIndex: pref.rowIndex }] });
    });

    await Promise.all(
      [...byShard.values()].map(async ({ shard, entries }) => {
        const lines = await decodeShard(await this.storage.getObject(shard), shard.codec);
        for (const { index, rowIndex } of entries) {
          const row = rows[index];
          if (row) out[index] = mergeInlineOverShard(row, lines[rowIndex] ?? {});
        }
      }),
    );
    return out;
  }

  async readRenderedPrompt(row: RunResultPayloadRow): Promise<unknown> {
    return (await this.hydrate(row)).renderedPrompt;
  }

  async readInputVariables(row: RunResultPayloadRow): Promise<unknown> {
    return (await this.hydrate(row)).inputVariables;
  }

  async readRawResponse(row: RunResultPayloadRow): Promise<string | null> {
    return (await this.hydrate(row)).rawResponse;
  }

  async readParsedOutput(row: RunResultPayloadRow): Promise<unknown> {
    return (await this.hydrate(row)).parsedOutput;
  }

  private needsShard(row: RunResultPayloadRow): boolean {
    return row.payloadRef != null && this.storage.isEnabled();
  }

  private async loadShardLine(ref: RunResultPayloadRef): Promise<RunResultShardLine> {
    const lines = await decodeShard(await this.storage.getObject(ref.shard), ref.shard.codec);
    return lines[ref.rowIndex] ?? {};
  }
}

function shardKey(ref: StoredObjectRef): string {
  return `${ref.provider}:${ref.bucket ?? ''}:${ref.key}`;
}

/** Inline value wins when present (not-offloaded field or small-row cache); else the shard's. */
function mergeInlineOverShard(row: RunResultPayloadRow, line: RunResultShardLine): RunResultPayloadFields {
  return {
    renderedPrompt: row.renderedPrompt ?? line.renderedPrompt ?? null,
    inputVariables: row.inputVariables ?? line.inputVariables ?? null,
    rawResponse: row.rawResponse ?? line.rawResponse ?? null,
    parsedOutput: row.parsedOutput ?? line.parsedOutput ?? null,
  };
}
