import { datasetImportClient, type DatasetImportClient, type DatasetTransferProgress } from '@proofhound/api-client';
import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  CreateRawDatasetImportDto,
  DatasetImportProgressPhase,
  DatasetImportStatusDto,
} from '@proofhound/shared';
import { projectSamplesToColumns } from './dataset-upload-parser';

export interface DatasetImportProgress {
  phase: DatasetImportProgressPhase | 'completing';
  receivedRows: number;
  status?: DatasetImportStatusDto;
}

export const DEFAULT_IMPORT_BATCH_MAX_ROWS = 1000;
// Keep the encoded JSON body below the default SERVER_BODY_LIMIT=10mb.
export const DEFAULT_IMPORT_BATCH_MAX_BYTES = 8 * 1024 * 1024;

const textEncoder = new TextEncoder();
const DATASET_IMPORT_PAYLOAD_PREFIX_BYTES = textEncoder.encode('{"batchStartIndex":0,"samples":').length;
const DATASET_IMPORT_PAYLOAD_SUFFIX_BYTES = 1; // }

export function estimateDatasetImportBatchBytes(samples: Array<Record<string, unknown>>): number {
  return textEncoder.encode(JSON.stringify({ batchStartIndex: 0, samples })).length;
}

function estimateDatasetImportSampleBytes(sample: Record<string, unknown>): number {
  return textEncoder.encode(JSON.stringify(sample)).length;
}

function emptyJsonArrayBytes(): number {
  return 2; // []
}

function jsonArrayBytesAfterAppend(currentArrayBytes: number, currentLength: number, nextItemBytes: number): number {
  return currentLength === 0 ? nextItemBytes + 2 : currentArrayBytes + 1 + nextItemBytes;
}

function estimateDatasetImportPayloadBytes(samplesArrayBytes: number): number {
  return DATASET_IMPORT_PAYLOAD_PREFIX_BYTES + samplesArrayBytes + DATASET_IMPORT_PAYLOAD_SUFFIX_BYTES;
}

export async function* projectSampleRowsToBatches(
  rows: AsyncIterable<Record<string, unknown>>,
  columns: string[],
  options: {
    maxRows?: number;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<Array<Record<string, unknown>>> {
  const maxRows = options.maxRows ?? DEFAULT_IMPORT_BATCH_MAX_ROWS;
  const maxBytes = options.maxBytes ?? DEFAULT_IMPORT_BATCH_MAX_BYTES;
  let batch: Array<Record<string, unknown>> = [];
  let batchArrayBytes = emptyJsonArrayBytes();

  for await (const row of rows) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (batch.length >= maxRows) {
      yield batch;
      batch = [];
      batchArrayBytes = emptyJsonArrayBytes();
    }

    const projected = projectSamplesToColumns([row], columns)[0] ?? {};
    const singleBytes = estimateDatasetImportSampleBytes(projected);
    const singlePayloadBytes = estimateDatasetImportPayloadBytes(
      jsonArrayBytesAfterAppend(emptyJsonArrayBytes(), 0, singleBytes),
    );
    if (singlePayloadBytes > maxBytes) {
      throw new Error('dataset_import_sample_too_large');
    }

    const candidateArrayBytes = jsonArrayBytesAfterAppend(batchArrayBytes, batch.length, singleBytes);
    if (batch.length > 0 && estimateDatasetImportPayloadBytes(candidateArrayBytes) > maxBytes) {
      yield batch;
      batch = [];
      batchArrayBytes = emptyJsonArrayBytes();
    }

    batch.push(projected);
    batchArrayBytes = jsonArrayBytesAfterAppend(batchArrayBytes, batch.length - 1, singleBytes);
  }

  if (batch.length > 0) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    yield batch;
  }
}

export interface RunDatasetImportOptions {
  projectId: string;
  createBody: CreateDatasetImportDto;
  // Async source of sample batches (e.g. JSONL/CSV/TSV streaming parser output). Batches are appended in order.
  batches: AsyncIterable<Array<Record<string, unknown>>>;
  signal?: AbortSignal;
  onCreated?: (importId: string) => void;
  onProgress?: (progress: DatasetImportProgress) => void;
  pollIntervalMs?: number;
  // Injectable for tests; defaults to the real HTTP client.
  client?: DatasetImportClient;
}

export interface RunRawDatasetImportOptions {
  projectId: string;
  createBody: CreateRawDatasetImportDto;
  file: Blob;
  signal?: AbortSignal;
  onCreated?: (importId: string) => void;
  onUploaded?: () => void;
  onUploadProgress?: (progress: DatasetTransferProgress) => void;
  onProgress?: (progress: DatasetImportProgress) => void;
  pollIntervalMs?: number;
  client?: DatasetImportClient;
}

// Orchestrates a large-file import: create session -> append batches in order -> complete (atomic promote).
// Any failure or abort before complete deletes the session + staging (best-effort), per "中断即删干净".
export async function runDatasetImport(options: RunDatasetImportOptions): Promise<CompleteDatasetImportResponseDto> {
  const client = options.client ?? datasetImportClient;
  const { projectId, createBody, batches, signal } = options;

  const session = await client.createDatasetImport(projectId, createBody);
  options.onCreated?.(session.id);

  try {
    let batchStartIndex = 0;
    for await (const batch of batches) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (batch.length === 0) continue;
      const { receivedRows } = await client.appendDatasetImportBatch(projectId, session.id, {
        batchStartIndex,
        samples: batch,
      });
      batchStartIndex += batch.length;
      options.onProgress?.({ phase: 'uploading', receivedRows });
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    options.onProgress?.({ phase: 'completing', receivedRows: batchStartIndex });
    const pollController = new AbortController();
    const abortPoll = () => pollController.abort();
    signal?.addEventListener('abort', abortPoll, { once: true });
    const progressPoll = pollDatasetImportStatus({
      client,
      projectId,
      importId: session.id,
      pollIntervalMs: options.pollIntervalMs,
      onProgress: options.onProgress,
      signal: pollController.signal,
    }).catch(() => undefined);
    try {
      const result = await client.completeDatasetImport(projectId, session.id);
      return result;
    } finally {
      signal?.removeEventListener('abort', abortPoll);
      pollController.abort();
      await progressPoll;
    }
  } catch (error) {
    await client.abortDatasetImport(projectId, session.id).catch(() => undefined);
    throw error;
  }
}

export async function runRawDatasetImport(options: RunRawDatasetImportOptions): Promise<DatasetImportStatusDto> {
  const client = options.client ?? datasetImportClient;
  const { projectId, createBody, file, signal } = options;

  const { import: session, uploadSession } = await client.createRawDatasetImport(projectId, createBody);
  options.onCreated?.(session.id);
  try {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    await client.uploadRawDatasetFile(uploadSession, file, { signal, onProgress: options.onUploadProgress });
    options.onUploaded?.();
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    await client.completeRawDatasetUpload(projectId, session.id);
    const queued = await client.completeDatasetImport(projectId, session.id);
    options.onProgress?.({ phase: 'queued', receivedRows: queued.receivedRows, status: queued });
    return await pollDatasetImportStatus({
      client,
      projectId,
      importId: session.id,
      pollIntervalMs: options.pollIntervalMs,
      onProgress: options.onProgress,
      signal,
    });
  } catch (error) {
    await client.abortDatasetImport(projectId, session.id).catch(() => undefined);
    throw error;
  }
}

async function pollDatasetImportStatus({
  client,
  projectId,
  importId,
  pollIntervalMs = 1500,
  onProgress,
  signal,
}: {
  client: DatasetImportClient;
  projectId: string;
  importId: string;
  pollIntervalMs?: number;
  onProgress?: (progress: DatasetImportProgress) => void;
  signal?: AbortSignal;
}): Promise<DatasetImportStatusDto> {
  for (;;) {
    await delay(pollIntervalMs, signal);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const status = await client.getDatasetImport(projectId, importId);
    const phase = status.progress.phase ?? status.state;
    if (status.state === 'completed') {
      onProgress?.({ phase: 'completed', receivedRows: status.receivedRows, status });
      return status;
    }
    if (status.state === 'failed' || status.state === 'aborted') {
      throw new Error(status.errorCode ?? status.state);
    }
    onProgress?.({ phase, receivedRows: status.receivedRows, status });
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
