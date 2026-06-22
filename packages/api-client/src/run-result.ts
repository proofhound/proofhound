import type {
  ReleaseRunResultCleanupFilterDto,
  ReleaseRunResultCleanupImpactDto,
  ReleaseRunResultCleanupInputDto,
  RunResultExportFormatDto,
  RunResultReleaseListQueryDto,
  ReleaseRunResultListResponseDto,
  RunResultDetailDto,
  RunResultListQueryDto,
  RunResultListResponseDto,
} from '@proofhound/shared';
import type { AxiosProgressEvent } from 'axios';
import { httpClient } from './http';

export interface RunResultTransferProgress {
  loadedBytes: number;
  totalBytes: number | null;
}

export interface RunResultTransferOptions {
  onProgress?: (progress: RunResultTransferProgress) => void;
}

export interface RunResultDownloadResult {
  blob: Blob;
  fileName: string;
  contentType: string;
}

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

function toTransferProgress(event: AxiosProgressEvent): RunResultTransferProgress {
  return {
    loadedBytes: event.loaded,
    totalBytes: typeof event.total === 'number' && Number.isFinite(event.total) ? event.total : null,
  };
}

function getFileNameFromDisposition(disposition: string | undefined, fallback: string) {
  if (!disposition) return fallback;

  const utf8Match = /filename\*=UTF-8''([^;]+)/iu.exec(disposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = /filename="?([^";]+)"?/iu.exec(disposition);
  return asciiMatch?.[1] ?? fallback;
}

function toDownloadResult(
  blob: Blob,
  headers: Record<string, unknown>,
  fallbackFileName: string,
): RunResultDownloadResult {
  const contentTypeHeader = headers['content-type'];
  const dispositionHeader = headers['content-disposition'];
  const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : 'application/octet-stream';

  return {
    blob,
    contentType,
    fileName: getFileNameFromDisposition(
      typeof dispositionHeader === 'string' ? dispositionHeader : undefined,
      fallbackFileName,
    ),
  };
}

export const runResultClient = {
  listForExperiment: (projectId: string, experimentId: string, query: RunResultListQueryDto) =>
    httpClient
      .get<RunResultListResponseDto>(`/experiments/${experimentId}/run-results`, { params: buildParams(query) })
      .then((r) => r.data),
  downloadForExperiment: (
    projectId: string,
    experimentId: string,
    format: RunResultExportFormatDto,
    query: RunResultListQueryDto,
    options?: RunResultTransferOptions,
  ) =>
    httpClient
      .get<Blob>(`/experiments/${experimentId}/run-results/export`, {
        params: { ...buildParams(query), format },
        responseType: 'blob',
        onDownloadProgress: options?.onProgress
          ? (event) => options.onProgress?.(toTransferProgress(event))
          : undefined,
      })
      .then((r) => toDownloadResult(r.data, r.headers, `experiment-run-results-${experimentId}.${format}`)),
  listForRelease: (projectId: string, query: RunResultReleaseListQueryDto) =>
    httpClient
      .get<ReleaseRunResultListResponseDto>(`/run-results/releases`, { params: buildReleaseParams(query) })
      .then((r) => r.data),
  downloadForRelease: (
    projectId: string,
    format: RunResultExportFormatDto,
    query: RunResultReleaseListQueryDto,
    options?: RunResultTransferOptions,
  ) =>
    httpClient
      .get<Blob>(`/run-results/releases/export`, {
        params: { ...buildReleaseParams(query), format },
        responseType: 'blob',
        onDownloadProgress: options?.onProgress
          ? (event) => options.onProgress?.(toTransferProgress(event))
          : undefined,
      })
      .then((r) => toDownloadResult(r.data, r.headers, `release-run-results-${projectId}.${format}`)),
  previewReleaseCleanup: (projectId: string, input: ReleaseRunResultCleanupFilterDto) =>
    httpClient
      .post<ReleaseRunResultCleanupImpactDto>(`/run-results/releases/cleanup-preview`, input)
      .then((r) => r.data),
  cleanupRelease: (projectId: string, input: ReleaseRunResultCleanupInputDto) =>
    httpClient.post<ReleaseRunResultCleanupImpactDto>(`/run-results/releases/cleanup`, input).then((r) => r.data),
  get: (projectId: string, experimentId: string, runResultId: string) =>
    httpClient.get<RunResultDetailDto>(`/experiments/${experimentId}/run-results/${runResultId}`).then((r) => r.data),
};
