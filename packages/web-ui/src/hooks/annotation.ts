import { annotationClient, type AnnotationSampleListQuery } from '@proofhound/api-client';
import type {
  ClaimAnnotationSamplesInputDto,
  CreateAnnotationTaskInputDto,
  ReleaseAnnotationSampleInputDto,
  SubmitAnnotationSampleInputDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AutoRefreshInterval } from './use-auto-refresh';

const ROOT_KEY = 'annotation-tasks' as const;

export function useAnnotationTaskList(projectId: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT_KEY, projectId, 'list'],
    queryFn: () => annotationClient.listTasks(projectId),
    enabled: enabled && projectId.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useAnnotationTaskOptions(projectId: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT_KEY, projectId, 'options'],
    queryFn: () => annotationClient.listOptions(projectId),
    enabled: enabled && projectId.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useAnnotationTask(projectId: string, taskId: string) {
  return useQuery({
    queryKey: [ROOT_KEY, projectId, 'detail', taskId],
    queryFn: () => annotationClient.getTask(projectId, taskId),
    enabled: projectId.length > 0 && taskId.length > 0,
  });
}

export function useAnnotationSamples(
  projectId: string,
  taskId: string,
  query?: AnnotationSampleListQuery,
  refetchInterval: AutoRefreshInterval = false,
) {
  return useQuery({
    queryKey: [ROOT_KEY, projectId, 'samples', taskId, query],
    queryFn: () => annotationClient.listSamples(projectId, taskId, query),
    enabled: projectId.length > 0 && taskId.length > 0,
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}

export function useCreateAnnotationTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAnnotationTaskInputDto) => annotationClient.createTask(projectId, body),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId] });
      void queryClient.setQueryData([ROOT_KEY, projectId, 'detail', task.id], task);
    },
  });
}

export function useClaimAnnotationSamples(projectId: string, taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ClaimAnnotationSamplesInputDto) => annotationClient.claimSamples(projectId, taskId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'list'] });
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'detail', taskId] });
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'samples', taskId] });
    },
  });
}

export function useSubmitAnnotationSample(projectId: string, taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitAnnotationSampleInputDto) => annotationClient.submitSample(projectId, taskId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'list'] });
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'detail', taskId] });
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'samples', taskId] });
    },
  });
}

export function useReleaseAnnotationSample(projectId: string, taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReleaseAnnotationSampleInputDto) => annotationClient.releaseSample(projectId, taskId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'list'] });
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'detail', taskId] });
      void queryClient.invalidateQueries({ queryKey: [ROOT_KEY, projectId, 'samples', taskId] });
    },
  });
}
