import { promptClient } from '@proofhound/api-client';
import type {
  CreatePromptDraftVersionDto,
  CreatePromptDto,
  PromptTryRunRequestDto,
  PromptListItemDto,
  UpdatePromptDraftVersionDto,
  UpdatePromptDto,
  UpdatePromptVersionLabelDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface UpdatePromptDraftVersionVariables {
  promptId: string;
  versionId: string;
  body: UpdatePromptDraftVersionDto;
}

interface UpdatePromptVariables {
  promptId: string;
  body: UpdatePromptDto;
}

interface UpdatePromptVersionLabelVariables {
  promptId: string;
  body: UpdatePromptVersionLabelDto;
}

interface CreatePromptDraftVersionVariables {
  promptId: string;
  body: CreatePromptDraftVersionDto;
}

interface DeletePromptDraftVersionVariables {
  promptId: string;
  versionId: string;
}

interface PromptLifecycleVariables {
  promptId: string;
}

export function usePrompts(projectId: string) {
  return useQuery({
    queryKey: ['prompts', projectId],
    queryFn: () => promptClient.listPrompts(projectId),
    enabled: projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function usePrompt(projectId: string, promptId: string) {
  return useQuery({
    queryKey: ['prompts', projectId, promptId],
    queryFn: () => promptClient.getPrompt(projectId, promptId),
    enabled: projectId.length > 0 && promptId.length > 0,
  });
}

export function usePromptMetrics(projectId: string, promptId: string) {
  return useQuery({
    queryKey: ['prompts', projectId, promptId, 'metrics'],
    queryFn: () => promptClient.getPromptMetrics(projectId, promptId),
    enabled: projectId.length > 0 && promptId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function usePromptDeleteImpact(projectId: string, promptId: string) {
  return useQuery({
    queryKey: ['prompts', projectId, promptId, 'delete-impact'],
    queryFn: () => promptClient.getPromptDeleteImpact(projectId, promptId),
    enabled: projectId.length > 0 && promptId.length > 0,
  });
}

export function usePromptVersionDeleteImpact(projectId: string, promptId: string, versionId: string) {
  return useQuery({
    queryKey: ['prompts', projectId, promptId, 'versions', versionId, 'delete-impact'],
    queryFn: () => promptClient.getPromptVersionDeleteImpact(projectId, promptId, versionId),
    enabled: projectId.length > 0 && promptId.length > 0 && versionId.length > 0,
  });
}

export function useCreatePrompt(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreatePromptDto) => promptClient.createPrompt(projectId, body),
    onSuccess: (prompt) => {
      queryClient.setQueryData<{ data: PromptListItemDto[]; total: number }>(['prompts', projectId], (previous) => {
        if (!previous) return previous;
        const exists = previous.data.some((item) => item.id === prompt.id);
        return {
          data: exists
            ? previous.data.map((item) => (item.id === prompt.id ? prompt : item))
            : [prompt, ...previous.data],
          total: exists ? previous.total : previous.total + 1,
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      queryClient.setQueryData(['prompts', projectId, prompt.id], prompt);
    },
  });
}

export function useUpdatePrompt(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ promptId, body }: UpdatePromptVariables) => promptClient.updatePrompt(projectId, promptId, body),
    onSuccess: (prompt) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      queryClient.setQueryData(['prompts', projectId, prompt.id], prompt);
    },
  });
}

export function useArchivePrompt(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ promptId }: PromptLifecycleVariables) => promptClient.archivePrompt(projectId, promptId),
    onSuccess: (prompt) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      queryClient.setQueryData(['prompts', projectId, prompt.id], prompt);
    },
  });
}

export function useRestorePrompt(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ promptId }: PromptLifecycleVariables) => promptClient.restorePrompt(projectId, promptId),
    onSuccess: (prompt) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      queryClient.setQueryData(['prompts', projectId, prompt.id], prompt);
    },
  });
}

export function useUpdatePromptVersionLabel(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ promptId, body }: UpdatePromptVersionLabelVariables) =>
      promptClient.updateVersionLabel(projectId, promptId, body),
    onSuccess: (prompt) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId, prompt.id, 'metrics'] });
      queryClient.setQueryData(['prompts', projectId, prompt.id], prompt);
    },
  });
}

export function useUpdatePromptDraftVersion(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ promptId, versionId, body }: UpdatePromptDraftVersionVariables) =>
      promptClient.updateDraftVersion(projectId, promptId, versionId, body),
    onSuccess: (prompt) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      queryClient.setQueryData(['prompts', projectId, prompt.id], prompt);
    },
  });
}

export function useDeletePrompt(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (promptId: string) => promptClient.deletePrompt(projectId, promptId),
    onSuccess: (_data, promptId) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      void queryClient.removeQueries({ queryKey: ['prompts', projectId, promptId] });
    },
  });
}

export function useCreatePromptDraftVersion(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ promptId, body }: CreatePromptDraftVersionVariables) =>
      promptClient.createDraftVersion(projectId, promptId, body),
    onSuccess: (prompt) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      queryClient.setQueryData(['prompts', projectId, prompt.id], prompt);
    },
  });
}

interface PromptTryRunVariables {
  promptId: string;
  body: PromptTryRunRequestDto;
}

export function usePromptTryRun(projectId: string) {
  return useMutation({
    mutationFn: ({ promptId, body }: PromptTryRunVariables) => promptClient.tryRun(projectId, promptId, body),
  });
}

export function useDeletePromptDraftVersion(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ promptId, versionId }: DeletePromptDraftVersionVariables) =>
      promptClient.deleteDraftVersion(projectId, promptId, versionId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['prompts', projectId, variables.promptId] });
    },
  });
}
