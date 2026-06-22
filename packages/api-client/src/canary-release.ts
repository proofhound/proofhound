import type {
  CanaryAnnotationDto,
  CanaryReleaseDto,
  CanaryReleaseListItemDto,
  ClaimCanaryAnnotationsInputDto,
  CreateCanaryReleaseInputDto,
  ReleaseCanaryAnnotationInputDto,
  SubmitCanaryAnnotationInputDto,
  UpdateCanaryTrafficRatioInputDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export interface CanaryReleaseListResponseDto {
  data: CanaryReleaseListItemDto[];
  total: number;
}

export interface CanaryAnnotationListResponseDto {
  data: CanaryAnnotationDto[];
  total: number;
}

export interface ClaimCanaryAnnotationsResponseDto {
  data: CanaryAnnotationDto[];
  claimedCount: number;
}

export interface CanaryAnnotationListQuery {
  status?: 'pending' | 'claimed' | 'submitted';
  limit?: number;
  offset?: number;
}

export const canaryReleaseClient = {
  list: (_projectId: string) =>
    httpClient
      .get<CanaryReleaseListResponseDto>(`/canary-releases`)
      .then((r) => r.data),

  get: (_projectId: string, canaryId: string) =>
    httpClient
      .get<CanaryReleaseDto>(`/canary-releases/${canaryId}`)
      .then((r) => r.data),

  create: (_projectId: string, body: CreateCanaryReleaseInputDto) =>
    httpClient
      .post<CanaryReleaseDto>(`/canary-releases`, body)
      .then((r) => r.data),

  start: (_projectId: string, canaryId: string) =>
    httpClient
      .post<CanaryReleaseDto>(`/canary-releases/${canaryId}/start`, {})
      .then((r) => r.data),

  stop: (_projectId: string, canaryId: string) =>
    httpClient
      .post<CanaryReleaseDto>(`/canary-releases/${canaryId}/stop`, {})
      .then((r) => r.data),

  resume: (_projectId: string, canaryId: string) =>
    httpClient
      .post<CanaryReleaseDto>(`/canary-releases/${canaryId}/resume`, {})
      .then((r) => r.data),

  cancel: (_projectId: string, canaryId: string) =>
    httpClient
      .post<CanaryReleaseDto>(`/canary-releases/${canaryId}/cancel`, {})
      .then((r) => r.data),

  updateTrafficRatio: (
    _projectId: string,
    canaryId: string,
    body: UpdateCanaryTrafficRatioInputDto,
  ) =>
    httpClient
      .post<CanaryReleaseDto>(`/canary-releases/${canaryId}/traffic-ratio`, body)
      .then((r) => r.data),

  softDelete: (
    _projectId: string,
    canaryId: string,
    options?: { force?: boolean; reason?: string },
  ) =>
    httpClient
      .delete<{ ok: true }>(`/canary-releases/${canaryId}`, {
        params: { force: options?.force ? 'true' : undefined, reason: options?.reason },
      })
      .then((r) => r.data),

  listAnnotations: (_projectId: string, canaryId: string, query?: CanaryAnnotationListQuery) =>
    httpClient
      .get<CanaryAnnotationListResponseDto>(
        `/canary-releases/${canaryId}/annotations`,
        { params: query },
      )
      .then((r) => r.data),

  claimAnnotations: (
    _projectId: string,
    canaryId: string,
    body: ClaimCanaryAnnotationsInputDto,
  ) =>
    httpClient
      .post<ClaimCanaryAnnotationsResponseDto>(
        `/canary-releases/${canaryId}/annotations/claim`,
        body,
      )
      .then((r) => r.data),

  submitAnnotation: (
    _projectId: string,
    canaryId: string,
    body: SubmitCanaryAnnotationInputDto,
  ) =>
    httpClient
      .post<CanaryAnnotationDto>(
        `/canary-releases/${canaryId}/annotations/submit`,
        body,
      )
      .then((r) => r.data),

  releaseAnnotation: (
    _projectId: string,
    canaryId: string,
    body: ReleaseCanaryAnnotationInputDto,
  ) =>
    httpClient
      .post<CanaryAnnotationDto>(
        `/canary-releases/${canaryId}/annotations/release`,
        body,
      )
      .then((r) => r.data),
};
