import { datasetImportClient, type DatasetImportClient } from '@proofhound/api-client';
import type { CompleteDatasetImportResponseDto, CreateDatasetImportDto } from '@proofhound/shared';

export interface DatasetImportProgress {
  phase: 'uploading' | 'completing';
  receivedRows: number;
}

export interface RunDatasetImportOptions {
  projectId: string;
  createBody: CreateDatasetImportDto;
  // Async source of sample batches (e.g. streamJsonlBatches). Batches are appended in order.
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
