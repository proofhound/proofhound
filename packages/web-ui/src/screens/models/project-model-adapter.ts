import type { ProjectModelListItemDto } from '@proofhound/shared';
import type { ImageCapability, ModelStatus, ProbeStatus, ProjectModel } from './model-view-model';

export function formatLargeNumber(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 ? m.toFixed(1) : m.toFixed(2)} M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })} k`;
  }
  return String(value);
}

function formatJsonInput(value: Record<string, unknown> | undefined): string {
  const entries = Object.keys(value ?? {});
  return entries.length > 0 ? JSON.stringify(value, null, 2) : '';
}

export function dtoToProjectModel(dto: ProjectModelListItemDto): ProjectModel {
  return {
    id: dto.id,
    name: dto.name,
    provider: dto.providerType,
    providerModelId: dto.providerModelId,
    endpoint: dto.endpoint,
    source: 'local',
    status: dto.status as ModelStatus,
    probeStatus: dto.probeStatus as ProbeStatus,
    lastProbedAt: dto.lastProbedAt ?? '',
    lastProbeError: dto.lastProbeError,
    owner: dto.createdByDisplayName ?? undefined,
    apiKey: '',
    credentialTail: dto.credentialTail,
    contextWindow: dto.contextWindowTokens != null ? formatLargeNumber(dto.contextWindowTokens) : '',
    contextWindowInput: dto.contextWindowTokens != null ? String(dto.contextWindowTokens) : '',
    extraBodyInput: formatJsonInput(dto.extraBody),
    rpm: {
      limit: formatLargeNumber(dto.rpm.limit),
      limitInput: String(dto.rpm.limit),
      usage: dto.rpm.usage,
      current: formatLargeNumber(dto.rpm.current),
    },
    tpm: {
      limit: formatLargeNumber(dto.tpm.limit),
      limitInput: String(dto.tpm.limit),
      usage: dto.tpm.usage,
      current: formatLargeNumber(dto.tpm.current),
    },
    concurrency: {
      limit: String(dto.concurrency.limit),
      limitInput: String(dto.concurrency.limit),
      usage: dto.concurrency.usage,
      current: String(dto.concurrency.current),
      effective: dto.concurrency.effective != null ? String(dto.concurrency.effective) : undefined,
    },
    autoConcurrency: dto.autoConcurrency,
    pricing: {
      inputPerMillion: dto.pricing.inputPerMillion.toFixed(2),
      outputPerMillion: dto.pricing.outputPerMillion.toFixed(2),
    },
    imageCapability: dto.capabilities.image as ImageCapability,
    references: dto.references,
    readonly: false,
    lastUpdated: dto.updatedAt,
  };
}
