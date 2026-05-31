'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  CircleDollarSign,
  Copy,
  Gauge,
  Plus,
  Square,
  Timer,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type {
  AnnotationTaskDto,
  ProductionReleaseHistoryItemDto,
  ProjectMonitoringFilterDto,
  ProjectMonitoringStatsDto,
  ProjectMonitoringTimeseriesDto,
  ReleaseLineEventDto,
  ReleaseRunResultListItemDto,
  ReleaseVariantDto,
  SourceBucket,
} from '@proofhound/shared';
import { Main } from '@/components/layout/main';
import { Button } from '@/components/ui/button';
import {
  DateRangeSegmented,
  type DateRangePresetOption,
  type DateRangeSegmentedLabels,
  type DateRangeValue,
  resolveDateRangePreset,
} from '@/components/ui/date-range-segmented';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PlatformLoader } from '@/components/ui/platform-loader';
import { DetailPageSkeleton } from '@/components/ui/detail-page-skeleton';
import { ResourcePaginationFooter } from '@/components/ui/resource-pagination-footer';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  type TableColumn,
} from '@/components/ui/table';
import { useAnnotationTaskList } from '@/hooks/annotation';
import { useDelayedLoading } from '@/hooks/use-delayed-loading';
import { useProjectModels } from '@/hooks/model';
import { useProductionReleaseHistory, useStopProductionRelease } from '@/hooks/production-release';
import { useProjectMonitoringStats, useProjectMonitoringTimeseries } from '@/hooks/project-monitoring';
import {
  useReleaseLineEvents,
  useReleaseLineList,
  useUpdateReleaseLineRunConfig,
  useUpdateReleaseLineTrafficRatio,
} from '@/hooks/release-line';
import { useReleaseRunResults } from '@/hooks/run-result';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh } from '@/hooks/use-auto-refresh';
import { useI18n, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  getReleaseLineId,
  getReleaseStopConfirmationName,
  type ReleaseLineLatestEvent,
  type ReleaseLineView,
} from '@/lib/releases/release-line-model';
import { BigChartCard, type DeltaTone } from '../../monitoring/_components/big-chart-card';
import {
  ReleaseEventPill,
  ReleaseMetricCard,
  formatCount,
  formatDateTimeOrDash,
  formatPercent,
} from './release-line-ui';
import { ReleaseTopologyCanvas } from './release-topology-canvas';

type DetailTab = 'monitoring' | 'variants' | 'results' | 'quality' | 'history';

const DETAIL_TABS: Array<{ value: DetailTab; key: TranslationKey }> = [
  { value: 'monitoring', key: 'releases.detail.tab.monitoring' },
  { value: 'variants', key: 'releases.detail.tab.variants' },
  { value: 'results', key: 'releases.detail.tab.results' },
  { value: 'quality', key: 'releases.detail.tab.quality' },
  { value: 'history', key: 'releases.detail.tab.history' },
];

const RESULT_COLUMNS: TableColumn[] = [
  { key: 'externalId', width: 'normal' },
  { key: 'input', width: 'wide' },
  { key: 'output', width: 'wide' },
  { key: 'source', width: 'compact' },
  { key: 'variant', width: 'normal' },
  { key: 'latency', width: 'compact' },
  { key: 'tokens', width: 'compact' },
  { key: 'createdAt', width: 'normal' },
];

const RESULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
type ResultSourceFilter = 'all' | 'production' | 'canary';
type ResultPromptVersionFilterOption = { id: string; label: string };
type ResultReleaseVariantFilterOption = { id: string; label: string; detail: string };
type ReleaseVariantStage = 'production_canary' | 'production' | 'canary' | 'history';

type ReleaseVariantDetail = {
  id: string;
  variantNumber: number | null;
  label: string;
  promptName: string;
  promptVersionId: string | null;
  promptVersionLabel: string | null;
  modelId: string | null;
  modelName: string | null;
  modelProvider: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  stage: ReleaseVariantStage;
  events: ReleaseLineEventDto[];
  productionEventCount: number;
  canaryEventCount: number;
  totalProcessed: number;
  totalErrors: number;
};

const EMPTY_BY_SOURCE: Record<SourceBucket, number> = { prod: 0, canary: 0, iter: 0, exp: 0 };
const EMPTY_TIMESERIES_POINTS: ProjectMonitoringTimeseriesDto['points'] = [];
const RELEASE_MONITORING_SOURCE_KEYS = ['prod', 'canary'] as const;

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

type QualityMetricKey = 'score';

type AnnotationQualityPoint = {
  id: string;
  x: string;
  name: string;
  promptVersionLabel: string;
  modelName: string;
  releaseVariantLabel: string;
  submitted: number;
  total: number;
  matched: number;
  mismatched: number;
  updatedAt: string | null;
  score: number;
};

const COMPACT_METRIC_DOT_CLASS: Record<CompactMetricTone, string> = {
  default: 'bg-muted-foreground',
  production: 'bg-[var(--src-prod-fg)]',
  canary: 'bg-[var(--src-canary-fg)]',
  success: 'bg-[var(--status-running-fg)]',
  danger: 'bg-destructive',
};

const QUALITY_LINE_COLORS: Record<QualityMetricKey, string> = {
  score: 'var(--src-canary)',
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
  if (
    value === 'monitoring' ||
    value === 'variants' ||
    value === 'results' ||
    value === 'quality' ||
    value === 'history'
  ) {
    return value;
  }
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

function buildAnnotationQualityPoints(tasks: AnnotationTaskDto[]): AnnotationQualityPoint[] {
  const points: AnnotationQualityPoint[] = [];
  for (const task of tasks) {
    if (task.quality) {
      points.push({
        id: task.id,
        x: '',
        name: task.name,
        promptVersionLabel: task.promptVersionLabel ?? '—',
        modelName: task.modelName ?? '—',
        releaseVariantLabel: task.releaseVariantLabel,
        submitted: task.progress.submitted,
        total: task.progress.total,
        matched: task.quality.matched,
        mismatched: task.quality.mismatched,
        updatedAt: task.updatedAt,
        score: toPercentPoint(task.quality.score),
      });
    }
  }
  return points
    .sort((left, right) => timeValue(left.updatedAt) - timeValue(right.updatedAt))
    .map((point, index) => ({ ...point, x: `#${index + 1}` }));
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

function formatXLabel(iso: string, granularity: ProjectMonitoringTimeseriesDto['granularity']): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (granularity === 'day') return `${date.getMonth() + 1}/${date.getDate()}`;
  if (granularity === 'hour') return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:00`;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pickReleaseTimeseries(
  points: ProjectMonitoringTimeseriesDto['points'],
  granularity: ProjectMonitoringTimeseriesDto['granularity'],
  metric: ReleaseTimeseriesMetric,
) {
  return points.map((point) => ({
    x: formatXLabel(point.bucketAt, granularity),
    prod: point[metric].prod,
    canary: point[metric].canary,
    iter: point[metric].iter,
    exp: point[metric].exp,
  }));
}

function pickReleaseFailureRateTimeseries(
  points: ProjectMonitoringTimeseriesDto['points'],
  granularity: ProjectMonitoringTimeseriesDto['granularity'],
) {
  return points.map((point) => {
    const requestCount = sourceBucketTotal(point.requests);
    return {
      x: formatXLabel(point.bucketAt, granularity),
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
  const stopProductionMutation = useStopProductionRelease(projectId);
  const updateTrafficRatioMutation = useUpdateReleaseLineTrafficRatio(projectId);
  const updateRunConfigMutation = useUpdateReleaseLineRunConfig(projectId);
  const modelQuery = useProjectModels(projectId);
  const tab = resolveTab(searchParams.get('tab'));
  const selectedReleaseVariantId = searchParams.get('variant') ?? undefined;
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [stopConfirmationText, setStopConfirmationText] = useState('');
  const productionReleaseName = useMemo(() => getReleaseStopConfirmationName(line), [line]);
  const canConfirmStopProduction = stopConfirmationText === productionReleaseName && productionReleaseName.length > 0;
  const canAddCanary = Boolean(line && line.production?.currentEvent?.status === 'running' && !line.canary);
  const onAutoRefreshTick = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] });
  }, [projectId, queryClient]);

  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: true,
    onTick: onAutoRefreshTick,
  });

  useEffect(() => {
    if (searchParams.get('tab') !== 'annotation') return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'quality');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const selectTab = useCallback(
    (next: DetailTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'monitoring') params.delete('tab');
      else params.set('tab', next);
      if (next !== 'results') params.delete('variant');
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
    if (!line?.production?.currentEvent) return;
    setStopConfirmationText('');
    setStopDialogOpen(true);
  }

  function closeStopProductionDialog() {
    if (stopProductionMutation.isPending) return;
    setStopDialogOpen(false);
    setStopConfirmationText('');
  }

  function confirmStopProduction() {
    if (!line?.production?.currentEvent || !canConfirmStopProduction) return;
    stopProductionMutation.mutate(
      {
        eventId: line.production.currentEvent.id,
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
                {line.production?.currentEvent?.status ?? line.canary?.status ?? line.status}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {line.production?.currentEvent?.status === 'running' ? (
              <Button
                variant="outline"
                onClick={openStopProductionDialog}
                disabled={stopProductionMutation.isPending}
                className="text-destructive hover:text-destructive"
                data-testid="release-line-detail-stop"
              >
                <Square className="size-4" />
                {t('releases.detail.action.stopProduction')}
              </Button>
            ) : null}
            {canAddCanary ? (
              <Button onClick={openAddCanaryPage}>
                <Plus className="size-4" />
                {t('releases.detail.action.addCanary')}
              </Button>
            ) : null}
          </div>
        </div>

        <ReleaseTopologyCanvas
          line={line}
          models={modelQuery.data?.data ?? []}
          modelsLoading={modelQuery.isLoading}
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
          onAddCanary={canAddCanary ? openAddCanaryPage : undefined}
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
        {tab === 'variants' ? (
          <VariantsPane
            line={line}
            releaseEvents={releaseLineEventsQuery.data?.data ?? []}
            loading={releaseLineEventsQuery.isLoading}
          />
        ) : null}
        {tab === 'results' ? (
          <ResultsPane
            projectId={projectId}
            line={line}
            releaseEvents={releaseLineEventsQuery.data?.data ?? []}
            initialReleaseVariantId={selectedReleaseVariantId}
          />
        ) : null}
        {tab === 'quality' ? <QualityMetricsPane projectId={projectId} line={line} /> : null}
        {tab === 'history' ? (
          <HistoryPane
            line={line}
            productionHistory={historyQuery.data?.data ?? []}
            releaseEvents={releaseLineEventsQuery.data?.data ?? []}
            loading={historyQuery.isLoading || releaseLineEventsQuery.isLoading}
          />
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
              disabled={stopProductionMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmStopProduction}
              disabled={!canConfirmStopProduction || stopProductionMutation.isPending}
            >
              <Square className="size-4" />
              {stopProductionMutation.isPending
                ? t('releases.detail.stopDialog.stopping')
                : t('releases.detail.stopDialog.confirm')}
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
    return pickReleaseTimeseries(timeseriesPoints, timeseriesGranularity, metric);
  }

  function pickFailureRateTimeseries() {
    return pickReleaseFailureRateTimeseries(timeseriesPoints, timeseriesGranularity);
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

function VariantsPane({
  line,
  releaseEvents,
  loading,
}: {
  line: ReleaseLineView;
  releaseEvents: ReleaseLineEventDto[];
  loading: boolean;
}) {
  const { t } = useI18n();
  const details = useMemo(() => buildReleaseVariantDetails(line, releaseEvents), [line, releaseEvents]);

  if (loading && details.length === 0) return <PlatformLoader className="py-8" size="sm" />;
  if (details.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        {t('releases.detail.variants.empty')}
      </div>
    );
  }

  return (
    <section className="space-y-3" data-testid="release-variants-pane">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {details.map((detail) => (
          <article key={detail.id} className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[17px] font-semibold">{detail.label}</span>
                  <ReleaseVariantStageBadge stage={detail.stage} />
                </div>
                <div className="mt-1 max-w-full truncate text-[12px] text-muted-foreground">
                  {detail.promptName} · {detail.promptVersionLabel ?? formatShortId(detail.promptVersionId)} ·{' '}
                  {detail.modelName ?? formatShortId(detail.modelId)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard?.writeText(detail.id)}
                >
                  <Copy className="size-3.5" />
                  {t('releases.detail.variants.copyId')}
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link
                    href={`/releases/${encodeURIComponent(line.id)}?tab=results&variant=${encodeURIComponent(detail.id)}`}
                  >
                    <Activity className="size-3.5" />
                    {t('releases.detail.variants.viewResults')}
                  </Link>
                </Button>
                <Button type="button" size="sm" asChild>
                  <Link
                    href={`/annotations/new?line=${encodeURIComponent(line.id)}&variant=${encodeURIComponent(detail.id)}`}
                  >
                    <ClipboardCheck className="size-3.5" />
                    {t('releases.detail.variants.newAnnotation')}
                  </Link>
                </Button>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 md:grid-cols-4">
              <VariantMeta
                label={t('releases.detail.variants.promptVersion')}
                value={detail.promptVersionLabel ?? formatShortId(detail.promptVersionId)}
              />
              <VariantMeta
                label={t('releases.detail.variants.model')}
                value={detail.modelName ?? formatShortId(detail.modelId)}
              />
              <VariantMeta label={t('releases.detail.variants.provider')} value={detail.modelProvider ?? '—'} />
              <VariantMeta
                label={t('releases.detail.variants.updatedAt')}
                value={formatDateTimeOrDash(detail.updatedAt)}
              />
              <VariantMeta
                label={t('releases.detail.variants.productionEvents')}
                value={formatCount(detail.productionEventCount)}
              />
              <VariantMeta
                label={t('releases.detail.variants.canaryEvents')}
                value={formatCount(detail.canaryEventCount)}
              />
              <VariantMeta label={t('releases.detail.variants.processed')} value={formatCount(detail.totalProcessed)} />
              <VariantMeta label={t('releases.detail.variants.errors')} value={formatCount(detail.totalErrors)} />
            </dl>

            <div className="mt-4 border-t pt-4">
              <div className="mb-2 text-[12px] font-medium text-muted-foreground">
                {t('releases.detail.variants.events')}
              </div>
              {detail.events.length === 0 ? (
                <div className="text-[12px] text-muted-foreground">{t('releases.detail.variants.noEvents')}</div>
              ) : (
                <div className="space-y-2">
                  {detail.events.slice(0, 5).map((event) => (
                    <div key={event.id} className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
                      <ReleaseEventPill event={event.operation} />
                      <span className="font-mono text-muted-foreground">
                        {t(
                          event.laneType === 'production'
                            ? 'releases.detail.history.productionLane'
                            : 'releases.detail.history.canaryLane',
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {event.submitReason || event.status}
                      </span>
                      <span className="font-mono text-[11.5px] text-muted-foreground">
                        {formatDateTimeOrDash(event.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 border-t pt-3">
              <div className="font-mono text-[11px] text-muted-foreground">{detail.id}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function VariantMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-mono text-[12.5px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ReleaseVariantStageBadge({ stage }: { stage: ReleaseVariantStage }) {
  const { t } = useI18n();
  const isProduction = stage === 'production' || stage === 'production_canary';
  const isCanary = stage === 'canary' || stage === 'production_canary';
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: isProduction ? 'var(--src-prod-soft)' : isCanary ? 'var(--src-canary-soft)' : 'var(--muted)',
        color: isProduction ? 'var(--src-prod-fg)' : isCanary ? 'var(--src-canary-fg)' : 'var(--muted-foreground)',
        borderColor: isProduction
          ? 'color-mix(in srgb, var(--src-prod) 30%, transparent)'
          : isCanary
            ? 'color-mix(in srgb, var(--src-canary) 30%, transparent)'
            : 'var(--border)',
      }}
    >
      {t(`releases.detail.variants.stage.${stage}` as TranslationKey)}
    </span>
  );
}

function ResultsPane({
  projectId,
  line,
  releaseEvents,
  initialReleaseVariantId,
}: {
  projectId: string;
  line: ReleaseLineView;
  releaseEvents: ReleaseLineEventDto[];
  initialReleaseVariantId?: string;
}) {
  const { t } = useI18n();
  const [sourceFilter, setSourceFilter] = useState<ResultSourceFilter>('all');
  const [releaseVariantFilter, setReleaseVariantFilter] = useState(initialReleaseVariantId ?? 'all');
  const [promptVersionFilter, setPromptVersionFilter] = useState('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const sourceIds = useMemo(() => getReleaseResultSourceIds(line, releaseEvents), [line, releaseEvents]);
  const releaseVariantOptions = useMemo(
    () => getReleaseResultVariantOptions(line, releaseEvents),
    [line, releaseEvents],
  );
  const promptVersionOptions = useMemo(
    () => getReleaseResultPromptVersionOptions(line, releaseEvents),
    [line, releaseEvents],
  );
  const activeReleaseVariantFilter =
    releaseVariantFilter === 'all' || releaseVariantOptions.some((option) => option.id === releaseVariantFilter)
      ? releaseVariantFilter
      : 'all';
  const activePromptVersionFilter =
    promptVersionFilter === 'all' || promptVersionOptions.some((option) => option.id === promptVersionFilter)
      ? promptVersionFilter
      : 'all';
  const laneFilter = sourceFilter === 'all' ? undefined : [sourceFilter];
  const releaseVariantIds = activeReleaseVariantFilter === 'all' ? undefined : [activeReleaseVariantFilter];
  const promptVersionIds = activePromptVersionFilter === 'all' ? undefined : [activePromptVersionFilter];
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
      releaseVariantIds,
      promptVersionIds,
      lane: laneFilter,
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
          <label className="sr-only" htmlFor="release-result-variant-filter">
            {t('releases.detail.results.variant')}
          </label>
          <select
            id="release-result-variant-filter"
            name="releaseVariantFilter"
            value={activeReleaseVariantFilter}
            onChange={(event) => {
              setReleaseVariantFilter(event.currentTarget.value);
              setPageIndex(0);
            }}
            className="h-9 rounded-md border bg-background px-3 text-[12px] font-medium text-foreground shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={releaseVariantOptions.length === 0}
          >
            <option value="all">{t('releases.detail.results.variantFilter.all')}</option>
            {releaseVariantOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} · {option.detail}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="release-result-prompt-version-filter">
            {t('releases.detail.results.promptVersion')}
          </label>
          <select
            id="release-result-prompt-version-filter"
            name="promptVersionFilter"
            value={activePromptVersionFilter}
            onChange={(event) => {
              setPromptVersionFilter(event.currentTarget.value);
              setPageIndex(0);
            }}
            className="h-9 rounded-md border bg-background px-3 text-[12px] font-medium text-foreground shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={promptVersionOptions.length === 0}
          >
            <option value="all">{t('releases.detail.results.promptVersionFilter.all')}</option>
            {promptVersionOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border bg-background p-1">
            {(['all', 'production', 'canary'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setSourceFilter(value);
                  setPageIndex(0);
                }}
                className={cn(
                  'h-7 rounded-md px-3 text-[12px] font-medium transition-colors',
                  sourceFilter === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`releases.detail.results.sourceFilter.${value}` as TranslationKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Table columns={RESULT_COLUMNS}>
        <TableHeader>
          <TableRow>
            <TableHead column="externalId">{t('releases.detail.results.externalId')}</TableHead>
            <TableHead column="input">{t('releases.detail.results.input')}</TableHead>
            <TableHead column="output">{t('releases.detail.results.output')}</TableHead>
            <TableHead column="source">{t('releases.detail.results.source')}</TableHead>
            <TableHead column="variant">{t('releases.detail.results.variant')}</TableHead>
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
              <TableCell column="variant" className="text-[12px]">
                <ReleaseRunResultVariant value={row} />
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

function buildReleaseVariantDetails(
  line: ReleaseLineView,
  releaseEvents: ReleaseLineEventDto[],
): ReleaseVariantDetail[] {
  const baseById = new Map<
    string,
    Omit<
      ReleaseVariantDetail,
      'stage' | 'events' | 'productionEventCount' | 'canaryEventCount' | 'totalProcessed' | 'totalErrors'
    >
  >();
  const eventsByVariant = new Map<string, ReleaseLineEventDto[]>();

  const addVariant = (variant: ReleaseVariantDto) => {
    baseById.set(variant.id, {
      id: variant.id,
      variantNumber: variant.variantNumber,
      label: variant.label,
      promptName: variant.promptName,
      promptVersionId: variant.promptVersionId,
      promptVersionLabel: variant.promptVersionLabel,
      modelId: variant.modelId,
      modelName: variant.modelName,
      modelProvider: variant.modelProvider,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    });
  };

  for (const variant of line.variants) addVariant(variant);
  for (const event of releaseEvents) {
    if (!event.releaseVariantId) continue;
    const events = eventsByVariant.get(event.releaseVariantId) ?? [];
    events.push(event);
    eventsByVariant.set(event.releaseVariantId, events);

    if (!baseById.has(event.releaseVariantId)) {
      baseById.set(event.releaseVariantId, {
        id: event.releaseVariantId,
        variantNumber: event.releaseVariantNumber,
        label: event.releaseVariantLabel ?? formatShortId(event.releaseVariantId),
        promptName: event.promptName,
        promptVersionId: event.promptVersionId,
        promptVersionLabel: event.promptVersionLabel,
        modelId: event.modelId,
        modelName: event.modelName,
        modelProvider: event.modelProvider,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      });
    }
  }

  const currentProductionVariantId =
    releaseEvents.find((event) => event.id === line.production?.currentEvent?.id)?.releaseVariantId ?? null;
  const activeCanaryVariantId =
    line.canary?.releaseVariantId ??
    releaseEvents.find((event) => event.id === line.canary?.id)?.releaseVariantId ??
    null;

  return [...baseById.values()]
    .map((base) => {
      const events = (eventsByVariant.get(base.id) ?? []).sort(
        (left, right) => timeValue(right.createdAt) - timeValue(left.createdAt),
      );
      return {
        ...base,
        createdAt: minDateString([base.createdAt, ...events.map((event) => event.createdAt)]),
        updatedAt: maxDateString([base.updatedAt, ...events.map((event) => event.updatedAt ?? event.createdAt)]),
        stage: resolveReleaseVariantStage(base.id, currentProductionVariantId, activeCanaryVariantId, events),
        events,
        productionEventCount: events.filter((event) => event.laneType === 'production').length,
        canaryEventCount: events.filter((event) => event.laneType === 'canary').length,
        totalProcessed: events.reduce((sum, event) => sum + event.totalProcessed, 0),
        totalErrors: events.reduce((sum, event) => sum + event.totalErrors, 0),
      } satisfies ReleaseVariantDetail;
    })
    .sort((left, right) => {
      if (left.variantNumber !== null && right.variantNumber !== null) return left.variantNumber - right.variantNumber;
      if (left.variantNumber !== null) return -1;
      if (right.variantNumber !== null) return 1;
      return left.label.localeCompare(right.label, undefined, { numeric: true });
    });
}

function resolveReleaseVariantStage(
  releaseVariantId: string,
  currentProductionVariantId: string | null,
  activeCanaryVariantId: string | null,
  events: ReleaseLineEventDto[],
): ReleaseVariantStage {
  const isProduction =
    currentProductionVariantId === releaseVariantId ||
    events.some((event) => event.laneType === 'production' && event.status === 'running');
  const isCanary =
    activeCanaryVariantId === releaseVariantId ||
    events.some((event) => event.laneType === 'canary' && (event.status === 'running' || event.status === 'stopped'));
  if (isProduction && isCanary) return 'production_canary';
  if (isProduction) return 'production';
  if (isCanary) return 'canary';
  return 'history';
}

function minDateString(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((min, value) => (timeValue(value) < timeValue(min) ? value : min));
}

function maxDateString(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((max, value) => (timeValue(value) > timeValue(max) ? value : max));
}

function getReleaseResultVariantOptions(
  line: ReleaseLineView,
  releaseEvents: ReleaseLineEventDto[],
): ResultReleaseVariantFilterOption[] {
  const options = new Map<string, ResultReleaseVariantFilterOption>();
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
      detail: `${promptVersion} · ${model}`,
    });
  };
  for (const variant of line.variants) {
    add({
      id: variant.id,
      label: variant.label,
      promptVersionLabel: variant.promptVersionLabel,
      promptVersionId: variant.promptVersionId,
      modelName: variant.modelName,
      modelId: variant.modelId,
    });
  }
  for (const event of releaseEvents) {
    add({
      id: event.releaseVariantId,
      label: event.releaseVariantLabel,
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

function getReleaseResultPromptVersionOptions(
  line: ReleaseLineView,
  releaseEvents: ReleaseLineEventDto[],
): ResultPromptVersionFilterOption[] {
  const options = new Map<string, string>();
  const add = (id: string | null | undefined, label: string | null | undefined) => {
    if (!id) return;
    options.set(id, label?.trim() || formatShortId(id));
  };
  add(line.production?.currentEvent?.promptVersionId, line.productionVersionLabel);
  add(line.canary?.promptVersionId, line.canaryVersionLabel);
  for (const event of releaseEvents) {
    add(event.promptVersionId, event.promptVersionLabel);
  }
  return [...options.entries()].map(([id, label]) => ({ id, label }));
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

function ReleaseRunResultVariant({ value }: { value: ReleaseRunResultListItemDto }) {
  const label = value.releaseVariantLabel ?? formatShortId(value.releaseVariantId);
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

function QualityMetricsPane({ projectId, line }: { projectId: string; line: ReleaseLineView }) {
  const { t } = useI18n();
  const annotationTasksQuery = useAnnotationTaskList(projectId);
  const annotationTasksLoading = useDelayedLoading(annotationTasksQuery.isLoading);
  const lineTasks = useMemo(
    () => (annotationTasksQuery.data?.data ?? []).filter((task) => task.releaseLineId === line.id),
    [annotationTasksQuery.data, line.id],
  );
  const points = useMemo(() => buildAnnotationQualityPoints(lineTasks), [lineTasks]);
  const latest = points[points.length - 1] ?? null;
  const submitted = lineTasks.reduce((sum, task) => sum + task.progress.submitted, 0);
  const matched = lineTasks.reduce((sum, task) => sum + (task.quality?.matched ?? 0), 0);
  const mismatched = lineTasks.reduce((sum, task) => sum + (task.quality?.mismatched ?? 0), 0);
  const judged = matched + mismatched;
  const aggregateScore = judged > 0 ? toPercentPoint(matched / judged) : null;
  const annotationHref = `/annotations/new?line=${encodeURIComponent(line.id)}`;

  return (
    <div className="space-y-4" data-testid="release-quality-metrics-pane">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{t('releases.detail.quality.title')}</h2>
        <Button asChild>
          <Link href={annotationHref}>
            <ClipboardCheck className="size-4" />
            {t('releases.detail.action.newAnnotation')}
          </Link>
        </Button>
      </div>

      {annotationTasksLoading && lineTasks.length === 0 ? (
        <PlatformLoader className="rounded-lg border bg-card py-10" size="sm" />
      ) : null}

      {annotationTasksQuery.isError ? (
        <div className="rounded-lg border bg-card px-4 py-3 text-sm text-destructive">
          {t('releases.detail.quality.loadFailed')}
        </div>
      ) : null}

      {!annotationTasksQuery.isLoading && !annotationTasksQuery.isError && lineTasks.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center" data-testid="release-quality-empty">
          <div className="text-[15px] font-semibold">{t('releases.detail.quality.empty')}</div>
          <Button className="mt-5" asChild>
            <Link href={annotationHref}>
              <ClipboardCheck className="size-4" />
              {t('releases.detail.action.newAnnotation')}
            </Link>
          </Button>
        </div>
      ) : null}

      {lineTasks.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <ReleaseMetricCard
              label={t('releases.detail.quality.matchRate')}
              value={formatQualityPercent(aggregateScore)}
              detail={t('releases.detail.quality.tasksCount').replace('{count}', formatCount(lineTasks.length))}
              tone="canary"
            />
            <ReleaseMetricCard
              label={t('releases.detail.quality.latestMatchRate')}
              value={formatQualityPercent(latest?.score)}
              detail={latest?.name ?? t('common.noData')}
            />
            <ReleaseMetricCard
              label={t('releases.detail.quality.matched')}
              value={formatCount(matched)}
              detail={t('releases.detail.quality.matchedHint')}
            />
            <ReleaseMetricCard
              label={t('releases.detail.quality.mismatched')}
              value={formatCount(mismatched)}
              detail={t('releases.detail.quality.mismatchedHint')}
            />
            <ReleaseMetricCard
              label={t('releases.detail.quality.submitted')}
              value={formatCount(submitted)}
              detail={t('releases.detail.quality.submittedHint')}
            />
          </div>

          {points.length > 0 ? (
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] font-semibold">{t('releases.detail.quality.chartTitle')}</div>
                </div>
                <QualityLegend />
              </div>
              <QualityMetricsChart data={points} />
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
              {t('releases.detail.quality.noComparable')}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function QualityLegend() {
  const { t } = useI18n();
  const items: Array<{ key: QualityMetricKey; label: string }> = [
    { key: 'score', label: t('releases.detail.quality.matchRate') },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted-foreground">
      {items.map((item) => (
        <div key={item.key} className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: QUALITY_LINE_COLORS[item.key] }}
            aria-hidden="true"
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function QualityMetricsChart({ data }: { data: AnnotationQualityPoint[] }) {
  const { t } = useI18n();
  const metricLabels = useMemo<Record<QualityMetricKey, string>>(
    () => ({
      score: t('releases.detail.quality.matchRate'),
    }),
    [t],
  );

  return (
    <div className="h-[320px] min-w-0 w-full">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={1}
        minHeight={1}
        initialDimension={{ width: 960, height: 320 }}
      >
        <RechartsLineChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="2 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="x"
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fill: 'var(--muted-foreground)',
            }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
            tick={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fill: 'var(--muted-foreground)',
            }}
            tickFormatter={(value) => `${value}%`}
            width={42}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border)', strokeDasharray: '4 4' }}
            content={(props) => (
              <QualityChartTooltip
                {...props}
                metricLabels={metricLabels}
                submittedLabel={t('releases.detail.quality.submitted')}
              />
            )}
          />
          {(['score'] satisfies QualityMetricKey[]).map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={metricLabels[key]}
              stroke={QUALITY_LINE_COLORS[key]}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 1.5 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

function QualityChartTooltip({
  active,
  payload,
  label,
  metricLabels,
  submittedLabel,
}: TooltipContentProps & {
  metricLabels: Record<QualityMetricKey, string>;
  submittedLabel: string;
}) {
  const { t } = useI18n();
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as AnnotationQualityPoint | undefined;
  if (!point) return null;
  return (
    <div className="min-w-[220px] rounded-md border bg-popover px-2.5 py-2 text-[12px] shadow-md">
      <div className="mb-1 font-mono text-[10.5px] text-muted-foreground">
        {label} · {formatDateTimeOrDash(point.updatedAt)}
      </div>
      <div className="font-semibold">{point.name}</div>
      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
        {point.releaseVariantLabel} · {point.promptVersionLabel} · {point.modelName}
      </div>
      <div className="mt-2 space-y-0.5">
        {(['score'] satisfies QualityMetricKey[]).map((key) => (
          <div key={key} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: QUALITY_LINE_COLORS[key] }} aria-hidden />
            <span className="text-muted-foreground">{metricLabels[key]}</span>
            <span className="ml-auto font-mono">{formatQualityPercent(point[key])}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t('releases.detail.quality.matched')}</span>
          <span className="ml-auto font-mono">{formatCount(point.matched)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t('releases.detail.quality.mismatched')}</span>
          <span className="ml-auto font-mono">{formatCount(point.mismatched)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 border-t pt-1">
          <span className="text-muted-foreground">{submittedLabel}</span>
          <span className="ml-auto font-mono">
            {formatCount(point.submitted)} / {formatCount(point.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

type TimelineItem = {
  id: string;
  event: ReleaseLineLatestEvent;
  title: string;
  createdAt: string | null;
  meta: string;
  variant: string | null;
};

function buildReleaseEventMeta(event: ReleaseLineEventDto) {
  const parts = [
    event.status,
    event.trafficRatio !== null ? `${Math.round(event.trafficRatio * 100)}%` : null,
    event.trafficMode,
    event.submitReason,
  ].filter((value): value is string => Boolean(value));
  return parts.join(' · ') || event.id;
}

function formatReleaseEventVariant(event: ReleaseLineEventDto) {
  if (!event.releaseVariantId) return null;
  const label = event.releaseVariantLabel ?? formatShortId(event.releaseVariantId);
  const promptVersion = event.promptVersionLabel ?? formatShortId(event.promptVersionId);
  const model = event.modelName ?? formatShortId(event.modelId);
  return `${label} · ${promptVersion} · ${model}`;
}

function HistoryPane({
  line,
  productionHistory,
  releaseEvents,
  loading,
}: {
  line: ReleaseLineView;
  productionHistory: ProductionReleaseHistoryItemDto[];
  releaseEvents: ReleaseLineEventDto[];
  loading: boolean;
}) {
  const { t } = useI18n();
  const items = useMemo<TimelineItem[]>(() => {
    if (releaseEvents.length > 0) {
      return releaseEvents.map((event) => ({
        id: event.id,
        event: event.operation,
        title: `${event.laneType === 'production' ? t('releases.detail.history.productionLane') : t('releases.detail.history.canaryLane')} · ${event.promptVersionLabel ?? event.id.slice(0, 8)}`,
        createdAt: event.createdAt,
        meta: buildReleaseEventMeta(event),
        variant: formatReleaseEventVariant(event),
      }));
    }
    const prod = productionHistory.map((item) => ({
      id: item.id,
      event: item.eventType,
      title: item.promptVersionLabel ?? item.id.slice(0, 8),
      createdAt: item.createdAt,
      meta: item.submitReason || item.status,
      variant: null,
    }));
    const canary = line.canary
      ? [
          {
            id: line.canary.id,
            event: line.canary.status === 'running' ? 'ratio_change' : 'create_canary',
            title: `${line.canary.promptVersionLabel ?? line.canary.id.slice(0, 8)} · ${Math.round(line.canary.trafficRatio * 100)}%`,
            createdAt: line.canary.updatedAt,
            meta: line.canary.description ?? line.canary.status,
            variant: line.canary.releaseVariantLabel
              ? `${line.canary.releaseVariantLabel} · ${line.canary.promptVersionLabel ?? '-'} · ${line.canary.modelName ?? '-'}`
              : null,
          } satisfies TimelineItem,
        ]
      : [];
    return [...canary, ...prod].sort(
      (left, right) =>
        (right.createdAt ? Date.parse(right.createdAt) : 0) - (left.createdAt ? Date.parse(left.createdAt) : 0),
    );
  }, [line.canary, productionHistory, releaseEvents, t]);

  if (loading) return <PlatformLoader className="py-8" size="sm" />;
  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        {t('releases.detail.history.empty')}
      </div>
    );
  }

  return (
    <div className="relative space-y-3 pl-8">
      <div className="absolute bottom-0 left-[11px] top-0 w-0.5 bg-border" />
      {items.map((item, index) => (
        <div key={item.id} className="relative rounded-lg border bg-card">
          <div
            className="absolute left-[-27px] top-[18px] size-3.5 rounded-full border-2"
            style={{
              background: index === 0 ? 'var(--status-canary-dot)' : 'var(--card)',
              borderColor: index === 0 ? 'var(--status-canary-dot)' : 'var(--border)',
              boxShadow:
                index === 0 ? '0 0 0 4px color-mix(in srgb, var(--status-canary-dot) 25%, transparent)' : undefined,
            }}
          />
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <ReleaseEventPill event={item.event} />
            <span className="text-[14px] font-semibold">{item.title}</span>
            <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">
              {formatDateTimeOrDash(item.createdAt)} · {item.id.slice(0, 8)}
            </span>
          </div>
          <div className="space-y-2 px-4 py-3 text-[12.5px] text-muted-foreground">
            {item.variant ? (
              <div>
                <span className="font-medium text-foreground">{t('releases.detail.history.variant')}</span>
                <span className="ml-2 font-mono">{item.variant}</span>
              </div>
            ) : null}
            <div>{item.meta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
