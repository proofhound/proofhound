import { projectMonitoringClient } from '@proofhound/api-client';
import type {
  ModelMonitoringRankingResponseDto,
  ProjectMonitoringFilterDto,
  PromptMonitoringRankingResponseDto,
} from '@proofhound/shared';
import { useQuery } from '@tanstack/react-query';

const REFETCH_MS = 5_000;

function filterKey(filter: ProjectMonitoringFilterDto): string {
  return JSON.stringify([
    filter.from,
    filter.to,
    filter.granularity,
    [...(filter.modelIds ?? [])].sort(),
    [...(filter.promptIds ?? [])].sort(),
    [...(filter.promptVersionIds ?? [])].sort(),
    [...(filter.sourceIds ?? [])].sort(),
    [...(filter.sources ?? [])].sort(),
  ]);
}

export function useProjectMonitoringStats(projectId: string, filter: ProjectMonitoringFilterDto, enabled = true) {
  return useQuery({
    queryKey: ['project-monitoring', projectId, 'stats', filterKey(filter)],
    queryFn: () => projectMonitoringClient.getStats(projectId, filter),
    enabled: enabled && projectId.length > 0,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });
}

export function useProjectMonitoringTimeseries(projectId: string, filter: ProjectMonitoringFilterDto, enabled = true) {
  return useQuery({
    queryKey: ['project-monitoring', projectId, 'timeseries', filterKey(filter)],
    queryFn: () => projectMonitoringClient.getTimeseries(projectId, filter),
    enabled: enabled && projectId.length > 0,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });
}

export function usePromptMonitoringRanking(
  projectId: string,
  filter: ProjectMonitoringFilterDto,
  sortBy: PromptMonitoringRankingResponseDto['sortBy'],
  enabled = true,
) {
  return useQuery({
    queryKey: ['project-monitoring', projectId, 'prompts-ranking', filterKey(filter), sortBy],
    queryFn: () => projectMonitoringClient.getPromptsRanking(projectId, filter, sortBy),
    enabled: enabled && projectId.length > 0,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });
}

export function useProjectModelMonitoringRanking(
  projectId: string,
  filter: ProjectMonitoringFilterDto,
  sortBy: ModelMonitoringRankingResponseDto['sortBy'],
  enabled = true,
) {
  return useQuery({
    queryKey: ['project-monitoring', projectId, 'models-ranking', filterKey(filter), sortBy],
    queryFn: () => projectMonitoringClient.getModelsRanking(projectId, filter, sortBy),
    enabled: enabled && projectId.length > 0,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });
}
