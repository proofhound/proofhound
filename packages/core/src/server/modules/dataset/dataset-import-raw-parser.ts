import { StringDecoder } from 'node:string_decoder';
import { Readable, Transform } from 'node:stream';
import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';
import Papa from 'papaparse';
import type { DatasetImportSourceFormat } from '@proofhound/shared';

export const DEFAULT_RAW_IMPORT_MAX_LINE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_RAW_IMPORT_MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

const inflateRawAsync = promisify(inflateRaw);

export async function* parseRawDatasetRows(
  stream: Readable,
  sourceFormat: DatasetImportSourceFormat,
  options: { maxLineBytes?: number; maxBufferedBytes?: number } = {},
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
  if (sourceFormat === 'json') {
    yield* parseJsonArrayRows(stream, options.maxBufferedBytes ?? DEFAULT_RAW_IMPORT_MAX_BUFFERED_BYTES);
    return;
  }
  if (sourceFormat === 'zip') {
    yield* parseZipRows(stream, options.maxBufferedBytes ?? DEFAULT_RAW_IMPORT_MAX_BUFFERED_BYTES);
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
  // Papaparse's Node stream mode resurrects trailing blank lines into phantom
  // `{ field_1: ... }` rows once the parsed rows cross its object-stream buffer,
  // because `transformHeader` gets reapplied to an EOF chunk whose first line is
  // blank. Strip whitespace-only bytes at the end of the stream before parsing so
  // trailing blank lines never reach papaparse. Blank lines inside quoted fields
  // are always followed by non-whitespace bytes, so they are preserved.
  const guardedStream = stream.pipe(createLineByteGuard(maxLineBytes));
  const trimmedStream = guardedStream.pipe(stripTrailingBlankLines());
  // Papaparse's Node stream mode stringifies each raw chunk on its own, so a
  // chunk that ends inside a multi-byte UTF-8 character corrupts it into U+FFFD.
  // Decode to complete character boundaries first so multi-byte text (e.g. CJK)
  // survives arbitrary chunk splits.
  const decodedStream = trimmedStream.pipe(decodeUtf8Boundaries());

  guardedStream.on('error', (error) => trimmedStream.destroy(error));
  trimmedStream.on('error', (error) => decodedStream.destroy(error));
  decodedStream.on('error', (error) => papaStream.destroy(error));
  decodedStream.pipe(papaStream);

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

function stripTrailingBlankLines(): Transform {
  const isAsciiWhitespace = (byte: number): boolean =>
    byte === 0x0a || byte === 0x0d || byte === 0x20 || byte === 0x09;
  // Buffer whitespace-only runs until non-whitespace confirms they are interior;
  // whatever remains buffered at EOF is a trailing blank-line run and is dropped.
  let pendingWhitespace: Buffer | null = null;

  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      let lastNonWhitespace = -1;
      for (let index = buffer.length - 1; index >= 0; index -= 1) {
        if (!isAsciiWhitespace(buffer[index]!)) {
          lastNonWhitespace = index;
          break;
        }
      }

      if (lastNonWhitespace === -1) {
        pendingWhitespace = pendingWhitespace ? Buffer.concat([pendingWhitespace, buffer]) : Buffer.from(buffer);
        callback();
        return;
      }

      const head = buffer.subarray(0, lastNonWhitespace + 1);
      const trailing = buffer.subarray(lastNonWhitespace + 1);
      const flushed = pendingWhitespace ? Buffer.concat([pendingWhitespace, head]) : head;
      pendingWhitespace = trailing.length > 0 ? Buffer.from(trailing) : null;
      callback(null, flushed);
    },
    flush(callback) {
      pendingWhitespace = null;
      callback();
    },
  });
}

function decodeUtf8Boundaries(): Transform {
  const decoder = new StringDecoder('utf8');
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const decoded = decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (decoded.length === 0) {
        callback();
        return;
      }
      callback(null, Buffer.from(decoded, 'utf8'));
    },
    flush(callback) {
      const rest = decoder.end();
      callback(null, rest.length > 0 ? Buffer.from(rest, 'utf8') : undefined);
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

async function* parseJsonArrayRows(stream: Readable, maxBytes: number): AsyncGenerator<Record<string, unknown>> {
  const buffer = await readStreamBuffer(stream, maxBytes);
  const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('json_array_required');
  for (const row of parsed) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      yield row as Record<string, unknown>;
    }
  }
}

async function* parseZipRows(stream: Readable, maxBytes: number): AsyncGenerator<Record<string, unknown>> {
  const buffer = await readStreamBuffer(stream, maxBytes);
  const entries = readZipEntries(buffer);
  const dataEntry = await chooseZipDataEntry(buffer, entries);
  const dataBytes = await readZipEntryBytes(buffer, dataEntry);
  const dataStream = Readable.from([dataBytes]);
  const rows: Array<Record<string, unknown>> = [];
  for await (const row of parseRawDatasetRows(dataStream, extensionToSourceFormat(dataEntry.name), {
    maxLineBytes: maxBytes,
  })) {
    rows.push(row);
  }
  for (const row of await inlineZipImages(rows, dataEntry, buffer, entries)) {
    yield row;
  }
}

async function readStreamBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error('dataset_import_file_too_large_for_buffered_parser');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

interface ZipEntry {
  path: string;
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
}

interface DatasetManifest {
  file?: unknown;
}

function readUint16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readUint32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.byteLength - 65_557);
  for (let offset = buffer.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(buffer, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error('zip_invalid');

  const entryCount = readUint16(buffer, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(buffer, eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(buffer, offset) !== 0x02014b50) throw new Error('zip_invalid');

    const compressionMethod = readUint16(buffer, offset + 10);
    const compressedSize = readUint32(buffer, offset + 20);
    const uncompressedSize = readUint32(buffer, offset + 24);
    const fileNameLength = readUint16(buffer, offset + 28);
    const extraLength = readUint16(buffer, offset + 30);
    const commentLength = readUint16(buffer, offset + 32);
    const localHeaderOffset = readUint32(buffer, offset + 42);
    const path = normalizePath(buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8'));

    if (path && !path.endsWith('/')) {
      if (readUint32(buffer, localHeaderOffset) !== 0x04034b50) throw new Error('zip_invalid');
      const localNameLength = readUint16(buffer, localHeaderOffset + 26);
      const localExtraLength = readUint16(buffer, localHeaderOffset + 28);
      entries.push({
        path,
        name: path.split('/').at(-1) ?? path,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        dataStart: localHeaderOffset + 30 + localNameLength + localExtraLength,
      });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntryBytes(buffer: Buffer, entry: ZipEntry): Promise<Buffer> {
  const compressed = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawAsync(compressed);
  throw new Error('zip_compression_unsupported');
}

async function chooseZipDataEntry(buffer: Buffer, entries: ZipEntry[]): Promise<ZipEntry> {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntries = entries
    .filter((entry) => entry.name.toLowerCase() === 'manifest.json')
    .sort((a, b) => compareDatasetPaths(a.path, b.path));

  for (const manifestEntry of manifestEntries) {
    try {
      const manifestText = (await readZipEntryBytes(buffer, manifestEntry)).toString('utf8');
      const manifest = JSON.parse(manifestText) as DatasetManifest;
      if (typeof manifest.file !== 'string') continue;
      const targetPath = joinPath(getDirectory(manifestEntry.path), manifest.file);
      const matchedEntry = entryByPath.get(targetPath);
      if (matchedEntry && isStructuredDatasetExtension(getExtension(matchedEntry.name))) return matchedEntry;
    } catch {
      // Ignore invalid metadata files; data file candidates remain authoritative.
    }
  }

  const datasetEntries = entries
    .filter(
      (entry) => isStructuredDatasetExtension(getExtension(entry.name)) && entry.name.toLowerCase() !== 'manifest.json',
    )
    .sort((a, b) => compareDatasetPaths(a.path, b.path));
  const first = datasetEntries[0];
  if (!first) throw new Error('unsupported_file_type');
  return first;
}

async function inlineZipImages(
  samples: Array<Record<string, unknown>>,
  dataEntry: ZipEntry,
  buffer: Buffer,
  entries: ZipEntry[],
): Promise<Array<Record<string, unknown>>> {
  const imageEntries = new Map(
    entries.filter((entry) => extensionToImageMimeType(entry.path)).map((entry) => [entry.path, entry]),
  );
  if (imageEntries.size === 0) return samples;

  const dataDirectory = getDirectory(dataEntry.path);
  const dataUrlCache = new Map<string, string>();

  const toDataUrl = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map((item) => toDataUrl(item)));
    if (typeof value !== 'string') return value;

    const imagePath = resolveZipImagePath(value, dataDirectory, imageEntries);
    if (!imagePath) return value;

    const cached = dataUrlCache.get(imagePath);
    if (cached) return cached;

    const entry = imageEntries.get(imagePath);
    const mimeType = entry ? extensionToImageMimeType(entry.path) : null;
    if (!entry || !mimeType) return value;

    const bytes = await readZipEntryBytes(buffer, entry);
    if (entry.uncompressedSize > 0 && bytes.byteLength !== entry.uncompressedSize) throw new Error('zip_invalid');
    const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
    dataUrlCache.set(imagePath, dataUrl);
    return dataUrl;
  };

  return Promise.all(
    samples.map(async (sample) =>
      Object.fromEntries(
        await Promise.all(Object.entries(sample).map(async ([key, value]) => [key, await toDataUrl(value)])),
      ),
    ),
  );
}

function extensionToSourceFormat(path: string): DatasetImportSourceFormat {
  const extension = getExtension(path);
  if (extension === '.csv') return 'csv';
  if (extension === '.tsv') return 'tsv';
  if (extension === '.jsonl') return 'jsonl';
  if (extension === '.json') return 'json';
  throw new Error('unsupported_file_type');
}

function isStructuredDatasetExtension(extension: string): boolean {
  return extension === '.csv' || extension === '.tsv' || extension === '.jsonl' || extension === '.json';
}

function extensionToImageMimeType(path: string): string | null {
  const extension = getExtension(path);
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.bmp') return 'image/bmp';
  if (extension === '.avif') return 'image/avif';
  if (extension === '.svg') return 'image/svg+xml';
  return null;
}

function resolveZipImagePath(value: string, dataDirectory: string, imageEntries: Map<string, ZipEntry>): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//iu.test(trimmed) || /^data:image\//iu.test(trimmed)) return null;
  const candidates = [joinPath(dataDirectory, trimmed), normalizePath(trimmed.replace(/^\/+/u, ''))];
  return candidates.find((candidate) => imageEntries.has(candidate)) ?? null;
}

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function getDirectory(path: string): string {
  const normalizedPath = normalizePath(path);
  const lastSlash = normalizedPath.lastIndexOf('/');
  return lastSlash >= 0 ? normalizedPath.slice(0, lastSlash) : '';
}

function joinPath(directory: string, fileName: string): string {
  return normalizePath(directory ? `${directory}/${fileName}` : fileName);
}

function compareDatasetPaths(left: string, right: string): number {
  const leftDepth = normalizePath(left).split('/').length;
  const rightDepth = normalizePath(right).split('/').length;
  if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  return left.localeCompare(right);
}
