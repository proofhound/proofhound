import type { DatasetFieldRole, DatasetImportSourceFormat } from '@proofhound/shared';
import Papa from 'papaparse';

export const FORMAT_CHIPS = ['.csv', '.tsv', '.jsonl', '.zip'] as const;
export const PREVIEW_LIMIT = 100;
export const DATASET_PREVIEW_PAGE_SIZE = 10;

type DatasetFileExtension = (typeof FORMAT_CHIPS)[number];
type UploadFile = File & { proofhoundRelativePath?: string };

export interface ParsedDatasetFile {
  columns: string[];
  samples: Array<Record<string, unknown>>;
}

export interface DatasetPreviewPage<T> {
  rows: T[];
  totalRows: number;
  pageIndex: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
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

const DATASET_IMPORT_DEBUG_PREFIX = '[dataset-import-debug]';
const DATASET_IMPORT_DEBUG_BYTE_INTERVAL = 64 * 1024 * 1024;
const DATASET_IMPORT_DEBUG_ROW_INTERVAL = 100_000;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function debugDatasetImport(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.warn(DATASET_IMPORT_DEBUG_PREFIX, event, {
      at: new Date().toISOString(),
      ...data,
    });
  } catch {
    // Temporary diagnostics must never affect parsing behavior.
  }
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

export function getExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

export function isStreamingImportFile(file: File): boolean {
  const extension = getExtension(file.name);
  return extension === '.jsonl' || extension === '.csv' || extension === '.tsv';
}

export function getDatasetImportSourceFormat(fileName: string): DatasetImportSourceFormat {
  const extension = getExtension(fileName);
  if (extension === '.csv') return 'csv';
  if (extension === '.tsv') return 'tsv';
  if (extension === '.jsonl') return 'jsonl';
  if (extension === '.zip') return 'zip';
  throw new Error('unsupported_file_type');
}

export function getDatasetPreviewPage<T>(
  rows: T[],
  requestedPageIndex: number,
  pageSize = DATASET_PREVIEW_PAGE_SIZE,
): DatasetPreviewPage<T> {
  const normalizedPageSize = Math.max(1, Math.trunc(Number.isFinite(pageSize) ? pageSize : DATASET_PREVIEW_PAGE_SIZE));
  const totalRows = rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / normalizedPageSize));
  const requested = Number.isFinite(requestedPageIndex) ? Math.trunc(requestedPageIndex) : 0;
  const pageIndex = Math.min(Math.max(0, requested), pageCount - 1);
  const rangeStart = totalRows === 0 ? 0 : pageIndex * normalizedPageSize + 1;
  const rangeEnd = totalRows === 0 ? 0 : Math.min(totalRows, rangeStart + normalizedPageSize - 1);

  return {
    rows: rows.slice(rangeStart === 0 ? 0 : rangeStart - 1, rangeEnd),
    totalRows,
    pageIndex,
    pageCount,
    rangeStart,
    rangeEnd,
    canGoPrevious: pageIndex > 0,
    canGoNext: pageIndex < pageCount - 1,
  };
}

function isDatasetFile(file: File) {
  const extension = getExtension(file.name);
  return FORMAT_CHIPS.includes(extension as DatasetFileExtension) && file.name.toLowerCase() !== 'manifest.json';
}

function isStructuredDatasetExtension(extension: string) {
  return extension === '.csv' || extension === '.tsv' || extension === '.jsonl';
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

function parseDelimited(text: string, delimiter: ',' | '\t', maxRows?: number): Array<Record<string, unknown>> {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    delimiter,
    header: true,
    ...(maxRows === undefined ? {} : { preview: maxRows }),
    skipEmptyLines: 'greedy',
    transform: parseDelimitedCell,
    transformHeader: (header, index) => header.trim() || `field_${index + 1}`,
  });
  const fatalError = parsed.errors.find((error) => error.type !== 'FieldMismatch');
  if (fatalError) throw new Error(fatalError.message || 'delimited_parse_failed');

  return parsed.data.filter((sample) => sample && typeof sample === 'object' && !Array.isArray(sample));
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

function parseJsonl(text: string, maxRows?: number): Array<Record<string, unknown>> {
  const samples: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/u)) {
    parseJsonlLine(line, samples);
    if (maxRows !== undefined && samples.length >= maxRows) break;
  }
  return samples;
}

async function parseJsonlFile(file: File, maxRows?: number): Promise<Array<Record<string, unknown>>> {
  if (typeof file.stream !== 'function') {
    return parseJsonl(await file.text(), maxRows);
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
      if (maxRows !== undefined && samples.length >= maxRows) return true;
    }
    return false;
  };

  try {
    for (;;) {
      if (maxRows !== undefined && samples.length >= maxRows) break;
      const { done, value } = await reader.read();
      if (done) break;

      pendingText += decoder.decode(value, { stream: true });
      if (consumeCompleteLines()) break;
    }

    if (maxRows === undefined || samples.length < maxRows) {
      pendingText += decoder.decode();
      parseJsonlLine(pendingText, samples);
    }
    return samples;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function parseSamplesByExtension(extension: string, text: string, maxRows?: number): Array<Record<string, unknown>> {
  if (extension === '.csv') return parseDelimited(text, ',', maxRows);
  if (extension === '.tsv') return parseDelimited(text, '\t', maxRows);
  if (extension === '.jsonl') return parseJsonl(text, maxRows);
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

async function parseZipDatasetFile(file: File, maxRows?: number): Promise<Array<Record<string, unknown>>> {
  const buffer = await file.arrayBuffer();
  const entries = readZipEntries(buffer);
  const dataEntry = await chooseZipDataEntry(buffer, entries);
  const dataText = new TextDecoder('utf-8').decode(await readZipEntryBytes(buffer, dataEntry));
  const samples = parseSamplesByExtension(getExtension(dataEntry.name), dataText, maxRows);
  return inlineZipImages(samples, dataEntry, buffer, entries);
}

// Streams a JSONL file row-by-row, so large files never fully enter memory.
export async function* streamJsonlRows(
  file: File,
  onBytes?: (readBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const total = file.size;
  let readBytes = 0;
  let lastLoggedBytes = 0;
  let rowCount = 0;
  const startedAt = nowMs();
  debugDatasetImport('webUi.datasetParser.jsonl.start', { fileName: file.name, fileSizeBytes: file.size });

  const parseLine = (line: string): Record<string, unknown> | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  };

  if (typeof file.stream !== 'function') {
    for (const line of (await file.text()).split(/\r?\n/u)) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const row = parseLine(line);
      if (row) {
        rowCount += 1;
        yield row;
      }
    }
    debugDatasetImport('webUi.datasetParser.jsonl.done', {
      elapsedMs: Math.round(nowMs() - startedAt),
      fileName: file.name,
      rowCount,
    });
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
      if (readBytes - lastLoggedBytes >= DATASET_IMPORT_DEBUG_BYTE_INTERVAL) {
        lastLoggedBytes = readBytes;
        debugDatasetImport('webUi.datasetParser.jsonl.progress', {
          elapsedMs: Math.round(nowMs() - startedAt),
          fileName: file.name,
          readBytes,
          rowCount,
          totalBytes: total,
        });
      }
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const row = parseLine(line);
        if (row) {
          rowCount += 1;
          yield row;
        }
      }
    }
    pending += decoder.decode();
    const row = parseLine(pending);
    if (row) {
      rowCount += 1;
      yield row;
    }
    debugDatasetImport('webUi.datasetParser.jsonl.done', {
      elapsedMs: Math.round(nowMs() - startedAt),
      fileName: file.name,
      readBytes,
      rowCount,
      totalBytes: total,
    });
  } finally {
    reader.releaseLock();
  }
}

const STREAM_QUEUE_PAUSE_AT = 1000;
const STREAM_QUEUE_RESUME_AT = 250;

export async function* streamDelimitedRows(
  file: File,
  delimiter: ',' | '\t',
  onBytes?: (readBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const queue: Array<Record<string, unknown>> = [];
  const parserRef: { current: Papa.Parser | null } = { current: null };
  let parserPaused = false;
  let done = false;
  let error: Error | null = null;
  let notify: (() => void) | null = null;
  let lastLoggedCursor = 0;
  let rowCount = 0;
  let yieldedRows = 0;
  const startedAt = nowMs();
  debugDatasetImport('webUi.datasetParser.delimited.start', {
    delimiter,
    fileName: file.name,
    fileSizeBytes: file.size,
  });

  const wake = () => {
    notify?.();
    notify = null;
  };
  const waitForRows = () =>
    new Promise<void>((resolve) => {
      notify = resolve;
    });
  const abortIfNeeded = () => {
    if (!signal?.aborted) return false;
    parserRef.current?.abort();
    error = new DOMException('aborted', 'AbortError');
    done = true;
    wake();
    return true;
  };

  const abortListener = () => {
    abortIfNeeded();
  };
  signal?.addEventListener('abort', abortListener, { once: true });

  Papa.parse<Record<string, unknown>>(file, {
    delimiter,
    header: true,
    skipEmptyLines: 'greedy',
    transform: parseDelimitedCell,
    transformHeader: (header, index) => header.trim() || `field_${index + 1}`,
    step: (result, parser) => {
      parserRef.current = parser;
      if (abortIfNeeded()) return;
      const fatalError = result.errors.find((item) => item.type !== 'FieldMismatch');
      if (fatalError) {
        error = new Error(fatalError.message || 'delimited_parse_failed');
        parser.abort();
        done = true;
        wake();
        return;
      }
      const row = result.data;
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        queue.push(row);
        rowCount += 1;
      }
      const cursor = typeof result.meta.cursor === 'number' ? result.meta.cursor : 0;
      onBytes?.(Math.min(file.size, cursor), file.size);
      if (
        rowCount === 1 ||
        cursor - lastLoggedCursor >= DATASET_IMPORT_DEBUG_BYTE_INTERVAL ||
        rowCount % DATASET_IMPORT_DEBUG_ROW_INTERVAL === 0
      ) {
        lastLoggedCursor = cursor;
        debugDatasetImport('webUi.datasetParser.delimited.progress', {
          cursor: Math.min(file.size, cursor),
          elapsedMs: Math.round(nowMs() - startedAt),
          fileName: file.name,
          queueLength: queue.length,
          rowCount,
          totalBytes: file.size,
        });
      }
      if (!parserPaused && queue.length >= STREAM_QUEUE_PAUSE_AT) {
        parser.pause();
        parserPaused = true;
        debugDatasetImport('webUi.datasetParser.delimited.pause', {
          cursor: Math.min(file.size, cursor),
          elapsedMs: Math.round(nowMs() - startedAt),
          fileName: file.name,
          queueLength: queue.length,
          rowCount,
        });
      }
      wake();
    },
    complete: () => {
      done = true;
      debugDatasetImport('webUi.datasetParser.delimited.parse_complete', {
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: file.name,
        rowCount,
      });
      wake();
    },
    error: (err) => {
      error = err instanceof Error ? err : new Error(String(err));
      done = true;
      wake();
    },
  });

  try {
    while (!done || queue.length > 0) {
      if (signal?.aborted) abortIfNeeded();
      if (error) throw error;
      if (queue.length === 0) {
        await waitForRows();
        continue;
      }
      const row = queue.shift();
      if (parserRef.current && parserPaused && queue.length <= STREAM_QUEUE_RESUME_AT) {
        parserRef.current.resume();
        parserPaused = false;
        debugDatasetImport('webUi.datasetParser.delimited.resume', {
          elapsedMs: Math.round(nowMs() - startedAt),
          fileName: file.name,
          queueLength: queue.length,
          rowCount,
          yieldedRows,
        });
      }
      if (row) {
        yieldedRows += 1;
        yield row;
      }
    }
    if (error) throw error;
    debugDatasetImport('webUi.datasetParser.delimited.done', {
      elapsedMs: Math.round(nowMs() - startedAt),
      fileName: file.name,
      rowCount,
      yieldedRows,
    });
  } finally {
    signal?.removeEventListener('abort', abortListener);
    const shouldAbort = !done || queue.length > 0 || signal?.aborted;
    debugDatasetImport('webUi.datasetParser.delimited.cleanup', {
      done,
      elapsedMs: Math.round(nowMs() - startedAt),
      fileName: file.name,
      parserPaused,
      queueLength: queue.length,
      rowCount,
      shouldAbort,
      signalAborted: Boolean(signal?.aborted),
      yieldedRows,
    });
    if (shouldAbort) {
      parserRef.current?.abort();
      debugDatasetImport('webUi.datasetParser.delimited.cleanup_abort_called', {
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: file.name,
        queueLength: queue.length,
        rowCount,
        yieldedRows,
      });
    }
  }
}

export function streamDatasetRows(
  file: File,
  onBytes?: (readBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const extension = getExtension(file.name);
  if (extension === '.jsonl') return streamJsonlRows(file, onBytes, signal);
  if (extension === '.csv') return streamDelimitedRows(file, ',', onBytes, signal);
  if (extension === '.tsv') return streamDelimitedRows(file, '\t', onBytes, signal);
  throw new Error('unsupported_file_type');
}

async function parseRowsPreview(
  rows: AsyncIterable<Record<string, unknown>>,
  maxRows = PREVIEW_LIMIT,
): Promise<ParsedDatasetFile> {
  const samples: Array<Record<string, unknown>> = [];
  for await (const row of rows) {
    samples.push(row);
    if (samples.length >= maxRows) break;
  }
  if (samples.length === 0) {
    throw new Error('empty_file');
  }
  return { columns: Object.keys(samples[0] ?? {}), samples };
}

export async function parseJsonlPreview(file: File, maxRows = PREVIEW_LIMIT): Promise<ParsedDatasetFile> {
  return parseRowsPreview(streamJsonlRows(file), maxRows);
}

export async function parseDelimitedPreview(
  file: File,
  delimiter: ',' | '\t',
  maxRows = PREVIEW_LIMIT,
): Promise<ParsedDatasetFile> {
  return parseRowsPreview(streamDelimitedRows(file, delimiter), maxRows);
}

export const parseJsonlPrefix = parseJsonlPreview;
export const parseDelimitedPrefix = parseDelimitedPreview;

export async function parseDatasetPreview(file: File, maxRows = PREVIEW_LIMIT): Promise<ParsedDatasetFile> {
  const extension = getExtension(file.name);
  if (!FORMAT_CHIPS.includes(extension as DatasetFileExtension)) {
    throw new Error('unsupported_file_type');
  }
  if (extension === '.zip') {
    const samples = await parseZipDatasetFile(file, maxRows);
    const normalizedSamples = samples.filter(
      (sample) => sample && typeof sample === 'object' && !Array.isArray(sample),
    );
    if (normalizedSamples.length === 0) {
      throw new Error('empty_file');
    }
    return { columns: Object.keys(normalizedSamples[0] ?? {}), samples: normalizedSamples };
  }
  if (extension === '.jsonl') return parseJsonlPreview(file, maxRows);
  if (extension === '.csv') return parseDelimitedPreview(file, ',', maxRows);
  if (extension === '.tsv') return parseDelimitedPreview(file, '\t', maxRows);
  throw new Error('unsupported_file_type');
}

export const parseStreamingPrefix = parseDatasetPreview;

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
