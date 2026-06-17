'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  CircleDollarSign,
  Gauge,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
  Timer,
} from 'lucide-react';
import * as echarts from 'echarts/core';
import { LineChart, type LineSeriesOption } from 'echarts/charts';
import {
  DataZoomComponent,
  type DataZoomComponentOption,
  GridComponent,
  type GridComponentOption,
  ToolboxComponent,
  type ToolboxComponentOption,
  TooltipComponent,
  type TooltipComponentOption,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ComposeOption, ECharts } from 'echarts/core';
import type {
  ProductionReleaseHistoryItemDto,
  ProjectMonitoringFilterDto,
  ProjectMonitoringStatsDto,
  ProjectMonitoringTimeseriesDto,
  ReleaseLineDeletionImpactDto,
  ReleaseLineEventDto,
  ReleaseVersionKindDto,
  ReleaseRunResultListItemDto,
  SourceBucket,
} from '@proofhound/shared';
import { Main } from '@proofhound/ui/layout';
import {
  Button,
  DateRangeSegmented,
  resolveDateRangePreset,
  resolveRollingDateRangeValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PlatformLoader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  DetailPageSkeleton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ResourcePaginationFooter,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@proofhound/ui';
import type { DateRangePresetOption, DateRangeSegmentedLabels, DateRangeValue, TableColumn } from '@proofhound/ui';
import { useDelayedLoading } from '../../hooks';
import { useProjectModels } from '../../hooks';
import { useConnectors, useProductionReleaseHistory, useStopCanaryRelease } from '../../hooks';
import { useProjectMonitoringStats, useProjectMonitoringTimeseries } from '../../hooks';
import {
  useArchiveReleaseLine,
  usePromoteReleaseLineCanary,
  useDeleteReleaseLine,
  useReleaseLineDeleteImpact,
  useReleaseLineEvents,
  useReleaseLineList,
  useRestoreReleaseLineHistoryToCanary,
  useRestoreReleaseLineHistoryToProduction,
  useStartReleaseLine,
  useStopReleaseLine,
  useUnarchiveReleaseLine,
  useUpdateReleaseLineInputRoute,
  useUpdateReleaseLineOutputRoute,
  useUpdateReleaseLineRunConfig,
  useUpdateReleaseLineTrafficRatio,
} from '../../hooks';
import { useReleaseRunResults } from '../../hooks';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh, useDateTimeFormatter } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage, getReleaseLineId, getReleaseStopConfirmationName } from '../../lib';
import type { ReleaseLineLatestEvent, ReleaseLineView } from '../../lib';
import { BigChartCard, type DeltaTone } from '../monitoring/big-chart-card';
import { formatCount, formatPercent } from './release-line-ui';
import { ReleaseTopologyCanvas } from './release-topology-canvas';

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, ToolboxComponent, SVGRenderer]);

type DetailTab = 'monitoring' | 'results' | 'quality' | 'history' | 'settings';

const DETAIL_TABS: Array<{ value: DetailTab; key: TranslationKey }> = [
  { value: 'monitoring', key: 'releases.detail.tab.monitoring' },
  { value: 'results', key: 'releases.detail.tab.results' },
  { value: 'quality', key: 'releases.detail.tab.quality' },
  { value: 'history', key: 'releases.detail.tab.history' },
  { value: 'settings', key: 'releases.detail.tab.settings' },
];

const RESULT_COLUMNS: TableColumn[] = [
  { key: 'externalId', width: 'normal' },
  { key: 'input', width: 'wide' },
  { key: 'output', width: 'wide' },
  { key: 'source', width: 'compact' },
  { key: 'version', width: 'normal' },
  { key: 'latency', width: 'compact' },
  { key: 'tokens', width: 'compact' },
  { key: 'createdAt', width: 'normal' },
];

const RESULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const HISTORY_INITIAL_GROUP_LIMIT = 8;
const HISTORY_GROUP_PAGE_SIZE = 8;
type ResultReleaseVersionFilterOption = {
  id: string;
  label: string;
  promptVersion: string;
  model: string;
  detail: string;
};

const EMPTY_BY_SOURCE: Record<SourceBucket, number> = { prod: 0, canary: 0, iter: 0, exp: 0 };
const EMPTY_TIMESERIES_POINTS: ProjectMonitoringTimeseriesDto['points'] = [];
const RELEASE_MONITORING_SOURCE_KEYS = ['prod', 'canary'] as const;
type MonitoringTickFormatter = ReturnType<typeof useDateTimeFormatter>['formatMonitoringTick'];

function useDateTimeOrDash() {
  const { formatDateTime } = useDateTimeFormatter();
  return useCallback(
    (value: string | null | undefined) => (value ? formatDateTime(value, { fallback: '—' }) : '—'),
    [formatDateTime],
  );
}

type ReleaseTimeseriesMetric =
  | 'errors'
  | 'rpm'
  | 'tpm'
  | 'latencyAverageMs'
  | 'latencyP50Ms'
  | 'latencyP95Ms'
  | 'latencyP99Ms'
  | 'cost';

type CompactMetricTone = 'default' | 'production' | 'canary' | 'success' | 'danger';

type CompactMetricItem = {
  label: string;
  value: ReactNode;
  tone?: CompactMetricTone;
};

type QualityMetricKey = 'recall' | 'precision' | 'f1' | 'accuracy';
type QualityScopeKey = string;
type QualityVersionLane = 'production' | 'canary';
type QualityFilterOption<T extends string = string> = {
  id: T;
  label: string;
  meta?: string;
};

type QualityVersionOption = {
  id: string;
  label: string;
  kind: ReleaseVersionKindDto;
  promptVersion: string;
  model: string;
  pointCount: number;
  latestAt: string | null;
};

type QualityScopeOption = QualityFilterOption<QualityScopeKey>;

type ReleaseQualityMetricSet = Record<QualityMetricKey, number> & {
  sampleCount: number | null;
};

type ReleaseQualityPoint = {
  id: string;
  eventId: string;
  eventLabel: string;
  scope: QualityScopeKey;
  scopeLabel: string;
  releaseVersionId: string;
  releaseVersionKind: ReleaseVersionKindDto;
  lane: QualityVersionLane;
  promptVersionLabel: string;
  modelName: string;
  releaseVersionLabel: string;
  sampleCount: number | null;
  createdAt: string;
  updatedAt: string | null;
  recall: number;
  precision: number;
  f1: number;
  accuracy: number;
};

type QualityChartPoint = ReleaseQualityPoint & {
  xIndex: number;
  xLabel: string;
  metric: QualityMetricKey;
  metricLabel: string;
  seriesId: string;
  seriesLabel: string;
  seriesColor: string;
  value: number;
};

type QualityChartSeries = {
  id: string;
  label: string;
  color: string;
  metric: QualityMetricKey;
  metricLabel: string;
  scope: QualityScopeKey;
  scopeLabel: string;
  points: QualityChartPoint[];
};

type QualityEChartsOption = ComposeOption<
  GridComponentOption | TooltipComponentOption | DataZoomComponentOption | ToolboxComponentOption | LineSeriesOption
>;

type QualityEChartsDatum = {
  value: number;
  qualityPoint: QualityChartPoint;
  symbol: 'circle';
  symbolSize: number;
  itemStyle: {
    color: string;
    borderColor: string;
    borderWidth: number;
  };
};

type QualityEChartsTooltipParam = {
  marker?: string;
  seriesName?: string;
  data?: QualityEChartsDatum | null;
};

type QualityPercentAxisExtent = {
  min: number;
  max: number;
};

const QUALITY_OVERALL_SCOPE = '__overall__';

const QUALITY_METRIC_OPTIONS: ReadonlyArray<{ key: QualityMetricKey; labelKey: TranslationKey }> = [
  { key: 'recall', labelKey: 'releases.detail.quality.metric.recall' },
  { key: 'precision', labelKey: 'releases.detail.quality.metric.precision' },
  { key: 'f1', labelKey: 'releases.detail.quality.metric.f1' },
  { key: 'accuracy', labelKey: 'releases.detail.quality.metric.accuracy' },
];

const QUALITY_SERIES_COLORS = [
  'var(--primary)',
  'var(--src-iter)',
  'var(--status-pending-dot)',
  'var(--destructive)',
  'var(--foreground)',
  'var(--muted-foreground)',
] as const;

const COMPACT_METRIC_DOT_CLASS: Record<CompactMetricTone, string> = {
  default: 'bg-muted-foreground',
  production: 'bg-[var(--src-prod-fg)]',
  canary: 'bg-[var(--src-canary-fg)]',
  success: 'bg-[var(--status-running-fg)]',
  danger: 'bg-destructive',
};

function normalizeLineId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveTab(value: string | null): DetailTab {
  if (value === 'annotation') return 'quality';
  if (value === 'variants' || value === 'versions') return 'history';
  if (
    value === 'monitoring' ||
    value === 'results' ||
    value === 'quality' ||
    value === 'history' ||
    value === 'settings'
  ) {
    return value;
  }
  if (value === 'delete') return 'settings';
  return 'monitoring';
}

function createDefaultMonitoringRange(): DateRangeValue {
  const preset = resolveDateRangePreset('h1');
  if (preset) return { preset: 'h1', ...preset };
  const now = new Date();
  return {
    preset: 'h1',
    from: new Date(now.getTime() - 60 * 60_000).toISOString(),
    to: now.toISOString(),
  };
}

function createDefaultResultDateRange(): DateRangeValue {
  const preset = resolveDateRangePreset('d7');
  if (preset) return { preset: 'all', ...preset };
  const now = new Date();
  return {
    preset: 'all',
    from: new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(),
    to: now.toISOString(),
  };
}

function getMonitoringRefreshInterval(preset: DateRangeValue['preset']): number | false {
  if (preset === 'h1') return AUTO_REFRESH_INTERVAL_MS;
  if (preset === 'h24') return 30_000;
  if (preset === 'd7') return 60_000;
  return false;
}

function isResultDateRangeApplied(value: DateRangeValue) {
  return value.preset !== 'all';
}

function isResultDateRangeRolling(value: DateRangeValue) {
  return value.preset !== 'all' && value.preset !== 'custom';
}

function hasRunningRelease(line: ReleaseLineView | null) {
  return line?.production?.currentEvent?.status === 'running' || line?.canary?.status === 'running';
}

function formatBigNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}

function formatRateValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(0);
}

function formatPercentValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatLatencyMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`;
}

function formatCostValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (Math.abs(value) >= 10000) return `$${(value / 1000).toFixed(1)}k`;
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(2)}k`;
  return `$${value.toFixed(4)}`;
}

function toPercentPoint(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value * 100));
}

function formatQualityPercent(value: number | null | undefined, fractionDigits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

function timeValue(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTime(values: Array<string | null | undefined>) {
  const latest = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => timeValue(right) - timeValue(left))[0];
  return latest ?? null;
}

function qualityVersionLane(kind: ReleaseVersionKindDto): QualityVersionLane {
  return kind === 'production' ? 'production' : 'canary';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringFromQualityRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberFromQualityRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed <= 1) return toPercentPoint(parsed);
  if (parsed <= 100) return parsed;
  return null;
}

function countFromQualityRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function readReleaseQualityMetricSet(value: unknown): ReleaseQualityMetricSet | null {
  if (!isRecord(value)) return null;
  const recall = numberFromQualityRecord(value, 'recall');
  const precision = numberFromQualityRecord(value, 'precision');
  const f1 = numberFromQualityRecord(value, 'f1');
  const accuracy = numberFromQualityRecord(value, 'accuracy');
  if (recall === null || precision === null || f1 === null || accuracy === null) return null;
  const sampleCount = countFromQualityRecord(value, 'sampleCount');
  return {
    recall,
    precision,
    f1,
    accuracy,
    sampleCount,
  };
}

function readReleaseQualityScopes(
  metrics: Record<string, unknown> | null,
  overallLabel: string,
): Array<{ scope: QualityScopeKey; label: string; metrics: ReleaseQualityMetricSet }> {
  const quality = isRecord(metrics?.['quality']) ? metrics['quality'] : null;
  if (!quality) return [];

  const scopes: Array<{ scope: QualityScopeKey; label: string; metrics: ReleaseQualityMetricSet }> = [];
  const overallMetrics = readReleaseQualityMetricSet(quality['overall']);
  if (overallMetrics) {
    scopes.push({ scope: QUALITY_OVERALL_SCOPE, label: overallLabel, metrics: overallMetrics });
  }

  const rawScopes = quality['scopes'];
  if (Array.isArray(rawScopes)) {
    for (const item of rawScopes) {
      if (!isRecord(item)) continue;
      const scope = stringFromQualityRecord(item, 'key') ?? stringFromQualityRecord(item, 'label');
      if (!scope) continue;
      const metricSet = readReleaseQualityMetricSet(item['metrics']) ?? readReleaseQualityMetricSet(item);
      if (!metricSet) continue;
      scopes.push({
        scope,
        label: stringFromQualityRecord(item, 'label') ?? scope,
        metrics: metricSet,
      });
    }
  } else if (isRecord(rawScopes)) {
    for (const [scope, value] of Object.entries(rawScopes)) {
      if (!isRecord(value)) continue;
      const metricSet = readReleaseQualityMetricSet(value['metrics']) ?? readReleaseQualityMetricSet(value);
      if (!metricSet) continue;
      scopes.push({
        scope,
        label: stringFromQualityRecord(value, 'label') ?? scope,
        metrics: metricSet,
      });
    }
  }

  return scopes;
}

function buildReleaseQualityPoints(releaseEvents: ReleaseLineEventDto[], overallLabel: string): ReleaseQualityPoint[] {
  const points: ReleaseQualityPoint[] = [];
  for (const event of releaseEvents) {
    if (!event.releaseVersionId) continue;
    const releaseVersionKind =
      event.releaseVersionKind ?? (event.laneType === 'production' ? 'production' : 'candidate');
    for (const scope of readReleaseQualityScopes(event.metrics, overallLabel)) {
      points.push({
        id: `${event.id}:${scope.scope}`,
        eventId: event.id,
        eventLabel: event.operation,
        scope: scope.scope,
        scopeLabel: scope.label,
        releaseVersionId: event.releaseVersionId,
        releaseVersionKind,
        lane: qualityVersionLane(releaseVersionKind),
        promptVersionLabel: event.promptVersionLabel ?? formatShortId(event.promptVersionId),
        modelName: event.modelName ?? formatShortId(event.modelId),
        releaseVersionLabel: event.releaseVersionLabel ?? formatShortId(event.releaseVersionId),
        sampleCount: scope.metrics.sampleCount,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        recall: scope.metrics.recall,
        precision: scope.metrics.precision,
        f1: scope.metrics.f1,
        accuracy: scope.metrics.accuracy,
      });
    }
  }
  return points.sort((left, right) => timeValue(left.createdAt) - timeValue(right.createdAt));
}

function buildQualityChartSeries(
  points: ReleaseQualityPoint[],
  metrics: readonly QualityFilterOption<QualityMetricKey>[],
  scopes: readonly QualityScopeOption[],
): QualityChartSeries[] {
  const sortedPoints = [...points].sort((left, right) => timeValue(left.createdAt) - timeValue(right.createdAt));
  const eventOrder = new Map<string, number>();
  for (const point of sortedPoints) {
    if (!eventOrder.has(point.eventId)) eventOrder.set(point.eventId, eventOrder.size + 1);
  }

  const series: QualityChartSeries[] = [];
  for (const scope of scopes) {
    const scopedPoints = sortedPoints.filter((point) => point.scope === scope.id);
    if (scopedPoints.length === 0) continue;
    for (const metric of metrics) {
      const seriesId = `${scope.id}:${metric.id}`;
      const seriesLabel = `${scope.label} · ${metric.label}`;
      const color = QUALITY_SERIES_COLORS[series.length % QUALITY_SERIES_COLORS.length] ?? 'var(--primary)';
      series.push({
        id: seriesId,
        label: seriesLabel,
        color,
        metric: metric.id,
        metricLabel: metric.label,
        scope: scope.id,
        scopeLabel: scope.label,
        points: scopedPoints.map((point) => ({
          ...point,
          xIndex: eventOrder.get(point.eventId) ?? 0,
          xLabel: `#${eventOrder.get(point.eventId) ?? 0}`,
          metric: metric.id,
          metricLabel: metric.label,
          seriesId,
          seriesLabel,
          seriesColor: color,
          value: point[metric.id],
        })),
      });
    }
  }
  return series;
}

function buildQualityChartAxisData(series: readonly QualityChartSeries[]): QualityChartPoint[] {
  const points = new Map<string, QualityChartPoint>();
  for (const item of series) {
    for (const point of item.points) {
      points.set(point.eventId, point);
    }
  }
  return [...points.values()].sort((left, right) => left.xIndex - right.xIndex);
}

function buildQualityVersionOptions(points: ReleaseQualityPoint[]): QualityVersionOption[] {
  const versions = new Map<string, QualityVersionOption>();
  for (const point of points) {
    const existing = versions.get(point.releaseVersionId);
    const latestAt = latestTime([existing?.latestAt, point.updatedAt ?? point.createdAt]);
    if (existing) {
      versions.set(point.releaseVersionId, {
        ...existing,
        pointCount: existing.pointCount + 1,
        latestAt,
      });
      continue;
    }
    versions.set(point.releaseVersionId, {
      id: point.releaseVersionId,
      label: point.releaseVersionLabel,
      kind: point.releaseVersionKind,
      promptVersion: point.promptVersionLabel,
      model: point.modelName,
      pointCount: 1,
      latestAt,
    });
  }
  return [...versions.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true }),
  );
}

function buildQualityScopeOptions(points: ReleaseQualityPoint[]): QualityScopeOption[] {
  const scopes = new Map<string, QualityScopeOption>();
  for (const point of points) {
    scopes.set(point.scope, { id: point.scope, label: point.scopeLabel });
  }
  return [...scopes.values()].sort((left, right) => {
    if (left.id === QUALITY_OVERALL_SCOPE) return -1;
    if (right.id === QUALITY_OVERALL_SCOPE) return 1;
    return left.label.localeCompare(right.label, undefined, { numeric: true });
  });
}

function resolveActiveQualityScopes(
  selectedScopes: QualityScopeKey[] | null,
  options: QualityScopeOption[],
): QualityScopeOption[] {
  if (selectedScopes) {
    const selectedSet = new Set(selectedScopes);
    const activeOptions = options.filter((option) => selectedSet.has(option.id));
    if (activeOptions.length > 0) return activeOptions;
  }
  const fallback = options.find((option) => option.id === QUALITY_OVERALL_SCOPE) ?? options[0] ?? null;
  return fallback ? [fallback] : [];
}

function resolveActiveQualityMetrics(
  selectedMetrics: QualityMetricKey[] | null,
  options: readonly QualityFilterOption<QualityMetricKey>[],
): QualityFilterOption<QualityMetricKey>[] {
  if (selectedMetrics) {
    const selectedSet = new Set(selectedMetrics);
    const activeOptions = options.filter((option) => selectedSet.has(option.id));
    if (activeOptions.length > 0) return activeOptions;
  }
  return options.filter((option) => option.id === 'f1');
}

function filterQualityPoints(
  points: ReleaseQualityPoint[],
  versionIds: string[],
  scopes: readonly QualityScopeOption[],
): ReleaseQualityPoint[] {
  if (scopes.length === 0) return [];
  const versionSet = new Set(versionIds);
  const scopeSet = new Set(scopes.map((scope) => scope.id));
  return points.filter((point) => versionSet.has(point.releaseVersionId) && scopeSet.has(point.scope));
}

function toggleQualityFilterValue<T extends string>(values: T[], value: T): T[] {
  if (!values.includes(value)) return [...values, value];
  if (values.length <= 1) return values;
  return values.filter((item) => item !== value);
}

function normalizeQualitySearch(value: string) {
  return value.trim().toLowerCase();
}

function qualitySearchIncludes(query: string, parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function comparisonFromDelta(
  current: number,
  previous: number,
  formatter: (value: number) => string,
  label: string,
  unit?: string,
): { value: string; unit?: string; label: string; tone: DeltaTone } {
  const delta = current - previous;
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return {
    value: `${sign}${formatter(Math.abs(delta))}`,
    unit,
    label,
    tone: toneFromDelta(delta),
  };
}

function toneFromDelta(delta: number): DeltaTone {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'neutral';
}

function failureRatePercent(stats: ProjectMonitoringStatsDto | undefined, period: 'total' | 'previous'): number {
  const requestCount = stats?.requests[period] ?? 0;
  if (requestCount <= 0) return 0;
  return ((stats?.errors[period] ?? 0) / requestCount) * 100;
}

function sourceBucketTotal(values: Record<SourceBucket, number>): number {
  return values.prod + values.canary + values.iter + values.exp;
}

function maxTimeseriesBucketTotal(
  points: ProjectMonitoringTimeseriesDto['points'],
  metric: ReleaseTimeseriesMetric,
): number {
  return points.reduce((max, point) => Math.max(max, sourceBucketTotal(point[metric])), 0);
}

function maxFailureRatePercent(points: ProjectMonitoringTimeseriesDto['points']): number {
  return points.reduce((max, point) => {
    const requests = sourceBucketTotal(point.requests);
    if (requests <= 0) return max;
    const failureRate = (sourceBucketTotal(point.errors) / requests) * 100;
    return Math.max(max, failureRate);
  }, 0);
}

function pickReleaseTimeseries(
  points: ProjectMonitoringTimeseriesDto['points'],
  granularity: ProjectMonitoringTimeseriesDto['granularity'],
  metric: ReleaseTimeseriesMetric,
  formatMonitoringTick: MonitoringTickFormatter,
) {
  return points.map((point) => ({
    x: formatMonitoringTick(point.bucketAt, granularity),
    prod: point[metric].prod,
    canary: point[metric].canary,
    iter: point[metric].iter,
    exp: point[metric].exp,
  }));
}

function pickReleaseFailureRateTimeseries(
  points: ProjectMonitoringTimeseriesDto['points'],
  granularity: ProjectMonitoringTimeseriesDto['granularity'],
  formatMonitoringTick: MonitoringTickFormatter,
) {
  return points.map((point) => {
    const requestCount = sourceBucketTotal(point.requests);
    return {
      x: formatMonitoringTick(point.bucketAt, granularity),
      prod: failureRateContributionPercent(point.errors.prod, requestCount),
      canary: failureRateContributionPercent(point.errors.canary, requestCount),
      iter: failureRateContributionPercent(point.errors.iter, requestCount),
      exp: failureRateContributionPercent(point.errors.exp, requestCount),
    };
  });
}

function failureRateBySourcePercent(stats: ProjectMonitoringStatsDto | undefined): Record<SourceBucket, number> {
  const requestCount = stats?.requests.total ?? 0;
  if (requestCount <= 0) return EMPTY_BY_SOURCE;
  return {
    prod: failureRateContributionPercent(stats?.errors.bySource.prod ?? 0, requestCount),
    canary: failureRateContributionPercent(stats?.errors.bySource.canary ?? 0, requestCount),
    iter: failureRateContributionPercent(stats?.errors.bySource.iter ?? 0, requestCount),
    exp: failureRateContributionPercent(stats?.errors.bySource.exp ?? 0, requestCount),
  };
}

function failureRateContributionPercent(errors: number, totalRequests: number): number {
  return totalRequests > 0 ? (errors / totalRequests) * 100 : 0;
}

function readMetricNumber(metrics: unknown, keys: string[]): number {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return 0;
  const record = metrics as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function getDownstreamDeliveryStats(line: ReleaseLineView) {
  const metrics = line.canary?.metrics ?? line.production?.currentEvent?.sourceMetricsSnapshot ?? null;
  const success = readMetricNumber(metrics, ['downstreamDeliverySuccess', 'outputDeliverySuccess']);
  const failed = readMetricNumber(metrics, ['downstreamDeliveryFailed', 'outputDeliveryFailed']);
  const total = success + failed;
  return {
    success,
    failed,
    failureRate: total > 0 ? failed / total : null,
  };
}

function CompactMetricGroup({
  title,
  items,
  className,
}: {
  title: string;
  items: CompactMetricItem[];
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      <div className="text-[13px] font-medium text-muted-foreground">{title}</div>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        {items.map((item) => {
          const tone = item.tone ?? 'default';
          return (
            <div key={item.label} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span className={cn('size-1.5 shrink-0 rounded-full', COMPACT_METRIC_DOT_CLASS[tone])} />
                <span className="truncate">{item.label}</span>
              </dt>
              <dd
                className={cn(
                  'mt-1 truncate text-[20px] font-semibold leading-none text-foreground',
                  tone === 'danger' && 'text-destructive',
                )}
              >
                {item.value}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function ReleaseLineDeleteImpactPanel({
  impact,
  loading,
}: {
  impact: ReleaseLineDeletionImpactDto | undefined;
  loading: boolean;
}) {
  const { t } = useI18n();

  if (loading && !impact) {
    return (
      <div
        className="rounded-lg border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground"
        data-testid="release-line-delete-impact"
      >
        {t('releases.deleteImpact.loading')}
      </div>
    );
  }
  if (!impact) return null;

  const items = [
    {
      key: 'events',
      label: t('releases.deleteImpact.events'),
      hint: t('releases.deleteImpact.eventsHint'),
      count: impact.events.length,
    },
    {
      key: 'versions',
      label: t('releases.deleteImpact.versions'),
      hint: t('releases.deleteImpact.versionsHint'),
      count: impact.versions.length,
    },
    {
      key: 'run-results',
      label: t('releases.deleteImpact.runResults'),
      hint: t('releases.deleteImpact.runResultsHint'),
      count: impact.runResults,
    },
    {
      key: 'annotation-tasks',
      label: t('releases.deleteImpact.annotationTasks'),
      hint: t('releases.deleteImpact.annotationTasksHint'),
      count: impact.annotationTasks.length,
    },
  ] as const;

  return (
    <div className="rounded-lg border border-destructive/25 bg-background p-3" data-testid="release-line-delete-impact">
      {impact.total === 0 ? (
        <div className="text-[12px] text-muted-foreground">{t('releases.deleteImpact.empty')}</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-md border bg-muted/30 px-3 py-2"
              data-testid={`release-line-delete-impact-${item.key}`}
            >
              <div className="text-[11px] font-medium text-muted-foreground">{item.label}</div>
              <div className="mt-1 font-mono text-[18px] font-semibold leading-none">{formatCount(item.count)}</div>
              <div className="mt-1 truncate text-[10.5px] text-muted-foreground">{item.hint}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReleaseLineDetailPage({ projectId, releaseLineId }: { projectId: string; releaseLineId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const listQuery = useReleaseLineList(projectId);
  const lineId = normalizeLineId(releaseLineId);
  const line = useMemo(
    () =>
      listQuery.data.find(
        (item) => item.id === lineId || getReleaseLineId(item.promptId, item.inputConnectorId) === lineId,
      ) ?? null,
    [lineId, listQuery.data],
  );
  const historyQuery = useProductionReleaseHistory(projectId, line?.promptId ?? '');
  const releaseLineEventsQuery = useReleaseLineEvents(projectId, line?.id ?? '');
  const stopLineMutation = useStopReleaseLine(projectId);
  const startLineMutation = useStartReleaseLine(projectId);
  const archiveLineMutation = useArchiveReleaseLine(projectId);
  const unarchiveLineMutation = useUnarchiveReleaseLine(projectId);
  const deleteLineMutation = useDeleteReleaseLine(projectId);
  const stopCanaryMutation = useStopCanaryRelease(projectId);
  const updateTrafficRatioMutation = useUpdateReleaseLineTrafficRatio(projectId);
  const promoteCanaryMutation = usePromoteReleaseLineCanary(projectId);
  const updateRunConfigMutation = useUpdateReleaseLineRunConfig(projectId);
  const updateOutputRouteMutation = useUpdateReleaseLineOutputRoute(projectId);
  const updateInputRouteMutation = useUpdateReleaseLineInputRoute(projectId);
  const modelQuery = useProjectModels(projectId);
  const outputConnectorsQuery = useConnectors(projectId, { direction: 'output' });
  const tab = resolveTab(searchParams.get('tab'));
  const selectedReleaseVersionId = searchParams.get('version') ?? undefined;
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [stopConfirmationText, setStopConfirmationText] = useState('');
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<{
    lineId: string;
    confirmationText: string;
    error: string | null;
  }>({ lineId: '', confirmationText: '', error: null });
  const activeDeleteLineId = line?.id ?? '';
  const deleteConfirmationText = deleteState.lineId === activeDeleteLineId ? deleteState.confirmationText : '';
  const deleteError = deleteState.lineId === activeDeleteLineId ? deleteState.error : null;
  const deleteImpactQuery = useReleaseLineDeleteImpact(projectId, deleteDialogOpen ? activeDeleteLineId : '');
  const productionReleaseName = useMemo(() => getReleaseStopConfirmationName(line), [line]);
  const canConfirmStopProduction = stopConfirmationText === productionReleaseName && productionReleaseName.length > 0;
  const canConfirmDelete = Boolean(line && deleteConfirmationText === line.label);
  const canAddCanary = Boolean(line && line.production?.currentEvent?.status === 'running');
  const canaryActionPending = stopCanaryMutation.isPending || promoteCanaryMutation.isPending;
  const isLive = hasRunningRelease(line);
  const onAutoRefreshTick = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] }),
    ]);
  }, [projectId, queryClient]);

  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: isLive,
    onTick: onAutoRefreshTick,
  });

  useEffect(() => {
    const rawTab = searchParams.get('tab');
    const normalizedTab =
      rawTab === 'annotation'
        ? 'quality'
        : rawTab === 'variants' || rawTab === 'versions'
          ? 'history'
          : rawTab === 'delete'
            ? 'settings'
            : null;
    if (!normalizedTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', normalizedTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const selectTab = useCallback(
    (next: DetailTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'monitoring') params.delete('tab');
      else params.set('tab', next);
      if (next !== 'results') params.delete('version');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const detailLoading = useDelayedLoading(listQuery.isLoading);
  if (detailLoading) {
    return (
      <Main fixed className="bg-muted/35">
        <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  if (!line) {
    return (
      <Main fixed className="bg-muted/35">
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          {t('releases.detail.notFound')}
        </div>
      </Main>
    );
  }

  function openStopProductionDialog() {
    if (!line || line.status !== 'running') return;
    setStopConfirmationText('');
    setStopDialogOpen(true);
  }

  function closeStopProductionDialog() {
    if (stopLineMutation.isPending) return;
    setStopDialogOpen(false);
    setStopConfirmationText('');
  }

  function confirmStopProduction() {
    if (!line || !canConfirmStopProduction) return;
    stopLineMutation.mutate(
      {
        releaseLineId: line.id,
        body: { reason: t('releases.detail.stopReason') },
      },
      {
        onSuccess: () => {
          setStopDialogOpen(false);
          setStopConfirmationText('');
        },
      },
    );
  }

  function startReleaseLine() {
    if (!line || line.status !== 'stopped') return;
    startLineMutation.mutate({
      releaseLineId: line.id,
      body: { reason: t('releases.detail.startReason') },
    });
  }

  function openArchiveDialog() {
    if (!line || line.status !== 'stopped') return;
    setArchiveDialogOpen(true);
  }

  function closeArchiveDialog() {
    if (archiveLineMutation.isPending) return;
    setArchiveDialogOpen(false);
  }

  function confirmArchiveReleaseLine() {
    if (!line || line.status !== 'stopped') return;
    archiveLineMutation.mutate(
      {
        releaseLineId: line.id,
        body: { reason: t('releases.detail.archiveReason') },
      },
      {
        onSuccess: () => setArchiveDialogOpen(false),
      },
    );
  }

  function unarchiveReleaseLine() {
    if (!line || line.status !== 'archived') return;
    unarchiveLineMutation.mutate({
      releaseLineId: line.id,
      body: { reason: t('releases.detail.unarchiveReason') },
    });
  }

  function openDeleteDialog() {
    if (!line) return;
    setDeleteState({ lineId: line.id, confirmationText: '', error: null });
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog() {
    if (deleteLineMutation.isPending) return;
    setDeleteDialogOpen(false);
    if (line) setDeleteState({ lineId: line.id, confirmationText: '', error: null });
  }

  async function confirmDeleteReleaseLine() {
    if (!line || !canConfirmDelete) return;
    setDeleteState((current) => ({
      lineId: line.id,
      confirmationText: current.lineId === line.id ? current.confirmationText : '',
      error: null,
    }));
    try {
      await deleteLineMutation.mutateAsync({
        releaseLineId: line.id,
        body: {
          confirmationName: line.label,
          reason: t('releases.detail.deleteReason'),
        },
      });
      setDeleteDialogOpen(false);
      router.push('/releases');
    } catch (error) {
      setDeleteState((current) => ({
        lineId: line.id,
        confirmationText: current.lineId === line.id ? current.confirmationText : '',
        error: getApiErrorMessage(error) ?? t('releases.detail.deleteFailed'),
      }));
    }
  }

  function openAddCanaryPage() {
    if (!line || !canAddCanary) return;
    router.push(`/releases/new?mode=canary&line=${encodeURIComponent(line.id)}`);
  }

  return (
    <Main fixed className="gap-5 overflow-auto bg-muted/35 pb-8">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-5" data-testid="release-line-detail-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold leading-tight">{line.promptName}</h1>
              <span data-testid="release-line-detail-status" className="sr-only">
                {line.status}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {line.status === 'running' ? (
              <Button
                variant="outline"
                onClick={openStopProductionDialog}
                disabled={stopLineMutation.isPending}
                className="text-destructive hover:text-destructive"
                data-testid="release-line-detail-stop"
              >
                <Square className="size-4" />
                {t('releases.detail.action.stopProduction')}
              </Button>
            ) : null}
            {line.status === 'stopped' ? (
              <Button
                variant="outline"
                onClick={startReleaseLine}
                disabled={startLineMutation.isPending}
                data-testid="release-line-detail-start"
              >
                <Play className="size-4" />
                {startLineMutation.isPending ? t('releases.detail.action.starting') : t('releases.detail.action.start')}
              </Button>
            ) : null}
            {line.status === 'stopped' ? (
              <Button
                variant="outline"
                onClick={openArchiveDialog}
                disabled={archiveLineMutation.isPending}
                data-testid="release-line-detail-archive"
              >
                <Archive className="size-4" />
                {archiveLineMutation.isPending
                  ? t('releases.detail.action.archiving')
                  : t('releases.detail.action.archive')}
              </Button>
            ) : null}
            {line.status === 'archived' ? (
              <Button
                variant="outline"
                onClick={unarchiveReleaseLine}
                disabled={unarchiveLineMutation.isPending}
                data-testid="release-line-detail-unarchive"
              >
                <RotateCcw className="size-4" />
                {unarchiveLineMutation.isPending
                  ? t('releases.detail.action.unarchiving')
                  : t('releases.detail.action.unarchive')}
              </Button>
            ) : null}
            {canAddCanary ? (
              <Button onClick={openAddCanaryPage}>
                <Plus className="size-4" />
                {line.canary ? t('releases.detail.action.replaceCanary') : t('releases.detail.action.addCanary')}
              </Button>
            ) : null}
          </div>
        </div>

        <ReleaseTopologyCanvas
          line={line}
          models={modelQuery.data?.data ?? []}
          modelsLoading={modelQuery.isLoading}
          outputConnectors={outputConnectorsQuery.data?.data ?? []}
          outputConnectorsLoading={outputConnectorsQuery.isLoading}
          onUpdateTrafficRatio={(_canary, trafficRatio) =>
            updateTrafficRatioMutation.mutateAsync({
              releaseLineId: line.id,
              body: { trafficRatio },
            })
          }
          trafficRatioPending={updateTrafficRatioMutation.isPending}
          onUpdateRunConfig={(body) =>
            updateRunConfigMutation.mutateAsync({
              releaseLineId: line.id,
              body,
            })
          }
          runConfigPending={updateRunConfigMutation.isPending}
          onUpdateOutputRoute={(body) =>
            updateOutputRouteMutation.mutateAsync({
              releaseLineId: line.id,
              body,
            })
          }
          outputRoutePending={updateOutputRouteMutation.isPending}
          onUpdateInputRoute={(body) =>
            updateInputRouteMutation.mutateAsync({
              releaseLineId: line.id,
              body,
            })
          }
          inputRoutePending={updateInputRouteMutation.isPending}
          onAddCanary={canAddCanary ? openAddCanaryPage : undefined}
          onStopCanary={(canary) => stopCanaryMutation.mutateAsync(canary.id)}
          onPromoteCanary={() => promoteCanaryMutation.mutateAsync(line.id)}
          canaryActionPending={canaryActionPending}
        />

        <div className="inline-flex w-fit flex-wrap gap-0.5 rounded-lg border bg-card p-1">
          {DETAIL_TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => selectTab(item.value)}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                tab === item.value
                  ? 'bg-muted font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(item.key)}
            </button>
          ))}
        </div>

        {tab === 'monitoring' ? (
          <MonitoringPane projectId={projectId} line={line} releaseEvents={releaseLineEventsQuery.data?.data ?? []} />
        ) : null}
        {tab === 'results' ? (
          <ResultsPane
            projectId={projectId}
            line={line}
            releaseEvents={releaseLineEventsQuery.data?.data ?? []}
            initialReleaseVersionId={selectedReleaseVersionId}
          />
        ) : null}
        {tab === 'quality' ? (
          <QualityMetricsPane line={line} releaseEvents={releaseLineEventsQuery.data?.data ?? []} />
        ) : null}
        {tab === 'history' ? (
          <HistoryPane
            projectId={projectId}
            line={line}
            productionHistory={historyQuery.data?.data ?? []}
            releaseEvents={releaseLineEventsQuery.data?.data ?? []}
            loading={historyQuery.isLoading || releaseLineEventsQuery.isLoading}
          />
        ) : null}
        {tab === 'settings' ? (
          <section className="rounded-lg border bg-card" data-testid="release-line-settings-tab">
            <div className="border-b px-4 py-3">
              <div className="text-[13px] font-semibold">{t('releases.detail.settings.title')}</div>
              <p className="mt-1 text-[12px] text-muted-foreground">{t('releases.detail.settings.description')}</p>
            </div>
            <div className="p-4">
              <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-destructive">
                    <AlertTriangle className="size-4" />
                    {t('releases.detail.delete.dangerTitle')}
                  </div>
                  <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
                    {t('releases.detail.delete.description')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={openDeleteDialog}
                  data-testid="release-line-delete-open"
                >
                  <Trash2 className="size-4" />
                  {t('releases.detail.delete.open')}
                </Button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
      <Dialog
        open={stopDialogOpen}
        onOpenChange={(open) => (open ? setStopDialogOpen(true) : closeStopProductionDialog())}
      >
        <DialogContent data-testid="release-stop-production-dialog">
          <DialogHeader>
            <DialogTitle>{t('releases.detail.stopDialog.title')}</DialogTitle>
            <DialogDescription>{t('releases.detail.stopDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[11.5px] font-medium text-muted-foreground">
              {t('releases.detail.stopDialog.releaseName')}
            </div>
            <div className="mt-1 break-all font-mono text-[13px] font-semibold">{productionReleaseName || '—'}</div>
          </div>
          <div className="space-y-2">
            <label htmlFor="release-stop-production-name" className="text-[12.5px] font-medium">
              {t('releases.detail.stopDialog.inputLabel')}
            </label>
            <Input
              id="release-stop-production-name"
              value={stopConfirmationText}
              onChange={(event) => setStopConfirmationText(event.target.value)}
              placeholder={t('releases.detail.stopDialog.inputPlaceholder').replace('{name}', productionReleaseName)}
              autoComplete="off"
            />
            {stopConfirmationText.length > 0 && !canConfirmStopProduction ? (
              <p className="text-[12px] text-destructive">{t('releases.detail.stopDialog.mismatch')}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeStopProductionDialog}
              disabled={stopLineMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmStopProduction}
              disabled={!canConfirmStopProduction || stopLineMutation.isPending}
              data-testid="release-stop-production-confirm"
            >
              <Square className="size-4" />
              {stopLineMutation.isPending
                ? t('releases.detail.stopDialog.stopping')
                : t('releases.detail.stopDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={archiveDialogOpen}
        onOpenChange={(open) => (open ? setArchiveDialogOpen(true) : closeArchiveDialog())}
      >
        <DialogContent data-testid="release-line-detail-archive-dialog">
          <DialogHeader>
            <DialogTitle>{t('releases.archiveDialog.title')}</DialogTitle>
            <DialogDescription>{t('releases.archiveDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[11.5px] font-medium text-muted-foreground">
              {t('releases.detail.stopDialog.releaseName')}
            </div>
            <div className="mt-1 break-all font-mono text-[13px] font-semibold">{line.label}</div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeArchiveDialog}
              disabled={archiveLineMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={confirmArchiveReleaseLine}
              disabled={archiveLineMutation.isPending}
              data-testid="release-line-detail-archive-confirm"
            >
              <Archive className="size-4" />
              {archiveLineMutation.isPending
                ? t('releases.archiveDialog.archiving')
                : t('releases.archiveDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => (open ? openDeleteDialog() : closeDeleteDialog())}>
        <DialogContent data-testid="release-line-delete-dialog">
          <DialogHeader>
            <DialogTitle>{t('releases.detail.delete.title')}</DialogTitle>
            <DialogDescription>{t('releases.detail.delete.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="text-[11.5px] font-medium text-muted-foreground">
              {t('releases.detail.delete.releaseName')}
            </div>
            <div className="mt-1 break-all font-mono text-[13px] font-semibold">{line.label}</div>
          </div>
          <ReleaseLineDeleteImpactPanel
            impact={deleteImpactQuery.data}
            loading={deleteImpactQuery.isLoading || deleteImpactQuery.isFetching}
          />
          <div className="space-y-2">
            <label htmlFor="release-line-delete-name" className="text-[12.5px] font-medium">
              {t('releases.detail.delete.inputLabel')}
            </label>
            <Input
              id="release-line-delete-name"
              value={deleteConfirmationText}
              onChange={(event) =>
                setDeleteState({
                  lineId: line.id,
                  confirmationText: event.target.value,
                  error: null,
                })
              }
              placeholder={t('releases.detail.delete.inputPlaceholder').replace('{name}', line.label)}
              autoComplete="off"
            />
            {deleteConfirmationText.length > 0 && !canConfirmDelete ? (
              <p className="text-[12px] text-destructive">{t('releases.detail.delete.mismatch')}</p>
            ) : null}
          </div>
          {deleteError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDeleteDialog} disabled={deleteLineMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDeleteReleaseLine()}
              disabled={!canConfirmDelete || deleteLineMutation.isPending}
              data-testid="release-line-delete-confirm"
            >
              <Trash2 className="size-4" />
              {deleteLineMutation.isPending
                ? t('releases.detail.delete.deleting')
                : t('releases.detail.delete.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Main>
  );
}

function MonitoringPane({
  projectId,
  line,
  releaseEvents,
}: {
  projectId: string;
  line: ReleaseLineView;
  releaseEvents: ReleaseLineEventDto[];
}) {
  const { t, language } = useI18n();
  const { formatMonitoringTick } = useDateTimeFormatter();
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => createDefaultMonitoringRange());
  const sourceIds = useMemo(() => getReleaseLineEventSourceIds(line, releaseEvents), [line, releaseEvents]);
  const sources = useMemo<SourceBucket[]>(() => getReleaseLineEventSources(line, releaseEvents), [line, releaseEvents]);
  const filter = useMemo<ProjectMonitoringFilterDto>(
    () => ({
      from: dateRange.from,
      to: dateRange.to,
      sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      sources,
      granularity: 'auto',
    }),
    [dateRange.from, dateRange.to, sourceIds, sources],
  );
  const statsQuery = useProjectMonitoringStats(projectId, filter, sourceIds.length > 0);
  const timeseriesQuery = useProjectMonitoringTimeseries(projectId, filter, sourceIds.length > 0);
  const monitoringRefreshInterval = getMonitoringRefreshInterval(dateRange.preset);
  const refreshMonitoring = useCallback(async () => {
    const nextDateRange = resolveRollingDateRangeValue(dateRange);
    if (
      nextDateRange.preset !== dateRange.preset ||
      nextDateRange.from !== dateRange.from ||
      nextDateRange.to !== dateRange.to
    ) {
      setDateRange(nextDateRange);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['project-monitoring', projectId] });
  }, [dateRange, projectId, queryClient]);

  useAutoRefresh({
    intervalMs: monitoringRefreshInterval,
    enabled: hasRunningRelease(line) && sourceIds.length > 0 && monitoringRefreshInterval !== false,
    onTick: refreshMonitoring,
  });

  const stats = statsQuery.data;
  const timeseriesPoints = timeseriesQuery.data?.points ?? EMPTY_TIMESERIES_POINTS;
  const timeseriesGranularity = timeseriesQuery.data?.granularity ?? 'hour';
  const processed = Math.trunc(stats?.requests.total ?? 0);
  const filtered = line.canary?.totalFiltered ?? 0;
  const failed = Math.trunc(stats?.errors.total ?? 0);
  const total = processed + filtered;
  const downstreamDelivery = getDownstreamDeliveryStats(line);
  const vsPreviousPeriodLabel = t('monitoring.delta.vsPreviousPeriod');
  const sourceLabels = useMemo<Record<SourceBucket, string>>(
    () => ({
      prod: t('monitoring.source.prod'),
      canary: t('monitoring.source.canary'),
      iter: t('monitoring.source.iter'),
      exp: t('monitoring.source.exp'),
    }),
    [t],
  );
  const chartLabels = useMemo(
    () => ({
      sourceDistributionLabel: t('monitoring.chart.sourceDistribution'),
      totalLabel: t('monitoring.chart.total'),
      failureRateTotalLabel: t('monitoring.chart.failureRateTotal'),
    }),
    [t],
  );
  const timeseriesMax = useMemo(
    () => ({
      rpm: maxTimeseriesBucketTotal(timeseriesPoints, 'rpm'),
      tpm: maxTimeseriesBucketTotal(timeseriesPoints, 'tpm'),
      latencyAverageMs: maxTimeseriesBucketTotal(timeseriesPoints, 'latencyAverageMs'),
      latencyP50Ms: maxTimeseriesBucketTotal(timeseriesPoints, 'latencyP50Ms'),
      latencyP95Ms: maxTimeseriesBucketTotal(timeseriesPoints, 'latencyP95Ms'),
      latencyP99Ms: maxTimeseriesBucketTotal(timeseriesPoints, 'latencyP99Ms'),
      cost: maxTimeseriesBucketTotal(timeseriesPoints, 'cost'),
      failureRatePercent: maxFailureRatePercent(timeseriesPoints),
    }),
    [timeseriesPoints],
  );

  function pickTimeseries(metric: ReleaseTimeseriesMetric) {
    return pickReleaseTimeseries(timeseriesPoints, timeseriesGranularity, metric, formatMonitoringTick);
  }

  function pickFailureRateTimeseries() {
    return pickReleaseFailureRateTimeseries(timeseriesPoints, timeseriesGranularity, formatMonitoringTick);
  }

  const dateRangePresetLabels = useMemo<ReadonlyArray<DateRangePresetOption>>(
    () => [
      { value: 'h1', label: t('monitoring.timeRange.preset.h1') },
      { value: 'h24', label: t('monitoring.timeRange.preset.h24') },
      { value: 'd7', label: t('monitoring.timeRange.preset.d7') },
      { value: 'd30', label: t('monitoring.timeRange.preset.d30') },
      { value: 'custom', label: t('monitoring.timeRange.preset.custom') },
    ],
    [t],
  );
  const dateRangeLabels = useMemo<DateRangeSegmentedLabels>(
    () => ({
      ariaLabel: t('monitoring.timeRange.ariaLabel'),
      customRangeAriaLabel: t('monitoring.timeRange.customRangeAriaLabel'),
      fromLabel: t('monitoring.timeRange.from'),
      toLabel: t('monitoring.timeRange.to'),
      dateLabel: t('monitoring.timeRange.date'),
      timeLabel: t('monitoring.timeRange.time'),
      previousMonth: t('monitoring.timeRange.previousMonth'),
      nextMonth: t('monitoring.timeRange.nextMonth'),
      cancel: t('common.cancel'),
      apply: t('common.apply'),
      invalidRange: t('monitoring.timeRange.invalidRange'),
    }),
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-[14px] font-semibold">{t('releases.detail.metric.realtime')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeSegmented
            value={dateRange}
            onChange={setDateRange}
            presetLabels={dateRangePresetLabels}
            labels={dateRangeLabels}
            locale={language}
          />
        </div>
      </div>

      {statsQuery.isError || timeseriesQuery.isError ? (
        <div className="rounded-lg border bg-card px-4 py-3 text-sm text-destructive">
          {t('monitoring.error.title')}
        </div>
      ) : null}

      <div className="rounded-lg border bg-card p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <CompactMetricGroup
            title={t('releases.detail.metric.runtimeSummary')}
            items={[
              { label: t('releases.detail.metric.total'), value: formatCount(total) },
              { label: t('releases.detail.metric.processed'), value: formatCount(processed), tone: 'success' },
              { label: t('releases.detail.metric.filtered'), value: formatCount(filtered) },
              { label: t('releases.detail.metric.failed'), value: formatCount(failed), tone: 'danger' },
              {
                label: t('releases.detail.metric.productionCount'),
                value: formatCount(Math.trunc(stats?.requests.bySource.prod ?? 0)),
                tone: 'production',
              },
              {
                label: t('releases.detail.metric.canaryCount'),
                value: formatCount(Math.trunc(stats?.requests.bySource.canary ?? 0)),
                tone: 'canary',
              },
            ]}
          />
          <CompactMetricGroup
            title={t('releases.detail.metric.downstreamDelivery')}
            className="border-t pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"
            items={[
              {
                label: t('releases.detail.metric.deliverySuccess'),
                value: formatCount(Math.trunc(downstreamDelivery.success)),
                tone: 'success',
              },
              {
                label: t('releases.detail.metric.deliveryFailed'),
                value: formatCount(Math.trunc(downstreamDelivery.failed)),
                tone: 'danger',
              },
              {
                label: t('releases.detail.metric.deliveryFailureRate'),
                value: formatPercent(downstreamDelivery.failureRate),
                tone: downstreamDelivery.failed > 0 ? 'danger' : 'default',
              },
            ]}
          />
        </div>
      </div>

      <section className="space-y-3" aria-label={t('releases.detail.metric.engineering')}>
        <h3 className="text-[14px] font-semibold">{t('releases.detail.metric.engineering')}</h3>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-4">
          <BigChartCard
            title={t('releases.detail.metric.rpm')}
            icon={<Gauge className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-pending-bg)"
            iconFg="var(--status-pending-fg)"
            total={formatRateValue(timeseriesMax.rpm)}
            comparison={comparisonFromDelta(
              timeseriesMax.rpm,
              stats?.rpmPeak.previous ?? 0,
              formatRateValue,
              vsPreviousPeriodLabel,
            )}
            subtitle={t('monitoring.delta.rpmSubtitle')}
            data={pickTimeseries('rpm')}
            yTickFormatter={formatRateValue}
            legendFormatter={formatRateValue}
            bySource={stats?.rpmPeak.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            {...chartLabels}
          />
          <BigChartCard
            title={t('releases.detail.metric.tpm')}
            icon={<Activity className="size-4" strokeWidth={2.2} />}
            iconBg="var(--src-iter-soft)"
            iconFg="var(--src-iter-fg)"
            total={formatBigNumber(timeseriesMax.tpm)}
            comparison={comparisonFromDelta(
              timeseriesMax.tpm,
              stats?.tpmPeak.previous ?? 0,
              formatBigNumber,
              vsPreviousPeriodLabel,
            )}
            subtitle={t('monitoring.delta.tpmSubtitle')}
            data={pickTimeseries('tpm')}
            yTickFormatter={formatBigNumber}
            legendFormatter={formatBigNumber}
            bySource={stats?.tpmPeak.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            {...chartLabels}
          />
          <BigChartCard
            title={t('releases.detail.metric.averageLatency')}
            icon={<Timer className="size-4" strokeWidth={2.2} />}
            iconBg="var(--src-canary-soft)"
            iconFg="var(--src-canary-fg)"
            total={formatLatencyMs(timeseriesMax.latencyAverageMs)}
            comparison={comparisonFromDelta(
              timeseriesMax.latencyAverageMs,
              stats?.latencyAverageMs.previous ?? 0,
              formatLatencyMs,
              vsPreviousPeriodLabel,
            )}
            data={pickTimeseries('latencyAverageMs')}
            yTickFormatter={formatLatencyMs}
            legendFormatter={formatLatencyMs}
            bySource={stats?.latencyAverageMs.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            {...chartLabels}
          />
          <BigChartCard
            title={t('releases.detail.metric.p50Latency')}
            icon={<Timer className="size-4" strokeWidth={2.2} />}
            iconBg="var(--src-prod-soft)"
            iconFg="var(--src-prod-fg)"
            total={formatLatencyMs(timeseriesMax.latencyP50Ms)}
            comparison={comparisonFromDelta(
              timeseriesMax.latencyP50Ms,
              stats?.latencyP50Ms.previous ?? 0,
              formatLatencyMs,
              vsPreviousPeriodLabel,
            )}
            data={pickTimeseries('latencyP50Ms')}
            yTickFormatter={formatLatencyMs}
            legendFormatter={formatLatencyMs}
            bySource={stats?.latencyP50Ms.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            {...chartLabels}
          />
          <BigChartCard
            title={t('releases.detail.metric.p95Latency')}
            icon={<Timer className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-running-bg)"
            iconFg="var(--status-running-fg)"
            total={formatLatencyMs(timeseriesMax.latencyP95Ms)}
            comparison={comparisonFromDelta(
              timeseriesMax.latencyP95Ms,
              stats?.latencyP95Ms.previous ?? 0,
              formatLatencyMs,
              vsPreviousPeriodLabel,
            )}
            data={pickTimeseries('latencyP95Ms')}
            yTickFormatter={formatLatencyMs}
            legendFormatter={formatLatencyMs}
            bySource={stats?.latencyP95Ms.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            {...chartLabels}
          />
          <BigChartCard
            title={t('releases.detail.metric.p99Latency')}
            icon={<Timer className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-pending-bg)"
            iconFg="var(--status-pending-fg)"
            total={formatLatencyMs(timeseriesMax.latencyP99Ms)}
            comparison={comparisonFromDelta(
              timeseriesMax.latencyP99Ms,
              stats?.latencyP99Ms.previous ?? 0,
              formatLatencyMs,
              vsPreviousPeriodLabel,
            )}
            data={pickTimeseries('latencyP99Ms')}
            yTickFormatter={formatLatencyMs}
            legendFormatter={formatLatencyMs}
            bySource={stats?.latencyP99Ms.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            {...chartLabels}
          />
          <BigChartCard
            title={t('releases.detail.metric.cost')}
            icon={<CircleDollarSign className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-running-bg)"
            iconFg="var(--status-running-fg)"
            total={formatCostValue(timeseriesMax.cost)}
            comparison={comparisonFromDelta(
              timeseriesMax.cost,
              stats?.cost.previous ?? 0,
              formatCostValue,
              vsPreviousPeriodLabel,
            )}
            subtitle={t('monitoring.delta.costSubtitle')}
            data={pickTimeseries('cost')}
            yTickFormatter={formatCostValue}
            legendFormatter={formatCostValue}
            bySource={stats?.cost.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            {...chartLabels}
          />
          <BigChartCard
            title={t('releases.detail.metric.failureRate')}
            icon={<AlertTriangle className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-pending-bg)"
            iconFg="var(--status-pending-fg)"
            total={timeseriesMax.failureRatePercent.toFixed(2)}
            unit="%"
            comparison={comparisonFromDelta(
              timeseriesMax.failureRatePercent,
              failureRatePercent(stats, 'previous'),
              (value) => value.toFixed(2),
              vsPreviousPeriodLabel,
              '%',
            )}
            subtitle={t('monitoring.delta.failureRateSubtitle')}
            data={pickFailureRateTimeseries()}
            yTickFormatter={formatPercentValue}
            legendFormatter={formatPercentValue}
            bySource={failureRateBySourcePercent(stats)}
            sourceLabels={sourceLabels}
            sourceKeys={RELEASE_MONITORING_SOURCE_KEYS}
            sourceDistributionLabel={chartLabels.sourceDistributionLabel}
            totalLabel={chartLabels.failureRateTotalLabel}
          />
        </div>
      </section>
    </div>
  );
}

function ResultsPane({
  projectId,
  line,
  releaseEvents,
  initialReleaseVersionId,
}: {
  projectId: string;
  line: ReleaseLineView;
  releaseEvents: ReleaseLineEventDto[];
  initialReleaseVersionId?: string;
}) {
  const { t, language } = useI18n();
  const formatDateTimeOrDash = useDateTimeOrDash();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => createDefaultResultDateRange());
  const [releaseVersionFilter, setReleaseVersionFilter] = useState(initialReleaseVersionId ?? 'all');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const sourceIds = useMemo(() => getReleaseResultSourceIds(line, releaseEvents), [line, releaseEvents]);
  const releaseVersionOptions = useMemo(
    () => getReleaseResultVersionOptions(line, releaseEvents),
    [line, releaseEvents],
  );
  const activeReleaseVersionFilter =
    releaseVersionFilter === 'all' || releaseVersionOptions.some((option) => option.id === releaseVersionFilter)
      ? releaseVersionFilter
      : 'all';
  const releaseVersionIds = activeReleaseVersionFilter === 'all' ? undefined : [activeReleaseVersionFilter];
  const applyDateRange = isResultDateRangeApplied(dateRange);
  const handleDateRangeChange = useCallback((next: DateRangeValue) => {
    setDateRange(next);
    setPageIndex(0);
  }, []);
  const refreshResultDateRange = useCallback(() => {
    const nextDateRange = resolveRollingDateRangeValue(dateRange);
    if (
      nextDateRange.preset !== dateRange.preset ||
      nextDateRange.from !== dateRange.from ||
      nextDateRange.to !== dateRange.to
    ) {
      setDateRange(nextDateRange);
    }
  }, [dateRange]);
  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: sourceIds.length > 0 && isResultDateRangeRolling(dateRange),
    onTick: refreshResultDateRange,
  });
  const dateRangePresetLabels = useMemo<ReadonlyArray<DateRangePresetOption>>(
    () => [
      { value: 'all', label: t('releases.detail.results.dateFilter.all') },
      { value: 'h24', label: t('monitoring.timeRange.preset.h24') },
      { value: 'd7', label: t('monitoring.timeRange.preset.d7') },
      { value: 'd30', label: t('monitoring.timeRange.preset.d30') },
      { value: 'custom', label: t('monitoring.timeRange.preset.custom') },
    ],
    [t],
  );
  const dateRangeLabels = useMemo<DateRangeSegmentedLabels>(
    () => ({
      ariaLabel: t('releases.detail.results.dateFilter.ariaLabel'),
      customRangeAriaLabel: t('releases.detail.results.dateFilter.customRangeAriaLabel'),
      fromLabel: t('monitoring.timeRange.from'),
      toLabel: t('monitoring.timeRange.to'),
      dateLabel: t('monitoring.timeRange.date'),
      timeLabel: t('monitoring.timeRange.time'),
      previousMonth: t('monitoring.timeRange.previousMonth'),
      nextMonth: t('monitoring.timeRange.nextMonth'),
      cancel: t('common.cancel'),
      apply: t('common.apply'),
      invalidRange: t('monitoring.timeRange.invalidRange'),
    }),
    [t],
  );
  const resultsQuery = useReleaseRunResults(
    projectId,
    {
      page: pageIndex + 1,
      pageSize,
      sort: 'created_desc',
      status: undefined,
      judgmentStatus: undefined,
      isCorrect: undefined,
      sourceIds,
      releaseVersionIds,
      releaseVersionScope: 'exact',
      from: applyDateRange ? dateRange.from : undefined,
      to: applyDateRange ? dateRange.to : undefined,
    },
    sourceIds.length > 0,
  );
  const rows = resultsQuery.data?.data ?? [];
  const resultsLoading = useDelayedLoading(resultsQuery.isLoading);
  const total = resultsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, total);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">{t('releases.detail.tab.results')}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeSegmented
            value={dateRange}
            onChange={handleDateRangeChange}
            presetLabels={dateRangePresetLabels}
            labels={dateRangeLabels}
            locale={language}
          />
          <label className="sr-only" htmlFor="release-result-version-filter">
            {t('releases.detail.results.version')}
          </label>
          <ResultReleaseVersionSelect
            id="release-result-version-filter"
            options={releaseVersionOptions}
            value={activeReleaseVersionFilter}
            onChange={(next) => {
              setReleaseVersionFilter(next);
              setPageIndex(0);
            }}
            disabled={releaseVersionOptions.length === 0}
          />
        </div>
      </div>
      <Table columns={RESULT_COLUMNS}>
        <TableHeader>
          <TableRow>
            <TableHead column="externalId">{t('releases.detail.results.externalId')}</TableHead>
            <TableHead column="input">{t('releases.detail.results.input')}</TableHead>
            <TableHead column="output">{t('releases.detail.results.output')}</TableHead>
            <TableHead column="source">{t('releases.detail.results.source')}</TableHead>
            <TableHead column="version">{t('releases.detail.results.version')}</TableHead>
            <TableHead column="latency">{t('releases.detail.results.latency')}</TableHead>
            <TableHead column="tokens">{t('releases.detail.results.tokens')}</TableHead>
            <TableHead column="createdAt">{t('releases.detail.results.createdAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resultsLoading && rows.length === 0 ? (
            <TableEmpty>
              <PlatformLoader className="py-1" size="sm" />
            </TableEmpty>
          ) : null}
          {resultsQuery.isError ? <TableEmpty>{t('releases.detail.results.loadFailed')}</TableEmpty> : null}
          {!resultsQuery.isLoading && !resultsQuery.isError && rows.length === 0 ? (
            <TableEmpty>{t('releases.detail.results.empty')}</TableEmpty>
          ) : null}
          {rows.map((row) => (
            <TableRow key={`${row.id}:${row.createdAt}`}>
              <TableCell column="externalId" truncate className="font-mono text-[11.5px] text-muted-foreground">
                <span title={row.externalId ?? undefined}>{row.externalId ?? '—'}</span>
              </TableCell>
              <TableCell column="input" truncate={2} className="text-[12px]">
                <span title={formatReleaseRunResultInput(row, 1000)}>{formatReleaseRunResultInput(row, 220)}</span>
              </TableCell>
              <TableCell column="output" truncate={2} className="text-[12px]">
                <span title={formatReleaseRunResultOutput(row, 1000)}>{formatReleaseRunResultOutput(row, 220)}</span>
              </TableCell>
              <TableCell column="source">
                <ReleaseRunResultLaneBadge lane={row.lane} />
              </TableCell>
              <TableCell column="version" className="text-[12px]">
                <ReleaseRunResultVersion value={row} />
              </TableCell>
              <TableCell column="latency" className="font-mono text-[11.5px] text-muted-foreground">
                {formatResultLatency(row.latencyMs)}
              </TableCell>
              <TableCell column="tokens" className="font-mono text-[11.5px] text-muted-foreground">
                {formatResultTokens(row)}
              </TableCell>
              <TableCell column="createdAt" className="font-mono text-[11.5px] text-muted-foreground">
                {formatDateTimeOrDash(row.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ResourcePaginationFooter
        summary={
          <span>
            {t('releases.detail.results.summary')
              .replace('{from}', String(from))
              .replace('{to}', String(to))
              .replace('{total}', formatCount(total))}
          </span>
        }
        pageIndex={pageIndex}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={RESULT_PAGE_SIZE_OPTIONS}
        previousPageLabel={t('common.previousPage')}
        nextPageLabel={t('common.nextPage')}
        onPageChange={setPageIndex}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPageIndex(0);
        }}
      />
    </div>
  );
}

function ResultReleaseVersionSelect({
  id,
  options,
  value,
  onChange,
  disabled,
}: {
  id: string;
  options: ResultReleaseVersionFilterOption[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedOption = value === 'all' ? null : (options.find((option) => option.id === value) ?? null);
  const allLabel = t('releases.detail.results.versionFilter.all');
  const triggerLabel = selectedOption?.label ?? allLabel;
  const triggerDetail = selectedOption?.detail ?? null;
  const normalizedQuery = normalizeResultVersionSearch(query);
  const allOptionVisible = !normalizedQuery || resultVersionSearchIncludes(normalizedQuery, [allLabel, 'all']);
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      resultVersionSearchIncludes(normalizedQuery, [
        option.id,
        option.label,
        option.promptVersion,
        option.model,
        option.detail,
      ]),
    );
  }, [normalizedQuery, options]);

  function select(next: string) {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-testid="release-result-version-filter"
          className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left sm:w-[340px]"
        >
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] font-semibold">{triggerLabel}</span>
            {triggerDetail ? (
              <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                {triggerDetail}
              </span>
            ) : null}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[calc(100vw-2rem)] p-0 sm:w-[720px]">
        <ResultDropdownSearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('releases.detail.results.versionDropdown.search')}
        />
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {allOptionVisible ? (
            <button
              type="button"
              data-testid="release-result-version-option-all"
              onClick={() => select('all')}
              className={cn(
                'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent',
                value === 'all' && 'bg-primary/5',
              )}
            >
              <ResultVersionSelectionCheck selected={value === 'all'} />
              <span className="min-w-0 flex-1">
                <span className="block min-w-0 truncate font-mono text-[13px] font-semibold">{allLabel}</span>
              </span>
            </button>
          ) : null}
          {filteredOptions.length === 0 && !allOptionVisible ? (
            <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
              {t('releases.detail.results.versionDropdown.noMatches')}
            </div>
          ) : (
            filteredOptions.map((option) => {
              const selected = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-testid={`release-result-version-option-${option.id}`}
                  onClick={() => select(option.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent',
                    selected && 'bg-primary/5',
                  )}
                >
                  <ResultVersionSelectionCheck selected={selected} />
                  <span className="min-w-0 flex-1">
                    <span className="block min-w-0 truncate font-mono text-[13px] font-semibold">{option.label}</span>
                    <span className="mt-1 grid gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground sm:grid-cols-3">
                      <span className="min-w-0 truncate">
                        <ResultDropdownFieldLabel
                          label={t('releases.detail.results.versionDropdown.promptVersion')}
                          value={option.promptVersion}
                        />
                      </span>
                      <span className="min-w-0 truncate">
                        <ResultDropdownFieldLabel
                          label={t('releases.detail.results.versionDropdown.model')}
                          value={option.model}
                        />
                      </span>
                      <span className="min-w-0 truncate">
                        <ResultDropdownFieldLabel
                          label={t('releases.detail.results.versionDropdown.versionId')}
                          value={formatShortId(option.id)}
                        />
                      </span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ResultDropdownSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder={placeholder}
        data-testid="release-result-version-search"
        className="h-8 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </div>
  );
}

function ResultVersionSelectionCheck({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/35 bg-background',
      )}
      aria-hidden="true"
    >
      <Check className={cn('size-3', selected ? 'opacity-100' : 'opacity-0')} />
    </span>
  );
}

function ResultDropdownFieldLabel({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="mx-1 text-muted-foreground/60">-</span>
      <span className="text-foreground">{value}</span>
    </>
  );
}

function normalizeResultVersionSearch(value: string) {
  return value.trim().toLowerCase();
}

function resultVersionSearchIncludes(query: string, parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function getReleaseLineEventSourceIds(line: ReleaseLineView, releaseEvents: ReleaseLineEventDto[]): string[] {
  const ids = [
    ...releaseEvents.flatMap((event) => [
      event.id,
      event.sourceEventId,
      event.supersedesEventId,
      event.rollbackTargetEventId,
    ]),
    line.production?.currentEvent?.id,
    line.production?.currentEvent?.sourceCanaryId,
    line.canary?.id,
    ...line.canaryHistory.map((canary) => canary.id),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(ids)];
}

function getReleaseLineEventSources(line: ReleaseLineView, releaseEvents: ReleaseLineEventDto[]): SourceBucket[] {
  const sources = new Set<SourceBucket>();
  for (const event of releaseEvents) {
    if (event.laneType === 'production') sources.add('prod');
    if (event.laneType === 'canary') sources.add('canary');
  }
  if (line.production?.currentEvent) sources.add('prod');
  if (line.canary) sources.add('canary');
  if (sources.size === 0) {
    sources.add('prod');
    sources.add('canary');
  }
  return [...sources];
}

function getReleaseResultSourceIds(line: ReleaseLineView, releaseEvents: ReleaseLineEventDto[]): string[] {
  return getReleaseLineEventSourceIds(line, releaseEvents);
}

function getReleaseResultVersionOptions(
  line: ReleaseLineView,
  releaseEvents: ReleaseLineEventDto[],
): ResultReleaseVersionFilterOption[] {
  const options = new Map<string, ResultReleaseVersionFilterOption>();
  const add = (input: {
    id: string | null | undefined;
    label: string | null | undefined;
    promptVersionLabel: string | null | undefined;
    promptVersionId: string | null | undefined;
    modelName: string | null | undefined;
    modelId: string | null | undefined;
  }) => {
    if (!input.id) return;
    const promptVersion = input.promptVersionLabel?.trim() || formatShortId(input.promptVersionId);
    const model = input.modelName?.trim() || formatShortId(input.modelId);
    options.set(input.id, {
      id: input.id,
      label: input.label?.trim() || formatShortId(input.id),
      promptVersion,
      model,
      detail: `${promptVersion} · ${model}`,
    });
  };
  for (const version of line.versions) {
    add({
      id: version.id,
      label: version.label,
      promptVersionLabel: version.promptVersionLabel,
      promptVersionId: version.promptVersionId,
      modelName: version.modelName,
      modelId: version.modelId,
    });
  }
  for (const event of releaseEvents) {
    add({
      id: event.releaseVersionId,
      label: event.releaseVersionLabel,
      promptVersionLabel: event.promptVersionLabel,
      promptVersionId: event.promptVersionId,
      modelName: event.modelName,
      modelId: event.modelId,
    });
  }
  return [...options.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true }),
  );
}

function formatReleaseRunResultInput(row: ReleaseRunResultListItemDto, maxLength: number): string {
  return compactReleaseRunResultValue(row.inputVariables, maxLength);
}

function formatReleaseRunResultOutput(row: ReleaseRunResultListItemDto, maxLength: number): string {
  return compactReleaseRunResultValue(
    row.parsedOutput ?? parseMaybeJson(row.rawResponse) ?? row.rawResponse ?? row.decisionOutput ?? row.errorMessage,
    maxLength,
  );
}

function formatReleaseRunResultPromptVersion(row: ReleaseRunResultListItemDto): string {
  return row.promptVersionNumber ? `v${row.promptVersionNumber}` : formatShortId(row.promptVersionId);
}

function compactReleaseRunResultValue(value: unknown, maxLength: number): string {
  const formatted = formatReleaseRunResultValue(value).replace(/\s+/g, ' ').trim();
  if (formatted.length <= maxLength) return formatted;
  return `${formatted.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatReleaseRunResultValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.map(formatReleaseRunResultValue).join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '—';
    return entries.map(([key, item]) => `${key}: ${formatReleaseRunResultValue(item)}`).join(' · ');
  }
  return String(value);
}

function parseMaybeJson(value: string | null): unknown | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function formatResultLatency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`;
}

function formatResultTokens(row: ReleaseRunResultListItemDto): string {
  const input = row.inputTokens ?? 0;
  const output = row.outputTokens ?? 0;
  const total = input + output;
  return total > 0 ? formatCount(total) : '—';
}

function formatShortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : '—';
}

function ReleaseRunResultLaneBadge({ lane }: { lane: ReleaseRunResultListItemDto['lane'] }) {
  const { t } = useI18n();
  const isProduction = lane === 'production';
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold leading-4"
      style={{
        background: isProduction ? 'var(--src-prod-soft)' : 'var(--src-canary-soft)',
        color: isProduction ? 'var(--src-prod-fg)' : 'var(--src-canary-fg)',
        borderColor: isProduction
          ? 'color-mix(in srgb, var(--src-prod) 30%, transparent)'
          : 'color-mix(in srgb, var(--src-canary) 30%, transparent)',
      }}
    >
      {t(isProduction ? 'releases.detail.results.lane.production' : 'releases.detail.results.lane.canary')}
    </span>
  );
}

function ReleaseRunResultVersion({ value }: { value: ReleaseRunResultListItemDto }) {
  const label = value.releaseVersionLabel ?? formatShortId(value.releaseVersionId);
  const promptVersion = formatReleaseRunResultPromptVersion(value);
  const model = value.modelName ?? formatShortId(value.modelId);
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-[11.5px] font-semibold">{label}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
        {promptVersion} · {model}
      </div>
    </div>
  );
}

function QualityMetricsPane({ line, releaseEvents }: { line: ReleaseLineView; releaseEvents: ReleaseLineEventDto[] }) {
  const { t } = useI18n();
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[] | null>(null);
  const [selectedScopeIds, setSelectedScopeIds] = useState<QualityScopeKey[] | null>(null);
  const [selectedMetricIds, setSelectedMetricIds] = useState<QualityMetricKey[] | null>(['f1']);
  const overallLabel = t('releases.detail.quality.scope.overall');
  const qualityPoints = useMemo(
    () => buildReleaseQualityPoints(releaseEvents, overallLabel),
    [overallLabel, releaseEvents],
  );
  const versionOptions = useMemo(() => buildQualityVersionOptions(qualityPoints), [qualityPoints]);
  const scopeOptions = useMemo(() => buildQualityScopeOptions(qualityPoints), [qualityPoints]);
  const metricOptions = useMemo<QualityFilterOption<QualityMetricKey>[]>(
    () => QUALITY_METRIC_OPTIONS.map((option) => ({ id: option.key, label: t(option.labelKey) })),
    [t],
  );
  const activeVersionIds = useMemo(() => {
    const available = versionOptions.map((option) => option.id);
    if (selectedVersionIds === null) return available;
    return selectedVersionIds.filter((id) => available.includes(id));
  }, [selectedVersionIds, versionOptions]);
  const activeScopes = resolveActiveQualityScopes(selectedScopeIds, scopeOptions);
  const activeMetrics = resolveActiveQualityMetrics(selectedMetricIds, metricOptions);
  const visiblePoints = useMemo(
    () => filterQualityPoints(qualityPoints, activeVersionIds, activeScopes),
    [activeScopes, activeVersionIds, qualityPoints],
  );
  const chartSeries = useMemo(
    () => buildQualityChartSeries(visiblePoints, activeMetrics, activeScopes),
    [activeMetrics, activeScopes, visiblePoints],
  );
  const chartAxisData = useMemo(() => buildQualityChartAxisData(chartSeries), [chartSeries]);
  const annotationHref = buildQualityAnnotationHref(line, releaseEvents);

  return (
    <section className="space-y-4" data-testid="release-quality-metrics-pane">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold">{t('releases.detail.quality.title')}</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-muted-foreground">
          {t('releases.detail.quality.description')}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        {qualityPoints.length > 0 ? (
          <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
            <QualityVersionFilter
              options={versionOptions}
              activeIds={activeVersionIds}
              onChange={setSelectedVersionIds}
            />
            <QualityScopeFilter
              options={scopeOptions}
              activeIds={activeScopes.map((scope) => scope.id)}
              onChange={setSelectedScopeIds}
            />
            <QualityMetricFilter
              options={metricOptions}
              activeIds={activeMetrics.map((metric) => metric.id)}
              onChange={setSelectedMetricIds}
            />
          </div>
        ) : null}

        <div className="px-4 pb-2 pt-4">
          <QualityMetricsChart axisData={chartAxisData} series={chartSeries}>
            {chartSeries.length === 0 ? (
              qualityPoints.length === 0 ? (
                <QualityEmptyChartMessage annotationHref={annotationHref} />
              ) : (
                <QualityFilteredEmptyChartMessage />
              )
            ) : null}
          </QualityMetricsChart>
        </div>
        {chartSeries.length > 0 ? <QualityLegend series={chartSeries} /> : null}
      </div>
    </section>
  );
}

function QualityVersionFilter({
  options,
  activeIds,
  onChange,
}: {
  options: QualityVersionOption[];
  activeIds: string[];
  onChange: (next: string[] | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const normalizedQuery = normalizeQualitySearch(query);
  const latestOption = useMemo(
    () => [...options].sort((left, right) => timeValue(right.latestAt) - timeValue(left.latestAt))[0] ?? null,
    [options],
  );
  const productionVersionIds = useMemo(
    () => options.filter((option) => option.kind === 'production').map((option) => option.id),
    [options],
  );
  const canaryVersionIds = useMemo(
    () => options.filter((option) => option.kind !== 'production').map((option) => option.id),
    [options],
  );
  const selectedOptions = options.filter((option) => activeSet.has(option.id));
  const allSelected = options.length > 0 && selectedOptions.length === options.length;
  const productionSelected =
    productionVersionIds.length > 0 &&
    selectedOptions.length === productionVersionIds.length &&
    productionVersionIds.every((id) => activeSet.has(id));
  const canarySelected =
    canaryVersionIds.length > 0 &&
    selectedOptions.length === canaryVersionIds.length &&
    canaryVersionIds.every((id) => activeSet.has(id));
  let triggerLabel = formatTemplate(t('releases.detail.quality.filter.selectedVersions'), {
    count: formatCount(selectedOptions.length),
  });
  if (allSelected) {
    triggerLabel = t('releases.detail.quality.filter.allVersions');
  } else if (productionSelected) {
    triggerLabel = t('releases.detail.quality.filter.allProductionVersions');
  } else if (canarySelected) {
    triggerLabel = t('releases.detail.quality.filter.allCanaryVersions');
  } else if (selectedOptions.length === 1) {
    triggerLabel = selectedOptions[0]?.label ?? triggerLabel;
  }
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      qualitySearchIncludes(normalizedQuery, [option.label, option.promptVersion, option.model, option.id]),
    );
  }, [normalizedQuery, options]);

  function commit(next: string[]) {
    onChange(next.length === options.length ? null : next);
  }

  return (
    <div className="flex min-w-[220px] flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('releases.detail.quality.filter.version')}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={options.length === 0}
            className="h-10 justify-between gap-2 px-3 text-left"
          >
            <span className="min-w-0 truncate font-mono text-[13px] font-semibold">{triggerLabel}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[calc(100vw-2rem)] p-0 sm:w-[560px]">
          <ResultDropdownSearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('releases.detail.quality.filter.versionSearch')}
          />
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-b px-3 py-2 text-[12px]">
            <button type="button" className="font-medium text-primary" onClick={() => onChange(null)}>
              {t('releases.detail.quality.filter.selectAll')}
            </button>
            <button
              type="button"
              className="font-medium text-primary disabled:text-muted-foreground"
              disabled={!latestOption}
              onClick={() => {
                if (latestOption) onChange([latestOption.id]);
              }}
            >
              {t('releases.detail.quality.filter.latestOnly')}
            </button>
            <button
              type="button"
              className="font-medium text-primary disabled:text-muted-foreground"
              disabled={productionVersionIds.length === 0}
              onClick={() => commit(productionVersionIds)}
            >
              {t('releases.detail.quality.filter.allProductionVersions')}
            </button>
            <button
              type="button"
              className="font-medium text-primary disabled:text-muted-foreground"
              disabled={canaryVersionIds.length === 0}
              onClick={() => commit(canaryVersionIds)}
            >
              {t('releases.detail.quality.filter.allCanaryVersions')}
            </button>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
                {t('releases.detail.quality.filter.noVersions')}
              </div>
            ) : (
              filteredOptions.map((option) => {
                const selected = activeSet.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => commit(toggleQualityFilterValue(activeIds, option.id))}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent',
                      selected && 'bg-primary/5',
                    )}
                  >
                    <ResultVersionSelectionCheck selected={selected} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate font-mono text-[13px] font-semibold">{option.label}</span>
                        <QualityVersionKindBadge kind={option.kind} />
                      </span>
                      <span className="mt-1 grid gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground sm:grid-cols-3">
                        <span className="min-w-0 truncate">
                          <ResultDropdownFieldLabel
                            label={t('releases.detail.results.versionDropdown.promptVersion')}
                            value={option.promptVersion}
                          />
                        </span>
                        <span className="min-w-0 truncate">
                          <ResultDropdownFieldLabel
                            label={t('releases.detail.results.versionDropdown.model')}
                            value={option.model}
                          />
                        </span>
                        <span className="min-w-0 truncate">
                          <ResultDropdownFieldLabel
                            label={t('releases.detail.quality.filter.points')}
                            value={formatCount(option.pointCount)}
                          />
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function QualityScopeFilter({
  options,
  activeIds,
  onChange,
}: {
  options: readonly QualityScopeOption[];
  activeIds: QualityScopeKey[];
  onChange: (next: QualityScopeKey[]) => void;
}) {
  return (
    <QualityMultiSelectFilter
      labelKey="releases.detail.quality.filter.scope"
      options={options}
      activeIds={activeIds}
      onChange={onChange}
      allLabelKey="releases.detail.quality.filter.allScopes"
      selectedLabelKey="releases.detail.quality.filter.selectedScopes"
      emptyLabelKey="releases.detail.quality.filter.scopeEmpty"
      minWidthClassName="min-w-[190px]"
    />
  );
}

function QualityMetricFilter({
  options,
  activeIds,
  onChange,
}: {
  options: readonly QualityFilterOption<QualityMetricKey>[];
  activeIds: QualityMetricKey[];
  onChange: (next: QualityMetricKey[]) => void;
}) {
  return (
    <QualityMultiSelectFilter
      labelKey="releases.detail.quality.filter.metric"
      options={options}
      activeIds={activeIds}
      onChange={onChange}
      allLabelKey="releases.detail.quality.filter.allMetrics"
      selectedLabelKey="releases.detail.quality.filter.selectedMetrics"
      emptyLabelKey="releases.detail.quality.filter.metricEmpty"
      minWidthClassName="min-w-[170px]"
    />
  );
}

function QualityMultiSelectFilter<T extends string>({
  labelKey,
  options,
  activeIds,
  onChange,
  allLabelKey,
  selectedLabelKey,
  emptyLabelKey,
  minWidthClassName,
}: {
  labelKey: TranslationKey;
  options: readonly QualityFilterOption<T>[];
  activeIds: T[];
  onChange: (next: T[]) => void;
  allLabelKey: TranslationKey;
  selectedLabelKey: TranslationKey;
  emptyLabelKey: TranslationKey;
  minWidthClassName: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const selectedOptions = options.filter((option) => activeSet.has(option.id));
  const allSelected = options.length > 0 && selectedOptions.length === options.length;
  const triggerLabel = allSelected
    ? t(allLabelKey)
    : selectedOptions.length === 1
      ? selectedOptions[0]?.label
      : selectedOptions.length > 1
        ? formatTemplate(t(selectedLabelKey), { count: formatCount(selectedOptions.length) })
        : t(emptyLabelKey);

  function commit(next: T[]) {
    if (next.length === 0) return;
    onChange(next);
  }

  return (
    <div className={cn('flex flex-col gap-1.5', minWidthClassName)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(labelKey)}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={options.length === 0}
            className="h-10 justify-between gap-2 px-3 text-left"
          >
            <span className="min-w-0 truncate text-[13px] font-semibold">{triggerLabel}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-64 p-0">
          <div className="flex gap-3 border-b px-3 py-2 text-[12px]">
            <button
              type="button"
              className="font-medium text-primary disabled:text-muted-foreground"
              disabled={allSelected}
              onClick={() => onChange(options.map((option) => option.id))}
            >
              {t('releases.detail.quality.filter.selectAll')}
            </button>
          </div>
          <div className="max-h-[260px] overflow-y-auto p-1.5">
            {options.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t(emptyLabelKey)}</div>
            ) : (
              options.map((option) => {
                const selected = activeSet.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => commit(toggleQualityFilterValue(activeIds, option.id))}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent',
                      selected && 'bg-primary/5',
                    )}
                  >
                    <ResultVersionSelectionCheck selected={selected} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{option.label}</span>
                    {option.meta ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">{option.meta}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function QualityVersionKindBadge({ kind }: { kind: ReleaseVersionKindDto }) {
  const { t } = useI18n();
  const isProduction = kind === 'production';
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-4"
      style={{
        background: isProduction ? 'var(--src-prod-soft)' : 'var(--src-canary-soft)',
        color: isProduction ? 'var(--src-prod-fg)' : 'var(--src-canary-fg)',
        borderColor: isProduction
          ? 'color-mix(in srgb, var(--src-prod) 30%, transparent)'
          : 'color-mix(in srgb, var(--src-canary) 30%, transparent)',
      }}
    >
      {t(
        isProduction
          ? 'releases.detail.history.versionKind.production'
          : 'releases.detail.history.versionKind.candidate',
      )}
    </span>
  );
}

function QualityLegend({ series }: { series: readonly QualityChartSeries[] }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-[11.5px] text-muted-foreground">
      {series.map((item) => (
        <span key={item.id} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full" style={{ background: item.color }} aria-hidden />
          {item.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 border-l pl-4">
        <span className="size-2.5 rounded-full bg-[var(--src-prod)]" aria-hidden />
        {t('releases.detail.quality.legend.production')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border-2 border-[var(--src-canary)] bg-card" aria-hidden />
        {t('releases.detail.quality.legend.canary')}
      </span>
    </div>
  );
}

function readChartCssColor(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function resolveChartColor(value: string, fallback: string) {
  const variableName = value.match(/var\((--[^),\s]+)/)?.[1];
  return variableName ? readChartCssColor(variableName, fallback) : value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escaped[char] ?? char;
  });
}

function resolveQualityPercentAxisExtent(extent: QualityPercentAxisExtent) {
  if (!Number.isFinite(extent.min) || !Number.isFinite(extent.max)) {
    return { min: 0, max: 100 };
  }

  const dataMin = Math.max(0, Math.min(100, Math.min(extent.min, extent.max)));
  const dataMax = Math.max(0, Math.min(100, Math.max(extent.min, extent.max)));
  const dataSpan = dataMax - dataMin;
  const padding = Math.max(2, dataSpan * 0.2);
  let nextMin = Math.max(0, dataMin - padding);
  let nextMax = Math.min(100, dataMax + padding);

  if (nextMax - nextMin < 10) {
    const center = (dataMin + dataMax) / 2;
    nextMin = Math.max(0, center - 5);
    nextMax = Math.min(100, center + 5);
    if (nextMin === 0) nextMax = Math.min(100, Math.max(10, nextMax));
    if (nextMax === 100) nextMin = Math.max(0, Math.min(90, nextMin));
  }

  const roundedMin = Math.max(0, Math.floor(nextMin / 5) * 5);
  const roundedMax = Math.min(100, Math.ceil(nextMax / 5) * 5);
  return roundedMax > roundedMin ? { min: roundedMin, max: roundedMax } : { min: 0, max: 100 };
}

function getQualityPercentAxisMin(extent: QualityPercentAxisExtent) {
  return resolveQualityPercentAxisExtent(extent).min;
}

function getQualityPercentAxisMax(extent: QualityPercentAxisExtent) {
  return resolveQualityPercentAxisExtent(extent).max;
}

function QualityMetricsChart({
  axisData,
  series,
  children,
}: {
  axisData: QualityChartPoint[];
  series: readonly QualityChartSeries[];
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const formatDateTimeOrDash = useDateTimeOrDash();
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<ECharts | null>(null);
  const [chartColorVersion, setChartColorVersion] = useState(0);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setChartColorVersion((current) => current + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const chartOption = useMemo<QualityEChartsOption>(() => {
    void chartColorVersion;
    const foregroundColor = readChartCssColor('--foreground', '#e5e7eb');
    const mutedColor = readChartCssColor('--muted-foreground', '#94a3b8');
    const borderColor = readChartCssColor('--border', '#1f2937');
    const cardColor = readChartCssColor('--card', '#020617');
    const popoverColor = readChartCssColor('--popover', cardColor);
    const primaryColor = readChartCssColor('--primary', '#60a5fa');
    const productionColor = readChartCssColor('--src-prod', '#22c55e');
    const canaryColor = readChartCssColor('--src-canary', '#3b82f6');
    const categoryLabels = axisData.map((point) => point.releaseVersionLabel);

    const qualitySeries: LineSeriesOption[] = series.map((item) => {
      const pointByEvent = new Map(item.points.map((point) => [point.eventId, point]));
      const lineColor = resolveChartColor(item.color, primaryColor);
      return {
        id: item.id,
        name: item.label,
        type: 'line',
        smooth: true,
        connectNulls: true,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: {
          width: 2,
          color: lineColor,
          opacity: 1,
        },
        itemStyle: {
          color: lineColor,
          opacity: 1,
        },
        emphasis: {
          disabled: true,
        },
        blur: {
          lineStyle: {
            opacity: 1,
          },
          itemStyle: {
            opacity: 1,
          },
        },
        data: axisData.map((axisPoint) => {
          const point = pointByEvent.get(axisPoint.eventId);
          if (!point) return null;
          const laneColor = point.lane === 'production' ? productionColor : canaryColor;
          return {
            value: point.value,
            qualityPoint: point,
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: {
              color: point.lane === 'production' ? laneColor : cardColor,
              borderColor: laneColor,
              borderWidth: 2,
            },
          } satisfies QualityEChartsDatum;
        }),
      };
    });

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: {
        top: 26,
        right: 24,
        bottom: axisData.length > 1 ? 62 : 38,
        left: 48,
        containLabel: false,
      },
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        confine: true,
        borderWidth: 1,
        borderColor,
        backgroundColor: popoverColor,
        textStyle: {
          color: foregroundColor,
          fontSize: 12,
          fontFamily: 'inherit',
        },
        extraCssText: 'box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22); border-radius: 6px;',
        axisPointer: {
          type: 'line',
          lineStyle: {
            color: borderColor,
            type: 'dashed',
          },
        },
        formatter: (rawParams: unknown) => {
          const params = (Array.isArray(rawParams) ? rawParams : [rawParams]) as QualityEChartsTooltipParam[];
          const points = params
            .map((param) => param.data?.qualityPoint)
            .filter((point): point is QualityChartPoint => Boolean(point));
          const point = points[0];
          if (!point) return '';
          const kindText = t(
            point.releaseVersionKind === 'production'
              ? 'releases.detail.history.versionKind.production'
              : 'releases.detail.history.versionKind.candidate',
          );
          const rows = params
            .map((param) => {
              const qualityPoint = param.data?.qualityPoint;
              if (!qualityPoint) return '';
              const sampleCount =
                qualityPoint.sampleCount === null
                  ? '—'
                  : formatTemplate(t('releases.detail.quality.sampleCountShort'), {
                      count: formatCount(qualityPoint.sampleCount),
                    });
              return [
                '<div style="display:flex;align-items:center;gap:8px;min-width:260px;margin-top:4px;">',
                param.marker ?? '',
                `<span style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${mutedColor};">${escapeHtml(
                  param.seriesName ?? qualityPoint.seriesLabel,
                )}</span>`,
                `<span style="font-family:JetBrains Mono, ui-monospace, monospace;font-weight:600;">${escapeHtml(
                  formatQualityPercent(qualityPoint.value),
                )}</span>`,
                `<span style="font-family:JetBrains Mono, ui-monospace, monospace;font-size:11px;color:${mutedColor};">${escapeHtml(
                  sampleCount,
                )}</span>`,
                '</div>',
              ].join('');
            })
            .join('');
          return [
            '<div style="min-width:280px;">',
            `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-family:JetBrains Mono, ui-monospace, monospace;font-size:11px;color:${mutedColor};">`,
            `<span>${escapeHtml(point.xLabel)}</span><span>·</span><span>${escapeHtml(
              formatDateTimeOrDash(point.updatedAt ?? point.createdAt),
            )}</span>`,
            '</div>',
            '<div style="display:flex;align-items:center;gap:8px;min-width:0;">',
            `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${escapeHtml(
              point.eventLabel,
            )}</span>`,
            `<span style="display:inline-flex;align-items:center;border-radius:999px;border:1px solid ${borderColor};padding:1px 6px;font-size:11px;color:${mutedColor};">${escapeHtml(
              kindText,
            )}</span>`,
            '</div>',
            `<div style="margin-top:2px;font-size:11.5px;color:${mutedColor};">${escapeHtml(
              point.releaseVersionLabel,
            )} · ${escapeHtml(point.promptVersionLabel)} · ${escapeHtml(point.modelName)}</div>`,
            `<div style="margin-top:8px;">${rows}</div>`,
            '</div>',
          ].join('');
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: categoryLabels,
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: mutedColor,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          hideOverlap: true,
          margin: 10,
        },
      },
      yAxis: {
        type: 'value',
        min: getQualityPercentAxisMin,
        max: getQualityPercentAxisMax,
        scale: true,
        splitNumber: 4,
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: mutedColor,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          formatter: '{value}%',
        },
        splitLine: {
          lineStyle: {
            color: borderColor,
            type: 'dashed',
            opacity: 0.7,
          },
        },
      },
      dataZoom:
        axisData.length > 1
          ? [
              {
                type: 'inside',
                xAxisIndex: 0,
                filterMode: 'filter',
                zoomOnMouseWheel: true,
                moveOnMouseWheel: 'shift',
                moveOnMouseMove: true,
                preventDefaultMouseMove: true,
                minValueSpan: 1,
              },
              {
                type: 'slider',
                xAxisIndex: 0,
                filterMode: 'filter',
                bottom: 10,
                height: 24,
                showDetail: false,
                brushSelect: true,
                minValueSpan: 1,
                borderColor,
                fillerColor: 'rgba(59, 130, 246, 0.18)',
                backgroundColor: 'transparent',
                dataBackground: {
                  lineStyle: {
                    color: borderColor,
                  },
                  areaStyle: {
                    color: 'rgba(148, 163, 184, 0.14)',
                  },
                },
                selectedDataBackground: {
                  lineStyle: {
                    color: primaryColor,
                  },
                  areaStyle: {
                    color: 'rgba(59, 130, 246, 0.22)',
                  },
                },
                moveHandleStyle: {
                  color: primaryColor,
                },
                handleStyle: {
                  color: cardColor,
                  borderColor: primaryColor,
                },
              },
            ]
          : [],
      toolbox: {
        show: axisData.length > 1,
        right: 8,
        top: 0,
        itemSize: 14,
        iconStyle: {
          borderColor: mutedColor,
        },
        emphasis: {
          iconStyle: {
            borderColor: foregroundColor,
          },
        },
        feature: {
          restore: {
            title: t('releases.detail.quality.chart.resetView'),
          },
        },
      },
      series: qualitySeries,
    };
  }, [axisData, chartColorVersion, formatDateTimeOrDash, series, t]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return undefined;
    const instance = echarts.init(element, undefined, { renderer: 'svg' });
    chartInstanceRef.current = instance;
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            instance.resize();
          });
    resizeObserver?.observe(element);
    return () => {
      resizeObserver?.disconnect();
      chartInstanceRef.current = null;
      instance.dispose();
    };
  }, []);

  useEffect(() => {
    chartInstanceRef.current?.setOption(chartOption, true);
  }, [chartOption]);

  return (
    <div className="relative min-w-0 w-full">
      <div className="relative h-[360px] min-w-0 w-full">
        <div
          ref={chartRef}
          className="h-full w-full"
          role="img"
          aria-label={t('releases.detail.quality.chartTitle')}
          data-testid="release-quality-echarts-chart"
        />
        {children ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
            <div className="pointer-events-auto w-full max-w-[360px] rounded-lg border bg-card/95 px-4 py-4 text-center shadow-sm">
              {children}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QualityEmptyChartMessage({ annotationHref }: { annotationHref: string }) {
  const { t } = useI18n();
  return (
    <div data-testid="release-quality-empty">
      <div className="text-[14px] font-semibold">{t('releases.detail.quality.empty')}</div>
      <p className="mx-auto mt-1 max-w-[300px] text-[12px] leading-5 text-muted-foreground">
        {t('releases.detail.quality.emptyDescription')}
      </p>
      <Button asChild size="sm" className="mt-3 h-8 gap-1.5">
        <Link href={annotationHref}>
          <Plus className="size-3.5" aria-hidden />
          {t('releases.detail.quality.emptyAction')}
        </Link>
      </Button>
    </div>
  );
}

function QualityFilteredEmptyChartMessage() {
  const { t } = useI18n();
  return (
    <div className="text-[13px] font-medium text-muted-foreground">{t('releases.detail.quality.filteredEmpty')}</div>
  );
}

type Translate = ReturnType<typeof useI18n>['t'];

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

type HistoryVersionKind = ReleaseLineEventDto['releaseVersionKind'];
type HistoryVersionRecord = ReleaseLineView['versions'][number];
type HistoryCanaryRecord = ReleaseLineView['canaryHistory'][number];

type HistoryConfigChangeItem = {
  field: string;
  previous: string;
  next: string;
};

type HistoryConfigChange = {
  id: string;
  at: string | null;
  event: ReleaseLineLatestEvent;
  items: HistoryConfigChangeItem[];
};

type HistoryMetaItem = {
  label: string;
  value: string;
  mono?: boolean;
};

export type HistoryRow = {
  id: string;
  sourceEventId: string | null;
  releaseVersionId: string | null;
  releaseVersionKind: HistoryVersionKind;
  releaseVersionLabel: string;
  productionNumber: number | null;
  targetProductionNumber: number | null;
  candidateNumber: number | null;
  event: ReleaseLineLatestEvent;
  laneType: ReleaseLineEventDto['laneType'] | null;
  promptName: string;
  promptVersionId: string | null;
  promptVersionLabel: string;
  modelId: string | null;
  modelName: string;
  modelProvider: string | null;
  inputConnectorName: string | null;
  inputConnectorType: string | null;
  outputConnectors: ReleaseLineEventDto['outputConnectors'];
  runConfig: Record<string, unknown>;
  trafficRatio: number | null;
  trafficMode: string | null;
  recordMode: string | null;
  recordCategories: string[];
  status: string | null;
  isLive: boolean;
  countSummary: string | null;
  relations: string | null;
  reason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  configChanges: HistoryConfigChange[];
};

export type HistoryGroup = {
  id: string;
  production: HistoryRow | null;
  candidates: HistoryRow[];
  isLive: boolean;
  sortAt: string | null;
  productionNumber: number | null;
};

const RELEASE_CONFIG_OPERATIONS = new Set<ReleaseLineEventDto['operation']>([
  'traffic_updated',
  'mode_updated',
  'config_changed',
]);

export function buildHistoryGroups(
  line: ReleaseLineView,
  releaseEvents: ReleaseLineEventDto[],
  productionHistory: ProductionReleaseHistoryItemDto[],
  t: Translate,
): HistoryGroup[] {
  if (releaseEvents.length > 0 || line.versions.length > 0) {
    return buildCanonicalHistoryGroups(line, releaseEvents, t);
  }
  return buildLegacyHistoryGroups(line, productionHistory, t);
}

function buildCanonicalHistoryGroups(line: ReleaseLineView, releaseEvents: ReleaseLineEventDto[], t: Translate) {
  const eventsByVersion = groupReleaseEventsByVersion(releaseEvents);
  const rowsByVersion = new Map<string, HistoryRow>();
  const looseRows: HistoryRow[] = [];

  for (const version of line.versions) {
    const events = eventsByVersion.get(version.id) ?? [];
    rowsByVersion.set(version.id, buildHistoryRowFromVersion(line, version, events, t));
  }

  for (const [key, events] of eventsByVersion.entries()) {
    if (rowsByVersion.has(key)) continue;
    looseRows.push(buildHistoryRowFromEvents(line, events, t));
  }

  const grouped = new Map<string, HistoryGroup>();
  for (const row of [...rowsByVersion.values(), ...looseRows]) {
    const key = getHistoryGroupKey(row);
    const group = ensureHistoryGroup(grouped, key, row);
    if (isProductionHistoryRow(row)) {
      group.production = chooseNewestHistoryRow(group.production, row);
      group.productionNumber = row.productionNumber ?? row.targetProductionNumber ?? group.productionNumber;
    } else {
      group.candidates.push(row);
    }
    group.isLive = group.isLive || isHistoryRowLive(row);
    group.sortAt = chooseNewestDate(group.sortAt, row.updatedAt ?? row.createdAt);
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      candidates: group.candidates.sort(compareHistoryRows),
    }))
    .sort(compareHistoryGroups);
}

function buildLegacyHistoryGroups(
  line: ReleaseLineView,
  productionHistory: ProductionReleaseHistoryItemDto[],
  t: Translate,
) {
  const productionRows = productionHistory.map((item) => buildLegacyProductionHistoryRow(item, t));
  const canaryRows = (line.canaryHistory.length > 0 ? line.canaryHistory : line.canary ? [line.canary] : []).map(
    (item) => buildLegacyCanaryHistoryRow(item, t),
  );
  if (productionRows.length === 0 && canaryRows.length === 0) return [];

  const groups = productionRows.map<HistoryGroup>((row) => ({
    id: row.id,
    production: row,
    candidates: [],
    isLive: isHistoryRowLive(row),
    sortAt: row.updatedAt ?? row.createdAt,
    productionNumber: row.productionNumber,
  }));
  const fallbackGroup =
    groups[0] ??
    ({
      id: canaryRows[0]?.id ?? 'legacy-canary',
      production: null,
      candidates: [],
      isLive: false,
      sortAt: canaryRows[0]?.updatedAt ?? canaryRows[0]?.createdAt ?? null,
      productionNumber: null,
    } satisfies HistoryGroup);

  if (groups.length === 0) groups.push(fallbackGroup);
  for (const row of canaryRows) {
    fallbackGroup.candidates.push(row);
    fallbackGroup.isLive = fallbackGroup.isLive || isHistoryRowLive(row);
    fallbackGroup.sortAt = chooseNewestDate(fallbackGroup.sortAt, row.updatedAt ?? row.createdAt);
  }

  return groups
    .map((group) => ({ ...group, candidates: group.candidates.sort(compareHistoryRows) }))
    .sort(compareHistoryGroups);
}

function groupReleaseEventsByVersion(events: ReleaseLineEventDto[]) {
  const grouped = new Map<string, ReleaseLineEventDto[]>();
  for (const event of events) {
    const key = event.releaseVersionId ?? event.id;
    const current = grouped.get(key) ?? [];
    current.push(event);
    grouped.set(key, current);
  }
  return grouped;
}

function buildHistoryRowFromVersion(
  line: ReleaseLineView,
  version: HistoryVersionRecord,
  events: ReleaseLineEventDto[],
  t: Translate,
): HistoryRow {
  const latest = getLatestReleaseEvent(events);
  const label = latest?.releaseVersionLabel ?? version.label;
  return {
    id: latest?.id ?? version.id,
    sourceEventId: latest?.id ?? null,
    releaseVersionId: version.id,
    releaseVersionKind: version.kind,
    releaseVersionLabel: label,
    productionNumber: version.productionVersionNumber,
    targetProductionNumber: version.targetProductionVersionNumber,
    candidateNumber: version.candidateNumber,
    event: latest?.operation ?? (version.kind === 'production' ? 'create_production' : 'create_canary'),
    laneType: latest?.laneType ?? (version.kind === 'production' ? 'production' : 'canary'),
    promptName: latest?.promptName ?? version.promptName,
    promptVersionId: latest?.promptVersionId ?? version.promptVersionId,
    promptVersionLabel:
      latest?.promptVersionLabel ??
      version.promptVersionLabel ??
      (version.promptVersionNumber ? `v${version.promptVersionNumber}` : formatShortId(version.promptVersionId)),
    modelId: latest?.modelId ?? version.modelId,
    modelName: formatHistoryModel(latest?.modelName ?? version.modelName, latest?.modelId ?? version.modelId),
    modelProvider: latest?.modelProvider ?? version.modelProvider,
    inputConnectorName: latest?.inputConnectorName ?? line.inputConnectorName,
    inputConnectorType: latest?.inputConnectorType ?? line.inputConnectorType,
    outputConnectors: latest?.outputConnectors ?? line.outputConnectors,
    runConfig: normalizeRunConfig(latest?.runConfig),
    trafficRatio: latest?.trafficRatio ?? null,
    trafficMode: latest?.trafficMode ?? null,
    recordMode: latest?.recordMode ?? null,
    recordCategories: latest?.recordCategories ?? [],
    status: latest ? formatReleaseEventStatus(latest) : null,
    isLive: latest?.status === 'running',
    countSummary: latest ? formatReleaseEventCounts(latest, t) : null,
    relations: latest ? formatReleaseEventRelations(latest, t) : null,
    reason: latest?.submitReason.trim() || null,
    createdAt: latest?.createdAt ?? version.createdAt,
    updatedAt: latest?.updatedAt ?? version.updatedAt,
    configChanges: buildReleaseConfigChanges(events, t),
  };
}

function buildHistoryRowFromEvents(line: ReleaseLineView, events: ReleaseLineEventDto[], t: Translate): HistoryRow {
  const latest = getLatestReleaseEvent(events);
  if (!latest) {
    return {
      id: 'empty',
      sourceEventId: null,
      releaseVersionId: null,
      releaseVersionKind: null,
      releaseVersionLabel: '—',
      productionNumber: null,
      targetProductionNumber: null,
      candidateNumber: null,
      event: null,
      laneType: null,
      promptName: line.promptName,
      promptVersionId: null,
      promptVersionLabel: '—',
      modelId: null,
      modelName: '—',
      modelProvider: null,
      inputConnectorName: line.inputConnectorName,
      inputConnectorType: line.inputConnectorType,
      outputConnectors: line.outputConnectors,
      runConfig: {},
      trafficRatio: null,
      trafficMode: null,
      recordMode: null,
      recordCategories: [],
      status: null,
      isLive: false,
      countSummary: null,
      relations: null,
      reason: null,
      createdAt: null,
      updatedAt: null,
      configChanges: [],
    };
  }

  return {
    id: latest.id,
    sourceEventId: latest.id,
    releaseVersionId: latest.releaseVersionId,
    releaseVersionKind: latest.releaseVersionKind,
    releaseVersionLabel: latest.releaseVersionLabel ?? formatShortId(latest.releaseVersionId),
    productionNumber: latest.releaseVersionProductionNumber,
    targetProductionNumber: latest.releaseVersionTargetProductionNumber,
    candidateNumber: latest.releaseVersionCandidateNumber,
    event: latest.operation,
    laneType: latest.laneType,
    promptName: latest.promptName,
    promptVersionId: latest.promptVersionId,
    promptVersionLabel: latest.promptVersionLabel ?? formatShortId(latest.promptVersionId),
    modelId: latest.modelId,
    modelName: formatHistoryModel(latest.modelName, latest.modelId),
    modelProvider: latest.modelProvider,
    inputConnectorName: latest.inputConnectorName ?? line.inputConnectorName,
    inputConnectorType: latest.inputConnectorType ?? line.inputConnectorType,
    outputConnectors: latest.outputConnectors.length > 0 ? latest.outputConnectors : line.outputConnectors,
    runConfig: normalizeRunConfig(latest.runConfig),
    trafficRatio: latest.trafficRatio,
    trafficMode: latest.trafficMode,
    recordMode: latest.recordMode,
    recordCategories: latest.recordCategories,
    status: formatReleaseEventStatus(latest),
    isLive: latest.status === 'running',
    countSummary: formatReleaseEventCounts(latest, t),
    relations: formatReleaseEventRelations(latest, t),
    reason: latest.submitReason.trim() || null,
    createdAt: latest.createdAt,
    updatedAt: latest.updatedAt,
    configChanges: buildReleaseConfigChanges(events, t),
  };
}

function buildLegacyProductionHistoryRow(item: ProductionReleaseHistoryItemDto, t: Translate): HistoryRow {
  const configChanges =
    item.eventType === 'config_change'
      ? [
          {
            id: item.id,
            at: item.updatedAt,
            event: item.eventType,
            items: buildLegacyProductionConfigItems(item, t),
          },
        ]
      : [];
  const relations = [
    item.sourceExperimentId
      ? `${t('releases.detail.history.relation.sourceExperiment')} ${formatShortId(item.sourceExperimentId)}`
      : null,
    item.sourceCanaryId
      ? `${t('releases.detail.history.relation.sourceEvent')} ${formatShortId(item.sourceCanaryId)}`
      : null,
    item.rollbackTargetEventId
      ? `${t('releases.detail.history.relation.rollbackTarget')} ${formatShortId(item.rollbackTargetEventId)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    id: item.id,
    sourceEventId: item.id,
    releaseVersionId: null,
    releaseVersionKind: 'production',
    releaseVersionLabel: item.promptVersionLabel ?? formatShortId(item.id),
    productionNumber: null,
    targetProductionNumber: null,
    candidateNumber: null,
    event: item.eventType,
    laneType: 'production',
    promptName: item.promptVersionLabel ?? '—',
    promptVersionId: item.promptVersionId,
    promptVersionLabel: item.promptVersionLabel ?? formatShortId(item.promptVersionId),
    modelId: item.modelId,
    modelName: item.modelName ?? formatShortId(item.modelId),
    modelProvider: null,
    inputConnectorName: item.inputConnectorName,
    inputConnectorType: null,
    outputConnectors: [],
    runConfig: normalizeRunConfig(item.runConfig),
    trafficRatio: null,
    trafficMode: null,
    recordMode: item.recordMode,
    recordCategories: item.recordCategories ?? [],
    status: formatLegacyProductionStatus(item),
    isLive: item.status === 'running',
    countSummary: null,
    relations: relations.length > 0 ? relations.join(' · ') : null,
    reason: item.submitReason.trim() || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    configChanges,
  };
}

function buildLegacyCanaryHistoryRow(canary: HistoryCanaryRecord, t: Translate): HistoryRow {
  return {
    id: canary.id,
    sourceEventId: canary.id,
    releaseVersionId: canary.releaseVersionId,
    releaseVersionKind: 'candidate',
    releaseVersionLabel: canary.releaseVersionLabel ?? canary.promptVersionLabel ?? formatShortId(canary.id),
    productionNumber: null,
    targetProductionNumber: null,
    candidateNumber: null,
    event: canary.status === 'running' ? 'ratio_change' : 'create_canary',
    laneType: 'canary',
    promptName: canary.promptName ?? canary.name ?? '—',
    promptVersionId: canary.promptVersionId,
    promptVersionLabel: canary.promptVersionLabel ?? formatShortId(canary.promptVersionId),
    modelId: canary.modelId,
    modelName: formatHistoryModel(canary.modelName, canary.modelId, canary.modelProvider),
    modelProvider: canary.modelProvider,
    inputConnectorName: canary.inputConnectorName,
    inputConnectorType: canary.inputConnectorType,
    outputConnectors: canary.outputConnectors,
    runConfig: normalizeRunConfig(canary.runConfig),
    trafficRatio: canary.trafficRatio,
    trafficMode: canary.trafficMode,
    recordMode: canary.recordMode,
    recordCategories: canary.recordCategories ?? [],
    status: canary.status,
    isLive: canary.status === 'running',
    countSummary: formatCanaryCounts(canary, t),
    relations: null,
    reason: canary.description?.trim() || null,
    createdAt: canary.createdAt,
    updatedAt: canary.updatedAt,
    configChanges: [],
  };
}

function formatReleaseEventStatus(event: ReleaseLineEventDto) {
  const parts = [
    event.status,
    event.terminalReason ? `${event.terminalReason}` : null,
    event.controlState ? `${event.controlState}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join(' · ') || '—';
}

function formatLegacyProductionStatus(item: ProductionReleaseHistoryItemDto) {
  return [item.status, item.stopReason, item.controlState].filter(Boolean).join(' · ') || '—';
}

function formatHistoryModel(name: string | null | undefined, id: string | null | undefined, provider?: string | null) {
  const model = name ?? formatShortId(id);
  return provider ? `${model} · ${provider}` : model;
}

function formatRecordMode(mode: string | null | undefined, t: Translate, categories: string[] = []) {
  if (mode === 'all') return t('releases.detail.topology.recordMode.all');
  if (mode === 'selected_categories' || mode === 'correct_only') {
    const label = t('releases.detail.topology.recordMode.selectedCategories');
    return categories.length > 0 ? `${label}: ${categories.join('、')}` : label;
  }
  return mode || '—';
}

function formatReleaseEventCounts(event: ReleaseLineEventDto, t: Translate) {
  return [
    `${t('releases.detail.metric.received')} ${formatCount(event.totalReceived)}`,
    `${t('releases.detail.metric.processed')} ${formatCount(event.totalProcessed)}`,
    `${t('releases.detail.metric.errors')} ${formatCount(event.totalErrors)}`,
  ].join(' · ');
}

function formatCanaryCounts(canary: NonNullable<ReleaseLineView['canary']>, t: Translate) {
  return [
    `${t('releases.detail.metric.received')} ${formatCount(canary.totalReceived)}`,
    `${t('releases.detail.metric.processed')} ${formatCount(canary.totalProcessed)}`,
    `${t('releases.detail.metric.errors')} ${formatCount(canary.totalErrors)}`,
  ].join(' · ');
}

function formatReleaseEventRelations(event: ReleaseLineEventDto, t: Translate) {
  const parts = [
    event.sourceEventId
      ? `${t('releases.detail.history.relation.sourceEvent')} ${formatShortId(event.sourceEventId)}`
      : null,
    event.supersedesEventId
      ? `${t('releases.detail.history.relation.supersedes')} ${formatShortId(event.supersedesEventId)}`
      : null,
    event.rollbackTargetEventId
      ? `${t('releases.detail.history.relation.rollbackTarget')} ${formatShortId(event.rollbackTargetEventId)}`
      : null,
    event.sourceExperimentId
      ? `${t('releases.detail.history.relation.sourceExperiment')} ${formatShortId(event.sourceExperimentId)}`
      : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' · ') : null;
}

function ensureHistoryGroup(map: Map<string, HistoryGroup>, id: string, seed: HistoryRow) {
  const current = map.get(id);
  if (current) return current;
  const next: HistoryGroup = {
    id,
    production: null,
    candidates: [],
    isLive: false,
    sortAt: seed.updatedAt ?? seed.createdAt,
    productionNumber: seed.productionNumber ?? seed.targetProductionNumber,
  };
  map.set(id, next);
  return next;
}

function chooseNewestHistoryRow(current: HistoryRow | null, next: HistoryRow) {
  if (!current) return next;
  return timeValue(next.updatedAt ?? next.createdAt) >= timeValue(current.updatedAt ?? current.createdAt)
    ? next
    : current;
}

function chooseNewestDate(current: string | null, next: string | null | undefined) {
  if (!next) return current;
  if (!current) return next;
  return timeValue(next) >= timeValue(current) ? next : current;
}

function compareHistoryRows(left: HistoryRow, right: HistoryRow) {
  const candidateDelta = (right.candidateNumber ?? 0) - (left.candidateNumber ?? 0);
  if (candidateDelta !== 0) return candidateDelta;
  return timeValue(right.updatedAt ?? right.createdAt) - timeValue(left.updatedAt ?? left.createdAt);
}

export function compareHistoryGroups(left: HistoryGroup, right: HistoryGroup) {
  // Total order, "newest production first":
  // 1. Groups WITH a productionNumber rank above those without (candidate-only / legacy),
  //    so a numbered production group never sinks below a null group on timestamp alone.
  // 2. Within numbered groups: productionNumber descending.
  // 3. Within null groups (single class): sortAt descending.
  // 4. Ties: sortAt descending.
  const leftHasNumber = left.productionNumber !== null;
  const rightHasNumber = right.productionNumber !== null;
  if (leftHasNumber !== rightHasNumber) return leftHasNumber ? -1 : 1;
  if (leftHasNumber && rightHasNumber) {
    const numberDelta = right.productionNumber! - left.productionNumber!;
    if (numberDelta !== 0) return numberDelta;
  }
  return timeValue(right.sortAt) - timeValue(left.sortAt);
}

function getLatestReleaseEvent(events: ReleaseLineEventDto[]) {
  return [...events].sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt))[0] ?? null;
}

function isProductionHistoryRow(row: HistoryRow) {
  return row.releaseVersionKind === 'production' || row.laneType === 'production';
}

export function isHistoryRowLive(row: HistoryRow) {
  return row.isLive;
}

function getHistoryGroupKey(row: HistoryRow) {
  const productionNumber =
    row.releaseVersionKind === 'candidate'
      ? row.targetProductionNumber
      : (row.productionNumber ?? row.targetProductionNumber);
  if (productionNumber !== null) return `production-${productionNumber}`;
  return row.releaseVersionId ?? row.id;
}

function normalizeRunConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function getRunConfigNumber(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildReleaseConfigChanges(events: ReleaseLineEventDto[], t: Translate): HistoryConfigChange[] {
  const sorted = [...events].sort((left, right) => timeValue(left.updatedAt) - timeValue(right.updatedAt));
  const changes: HistoryConfigChange[] = [];
  sorted.forEach((event, index) => {
    if (!RELEASE_CONFIG_OPERATIONS.has(event.operation)) return;
    const previous =
      [...sorted.slice(0, index)].reverse().find((item) => item.releaseVersionId === event.releaseVersionId) ?? null;
    changes.push({
      id: event.id,
      at: event.updatedAt ?? event.createdAt,
      event: event.operation,
      items: buildConfigChangeItems(previous, event, t),
    });
  });
  return changes;
}

function buildLegacyProductionConfigItems(
  item: ProductionReleaseHistoryItemDto,
  t: Translate,
): HistoryConfigChangeItem[] {
  const config = normalizeRunConfig(item.runConfig);
  const changes: HistoryConfigChangeItem[] = [];
  addConfigChange(
    changes,
    t('releases.detail.topology.field.rpmLimit'),
    '—',
    formatHistoryNumber(getRunConfigNumber(config, 'rpmLimit')),
    true,
  );
  addConfigChange(
    changes,
    t('releases.detail.topology.field.tpmLimit'),
    '—',
    formatHistoryNumber(getRunConfigNumber(config, 'tpmLimit')),
    true,
  );
  addConfigChange(
    changes,
    t('releases.detail.topology.field.concurrency'),
    '—',
    formatHistoryNumber(getRunConfigNumber(config, 'concurrency')),
    true,
  );
  addConfigChange(
    changes,
    t('releases.detail.topology.field.temperature'),
    '—',
    formatHistoryTemperature(getRunConfigNumber(config, 'temperature')),
    true,
  );
  if (changes.length > 0) return changes;
  return [
    {
      field: t('releases.detail.history.field.snapshot'),
      previous: '—',
      next: t('releases.detail.history.change.updated'),
    },
  ];
}

function buildConfigChangeItems(
  previous: ReleaseLineEventDto | null,
  current: ReleaseLineEventDto,
  t: Translate,
): HistoryConfigChangeItem[] {
  const previousConfig = normalizeRunConfig(previous?.runConfig);
  const currentConfig = normalizeRunConfig(current.runConfig);
  const changes: HistoryConfigChangeItem[] = [];
  const includeInitial = previous === null;

  addConfigChange(
    changes,
    t('releases.detail.history.traffic'),
    formatRatioValue(previous?.trafficRatio ?? null),
    formatRatioValue(current.trafficRatio),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.history.field.trafficMode'),
    previous?.trafficMode ?? '—',
    current.trafficMode ?? '—',
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.topology.field.rpmLimit'),
    formatHistoryNumber(getRunConfigNumber(previousConfig, 'rpmLimit')),
    formatHistoryNumber(getRunConfigNumber(currentConfig, 'rpmLimit')),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.topology.field.tpmLimit'),
    formatHistoryNumber(getRunConfigNumber(previousConfig, 'tpmLimit')),
    formatHistoryNumber(getRunConfigNumber(currentConfig, 'tpmLimit')),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.topology.field.concurrency'),
    formatHistoryNumber(getRunConfigNumber(previousConfig, 'concurrency')),
    formatHistoryNumber(getRunConfigNumber(currentConfig, 'concurrency')),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.topology.field.temperature'),
    formatHistoryTemperature(getRunConfigNumber(previousConfig, 'temperature')),
    formatHistoryTemperature(getRunConfigNumber(currentConfig, 'temperature')),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.history.model'),
    formatHistoryModel(previous?.modelName, previous?.modelId, previous?.modelProvider),
    formatHistoryModel(current.modelName, current.modelId, current.modelProvider),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.field.upstream'),
    formatConnectorLabel(previous?.inputConnectorName ?? null, previous?.inputConnectorType ?? null),
    formatConnectorLabel(current.inputConnectorName, current.inputConnectorType),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.history.field.outputConnectors'),
    formatOutputConnectors(previous?.outputConnectors ?? []),
    formatOutputConnectors(current.outputConnectors),
    includeInitial,
  );
  addConfigChange(
    changes,
    t('releases.detail.history.recordMode'),
    formatRecordMode(previous?.recordMode, t, previous?.recordCategories ?? []),
    formatRecordMode(current.recordMode, t, current.recordCategories),
    includeInitial,
  );

  if (changes.length > 0) return changes;
  return [
    {
      field: t('releases.detail.history.field.snapshot'),
      previous: '—',
      next: t('releases.detail.history.change.updated'),
    },
  ];
}

function addConfigChange(
  changes: HistoryConfigChangeItem[],
  field: string,
  previous: string,
  next: string,
  includeInitial = false,
) {
  if (next === '—') return;
  if (!includeInitial && previous === next) return;
  changes.push({ field, previous, next });
}

function formatRatioValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

function formatHistoryNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? formatCount(value) : formatHistoryTemperature(value);
}

function formatHistoryTemperature(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function formatConnectorLabel(name: string | null | undefined, type: string | null | undefined) {
  if (!name && !type) return '—';
  return [type, name].filter((value): value is string => Boolean(value)).join(' · ');
}

function formatOutputConnectors(connectors: ReleaseLineEventDto['outputConnectors']) {
  if (connectors.length === 0) return '—';
  return connectors.map((connector) => formatConnectorLabel(connector.name, connector.type)).join(' / ');
}

function formatHistoryVersionLabel(label: string) {
  return label.replace(/^v(?=\d)/, 'V');
}

function buildHistoryRuntimeItems(row: HistoryRow, t: Translate): HistoryMetaItem[] {
  const items: HistoryMetaItem[] = [];
  const rpm = getRunConfigNumber(row.runConfig, 'rpmLimit');
  const tpm = getRunConfigNumber(row.runConfig, 'tpmLimit');
  const concurrency = getRunConfigNumber(row.runConfig, 'concurrency');
  const temperature = getRunConfigNumber(row.runConfig, 'temperature');

  if (row.trafficRatio !== null || row.trafficMode) {
    items.push({ label: t('releases.detail.history.traffic'), value: formatReleaseRowTraffic(row), mono: true });
  }
  if (rpm !== null)
    items.push({ label: t('releases.detail.topology.field.rpmLimit'), value: formatHistoryNumber(rpm), mono: true });
  if (tpm !== null)
    items.push({ label: t('releases.detail.topology.field.tpmLimit'), value: formatHistoryNumber(tpm), mono: true });
  if (concurrency !== null) {
    items.push({
      label: t('releases.detail.topology.field.concurrency'),
      value: formatHistoryNumber(concurrency),
      mono: true,
    });
  }
  if (temperature !== null) {
    items.push({
      label: t('releases.detail.topology.field.temperature'),
      value: formatHistoryTemperature(temperature),
      mono: true,
    });
  }
  if (row.recordMode) {
    items.push({
      label: t('releases.detail.history.recordMode'),
      value: formatRecordMode(row.recordMode, t, row.recordCategories),
      mono: true,
    });
  }
  return items;
}

function buildHistoryConnectorItems(row: HistoryRow, t: Translate): HistoryMetaItem[] {
  return [
    {
      label: t('releases.detail.field.upstream'),
      value: formatConnectorLabel(row.inputConnectorName, row.inputConnectorType),
    },
    {
      label: t('releases.detail.field.downstream'),
      value:
        row.outputConnectors.length > 0
          ? formatOutputConnectors(row.outputConnectors)
          : t('releases.detail.history.field.noDownstream'),
    },
  ];
}

function buildHistoryReasonItems(row: HistoryRow, t: Translate): HistoryMetaItem[] {
  if (!row.reason) return [];
  return [{ label: t('releases.detail.history.reason'), value: row.reason }];
}

function formatReleaseRowTraffic(row: HistoryRow) {
  return (
    [formatRatioValue(row.trafficRatio), row.trafficMode].filter((value) => value && value !== '—').join(' · ') || '—'
  );
}

function buildReleaseResultsHref(line: ReleaseLineView, row: HistoryRow) {
  if (!row.releaseVersionId) return null;
  return `/releases/${encodeURIComponent(line.id)}?tab=results&version=${encodeURIComponent(row.releaseVersionId)}`;
}

function buildAnnotationHref(line: ReleaseLineView, row: HistoryRow) {
  if (!row.releaseVersionId) return null;
  return `/annotations/new?line=${encodeURIComponent(line.id)}&version=${encodeURIComponent(row.releaseVersionId)}`;
}

function buildQualityAnnotationHref(line: ReleaseLineView, releaseEvents: ReleaseLineEventDto[]) {
  const latestEvent = [...releaseEvents]
    .filter((event) => Boolean(event.releaseVersionId))
    .sort(
      (left, right) => timeValue(right.updatedAt ?? right.createdAt) - timeValue(left.updatedAt ?? left.createdAt),
    )[0];
  const params = new URLSearchParams({ line: line.id });
  if (latestEvent?.releaseVersionId) params.set('version', latestEvent.releaseVersionId);
  return `/annotations/new?${params.toString()}`;
}

function HistoryPane({
  projectId,
  line,
  productionHistory,
  releaseEvents,
  loading,
}: {
  projectId: string;
  line: ReleaseLineView;
  productionHistory: ProductionReleaseHistoryItemDto[];
  releaseEvents: ReleaseLineEventDto[];
  loading: boolean;
}) {
  const { t } = useI18n();
  const formatDateTimeOrDash = useDateTimeOrDash();
  const restoreToProductionMutation = useRestoreReleaseLineHistoryToProduction(projectId);
  const restoreToCanaryMutation = useRestoreReleaseLineHistoryToCanary(projectId);
  const restorePending = restoreToProductionMutation.isPending || restoreToCanaryMutation.isPending;
  const [restoreFeedback, setRestoreFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const groups = useMemo(
    () => buildHistoryGroups(line, releaseEvents, productionHistory, t),
    [line, productionHistory, releaseEvents, t],
  );
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({});
  const [configOpen, setConfigOpen] = useState<Record<string, boolean>>({});
  const historyGroupResetKey = `${line.id}:${groups.length}`;
  const [visibleGroupState, setVisibleGroupState] = useState(() => ({
    key: historyGroupResetKey,
    count: HISTORY_INITIAL_GROUP_LIMIT,
  }));
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const loadingMoreKeyRef = useRef<string | null>(null);
  const loadMoreTimerRef = useRef<number | null>(null);
  const showLoader = useDelayedLoading(loading);
  const visibleGroupCount =
    visibleGroupState.key === historyGroupResetKey ? visibleGroupState.count : HISTORY_INITIAL_GROUP_LIMIT;
  const visibleGroups = useMemo(() => groups.slice(0, visibleGroupCount), [groups, visibleGroupCount]);
  const hasMoreGroups = visibleGroupCount < groups.length;
  const isLoadingMoreGroups = loadingMoreKey === historyGroupResetKey && hasMoreGroups;

  const restoreHistoryToProduction = useCallback(
    (row: HistoryRow, versionLabel: string) => {
      if (!row.sourceEventId || line.status === 'archived') return;
      setRestoreFeedback(null);
      restoreToProductionMutation.mutate(
        {
          releaseLineId: line.id,
          body: {
            sourceEventId: row.sourceEventId,
            reason: formatTemplate(t('releases.detail.history.action.restoreToProductionReason'), {
              version: versionLabel,
            }),
          },
        },
        {
          onSuccess: () =>
            setRestoreFeedback({
              tone: 'success',
              message: t('releases.detail.history.action.restoreSuccess'),
            }),
          onError: (error) =>
            setRestoreFeedback({
              tone: 'error',
              message: getApiErrorMessage(error) ?? t('releases.detail.history.action.restoreFailed'),
            }),
        },
      );
    },
    [line.id, line.status, restoreToProductionMutation, t],
  );

  const restoreHistoryToCanary = useCallback(
    (row: HistoryRow, versionLabel: string) => {
      if (!row.sourceEventId || line.status === 'archived') return;
      setRestoreFeedback(null);
      restoreToCanaryMutation.mutate(
        {
          releaseLineId: line.id,
          body: {
            sourceEventId: row.sourceEventId,
            reason: formatTemplate(t('releases.detail.history.action.restoreToCanaryReason'), {
              version: versionLabel,
            }),
          },
        },
        {
          onSuccess: () =>
            setRestoreFeedback({
              tone: 'success',
              message: t('releases.detail.history.action.restoreSuccess'),
            }),
          onError: (error) =>
            setRestoreFeedback({
              tone: 'error',
              message: getApiErrorMessage(error) ?? t('releases.detail.history.action.restoreFailed'),
            }),
        },
      );
    },
    [line.id, line.status, restoreToCanaryMutation, t],
  );

  const loadMoreHistoryGroups = useCallback(() => {
    if (!hasMoreGroups) return;
    if (loadingMoreKeyRef.current === historyGroupResetKey) return;

    loadingMoreKeyRef.current = historyGroupResetKey;
    setLoadingMoreKey(historyGroupResetKey);
    setVisibleGroupState((current) => {
      const currentCount = current.key === historyGroupResetKey ? current.count : HISTORY_INITIAL_GROUP_LIMIT;
      return {
        key: historyGroupResetKey,
        count: Math.min(groups.length, currentCount + HISTORY_GROUP_PAGE_SIZE),
      };
    });

    if (loadMoreTimerRef.current) window.clearTimeout(loadMoreTimerRef.current);
    loadMoreTimerRef.current = window.setTimeout(() => {
      loadingMoreKeyRef.current = null;
      setLoadingMoreKey((current) => (current === historyGroupResetKey ? null : current));
      loadMoreTimerRef.current = null;
    }, 360);
  }, [groups.length, hasMoreGroups, historyGroupResetKey]);

  useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current) {
        window.clearTimeout(loadMoreTimerRef.current);
        loadMoreTimerRef.current = null;
      }
      loadingMoreKeyRef.current = null;
    };
  }, []);

  if (loading) {
    return showLoader ? <PlatformLoader className="py-8" size="sm" /> : null;
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        {t('releases.detail.history.empty')}
      </div>
    );
  }

  return (
    <section className="w-full" aria-label={t('releases.detail.history.title')}>
      {restoreFeedback ? (
        <div
          role={restoreFeedback.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px]',
            restoreFeedback.tone === 'error'
              ? 'border-destructive/35 bg-destructive/5 text-destructive'
              : 'border-border bg-muted/55 text-muted-foreground',
          )}
        >
          {restoreFeedback.tone === 'error' ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />}
          <span>{restoreFeedback.message}</span>
        </div>
      ) : null}
      <div className="relative pl-[30px]">
        {visibleGroups.map((group, index) => {
          const headline = group.production ?? group.candidates[0] ?? null;
          if (!headline) return null;
          const children = group.production ? group.candidates : group.candidates.slice(1);
          const defaultOpen = group.isLive || index === 0;
          const isOpen = groupOpen[group.id] ?? defaultOpen;
          return (
            <div key={group.id} className="relative mb-4">
              <div className="absolute bottom-3.5 left-[-22px] top-[18px] w-[1.5px] bg-border" aria-hidden />
              <HistoryVersionCard
                line={line}
                row={headline}
                variant={isProductionHistoryRow(headline) ? 'production' : 'canary'}
                live={group.isLive && isProductionHistoryRow(headline)}
                hasChildren={children.length > 0}
                childrenOpen={isOpen}
                moreOpen={Boolean(moreOpen[headline.id])}
                configOpen={Boolean(configOpen[headline.id])}
                onToggleChildren={() =>
                  setGroupOpen((current) => ({
                    ...current,
                    [group.id]: !(current[group.id] ?? defaultOpen),
                  }))
                }
                onToggleMore={() =>
                  setMoreOpen((current) => ({
                    ...current,
                    [headline.id]: !current[headline.id],
                  }))
                }
                onToggleConfig={() =>
                  setConfigOpen((current) => ({
                    ...current,
                    [headline.id]: !current[headline.id],
                  }))
                }
                onRestoreToProduction={restoreHistoryToProduction}
                onRestoreToCanary={restoreHistoryToCanary}
                restorePending={restorePending}
                formatDateTimeOrDash={formatDateTimeOrDash}
              />
              {isOpen && children.length > 0 ? (
                <div className="mb-0.5 mt-2.5 flex flex-col gap-2.5">
                  {children.map((row) => (
                    <HistoryVersionCard
                      key={row.id}
                      line={line}
                      row={row}
                      variant="canary"
                      compact
                      live={isHistoryRowLive(row)}
                      hasChildren={false}
                      childrenOpen={false}
                      moreOpen={Boolean(moreOpen[row.id])}
                      configOpen={Boolean(configOpen[row.id])}
                      onToggleChildren={() => undefined}
                      onToggleMore={() =>
                        setMoreOpen((current) => ({
                          ...current,
                          [row.id]: !current[row.id],
                        }))
                      }
                      onToggleConfig={() =>
                        setConfigOpen((current) => ({
                          ...current,
                          [row.id]: !current[row.id],
                        }))
                      }
                      onRestoreToProduction={restoreHistoryToProduction}
                      onRestoreToCanary={restoreHistoryToCanary}
                      restorePending={restorePending}
                      formatDateTimeOrDash={formatDateTimeOrDash}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {hasMoreGroups ? (
        <HistoryLoadMoreIndicator
          loading={isLoadingMoreGroups}
          label={
            isLoadingMoreGroups ? t('releases.detail.history.loadingMore') : t('releases.detail.history.moreAvailable')
          }
          onClick={loadMoreHistoryGroups}
        />
      ) : null}
    </section>
  );
}

function HistoryLoadMoreIndicator({
  loading,
  label,
  onClick,
}: {
  loading: boolean;
  label: string;
  onClick: () => void;
}) {
  if (!loading) {
    return (
      <div className="flex justify-center py-3">
        <button
          type="button"
          onClick={onClick}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3.5 text-[12px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronDown className="size-3.5" aria-hidden />
          <span>{label}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-center py-4" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      <span className="relative flex h-8 w-28 items-center justify-center" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border to-transparent" />
        <span className="relative inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 shadow-sm">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 rounded-full bg-muted-foreground/80 motion-safe:animate-bounce"
              style={{ animationDelay: `${index * 120}ms` }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

function HistoryVersionCard({
  line,
  row,
  variant,
  live,
  compact = false,
  hasChildren,
  childrenOpen,
  moreOpen,
  configOpen,
  onToggleChildren,
  onToggleMore,
  onToggleConfig,
  onRestoreToProduction,
  onRestoreToCanary,
  restorePending,
  formatDateTimeOrDash,
}: {
  line: ReleaseLineView;
  row: HistoryRow;
  variant: 'production' | 'canary';
  live: boolean;
  compact?: boolean;
  hasChildren: boolean;
  childrenOpen: boolean;
  moreOpen: boolean;
  configOpen: boolean;
  onToggleChildren: () => void;
  onToggleMore: () => void;
  onToggleConfig: () => void;
  onRestoreToProduction: (row: HistoryRow, versionLabel: string) => void;
  onRestoreToCanary: (row: HistoryRow, versionLabel: string) => void;
  restorePending: boolean;
  formatDateTimeOrDash: (value: string | null | undefined) => string;
}) {
  const { t } = useI18n();
  const isProduction = variant === 'production';
  const runtimeItems = buildHistoryRuntimeItems(row, t);
  const connectorItems = buildHistoryConnectorItems(row, t);
  const reasonItems = buildHistoryReasonItems(row, t);
  const hasConfig = row.configChanges.length > 0;
  const dateLabel = formatDateTimeOrDash(row.updatedAt ?? row.createdAt);
  const resultsHref = buildReleaseResultsHref(line, row);
  const annotationHref = buildAnnotationHref(line, row);
  const versionLabel = formatHistoryVersionLabel(row.releaseVersionLabel || '—');
  const expandLabel = formatTemplate(
    t(childrenOpen ? 'releases.detail.history.action.collapseVersion' : 'releases.detail.history.action.expandVersion'),
    { version: versionLabel },
  );
  const moreLabel = formatTemplate(t('releases.detail.history.action.moreInfo'), { version: versionLabel });
  const configLabel = formatTemplate(t('releases.detail.history.action.configChanges'), { version: versionLabel });
  const resultLabel = formatTemplate(t('releases.detail.history.action.viewResults'), { version: versionLabel });
  const annotationLabel = formatTemplate(t('releases.detail.history.action.createAnnotation'), {
    version: versionLabel,
  });
  const actionMenuLabel = formatTemplate(t('releases.detail.history.action.moreActions'), { version: versionLabel });
  const restoreDisabled = !row.sourceEventId || line.status === 'archived' || restorePending;
  const restoreHistoryRow = () => {
    if (isProduction) onRestoreToProduction(row, versionLabel);
    else onRestoreToCanary(row, versionLabel);
  };
  const rowClickProps = hasChildren
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-expanded': childrenOpen,
        'aria-label': expandLabel,
        onClick: onToggleChildren,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onToggleChildren();
        },
      }
    : {};

  return (
    <div
      {...rowClickProps}
      className={cn(
        'relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border bg-card px-[15px] shadow-sm transition-shadow hover:shadow-md',
        hasChildren && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'py-[11px]' : 'py-[13px]',
      )}
      style={
        live && isProduction
          ? {
              borderColor: 'color-mix(in srgb, var(--src-prod) 35%, var(--border))',
              boxShadow: '0 1px 3px color-mix(in srgb, var(--src-prod) 12%, transparent)',
            }
          : undefined
      }
    >
      <span
        className={cn(
          'absolute z-10 rounded-full bg-card',
          isProduction
            ? 'left-[-29px] top-[14px] size-4 border-[2.5px]'
            : 'left-[-26px] top-[15px] size-2.5 border-[2.5px]',
        )}
        style={{
          background: live ? (isProduction ? 'var(--src-prod)' : 'var(--src-canary)') : 'var(--card)',
          borderColor: isProduction ? (live ? 'var(--src-prod)' : 'var(--muted-foreground)') : 'var(--src-canary)',
          boxShadow: live
            ? `0 0 0 4px color-mix(in srgb, ${isProduction ? 'var(--src-prod)' : 'var(--src-canary)'} 16%, transparent)`
            : undefined,
        }}
        aria-hidden
      />
      <span
        className="absolute left-[-14px] top-[19px] h-[1.5px] w-[11px] bg-border"
        style={!isProduction ? { background: 'color-mix(in srgb, var(--src-canary) 35%, var(--border))' } : undefined}
        aria-hidden
      />

      <HistoryVersionBadge label={versionLabel} variant={variant} compact={compact} />

      <div className="flex min-w-0 flex-1 items-center">
        <div className="flex w-[200px] min-w-0 shrink-0 items-baseline gap-[7px] whitespace-nowrap">
          <span className="shrink-0 text-[11.5px] text-muted-foreground">{t('releases.detail.history.model')}</span>
          <span className="min-w-0 truncate text-[13.5px] font-medium text-foreground">{row.modelName}</span>
        </div>
        <div className="flex w-[212px] min-w-0 shrink-0 items-baseline gap-[7px] whitespace-nowrap">
          <span className="shrink-0 text-[11.5px] text-muted-foreground">
            {t('releases.detail.history.field.prompt')}
          </span>
          <span className="min-w-0 truncate text-[13.5px] font-medium text-foreground">{row.promptName}</span>
          <span className="shrink-0 text-muted-foreground">·</span>
          <span className="shrink-0 font-mono text-[12.5px] font-semibold text-muted-foreground">
            {row.promptVersionLabel}
          </span>
        </div>
        <div className="shrink-0 whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">{dateLabel}</div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onToggleMore}
          aria-pressed={moreOpen}
          aria-label={moreLabel}
          title={moreLabel}
          className={cn(
            'inline-flex size-[30px] items-center justify-center rounded-lg border bg-card p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            moreOpen && 'border-ring bg-muted text-foreground',
            compact && 'size-7 rounded-md',
          )}
        >
          <ChevronDown
            className={cn(compact ? 'size-3.5' : 'size-4', 'transition-transform', moreOpen && 'rotate-180')}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={actionMenuLabel}
              title={actionMenuLabel}
              className={cn(
                'inline-flex size-[30px] items-center justify-center rounded-lg border bg-card p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                compact && 'size-7 rounded-md',
              )}
            >
              <MoreHorizontal className={compact ? 'size-3.5' : 'size-4'} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem disabled={!hasConfig} onSelect={onToggleConfig} className="gap-2">
              <SlidersHorizontal className="size-3.5" />
              {configLabel}
            </DropdownMenuItem>
            <HistoryDropdownLink href={resultsHref} label={resultLabel}>
              <ScrollText className="size-3.5" />
            </HistoryDropdownLink>
            <HistoryDropdownLink href={annotationHref} label={annotationLabel}>
              <Tag className="size-3.5" />
            </HistoryDropdownLink>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={restoreDisabled}
              onSelect={(event) => {
                event.preventDefault();
                event.stopPropagation();
                restoreHistoryRow();
              }}
              className="gap-2"
            >
              <RotateCcw className="size-3.5" />
              {restorePending
                ? t('releases.detail.history.action.restoring')
                : t('releases.detail.history.action.restore')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {moreOpen ? (
        <HistoryMorePanel runtimeItems={runtimeItems} connectorItems={connectorItems} reasonItems={reasonItems} />
      ) : null}
      {configOpen && hasConfig ? (
        <HistoryConfigPanel changes={row.configChanges} formatDateTimeOrDash={formatDateTimeOrDash} />
      ) : null}
    </div>
  );
}

function HistoryDropdownLink({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  if (!href) {
    return (
      <DropdownMenuItem disabled className="gap-2">
        {children}
        {label}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem asChild className="gap-2">
      <Link href={href}>
        {children}
        {label}
      </Link>
    </DropdownMenuItem>
  );
}

function HistoryMorePanel({
  runtimeItems,
  connectorItems,
  reasonItems,
}: {
  runtimeItems: HistoryMetaItem[];
  connectorItems: HistoryMetaItem[];
  reasonItems: HistoryMetaItem[];
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 basis-full rounded-lg border bg-muted/55 px-[13px] py-[11px]">
      <HistoryPanelRow title={t('releases.detail.history.runtimeSection')} items={runtimeItems} />
      <HistoryPanelRow title={t('releases.detail.history.connectorSection')} items={connectorItems} />
      {reasonItems.length > 0 ? (
        <HistoryPanelRow title={t('releases.detail.history.reasonSection')} items={reasonItems} />
      ) : null}
    </div>
  );
}

function HistoryPanelRow({ title, items }: { title: string; items: HistoryMetaItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 py-[7px] first:pt-0 last:pb-0 sm:flex-row sm:items-baseline [&+&]:border-t">
      <div className="w-[58px] shrink-0 text-[11.5px] font-semibold text-muted-foreground">{title}</div>
      <dl className="flex min-w-0 flex-1 flex-wrap gap-x-[30px] gap-y-[9px]">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                'mt-0.5 max-w-[360px] break-words text-[13px] font-semibold text-foreground',
                item.mono && 'font-mono',
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HistoryConfigPanel({
  changes,
  formatDateTimeOrDash,
}: {
  changes: HistoryConfigChange[];
  formatDateTimeOrDash: (value: string | null | undefined) => string;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 basis-full rounded-lg border bg-muted/55 px-[13px] py-[11px]">
      <div className="mb-2 text-[11.5px] font-semibold text-muted-foreground">
        {t('releases.detail.history.configChanges')}
      </div>
      <div className="ml-[3px] flex flex-col gap-2.5 border-l-[1.5px] border-dotted border-muted-foreground/60 pl-[13px]">
        {changes.map((change) => (
          <div key={change.id} className="relative flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-4">
            <span className="absolute left-[-16.5px] top-1.5 size-1.5 rounded-full bg-muted-foreground" aria-hidden />
            <span className="min-w-[118px] shrink-0 font-mono text-[11.5px] text-muted-foreground">
              {formatDateTimeOrDash(change.at)}
            </span>
            <div className="flex min-w-0 flex-wrap gap-x-0 gap-y-1">
              {change.items.map((item) => (
                <span
                  key={`${change.id}-${item.field}-${item.next}`}
                  className="inline-flex items-baseline border-l px-3 text-[12.5px] first:border-l-0 first:pl-0"
                >
                  <span className="mr-2 font-semibold text-foreground">{item.field}</span>
                  <span className="font-mono text-muted-foreground">{item.previous}</span>
                  <span className="mx-1.5 text-muted-foreground">→</span>
                  <span className="font-mono font-semibold text-foreground">{item.next}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryVersionBadge({
  label,
  variant,
  compact,
}: {
  label: string;
  variant: 'production' | 'canary';
  compact?: boolean;
}) {
  const isProduction = variant === 'production';
  return (
    <span
      className={cn(
        'inline-flex h-[26px] w-[54px] shrink-0 items-center justify-center truncate rounded-md border px-2 font-mono text-[13px] font-semibold leading-none',
        compact && 'h-[25px] text-[12px]',
      )}
      style={{
        background: isProduction ? 'var(--src-prod-soft)' : 'var(--src-canary-soft)',
        color: isProduction ? 'var(--src-prod-fg)' : 'var(--src-canary-fg)',
        borderColor: isProduction
          ? 'color-mix(in srgb, var(--src-prod) 35%, var(--border))'
          : 'color-mix(in srgb, var(--src-canary) 35%, var(--border))',
      }}
    >
      {label}
    </span>
  );
}
