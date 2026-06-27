'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownNarrowWide,
  ArrowLeft,
  ArrowUpNarrowWide,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Clock,
  FileText,
  FlaskConical,
  Hourglass,
  Play,
  Square,
  Wrench,
} from 'lucide-react';
import type {
  OptimizationDetailDto,
  OptimizationDetailIterationRoundDto,
  OptimizationDetailRoundExperimentResultDto,
  OptimizationDetailRoundGoalChipDto,
  OptimizationDetailRoundImprovementPriorityDto,
  OptimizationDetailRoundStepDto,
  OptimizationDetailRoundStepKindDto,
  OptimizationDetailRoundStepStatusDto,
  OptimizationDetailRoundStreamDto,
} from '@proofhound/shared';
import {
  Button,
  Progress,
  formatProgressLabel,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TableActionIconButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DetailPageSkeleton,
  cn,
} from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { PromptDiffSplitView } from '../../components';
import { useOptimization, useControlOptimization } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import { optimizationTone } from './optimization-theme';
import { OptimizationOutcomeBadge, OriginBadge } from './optimization-ui';
import { OPTIMIZATION_ORIGIN_LABEL_KEYS, getOptimizationOriginDisplay } from './optimization-mappers';

type OptimizationDetail = OptimizationDetailDto;
type IterationRound = OptimizationDetailIterationRoundDto;
type RoundExperimentResult = OptimizationDetailRoundExperimentResultDto;
type RoundStream = OptimizationDetailRoundStreamDto;
type MetricComparison = NonNullable<NonNullable<RoundExperimentResult['overallRow']>['deltas']>['accuracy'];

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getOptimizationDurationSeconds(
  detail: Pick<OptimizationDetail, 'createdAt' | 'finishedAt' | 'startedAt' | 'status' | 'updatedAt'>,
) {
  const startedAt = Date.parse(detail.startedAt ?? detail.createdAt);
  const endedAt = detail.finishedAt
    ? Date.parse(detail.finishedAt)
    : detail.status === 'running'
      ? Date.now()
      : Date.parse(detail.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return Math.round((endedAt - startedAt) / 1000);
}

function getDurationParts(totalSeconds: number | null) {
  if (totalSeconds === null || totalSeconds < 0 || !Number.isFinite(totalSeconds)) return null;
  const seconds = Math.round(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) {
    return [
      { label: 'd', value: days },
      { label: 'h', value: hours, pad: true },
      { label: 'm', value: minutes, pad: true },
      { label: 's', value: remainingSeconds, pad: true },
    ];
  }
  if (hours > 0) {
    return [
      { label: 'h', value: hours },
      { label: 'm', value: minutes, pad: true },
      { label: 's', value: remainingSeconds, pad: true },
    ];
  }
  if (minutes > 0) {
    return [
      { label: 'm', value: minutes },
      { label: 's', value: remainingSeconds, pad: true },
    ];
  }
  return [{ label: 's', value: remainingSeconds }];
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function formatMetric(value: number, fractionDigits = 3) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(fractionDigits);
}

type OptimizationMetricKey =
  | 'accuracy'
  | 'precision'
  | 'recall'
  | 'f1'
  | 'fpr'
  | 'inputTokens'
  | 'outputTokens'
  | 'costEstimate'
  | 'averageLatencyMs'
  | 'p50LatencyMs'
  | 'p95LatencyMs';

const OPTIMIZATION_METRIC_LABEL_KEYS = {
  accuracy: 'optimizations.metrics.accuracy',
  precision: 'optimizations.metrics.precision',
  recall: 'optimizations.metrics.recall',
  f1: 'optimizations.metrics.f1',
  fpr: 'optimizations.metrics.fpr',
  inputTokens: 'optimizations.metrics.inputTokens',
  outputTokens: 'optimizations.metrics.outputTokens',
  costEstimate: 'optimizations.metrics.costEstimate',
  averageLatencyMs: 'optimizations.metrics.averageLatencyMs',
  p50LatencyMs: 'optimizations.metrics.p50LatencyMs',
  p95LatencyMs: 'optimizations.metrics.p95LatencyMs',
} satisfies Record<OptimizationMetricKey, TranslationKey>;

const OPTIMIZATION_METRIC_ALIASES: Record<string, OptimizationMetricKey> = {
  acc: 'accuracy',
  accuracy: 'accuracy',
  precision: 'precision',
  recall: 'recall',
  f1: 'f1',
  fpr: 'fpr',
  inputtokens: 'inputTokens',
  outputtokens: 'outputTokens',
  costestimate: 'costEstimate',
  averagelatencyms: 'averageLatencyMs',
  p50latencyms: 'p50LatencyMs',
  p95latencyms: 'p95LatencyMs',
};

const INTEGER_METRIC_KEYS = new Set<OptimizationMetricKey>(['inputTokens', 'outputTokens']);
const LATENCY_METRIC_KEYS = new Set<OptimizationMetricKey>(['averageLatencyMs', 'p50LatencyMs', 'p95LatencyMs']);

function resolveOptimizationMetricKey(label: string): OptimizationMetricKey | null {
  const normalized = label.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return OPTIMIZATION_METRIC_ALIASES[normalized] ?? null;
}

function formatMetricCost(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function formatMetricDisplayValue(label: string, value: number): string {
  const metricKey = resolveOptimizationMetricKey(label);
  if (!metricKey) return formatMetric(value);
  if (INTEGER_METRIC_KEYS.has(metricKey)) return formatThousand(Math.round(value));
  if (LATENCY_METRIC_KEYS.has(metricKey)) return `${formatThousand(Math.round(value))} ms`;
  if (metricKey === 'costEstimate') return formatMetricCost(value);
  return formatMetric(value);
}

function formatMetricDisplayLabel(label: string, t: (key: TranslationKey) => string): string {
  const metricKey = resolveOptimizationMetricKey(label);
  return metricKey ? t(OPTIMIZATION_METRIC_LABEL_KEYS[metricKey]) : label;
}

function formatDelta(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}`;
}

function formatThousand(value: number) {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

const OVERALL_TREND_SCOPE = 'overall';
const TREND_METRIC_KEYS: OptimizationMetricKey[] = ['accuracy', 'precision', 'recall', 'f1', 'fpr'];
const SCORE_TREND_METRICS = new Set<OptimizationMetricKey>(['accuracy', 'precision', 'recall', 'f1', 'fpr']);
const LOWER_IS_BETTER_TREND_METRICS = new Set<OptimizationMetricKey>([
  'fpr',
  'inputTokens',
  'outputTokens',
  'costEstimate',
  'averageLatencyMs',
  'p50LatencyMs',
  'p95LatencyMs',
]);
const TREND_SERIES_STYLES = [
  { line: 'text-[var(--status-canary-dot)]', text: optimizationTone.info.text },
  { line: 'text-[var(--status-running-dot)]', text: optimizationTone.positive.text },
  { line: 'text-[var(--status-pending-dot)]', text: optimizationTone.warning.text },
  { line: 'text-destructive', text: optimizationTone.danger.text },
  { line: 'text-[var(--status-archived-dot)]', text: optimizationTone.muted.text },
] as const;

type TrendScopeId = typeof OVERALL_TREND_SCOPE | `class:${string}`;
type TrendMetricSelectorValue = OptimizationMetricKey;
type TrendMetricCells = IterationRound['metrics'];

interface TrendScopeOption {
  id: TrendScopeId;
  kind: 'overall' | 'class';
  label?: string;
}

interface TrendMetricOption {
  value: TrendMetricSelectorValue;
}

interface TrendSlot {
  id: string;
  kind: 'baseline' | 'round';
  roundIndex: number;
}

interface TrendSeriesView {
  id: string;
  metricKey: OptimizationMetricKey;
  labelKey: TranslationKey;
  values: Array<number | null>;
  target?: number;
  bestSlotIndex?: number;
  style: (typeof TREND_SERIES_STYLES)[number];
}

interface TrendChartViewModel {
  scopeOptions: TrendScopeOption[];
  metricOptions: TrendMetricOption[];
  defaultScopeId: TrendScopeId;
  defaultMetricValue: TrendMetricSelectorValue | null;
  slots: TrendSlot[];
  series: TrendSeriesView[];
  hasBaseline: boolean;
  currentSlotIndex: number;
  primaryBestSlotIndex?: number;
}

function trendScopeIdForGoalScope(scope: string): TrendScopeId {
  return scope === OVERALL_TREND_SCOPE ? OVERALL_TREND_SCOPE : `class:${scope}`;
}

function trendClassLabel(scopeId: TrendScopeId): string | null {
  return scopeId === OVERALL_TREND_SCOPE ? null : scopeId.slice('class:'.length);
}

function goalMatchesTrendScope(goal: OptimizationDetail['goals'][number], scopeId: TrendScopeId): boolean {
  return trendScopeIdForGoalScope(goal.scope) === scopeId;
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function computeF1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  const denominator = precision + recall;
  return denominator > 0 ? (2 * precision * recall) / denominator : null;
}

function metricBetterIsLower(metricKey: OptimizationMetricKey): boolean {
  return LOWER_IS_BETTER_TREND_METRICS.has(metricKey);
}

function readMetricCell(cells: TrendMetricCells | undefined, metricKey: OptimizationMetricKey): number | null {
  for (const cell of cells ?? []) {
    if (resolveOptimizationMetricKey(cell.label) === metricKey && Number.isFinite(cell.value)) return cell.value;
  }
  return null;
}

function readTrendMetricValue(
  input: { experimentResult?: RoundExperimentResult; metrics?: TrendMetricCells },
  scopeId: TrendScopeId,
  metricKey: OptimizationMetricKey,
): number | null {
  const classLabel = trendClassLabel(scopeId);
  if (!classLabel) {
    const overall = input.experimentResult?.overallRow;
    if (metricKey === 'accuracy' && typeof overall?.accuracy === 'number') return overall.accuracy;
    if (metricKey === 'precision' && typeof overall?.precision === 'number') return overall.precision;
    if (metricKey === 'recall' && typeof overall?.recall === 'number') return overall.recall;
    if (metricKey === 'f1') {
      return readMetricCell(input.metrics, metricKey) ?? computeF1(overall?.precision ?? null, overall?.recall ?? null);
    }
    return readMetricCell(input.metrics, metricKey);
  }

  const row = input.experimentResult?.classRows.find((item) => item.label === classLabel);
  if (!row) return null;
  if (metricKey === 'accuracy') return typeof row.accuracy === 'number' ? row.accuracy : null;
  if (metricKey === 'precision') return row.precision;
  if (metricKey === 'recall') return row.recall;
  if (metricKey === 'f1') return typeof row.f1 === 'number' ? row.f1 : computeF1(row.precision, row.recall);
  if (metricKey === 'fpr') return typeof row.fpr === 'number' ? row.fpr : null;
  return null;
}

function buildTrendScopeOptions(detail: OptimizationDetail): TrendScopeOption[] {
  const classLabels = uniqueValues([
    ...detail.goals.filter((goal) => goal.scope !== OVERALL_TREND_SCOPE).map((goal) => goal.scope),
    ...(detail.baseline?.experimentResult?.classRows ?? []).map((row) => row.label),
    ...detail.rounds.flatMap((round) => round.experimentResult?.classRows.map((row) => row.label) ?? []),
  ]).filter(Boolean);
  return [
    { id: OVERALL_TREND_SCOPE, kind: 'overall' },
    ...classLabels.map((label) => ({ id: `class:${label}` as TrendScopeId, kind: 'class' as const, label })),
  ];
}

function buildTrendMetricOptions(detail: OptimizationDetail, scopeId: TrendScopeId): TrendMetricOption[] {
  const metricKeys = new Set<OptimizationMetricKey>();
  const goalMetricKeys = detail.goals
    .filter((goal) => goalMatchesTrendScope(goal, scopeId))
    .map((goal) => resolveOptimizationMetricKey(goal.metric))
    .filter((key): key is OptimizationMetricKey => key !== null);
  for (const key of goalMetricKeys) metricKeys.add(key);

  const sources = [
    { experimentResult: detail.baseline?.experimentResult, metrics: detail.baseline?.metrics },
    ...detail.rounds.map((round) => ({ experimentResult: round.experimentResult, metrics: round.metrics })),
  ];
  for (const key of TREND_METRIC_KEYS) {
    if (sources.some((source) => readTrendMetricValue(source, scopeId, key) !== null)) {
      metricKeys.add(key);
    }
  }

  const options: TrendMetricOption[] = [];
  for (const key of TREND_METRIC_KEYS) {
    if (metricKeys.has(key)) options.push({ value: key });
  }
  return options;
}

function buildTrendChartViewModel(
  detail: OptimizationDetail,
  requestedScopeId: TrendScopeId | null,
  requestedMetricValue: TrendMetricSelectorValue | null,
): TrendChartViewModel {
  const scopeOptions = buildTrendScopeOptions(detail);
  const goalScope = detail.goals.find((goal) => goal.scope !== OVERALL_TREND_SCOPE)?.scope;
  const goalScopeId = goalScope ? trendScopeIdForGoalScope(goalScope) : OVERALL_TREND_SCOPE;
  const defaultScopeId = scopeOptions.some((option) => option.id === goalScopeId) ? goalScopeId : OVERALL_TREND_SCOPE;
  const scopeId =
    requestedScopeId && scopeOptions.some((option) => option.id === requestedScopeId)
      ? requestedScopeId
      : defaultScopeId;
  const metricOptions = buildTrendMetricOptions(detail, scopeId);
  const matchingGoalKeys = detail.goals
    .filter((goal) => goalMatchesTrendScope(goal, scopeId))
    .map((goal) => resolveOptimizationMetricKey(goal.metric))
    .filter((key): key is OptimizationMetricKey => key !== null);
  const defaultMetricValue =
    uniqueValues(matchingGoalKeys).find((key) => metricOptions.some((option) => option.value === key)) ??
    metricOptions[0]?.value ??
    null;
  const metricValue =
    requestedMetricValue && metricOptions.some((option) => option.value === requestedMetricValue)
      ? requestedMetricValue
      : defaultMetricValue;
  const selectedMetricKeys = metricValue ? [metricValue] : [];

  const sortedRounds = detail.rounds
    .filter((round) => round.isBaseline !== true && round.index > 0)
    .slice()
    .sort((a, b) => a.index - b.index);
  const baselineRound = detail.rounds.find((round) => round.isBaseline === true);
  const baselineSource = {
    experimentResult: detail.baseline?.experimentResult ?? baselineRound?.experimentResult,
    metrics: detail.baseline?.metrics ?? baselineRound?.metrics,
  };
  const hasBaseline = selectedMetricKeys.some((key) => readTrendMetricValue(baselineSource, scopeId, key) !== null);
  const slots: TrendSlot[] = [
    ...(hasBaseline ? [{ id: 'baseline', kind: 'baseline' as const, roundIndex: 0 }] : []),
    ...sortedRounds.map((round) => ({ id: `round:${round.index}`, kind: 'round' as const, roundIndex: round.index })),
  ];
  const goalByMetric = new Map<OptimizationMetricKey, OptimizationDetail['goals'][number]>();
  for (const goal of detail.goals.filter((item) => goalMatchesTrendScope(item, scopeId))) {
    const key = resolveOptimizationMetricKey(goal.metric);
    if (key && !goalByMetric.has(key)) goalByMetric.set(key, goal);
  }

  const series = selectedMetricKeys
    .map((metricKey, index): TrendSeriesView | null => {
      const values = slots.map((slot) => {
        if (slot.kind === 'baseline') return readTrendMetricValue(baselineSource, scopeId, metricKey);
        const round = sortedRounds.find((item) => item.index === slot.roundIndex);
        return round ? readTrendMetricValue(round, scopeId, metricKey) : null;
      });
      if (!values.some((value) => value !== null)) return null;
      const betterIsLower = metricBetterIsLower(metricKey);
      let bestSlotIndex: number | undefined;
      values.forEach((value, slotIndex) => {
        if (value === null) return;
        const bestValue = bestSlotIndex === undefined ? null : values[bestSlotIndex];
        if (bestValue === null || bestValue === undefined || (betterIsLower ? value < bestValue : value > bestValue)) {
          bestSlotIndex = slotIndex;
        }
      });
      return {
        id: `${scopeId}:${metricKey}`,
        metricKey,
        labelKey: OPTIMIZATION_METRIC_LABEL_KEYS[metricKey],
        values,
        target: goalByMetric.get(metricKey)?.target,
        bestSlotIndex,
        style: TREND_SERIES_STYLES[index % TREND_SERIES_STYLES.length]!,
      };
    })
    .filter((item): item is TrendSeriesView => item !== null);
  const currentSlotIndex =
    slots.findIndex((slot) => slot.kind === 'round' && slot.roundIndex === detail.currentRound) >= 0
      ? slots.findIndex((slot) => slot.kind === 'round' && slot.roundIndex === detail.currentRound)
      : detail.currentRound <= 0 && hasBaseline
        ? 0
        : Math.max(0, slots.length - 1);

  return {
    scopeOptions,
    metricOptions,
    defaultScopeId,
    defaultMetricValue,
    slots,
    series,
    hasBaseline,
    currentSlotIndex,
    primaryBestSlotIndex: series[0]?.bestSlotIndex,
  };
}

function formatTrendScopeOption(option: TrendScopeOption, t: (key: TranslationKey) => string): string {
  if (option.kind === 'overall') return t('optimizations.detail.trend.scopeOverall');
  return formatTemplate(t('optimizations.detail.trend.scopeClass'), { label: option.label ?? '' });
}

function formatTrendMetricOption(option: TrendMetricOption, t: (key: TranslationKey) => string): string {
  return t(OPTIMIZATION_METRIC_LABEL_KEYS[option.value]);
}

function buildTrendLinePath(
  values: Array<number | null>,
  xForIndex: (index: number) => number,
  yToPx: (v: number) => number,
) {
  let path = '';
  let open = false;
  values.forEach((value, index) => {
    if (value === null) {
      open = false;
      return;
    }
    path += `${open ? 'L' : 'M'}${xForIndex(index).toFixed(2)},${yToPx(value).toFixed(2)} `;
    open = true;
  });
  return path.trim();
}

function deriveTrendScale(series: TrendSeriesView[]) {
  const values = series.flatMap((item) => [
    ...item.values.filter((value): value is number => value !== null),
    ...(typeof item.target === 'number' ? [item.target] : []),
  ]);
  if (values.length === 0) return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const ratioScale = series.every((item) => SCORE_TREND_METRICS.has(item.metricKey));
  const span = Math.max(0.0001, maxValue - minValue);
  const padding = ratioScale ? Math.max(0.02, span * 0.18) : Math.max(span * 0.18, maxValue * 0.03, 1);
  const min = ratioScale ? Math.max(0, minValue - padding) : Math.max(0, minValue - padding);
  const max = ratioScale ? Math.min(1, maxValue + padding) : maxValue + padding;
  const safeMax = max <= min ? min + (ratioScale ? 0.1 : 1) : max;
  const step = (safeMax - min) / 4;
  return { min, max: safeMax, ticks: Array.from({ length: 5 }, (_, i) => min + step * i) };
}

function formatTrendAxisValue(value: number, metricKey: OptimizationMetricKey | undefined): string {
  if (!metricKey) return value.toFixed(2);
  if (INTEGER_METRIC_KEYS.has(metricKey)) return formatThousand(Math.round(value));
  if (LATENCY_METRIC_KEYS.has(metricKey)) return formatThousand(Math.round(value));
  if (metricKey === 'costEstimate') return formatMetricCost(value);
  return value.toFixed(2);
}

function formatTrendBestSlotLabel(slot: TrendSlot | undefined, t: (key: TranslationKey) => string): string {
  if (!slot) return '—';
  if (slot.kind === 'baseline') return t('optimizations.detail.round.baseline');
  return `r${slot.roundIndex}`;
}

function BestPointer({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-[var(--status-canary-dot)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-white',
        className,
      )}
    >
      {label}
    </span>
  );
}

function PhaseTag({
  phase,
  currentRound,
  maxRounds,
}: {
  phase: 'analysis' | 'experiment' | 'paused' | 'finishing';
  currentRound: number;
  maxRounds: number;
}) {
  const { t } = useI18n();
  const phaseKey: TranslationKey =
    phase === 'analysis'
      ? 'optimizations.detail.control.phase.analysis'
      : phase === 'experiment'
        ? 'optimizations.detail.control.phase.experiment'
        : phase === 'paused'
          ? 'optimizations.detail.control.phase.paused'
          : 'optimizations.detail.control.phase.finishing';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11.5px]',
        optimizationTone.info.pill,
      )}
    >
      <span className={cn('size-1.5 animate-pulse rounded-full', optimizationTone.info.dot)} aria-hidden="true" />
      {formatTemplate(t('optimizations.detail.control.round'), {
        current: currentRound,
        total: maxRounds,
        phase: t(phaseKey),
      })}
    </span>
  );
}

function FailureBanner({ detail }: { detail: OptimizationDetail }) {
  const { t } = useI18n();
  if (detail.status !== 'failed') return null;
  if (!detail.summary && !detail.analysisFailureReason) return null;
  const reason = detail.summary?.reason ?? t('optimizations.detail.failureBanner.noDetail');
  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-[12.5px] text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-mono text-[11px] uppercase tracking-wide">{t('optimizations.detail.failureBanner.title')}</p>
        <p className="mt-1 break-words text-foreground">{reason}</p>
        {detail.analysisFailureReason && (
          <p className="mt-2 text-[11.5px] text-destructive/85">
            <span className="font-mono uppercase tracking-wide">
              {t('optimizations.detail.failureBanner.analysisLabel')}
            </span>
            : <span className="break-words text-foreground">{detail.analysisFailureReason}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function TimePoint({ date, includeDate }: { date: Date | null; includeDate: boolean }) {
  const { formatDate, formatTime } = useDateTimeFormatter();
  if (!date) return <span className="font-mono text-[10.5px] text-muted-foreground">—</span>;

  return (
    <span className="inline-flex items-baseline gap-1 font-mono tabular-nums">
      {includeDate && <span className="text-[10px] text-muted-foreground">{formatDate(date, { fallback: '—' })}</span>}
      <span className="text-[10.5px] font-semibold text-foreground sm:text-[11px]">
        {formatTime(date, { fallback: '—' })}
      </span>
    </span>
  );
}

function OptimizationTimingSubtitle({ detail, className }: { detail: OptimizationDetail; className?: string }) {
  const { formatDate } = useDateTimeFormatter();
  const startDate = parseDate(detail.startedAt ?? detail.createdAt);
  const finishedDate = parseDate(detail.finishedAt);
  const duration = getDurationParts(getOptimizationDurationSeconds(detail));
  const comparisonEndDate = finishedDate ?? (detail.status === 'running' ? new Date() : parseDate(detail.updatedAt));
  const includeDate = Boolean(
    startDate &&
    comparisonEndDate &&
    formatDate(startDate, { fallback: '' }) !== formatDate(comparisonEndDate, { fallback: '' }),
  );

  return (
    <div className={cn('flex w-fit max-w-full flex-col items-center gap-0.5', className)}>
      <div
        className={cn(
          'flex flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono tabular-nums',
          optimizationTone.positive.text,
        )}
      >
        <Hourglass className="size-3 self-center" aria-hidden="true" />
        {duration ? (
          <>
            {duration.map((part) => (
              <span key={part.label} className="inline-flex items-baseline gap-0.5">
                <span className="text-[10px] font-semibold leading-none tracking-normal sm:text-[11px]">
                  {part.pad ? String(part.value).padStart(2, '0') : part.value}
                </span>
                <span className="text-[8px] font-semibold sm:text-[8.5px]">{part.label}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="text-[10px] font-semibold leading-none tracking-normal sm:text-[11px]">—</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Play className={cn('size-2 fill-current stroke-current', optimizationTone.positive.text)} aria-hidden="true" />
        <TimePoint date={startDate} includeDate={includeDate} />
        <span className="font-mono text-[10.5px] text-muted-foreground/70 sm:text-[11px]" aria-hidden="true">
          →
        </span>
        <TimePoint date={finishedDate} includeDate={includeDate} />
      </div>
    </div>
  );
}

function OptimizationProgressCard({ detail }: { detail: OptimizationDetail }) {
  const { t } = useI18n();
  const control = detail.controlStrip;
  const maxRounds = Math.max(1, detail.maxRounds);
  const currentRound = Math.min(detail.currentRound, maxRounds);
  const percent = Math.min(100, (currentRound / maxRounds) * 100);
  const progressLabel = formatProgressLabel({
    value: currentRound,
    max: maxRounds,
    percent,
    fractionDigits: 1,
  });
  const goalScopes = uniqueValues(detail.goals.map((goal) => goal.scope)).map((scope) =>
    scope === OVERALL_TREND_SCOPE
      ? t('optimizations.detail.trend.scopeOverall')
      : formatTemplate(t('optimizations.detail.trend.scopeClass'), { label: scope }),
  );
  const goalMetrics = uniqueValues(detail.goals.map((goal) => goal.metric)).map((metric) =>
    formatMetricDisplayLabel(metric, t),
  );

  return (
    <section className="mb-4 rounded-lg border bg-card" data-testid="optimization-detail-progress">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-[13px] font-semibold">{t('optimizations.detail.progress.title')}</h2>
        {control ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <PhaseTag phase={control.phase} currentRound={control.currentRound} maxRounds={control.maxRounds} />
            <span className="font-mono text-[11.5px] text-muted-foreground">
              <b className="font-bold text-foreground">{formatThousand(control.samplesDone)}</b>
              <span className="ml-1">/ {formatThousand(control.samplesTotal)}</span>
            </span>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {formatTemplate(t('optimizations.detail.control.roundEta'), { value: control.roundRemaining })}
              <span className="px-1 text-muted-foreground/70" aria-hidden="true">
                ·
              </span>
              {formatTemplate(t('optimizations.detail.control.totalEta'), { value: control.totalRemaining })}
            </span>
          </div>
        ) : null}
      </div>
      <div className="space-y-3 p-5">
        <Progress value={currentRound} max={maxRounds} label={progressLabel} />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-[260px] max-w-full flex-col gap-1.5">
            <div className="grid gap-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-3">
              <span className="min-w-0">
                {t('optimizations.detail.progress.goalScope')}{' '}
                <span className="text-foreground">{goalScopes.join(' / ') || '—'}</span>
              </span>
              <span className="min-w-0">
                {t('optimizations.detail.progress.goalMetric')}{' '}
                <span className="text-foreground">{goalMetrics.join(' / ') || '—'}</span>
              </span>
              <span className="min-w-0">
                {t('optimizations.detail.progress.actualVsTarget')}{' '}
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-foreground">
                  {detail.goalProgress.length > 0
                    ? detail.goalProgress.map((goal, index) => {
                        const achieved = goal.achieved === 'hit' || goal.achieved === 'critical';
                        return (
                          <span key={`${goal.label}-${index}`} className="inline-flex items-center gap-1">
                            {index > 0 && (
                              <span className="text-muted-foreground" aria-hidden="true">
                                /
                              </span>
                            )}
                            <span>
                              {goal.currentText} vs {goal.targetText}
                            </span>
                            {achieved && (
                              <Check className={cn('size-3', optimizationTone.positive.text)} aria-hidden="true" />
                            )}
                          </span>
                        );
                      })
                    : '—'}
                </span>
              </span>
            </div>
          </div>
          <OptimizationTimingSubtitle detail={detail} className="ml-auto" />
        </div>
      </div>
    </section>
  );
}

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[12px] text-foreground">{children}</span>
    </div>
  );
}

function ScopeChip({ tone, label }: { tone: 'overall' | 'class'; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px]',
        tone === 'overall' ? 'border-border bg-secondary/60 text-foreground' : optimizationTone.warning.pill,
      )}
    >
      {label}
    </span>
  );
}

const STARTING_MODE_DESC_KEY: Record<OptimizationDetail['startingMode'], TranslationKey> = {
  from_experiment: 'optimizations.new.origin.experimentDesc',
  from_prompt_version: 'optimizations.new.origin.promptDesc',
  from_dataset_only: 'optimizations.new.origin.datasetDesc',
};

function ConfigSection({ detail }: { detail: OptimizationDetail }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const cfg = detail.experimentConfig;
  const iter = detail.iterationConfig;
  const { origin, originRef } = getOptimizationOriginDisplay(detail);
  const originLabel = t(OPTIMIZATION_ORIGIN_LABEL_KEYS[origin]);
  const originDesc = t(STARTING_MODE_DESC_KEY[detail.startingMode]);

  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-testid="optimization-detail-config">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="optimization-detail-config-body"
        aria-label={t(open ? 'optimizations.detail.config.collapse' : 'optimizations.detail.config.expand')}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/30',
          open && 'border-b',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-[13px] font-semibold">{t('optimizations.detail.config.title')}</h2>
          <TooltipProvider delayDuration={160}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span data-testid="optimization-detail-config-starting-mode" className="min-w-0">
                  <OriginBadge origin={origin} originRef={originRef} />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-[12px] leading-snug">
                <div className="font-semibold">{originLabel}</div>
                <div className="mt-0.5 text-muted-foreground">{originDesc}</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <ChevronDown
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id="optimization-detail-config-body">
          {cfg ? (
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn('inline-block h-2.5 w-[3px] rounded-sm', optimizationTone.info.fill)}
                  aria-hidden="true"
                />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('optimizations.detail.config.experiment')}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-y-2">
                <KvRow label={t('optimizations.detail.config.dataset')}>
                  <Link
                    href="#"
                    className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                  >
                    {cfg.datasetName}
                  </Link>
                </KvRow>
                <KvRow label={t('optimizations.detail.config.prompt')}>
                  <Link
                    href="#"
                    className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                  >
                    {cfg.promptName}
                  </Link>
                  <span className="text-muted-foreground"> · {cfg.promptVersion}</span>
                </KvRow>
                <KvRow label={t('optimizations.detail.config.model')}>
                  <Link
                    href="#"
                    className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                  >
                    {cfg.modelName}
                  </Link>
                </KvRow>
                <KvRow label={t('optimizations.detail.config.baselineExperiment')}>
                  <Link
                    href="#"
                    className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                  >
                    {cfg.baselineExperiment}
                  </Link>
                </KvRow>
                <KvRow label={t('optimizations.detail.config.temperature')}>{cfg.temperature.toFixed(1)}</KvRow>
                <KvRow label={t('optimizations.detail.config.concurrency')}>{cfg.concurrency}</KvRow>
                <KvRow label={t('optimizations.detail.config.rpm')}>{cfg.rpm}</KvRow>
                <KvRow label={t('optimizations.detail.config.tpm')}>{formatThousand(cfg.tpm)}</KvRow>
              </div>
            </div>
          ) : null}
          {iter ? (
            <div className="border-t border-dashed px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn('inline-block h-2.5 w-[3px] rounded-sm', optimizationTone.positive.fill)}
                  aria-hidden="true"
                />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('optimizations.detail.config.iter')}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-y-2">
                <div>
                  <KvRow label={t('optimizations.detail.config.goal')}>
                    <span className="flex flex-col gap-1 font-sans text-[12px] font-normal text-foreground">
                      {detail.goalsLines.map((line) => (
                        <span key={line.label} className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              line.tone === 'class' ? optimizationTone.warning.fill : optimizationTone.positive.fill,
                            )}
                            aria-hidden="true"
                          />
                          {line.label} <b className="font-semibold">{line.targetText}</b>
                        </span>
                      ))}
                    </span>
                  </KvRow>
                </div>
                <KvRow label={t('optimizations.detail.config.goalScope')}>
                  <span className="flex flex-wrap gap-1 font-sans">
                    {detail.goalScope.kind === 'overall' ? (
                      <ScopeChip tone="overall" label={t('optimizations.detail.config.scopeOverall')} />
                    ) : (
                      <>
                        <ScopeChip tone="overall" label={t('optimizations.detail.config.scopeOverall')} />
                        {(detail.goalScope.classes ?? []).map((cls) => (
                          <ScopeChip
                            key={cls}
                            tone="class"
                            label={formatTemplate(t('optimizations.detail.config.scopeClass'), { label: cls })}
                          />
                        ))}
                      </>
                    )}
                  </span>
                </KvRow>
                <KvRow label={t('optimizations.detail.config.analysisModel')}>
                  <Link
                    href="#"
                    className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                  >
                    {iter.analysisModel}
                  </Link>
                </KvRow>
                <KvRow label={t('optimizations.detail.config.strategy')}>{iter.strategy}</KvRow>
                <KvRow label={t('optimizations.detail.config.maxRounds')}>{iter.maxRounds}</KvRow>
                <KvRow label={t('optimizations.detail.config.noImprovement')}>
                  {formatTemplate(t('optimizations.detail.config.noImprovementValue'), {
                    value: iter.noImprovementStop,
                  })}
                </KvRow>
              </div>
              {detail.optimizationHint ? (
                <div className="mt-3 border-t border-dashed pt-3">
                  <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('optimizations.detail.config.optimizationHint')}
                  </div>
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
                    {detail.optimizationHint}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function TrendChart({ detail }: { detail: OptimizationDetail }) {
  const { t } = useI18n();
  const [selectedScopeId, setSelectedScopeId] = useState<TrendScopeId | null>(null);
  const [selectedMetricValue, setSelectedMetricValue] = useState<TrendMetricSelectorValue | null>(null);
  const trend = useMemo(
    () => buildTrendChartViewModel(detail, selectedScopeId, selectedMetricValue),
    [detail, selectedMetricValue, selectedScopeId],
  );
  const scopeValue =
    selectedScopeId && trend.scopeOptions.some((option) => option.id === selectedScopeId)
      ? selectedScopeId
      : trend.defaultScopeId;
  const metricValue =
    selectedMetricValue && trend.metricOptions.some((option) => option.value === selectedMetricValue)
      ? selectedMetricValue
      : trend.defaultMetricValue;
  const series = trend.series;
  if (series.length === 0) {
    return (
      <section className="rounded-lg border bg-card" data-testid="optimization-detail-trend">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-[13px] font-semibold">{t('optimizations.detail.trend.title')}</h2>
          <TrendChartControls
            scopeOptions={trend.scopeOptions}
            metricOptions={trend.metricOptions}
            scopeValue={scopeValue}
            metricValue={metricValue}
            onScopeChange={(value) => setSelectedScopeId(value as TrendScopeId)}
            onMetricChange={(value) => setSelectedMetricValue(value as TrendMetricSelectorValue)}
          />
        </div>
        <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
          {t('optimizations.detail.trend.empty')}
        </div>
      </section>
    );
  }

  const W = 720;
  const H = 220;
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxRoundIndex = Math.max(0, trend.slots.length - 1);
  const totalSlots = Math.max(1, maxRoundIndex);
  const xForIndex = (i: number) => padL + (i / totalSlots) * innerW;
  const scale = deriveTrendScale(series);
  const yToPx = (v: number) =>
    padT + (1 - (Math.max(scale.min, Math.min(scale.max, v)) - scale.min) / (scale.max - scale.min)) * innerH;
  const axisMetricKey = series[0]?.metricKey;
  const bestSlot = typeof trend.primaryBestSlotIndex === 'number' ? trend.slots[trend.primaryBestSlotIndex] : undefined;

  const bestPointerLabel = formatTemplate(t('optimizations.detail.trend.bestPointer'), {
    label: formatTrendBestSlotLabel(bestSlot, t),
  });

  return (
    <section className="rounded-lg border bg-card" data-testid="optimization-detail-trend">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-[13px] font-semibold">
          {t('optimizations.detail.trend.title')}
          <BestPointer label={bestPointerLabel} />
        </h2>
        <TrendChartControls
          scopeOptions={trend.scopeOptions}
          metricOptions={trend.metricOptions}
          scopeValue={scopeValue}
          metricValue={metricValue}
          onScopeChange={(value) => setSelectedScopeId(value as TrendScopeId)}
          onMetricChange={(value) => setSelectedMetricValue(value as TrendMetricSelectorValue)}
        />
      </div>
      <div className="px-4 py-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t('optimizations.detail.trend.title')}
          style={{ height: 220 }}
        >
          {scale.ticks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yToPx(tick)}
                y2={yToPx(tick)}
                stroke="currentColor"
                strokeDasharray="2 3"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="text-border opacity-70"
              />
              <text
                x={padL - 6}
                y={yToPx(tick) + 3}
                textAnchor="end"
                fill="currentColor"
                className="font-mono text-muted-foreground"
                style={{ fontSize: 9.5 }}
              >
                {formatTrendAxisValue(tick, axisMetricKey)}
              </text>
            </g>
          ))}

          {series.map((s) => {
            if (typeof s.target !== 'number') return null;
            return (
              <line
                key={`target-${s.id}`}
                x1={padL}
                x2={W - padR}
                y1={yToPx(s.target)}
                y2={yToPx(s.target)}
                stroke="currentColor"
                strokeDasharray="4 4"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
                className={cn(s.style.line, 'opacity-80')}
              />
            );
          })}

          {series.map((s) => {
            const path = buildTrendLinePath(s.values, xForIndex, yToPx);
            return (
              <path
                key={`line-${s.id}`}
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className={s.style.line}
              />
            );
          })}

          {series.map((s) =>
            s.values.map((v, i) => {
              if (v === null) return null;
              const isBest = i === s.bestSlotIndex;
              return (
                <circle
                  key={`pt-${s.id}-${i}`}
                  cx={xForIndex(i)}
                  cy={yToPx(v)}
                  r={isBest ? 5 : 3.5}
                  fill={isBest ? 'currentColor' : 'var(--card)'}
                  stroke="currentColor"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  className={s.style.line}
                />
              );
            }),
          )}

          {trend.slots.map((slot, i) => {
            const x = xForIndex(i);
            const isCurrent = i === trend.currentSlotIndex;
            const isBest = trend.primaryBestSlotIndex === i;
            const label =
              slot.kind === 'baseline'
                ? t('optimizations.detail.trend.baseline')
                : isCurrent
                  ? formatTemplate(t('optimizations.detail.trend.roundCurrent'), { index: slot.roundIndex })
                  : isBest
                    ? formatTemplate(t('optimizations.detail.trend.roundBest'), { index: slot.roundIndex })
                    : formatTemplate(t('optimizations.detail.trend.roundShort'), { index: slot.roundIndex });
            return (
              <g key={`x-${slot.id}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={padT + innerH}
                  y2={padT + innerH + 6}
                  stroke="currentColor"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="text-border"
                />
                <text
                  x={x}
                  y={padT + innerH + 18}
                  textAnchor="middle"
                  fill="currentColor"
                  className={cn('font-mono', isCurrent ? optimizationTone.info.text : 'text-muted-foreground')}
                  style={{ fontSize: 9.5, fontWeight: isCurrent ? 600 : 400 }}
                >
                  {label}
                </text>
              </g>
            );
          })}

          {typeof trend.primaryBestSlotIndex === 'number' && (
            <line
              x1={xForIndex(trend.primaryBestSlotIndex)}
              x2={xForIndex(trend.primaryBestSlotIndex)}
              y1={padT}
              y2={padT + innerH}
              stroke="currentColor"
              strokeDasharray="3 4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className={cn(optimizationTone.info.text, 'opacity-40')}
            />
          )}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-3 font-mono text-[11px] text-muted-foreground">
        {series.map((s) => (
          <span key={`lg-${s.id}`} className="inline-flex items-center gap-1.5">
            <span className={cn('inline-block h-[2px] w-4 rounded-[1px] bg-current', s.style.text)} />
            <span className={s.style.text}>{t(s.labelKey)}</span>
          </span>
        ))}
        <span className="text-muted-foreground">{t('optimizations.detail.trend.legendGoal')}</span>
      </div>
    </section>
  );
}

function TrendChartControls({
  scopeOptions,
  metricOptions,
  scopeValue,
  metricValue,
  onScopeChange,
  onMetricChange,
}: {
  scopeOptions: TrendScopeOption[];
  metricOptions: TrendMetricOption[];
  scopeValue: TrendScopeId;
  metricValue: TrendMetricSelectorValue | null;
  onScopeChange: (value: string) => void;
  onMetricChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Select value={scopeValue} onValueChange={onScopeChange}>
        <SelectTrigger
          className="h-8 w-[150px] rounded-md px-2 text-[12px]"
          aria-label={t('optimizations.detail.trend.scopeLabel')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {scopeOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {formatTrendScopeOption(option, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={metricValue ?? undefined} onValueChange={onMetricChange} disabled={metricOptions.length === 0}>
        <SelectTrigger
          className="h-8 w-[150px] rounded-md px-2 text-[12px]"
          aria-label={t('optimizations.detail.trend.metricLabel')}
        >
          <SelectValue placeholder={t('optimizations.detail.trend.metricEmpty')} />
        </SelectTrigger>
        <SelectContent>
          {metricOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {formatTrendMetricOption(option, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function RoundGoalChipRow({ chips }: { chips: OptimizationDetailRoundGoalChipDto[] | undefined }) {
  const safeChips = chips ?? [];
  if (!safeChips.length) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 font-mono text-[11px]"
      data-testid="round-goal-chips"
    >
      {safeChips.map((chip, i) => (
        <Fragment key={`${chip.label}-${i}`}>
          {i > 0 && (
            <span className="text-muted-foreground" aria-hidden>
              ·
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                'size-1.5 rounded-full',
                chip.achieved === 'hit' ? optimizationTone.positive.dot : 'bg-muted-foreground/40',
              )}
              aria-hidden
            />
            <span className="text-foreground">{chip.label}</span>
            <span className="text-muted-foreground">{chip.targetText}</span>
            <span className="text-muted-foreground">·</span>
            <span
              className={cn('font-semibold tabular-nums', chip.achieved === 'hit' && optimizationTone.positive.text)}
            >
              {chip.currentText}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function RoundStreamBlock({ stream }: { stream: RoundStream }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'min-h-[80px] space-y-2 rounded-md border px-3 py-2.5 font-mono text-[12px] leading-relaxed',
        optimizationTone.info.border,
        optimizationTone.info.bg,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className={cn('size-1.5 animate-pulse rounded-full', optimizationTone.info.dot)} aria-hidden="true" />
        {stream.stage}
      </div>
      <div className="space-y-2 text-foreground">
        {stream.segments.map((seg, idx) => (
          <p key={idx} className="leading-relaxed">
            {seg.kind !== 'plain' && (
              <span
                className={cn(
                  'mr-1 rounded px-1 font-mono text-[11px] font-semibold',
                  optimizationTone.info.bg,
                  optimizationTone.info.text,
                )}
              >
                {seg.kind === 'observation'
                  ? t('optimizations.detail.round.stream.observation')
                  : seg.kind === 'hypothesis'
                    ? t('optimizations.detail.round.stream.hypothesis')
                    : t('optimizations.detail.round.stream.rewrite')}
              </span>
            )}
            <span dangerouslySetInnerHTML={{ __html: seg.text }} />
            {idx === stream.segments.length - 1 && stream.showCursor && (
              <span
                className={cn('ml-1 inline-block h-3 w-1.5 align-[-2px] animate-pulse', optimizationTone.info.fill)}
                aria-hidden="true"
              />
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

function EmptyBlockPlaceholder({
  roundStatus,
  emptyKey,
}: {
  roundStatus: IterationRound['status'];
  emptyKey: 'errorPatterns' | 'improvementSuggestions' | 'promptDiff';
}) {
  const { t } = useI18n();
  const suffix = roundStatus === 'running' ? 'Running' : roundStatus === 'failed' ? 'Failed' : 'Empty';
  const key = (
    emptyKey === 'errorPatterns'
      ? `optimizations.detail.round.errorPatternsEmpty${suffix === 'Empty' ? '' : suffix}`
      : emptyKey === 'improvementSuggestions'
        ? `optimizations.detail.round.improvementSuggestionsEmpty${suffix === 'Empty' ? '' : suffix}`
        : `optimizations.detail.round.promptDiffEmpty${suffix === 'Empty' ? '' : suffix}`
  ) as TranslationKey;
  return <div className="border-t border-dashed px-4 py-4 text-center text-[12px] text-muted-foreground">{t(key)}</div>;
}

// Render the three steps in a fixed order: mirrors ph_runs.optimization_round_steps + service.STEP_ORDER
const ROUND_STEP_ORDER: OptimizationDetailRoundStepKindDto[] = ['error_analysis', 'generate_prompt', 'experiment'];

const STEP_LABEL_KEY: Record<OptimizationDetailRoundStepKindDto, TranslationKey> = {
  error_analysis: 'optimizations.detail.round.steps.errorAnalysis',
  generate_prompt: 'optimizations.detail.round.steps.generatePrompt',
  experiment: 'optimizations.detail.round.steps.experiment',
};

const STEP_STATUS_LABEL_KEY: Record<OptimizationDetailRoundStepStatusDto, TranslationKey> = {
  pending: 'optimizations.detail.round.steps.statusPending',
  running: 'optimizations.detail.round.steps.statusRunning',
  success: 'optimizations.detail.round.steps.statusSuccess',
  failed: 'optimizations.detail.round.steps.statusFailed',
  skipped: 'optimizations.detail.round.steps.statusSkipped',
};

function getStepByKind(
  steps: IterationRound['steps'] | undefined,
  kind: OptimizationDetailRoundStepKindDto,
): OptimizationDetailRoundStepDto | undefined {
  return (steps ?? []).find((s) => s.step === kind);
}

// Three-dot stepper: shows which step (error_analysis / generate_prompt / experiment) the current round is at;
// colors all go through theme tokens, covering light / dark / twilight / electric themes.
function RoundStepIndicator({ steps }: { steps: IterationRound['steps'] }) {
  const { t } = useI18n();
  return (
    <div
      className="inline-flex items-center gap-1.5"
      role="list"
      aria-label={t('optimizations.detail.round.steps.errorAnalysis')}
      data-testid="optimization-round-step-indicator"
    >
      {ROUND_STEP_ORDER.map((kind, idx) => {
        const step = getStepByKind(steps, kind);
        // Missing is treated as pending (not yet started)
        const status: OptimizationDetailRoundStepStatusDto = step?.status ?? 'pending';
        const labelKey = STEP_LABEL_KEY[kind];
        const statusKey = STEP_STATUS_LABEL_KEY[status];
        const tooltip = formatTemplate(t('optimizations.detail.round.steps.tooltipFormat'), {
          label: t(labelKey),
          status: t(statusKey),
        });

        const dotBase = 'flex size-[14px] items-center justify-center rounded-full border';
        let dotClass = '';
        if (status === 'running') {
          dotClass = cn(optimizationTone.info.border, optimizationTone.info.fill, 'animate-pulse');
        } else if (status === 'success') {
          dotClass = cn(optimizationTone.positive.border, optimizationTone.positive.fill);
        } else if (status === 'failed') {
          dotClass = cn(optimizationTone.danger.border, optimizationTone.danger.fill);
        } else if (status === 'skipped') {
          dotClass = cn(optimizationTone.muted.border, 'bg-card opacity-60');
        } else {
          // pending
          dotClass = cn(optimizationTone.muted.border, 'bg-card');
        }

        const showCheck = status === 'success';
        const showAlert = status === 'failed';

        return (
          <span key={kind} className="inline-flex items-center gap-1" role="listitem">
            <span title={tooltip} aria-label={tooltip} className={cn(dotBase, dotClass)}>
              {showCheck && <Check className="size-[10px] text-white" aria-hidden="true" />}
              {showAlert && <AlertTriangle className="size-[10px] text-white" aria-hidden="true" />}
            </span>
            <span className="text-[10.5px] font-medium text-muted-foreground">{t(labelKey)}</span>
            {idx < ROUND_STEP_ORDER.length - 1 && <span aria-hidden="true" className="block h-px w-3 bg-border" />}
          </span>
        );
      })}
    </div>
  );
}

function DatasetBaselineStepIndicator({ round }: { round: IterationRound }) {
  const { t } = useI18n();
  const generateStep = getStepByKind(round.steps, 'generate_prompt');
  const experimentStatus: OptimizationDetailRoundStepStatusDto =
    round.experimentResult?.experimentStatus === 'success'
      ? 'success'
      : round.experimentResult?.experimentStatus === 'failed'
        ? 'failed'
        : round.experimentResult?.experimentStatus === 'running'
          ? 'running'
          : 'pending';
  const steps: Array<{
    key: string;
    labelKey: TranslationKey;
    status: OptimizationDetailRoundStepStatusDto;
  }> = [
    {
      key: 'generate_first_prompt',
      labelKey: 'optimizations.detail.round.steps.generateFirstPrompt',
      status: generateStep?.status ?? (round.promptDiff ? 'success' : 'pending'),
    },
    {
      key: 'baseline_experiment',
      labelKey: 'optimizations.detail.round.steps.baselineExperiment',
      status: experimentStatus,
    },
  ];

  return (
    <div
      className="inline-flex items-center gap-1.5"
      role="list"
      aria-label={t('optimizations.detail.round.datasetBaselineKind')}
      data-testid="optimization-baseline-step-indicator"
    >
      {steps.map((step, idx) => {
        const statusKey = STEP_STATUS_LABEL_KEY[step.status];
        const tooltip = formatTemplate(t('optimizations.detail.round.steps.tooltipFormat'), {
          label: t(step.labelKey),
          status: t(statusKey),
        });
        const dotBase = 'flex size-[14px] items-center justify-center rounded-full border';
        const dotClass =
          step.status === 'running'
            ? cn(optimizationTone.info.border, optimizationTone.info.fill, 'animate-pulse')
            : step.status === 'success'
              ? cn(optimizationTone.positive.border, optimizationTone.positive.fill)
              : step.status === 'failed'
                ? cn(optimizationTone.danger.border, optimizationTone.danger.fill)
                : cn(optimizationTone.muted.border, 'bg-card');

        return (
          <span key={step.key} className="inline-flex items-center gap-1" role="listitem">
            <span title={tooltip} aria-label={tooltip} className={cn(dotBase, dotClass)}>
              {step.status === 'success' && <Check className="size-[10px] text-white" aria-hidden="true" />}
              {step.status === 'failed' && <AlertTriangle className="size-[10px] text-white" aria-hidden="true" />}
            </span>
            <span className="text-[10.5px] font-medium text-muted-foreground">{t(step.labelKey)}</span>
            {idx < steps.length - 1 && <span aria-hidden="true" className="block h-px w-3 bg-border" />}
          </span>
        );
      })}
    </div>
  );
}

// Step error info bar: only shown when the step is failed and has an errorMessage.
// Reuse optimizationTone.danger, which auto-adapts to all 4 themes.
function StepErrorBanner({ step }: { step: OptimizationDetailRoundStepDto | undefined }) {
  const { t } = useI18n();
  if (!step || step.status !== 'failed' || !step.errorMessage) return null;
  return (
    <div
      className={cn('border-t border-dashed px-4 py-2', optimizationTone.danger.bg, optimizationTone.danger.border)}
      data-testid={`optimization-round-step-error-${step.step}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', optimizationTone.danger.text)} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className={cn('text-[11.5px] font-semibold', optimizationTone.danger.text)}>
            {t('optimizations.detail.round.steps.errorBannerTitle')}
          </div>
          {step.errorClass && (
            <div className="font-mono text-[10.5px] text-muted-foreground">
              {t('optimizations.detail.round.steps.errorClassLabel')}: {step.errorClass}
            </div>
          )}
          <div className="break-words text-[11.5px] leading-snug text-foreground">{step.errorMessage}</div>
        </div>
      </div>
    </div>
  );
}

function BaselineMetricStrip({ metrics }: { metrics: NonNullable<OptimizationDetail['baseline']>['metrics'] }) {
  const { t } = useI18n();
  if (metrics.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-3" data-testid="optimization-baseline-metrics">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-md border bg-secondary/25 px-3 py-2">
          <div className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {formatMetricDisplayLabel(metric.label, t)}
          </div>
          <div className="mt-1 font-mono text-[18px] font-semibold tabular-nums text-foreground">
            {formatMetricDisplayValue(metric.label, metric.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function BaselinePromptPreviewBlock({
  promptPreview,
  open,
  onToggle,
  controlsId,
}: {
  promptPreview: string;
  open: boolean;
  onToggle: () => void;
  controlsId: string;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-md border" data-testid="optimization-baseline-prompt">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controlsId}
        aria-label={t(
          open
            ? 'optimizations.detail.round.baselinePromptCollapse'
            : 'optimizations.detail.round.baselinePromptExpand',
        )}
        className={cn(
          'flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/30',
          open && 'border-b',
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <ChevronRight
            className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          <FileText className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{t('optimizations.detail.round.datasetBaselinePromptTitle')}</span>
        </span>
      </button>
      {open && (
        <pre
          id={controlsId}
          className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words bg-muted/25 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground"
        >
          {promptPreview}
        </pre>
      )}
    </div>
  );
}

function DatasetBaselineBlock({
  detail,
  round,
  promptOpen,
  onPromptToggle,
}: {
  detail: OptimizationDetail;
  round: IterationRound;
  promptOpen: boolean;
  onPromptToggle: () => void;
}) {
  const { t } = useI18n();
  const promptText = round.promptDiff?.toText?.trim();
  return (
    <div className="border-t border-dashed px-4 py-3" data-testid="optimization-dataset-baseline-context">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FileText className="size-3" aria-hidden="true" />
        {t('optimizations.detail.round.datasetBaselineTitle')}
      </div>
      <div className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
        {formatTemplate(t('optimizations.detail.round.datasetBaselineMeta'), {
          dataset: detail.datasetName,
          samples: formatThousand(detail.datasetSamples),
          model: detail.analysisModelName,
        })}
      </div>
      {round.summaryFallback && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-foreground">{round.summaryFallback}</p>
      )}
      {promptText && (
        <div className="mt-3">
          <BaselinePromptPreviewBlock
            promptPreview={promptText}
            open={promptOpen}
            onToggle={onPromptToggle}
            controlsId={`optimization-round-${round.index}-baseline-prompt-preview`}
          />
        </div>
      )}
    </div>
  );
}

function ErrorPatternBlock({
  patterns,
  roundStatus,
  open,
  onToggle,
  step,
}: {
  patterns: IterationRound['errorPatterns'];
  roundStatus: IterationRound['status'];
  open: boolean;
  onToggle: () => void;
  step: OptimizationDetailRoundStepDto | undefined;
}) {
  const { t } = useI18n();
  const hasData = Array.isArray(patterns) && patterns.length > 0;
  return (
    <div className="border-t border-dashed" data-testid="optimization-round-error-patterns">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/30"
      >
        <span className="inline-flex items-center gap-2">
          <ChevronRight
            className={cn('size-3 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          {t('optimizations.detail.round.errorTitle')}
        </span>
        <span className="rounded-full border bg-secondary px-1.5 font-mono text-[10.5px] text-muted-foreground">
          {hasData
            ? formatTemplate(t('optimizations.detail.round.errorTag'), { count: patterns!.length })
            : t('optimizations.detail.round.emptyTag')}
        </span>
      </button>
      {open && !hasData && <EmptyBlockPlaceholder roundStatus={roundStatus} emptyKey="errorPatterns" />}
      {open && hasData && (
        <div className="space-y-1.5 border-t border-dashed px-4 py-3">
          {patterns!.map((p, idx) => (
            <div
              key={idx}
              className={cn(
                'grid items-center gap-2.5 rounded border px-2 py-1.5 [grid-template-columns:42px_minmax(0,1fr)_auto]',
                optimizationTone.danger.border,
                optimizationTone.danger.bg,
              )}
            >
              <div
                className={cn('text-right font-mono text-[13px] font-bold tabular-nums', optimizationTone.danger.text)}
              >
                {p.percent}%
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium leading-snug text-foreground">{p.title}</div>
                <div className="text-[11px] leading-snug text-muted-foreground">{p.detail}</div>
              </div>
              <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {p.count.hit} / {p.count.total}
              </div>
            </div>
          ))}
        </div>
      )}
      <StepErrorBanner step={step} />
    </div>
  );
}

function RoundJumpButtons({
  promptId,
  promptVersionId,
  experimentId,
}: {
  promptId: string | null;
  promptVersionId: string | null | undefined;
  experimentId: string | null | undefined;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const hasPromptJump = Boolean(promptId && promptVersionId);
  const hasExperimentJump = Boolean(experimentId);
  if (!hasPromptJump && !hasExperimentJump) return null;

  return (
    <span className="inline-flex items-center gap-0.5">
      {hasPromptJump && (
        <TableActionIconButton
          label={t('optimizations.detail.round.openPromptTooltip')}
          onClick={(event) => {
            event.stopPropagation();
            router.push(`/prompts/${promptId}?version=${promptVersionId}`);
          }}
        >
          <FileText className="size-3.5" aria-hidden="true" />
        </TableActionIconButton>
      )}
      {hasExperimentJump && (
        <TableActionIconButton
          label={t('optimizations.detail.round.openExperimentTooltip')}
          onClick={(event) => {
            event.stopPropagation();
            router.push(`/experiments/${experimentId}`);
          }}
        >
          <FlaskConical className="size-3.5" aria-hidden="true" />
        </TableActionIconButton>
      )}
    </span>
  );
}

// The failure banner for the error-analysis step is shown by ErrorPatternBlock; do not duplicate here (suggested improvements and error analysis share the same LLM).
function ImprovementSuggestionsBlock({
  suggestions,
  roundStatus,
  open,
  onToggle,
}: {
  suggestions: IterationRound['improvementSuggestions'];
  roundStatus: IterationRound['status'];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const hasData = Array.isArray(suggestions) && suggestions.length > 0;
  const toneForPriority = (priority: OptimizationDetailRoundImprovementPriorityDto | undefined) => {
    if (priority === 'high') return optimizationTone.danger;
    if (priority === 'medium') return optimizationTone.info;
    if (priority === 'low') return optimizationTone.muted;
    return optimizationTone.muted;
  };
  const priorityLabel = (priority: OptimizationDetailRoundImprovementPriorityDto | undefined) => {
    if (priority === 'high') return t('optimizations.detail.round.improvementPriority.high');
    if (priority === 'medium') return t('optimizations.detail.round.improvementPriority.medium');
    if (priority === 'low') return t('optimizations.detail.round.improvementPriority.low');
    return null;
  };
  return (
    <div className="border-t border-dashed" data-testid="optimization-round-improvement-suggestions">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/30"
      >
        <span className="inline-flex items-center gap-2">
          <ChevronRight
            className={cn('size-3 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          {t('optimizations.detail.round.improvementTitle')}
        </span>
        <span className="rounded-full border bg-secondary px-1.5 font-mono text-[10.5px] text-muted-foreground">
          {hasData
            ? formatTemplate(t('optimizations.detail.round.improvementTag'), {
                count: suggestions!.length,
              })
            : t('optimizations.detail.round.emptyTag')}
        </span>
      </button>
      {open && !hasData && <EmptyBlockPlaceholder roundStatus={roundStatus} emptyKey="improvementSuggestions" />}
      {open && hasData && (
        <div className="space-y-1.5 border-t border-dashed px-4 py-3">
          {suggestions!.map((s, idx) => {
            const tone = toneForPriority(s.priority);
            const label = priorityLabel(s.priority);
            return (
              <div
                key={idx}
                className={cn(
                  'grid items-start gap-2.5 rounded border px-2 py-1.5 [grid-template-columns:auto_minmax(0,1fr)]',
                  tone.border,
                  tone.bg,
                )}
              >
                <div className="flex flex-col items-start gap-1 pt-[2px]">
                  {label && (
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                        tone.pill,
                      )}
                    >
                      {label}
                    </span>
                  )}
                  <span className="rounded border bg-secondary px-1.5 font-mono text-[10px] text-muted-foreground">
                    {s.section}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium leading-snug text-foreground">{s.title}</div>
                  {s.detail && <div className="text-[11px] leading-snug text-muted-foreground">{s.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PromptDiffBlock({
  diff,
  roundStatus,
  open,
  onToggle,
  step,
}: {
  diff: IterationRound['promptDiff'];
  roundStatus: IterationRound['status'];
  open: boolean;
  onToggle: () => void;
  step: OptimizationDetailRoundStepDto | undefined;
}) {
  const { t } = useI18n();
  const hasData = Boolean(diff);
  return (
    <div className="border-t border-dashed" data-testid="optimization-round-prompt-diff">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/30"
      >
        <span className="inline-flex items-center gap-2">
          <ChevronRight
            className={cn('size-3 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          {t('optimizations.detail.round.diffTitle')}
        </span>
        <span className="rounded-full border bg-secondary px-1.5 font-mono text-[10.5px] text-muted-foreground">
          {hasData
            ? formatTemplate(t('optimizations.detail.round.diffTag'), {
                from: diff!.from,
                to: diff!.to,
              })
            : t('optimizations.detail.round.emptyTag')}
        </span>
      </button>
      {open && !hasData && <EmptyBlockPlaceholder roundStatus={roundStatus} emptyKey="promptDiff" />}
      {open && hasData && (
        <div className="border-t border-dashed px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 pb-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded border bg-destructive/10 px-1.5 py-0.5 text-destructive">
              - {t('optimizations.detail.round.diffRemoved')}
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-[var(--status-running-bd)] bg-[var(--status-running-bg)] px-1.5 py-0.5 text-[var(--status-running-fg)]">
              + {t('optimizations.detail.round.diffAdded')}
            </span>
          </div>
          <PromptDiffSplitView
            fromLabel={diff!.from}
            toLabel={diff!.to}
            fromText={diff!.fromText}
            toText={diff!.toText}
          />
        </div>
      )}
      <StepErrorBanner step={step} />
    </div>
  );
}

function MetricValue({
  value,
  comparison,
  showComparison,
  muted,
}: {
  value: string;
  comparison?: MetricComparison;
  showComparison: boolean;
  muted?: boolean;
}) {
  const showDelta = showComparison && comparison;
  return (
    <span className="inline-flex min-w-0 items-baseline justify-end gap-1.5">
      <span className={cn(muted && 'text-muted-foreground')}>{value}</span>
      {showDelta && (
        <span
          className={cn(
            'text-[10.5px] font-semibold leading-none',
            comparison.tone === 'ok' && optimizationTone.positive.text,
            comparison.tone === 'bad' && optimizationTone.danger.text,
            comparison.tone === 'neutral' && 'text-muted-foreground',
          )}
        >
          {formatDelta(comparison.value)}
        </span>
      )}
    </span>
  );
}

function ExperimentResultBlock({
  result,
  showMetricComparisons,
}: {
  result: RoundExperimentResult;
  showMetricComparisons: boolean;
}) {
  const { t } = useI18n();
  const total = result.samplesTotal || 1;
  const percent = Math.min(100, (result.samplesDone / total) * 100);
  const progressLabel = formatProgressLabel({ value: result.samplesDone, max: Math.max(1, total), percent });
  const okWidth = result.correct && total ? (result.correct / total) * 100 : 0;
  const badWidth = result.wrong && total ? (result.wrong / total) * 100 : 0;
  const correctLabel = formatTemplate(t('optimizations.detail.round.correctLabel'), {
    count: formatThousand(result.correct),
  });
  const wrongLabel = formatTemplate(t('optimizations.detail.round.wrongLabel'), {
    count: formatThousand(result.wrong),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between font-mono text-[11.5px] text-muted-foreground">
          <span>
            <b className="font-bold text-foreground">{formatThousand(result.samplesDone)}</b> /{' '}
            {formatThousand(result.samplesTotal)}
          </span>
          <span className={cn('font-bold', optimizationTone.positive.text)}>{percent.toFixed(0)} %</span>
        </div>
        <Progress value={result.samplesDone} max={Math.max(1, total)} label={progressLabel} />
        <TooltipProvider delayDuration={160}>
          <div className="flex h-5 overflow-hidden rounded border">
            {okWidth > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap px-1.5 font-mono text-[10.5px]',
                      optimizationTone.positive.bg,
                      optimizationTone.positive.text,
                    )}
                    style={{ width: `${okWidth}%` }}
                    aria-label={correctLabel}
                  >
                    {correctLabel}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{correctLabel}</TooltipContent>
              </Tooltip>
            )}
            {badWidth > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap px-1.5 font-mono text-[10.5px]',
                      optimizationTone.danger.bg,
                      optimizationTone.danger.text,
                    )}
                    style={{ width: `${badWidth}%` }}
                    aria-label={wrongLabel}
                  >
                    {wrongLabel}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{wrongLabel}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
          <span>{formatTemplate(t('optimizations.detail.round.timing'), { elapsed: result.elapsed })}</span>
          <span>
            {result.tokenSummary} · {result.costLabel}
          </span>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full font-mono text-[12px] tabular-nums">
          <thead>
            <tr className="bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5">{t('optimizations.detail.round.cls.category')}</th>
              <th className="px-2 py-1.5 text-right">{t('optimizations.detail.round.cls.accuracy')}</th>
              <th className="px-2 py-1.5 text-right">{t('optimizations.detail.round.cls.precision')}</th>
              <th className="px-2 py-1.5 text-right">{t('optimizations.detail.round.cls.recall')}</th>
            </tr>
          </thead>
          <tbody>
            {result.overallRow && (
              <tr className="border-b-2 border-foreground/40 bg-muted/40 font-semibold" data-testid="round-overall-row">
                <td className="px-2 py-1.5 font-sans text-[12px] text-foreground">
                  {t('optimizations.detail.round.cls.overall')}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <MetricValue
                    value={result.overallRow.accuracy.toFixed(3)}
                    comparison={result.overallRow.deltas?.accuracy}
                    showComparison={showMetricComparisons}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <MetricValue
                    value={result.overallRow.precision.toFixed(3)}
                    comparison={result.overallRow.deltas?.precision}
                    showComparison={showMetricComparisons}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <MetricValue
                    value={result.overallRow.recall.toFixed(3)}
                    comparison={result.overallRow.deltas?.recall}
                    showComparison={showMetricComparisons}
                  />
                </td>
              </tr>
            )}
            {result.classRows.map((row) => (
              <tr key={row.label} className="border-t">
                <td className="px-2 py-1.5 font-sans text-[12px] font-medium text-foreground">{row.label}</td>
                <td className="px-2 py-1.5 text-right">
                  <MetricValue value="—" showComparison={false} muted />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <MetricValue
                    value={row.precision.toFixed(3)}
                    comparison={row.deltas?.precision}
                    showComparison={showMetricComparisons}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <MetricValue
                    value={row.recall.toFixed(3)}
                    comparison={row.deltas?.recall}
                    showComparison={showMetricComparisons}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TimelineRoundCard({
  round,
  detail,
  defaultOpen,
  promptId,
  showMetricComparisons,
}: {
  round: IterationRound;
  detail: OptimizationDetail;
  defaultOpen: boolean;
  promptId: string | null;
  showMetricComparisons: boolean;
}) {
  const { t } = useI18n();
  const { formatTime } = useDateTimeFormatter();
  const [errorOpen, setErrorOpen] = useState(defaultOpen);
  const [suggestionsOpen, setSuggestionsOpen] = useState(defaultOpen);
  const [diffOpen, setDiffOpen] = useState(defaultOpen);
  const [baselinePromptOpen, setBaselinePromptOpen] = useState(defaultOpen);

  const isCurrent = round.status === 'running';
  const isFailed = round.status === 'failed';
  const isBest = round.isBest;
  const isCollapsed = round.collapsed;
  const isBaselineRound = round.isBaseline === true;

  const errorAnalysisStep = getStepByKind(round.steps, 'error_analysis');
  const generatePromptStep = getStepByKind(round.steps, 'generate_prompt');
  const experimentStep = getStepByKind(round.steps, 'experiment');
  const title = isBaselineRound
    ? t('optimizations.detail.round.baseline')
    : formatTemplate(t('optimizations.detail.round.label'), { index: round.index });
  const kindLabel = isBaselineRound ? t('optimizations.detail.round.datasetBaselineKind') : round.kindLabel;

  const dotClass = cn(
    'absolute -left-7 top-4 z-10 inline-flex size-[18px] items-center justify-center rounded-full border-2 bg-card',
    isBest
      ? cn('text-white border-[var(--status-canary-dot)]', optimizationTone.info.fill)
      : isCurrent
        ? 'border-[var(--status-canary-dot)] ring-[3px] ring-[var(--status-canary-dot)]/30'
        : round.status === 'failed'
          ? 'border-destructive'
          : 'border-[var(--status-running-dot)]',
  );

  const footMain =
    round.totalElapsed || round.totalCost
      ? `${round.totalElapsed ? formatTemplate(t('optimizations.detail.round.timing'), { elapsed: round.totalElapsed }) + ' · ' : ''}${
          round.totalCost ?? ''
        }`
      : round.startedAt
        ? formatTemplate(t('optimizations.detail.round.startedAt'), {
            at: formatTime(round.startedAt, { fallback: '—' }),
          })
        : '';

  return (
    <article className="relative pl-8" data-testid={`optimization-round-${round.index}`}>
      <div aria-hidden="true" className="absolute bottom-0 left-1 top-0 w-[2px] bg-border" />
      <span className={dotClass} aria-hidden="true">
        {isBest && <span className="text-[10px] font-bold leading-none">★</span>}
      </span>
      <div
        className={cn(
          'overflow-hidden rounded-lg border bg-card shadow-xs',
          isCurrent && 'border-[color-mix(in_oklab,var(--status-canary-dot)_40%,var(--border))]',
          isBest && 'border-[color-mix(in_oklab,var(--status-canary-dot)_50%,var(--border))]',
        )}
      >
        <div className="grid items-center gap-4 border-b bg-secondary/30 px-4 py-2.5 [grid-template-columns:minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-[14px] font-bold text-foreground">{title}</span>
            <RoundJumpButtons
              promptId={promptId}
              promptVersionId={round.promptVersionId}
              experimentId={round.experimentId}
            />
            <span className="font-mono text-[11px] text-muted-foreground">{kindLabel}</span>
            {isCurrent && !isFailed && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10.5px]',
                  optimizationTone.info.pill,
                )}
              >
                <span
                  className={cn('size-1 animate-pulse rounded-full', optimizationTone.info.dot)}
                  aria-hidden="true"
                />
                {t('optimizations.detail.round.live')}
              </span>
            )}
            {isFailed && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10.5px]',
                  optimizationTone.danger.pill,
                )}
                data-testid={`optimization-round-${round.index}-status-failed`}
              >
                <span className={cn('size-1 rounded-full', optimizationTone.danger.dot)} aria-hidden="true" />
                {t('optimizations.detail.round.statusFailed')}
              </span>
            )}
            {round.autoPatched && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10.5px]',
                  optimizationTone.warning.pill,
                )}
                data-testid={`optimization-round-${round.index}-auto-patched`}
                title={formatTemplate(t('optimizations.detail.round.autoPatchedTooltip'), {
                  vars: (round.patchedVariables ?? []).join(', '),
                })}
              >
                <Wrench className="size-3" aria-hidden="true" />
                {t('optimizations.detail.round.autoPatchedBadge')}
              </span>
            )}
            {isBest && <BestPointer label={t('optimizations.detail.round.bestPointer')} />}
            {isBaselineRound ? (
              <DatasetBaselineStepIndicator round={round} />
            ) : (
              (round.steps?.length ?? 0) > 0 && <RoundStepIndicator steps={round.steps} />
            )}
          </div>
          <RoundGoalChipRow chips={round.goalChips} />
        </div>

        {!isCollapsed && (
          <div className="px-4 py-3">
            {round.experimentResult ? (
              <div className="space-y-2">
                <h3 className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <FlaskConical className="size-3" aria-hidden="true" />
                  {t('optimizations.detail.round.experimentResult')}
                  <span className="font-mono text-[10.5px] font-medium normal-case text-muted-foreground">
                    {round.experimentId ? (
                      <Link
                        href={`/experiments/${round.experimentId}`}
                        className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                      >
                        {round.experimentResult.experimentRef}
                      </Link>
                    ) : (
                      <span>{round.experimentResult.experimentRef}</span>
                    )}
                    {' · '}
                    {round.experimentResult.experimentStatus === 'success' ? (
                      <span>{t('optimizations.detail.round.experimentDone')}</span>
                    ) : round.experimentResult.experimentStatus === 'failed' ? (
                      <span className={cn('font-semibold', optimizationTone.danger.text)}>
                        {t('optimizations.detail.round.experimentFailed')}
                      </span>
                    ) : (
                      <span>{t('optimizations.detail.round.experimentRunning')}</span>
                    )}
                  </span>
                </h3>
                <ExperimentResultBlock result={round.experimentResult} showMetricComparisons={showMetricComparisons} />
                <StepErrorBanner step={experimentStep} />
              </div>
            ) : experimentStep && experimentStep.status === 'failed' ? (
              // When the experiment step fails but the experiments row has not produced ExperimentResult data, still surface the error
              <div className="space-y-2">
                <h3 className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <FlaskConical className="size-3" aria-hidden="true" />
                  {t('optimizations.detail.round.experimentResult')}
                  <span className={cn('font-semibold', optimizationTone.danger.text)}>
                    {t('optimizations.detail.round.experimentFailed')}
                  </span>
                </h3>
                <StepErrorBanner step={experimentStep} />
              </div>
            ) : round.stream ? (
              <div className="space-y-2">
                <h3 className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="size-3" aria-hidden="true" />
                  {t('optimizations.detail.round.streamHeader')}
                  <span className="font-mono text-[10.5px] font-medium normal-case text-muted-foreground">
                    {round.stream.analysisModel}
                  </span>
                </h3>
                <RoundStreamBlock stream={round.stream} />
              </div>
            ) : round.summaryFallback ? (
              <div className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('optimizations.detail.round.summary')}
                </h3>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  {round.summaryFallback}
                  <span className="ml-1">
                    ·{' '}
                    <Link
                      href="#"
                      className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                    >
                      {t('optimizations.detail.round.expandSummary')}
                    </Link>
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        )}

        {isBaselineRound ? (
          <DatasetBaselineBlock
            detail={detail}
            round={round}
            promptOpen={baselinePromptOpen}
            onPromptToggle={() => setBaselinePromptOpen((p) => !p)}
          />
        ) : (
          <>
            <ErrorPatternBlock
              patterns={round.errorPatterns}
              roundStatus={round.status}
              open={errorOpen}
              onToggle={() => setErrorOpen((p) => !p)}
              step={errorAnalysisStep}
            />
            <ImprovementSuggestionsBlock
              suggestions={round.improvementSuggestions}
              roundStatus={round.status}
              open={suggestionsOpen}
              onToggle={() => setSuggestionsOpen((p) => !p)}
            />
          </>
        )}
        {!isBaselineRound && (
          <PromptDiffBlock
            diff={round.promptDiff}
            roundStatus={round.status}
            open={diffOpen}
            onToggle={() => setDiffOpen((p) => !p)}
            step={generatePromptStep}
          />
        )}

        {(round.startedAt || round.totalElapsed || round.totalCost) && footMain && (
          <div className="flex flex-wrap items-center gap-2 border-t bg-secondary/20 px-4 py-2 font-mono text-[11px] text-muted-foreground">
            <span>{footMain}</span>
          </div>
        )}
      </div>
    </article>
  );
}

function BaselineRow({ detail, defaultPromptOpen }: { detail: OptimizationDetail; defaultPromptOpen: boolean }) {
  const { t } = useI18n();
  const [promptOpen, setPromptOpen] = useState(defaultPromptOpen);
  const baseline = detail.baseline;
  if (!baseline) return null;
  const promptPreview = baseline.promptPreview?.trim() ?? '';
  const hasBody = Boolean(baseline.experimentResult || baseline.metrics.length > 0 || promptPreview);
  return (
    <article className="relative pl-8" data-testid="optimization-baseline">
      <div aria-hidden="true" className="absolute left-1 top-0 h-10 w-[2px] bg-border" />
      <span
        className="absolute -left-7 top-4 z-10 inline-flex size-[18px] items-center justify-center rounded-full border-2 border-border bg-card"
        aria-hidden="true"
      />
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className={cn('flex items-center gap-4 px-4 py-2.5', hasBody && 'border-b bg-secondary/30')}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-[14px] font-bold text-muted-foreground">
              {t('optimizations.detail.round.baseline')}
            </span>
            <RoundJumpButtons
              promptId={detail.promptId}
              promptVersionId={detail.baseVersionId}
              experimentId={detail.sourceExperimentId}
            />
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatTemplate(t('optimizations.detail.round.baselineFrom'), {
                experiment: baseline.baselineExperiment,
                version: baseline.promptVersion,
              })}
            </span>
          </div>
        </div>
        {hasBody && (
          <div className="space-y-4 px-4 py-3">
            {baseline.experimentResult ? (
              <div className="space-y-2">
                <h3 className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <FlaskConical className="size-3" aria-hidden="true" />
                  {t('optimizations.detail.round.experimentResult')}
                  <span className="font-mono text-[10.5px] font-medium normal-case text-muted-foreground">
                    {baseline.experimentResult.experimentRef}
                    {' · '}
                    {baseline.experimentResult.experimentStatus === 'success' ? (
                      <span>{t('optimizations.detail.round.experimentDone')}</span>
                    ) : baseline.experimentResult.experimentStatus === 'failed' ? (
                      <span className={cn('font-semibold', optimizationTone.danger.text)}>
                        {t('optimizations.detail.round.experimentFailed')}
                      </span>
                    ) : (
                      <span>{t('optimizations.detail.round.experimentRunning')}</span>
                    )}
                  </span>
                </h3>
                <ExperimentResultBlock result={baseline.experimentResult} showMetricComparisons={false} />
              </div>
            ) : (
              <BaselineMetricStrip metrics={baseline.metrics} />
            )}
            {promptPreview && (
              <BaselinePromptPreviewBlock
                promptPreview={promptPreview}
                open={promptOpen}
                onToggle={() => setPromptOpen((p) => !p)}
                controlsId="optimization-baseline-prompt-preview"
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function BestVersionCard({ detail }: { detail: OptimizationDetail }) {
  const { t } = useI18n();
  const best = detail.bestVersion;
  const promptId = detail.promptId;
  const generatedAtLabel =
    best?.generatedAtRoundLabel === 'baseline'
      ? t('optimizations.detail.round.baseline')
      : typeof best?.generatedAtRoundIndex === 'number'
        ? detail.startingMode === 'from_dataset_only' && best.generatedAtRoundIndex === 0
          ? t('optimizations.detail.round.baseline')
          : formatTemplate(t('optimizations.detail.round.label'), { index: best.generatedAtRoundIndex })
        : (best?.generatedAtRoundLabel ?? '—');
  return (
    <section className="rounded-lg border bg-card" data-testid="optimization-detail-best">
      <div className="border-b px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{t('optimizations.detail.best.title')}</h3>
      </div>
      {best ? (
        <div className="px-4 py-3 font-mono text-[12px] leading-7">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{t('optimizations.detail.best.prompt')}</span>
            <span className="inline-flex items-center gap-1">
              {promptId && best.promptVersionId ? (
                <Link
                  href={`/prompts/${promptId}?version=${best.promptVersionId}`}
                  className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                >
                  {best.promptRef}
                </Link>
              ) : (
                <span>{best.promptRef}</span>
              )}
              <RoundJumpButtons promptId={promptId} promptVersionId={best.promptVersionId} experimentId={null} />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{t('optimizations.detail.best.generatedAt')}</span>
            <span>{generatedAtLabel}</span>
          </div>
          {best.metrics.map((m) => (
            <div key={m.label} className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">{formatMetricDisplayLabel(m.label, t)}</span>
              <span className={cn('tabular-nums', m.tone === 'ok' && optimizationTone.positive.text)}>
                {formatMetricDisplayValue(m.label, m.value)}
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{t('optimizations.detail.best.experiment')}</span>
            <span className="inline-flex items-center gap-1">
              {best.experimentId ? (
                <Link
                  href={`/experiments/${best.experimentId}`}
                  className={cn('underline decoration-dotted underline-offset-2', optimizationTone.info.text)}
                >
                  {best.experimentRef}
                </Link>
              ) : (
                <span>{best.experimentRef}</span>
              )}
              <RoundJumpButtons promptId={null} promptVersionId={null} experimentId={best.experimentId} />
            </span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
          {t('optimizations.detail.best.empty')}
        </div>
      )}
    </section>
  );
}

export function OptimizationDetailPage({ projectId, optimizationId }: { projectId: string; optimizationId: string }) {
  const { t } = useI18n();
  const detailQuery = useOptimization(projectId, optimizationId);
  const detail = detailQuery.data ?? null;
  const [expandAll, setExpandAll] = useState(true);
  const [timelineOrder, setTimelineOrder] = useState<'desc' | 'asc'>('desc');
  const [showMetricComparisons, setShowMetricComparisons] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const controlMutation = useControlOptimization(projectId);
  const queryClient = useQueryClient();
  const onAutoRefreshTick = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['optimizations', projectId], exact: false });
  }, [queryClient, projectId]);
  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: detail?.status === 'running',
    onTick: onAutoRefreshTick,
  });
  const hasMetricComparisons = useMemo(() => {
    if (!detail) return false;
    return detail.rounds.some((round) => {
      const result = round.experimentResult;
      if (!result) return false;
      const overallDeltas = result.overallRow?.deltas ? Object.keys(result.overallRow.deltas) : [];
      const classDeltas = result.classRows.some((row) => row.deltas && Object.keys(row.deltas).length > 0);
      return overallDeltas.length > 0 || classDeltas;
    });
  }, [detail]);

  const timelineItems = useMemo<Array<{ kind: 'baseline' } | { kind: 'round'; round: IterationRound }>>(() => {
    if (!detail) return [];
    const rounds = detail.rounds.slice().sort((a, b) => a.index - b.index);
    const hasRoundBaseline = rounds.some((round) => round.isBaseline === true);
    const items: Array<{ kind: 'baseline' } | { kind: 'round'; round: IterationRound }> = [];
    if (timelineOrder === 'asc') {
      if (detail.baseline && !hasRoundBaseline) items.push({ kind: 'baseline' });
      rounds.forEach((round) => items.push({ kind: 'round', round }));
    } else {
      rounds
        .slice()
        .reverse()
        .forEach((round) => items.push({ kind: 'round', round }));
      if (detail.baseline && !hasRoundBaseline) items.push({ kind: 'baseline' });
    }
    return items;
  }, [detail, timelineOrder]);

  const detailLoading = useDelayedLoading(detailQuery.isLoading);
  if (detailLoading) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-12" data-testid="optimization-detail-loading">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  if (!detail) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-12" data-testid="optimization-detail-not-found">
          <h1 className="text-[20px] font-semibold">{t('optimizations.notFound.title')}</h1>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{t('optimizations.notFound.description')}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={`/optimizations`}>{t('optimizations.new.backToList')}</Link>
          </Button>
        </div>
      </Main>
    );
  }

  const status = detail.status;
  const canStop = status === 'running';
  const canResume = status === 'stopped';
  const canCancel = status === 'running' || status === 'stopped';
  const mutationPending = controlMutation.isPending;

  const handleControl = async (action: 'stop' | 'resume' | 'cancel') => {
    if (action === 'cancel' && !window.confirm(t('optimizations.detail.confirm.cancel'))) return;
    setActionError(null);
    try {
      await controlMutation.mutateAsync({ optimizationId: detail.id, action });
    } catch (error) {
      setActionError(getApiErrorMessage(error) ?? t('optimizations.list.actionFailed'));
    }
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="optimization-detail-page">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href={`/optimizations`} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            {t('optimizations.detail.backToList')}
          </Link>
        </div>

        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-baseline gap-2 text-[24px] font-semibold tracking-tight">
              <span className="font-mono">{detail.name}</span>
              <span data-testid="optimization-detail-status-badge">
                <OptimizationOutcomeBadge
                  status={status}
                  objectiveStatus={detail.objectiveStatus}
                  summary={detail.summary}
                  maxRounds={detail.maxRounds}
                  stopAfterNoImprovementRounds={detail.stopAfterNoImprovementRounds}
                />
              </span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canStop && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1"
                disabled={mutationPending}
                aria-label={t('optimizations.action.stop')}
                data-testid="optimization-detail-action-stop"
                onClick={() => {
                  void handleControl('stop');
                }}
              >
                <Square className="size-4" aria-hidden="true" />
                {t('optimizations.action.stop')}
              </Button>
            )}
            {canResume && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1"
                disabled={mutationPending}
                aria-label={t('optimizations.action.resume')}
                data-testid="optimization-detail-action-resume"
                onClick={() => {
                  void handleControl('resume');
                }}
              >
                <Play className="size-4" aria-hidden="true" />
                {t('optimizations.action.resume')}
              </Button>
            )}
            {canCancel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1 border-destructive/40 text-destructive hover:text-destructive"
                disabled={mutationPending}
                aria-label={t('optimizations.action.cancel')}
                data-testid="optimization-detail-action-cancel"
                onClick={() => {
                  void handleControl('cancel');
                }}
              >
                <Ban className="size-4" aria-hidden="true" />
                {t('optimizations.action.cancel')}
              </Button>
            )}
          </div>
        </div>

        {actionError && (
          <div
            role="alert"
            data-testid="optimization-detail-action-error"
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive"
          >
            {actionError}
          </div>
        )}
        <FailureBanner detail={detail} />
        <OptimizationProgressCard detail={detail} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <TrendChart detail={detail} />

            <section data-testid="optimization-detail-timeline">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(
                    timelineOrder === 'desc'
                      ? 'optimizations.detail.timeline.titleDesc'
                      : 'optimizations.detail.timeline.titleAsc',
                  )}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={cn(
                      'inline-flex h-8 items-center gap-2 rounded-md border bg-card px-2.5',
                      !hasMetricComparisons && 'opacity-60',
                    )}
                  >
                    <Switch
                      id="optimization-metric-comparison-toggle"
                      checked={showMetricComparisons}
                      onCheckedChange={setShowMetricComparisons}
                      disabled={!hasMetricComparisons}
                      aria-label={t('optimizations.detail.timeline.metricComparisonToggleAriaLabel')}
                      data-testid="optimization-metric-comparison-toggle"
                    />
                    <label
                      htmlFor="optimization-metric-comparison-toggle"
                      className={cn(
                        'select-none text-[12px] text-muted-foreground',
                        hasMetricComparisons ? 'cursor-pointer' : 'cursor-not-allowed',
                      )}
                    >
                      {t('optimizations.detail.timeline.metricComparisonToggle')}
                    </label>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 cursor-pointer"
                    onClick={() => setTimelineOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                    aria-pressed={timelineOrder === 'asc'}
                    aria-label={t('optimizations.detail.timeline.orderToggleAriaLabel')}
                    data-testid="optimization-timeline-order-toggle"
                  >
                    {timelineOrder === 'desc' ? (
                      <ArrowDownNarrowWide className="size-3.5" />
                    ) : (
                      <ArrowUpNarrowWide className="size-3.5" />
                    )}
                    {t(
                      timelineOrder === 'desc'
                        ? 'optimizations.detail.timeline.orderDesc'
                        : 'optimizations.detail.timeline.orderAsc',
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 cursor-pointer"
                    onClick={() => setExpandAll((prev) => !prev)}
                    aria-pressed={expandAll}
                  >
                    {expandAll ? <ChevronsUp className="size-3.5" /> : <ChevronsDown className="size-3.5" />}
                    {t(
                      expandAll
                        ? 'optimizations.detail.timeline.collapseAll'
                        : 'optimizations.detail.timeline.expandAll',
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-4">
                {timelineItems.map((item) =>
                  item.kind === 'baseline' ? (
                    <BaselineRow
                      key={`baseline-${expandAll ? 'open' : 'closed'}`}
                      detail={detail}
                      defaultPromptOpen={expandAll}
                    />
                  ) : (
                    <TimelineRoundCard
                      key={`round-${item.round.index}-${expandAll ? 'open' : 'closed'}`}
                      round={item.round}
                      detail={detail}
                      defaultOpen={expandAll}
                      promptId={detail.promptId}
                      showMetricComparisons={showMetricComparisons}
                    />
                  ),
                )}
                {timelineItems.length === 0 && (
                  <div className="rounded-lg border bg-card py-10 text-center text-[12px] text-muted-foreground">
                    {t('optimizations.detail.timeline.empty')}
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="flex flex-col gap-3 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pr-1">
            <ConfigSection detail={detail} />
            <BestVersionCard detail={detail} />
          </aside>
        </div>
      </div>
    </Main>
  );
}
