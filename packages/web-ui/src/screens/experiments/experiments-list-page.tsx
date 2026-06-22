'use client';

import { Link } from '../../components/navigation/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from '../../hooks/use-router';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ExperimentControlActionDto, ExperimentListItemDto, ExperimentListStatsDto } from '@proofhound/shared';
import { BarChart3, List, Loader2, Play, Plus, Search, Sliders, Square, Trash2, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  ListRowsSkeleton,
  PlatformLoaderOverlay,
  Skeleton,
  ResourcePaginationFooter,
  SlidingViewToggle,
} from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useControlExperiment, useDeleteExperiment, useExperiments } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import {
  deriveExperimentDisplayStatus,
  normalizeExperimentStatus,
  type ExperimentStatus,
  type ExperimentSummary,
} from './experiment-view-model';
import { ChipFilter } from './experiment-ui';
import { ExperimentsComparisonView } from './experiments-comparison-view';
import { ExperimentsTable } from './experiments-table';

type ViewMode = 'table' | 'compare';
type ExperimentFilter = 'all' | ExperimentStatus;
type ExperimentDeleteTarget = {
  ids: string[];
  names: string[];
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const STATUS_FILTERS: Array<{ key: ExperimentStatus; labelKey: TranslationKey }> = [
  { key: 'running', labelKey: 'experiments.status.running' },
  { key: 'success', labelKey: 'experiments.status.success' },
  { key: 'failed', labelKey: 'experiments.status.failed' },
  { key: 'stopped', labelKey: 'experiments.status.stopped' },
];

const SORT_LABEL_KEYS: Record<'accuracy' | 'updated' | 'duration', TranslationKey> = {
  accuracy: 'experiments.sort.accuracy',
  updated: 'experiments.sort.updated',
  duration: 'experiments.sort.duration',
};

function resolveViewMode(value: string | null): ViewMode {
  return value === 'compare' ? 'compare' : 'table';
}

function parseComparisonIds(value: string | null) {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

function HeaderStatCard({
  label,
  value,
  unit,
  footer,
}: {
  label: string;
  value: string;
  unit?: string;
  footer?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-1 text-[18px] font-semibold tracking-tight">
        {value}
        {unit && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">{unit}</span>}
      </span>
      {footer && <span className="mt-0.5 text-[11.5px] text-muted-foreground">{footer}</span>}
    </div>
  );
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function formatDuration(totalSeconds: number | null | undefined) {
  if (!totalSeconds || totalSeconds <= 0 || !Number.isFinite(totalSeconds)) return '—';
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes}m ${String(restSeconds).padStart(2, '0')}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return '$ 0.00';
  return `$ ${value.toFixed(2)}`;
}

function getDurationSeconds(experiment: ExperimentListItemDto) {
  const startedAt = Date.parse(experiment.startedAt ?? experiment.createdAt);
  const endedAt =
    experiment.status === 'running' ? Date.now() : Date.parse(experiment.finishedAt ?? experiment.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return 0;
  return Math.round((endedAt - startedAt) / 1000);
}

function estimateRemainingSeconds(experiment: ExperimentListItemDto) {
  if (experiment.status !== 'running' || experiment.processedSamples <= 0) return null;
  const remaining = Math.max(0, experiment.totalSamples - experiment.processedSamples);
  if (remaining === 0) return 0;
  return Math.round((getDurationSeconds(experiment) / experiment.processedSamples) * remaining);
}

function toExperimentSummary(
  experiment: ExperimentListItemDto,
  formatDateTime: (value: string | null | undefined, options?: { fallback?: string }) => string,
): ExperimentSummary {
  const durationSeconds = getDurationSeconds(experiment);
  const remainingSeconds = estimateRemainingSeconds(experiment);
  const ownerHandle = experiment.createdByUsername
    ? `@${experiment.createdByUsername}`
    : (experiment.createdByDisplayName ?? '—');
  const status = normalizeExperimentStatus(experiment.status);
  const displayStatus = deriveExperimentDisplayStatus(experiment.status, experiment.controlState);

  return {
    id: experiment.id,
    name: experiment.name,
    description:
      experiment.description ??
      `${experiment.promptName} ${experiment.promptVersionLabel} · ${experiment.datasetName} · ${experiment.modelName}`,
    ownerHandle,
    optimizationId: experiment.optimizationId ?? undefined,
    roundIndex: experiment.roundIndex ?? undefined,
    promptId: experiment.promptId,
    promptVersionId: experiment.promptVersionId,
    datasetId: experiment.datasetId,
    modelId: experiment.modelId,
    promptName: experiment.promptName,
    promptVersion: experiment.promptVersionLabel,
    promptVariableTypes: experiment.promptVariableTypes,
    datasetName: experiment.datasetName,
    datasetSamples: experiment.datasetSamples,
    datasetHasImages: experiment.datasetHasImages,
    modelName: experiment.modelName,
    modelVariant: experiment.modelVariant,
    status,
    controlState: experiment.controlState,
    displayStatus,
    progressDone: experiment.processedSamples,
    progressTotal: experiment.totalSamples,
    elapsedLabel: formatDuration(durationSeconds),
    remainingLabel: remainingSeconds === null ? undefined : formatDuration(remainingSeconds),
    durationLabel: experiment.finishedAt ? formatDuration(durationSeconds) : undefined,
    agoLabel: formatDateTime(experiment.finishedAt ?? experiment.updatedAt, { fallback: '—' }),
    failureReason: experiment.failureReason ?? undefined,
    failureKind: experiment.failureKind ?? undefined,
    failedSamples: experiment.failedSamples,
    accuracy: experiment.metrics?.accuracy ?? undefined,
    precision: experiment.metrics?.precision ?? undefined,
    recall: experiment.metrics?.recall ?? undefined,
    f1: experiment.metrics?.f1 ?? undefined,
    perClassMetrics: experiment.metrics?.perClass ?? undefined,
    inputTokens: experiment.metrics?.inputTokens ?? undefined,
    outputTokens: experiment.metrics?.outputTokens ?? undefined,
    costEstimate: experiment.metrics?.costEstimate ?? undefined,
    averageLatencyMs: experiment.metrics?.averageLatencyMs ?? undefined,
    p50LatencyMs: experiment.metrics?.p50LatencyMs ?? undefined,
    p95LatencyMs: experiment.metrics?.p95LatencyMs ?? undefined,
    startedAt: experiment.startedAt ?? experiment.createdAt,
    runConfig: experiment.runConfig,
  };
}

function getExperimentSearchText(experiment: ExperimentSummary) {
  return [
    experiment.name,
    experiment.description,
    experiment.promptName,
    experiment.promptVersion,
    experiment.datasetName,
    experiment.modelName,
    experiment.modelVariant,
    experiment.ownerHandle,
  ]
    .join(' ')
    .toLowerCase();
}

function getStatusCount(experiments: ExperimentSummary[], status: ExperimentStatus) {
  return experiments.filter((experiment) => experiment.status === status).length;
}

function getHeaderStats(stats?: ExperimentListStatsDto) {
  return {
    newThisWeek: String(stats?.newThisWeek ?? 0),
    averageDuration: formatDuration(stats?.averageDurationSeconds),
    durationStat: {
      median: formatDuration(stats?.medianDurationSeconds),
      p90: formatDuration(stats?.p90DurationSeconds),
    },
    tokens: formatCompactNumber((stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0)),
    tokenSplit: {
      input: formatCompactNumber(stats?.inputTokens ?? 0),
      output: formatCompactNumber(stats?.outputTokens ?? 0),
    },
    cost: formatMoney(stats?.costEstimate ?? 0),
  };
}

export function ExperimentsListPage({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewMode = resolveViewMode(searchParams.get('view'));
  const comparisonIds = useMemo(() => parseComparisonIds(searchParams.get('compare')), [searchParams]);
  const [activeFilter, setActiveFilter] = useState<ExperimentFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(10);
  const [sortMode, setSortMode] = useState<'accuracy' | 'updated' | 'duration'>('updated');
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExperimentDeleteTarget | null>(null);
  const experimentsQuery = useExperiments(projectId, { sort: sortMode });
  const controlExperiment = useControlExperiment(projectId);
  const deleteExperiment = useDeleteExperiment(projectId);
  const queryClient = useQueryClient();

  const experiments = useMemo(
    () => (experimentsQuery.data?.data ?? []).map((item) => toExperimentSummary(item, formatDateTime)),
    [experimentsQuery.data?.data, formatDateTime],
  );
  const headerStats = useMemo(() => getHeaderStats(experimentsQuery.data?.stats), [experimentsQuery.data?.stats]);
  const hasLiveExperiments = useMemo(
    () => experiments.some((experiment) => experiment.status === 'running'),
    [experiments],
  );

  const onAutoRefreshTick = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['experiments', projectId], exact: false });
  }, [queryClient, projectId]);

  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: hasLiveExperiments,
    onTick: onAutoRefreshTick,
  });

  const filteredExperiments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = experiments
      .filter((experiment) => activeFilter === 'all' || experiment.status === activeFilter)
      .filter((experiment) => !query || getExperimentSearchText(experiment).includes(query));

    return [...list].sort((a, b) => {
      if (sortMode === 'accuracy') {
        return (b.accuracy ?? -1) - (a.accuracy ?? -1);
      }
      if (sortMode === 'updated') {
        return b.startedAt.localeCompare(a.startedAt);
      }
      return b.progressDone / Math.max(1, b.progressTotal) - a.progressDone / Math.max(1, a.progressTotal);
    });
  }, [activeFilter, experiments, searchQuery, sortMode]);
  const comparisonSelectedIds = useMemo(() => {
    const existingIds = new Set(experiments.map((experiment) => experiment.id));
    return comparisonIds.filter((id) => existingIds.has(id));
  }, [comparisonIds, experiments]);
  const replaceListUrl = useCallback(
    ({
      nextViewMode = viewMode,
      nextComparisonIds = comparisonIds,
    }: {
      nextViewMode?: ViewMode;
      nextComparisonIds?: string[];
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextViewMode === 'compare') params.set('view', 'compare');
      else params.delete('view');

      const uniqueComparisonIds = [...new Set(nextComparisonIds)];
      if (uniqueComparisonIds.length > 0) params.set('compare', uniqueComparisonIds.join(','));
      else params.delete('compare');

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [comparisonIds, pathname, router, searchParams, viewMode],
  );
  const updateViewMode = useCallback(
    (nextViewMode: ViewMode) => {
      replaceListUrl({ nextViewMode });
    },
    [replaceListUrl],
  );
  const updateComparisonIds = useCallback(
    (nextIds: string[]) => {
      replaceListUrl({ nextViewMode: 'compare', nextComparisonIds: nextIds });
    },
    [replaceListUrl],
  );

  const pageCount = Math.max(1, Math.ceil(filteredExperiments.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedExperiments = useMemo(
    () => filteredExperiments.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize),
    [filteredExperiments, safePageIndex, pageSize],
  );

  const headState: 'off' | 'some' | 'all' = useMemo(() => {
    if (selectedIds.length === 0 || filteredExperiments.length === 0) return 'off';
    if (filteredExperiments.every((experiment) => selectedIds.includes(experiment.id))) return 'all';
    return 'some';
  }, [filteredExperiments, selectedIds]);

  const selectedExperiments = experiments.filter((experiment) => selectedIds.includes(experiment.id));
  const pendingExperimentId =
    controlExperiment.isPending || deleteExperiment.isPending
      ? (controlExperiment.variables?.experimentId ?? deleteExperiment.variables ?? null)
      : null;

  const bulkBreakdown = useMemo(() => {
    if (selectedExperiments.length === 0) return null;
    const groups: Partial<Record<ExperimentStatus, number>> = {};
    selectedExperiments.forEach((experiment) => {
      groups[experiment.status] = (groups[experiment.status] ?? 0) + 1;
    });
    return (Object.entries(groups) as Array<[ExperimentStatus, number]>)
      .map(([status, count]) => `${count} ${t(`experiments.status.${status}` as TranslationKey)}`)
      .join(' · ');
  }, [selectedExperiments, t]);

  const toggleSelected = (experimentId: string) =>
    setSelectedIds((current) =>
      current.includes(experimentId) ? current.filter((id) => id !== experimentId) : [...current, experimentId],
    );

  const toggleAll = () => {
    if (headState === 'all') {
      setSelectedIds((current) =>
        current.filter((id) => !filteredExperiments.some((experiment) => experiment.id === id)),
      );
    } else {
      const ids = new Set(selectedIds);
      filteredExperiments.forEach((experiment) => ids.add(experiment.id));
      setSelectedIds([...ids]);
    }
  };

  const openDeleteDialog = (targets: ExperimentSummary[]) => {
    if (targets.length === 0) return;
    setDeleteTarget({
      ids: targets.map((experiment) => experiment.id),
      names: targets.map((experiment) => experiment.name),
    });
  };

  const runBulkControl = async (action: Extract<ExperimentControlActionDto, 'stop' | 'resume'>) => {
    const targets = selectedExperiments.filter((experiment) =>
      action === 'stop' ? experiment.status === 'running' : experiment.status === 'stopped',
    );
    if (targets.length === 0) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      await Promise.all(
        targets.map((experiment) => controlExperiment.mutateAsync({ experimentId: experiment.id, action })),
      );
      setSelectedIds((current) => current.filter((id) => !targets.some((experiment) => experiment.id === id)));
    } catch (error) {
      setActionError(getApiErrorMessage(error) ?? t('common.loadFailedRefresh'));
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const targets = [...deleteTarget.ids];
    const isBulkDelete = targets.length > 1;
    if (isBulkDelete) setBulkBusy(true);
    setActionError(null);
    try {
      await Promise.all(targets.map((experimentId) => deleteExperiment.mutateAsync(experimentId)));
      setSelectedIds((current) => current.filter((id) => !targets.includes(id)));
      setDeleteTarget(null);
    } catch (error) {
      setActionError(getApiErrorMessage(error) ?? t('common.loadFailedRefresh'));
    } finally {
      if (isBulkDelete) setBulkBusy(false);
    }
  };

  const isBusy = bulkBusy || controlExperiment.isPending || deleteExperiment.isPending;

  const experimentsLoading = useDelayedLoading(experimentsQuery.isLoading && !experimentsQuery.data);

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="experiments-page">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold">{t('experiments.title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-r pr-3">
                <span className="text-xs text-muted-foreground">
                  {t('experiments.selected')} <b className="font-mono text-foreground">{selectedIds.length}</b>
                  {bulkBreakdown && <span className="ml-1.5 text-muted-foreground">· {bulkBreakdown}</span>}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={isBusy || !selectedExperiments.some((experiment) => experiment.status === 'stopped')}
                  onClick={() => void runBulkControl('resume')}
                >
                  {bulkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  {t('experiments.bulk.resume')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={isBusy || !selectedExperiments.some((experiment) => experiment.status === 'running')}
                  onClick={() => void runBulkControl('stop')}
                >
                  {bulkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                  {t('experiments.bulk.stop')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 border-destructive/40 text-destructive hover:text-destructive"
                  disabled={isBusy}
                  onClick={() => openDeleteDialog(selectedExperiments)}
                >
                  {bulkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  {t('experiments.bulk.delete')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={isBusy}
                  onClick={() => setSelectedIds([])}
                  aria-label={t('experiments.clearSelection')}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
            <Button asChild size="sm" className="h-9">
              <Link href={`/experiments/new`}>
                <Plus className="size-4" />
                {t('experiments.create')}
              </Link>
            </Button>
          </div>
        </div>

        {(actionError || experimentsQuery.isError) && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {actionError ?? t('common.loadFailedRefresh')}
          </div>
        )}

        {experimentsLoading ? (
          <section className="mb-5 grid grid-cols-1 gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </section>
        ) : (
          <section className="mb-5 grid grid-cols-1 gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
            <HeaderStatCard
              label={t('experiments.headerStat.newThisWeek')}
              value={headerStats.newThisWeek}
              footer={`${t('experiments.headerStat.weekDelta')} —`}
            />
            <HeaderStatCard
              label={t('experiments.headerStat.avgDuration')}
              value={headerStats.averageDuration}
              unit={t('experiments.headerStat.avgDurationUnit')}
              footer={formatTemplate(t('experiments.headerStat.durationStat'), {
                median: headerStats.durationStat.median,
                p90: headerStats.durationStat.p90,
              })}
            />
            <HeaderStatCard
              label={t('experiments.headerStat.tokens')}
              value={headerStats.tokens}
              unit="token"
              footer={formatTemplate(t('experiments.headerStat.tokensSplit'), headerStats.tokenSplit)}
            />
            <HeaderStatCard label={t('experiments.headerStat.cost')} value={headerStats.cost} />
          </section>
        )}

        <section className="rounded-lg border bg-card" aria-label={t('experiments.listSurface')}>
          <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-[320px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setPageIndex(0);
                  }}
                  placeholder={t('experiments.searchPlaceholder')}
                  className="h-9 pl-8 text-sm"
                />
              </div>
              <ChipFilter
                active={activeFilter === 'all'}
                count={experiments.length}
                label={t('experiments.filter.all')}
                onClick={() => {
                  setActiveFilter('all');
                  setPageIndex(0);
                }}
              />
              {STATUS_FILTERS.map((filter) => (
                <ChipFilter
                  key={filter.key}
                  active={activeFilter === filter.key}
                  tone={filter.key}
                  count={getStatusCount(experiments, filter.key)}
                  label={t(filter.labelKey)}
                  onClick={() => {
                    setActiveFilter(filter.key);
                    setPageIndex(0);
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5">
                    <Sliders className="size-4" />
                    {formatTemplate(t('experiments.sortLabel'), { field: t(SORT_LABEL_KEYS[sortMode]) })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(SORT_LABEL_KEYS) as Array<keyof typeof SORT_LABEL_KEYS>).map((mode) => (
                    <DropdownMenuItem key={mode} onClick={() => setSortMode(mode)}>
                      {t(SORT_LABEL_KEYS[mode])}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="text-xs text-muted-foreground">{t('experiments.viewMode')}</span>
              <SlidingViewToggle
                value={viewMode}
                ariaLabel={t('experiments.viewMode')}
                onChange={updateViewMode}
                options={[
                  { value: 'table', label: t('experiments.viewTable'), icon: List },
                  { value: 'compare', label: t('experiments.viewCompare'), icon: BarChart3 },
                ]}
              />
            </div>
          </div>

          {experimentsLoading ? (
            <div className="relative">
              <ListRowsSkeleton rows={8} />
              <PlatformLoaderOverlay />
            </div>
          ) : viewMode === 'table' ? (
            <>
              <ExperimentsTable
                experiments={pagedExperiments}
                projectId={projectId}
                selectedIds={selectedIds}
                headState={headState}
                pendingExperimentId={pendingExperimentId}
                emptyMessage={t('experiments.empty')}
                onToggleSelected={toggleSelected}
                onToggleAll={toggleAll}
                onDelete={(experimentId) => {
                  const target = experiments.find((experiment) => experiment.id === experimentId);
                  if (target) openDeleteDialog([target]);
                }}
                onRowClick={(experiment) => router.push(`/experiments/${experiment.id}`)}
              />
              <ResourcePaginationFooter
                summary={
                  <span>
                    {t('experiments.totalPrefix')}{' '}
                    <span className="font-mono font-medium text-foreground">{filteredExperiments.length}</span>{' '}
                    {t('experiments.totalSuffix')} · {t('experiments.selected')}{' '}
                    <span className="font-mono font-medium text-foreground">{selectedIds.length}</span>
                  </span>
                }
                pageIndex={safePageIndex}
                pageCount={pageCount}
                pageSize={pageSize}
                pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
                previousPageLabel={t('common.previousPage')}
                nextPageLabel={t('common.nextPage')}
                onPageChange={setPageIndex}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPageIndex(0);
                }}
              />
            </>
          ) : (
            <ExperimentsComparisonView
              projectId={projectId}
              experiments={experiments}
              candidateExperiments={filteredExperiments}
              selectedIds={comparisonSelectedIds}
              onSelectedIdsChange={updateComparisonIds}
              onRowClick={(experiment) => router.push(`/experiments/${experiment.id}`)}
            />
          )}
        </section>
        <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent data-testid="experiments-delete-dialog">
            <DialogHeader>
              <DialogTitle>
                {deleteTarget && deleteTarget.ids.length > 1
                  ? formatTemplate(t('experiments.delete.bulkTitle'), { count: deleteTarget.ids.length })
                  : t('experiments.delete.title')}
              </DialogTitle>
              <DialogDescription>
                {deleteTarget && deleteTarget.ids.length > 1
                  ? t('experiments.delete.bulkDescription')
                  : t('experiments.delete.description')}
              </DialogDescription>
            </DialogHeader>
            {deleteTarget && (
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('experiments.delete.targetLabel')}
                </div>
                <div className="mt-1.5 space-y-1 text-[12.5px]">
                  {deleteTarget.names.slice(0, 5).map((name) => (
                    <div key={name} className="truncate font-mono text-foreground">
                      {name}
                    </div>
                  ))}
                  {deleteTarget.names.length > 5 && (
                    <div className="text-muted-foreground">
                      {formatTemplate(t('experiments.delete.more'), { count: deleteTarget.names.length - 5 })}
                    </div>
                  )}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={isBusy}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmDelete()}
                disabled={isBusy || !deleteTarget}
                data-testid="experiments-delete-confirm"
              >
                {isBusy ? t('experiments.delete.pending') : t('experiments.delete.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Main>
  );
}
