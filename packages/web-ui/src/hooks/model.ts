import { modelClient, type ModelDeleteOptions } from '@proofhound/api-client';
import type {
  CreateProjectModelDto,
  ListModelContextWindowsQueryDto,
  ProbeDraftProjectModelDto,
  UpdateProjectModelDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const MODEL_LIST_USAGE_REFETCH_INTERVAL_MS = 5_000;
const contextWindowKey = (query?: ListModelContextWindowsQueryDto) => ['model-context-windows', query] as const;
const projectKey = (projectId: string) => ['project-models', projectId] as const;
const modelDetailKey = (projectId: string, modelId: string) => ['model', projectId, modelId] as const;
const referencesKey = (projectId: string, modelId: string) => ['model-references', projectId, modelId] as const;

interface ProjectModelsQueryOptions {
  autoRefresh?: boolean;
}

// ----------------------- Context window dictionary -----------------------
export function useModelContextWindows(query?: ListModelContextWindowsQueryDto) {
  return useQuery({
    queryKey: contextWindowKey(query),
    queryFn: () => modelClient.listModelContextWindows(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useLookupModelContextWindow() {
  return useMutation({
    mutationFn: (providerModelId: string) => modelClient.lookupModelContextWindow(providerModelId),
  });
}

// ----------------------- Models -----------------------
export function useProjectModels(projectId: string, options: ProjectModelsQueryOptions = {}) {
  return useQuery({
    queryKey: projectKey(projectId),
    queryFn: () => modelClient.listProjectModels(projectId),
    enabled: projectId.length > 0,
    refetchInterval: options.autoRefresh === false ? false : MODEL_LIST_USAGE_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });
}

export function useProjectModel(projectId: string, modelId: string) {
  return useQuery({
    queryKey: modelDetailKey(projectId, modelId),
    queryFn: () => modelClient.getProjectModel(projectId, modelId),
    enabled: projectId.length > 0 && modelId.length > 0,
  });
}

export function useCreateProjectModel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectModelDto) => modelClient.createProjectModel(projectId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: projectKey(projectId) }),
  });
}

export function useProbeDraftProjectModel(projectId: string) {
  return useMutation({
    mutationFn: (body: ProbeDraftProjectModelDto) => modelClient.probeDraftProjectModel(projectId, body),
  });
}

export function useUpdateProjectModel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, body }: { modelId: string; body: UpdateProjectModelDto }) =>
      modelClient.updateProjectModel(projectId, modelId, body),
    onSuccess: (_data, { modelId }) => {
      void qc.invalidateQueries({ queryKey: projectKey(projectId) });
      void qc.invalidateQueries({ queryKey: modelDetailKey(projectId, modelId) });
    },
  });
}

export function useDeleteProjectModel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, options }: { modelId: string; options?: ModelDeleteOptions }) =>
      modelClient.deleteProjectModel(projectId, modelId, options),
    onSuccess: (_data, { modelId }) => {
      void qc.invalidateQueries({ queryKey: projectKey(projectId) });
      void qc.removeQueries({ queryKey: modelDetailKey(projectId, modelId) });
    },
  });
}

export function useDuplicateProjectModel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => modelClient.duplicateProjectModel(projectId, modelId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: projectKey(projectId) }),
  });
}

export function useProbeProjectModel(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => modelClient.probeProjectModel(projectId, modelId),
    onSuccess: (_data, modelId) => {
      void qc.invalidateQueries({ queryKey: projectKey(projectId) });
      void qc.invalidateQueries({ queryKey: modelDetailKey(projectId, modelId) });
    },
  });
}

export function useRevealProjectModelApiKey(projectId: string) {
  return useMutation({
    mutationFn: (modelId: string) => modelClient.revealProjectModelApiKey(projectId, modelId),
  });
}

export function useProjectModelReferences(projectId: string, modelId: string, enabled: boolean) {
  return useQuery({
    queryKey: referencesKey(projectId, modelId),
    queryFn: () => modelClient.getProjectModelReferences(projectId, modelId),
    enabled: enabled && projectId.length > 0 && modelId.length > 0,
  });
}

export function useExportProjectModels(projectId: string) {
  return useMutation({ mutationFn: () => modelClient.exportProjectModels(projectId) });
}
