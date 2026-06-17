import type {
  RunResultReleaseListQueryDto,
  ReleaseRunResultListResponseDto,
  RunResultDetailDto,
  RunResultListQueryDto,
  RunResultListResponseDto,
} from '@proofhound/shared';
import { httpClient } from './http';

function buildParams(query: RunResultListQueryDto): Record<string, unknown> {
  const out: Record<string, unknown> = {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
  };
  if (query.status && query.status.length > 0) out['status'] = query.status.join(',');
  if (query.judgmentStatus && query.judgmentStatus.length > 0) out['judgmentStatus'] = query.judgmentStatus.join(',');
  if (typeof query.isCorrect === 'boolean') out['isCorrect'] = String(query.isCorrect);
  if (query.search && query.search.length > 0) out['search'] = query.search;
  return out;
}

function buildReleaseParams(query: RunResultReleaseListQueryDto): Record<string, unknown> {
  const out = buildParams(query);
  if (query.sourceIds && query.sourceIds.length > 0) out['sourceIds'] = query.sourceIds.join(',');
  if (query.releaseVersionIds && query.releaseVersionIds.length > 0) {
    out['releaseVersionIds'] = query.releaseVersionIds.join(',');
  }
  if (query.releaseVersionScope) out['releaseVersionScope'] = query.releaseVersionScope;
  if (query.promptVersionIds && query.promptVersionIds.length > 0) {
    out['promptVersionIds'] = query.promptVersionIds.join(',');
  }
  if (query.lane && query.lane.length > 0) out['lane'] = query.lane.join(',');
  if (query.externalId && query.externalId.length > 0) out['externalId'] = query.externalId;
  if (query.from) out['from'] = query.from;
  if (query.to) out['to'] = query.to;
  return out;
}

export const runResultClient = {
  listForExperiment: (projectId: string, experimentId: string, query: RunResultListQueryDto) =>
    httpClient
      .get<RunResultListResponseDto>(`/experiments/${experimentId}/run-results`, { params: buildParams(query) })
      .then((r) => r.data),
  listForRelease: (projectId: string, query: RunResultReleaseListQueryDto) =>
    httpClient
      .get<ReleaseRunResultListResponseDto>(`/run-results/releases`, { params: buildReleaseParams(query) })
      .then((r) => r.data),
  get: (projectId: string, experimentId: string, runResultId: string) =>
    httpClient.get<RunResultDetailDto>(`/experiments/${experimentId}/run-results/${runResultId}`).then((r) => r.data),
};
