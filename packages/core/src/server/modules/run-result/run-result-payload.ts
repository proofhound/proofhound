// Run-result large-payload tiering — shared shard format + codec (SPEC 30 §9).
//
// When object storage is configured, a run's four large fields are compacted into a compressed
// JSONL shard: one line per row, each line the offloaded fields of that row. The row keeps a
// `payload_ref` ({ shard, rowIndex }) so any reader can resolve a field back. The reader
// (run-result-payload.reader.ts) and the compactor (run-result-compactor.ts) both speak this format.
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, gunzip, gzip } from 'node:zlib';
import type { ObjectCodec, StoredObjectRef } from '../../common/contracts/object-storage.provider';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

/** The four large fields that tier out of `run_results`. `null` = absent / genuinely empty. */
export interface RunResultPayloadFields {
  renderedPrompt: unknown;
  inputVariables: unknown;
  rawResponse: string | null;
  parsedOutput: unknown;
}

/** One JSONL line in a shard. A source only offloads some fields (SPEC 30 §9.4), so all optional. */
export type RunResultShardLine = Partial<RunResultPayloadFields>;

/** Stored in `run_results.payload_ref`: the shard holding this row + which line it is. */
export interface RunResultPayloadRef {
  shard: StoredObjectRef;
  rowIndex: number;
}

/** Minimal row shape the reader consumes: the inline (possibly-null) fields + the pointer. */
export interface RunResultPayloadRow extends RunResultPayloadFields {
  payloadRef: RunResultPayloadRef | null;
}

const PAYLOAD_FIELDS: ReadonlyArray<keyof RunResultPayloadFields> = [
  'renderedPrompt',
  'inputVariables',
  'rawResponse',
  'parsedOutput',
];

/** Pick only the offloadable fields off a wider row, defaulting missing ones to null. */
export function pickPayloadFields(row: Partial<RunResultPayloadFields>): RunResultPayloadFields {
  return {
    renderedPrompt: row.renderedPrompt ?? null,
    inputVariables: row.inputVariables ?? null,
    rawResponse: row.rawResponse ?? null,
    parsedOutput: row.parsedOutput ?? null,
  };
}

/** Keep only the fields a source actually offloads; drops the rest so they are not double-stored. */
export function shardLineForFields(
  fields: RunResultPayloadFields,
  offload: ReadonlyArray<keyof RunResultPayloadFields>,
): RunResultShardLine {
  const line: RunResultShardLine = {};
  for (const key of PAYLOAD_FIELDS) {
    if (offload.includes(key)) {
      (line as Record<string, unknown>)[key] = fields[key] ?? null;
    }
  }
  return line;
}

async function compress(buf: Buffer, codec: ObjectCodec): Promise<Buffer> {
  switch (codec) {
    case 'gzip':
      return gzipAsync(buf);
    case 'br':
      return brotliCompressAsync(buf);
    case 'identity':
      return buf;
    default:
      throw new Error(`unsupported shard codec for write: ${codec}`);
  }
}

async function decompress(buf: Buffer, codec: ObjectCodec | undefined): Promise<Buffer> {
  switch (codec ?? 'identity') {
    case 'gzip':
      return gunzipAsync(buf);
    case 'br':
      return brotliDecompressAsync(buf);
    case 'identity':
      return buf;
    default:
      throw new Error(`unsupported shard codec for read: ${codec}`);
  }
}

/** Encode shard lines into compressed JSONL bytes (the object body a compactor writes). Generic so
 *  dataset-sample shards (one data object per line) reuse the same codec as run-result shards. */
export async function encodeShard<T>(lines: T[], codec: ObjectCodec): Promise<Buffer> {
  const jsonl = lines.map((line) => JSON.stringify(line)).join('\n');
  return compress(Buffer.from(jsonl, 'utf8'), codec);
}

/** Decode a shard body back into its lines (used by the readers). */
export async function decodeShard<T = RunResultShardLine>(body: Buffer, codec: ObjectCodec | undefined): Promise<T[]> {
  const text = (await decompress(body, codec)).toString('utf8');
  if (text.length === 0) return [];
  return text.split('\n').map((line) => (line.length === 0 ? ({} as T) : (JSON.parse(line) as T)));
}
