import type { DatasetFieldRole } from '@proofhound/shared';

export const FORMAT_CHIPS = ['.csv', '.tsv', '.jsonl', '.json', '.zip'] as const;
export const PREVIEW_LIMIT = 5;
// Bytes read from the head of a large file to build a preview + field mapping without loading the whole file.
export const PREVIEW_BYTES = 256 * 1024;

type DatasetFileExtension = (typeof FORMAT_CHIPS)[number];
type UploadFile = File & { proofhoundRelativePath?: string };

export interface ParsedDatasetFile {
  columns: string[];
  samples: Array<Record<string, unknown>>;
}

interface DatasetManifest {
  file?: unknown;
}

interface ZipEntry {
  path: string;
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
}

export function getUploadFilePath(file: File) {
  const uploadFile = file as UploadFile;
  // Use `||` not `??`: webkitRelativePath is an empty string (not nullish) for non-directory selections,
  // so it must fall through to file.name rather than yielding "".
  return uploadFile.proofhoundRelativePath || file.webkitRelativePath || file.name;
}

export function getDisplayValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function getDatasetNameFromFile(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/u, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
}

export function inferRole(column: string, sampleValue: unknown): DatasetFieldRole {
  const normalized = column.toLowerCase();
  const value = typeof sampleValue === 'string' ? sampleValue : '';

  if (/(^|_)(id|sample_id|external_id)$/u.test(normalized)) return 'id';
  if (/(^|_)(answer|expected|expected_output|label|target|ground_truth|gold)$/u.test(normalized)) return 'expected';
  if (
    /(image|img|photo|picture|screenshot)/u.test(normalized) ||
    /^data:image\//u.test(value) ||
    isImageReferenceArray(sampleValue)
  ) {
    return 'image';
  }
  if (/(question|input|text|query|utterance|message|prompt)/u.test(normalized)) return 'text';
  return 'metadata';
}

export function projectSamplesToColumns(samples: Array<Record<string, unknown>>, columns: string[]) {
  return samples.map((sample) =>
    Object.fromEntries(
      columns.map((column) => [column, Object.prototype.hasOwnProperty.call(sample, column) ? sample[column] : null]),
    ),
  );
}

function getExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function isDatasetFile(file: File) {
  const extension = getExtension(file.name);
  return FORMAT_CHIPS.includes(extension as DatasetFileExtension) && file.name.toLowerCase() !== 'manifest.json';
}

function isStructuredDatasetExtension(extension: string) {
  return extension === '.csv' || extension === '.tsv' || extension === '.jsonl' || extension === '.json';
}

function normalizePath(path: string) {
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

function getDirectory(path: string) {
  const normalizedPath = normalizePath(path);
  const lastSlash = normalizedPath.lastIndexOf('/');
  return lastSlash >= 0 ? normalizedPath.slice(0, lastSlash) : '';
}

function joinPath(directory: string, fileName: string) {
  return normalizePath(directory ? `${directory}/${fileName}` : fileName);
}

function compareDatasetFiles(left: File, right: File) {
  const leftPath = getUploadFilePath(left);
  const rightPath = getUploadFilePath(right);
  const leftDepth = normalizePath(leftPath).split('/').length;
  const rightDepth = normalizePath(rightPath).split('/').length;

  if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  return leftPath.localeCompare(rightPath);
}

function compareDatasetPaths(left: string, right: string) {
  const leftDepth = normalizePath(left).split('/').length;
  const rightDepth = normalizePath(right).split('/').length;

  if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  return left.localeCompare(right);
}

async function getManifestMatches(files: File[], datasetFiles: File[]) {
  const datasetFileByPath = new Map(datasetFiles.map((file) => [normalizePath(getUploadFilePath(file)), file]));
  const matches: File[] = [];

  for (const file of files) {
    if (file.name.toLowerCase() !== 'manifest.json') continue;

    try {
      const manifest = JSON.parse(await file.text()) as DatasetManifest;
      if (typeof manifest.file !== 'string') continue;

      const manifestPath = normalizePath(getUploadFilePath(file));
      const targetPath = joinPath(getDirectory(manifestPath), manifest.file);
      const matchedFile = datasetFileByPath.get(targetPath);
      if (matchedFile) matches.push(matchedFile);
    } catch {
      // Ignore invalid metadata files; the data file candidates below remain authoritative.
    }
  }

  return Array.from(new Set(matches));
}

export async function selectDatasetFile(files: File[]): Promise<File> {
  const datasetFiles = files.filter(isDatasetFile).sort(compareDatasetFiles);
  if (datasetFiles.length === 0) {
    throw new Error('unsupported_file_type');
  }

  const manifestMatches = await getManifestMatches(files, datasetFiles);
  if (manifestMatches.length === 1) {
    return manifestMatches[0]!;
  }

  return datasetFiles[0]!;
}

function parseDelimited(text: string, delimiter: ',' | '\t'): Array<Record<string, unknown>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);

  const [headers, ...bodyRows] = rows;
  if (!headers || headers.length === 0) return [];

  const normalizedHeaders = headers.map((header, index) => header.trim() || `field_${index + 1}`);
  return bodyRows.map((bodyRow) =>
    Object.fromEntries(normalizedHeaders.map((header, index) => [header, parseDelimitedCell(bodyRow[index] ?? '')])),
  );
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

function isImageReferenceArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && isImageReferenceString(item));
}

function isImageReferenceString(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\//iu.test(trimmed) || /^data:image\//iu.test(trimmed);
}

function parseJsonlLine(line: string, samples: Array<Record<string, unknown>>) {
  const trimmed = line.trim();
  if (!trimmed) return;

  samples.push(JSON.parse(trimmed) as Record<string, unknown>);
}

function parseJsonl(text: string): Array<Record<string, unknown>> {
  const samples: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/u)) {
    parseJsonlLine(line, samples);
  }
  return samples;
}

async function parseJsonlFile(file: File): Promise<Array<Record<string, unknown>>> {
  if (typeof file.stream !== 'function') {
    return parseJsonl(await file.text());
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  const samples: Array<Record<string, unknown>> = [];
  let pendingText = '';

  const consumeCompleteLines = () => {
    const lines = pendingText.split(/\r?\n/u);
    pendingText = lines.pop() ?? '';
    for (const line of lines) {
      parseJsonlLine(line, samples);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      pendingText += decoder.decode(value, { stream: true });
      consumeCompleteLines();
    }

    pendingText += decoder.decode();
    parseJsonlLine(pendingText, samples);
    return samples;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function parseJsonArray(text: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('json_array_required');
  }
  return parsed as Array<Record<string, unknown>>;
}

function parseSamplesByExtension(extension: string, text: string): Array<Record<string, unknown>> {
  if (extension === '.csv') return parseDelimited(text, ',');
  if (extension === '.tsv') return parseDelimited(text, '\t');
  if (extension === '.jsonl') return parseJsonl(text);
  if (extension === '.json') return parseJsonArray(text);
  throw new Error('unsupported_file_type');
}

function readUint16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView) {
  const minOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error('zip_invalid');

  const entryCount = readUint16(view, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) throw new Error('zip_invalid');

    const compressionMethod = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const fileNameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);
    const nameBytes = new Uint8Array(buffer, offset + 46, fileNameLength);
    const path = normalizePath(decoder.decode(nameBytes));

    if (path && !path.endsWith('/')) {
      if (readUint32(view, localHeaderOffset) !== 0x04034b50) throw new Error('zip_invalid');
      const localNameLength = readUint16(view, localHeaderOffset + 26);
      const localExtraLength = readUint16(view, localHeaderOffset + 28);
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

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('zip_deflate_unsupported');
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntryBytes(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const compressed = new Uint8Array(buffer, entry.dataStart, entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRaw(compressed);
  throw new Error('zip_compression_unsupported');
}

function extensionToImageMimeType(path: string) {
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function chooseZipDataEntry(buffer: ArrayBuffer, entries: ZipEntry[]): Promise<ZipEntry> {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntries = entries
    .filter((entry) => entry.name.toLowerCase() === 'manifest.json')
    .sort((a, b) => compareDatasetPaths(a.path, b.path));

  for (const manifestEntry of manifestEntries) {
    try {
      const manifestText = new TextDecoder('utf-8').decode(await readZipEntryBytes(buffer, manifestEntry));
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

function resolveZipImagePath(value: string, dataDirectory: string, imageEntries: Map<string, ZipEntry>) {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//iu.test(trimmed) || /^data:image\//iu.test(trimmed)) return null;

  const candidates = [joinPath(dataDirectory, trimmed), normalizePath(trimmed.replace(/^\/+/u, ''))];

  return candidates.find((candidate) => imageEntries.has(candidate)) ?? null;
}

async function inlineZipImages(
  samples: Array<Record<string, unknown>>,
  dataEntry: ZipEntry,
  buffer: ArrayBuffer,
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
    const dataUrl = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
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

async function parseZipDatasetFile(file: File): Promise<Array<Record<string, unknown>>> {
  const buffer = await file.arrayBuffer();
  const entries = readZipEntries(buffer);
  const dataEntry = await chooseZipDataEntry(buffer, entries);
  const dataText = new TextDecoder('utf-8').decode(await readZipEntryBytes(buffer, dataEntry));
  const samples = parseSamplesByExtension(getExtension(dataEntry.name), dataText);
  return inlineZipImages(samples, dataEntry, buffer, entries);
}

// Streams a JSONL file row-by-row, yielding fixed-size batches, so large files never fully enter memory.
// Used by the large-file import runner (see dataset-import-runner.ts).
export async function* streamJsonlBatches(
  file: File,
  batchSize: number,
  onBytes?: (readBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): AsyncGenerator<Array<Record<string, unknown>>> {
  const total = file.size;
  let readBytes = 0;
  let batch: Array<Record<string, unknown>> = [];

  const pushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      batch.push(parsed as Record<string, unknown>);
    }
  };

  if (typeof file.stream !== 'function') {
    for (const line of (await file.text()).split(/\r?\n/u)) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      pushLine(line);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
    return;
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  let pending = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      readBytes += value.byteLength;
      onBytes?.(readBytes, total);
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        pushLine(line);
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }
    }
    pending += decoder.decode();
    pushLine(pending);
    if (batch.length > 0) yield batch;
  } finally {
    reader.releaseLock();
  }
}

export function isJsonlFile(file: File): boolean {
  return getExtension(file.name) === '.jsonl';
}

// Reads only the head of a (large) JSONL file to produce columns + a few preview rows, without loading the whole file.
// The trailing partial line is dropped when the file exceeds the slice.
export async function parseJsonlPrefix(file: File, maxBytes = PREVIEW_BYTES): Promise<ParsedDatasetFile> {
  const text = await file.slice(0, maxBytes).text();
  const lines = text.split(/\r?\n/u);
  if (file.size > maxBytes && lines.length > 1) lines.pop();

  const samples: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        samples.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Skip unparseable (possibly truncated) lines in the preview prefix.
    }
  }

  if (samples.length === 0) {
    throw new Error('empty_file');
  }
  return { columns: Object.keys(samples[0] ?? {}), samples };
}

export async function parseDatasetFile(file: File): Promise<ParsedDatasetFile> {
  const extension = getExtension(file.name);
  if (!FORMAT_CHIPS.includes(extension as DatasetFileExtension)) {
    throw new Error('unsupported_file_type');
  }

  const samples =
    extension === '.zip'
      ? await parseZipDatasetFile(file)
      : extension === '.jsonl'
        ? await parseJsonlFile(file)
        : parseSamplesByExtension(extension, await file.text());

  const normalizedSamples = samples.filter((sample) => sample && typeof sample === 'object' && !Array.isArray(sample));
  if (normalizedSamples.length === 0) {
    throw new Error('empty_file');
  }

  return {
    columns: Object.keys(normalizedSamples[0] ?? {}),
    samples: normalizedSamples,
  };
}
