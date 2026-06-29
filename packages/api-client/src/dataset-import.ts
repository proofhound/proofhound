import type { DatasetImportStatusDto, DatasetUploadMetadataDto } from '@proofhound/shared';
import type { DatasetTransferProgress } from './dataset';
import { httpClient } from './http';

export interface DatasetUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DatasetTransferProgress) => void;
}

// OSS dataset upload (SPEC 22 §3.1.1): a single multipart request to `POST /datasets/upload`. The
// browser sends the original file + metadata; the server parses, stages, and promotes synchronously
// and returns the completed import status. There is no client-side batching, raw object upload, or
// import-status polling — those are override-only capabilities behind the DatasetUploadService adapter.
export const datasetImportClient = {
  uploadDataset: (
    _projectId: string,
    file: Blob,
    metadata: DatasetUploadMetadataDto,
    options?: DatasetUploadOptions,
  ): Promise<DatasetImportStatusDto> => {
    const form = new FormData();
    form.append('file', file, metadata.fileName ?? 'dataset');
    form.append('name', metadata.name);
    if (metadata.description != null) form.append('description', metadata.description);
    form.append('sourceFormat', metadata.sourceFormat);
    form.append('fieldMappings', JSON.stringify(metadata.fieldMappings));
    if (metadata.declaredTotalRows != null) {
      form.append('declaredTotalRows', String(metadata.declaredTotalRows));
    }

    const fileSize = file instanceof File ? file.size : (file as Blob).size;
    return httpClient
      .post<DatasetImportStatusDto>('/datasets/upload', form, {
        // The shared httpClient defaults to application/json; without overriding it, axios serializes
        // the FormData to JSON (dropping the file). Forcing multipart lets the browser set the boundary.
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: options?.signal,
        onUploadProgress: (event) => {
          options?.onProgress?.({
            loadedBytes: event.loaded,
            totalBytes: event.total ?? fileSize ?? null,
          });
        },
      })
      .then((r) => r.data);
  },
};

export type DatasetImportClient = typeof datasetImportClient;
