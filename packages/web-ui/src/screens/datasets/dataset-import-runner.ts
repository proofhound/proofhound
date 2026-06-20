import { datasetImportClient, type DatasetImportClient } from '@proofhound/api-client';
import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  CreateRawDatasetImportDto,
} from '@proofhound/shared';
import { projectSamplesToColumns } from './dataset-upload-parser';

export interface DatasetImportProgress {
  phase: 'uploading' | 'completing';
  receivedRows: number;
}

export const DEFAULT_IMPORT_BATCH_MAX_ROWS = 1000;
// Keep the encoded JSON body below the default SERVER_BODY_LIMIT=10mb.
export const DEFAULT_IMPORT_BATCH_MAX_BYTES = 8 * 1024 * 1024;

const textEncoder = new TextEncoder();

export function estimateDatasetImportBatchBytes(samples: Array<Record<string, unknown>>): number {
  return textEncoder.encode(JSON.stringify({ batchStartIndex: 0, samples })).length;
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

  for await (const row of rows) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (batch.length >= maxRows) {
      yield batch;
      batch = [];
    }

    const projected = projectSamplesToColumns([row], columns)[0] ?? {};
    const singleBytes = estimateDatasetImportBatchBytes([projected]);
    if (singleBytes > maxBytes) {
      throw new Error('dataset_import_sample_too_large');
    }

    const candidate = [...batch, projected];
    if (batch.length > 0 && (candidate.length > maxRows || estimateDatasetImportBatchBytes(candidate) > maxBytes)) {
      yield batch;
      batch = [];
    }

    batch.push(projected);
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
    return await client.completeDatasetImport(projectId, session.id);
  } catch (error) {
    await client.abortDatasetImport(projectId, session.id).catch(() => undefined);
    throw error;
  }
}

export async function runRawDatasetImport(
  options: RunRawDatasetImportOptions,
): Promise<CompleteDatasetImportResponseDto> {
  const client = options.client ?? datasetImportClient;
  const { projectId, createBody, file, signal } = options;

  const { import: session, uploadSession } = await client.createRawDatasetImport(projectId, createBody);
  options.onCreated?.(session.id);

  try {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    await client.uploadRawDatasetFile(uploadSession, file, { signal });
    options.onUploaded?.();
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return await client.completeDatasetImport(projectId, session.id);
  } catch (error) {
    await client.abortDatasetImport(projectId, session.id).catch(() => undefined);
    throw error;
  }
}
