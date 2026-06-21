import { datasetImportClient, type DatasetImportClient } from '@proofhound/api-client';
import type { CompleteDatasetImportResponseDto, CreateDatasetImportDto } from '@proofhound/shared';
import { projectSamplesToColumns } from './dataset-upload-parser';

const DATASET_IMPORT_DEBUG_PREFIX = '[dataset-import-debug]';

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
    // Temporary diagnostics must never affect import behavior.
  }
}

export interface DatasetImportProgress {
  phase: 'uploading' | 'completing' | 'completed';
  receivedRows: number;
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
  let batchIndex = 0;
  let batchStartIndex = 0;
  let processedRows = 0;
  const startedAt = nowMs();

  const logBatch = (reason: string, currentBatch: Array<Record<string, unknown>>, currentArrayBytes: number) => {
    debugDatasetImport('webUi.datasetImport.batch.generated', {
      batchIndex,
      batchStartIndex,
      elapsedMs: Math.round(nowMs() - startedAt),
      payloadBytes: estimateDatasetImportPayloadBytes(currentArrayBytes),
      processedRows,
      reason,
      sampleCount: currentBatch.length,
    });
    batchIndex += 1;
    batchStartIndex += currentBatch.length;
  };

  for await (const row of rows) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (batch.length >= maxRows) {
      logBatch('max_rows', batch, batchArrayBytes);
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
      logBatch('max_bytes', batch, batchArrayBytes);
      yield batch;
      batch = [];
      batchArrayBytes = emptyJsonArrayBytes();
    }

    batch.push(projected);
    batchArrayBytes = jsonArrayBytesAfterAppend(batchArrayBytes, batch.length - 1, singleBytes);
    processedRows += 1;
  }

  if (batch.length > 0) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    logBatch('source_done', batch, batchArrayBytes);
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

// Orchestrates a large-file import: create session -> append batches in order -> complete (atomic promote).
// Any failure or abort before complete deletes the session + staging (best-effort), per "中断即删干净".
export async function runDatasetImport(options: RunDatasetImportOptions): Promise<CompleteDatasetImportResponseDto> {
  const client = options.client ?? datasetImportClient;
  const { projectId, createBody, batches, signal } = options;
  const startedAt = nowMs();
  debugDatasetImport('webUi.datasetImport.run.start', {
    fileName: createBody.sourceFile.fileName,
    fileSizeBytes: createBody.sourceFile.fileSizeBytes,
    projectId,
    sourceFormat: createBody.sourceFormat,
  });

  const session = await client.createDatasetImport(projectId, createBody);
  options.onCreated?.(session.id);
  debugDatasetImport('webUi.datasetImport.create.done', {
    importId: session.id,
    projectId,
    totalMs: Math.round(nowMs() - startedAt),
  });

  try {
    let batchStartIndex = 0;
    let batchIndex = 0;
    for await (const batch of batches) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (batch.length === 0) continue;
      const appendStartedAt = nowMs();
      debugDatasetImport('webUi.datasetImport.append.start', {
        batchIndex,
        batchStartIndex,
        importId: session.id,
        projectId,
        sampleCount: batch.length,
        totalMs: Math.round(appendStartedAt - startedAt),
      });
      const { receivedRows } = await client.appendDatasetImportBatch(projectId, session.id, {
        batchStartIndex,
        samples: batch,
      });
      debugDatasetImport('webUi.datasetImport.append.done', {
        appendMs: Math.round(nowMs() - appendStartedAt),
        batchIndex,
        batchStartIndex,
        importId: session.id,
        projectId,
        receivedRows,
        sampleCount: batch.length,
        totalMs: Math.round(nowMs() - startedAt),
      });
      batchStartIndex += batch.length;
      batchIndex += 1;
      options.onProgress?.({ phase: 'uploading', receivedRows });
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    options.onProgress?.({ phase: 'completing', receivedRows: batchStartIndex });
    debugDatasetImport('webUi.datasetImport.complete.start', {
      importId: session.id,
      projectId,
      receivedRows: batchStartIndex,
      totalMs: Math.round(nowMs() - startedAt),
    });
    const result = await client.completeDatasetImport(projectId, session.id);
    debugDatasetImport('webUi.datasetImport.complete.done', {
      datasetId: result.datasetId,
      importId: session.id,
      projectId,
      receivedRows: result.receivedRows,
      totalMs: Math.round(nowMs() - startedAt),
    });
    options.onProgress?.({ phase: 'completed', receivedRows: result.receivedRows });
    return result;
  } catch (error) {
    debugDatasetImport('webUi.datasetImport.run.failed', {
      error: error instanceof Error ? error.message : String(error),
      importId: session.id,
      projectId,
      totalMs: Math.round(nowMs() - startedAt),
    });
    await client.abortDatasetImport(projectId, session.id).catch(() => undefined);
    throw error;
  }
}
