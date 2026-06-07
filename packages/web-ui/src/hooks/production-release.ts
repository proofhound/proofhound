import { productionReleaseClient } from '@proofhound/api-client';
import type { CreateProductionReleaseInputDto, StopProductionReleaseInputDto } from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTO_REFRESH_INTERVAL_MS, type AutoRefreshInterval } from './use-auto-refresh';

interface StopProductionReleaseVariables {
  eventId: string;
  body: StopProductionReleaseInputDto;
}

export function useProductionReleaseList(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ['production-releases', projectId, 'list'],
    queryFn: () => productionReleaseClient.list(projectId),
    enabled: enabled && projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useProductionRelease(projectId: string, eventId: string) {
  return useQuery({
    queryKey: ['production-releases', projectId, 'detail', eventId],
    queryFn: () => productionReleaseClient.get(projectId, eventId),
    enabled: projectId.length > 0 && eventId.length > 0,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useProductionReleaseHistory(
  projectId: string,
  promptId: string,
  refetchInterval: AutoRefreshInterval = false,
) {
  return useQuery({
    queryKey: ['production-releases', projectId, 'history', promptId],
    queryFn: () => productionReleaseClient.getHistory(projectId, promptId),
    enabled: projectId.length > 0 && promptId.length > 0,
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}

export function useCreateProductionRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductionReleaseInputDto) =>
      productionReleaseClient.create(projectId, input),
    onSuccess: (event) => {
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.setQueryData(
        ['production-releases', projectId, 'detail', event.id],
        event,
      );
    },
  });
}

export function useStopProductionRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, body }: StopProductionReleaseVariables) =>
      productionReleaseClient.stop(projectId, eventId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
    },
  });
}
