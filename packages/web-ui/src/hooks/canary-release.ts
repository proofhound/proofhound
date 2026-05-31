import { canaryReleaseClient, type CanaryAnnotationListQuery } from '@proofhound/api-client';
import type {
  ClaimCanaryAnnotationsInputDto,
  CreateCanaryReleaseInputDto,
  ReleaseCanaryAnnotationInputDto,
  SubmitCanaryAnnotationInputDto,
  UpdateCanaryTrafficRatioInputDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const ROOT_KEY = 'canary-releases' as const;

export function useCanaryReleaseList(projectId: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT_KEY, projectId, 'list'],
    queryFn: () => canaryReleaseClient.list(projectId),
    enabled: enabled && projectId.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useCanaryRelease(projectId: string, canaryId: string) {
  return useQuery({
    queryKey: [ROOT_KEY, projectId, 'detail', canaryId],
    queryFn: () => canaryReleaseClient.get(projectId, canaryId),
    enabled: projectId.length > 0 && canaryId.length > 0,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5_000 : false),
  });
}

export function useCanaryAnnotations(
  projectId: string,
  canaryId: string,
  query?: CanaryAnnotationListQuery,
) {
  return useQuery({
    queryKey: [ROOT_KEY, projectId, 'annotations', canaryId, query],
    queryFn: () => canaryReleaseClient.listAnnotations(projectId, canaryId, query),
    enabled: projectId.length > 0 && canaryId.length > 0,
    refetchInterval: 5_000,
  });
}

export function useCreateCanaryRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCanaryReleaseInputDto) =>
      canaryReleaseClient.create(projectId, input),
    onSuccess: (canary) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.setQueryData([ROOT_KEY, projectId, 'detail', canary.id], canary);
    },
  });
}

export function useStartCanaryRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canaryId: string) => canaryReleaseClient.start(projectId, canaryId),
    onSuccess: (canary) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.setQueryData([ROOT_KEY, projectId, 'detail', canary.id], canary);
    },
  });
}

export function useStopCanaryRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canaryId: string) => canaryReleaseClient.stop(projectId, canaryId),
    onSuccess: (canary) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.setQueryData([ROOT_KEY, projectId, 'detail', canary.id], canary);
    },
  });
}

export function useResumeCanaryRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canaryId: string) => canaryReleaseClient.resume(projectId, canaryId),
    onSuccess: (canary) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.setQueryData([ROOT_KEY, projectId, 'detail', canary.id], canary);
    },
  });
}

export function useCancelCanaryRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canaryId: string) => canaryReleaseClient.cancel(projectId, canaryId),
    onSuccess: (canary) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.setQueryData([ROOT_KEY, projectId, 'detail', canary.id], canary);
    },
  });
}

export function useUpdateCanaryTrafficRatio(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      canaryId,
      body,
    }: {
      canaryId: string;
      body: UpdateCanaryTrafficRatioInputDto;
    }) => canaryReleaseClient.updateTrafficRatio(projectId, canaryId, body),
    onSuccess: (canary) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
      void queryClient.setQueryData([ROOT_KEY, projectId, 'detail', canary.id], canary);
    },
  });
}

export function useDeleteCanaryRelease(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      canaryId,
      force,
      reason,
    }: {
      canaryId: string;
      force?: boolean;
      reason?: string;
    }) => canaryReleaseClient.softDelete(projectId, canaryId, { force, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
    },
  });
}

export function useClaimCanaryAnnotations(projectId: string, canaryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ClaimCanaryAnnotationsInputDto) =>
      canaryReleaseClient.claimAnnotations(projectId, canaryId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [ROOT_KEY, projectId, 'annotations', canaryId],
      });
      void queryClient.invalidateQueries({
        queryKey: [ROOT_KEY, projectId, 'detail', canaryId],
      });
    },
  });
}

export function useSubmitCanaryAnnotation(projectId: string, canaryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitCanaryAnnotationInputDto) =>
      canaryReleaseClient.submitAnnotation(projectId, canaryId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [ROOT_KEY, projectId, 'annotations', canaryId],
      });
    },
  });
}

export function useReleaseCanaryAnnotation(projectId: string, canaryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReleaseCanaryAnnotationInputDto) =>
      canaryReleaseClient.releaseAnnotation(projectId, canaryId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [ROOT_KEY, projectId, 'annotations', canaryId],
      });
    },
  });
}
