'use client';

import { useMemo } from 'react';
import { releaseLineClient } from '@proofhound/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArchiveReleaseLineInputDto,
  DeleteReleaseLineInputDto,
  ReleaseLineDeletionImpactDto,
  RestoreReleaseLineHistoryInputDto,
  StartReleaseLineInputDto,
  StopReleaseLineInputDto,
  UnarchiveReleaseLineInputDto,
  UpdateReleaseLineInputRouteInputDto,
  UpdateReleaseLineOutputRouteInputDto,
  UpdateReleaseLineRetentionInputDto,
  UpdateReleaseLineRunConfigInputDto,
  UpdateReleaseLineTrafficRatioInputDto,
} from '@proofhound/shared';
import { mapReleaseLineDtos } from '../lib';
import type { AutoRefreshInterval } from './use-auto-refresh';

export function useReleaseLineList(projectId: string, enabled = true) {
  const releaseLineQuery = useQuery({
    queryKey: ['release-lines', projectId, 'list'],
    queryFn: () => releaseLineClient.list(projectId),
    enabled: enabled && projectId.length > 0,
    placeholderData: (previous) => previous,
  });

  const lines = useMemo(() => mapReleaseLineDtos(releaseLineQuery.data?.data ?? []), [releaseLineQuery.data]);

  return {
    data: lines,
    isLoading: releaseLineQuery.isLoading && !releaseLineQuery.data,
    isFetching: releaseLineQuery.isFetching,
    isError: releaseLineQuery.isError,
    releaseLineQuery,
  };
}

export function useReleaseLineEvents(
  projectId: string,
  releaseLineId: string,
  refetchInterval: AutoRefreshInterval = false,
) {
  return useQuery({
    queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'],
    queryFn: () => releaseLineClient.listEvents(projectId, releaseLineId),
    enabled: projectId.length > 0 && releaseLineId.length > 0,
    refetchInterval,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });
}

export function useReleaseLineDeleteImpact(projectId: string, releaseLineId: string) {
  return useQuery<ReleaseLineDeletionImpactDto>({
    queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'delete-impact'],
    queryFn: () => releaseLineClient.getDeleteImpact(projectId, releaseLineId),
    enabled: projectId.length > 0 && releaseLineId.length > 0,
  });
}

export function useUpdateReleaseLineTrafficRatio(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: UpdateReleaseLineTrafficRatioInputDto }) =>
      releaseLineClient.updateTrafficRatio(projectId, releaseLineId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function usePromoteReleaseLineCanary(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (releaseLineId: string) => releaseLineClient.promoteCanary(projectId, releaseLineId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useStopReleaseLine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: StopReleaseLineInputDto }) =>
      releaseLineClient.stopLine(projectId, releaseLineId, body),
    onSuccess: (_data, { releaseLineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useStartReleaseLine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body = {} }: { releaseLineId: string; body?: StartReleaseLineInputDto }) =>
      releaseLineClient.startLine(projectId, releaseLineId, body),
    onSuccess: (_data, { releaseLineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useArchiveReleaseLine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body = {} }: { releaseLineId: string; body?: ArchiveReleaseLineInputDto }) =>
      releaseLineClient.archiveLine(projectId, releaseLineId, body),
    onSuccess: (_data, { releaseLineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useUnarchiveReleaseLine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body = {} }: { releaseLineId: string; body?: UnarchiveReleaseLineInputDto }) =>
      releaseLineClient.unarchiveLine(projectId, releaseLineId, body),
    onSuccess: (_data, { releaseLineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useRestoreReleaseLineHistoryToProduction(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: RestoreReleaseLineHistoryInputDto }) =>
      releaseLineClient.restoreHistoryToProduction(projectId, releaseLineId, body),
    onSuccess: (_data, { releaseLineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useRestoreReleaseLineHistoryToCanary(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: RestoreReleaseLineHistoryInputDto }) =>
      releaseLineClient.restoreHistoryToCanary(projectId, releaseLineId, body),
    onSuccess: (_data, { releaseLineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useDeleteReleaseLine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: DeleteReleaseLineInputDto }) =>
      releaseLineClient.deleteLine(projectId, releaseLineId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useUpdateReleaseLineRunConfig(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: UpdateReleaseLineRunConfigInputDto }) =>
      releaseLineClient.updateRunConfig(projectId, releaseLineId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useUpdateReleaseLineOutputRoute(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: UpdateReleaseLineOutputRouteInputDto }) =>
      releaseLineClient.updateOutputRoute(projectId, releaseLineId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useUpdateReleaseLineInputRoute(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: UpdateReleaseLineInputRouteInputDto }) =>
      releaseLineClient.updateInputRoute(projectId, releaseLineId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
    },
  });
}

export function useUpdateReleaseLineRetention(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: UpdateReleaseLineRetentionInputDto }) =>
      releaseLineClient.updateRetention(projectId, releaseLineId, body),
    onSuccess: (_data, { releaseLineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
    },
  });
}
