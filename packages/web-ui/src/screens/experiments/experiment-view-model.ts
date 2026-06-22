import type {
  ExperimentMetricsPerClassEntryDto,
  ExperimentRunConfigDto,
  ModelImageCapability,
  PromptLanguageDto,
  PromptVariableTypeDto,
  PromptVersionStatusDto,
} from '@proofhound/shared';
import { MODALITY_KIND_ORDER, type ModalityKind } from '@proofhound/ui';
import type { TranslationKey } from '../../i18n';
import { experimentTone } from './experiment-theme';

export type ExperimentStatus = 'running' | 'success' | 'failed' | 'stopped';
export type LegacyExperimentStatus = ExperimentStatus | 'cancelled';
export type ExperimentControlState = 'stop' | 'resume' | null;
export type ExperimentDisplayStatus = ExperimentStatus | 'stopping';
export type ExperimentFailureKind = 'rate_limit' | 'parse' | 'timeout' | 'internal';
export type ExperimentQualityMetricKey = 'accuracy' | 'precision' | 'recall' | 'f1';
export type ExperimentEngineeringMetricKey =
  | 'p50LatencyMs'
  | 'p95LatencyMs'
  | 'averageLatencyMs'
  | 'totalTokens'
  | 'costEstimate'
  | 'failedSamples';
export type ExperimentComparisonMetricKey = ExperimentQualityMetricKey | ExperimentEngineeringMetricKey;
export type ExperimentQualityDimensionKey = typeof EXPERIMENT_OVERALL_QUALITY_DIMENSION | string;

export const EXPERIMENT_QUALITY_METRIC_KEYS: readonly ExperimentQualityMetricKey[] = [
  'accuracy',
  'precision',
  'recall',
  'f1',
];
export const EXPERIMENT_ENGINEERING_METRIC_KEYS: readonly ExperimentEngineeringMetricKey[] = [
  'p50LatencyMs',
  'p95LatencyMs',
  'averageLatencyMs',
  'totalTokens',
  'costEstimate',
  'failedSamples',
];
export const EXPERIMENT_OVERALL_QUALITY_DIMENSION = '__overall__';

const IMAGE_PROMPT_VARIABLE_TYPES = new Set(['image', 'image_url', 'image_base64']);

export function normalizeExperimentStatus(status: LegacyExperimentStatus): ExperimentStatus {
  return status === 'cancelled' ? 'stopped' : status;
}

export function deriveExperimentDisplayStatus(
  status: LegacyExperimentStatus,
  controlState: ExperimentControlState | undefined,
): ExperimentDisplayStatus {
  const normalized = normalizeExperimentStatus(status);
  return normalized === 'running' && controlState === 'stop' ? 'stopping' : normalized;
}

export function derivePromptModalityKinds(types: ReadonlyArray<string>): ModalityKind[] {
  const kinds = new Set<ModalityKind>();
  for (const type of types) {
    if (IMAGE_PROMPT_VARIABLE_TYPES.has(type)) kinds.add('image');
    else if (type === 'number') kinds.add('number');
    else if (type === 'text') kinds.add('text');
  }
  return Array.from(kinds).sort((a, b) => MODALITY_KIND_ORDER[a] - MODALITY_KIND_ORDER[b]);
}

export function hasImagePromptVariable(types: ReadonlyArray<string>): boolean {
  return types.some((type) => IMAGE_PROMPT_VARIABLE_TYPES.has(type));
}

export interface ExperimentSummary {
  id: string;
  name: string;
  description: string;
  ownerHandle: string;
  optimizationId?: string;
  roundIndex?: number;
  promptId?: string;
  promptVersionId?: string;
  datasetId?: string;
  modelId?: string;
  promptName: string;
  promptVersion: string;
  promptVariableTypes?: PromptVariableTypeDto[];
  datasetName: string;
  datasetSamples: number;
  datasetHasImages?: boolean;
  modelName: string;
  modelVariant: string;
  status: ExperimentStatus;
  controlState?: ExperimentControlState;
  displayStatus: ExperimentDisplayStatus;
  progressDone: number;
  progressTotal: number;
  elapsedLabel: string;
  remainingLabel?: string;
  durationLabel?: string;
  agoLabel?: string;
  failureReason?: string;
  failureKind?: ExperimentFailureKind;
  failedSamples: number;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  perClassMetrics?: ExperimentMetricsPerClassEntryDto[];
  inputTokens?: number;
  outputTokens?: number;
  costEstimate?: number;
  averageLatencyMs?: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  isArchived?: boolean;
  startedAt: string;
  runConfig: ExperimentRunConfigDto;
}

export function getExperimentComparisonMetricValue(
  experiment: ExperimentSummary,
  key: ExperimentComparisonMetricKey,
  qualityDimension: ExperimentQualityDimensionKey = EXPERIMENT_OVERALL_QUALITY_DIMENSION,
): number | undefined {
  if (
    qualityDimension !== EXPERIMENT_OVERALL_QUALITY_DIMENSION &&
    EXPERIMENT_QUALITY_METRIC_KEYS.includes(key as ExperimentQualityMetricKey)
  ) {
    const perClass = experiment.perClassMetrics?.find((row) => row.label === qualityDimension);
    if (!perClass || key === 'accuracy') return undefined;
    if (key !== 'precision' && key !== 'recall' && key !== 'f1') return undefined;
    const value = perClass[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  if (key === 'totalTokens') {
    const hasInput = typeof experiment.inputTokens === 'number';
    const hasOutput = typeof experiment.outputTokens === 'number';
    if (!hasInput && !hasOutput) return undefined;
    return (experiment.inputTokens ?? 0) + (experiment.outputTokens ?? 0);
  }

  return experiment[key];
}

export function getExperimentComparisonMetricDomainMax(
  experiments: ReadonlyArray<ExperimentSummary>,
  key: ExperimentComparisonMetricKey,
  qualityDimension: ExperimentQualityDimensionKey = EXPERIMENT_OVERALL_QUALITY_DIMENSION,
): number {
  if (EXPERIMENT_QUALITY_METRIC_KEYS.includes(key as ExperimentQualityMetricKey)) return 1;

  const max = Math.max(
    0,
    ...experiments.map((experiment) => getExperimentComparisonMetricValue(experiment, key, qualityDimension) ?? 0),
  );
  return max > 0 ? max : 1;
}

export function getExperimentComparisonClassLabels(experiments: ReadonlyArray<ExperimentSummary>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const experiment of experiments) {
    for (const row of experiment.perClassMetrics ?? []) {
      const label = row.label.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }

  return labels;
}

export const EXPERIMENT_STATUS_LABEL_KEYS: Record<ExperimentDisplayStatus, TranslationKey> = {
  running: 'experiments.status.running',
  stopping: 'experiments.status.stopping',
  success: 'experiments.status.success',
  failed: 'experiments.status.failed',
  stopped: 'experiments.status.stopped',
};

export interface ExperimentStatusTone {
  pill: string;
  dot: string;
  pulse?: boolean;
  bar: string;
  laneHeader: string;
}

export const EXPERIMENT_STATUS_TONE: Record<ExperimentDisplayStatus, ExperimentStatusTone> = {
  running: {
    pill: experimentTone.info.pill,
    dot: experimentTone.info.dot,
    pulse: true,
    bar: experimentTone.info.fill,
    laneHeader: experimentTone.info.text,
  },
  stopping: {
    pill: experimentTone.warning.pill,
    dot: experimentTone.warning.dot,
    pulse: true,
    bar: experimentTone.warning.fill,
    laneHeader: experimentTone.warning.text,
  },
  success: {
    pill: experimentTone.positive.pill,
    dot: experimentTone.positive.dot,
    bar: experimentTone.positive.fill,
    laneHeader: experimentTone.positive.text,
  },
  failed: {
    pill: experimentTone.danger.pill,
    dot: experimentTone.danger.dot,
    bar: experimentTone.danger.fill,
    laneHeader: experimentTone.danger.text,
  },
  stopped: {
    pill: experimentTone.warning.pill,
    dot: experimentTone.warning.dot,
    bar: experimentTone.warning.fill,
    laneHeader: experimentTone.warning.text,
  },
};

export interface ExperimentPromptOption {
  id: string;
  name: string;
  version: string;
  promptLanguage: PromptLanguageDto;
  isLatest?: boolean;
  ownerHandle: string;
  updatedAgo: string;
  variableCount: number;
  defaultDatasetId: string;
  variables: Array<{ name: string; type: string; required: boolean; datasetField?: string | null }>;
  promptPreview: string;
  template: string;
  status?: PromptVersionStatusDto;
}

export interface ExperimentDatasetOption {
  id: string;
  name: string;
  sampleCount: number;
  description: string;
  expectedField?: string;
  inputFieldCount: number;
  updatedAgo: string;
  missingField?: string;
  allFieldsOk?: boolean;
}

export interface ExperimentModelOption {
  id: string;
  name: string;
  provider: string;
  contextWindow: string;
  imageCapability: ModelImageCapability;
  capabilities: Array<'tool' | 'vision' | 'local'>;
  rpm: number;
  rpmLimit: number;
  tpm: string;
  tpmLimit: number;
  concurrencyLimit: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  pricePer1Mt: string;
}
