'use client';

import { useMemo } from 'react';
import { releaseLineClient } from '@proofhound/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateReleaseLineRunConfigInputDto, UpdateReleaseLineTrafficRatioInputDto } from '@proofhound/shared';
import { mapReleaseLineDtos } from '../lib';

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

export function useReleaseLineEvents(projectId: string, releaseLineId: string) {
  return useQuery({
    queryKey: ['release-lines', projectId, 'detail', releaseLineId, 'events'],
    queryFn: () => releaseLineClient.listEvents(projectId, releaseLineId),
    enabled: projectId.length > 0 && releaseLineId.length > 0,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });
}

export function useUpdateReleaseLineTrafficRatio(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseLineId, body }: { releaseLineId: string; body: UpdateReleaseLineTrafficRatioInputDto }) =>
      releaseLineClient.updateTrafficRatio(projectId, releaseLineId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
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
