import { StringDecoder } from 'node:string_decoder';
import { Transform, type Readable } from 'node:stream';
import Papa from 'papaparse';
import type { DatasetImportSourceFormat } from '@proofhound/shared';

export const DEFAULT_RAW_IMPORT_MAX_LINE_BYTES = 16 * 1024 * 1024;

export async function* parseRawDatasetRows(
  stream: Readable,
  sourceFormat: DatasetImportSourceFormat,
  options: { maxLineBytes?: number } = {},
): AsyncGenerator<Record<string, unknown>> {
  if (sourceFormat === 'jsonl') {
    yield* parseJsonlRows(stream, options.maxLineBytes ?? DEFAULT_RAW_IMPORT_MAX_LINE_BYTES);
    return;
  }
  if (sourceFormat === 'csv' || sourceFormat === 'tsv') {
    yield* parseDelimitedRows(
      stream,
      sourceFormat === 'csv' ? ',' : '\t',
      options.maxLineBytes ?? DEFAULT_RAW_IMPORT_MAX_LINE_BYTES,
    );
    return;
  }
  throw new Error('unsupported_file_type');
}

async function* parseJsonlRows(stream: Readable, maxLineBytes: number): AsyncGenerator<Record<string, unknown>> {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  const parseLine = (line: string): Record<string, unknown> | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  };

  for await (const chunk of stream) {
    pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      assertLineWithinLimit(line, maxLineBytes);
      const row = parseLine(line);
      if (row) yield row;
    }
    assertLineWithinLimit(pending, maxLineBytes);
  }

  pending += decoder.end();
  assertLineWithinLimit(pending, maxLineBytes);
  const row = parseLine(pending);
  if (row) yield row;
}

async function* parseDelimitedRows(
  stream: Readable,
  delimiter: ',' | '\t',
  maxLineBytes: number,
): AsyncGenerator<Record<string, unknown>> {
  const papaStream = Papa.parse(Papa.NODE_STREAM_INPUT, {
    delimiter,
    header: true,
    skipEmptyLines: 'greedy',
    transform: parseDelimitedCell,
    transformHeader: (header: string, index: number) => header.trim() || `field_${index + 1}`,
  });
  const guardedStream = stream.pipe(createLineByteGuard(maxLineBytes));

  guardedStream.on('error', (error) => papaStream.destroy(error));
  guardedStream.pipe(papaStream);

  for await (const row of papaStream as AsyncIterable<unknown>) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      yield row as Record<string, unknown>;
    }
  }
}

function assertLineWithinLimit(line: string, maxLineBytes: number): void {
  if (Buffer.byteLength(line, 'utf8') > maxLineBytes) throw new Error('dataset_import_line_too_large');
}

function createLineByteGuard(maxLineBytes: number): Transform {
  let lineBytes = 0;
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of buffer) {
        if (byte === 0x0a) {
          lineBytes = 0;
          continue;
        }
        lineBytes += 1;
        if (lineBytes > maxLineBytes) {
          callback(new Error('dataset_import_line_too_large'));
          return;
        }
      }
      callback(null, chunk);
    },
  });
}

function parseDelimitedCell(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return trimmed;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : trimmed;
  } catch {
    return trimmed;
  }
}
