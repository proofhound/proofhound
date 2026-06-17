import type {
  CreatePromptDraftVersionDto,
  CreatePromptDto,
  PromptDeletionImpactDto,
  PromptDetailDto,
  PromptListItemDto,
  PromptMetricsDto,
  PromptTryRunRequestDto,
  PromptTryRunResponseDto,
  UpdatePromptDraftVersionDto,
  UpdatePromptDto,
  UpdatePromptVersionLabelDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const promptClient = {
  listPrompts: (projectId: string) =>
    httpClient.get<{ data: PromptListItemDto[]; total: number }>(`/prompts`).then((r) => r.data),
  getPrompt: (projectId: string, promptId: string) =>
    httpClient.get<PromptDetailDto>(`/prompts/${promptId}`).then((r) => r.data),
  getPromptMetrics: (projectId: string, promptId: string) =>
    httpClient.get<PromptMetricsDto>(`/prompts/${promptId}/metrics`).then((r) => r.data),
  getPromptDeleteImpact: (projectId: string, promptId: string) =>
    httpClient.get<PromptDeletionImpactDto>(`/prompts/${promptId}/delete-impact`).then((r) => r.data),
  getPromptVersionDeleteImpact: (projectId: string, promptId: string, versionId: string) =>
    httpClient
      .get<PromptDeletionImpactDto>(`/prompts/${promptId}/versions/${versionId}/delete-impact`)
      .then((r) => r.data),
  createPrompt: (projectId: string, body: CreatePromptDto) =>
    httpClient.post<PromptDetailDto>(`/prompts`, body).then((r) => r.data),
  updatePrompt: (projectId: string, promptId: string, body: UpdatePromptDto) =>
    httpClient.patch<PromptDetailDto>(`/prompts/${promptId}`, body).then((r) => r.data),
  archivePrompt: (projectId: string, promptId: string) =>
    httpClient.patch<PromptDetailDto>(`/prompts/${promptId}/archive`).then((r) => r.data),
  restorePrompt: (projectId: string, promptId: string) =>
    httpClient.patch<PromptDetailDto>(`/prompts/${promptId}/restore`).then((r) => r.data),
  updateVersionLabel: (projectId: string, promptId: string, body: UpdatePromptVersionLabelDto) =>
    httpClient.patch<PromptDetailDto>(`/prompts/${promptId}/labels`, body).then((r) => r.data),
  updateDraftVersion: (projectId: string, promptId: string, versionId: string, body: UpdatePromptDraftVersionDto) =>
    httpClient.patch<PromptDetailDto>(`/prompts/${promptId}/versions/${versionId}`, body).then((r) => r.data),
  createDraftVersion: (projectId: string, promptId: string, body: CreatePromptDraftVersionDto) =>
    httpClient.post<PromptDetailDto>(`/prompts/${promptId}/versions`, body).then((r) => r.data),
  deleteDraftVersion: (projectId: string, promptId: string, versionId: string) =>
    httpClient.delete<void>(`/prompts/${promptId}/versions/${versionId}`).then(() => undefined),
  deletePrompt: (projectId: string, promptId: string) =>
    httpClient.delete<void>(`/prompts/${promptId}`).then(() => undefined),
  tryRun: (projectId: string, promptId: string, body: PromptTryRunRequestDto) =>
    httpClient.post<PromptTryRunResponseDto>(`/prompts/${promptId}/try-run`, body).then((r) => r.data),
};
