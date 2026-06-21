import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  DatasetImportBatchDto,
  DatasetImportBatchResponseDto,
  DatasetImportItemDto,
  DatasetImportStatusDto,
} from '@proofhound/shared';
import { httpClient } from './http';
import { getServerBaseUrl } from './public-env';

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
    // Temporary diagnostics must never affect API behavior.
  }
}

async function withDatasetImportDebug<T>(
  event: string,
  data: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = nowMs();
  debugDatasetImport(`${event}.start`, data);
  try {
    const result = await run();
    debugDatasetImport(`${event}.done`, {
      ...data,
      totalMs: Math.round(nowMs() - startedAt),
    });
    return result;
  } catch (error) {
    debugDatasetImport(`${event}.failed`, {
      ...data,
      error: error instanceof Error ? error.message : String(error),
      totalMs: Math.round(nowMs() - startedAt),
    });
    throw error;
  }
}

export const datasetImportClient = {
  getDatasetImport: (projectId: string, importId: string) =>
    withDatasetImportDebug('apiClient.datasetImport.get', { importId, projectId }, () =>
      httpClient.get<DatasetImportStatusDto>(`/dataset-imports/${importId}`).then((r) => r.data),
    ),
  createDatasetImport: (projectId: string, body: CreateDatasetImportDto) =>
    withDatasetImportDebug(
      'apiClient.datasetImport.create',
      {
        fileName: body.sourceFile.fileName,
        fileSizeBytes: body.sourceFile.fileSizeBytes,
        projectId,
        sourceFormat: body.sourceFormat,
      },
      () => httpClient.post<DatasetImportItemDto>(`/dataset-imports`, body).then((r) => r.data),
    ),
  appendDatasetImportBatch: (projectId: string, importId: string, body: DatasetImportBatchDto) =>
    withDatasetImportDebug(
      'apiClient.datasetImport.appendBatch',
      {
        batchStartIndex: body.batchStartIndex,
        importId,
        projectId,
        sampleCount: body.samples.length,
      },
      () =>
        httpClient.post<DatasetImportBatchResponseDto>(`/dataset-imports/${importId}/batch`, body).then((r) => r.data),
    ),
  completeDatasetImport: (projectId: string, importId: string) =>
    withDatasetImportDebug('apiClient.datasetImport.complete', { importId, projectId }, () =>
      httpClient
        .post<CompleteDatasetImportResponseDto>(`/dataset-imports/${importId}/complete`, {})
        .then((r) => r.data),
    ),
  abortDatasetImport: (projectId: string, importId: string) =>
    withDatasetImportDebug('apiClient.datasetImport.abort', { importId, projectId }, () =>
      httpClient.post<void>(`/dataset-imports/${importId}/abort`, {}).then(() => undefined),
    ),
  // Fire-and-forget abort that survives page unload (tab close / refresh), where a normal fetch is
  // cancelled by the browser. Auth rides the same trusted-header / LOCAL_ACTOR path as other UI calls
  // (no JS-set Authorization header), so carrying no header is fine. Returns false when unsupported.
  abortDatasetImportBeacon: (projectId: string, importId: string): boolean => {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    const sent = navigator.sendBeacon(`${getServerBaseUrl()}/dataset-imports/${importId}/abort`);
    debugDatasetImport('apiClient.datasetImport.abortBeacon.done', { importId, projectId, sent });
    return sent;
  },
};

export type DatasetImportClient = typeof datasetImportClient;
