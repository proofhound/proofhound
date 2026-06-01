import { quickStartClient } from '@proofhound/api-client';
import type { CreateQuickStartDto, ProbeQuickStartDraftModelDto } from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const QUICK_START_MODEL_OPTIONS_KEY = ['quick-start', 'models'] as const;

export function useQuickStartModelOptions() {
  return useQuery({
    queryKey: QUICK_START_MODEL_OPTIONS_KEY,
    queryFn: quickStartClient.listModelOptions,
    placeholderData: (previousData) => previousData,
  });
}

export function useProbeQuickStartExistingModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => quickStartClient.probeExistingModel(modelId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUICK_START_MODEL_OPTIONS_KEY }),
  });
}

export function useProbeQuickStartDraftModel() {
  return useMutation({
    mutationFn: (body: ProbeQuickStartDraftModelDto) => quickStartClient.probeDraftModel(body),
  });
}

export function useCreateQuickStart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateQuickStartDto) => quickStartClient.createQuickStart(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['datasets'] });
      void queryClient.invalidateQueries({ queryKey: ['optimizations'] });
      if (result.promptId) void queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });
}
