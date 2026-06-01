'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, CircleDollarSign, Coins, Gauge, LineChart, RefreshCcw } from 'lucide-react';
import type {
  ModelMonitoringRankingResponseDto,
  ProjectMonitoringFilterDto,
  ProjectMonitoringStatsDto,
  ProjectMonitoringTimeseriesDto,
  PromptMonitoringRankingResponseDto,
  SourceBucket,
} from '@proofhound/shared';
import {
  DateRangeSegmented,
  type DateRangePresetOption,
  type DateRangeSegmentedLabels,
  type DateRangeValue,
  resolveDateRangePreset,
} from '@proofhound/ui';
import { useProjectModels } from '../../hooks';
import {
  useDelayedLoading,
  useProjectModelMonitoringRanking,
  useProjectMonitoringStats,
  useProjectMonitoringTimeseries,
  usePromptMonitoringRanking,
} from '../../hooks';
import { usePrompts } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { useProjectContext } from '../../providers';
import { BigChartCard, type DeltaTone } from './big-chart-card';
import { MonitoringFilterStrip } from './monitoring-filter-strip';
import { ProjectModelRankingCard, PromptRankingCard } from './ranking-cards';

const DEFAULT_SOURCES: ReadonlyArray<SourceBucket> = ['prod', 'canary', 'iter', 'exp'];
const EMPTY_BY_SOURCE: Record<SourceBucket, number> = { prod: 0, canary: 0, iter: 0, exp: 0 };

type ProjectMonitoringPageProps = {
  testId: string;
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
};

export function ProjectMonitoringPage({ testId, titleKey, subtitleKey }: ProjectMonitoringPageProps) {
  const { projectId } = useProjectContext();
  const { t, language } = useI18n();
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const initial = resolveDateRangePreset('d7');
    if (initial) return { preset: 'd7', ...initial };
    const now = new Date();
    return { preset: 'd7', from: new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(), to: now.toISOString() };
  });
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [sources, setSources] = useState<SourceBucket[]>([...DEFAULT_SOURCES]);
  const [promptSortBy, setPromptSortBy] = useState<PromptMonitoringRankingResponseDto['sortBy']>('requests');
  const [modelSortBy, setModelSortBy] = useState<ModelMonitoringRankingResponseDto['sortBy']>('requests');

  const promptsQuery = usePrompts(projectId);
  const modelsQuery = useProjectModels(projectId);
  const promptsList = useMemo(() => promptsQuery.data?.data ?? [], [promptsQuery.data]);
  const modelsList = useMemo(() => modelsQuery.data?.data ?? [], [modelsQuery.data]);

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

  const promptOptions = useMemo(
    () =>
      promptsList.map((prompt) => ({
        value: prompt.id,
        label: prompt.name,
        meta: `v${prompt.latestVersionNumber}`,
        logoText: initials(prompt.name),
      })),
    [promptsList],
  );

  const modelOptions = useMemo(
    () =>
      modelsList.map((model) => ({
        value: model.id,
        label: model.name,
        meta: model.providerType,
        logoText: initials(model.name),
      })),
    [modelsList],
  );

  const filter: ProjectMonitoringFilterDto = {
    from: dateRange.from,
    to: dateRange.to,
    promptIds: selectedPromptIds.length ? selectedPromptIds : undefined,
    modelIds: selectedModelIds.length ? selectedModelIds : undefined,
    sources: sources.length === DEFAULT_SOURCES.length ? undefined : sources,
    granularity: 'auto',
  };

  const statsQuery = useProjectMonitoringStats(projectId, filter);
  const timeseriesQuery = useProjectMonitoringTimeseries(projectId, filter);
  const promptRankingQuery = usePromptMonitoringRanking(projectId, filter, promptSortBy);
  const modelRankingQuery = useProjectModelMonitoringRanking(projectId, filter, modelSortBy);
  const promptRankingLoading = useDelayedLoading(promptRankingQuery.isPending);
  const modelRankingLoading = useDelayedLoading(modelRankingQuery.isPending);

  const granularityLabel =
    timeseriesQuery.data?.granularity === 'minute'
      ? t('monitoring.filter.granularity.minute')
      : timeseriesQuery.data?.granularity === 'day'
        ? t('monitoring.filter.granularity.day')
        : t('monitoring.filter.granularity.hour');

  const timeseriesPoints = timeseriesQuery.data?.points ?? [];
  const totalRpmLimit = modelsList.reduce((acc, model) => {
    const limit = Number(model.rpm?.limit ?? 0);
    return limit > 0 ? acc + limit : acc;
  }, 0);
  const rpmThreshold = totalRpmLimit > 0 ? { value: totalRpmLimit, label: t('monitoring.metric.rpmLimit') } : null;
  const stats = statsQuery.data;

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ['project-monitoring', projectId] });
  }

  function pickTimeseries(metric: 'requests' | 'errors' | 'rpm' | 'tpm' | 'tokens' | 'cost') {
    return timeseriesPoints.map((point) => ({
      x: formatXLabel(point.bucketAt, timeseriesQuery.data?.granularity ?? 'hour'),
      prod: point[metric].prod,
      canary: point[metric].canary,
      iter: point[metric].iter,
      exp: point[metric].exp,
    }));
  }

  function pickFailureRateTimeseries() {
    return pickFailureRateContributionTimeseries(timeseriesPoints, timeseriesQuery.data?.granularity ?? 'hour');
  }

  return (
    <main
      className="min-h-[calc(100svh-3.5rem)] bg-background"
      data-testid={testId}
      style={{ background: 'color-mix(in srgb, var(--muted) 35%, var(--background))' }}
    >
      <div className="flex flex-col gap-4 px-5 pt-5 md:px-8 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold">{t(titleKey)}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t(subtitleKey)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeSegmented
            value={dateRange}
            onChange={setDateRange}
            presetLabels={dateRangePresetLabels}
            labels={dateRangeLabels}
            locale={language}
          />
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3.5 text-[13px] font-medium hover:bg-accent"
          >
            <RefreshCcw className="size-4" />
            {t('monitoring.refresh')}
          </button>
        </div>
      </div>

      <div className="px-5 pt-4 pb-2 md:px-8">
        <MonitoringFilterStrip
          promptOptions={promptOptions}
          selectedPromptIds={selectedPromptIds}
          onSelectedPromptIdsChange={setSelectedPromptIds}
          modelOptions={modelOptions}
          selectedModelIds={selectedModelIds}
          onSelectedModelIdsChange={setSelectedModelIds}
          sources={sources}
          onSourcesChange={setSources}
          granularityLabel={granularityLabel}
        />
      </div>

      {statsQuery.isError || timeseriesQuery.isError ? (
        <div className="px-5 pt-4 md:px-8">
          <div className="rounded-lg border bg-card px-4 py-3 text-sm text-destructive">
            {t('monitoring.error.title')}
          </div>
        </div>
      ) : null}

      <div className="px-5 pt-4 md:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BigChartCard
            title={t('monitoring.metric.requests')}
            icon={<LineChart className="size-4" strokeWidth={2.2} />}
            iconBg="var(--src-canary-soft)"
            iconFg="var(--src-canary-fg)"
            total={formatBigNumber(stats?.requests.total ?? 0)}
            comparison={comparisonFromDelta(
              stats?.requests.total ?? 0,
              stats?.requests.previous ?? 0,
              formatBigNumber,
              t('monitoring.delta.vsPreviousPeriod'),
            )}
            subtitle={t('monitoring.delta.requestsSubtitle')}
            data={pickTimeseries('requests')}
            yTickFormatter={formatBigNumber}
            legendFormatter={formatBigNumber}
            bySource={stats?.requests.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            {...chartLabels}
          />
          <BigChartCard
            title={t('monitoring.metric.failureRate')}
            icon={<AlertTriangle className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-pending-bg)"
            iconFg="var(--status-pending-fg)"
            total={failureRatePercent(stats, 'total').toFixed(2)}
            unit="%"
            comparison={comparisonFromDelta(
              failureRatePercent(stats, 'total'),
              failureRatePercent(stats, 'previous'),
              (value) => value.toFixed(2),
              t('monitoring.delta.vsPreviousPeriod'),
              '%',
            )}
            subtitle={t('monitoring.delta.failureRateSubtitle')}
            data={pickFailureRateTimeseries()}
            yTickFormatter={formatPercentValue}
            legendFormatter={formatPercentValue}
            bySource={failureRateBySourcePercent(stats)}
            sourceLabels={sourceLabels}
            sourceDistributionLabel={chartLabels.sourceDistributionLabel}
            totalLabel={chartLabels.failureRateTotalLabel}
          />
          <BigChartCard
            title={t('monitoring.metric.rpm')}
            icon={<Gauge className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-pending-bg)"
            iconFg="var(--status-pending-fg)"
            total={formatRate(stats?.rpmPeak.total ?? 0)}
            comparison={comparisonFromDelta(
              stats?.rpmPeak.total ?? 0,
              stats?.rpmPeak.previous ?? 0,
              formatRate,
              t('monitoring.delta.vsPreviousPeriod'),
            )}
            subtitle={t('monitoring.delta.rpmSubtitle')}
            data={pickTimeseries('rpm')}
            yTickFormatter={formatRate}
            legendFormatter={formatRate}
            bySource={stats?.rpmPeak.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            {...chartLabels}
            threshold={rpmThreshold}
          />
          <BigChartCard
            title={t('monitoring.metric.tpm')}
            icon={<Activity className="size-4" strokeWidth={2.2} />}
            iconBg="var(--src-iter-soft)"
            iconFg="var(--src-iter-fg)"
            total={formatBigNumber(stats?.tpmPeak.total ?? 0)}
            comparison={comparisonFromDelta(
              stats?.tpmPeak.total ?? 0,
              stats?.tpmPeak.previous ?? 0,
              formatBigNumber,
              t('monitoring.delta.vsPreviousPeriod'),
            )}
            subtitle={t('monitoring.delta.tpmSubtitle')}
            data={pickTimeseries('tpm')}
            yTickFormatter={formatBigNumber}
            legendFormatter={formatBigNumber}
            bySource={stats?.tpmPeak.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            {...chartLabels}
          />
          <BigChartCard
            title={t('monitoring.metric.tokens')}
            icon={<Coins className="size-4" strokeWidth={2.2} />}
            iconBg="var(--src-prod-soft)"
            iconFg="var(--src-prod-fg)"
            total={formatBigNumber(stats?.tokens.total ?? 0)}
            comparison={comparisonFromDelta(
              stats?.tokens.total ?? 0,
              stats?.tokens.previous ?? 0,
              formatBigNumber,
              t('monitoring.delta.vsPreviousPeriod'),
            )}
            subtitle={t('monitoring.delta.tokensSubtitle')}
            data={pickTimeseries('tokens')}
            yTickFormatter={formatBigNumber}
            legendFormatter={formatBigNumber}
            bySource={stats?.tokens.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            {...chartLabels}
          />
          <BigChartCard
            title={t('monitoring.metric.cost')}
            icon={<CircleDollarSign className="size-4" strokeWidth={2.2} />}
            iconBg="var(--status-running-bg)"
            iconFg="var(--status-running-fg)"
            total={formatCost(stats?.cost.total ?? 0)}
            comparison={comparisonFromDelta(
              stats?.cost.total ?? 0,
              stats?.cost.previous ?? 0,
              formatCost,
              t('monitoring.delta.vsPreviousPeriod'),
            )}
            subtitle={t('monitoring.delta.costSubtitle')}
            data={pickTimeseries('cost')}
            yTickFormatter={formatCost}
            legendFormatter={formatCost}
            bySource={stats?.cost.bySource ?? EMPTY_BY_SOURCE}
            sourceLabels={sourceLabels}
            {...chartLabels}
          />
        </div>
      </div>

      <div className="px-5 pt-6 pb-10 md:px-8">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PromptRankingCard
            data={promptRankingQuery.data?.items ?? []}
            sortBy={promptSortBy}
            onSortByChange={setPromptSortBy}
            loading={promptRankingLoading}
            totalPrompts={promptsList.length}
            formatRequests={formatBigNumber}
            formatCost={formatCost}
          />
          <ProjectModelRankingCard
            data={modelRankingQuery.data?.items ?? []}
            sortBy={modelSortBy}
            onSortByChange={setModelSortBy}
            loading={modelRankingLoading}
            formatRequests={formatBigNumber}
            formatTokens={formatBigNumber}
            formatCost={formatCost}
          />
        </div>
      </div>

      {statsQuery.data && statsQuery.data.requests.total === 0 && statsQuery.data.requests.previous === 0 && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md border bg-card px-3 py-2 text-[12px] text-muted-foreground shadow-md">
          <div className="font-medium text-foreground">{t('monitoring.empty.title')}</div>
          <div>{t('monitoring.empty.description')}</div>
        </div>
      )}
    </main>
  );
}

function initials(name: string): string {
  const letters = name.match(/[A-Z]/g);
  if (letters && letters.length >= 2) return (letters[0] + letters[1]).toUpperCase();
  return (name.slice(0, 2) || '-').toUpperCase();
}

function formatBigNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + 'B';
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + 'k';
  return Math.round(value).toString();
}

function formatRate(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
  return value.toFixed(0);
}

function formatPercentValue(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0%';
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatCost(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  const abs = Math.abs(value);
  if (abs >= 10_000) return '$' + (value / 1000).toFixed(1) + 'k';
  if (abs >= 1000) return '$' + (value / 1000).toFixed(2) + 'k';
  return '$' + value.toFixed(4);
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

function pickFailureRateContributionTimeseries(
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

function failureRateContributionPercent(errors: number, totalRequests: number): number {
  return totalRequests > 0 ? (errors / totalRequests) * 100 : 0;
}

function sourceBucketTotal(values: Record<SourceBucket, number>): number {
  return values.prod + values.canary + values.iter + values.exp;
}

function formatXLabel(iso: string, granularity: 'minute' | 'hour' | 'day'): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (granularity === 'day') return `${date.getMonth() + 1}/${date.getDate()}`;
  if (granularity === 'hour') return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:00`;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
