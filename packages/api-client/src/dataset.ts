import type {
  CreateDatasetDto,
  DatasetCreateResponseDto,
  DatasetDeletionImpactDto,
  DatasetExportFormatDto,
  DatasetListItemDto,
  DatasetSamplesListResponseDto,
  DeleteDatasetSamplesDto,
  DeleteDatasetSamplesResponseDto,
  UpdateDatasetMetadataDto,
} from '@proofhound/shared';
import type { AxiosProgressEvent } from 'axios';
import { httpClient } from './http';

export interface DatasetTransferProgress {
  loadedBytes: number;
  totalBytes: number | null;
}

export interface DatasetTransferOptions {
  onProgress?: (progress: DatasetTransferProgress) => void;
}

export interface DatasetDownloadResult {
  blob: Blob;
  fileName: string;
  contentType: string;
}

function toTransferProgress(event: AxiosProgressEvent): DatasetTransferProgress {
  return {
    loadedBytes: event.loaded,
    totalBytes: typeof event.total === 'number' && Number.isFinite(event.total) ? event.total : null,
  };
}

function getFileNameFromDisposition(disposition: string | undefined, fallback: string) {
  if (!disposition) return fallback;

  const utf8Match = /filename\*=UTF-8''([^;]+)/iu.exec(disposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = /filename="?([^";]+)"?/iu.exec(disposition);
  return asciiMatch?.[1] ?? fallback;
}

export const datasetClient = {
  listDatasets: (_projectId: string) =>
    httpClient
      .get<{ data: DatasetListItemDto[]; total: number }>(`/datasets`)
      .then((r) => r.data),
  checkDatasetNameAvailable: (_projectId: string, name: string) =>
    httpClient
      .get<{ available: boolean }>(`/datasets/name-available`, { params: { name } })
      .then((r) => r.data.available),
  getDataset: (_projectId: string, datasetId: string) =>
    httpClient.get<DatasetListItemDto>(`/datasets/${datasetId}`).then((r) => r.data),
  getDatasetDeleteImpact: (_projectId: string, datasetId: string) =>
    httpClient.get<DatasetDeletionImpactDto>(`/datasets/${datasetId}/delete-impact`).then((r) => r.data),
  listDatasetSamples: (
    _projectId: string,
    datasetId: string,
    query?: { page?: number; pageSize?: number; search?: string },
  ) =>
    httpClient
      .get<DatasetSamplesListResponseDto>(`/datasets/${datasetId}/samples`, {
        params: { page: query?.page, pageSize: query?.pageSize, search: query?.search || undefined },
      })
      .then((r) => r.data),
  createDataset: (_projectId: string, body: CreateDatasetDto, options?: DatasetTransferOptions) =>
    httpClient
      .post<DatasetCreateResponseDto>(`/datasets`, body, {
        onUploadProgress: options?.onProgress ? (event) => options.onProgress?.(toTransferProgress(event)) : undefined,
      })
      .then((r) => r.data),
  updateDataset: (_projectId: string, datasetId: string, body: UpdateDatasetMetadataDto) =>
    httpClient
      .patch<DatasetListItemDto>(`/datasets/${datasetId}`, body)
      .then((r) => r.data),
  archiveDataset: (_projectId: string, datasetId: string) =>
    httpClient.patch<DatasetListItemDto>(`/datasets/${datasetId}/archive`).then((r) => r.data),
  restoreDataset: (_projectId: string, datasetId: string) =>
    httpClient.patch<DatasetListItemDto>(`/datasets/${datasetId}/restore`).then((r) => r.data),
  downloadDataset: (
    _projectId: string,
    datasetId: string,
    format: DatasetExportFormatDto,
    options?: DatasetTransferOptions,
  ) =>
    httpClient
      .get<Blob>(`/datasets/${datasetId}/export`, {
        params: { format },
        responseType: 'blob',
        onDownloadProgress: options?.onProgress
          ? (event) => options.onProgress?.(toTransferProgress(event))
          : undefined,
      })
      .then((r): DatasetDownloadResult => {
        const contentTypeHeader = r.headers['content-type'];
        const dispositionHeader = r.headers['content-disposition'];
        const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : 'application/octet-stream';
        return {
          blob: r.data,
          contentType,
          fileName: getFileNameFromDisposition(
            typeof dispositionHeader === 'string' ? dispositionHeader : undefined,
            `dataset-${datasetId}.${format}`,
          ),
        };
      }),
  deleteDataset: (_projectId: string, datasetId: string) =>
    httpClient.delete<void>(`/datasets/${datasetId}`).then(() => undefined),
  deleteDatasetSamples: (_projectId: string, datasetId: string, body: DeleteDatasetSamplesDto) =>
    httpClient
      .delete<DeleteDatasetSamplesResponseDto>(`/datasets/${datasetId}/samples`, { data: body })
      .then((r) => r.data),
};
