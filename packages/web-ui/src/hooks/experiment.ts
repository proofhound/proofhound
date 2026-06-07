import { experimentClient, type ExperimentTransferOptions } from '@proofhound/api-client';
import type {
  CreateExperimentDto,
  ExperimentControlActionDto,
  ExperimentExportFormatDto,
  ExperimentListQueryDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTO_REFRESH_INTERVAL_MS } from './use-auto-refresh';

interface ControlExperimentVariables {
  experimentId: string;
  action: ExperimentControlActionDto;
}

interface DownloadExperimentVariables extends ExperimentTransferOptions {
  experimentId?: string;
  format: ExperimentExportFormatDto;
}

export function useExperiments(projectId: string, query?: ExperimentListQueryDto) {
  return useQuery({
    queryKey: ['experiments', projectId, query?.status ?? 'all', query?.search ?? '', query?.sort ?? 'updated'],
    queryFn: () => experimentClient.listExperiments(projectId, query),
    enabled: projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useExperiment(projectId: string, experimentId: string) {
  return useQuery({
    queryKey: ['experiments', projectId, experimentId],
    queryFn: () => experimentClient.getExperiment(projectId, experimentId),
    enabled: projectId.length > 0 && experimentId.length > 0,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useCreateExperiment(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateExperimentDto) => experimentClient.createExperiment(projectId, dto),
    onSuccess: (experiment) => {
      void queryClient.invalidateQueries({ queryKey: ['experiments', projectId] });
      void queryClient.setQueryData(['experiments', projectId, experiment.id], experiment);
    },
  });
}

export function useControlExperiment(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ experimentId, action }: ControlExperimentVariables) =>
      experimentClient.controlExperiment(projectId, experimentId, action),
    onSuccess: (experiment) => {
      void queryClient.invalidateQueries({ queryKey: ['experiments', projectId] });
      void queryClient.setQueryData(['experiments', projectId, experiment.id], experiment);
    },
  });
}

export function useDeleteExperiment(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (experimentId: string) => experimentClient.deleteExperiment(projectId, experimentId),
    onSuccess: (_data, experimentId) => {
      void queryClient.invalidateQueries({ queryKey: ['experiments', projectId] });
      void queryClient.removeQueries({ queryKey: ['experiments', projectId, experimentId] });
    },
  });
}

export function useDownloadExperiment(projectId: string) {
  return useMutation({
    mutationFn: ({ experimentId, format, onProgress }: DownloadExperimentVariables) =>
      experimentId
        ? experimentClient.downloadExperiment(projectId, experimentId, format, { onProgress })
        : experimentClient.downloadExperiments(projectId, format, { onProgress }),
  });
}
