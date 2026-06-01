import type { TranslationKey } from '../../i18n';

export type ModelSource = 'local';
export type ModelStatus = 'enabled' | 'testing' | 'disabled';
export type ProbeStatus = 'success' | 'failed' | 'pending';
export type ImageCapability = 'none' | 'url' | 'base64' | 'both';

export interface ProjectModel {
  id: string;
  name: string;
  provider: string;
  providerModelId: string;
  endpoint: string;
  source: ModelSource;
  status: ModelStatus;
  probeStatus?: ProbeStatus;
  lastProbedAt?: string;
  lastProbeError?: string | null;
  owner?: string;
  apiKey: string;
  credentialTail: string;
  contextWindow: string;
  contextWindowInput?: string;
  extraBodyInput: string;
  rpm: {
    limit: string;
    limitInput?: string;
    usage: number;
    current: string;
  };
  tpm: {
    limit: string;
    limitInput?: string;
    usage: number;
    current: string;
  };
  concurrency: {
    limit: string;
    limitInput?: string;
    usage: number;
    current: string;
    effective?: string;
  };
  autoConcurrency: boolean;
  pricing: {
    inputPerMillion: string;
    outputPerMillion: string;
  };
  imageCapability: ImageCapability;
  references: number;
  readonly: boolean;
  lastUpdated: string;
}

export function isProjectModelShared(model: ProjectModel) {
  void model;
  return false;
}

export function getProjectModelSource(model: ProjectModel): ModelSource {
  void model;
  return 'local';
}

export function isProjectModelEditable(model: ProjectModel) {
  void model;
  return true;
}

export const MODEL_SOURCE_LABEL_KEYS: Record<ModelSource, TranslationKey> = {
  local: 'models.source.local',
};

export const MODEL_STATUS_LABEL_KEYS: Record<ModelStatus, TranslationKey> = {
  enabled: 'models.status.enabled',
  testing: 'models.status.testing',
  disabled: 'models.status.disabled',
};

export const MODEL_STATUS_CLASSES: Record<ModelStatus, { pill: string; dot: string }> = {
  enabled: { pill: 'status-running', dot: 'dot-running' },
  testing: { pill: 'status-canary', dot: 'dot-canary' },
  disabled: { pill: 'status-archived', dot: 'dot-archived' },
};

export const PROBE_STATUS_LABEL_KEYS: Record<ProbeStatus, TranslationKey> = {
  success: 'models.probe.success',
  failed: 'models.probe.failed',
  pending: 'models.probe.pending',
};

export const PROBE_STATUS_CLASSES: Record<ProbeStatus, { pill: string; dot: string }> = {
  success: { pill: 'status-running', dot: 'dot-running' },
  failed: { pill: 'border border-destructive/35 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  pending: { pill: 'status-pending', dot: 'dot-pending' },
};
