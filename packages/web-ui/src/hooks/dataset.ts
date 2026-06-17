import { datasetClient, type DatasetTransferOptions } from '@proofhound/api-client';
import type {
  CreateDatasetDto,
  DatasetDeletionImpactDto,
  DatasetExportFormatDto,
  DatasetListItemDto,
  DeleteDatasetSamplesDto,
  UpdateDatasetMetadataDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface CreateDatasetVariables extends DatasetTransferOptions {
  body: CreateDatasetDto;
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

export function useDatasets(projectId: string) {
  return useQuery({
    queryKey: ['datasets', projectId],
    queryFn: () => datasetClient.listDatasets(projectId),
    enabled: projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useDataset(projectId: string, datasetId: string) {
  return useQuery({
    queryKey: ['datasets', projectId, datasetId],
    queryFn: () => datasetClient.getDataset(projectId, datasetId),
    enabled: projectId.length > 0 && datasetId.length > 0,
  });
}

export function useDatasetDeleteImpact(projectId: string, datasetId: string) {
  return useQuery<DatasetDeletionImpactDto>({
    queryKey: ['datasets', projectId, datasetId, 'delete-impact'],
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
    queryKey: ['dataset-samples', projectId, datasetId, query.page, query.pageSize, query.search],
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
    onSuccess: (_data, datasetId) => {
      void queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      void queryClient.removeQueries({ queryKey: ['datasets', projectId, datasetId] });
      void queryClient.removeQueries({ queryKey: ['dataset-samples', projectId, datasetId] });
    },
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
