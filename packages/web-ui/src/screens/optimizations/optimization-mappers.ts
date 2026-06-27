import type {
  OptimizationGoalComparatorDto,
  OptimizationListItemDto,
  OptimizationObjectiveStatusDto,
  OptimizationStartingModeDto,
  OptimizationStatusDto,
} from '@proofhound/shared';
import type { TranslationKey } from '../../i18n';
import { optimizationTone } from './optimization-theme';

export type OptimizationStatus = OptimizationStatusDto;
export type OptimizationObjectiveStatus = OptimizationObjectiveStatusDto;
export type OptimizationOrigin = 'experiment' | 'prompt' | 'dataset';
export type OptimizationStrategy = string;
export type GoalScopeKind = 'overall' | 'class';

export interface OptimizationGoal {
  metric: string;
  comparator: '>=' | '>' | '<=';
  target: number;
  current?: number;
  status: 'hit' | 'miss' | 'fail';
  classLabel?: string;
}

export interface OptimizationSummary {
  id: string;
  name: string;
  description: string;
  origin: OptimizationOrigin;
  originRef: string;
  originHref?: string;
  status: OptimizationStatus;
  objectiveStatus: OptimizationObjectiveStatus;
  summary: OptimizationListItemDto['summary'];
  strategy: OptimizationStrategy;
  currentRound: number;
  maxRounds: number;
  stopAfterNoImprovementRounds: number;
  goalScope: { kind: GoalScopeKind; classes?: string[] };
  goals: OptimizationGoal[];
  bestMetricLabel: string;
  bestMetricValue?: number;
  bestMetricDelta?: { value: number; positive: boolean; vsLabel: string };
  trend?: number[];
  trendHasBaseline?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const OPTIMIZATION_STATUS_LABEL_KEYS: Record<OptimizationStatus, TranslationKey> = {
  running: 'optimizations.status.running',
  success: 'optimizations.status.success',
  failed: 'optimizations.status.failed',
  stopped: 'optimizations.status.stopped',
  cancelled: 'optimizations.status.cancelled',
};

export const OPTIMIZATION_OBJECTIVE_STATUS_LABEL_KEYS: Record<OptimizationObjectiveStatus, TranslationKey> = {
  pending: 'optimizations.objectiveStatus.pending',
  met: 'optimizations.objectiveStatus.met',
  not_met: 'optimizations.objectiveStatus.notMet',
  unknown: 'optimizations.objectiveStatus.unknown',
};

export interface OptimizationStatusTone {
  pill: string;
  dot: string;
  pulse?: boolean;
  bar: string;
  laneHeader: string;
}

export const OPTIMIZATION_STATUS_TONE: Record<OptimizationStatus, OptimizationStatusTone> = {
  running: {
    pill: optimizationTone.info.pill,
    dot: optimizationTone.info.dot,
    pulse: true,
    bar: optimizationTone.info.fill,
    laneHeader: optimizationTone.info.text,
  },
  success: {
    pill: optimizationTone.positive.pill,
    dot: optimizationTone.positive.dot,
    bar: optimizationTone.positive.fill,
    laneHeader: optimizationTone.positive.text,
  },
  failed: {
    pill: optimizationTone.danger.pill,
    dot: optimizationTone.danger.dot,
    bar: optimizationTone.danger.fill,
    laneHeader: optimizationTone.danger.text,
  },
  stopped: {
    pill: optimizationTone.warning.pill,
    dot: optimizationTone.warning.dot,
    bar: optimizationTone.warning.fill,
    laneHeader: optimizationTone.warning.text,
  },
  cancelled: {
    pill: optimizationTone.muted.pill,
    dot: optimizationTone.muted.dot,
    bar: optimizationTone.muted.fill,
    laneHeader: optimizationTone.muted.text,
  },
};

export const OPTIMIZATION_OBJECTIVE_STATUS_TONE: Record<OptimizationObjectiveStatus, OptimizationStatusTone> = {
  pending: {
    pill: optimizationTone.info.pill,
    dot: optimizationTone.info.dot,
    pulse: true,
    bar: optimizationTone.info.fill,
    laneHeader: optimizationTone.info.text,
  },
  met: {
    pill: optimizationTone.positive.pill,
    dot: optimizationTone.positive.dot,
    bar: optimizationTone.positive.fill,
    laneHeader: optimizationTone.positive.text,
  },
  not_met: {
    pill: optimizationTone.warning.pill,
    dot: optimizationTone.warning.dot,
    bar: optimizationTone.warning.fill,
    laneHeader: optimizationTone.warning.text,
  },
  unknown: {
    pill: optimizationTone.muted.pill,
    dot: optimizationTone.muted.dot,
    bar: optimizationTone.muted.fill,
    laneHeader: optimizationTone.muted.text,
  },
};

export const OPTIMIZATION_ORIGIN_LABEL_KEYS: Record<OptimizationOrigin, TranslationKey> = {
  experiment: 'optimizations.origin.experiment',
  prompt: 'optimizations.origin.prompt',
  dataset: 'optimizations.origin.dataset',
};

export function getStatusCount(items: OptimizationSummary[], status: OptimizationStatus) {
  return items.filter((item) => item.status === status).length;
}

export function getOptimizationSearchText(item: OptimizationSummary) {
  return [item.name, item.description, item.originRef, item.bestMetricLabel].join(' ').toLowerCase();
}

export const STARTING_MODE_TO_ORIGIN: Record<OptimizationStartingModeDto, OptimizationOrigin> = {
  from_experiment: 'experiment',
  from_prompt_version: 'prompt',
  from_dataset_only: 'dataset',
};

interface OptimizationOriginSource {
  startingMode: OptimizationStartingModeDto;
  sourceExperimentId?: string | null;
  sourceExperimentName?: string | null;
  promptId?: string | null;
  promptName?: string | null;
  baseVersionId?: string | null;
  baseVersionNumber?: number | null;
  datasetId?: string | null;
  datasetName?: string | null;
}

export function getOptimizationOriginDisplay(source: OptimizationOriginSource): {
  origin: OptimizationOrigin;
  originRef: string;
  originHref?: string;
} {
  const origin = STARTING_MODE_TO_ORIGIN[source.startingMode];

  if (source.startingMode === 'from_experiment') {
    return {
      origin,
      originRef: source.sourceExperimentName ?? '—',
      originHref: source.sourceExperimentId ? `/experiments/${source.sourceExperimentId}` : undefined,
    };
  }

  if (source.startingMode === 'from_prompt_version') {
    const versionLabel =
      typeof source.baseVersionNumber === 'number' && Number.isFinite(source.baseVersionNumber)
        ? `v${source.baseVersionNumber}`
        : null;
    const originRef =
      source.promptName && versionLabel
        ? `${source.promptName} · ${versionLabel}`
        : (source.promptName ?? versionLabel ?? '—');
    const versionQuery = source.baseVersionId ? `?version=${source.baseVersionId}` : '';
    return {
      origin,
      originRef,
      originHref: source.promptId ? `/prompts/${source.promptId}${versionQuery}` : undefined,
    };
  }

  return {
    origin,
    originRef: source.datasetName ?? '—',
    originHref: source.datasetId ? `/datasets/${source.datasetId}` : undefined,
  };
}

// The backend only casts the DB text into the enum rather than zod parse; any residual illegal status values (e.g. legacy
// 'pending') would break the lookup table; fall back to failed so the UI can still render. Migrations 0030/0032 already moved
// the residual pending rows in the DB to failed; the fallback is retained in case of temporary DTO / DB drift.
const VALID_OPTIMIZATION_STATUSES = new Set<string>(['running', 'success', 'failed', 'stopped', 'cancelled']);

function normalizeOptimizationStatus(value: OptimizationStatusDto): OptimizationStatus {
  return VALID_OPTIMIZATION_STATUSES.has(value) ? value : 'failed';
}

const COMPARATOR_MAP: Record<OptimizationGoalComparatorDto, OptimizationGoal['comparator']> = {
  gte: '>=',
  gt: '>',
  lte: '<=',
};

function deriveGoalStatus(
  current: number | undefined,
  target: number,
  comparator: OptimizationGoal['comparator'],
): OptimizationGoal['status'] {
  if (current === undefined || !Number.isFinite(current)) return 'miss';
  if (comparator === '>=') return current >= target ? 'hit' : 'miss';
  if (comparator === '>') return current > target ? 'hit' : 'miss';
  return current <= target ? 'hit' : 'miss';
}

function readGoalMetric(
  dto: OptimizationListItemDto,
  goal: OptimizationListItemDto['goals'][number],
): number | undefined {
  const metrics = dto.bestMetrics;
  if (!metrics) return undefined;
  if (goal.scope === 'overall') {
    const value = metrics[goal.metric];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  const perClass = Array.isArray(metrics.perClass) ? metrics.perClass : [];
  const entry = perClass.find((item) => item.label === goal.scope);
  const value = entry?.[goal.metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      order.push(value);
    }
  }
  return order;
}

export function mapDtoToSummary(dto: OptimizationListItemDto): OptimizationSummary {
  const { origin, originRef, originHref } = getOptimizationOriginDisplay(dto);

  const scopes = dto.goals.map((goal) => goal.scope);
  const classScopes = uniqueStrings(scopes.filter((scope) => scope !== 'overall'));
  const goalScope: OptimizationSummary['goalScope'] =
    scopes.length === 0 || scopes.every((scope) => scope === 'overall')
      ? { kind: 'overall' }
      : { kind: 'class', classes: classScopes };

  const goals: OptimizationGoal[] = dto.goals.map((goal) => {
    const comparator = COMPARATOR_MAP[goal.comparator];
    const current = readGoalMetric(dto, goal);
    return {
      metric: goal.metric,
      comparator,
      target: goal.target,
      current,
      status: deriveGoalStatus(current, goal.target, comparator),
      classLabel: goal.scope === 'overall' ? undefined : goal.scope,
    };
  });

  const firstGoal = dto.goals[0];
  const bestMetricLabel = firstGoal
    ? firstGoal.scope === 'overall'
      ? firstGoal.metric
      : `${firstGoal.scope} · ${firstGoal.metric}`
    : '—';
  const bestMetricValue = firstGoal ? readGoalMetric(dto, firstGoal) : undefined;

  return {
    id: dto.id,
    name: dto.name,
    description: dto.description ?? '',
    origin,
    originRef,
    originHref,
    status: normalizeOptimizationStatus(dto.status),
    objectiveStatus: dto.objectiveStatus,
    summary: dto.summary,
    strategy: dto.strategy,
    currentRound: dto.currentRound,
    maxRounds: dto.maxRounds,
    stopAfterNoImprovementRounds: dto.stopAfterNoImprovementRounds,
    goalScope,
    goals,
    bestMetricLabel,
    bestMetricValue,
    bestMetricDelta: undefined,
    trend: dto.trend ?? undefined,
    trendHasBaseline: dto.trendHasBaseline ?? false,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}
