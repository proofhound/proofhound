import type {
  ArchiveReleaseLineInputDto,
  DeleteReleaseLineInputDto,
  ReleaseLineDeletionImpactDto,
  ReleaseLineDto,
  ReleaseLineEventListResponseDto,
  ReleaseLineListResponseDto,
  RestoreReleaseLineHistoryInputDto,
  StartReleaseLineInputDto,
  StopReleaseLineInputDto,
  UnarchiveReleaseLineInputDto,
  UpdateReleaseLineInputRouteInputDto,
  UpdateReleaseLineOutputRouteInputDto,
  UpdateReleaseLineRunConfigInputDto,
  UpdateReleaseLineTrafficRatioInputDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const releaseLineClient = {
  list: (_projectId: string) =>
    httpClient.get<ReleaseLineListResponseDto>('/release-lines').then((response) => response.data),

  get: (_projectId: string, releaseLineId: string) =>
    httpClient.get<ReleaseLineDto>(`/release-lines/${releaseLineId}`).then((response) => response.data),

  listEvents: (_projectId: string, releaseLineId: string) =>
    httpClient
      .get<ReleaseLineEventListResponseDto>(`/release-lines/${releaseLineId}/events`)
      .then((response) => response.data),

  getDeleteImpact: (_projectId: string, releaseLineId: string) =>
    httpClient
      .get<ReleaseLineDeletionImpactDto>(`/release-lines/${releaseLineId}/delete-impact`)
      .then((response) => response.data),

  updateTrafficRatio: (_projectId: string, releaseLineId: string, body: UpdateReleaseLineTrafficRatioInputDto) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/traffic-ratio`, body)
      .then((response) => response.data),

  promoteCanary: (_projectId: string, releaseLineId: string) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/promote-canary`, {})
      .then((response) => response.data),

  stopLine: (_projectId: string, releaseLineId: string, body: StopReleaseLineInputDto) =>
    httpClient.post<ReleaseLineDto>(`/release-lines/${releaseLineId}/stop`, body).then((response) => response.data),

  startLine: (_projectId: string, releaseLineId: string, body: StartReleaseLineInputDto = {}) =>
    httpClient.post<ReleaseLineDto>(`/release-lines/${releaseLineId}/start`, body).then((response) => response.data),

  archiveLine: (_projectId: string, releaseLineId: string, body: ArchiveReleaseLineInputDto = {}) =>
    httpClient.post<ReleaseLineDto>(`/release-lines/${releaseLineId}/archive`, body).then((response) => response.data),

  unarchiveLine: (_projectId: string, releaseLineId: string, body: UnarchiveReleaseLineInputDto = {}) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/unarchive`, body)
      .then((response) => response.data),

  restoreHistoryToProduction: (
    _projectId: string,
    releaseLineId: string,
    body: RestoreReleaseLineHistoryInputDto,
  ) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/restore-production`, body)
      .then((response) => response.data),

  restoreHistoryToCanary: (_projectId: string, releaseLineId: string, body: RestoreReleaseLineHistoryInputDto) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/restore-canary`, body)
      .then((response) => response.data),

  deleteLine: (_projectId: string, releaseLineId: string, body: DeleteReleaseLineInputDto) =>
    httpClient.delete<{ ok: true }>(`/release-lines/${releaseLineId}`, { data: body }).then(() => undefined),

  updateRunConfig: (_projectId: string, releaseLineId: string, body: UpdateReleaseLineRunConfigInputDto) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/run-config`, body)
      .then((response) => response.data),

  updateOutputRoute: (_projectId: string, releaseLineId: string, body: UpdateReleaseLineOutputRouteInputDto) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/output-route`, body)
      .then((response) => response.data),

  updateInputRoute: (_projectId: string, releaseLineId: string, body: UpdateReleaseLineInputRouteInputDto) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/input-route`, body)
      .then((response) => response.data),
};
