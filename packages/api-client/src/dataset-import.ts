import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  CreateRawDatasetImportDto,
  CreateRawDatasetImportResponseDto,
  DatasetImportBatchDto,
  DatasetImportBatchResponseDto,
  DatasetImportItemDto,
  DatasetRawImportCapabilitiesDto,
  DatasetRawUploadSessionDto,
} from '@proofhound/shared';
import { httpClient } from './http';
import { getServerBaseUrl } from './public-env';

export const datasetImportClient = {
  getDatasetImport: (projectId: string, importId: string) =>
    httpClient.get<DatasetImportItemDto>(`/dataset-imports/${importId}`).then((r) => r.data),
  getRawImportCapabilities: (_projectId: string) =>
    httpClient.get<DatasetRawImportCapabilitiesDto>(`/dataset-imports/raw/capabilities`).then((r) => r.data),
  createDatasetImport: (projectId: string, body: CreateDatasetImportDto) =>
    httpClient.post<DatasetImportItemDto>(`/dataset-imports`, body).then((r) => r.data),
  createRawDatasetImport: (projectId: string, body: CreateRawDatasetImportDto) =>
    httpClient.post<CreateRawDatasetImportResponseDto>(`/dataset-imports/raw`, body).then((r) => r.data),
  uploadRawDatasetFile: async (
    uploadSession: DatasetRawUploadSessionDto,
    file: Blob,
    options?: { signal?: AbortSignal },
  ) => {
    const response = await fetch(uploadSession.url, {
      method: 'PUT',
      headers: uploadSession.headers,
      body: file,
      signal: options?.signal,
    });
    if (!response.ok) {
      throw new Error(`dataset_raw_upload_failed:${response.status}`);
    }
  },
  appendDatasetImportBatch: (projectId: string, importId: string, body: DatasetImportBatchDto) =>
    httpClient.post<DatasetImportBatchResponseDto>(`/dataset-imports/${importId}/batch`, body).then((r) => r.data),
  completeDatasetImport: (projectId: string, importId: string) =>
    httpClient.post<CompleteDatasetImportResponseDto>(`/dataset-imports/${importId}/complete`, {}).then((r) => r.data),
  abortDatasetImport: (projectId: string, importId: string) =>
    httpClient.post<void>(`/dataset-imports/${importId}/abort`, {}).then(() => undefined),
  // Fire-and-forget abort that survives page unload (tab close / refresh), where a normal fetch is
  // cancelled by the browser. Auth rides the same trusted-header / LOCAL_ACTOR path as other UI calls
  // (no JS-set Authorization header), so carrying no header is fine. Returns false when unsupported.
  abortDatasetImportBeacon: (projectId: string, importId: string): boolean => {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    return navigator.sendBeacon(`${getServerBaseUrl()}/dataset-imports/${importId}/abort`);
  },
};

export type DatasetImportClient = typeof datasetImportClient;
