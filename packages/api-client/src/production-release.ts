import type {
  CreateProductionReleaseInputDto,
  ProductionReleaseEventDto,
  ProductionReleaseHistoryItemDto,
  ProductionReleaseListItemDto,
  StopProductionReleaseInputDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export interface ProductionReleaseListResponseDto {
  data: ProductionReleaseListItemDto[];
  total: number;
}

export interface ProductionReleaseHistoryResponseDto {
  data: ProductionReleaseHistoryItemDto[];
  total: number;
}

export const productionReleaseClient = {
  list: (_projectId: string) =>
    httpClient
      .get<ProductionReleaseListResponseDto>(`/production-releases`)
      .then((r) => r.data),

  get: (_projectId: string, eventId: string) =>
    httpClient
      .get<ProductionReleaseEventDto>(`/production-releases/${eventId}`)
      .then((r) => r.data),

  create: (_projectId: string, body: CreateProductionReleaseInputDto) =>
    httpClient
      .post<ProductionReleaseEventDto>(`/production-releases`, body)
      .then((r) => r.data),

  stop: (_projectId: string, eventId: string, body: StopProductionReleaseInputDto) =>
    httpClient
      .post<ProductionReleaseEventDto>(
        `/production-releases/${eventId}/stop`,
        body,
      )
      .then((r) => r.data),

  getHistory: (_projectId: string, promptId: string) =>
    httpClient
      .get<ProductionReleaseHistoryResponseDto>(
        `/production-releases/by-prompt/${promptId}/history`,
      )
      .then((r) => r.data),
};
