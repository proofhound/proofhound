import { datasetClient, type DatasetTransferOptions } from '@proofhound/api-client';
import { useDatasetUploadAdapter } from '../providers/dataset-upload-provider';
import type {
  CreateDatasetDto,
  DatasetDeletionImpactDto,
  DatasetExportFormatDto,
  DatasetListItemDto,
  DatasetUploadMetadataDto,
  DeleteDatasetSamplesDto,
  UpdateDatasetMetadataDto,
} from '@proofhound/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface CreateDatasetVariables extends DatasetTransferOptions {
  body: CreateDatasetDto;
}

interface UploadDatasetVariables {
  file: Blob;
  metadata: DatasetUploadMetadataDto;
  signal?: AbortSignal;
  onProgress?: (progress: { loadedBytes: number; totalBytes: number | null }) => void;
}

interface DownloadDatasetVariables extends DatasetTransferOptions {
  datasetId: string;
  format: DatasetExportFormatDto;
}

interface UpdateDatasetVariables {
  datasetId: string;
  body: UpdateDatasetMetadataDto;
}

interface DatasetLifecycleVariables {
  datasetId: string;
}

type DatasetListResponse = { data: DatasetListItemDto[]; total: number };

const datasetsQueryRoot = (projectId: string) => ['datasets', projectId] as const;
const datasetSamplesQueryRoot = (projectId: string, datasetId: string) =>
  ['dataset-samples', projectId, datasetId] as const;

export function getDatasetListQueryKey(projectId: string) {
  return datasetsQueryRoot(projectId);
}

export function getDatasetDetailQueryKey(projectId: string, datasetId: string) {
  return [...datasetsQueryRoot(projectId), datasetId] as const;
}

export function getDatasetDeleteImpactQueryKey(projectId: string, datasetId: string) {
  return [...getDatasetDetailQueryKey(projectId, datasetId), 'delete-impact'] as const;
}

export function getDatasetSamplesQueryKey(projectId: string, datasetId: string, query: DatasetSamplesQuery) {
  return [...datasetSamplesQueryRoot(projectId, datasetId), query.page, query.pageSize, query.search] as const;
}

export async function handleDatasetDeleted(queryClient: QueryClient, projectId: string, datasetId: string) {
  const detailKey = getDatasetDetailQueryKey(projectId, datasetId);
  const samplesKey = datasetSamplesQueryRoot(projectId, datasetId);

  await Promise.all([
    queryClient.cancelQueries({ queryKey: detailKey }),
    queryClient.cancelQueries({ queryKey: samplesKey }),
  ]);

  queryClient.removeQueries({ queryKey: detailKey });
  queryClient.removeQueries({ queryKey: samplesKey });

  return queryClient.invalidateQueries({ queryKey: getDatasetListQueryKey(projectId), exact: true });
}

export function useDatasets(projectId: string) {
  return useQuery({
    queryKey: getDatasetListQueryKey(projectId),
    queryFn: () => datasetClient.listDatasets(projectId),
    enabled: projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useDataset(projectId: string, datasetId: string) {
  return useQuery({
    queryKey: getDatasetDetailQueryKey(projectId, datasetId),
    queryFn: () => datasetClient.getDataset(projectId, datasetId),
    enabled: projectId.length > 0 && datasetId.length > 0,
  });
}

export function useDatasetDeleteImpact(projectId: string, datasetId: string) {
  return useQuery<DatasetDeletionImpactDto>({
    queryKey: getDatasetDeleteImpactQueryKey(projectId, datasetId),
    queryFn: () => datasetClient.getDatasetDeleteImpact(projectId, datasetId),
    enabled: projectId.length > 0 && datasetId.length > 0,
  });
}

export interface DatasetSamplesQuery {
  page: number;
  pageSize: number;
  search: string;
}

export function useDatasetSamples(projectId: string, datasetId: string, query: DatasetSamplesQuery) {
  return useQuery({
    queryKey: getDatasetSamplesQueryKey(projectId, datasetId, query),
    queryFn: () =>
      datasetClient.listDatasetSamples(projectId, datasetId, {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search || undefined,
      }),
    enabled: projectId.length > 0 && datasetId.length > 0,
    // Keep the previous page visible while the next page / search result loads.
    placeholderData: (previousData) => previousData,
  });
}

export function useCreateDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ body, onProgress }: CreateDatasetVariables) =>
      datasetClient.createDataset(projectId, body, { onProgress }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
    },
  });
}

// Single multipart upload (SPEC 22 §3.1.1): the browser POSTs the original file + metadata once and
// the server parses, stages, and promotes synchronously, returning the completed import status.
export function useUploadDataset(projectId: string) {
  const queryClient = useQueryClient();
  const uploadDataset = useDatasetUploadAdapter();

  return useMutation({
    mutationFn: ({ file, metadata, signal, onProgress }: UploadDatasetVariables) =>
      uploadDataset(projectId, file, metadata, { signal, onProgress }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
    },
  });
}

export function useUpdateDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ datasetId, body }: UpdateDatasetVariables) =>
      datasetClient.updateDataset(projectId, datasetId, body),
    onSuccess: (dataset) => {
      queryClient.setQueryData<DatasetListResponse>(['datasets', projectId], (current) =>
        current
          ? {
              ...current,
              data: current.data.map((item) => (item.id === dataset.id ? dataset : item)),
            }
          : current,
      );
      queryClient.setQueryData(['datasets', projectId, dataset.id], dataset);
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId, dataset.id] });
    },
  });
}

export function useDownloadDataset(projectId: string) {
  return useMutation({
    mutationFn: ({ datasetId, format, onProgress }: DownloadDatasetVariables) =>
      datasetClient.downloadDataset(projectId, datasetId, format, { onProgress }),
  });
}

export function useArchiveDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ datasetId }: DatasetLifecycleVariables) => datasetClient.archiveDataset(projectId, datasetId),
    onSuccess: (dataset) => {
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      queryClient.setQueryData(['datasets', projectId, dataset.id], dataset);
    },
  });
}

export function useRestoreDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ datasetId }: DatasetLifecycleVariables) => datasetClient.restoreDataset(projectId, datasetId),
    onSuccess: (dataset) => {
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      queryClient.setQueryData(['datasets', projectId, dataset.id], dataset);
    },
  });
}

export function useDeleteDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (datasetId: string) => datasetClient.deleteDataset(projectId, datasetId),
    onSuccess: (_data, datasetId) => handleDatasetDeleted(queryClient, projectId, datasetId),
  });
}

export function useDeleteDatasetSamples(projectId: string, datasetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: DeleteDatasetSamplesDto) => datasetClient.deleteDatasetSamples(projectId, datasetId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId, datasetId] });
      void queryClient.invalidateQueries({ queryKey: ['dataset-samples', projectId, datasetId] });
    },
  });
}
