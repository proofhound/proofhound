import { optimizationClient } from '@proofhound/api-client';
import type {
  OptimizationControlActionDto,
  OptimizationDetailDto,
  OptimizationListItemDto,
  OptimizationListQueryDto,
  CreateOptimizationDto,
} from '@proofhound/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTO_REFRESH_INTERVAL_MS } from './use-auto-refresh';

interface ControlOptimizationVariables {
  optimizationId: string;
  action: OptimizationControlActionDto;
}

const optimizationsQueryRoot = (projectId: string) => ['optimizations', projectId] as const;

export function getOptimizationListQueryKey(projectId: string, query?: OptimizationListQueryDto) {
  return [
    ...optimizationsQueryRoot(projectId),
    query?.status ?? 'all',
    query?.search ?? '',
    query?.sort ?? 'updated',
  ] as const;
}

export function getOptimizationDetailQueryKey(projectId: string, optimizationId: string) {
  return [...optimizationsQueryRoot(projectId), optimizationId] as const;
}

export function handleOptimizationCreated(
  queryClient: QueryClient,
  projectId: string,
  _created: OptimizationListItemDto,
) {
  // The create response is a list item. Detail pages must fetch OptimizationDetailDto.
  return queryClient.invalidateQueries({ queryKey: optimizationsQueryRoot(projectId) });
}

export function useOptimizations(projectId: string, query?: OptimizationListQueryDto) {
  return useQuery({
    queryKey: getOptimizationListQueryKey(projectId, query),
    queryFn: () => optimizationClient.listOptimizations(projectId, query),
    enabled: projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useOptimization(projectId: string, optimizationId: string) {
  return useQuery({
    queryKey: getOptimizationDetailQueryKey(projectId, optimizationId),
    queryFn: () => optimizationClient.getOptimization(projectId, optimizationId),
    enabled: projectId.length > 0 && optimizationId.length > 0,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useCreateOptimization(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateOptimizationDto) => optimizationClient.createOptimization(projectId, body),
    onSuccess: (created) => {
      void handleOptimizationCreated(queryClient, projectId, created);
    },
  });
}

interface ControlMutationContext {
  previous?: OptimizationDetailDto;
}

export function useControlOptimization(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, ControlOptimizationVariables, ControlMutationContext>({
    mutationFn: ({ optimizationId, action }: ControlOptimizationVariables) =>
      optimizationClient.controlOptimization(projectId, optimizationId, action),
    // Preemptive UI feedback: the backend service writes the terminal status in one shot on stop/cancel (SPEC 25 §7);
    // before the network round-trip, mutate the detail cache to the matching terminal state so the user sees the status flip immediately on click.
    // resume does not do optimistic (wait for the real response; launcher startup may fail).
    onMutate: async ({ optimizationId, action }) => {
      const nextStatus =
        action === 'stop' ? ('stopped' as const)
        : action === 'cancel' ? ('cancelled' as const)
        : null;
      if (!nextStatus) return {};
      const detailKey = getOptimizationDetailQueryKey(projectId, optimizationId);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<OptimizationDetailDto>(detailKey);
      if (previous) {
        queryClient.setQueryData<OptimizationDetailDto>(detailKey, {
          ...previous,
          status: nextStatus,
          controlState: action,
          finishedAt: new Date().toISOString(),
        });
      }
      return { previous };
    },
    onError: (_err, { optimizationId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          getOptimizationDetailQueryKey(projectId, optimizationId),
          context.previous,
        );
      }
    },
    onSettled: (_data, _err, { optimizationId }) => {
      void queryClient.invalidateQueries({ queryKey: optimizationsQueryRoot(projectId) });
      void queryClient.invalidateQueries({ queryKey: getOptimizationDetailQueryKey(projectId, optimizationId) });
    },
  });
}

export function useDeleteOptimization(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (optimizationId: string) => optimizationClient.deleteOptimization(projectId, optimizationId),
    onSuccess: (_data, optimizationId) => {
      void queryClient.invalidateQueries({ queryKey: optimizationsQueryRoot(projectId) });
      void queryClient.removeQueries({ queryKey: getOptimizationDetailQueryKey(projectId, optimizationId) });
    },
  });
}
