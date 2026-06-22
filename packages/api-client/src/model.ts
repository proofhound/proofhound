import type {
  CreateProjectModelDto,
  ListModelContextWindowsQueryDto,
  ModelContextWindowResponseDto,
  ModelReferencesDto,
  ProbeDraftProjectModelDto,
  ProbeModelResponseDto,
  ProjectModelListItemDto,
  ProjectModelListResponseDto,
  RevealApiKeyResponseDto,
  UpdateProjectModelDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export interface ModelDeleteOptions {
  force?: boolean;
  reason?: string;
}

export interface ModelExportResult {
  blob: Blob;
  contentType: string;
  fileName: string;
}

export interface ModelContextWindowListResponse {
  data: ModelContextWindowResponseDto[];
  total: number;
}

function getFileNameFromDisposition(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/iu.exec(disposition);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const ascii = /filename="?([^";]+)"?/iu.exec(disposition);
  return ascii?.[1] ?? fallback;
}

function buildDeleteParams(options?: ModelDeleteOptions): Record<string, string> | undefined {
  if (!options) return undefined;
  const params: Record<string, string> = {};
  if (options.force) params.force = 'true';
  if (options.reason) params.reason = options.reason;
  return Object.keys(params).length > 0 ? params : undefined;
}

export const modelClient = {
  // ---------------- Context window dictionary ----------------
  listModelContextWindows: (query?: ListModelContextWindowsQueryDto) =>
    httpClient
      .get<ModelContextWindowListResponse>('/models/context-windows', { params: query })
      .then((r) => r.data),

  lookupModelContextWindow: (providerModelId: string) =>
    httpClient
      .get<ModelContextWindowResponseDto | null>('/models/context-windows/lookup', { params: { providerModelId } })
      .then((r) => r.data),

  // ---------------- Local models ----------------
  listProjectModels: (_projectId: string) =>
    httpClient.get<ProjectModelListResponseDto>(`/models`).then((r) => r.data),

  getProjectModel: (_projectId: string, modelId: string) =>
    httpClient.get<ProjectModelListItemDto>(`/models/${modelId}`).then((r) => r.data),

  createProjectModel: (_projectId: string, body: CreateProjectModelDto) =>
    httpClient.post<ProjectModelListItemDto>(`/models`, body).then((r) => r.data),

  probeDraftProjectModel: (_projectId: string, body: ProbeDraftProjectModelDto) =>
    httpClient.post<ProbeModelResponseDto>(`/models/probe-draft`, body).then((r) => r.data),

  updateProjectModel: (_projectId: string, modelId: string, body: UpdateProjectModelDto) =>
    httpClient
      .patch<ProjectModelListItemDto>(`/models/${modelId}`, body)
      .then((r) => r.data),

  deleteProjectModel: (_projectId: string, modelId: string, options?: ModelDeleteOptions) =>
    httpClient
      .delete<void>(`/models/${modelId}`, { params: buildDeleteParams(options) })
      .then(() => undefined),

  duplicateProjectModel: (_projectId: string, modelId: string) =>
    httpClient
      .post<ProjectModelListItemDto>(`/models/${modelId}/duplicate`)
      .then((r) => r.data),

  probeProjectModel: (_projectId: string, modelId: string) =>
    httpClient
      .post<ProbeModelResponseDto>(`/models/${modelId}/probe`)
      .then((r) => r.data),

  revealProjectModelApiKey: (_projectId: string, modelId: string) =>
    httpClient
      .get<RevealApiKeyResponseDto>(`/models/${modelId}/api-key`)
      .then((r) => r.data),

  getProjectModelReferences: (_projectId: string, modelId: string) =>
    httpClient
      .get<ModelReferencesDto>(`/models/${modelId}/references`)
      .then((r) => r.data),

  exportProjectModels: (_projectId: string) =>
    httpClient
      .get<Blob>(`/models/export`, { responseType: 'blob' })
      .then((r): ModelExportResult => {
        const contentType =
          typeof r.headers['content-type'] === 'string' ? r.headers['content-type'] : 'text/csv';
        const disposition = typeof r.headers['content-disposition'] === 'string' ? r.headers['content-disposition'] : undefined;
        return {
          blob: r.data,
          contentType,
          fileName: getFileNameFromDisposition(disposition, `models.csv`),
        };
      }),
};
