import { runResultClient } from '@proofhound/api-client';
import type { RunResultListQueryDto, RunResultReleaseListQueryDto } from '@proofhound/shared';
import { useQuery } from '@tanstack/react-query';

const RUN_RESULT_REFETCH_INTERVAL_MS = 5_000;

export function useExperimentRunResults(projectId: string, experimentId: string, query: RunResultListQueryDto) {
  const serializedQuery = serializeQuery(query);
  return useQuery({
    queryKey: ['run-results', projectId, experimentId, serializedQuery],
    queryFn: () => runResultClient.listForExperiment(projectId, experimentId, query),
    enabled: projectId.length > 0 && experimentId.length > 0,
    refetchInterval: RUN_RESULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

export function useReleaseRunResults(projectId: string, query: RunResultReleaseListQueryDto, enabled = true) {
  const serializedQuery = serializeReleaseQuery(query);
  return useQuery({
    queryKey: ['run-results', projectId, 'releases', serializedQuery],
    queryFn: () => runResultClient.listForRelease(projectId, query),
    enabled: enabled && projectId.length > 0,
    refetchInterval: RUN_RESULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

export function useRunResult(projectId: string, experimentId: string, runResultId: string | null) {
  return useQuery({
    queryKey: ['run-results', projectId, experimentId, 'detail', runResultId],
    queryFn: () => runResultClient.get(projectId, experimentId, runResultId as string),
    enabled: projectId.length > 0 && experimentId.length > 0 && Boolean(runResultId),
  });
}

function serializeQuery(query: RunResultListQueryDto): string {
  return [
    `p=${query.page}`,
    `ps=${query.pageSize}`,
    `s=${query.sort}`,
    `st=${(query.status ?? []).join(',')}`,
    `js=${(query.judgmentStatus ?? []).join(',')}`,
    `ic=${typeof query.isCorrect === 'boolean' ? query.isCorrect : ''}`,
    `q=${query.search ?? ''}`,
  ].join('|');
}

function serializeReleaseQuery(query: RunResultReleaseListQueryDto): string {
  return [
    serializeQuery(query),
    `sid=${(query.sourceIds ?? []).join(',')}`,
    `rvid=${(query.releaseVariantIds ?? []).join(',')}`,
    `pvid=${(query.promptVersionIds ?? []).join(',')}`,
    `lane=${(query.lane ?? []).join(',')}`,
    `eid=${query.externalId ?? ''}`,
    `from=${query.from ?? ''}`,
    `to=${query.to ?? ''}`,
  ].join('|');
}
