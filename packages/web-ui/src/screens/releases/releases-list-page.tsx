'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { Main } from '@proofhound/ui/layout';
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableActionIconButton,
  cn,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh, useDateTimeFormatter } from '../../hooks';
import { useReleaseLineList } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { filterReleaseLines, summarizeReleaseLines } from '../../lib';
import type { ReleaseLineFilter, ReleaseLineView } from '../../lib';
import {
  ConnectorTypeBadge,
  ReleaseMetricCard,
  ReleaseTrafficBar,
  formatCount,
  formatPercent,
} from './release-line-ui';

const FILTERS: Array<{ value: ReleaseLineFilter; key: TranslationKey }> = [
  { value: 'all', key: 'releases.filter.all' },
  { value: 'production', key: 'releases.filter.production' },
  { value: 'production_canary', key: 'releases.filter.productionCanary' },
  { value: 'canary', key: 'releases.filter.canary' },
  { value: 'stopped', key: 'releases.filter.stopped' },
];

const RELEASE_COLUMNS: TableColumn[] = [
  { key: 'line', width: 'flex', minPx: 230 },
  { key: 'production', width: 'normal' },
  { key: 'canary', width: 'normal' },
  { key: 'traffic', width: 'wide' },
  { key: 'connectors', width: 'wide' },
  { key: 'createdAt', width: 'compact' },
  { key: 'updatedAt', width: 'compact' },
  { key: 'actions', width: 'narrow', sticky: 'right' },
];

function hasRunningRelease(line: ReleaseLineView) {
  return line.production?.currentEvent?.status === 'running' || line.canary?.status === 'running';
}

export function ReleasesListPage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const releaseLineQuery = useReleaseLineList(projectId);
  const releaseLineLoading = useDelayedLoading(releaseLineQuery.isLoading);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ReleaseLineFilter>('all');
  const lines = releaseLineQuery.data;
  const formatReleaseDateTime = useCallback(
    (value: string | null | undefined) => (value ? formatDateTime(value, { fallback: '—' }) : '—'),
    [formatDateTime],
  );
  const hasLiveReleases = useMemo(() => lines.some(hasRunningRelease), [lines]);

  const onTick = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['release-lines', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['production-releases', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['canary-releases', projectId] }),
    ]);
  }, [projectId, queryClient]);

  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: hasLiveReleases,
    onTick,
  });

  const summary = useMemo(() => summarizeReleaseLines(lines), [lines]);
  const filtered = useMemo(() => filterReleaseLines(lines, filter, search), [filter, lines, search]);
  const counts: Record<ReleaseLineFilter, number> = {
    all: summary.total,
    production: summary.production,
    production_canary: summary.productionCanary,
    canary: summary.canary,
    stopped: summary.stopped,
  };

  return (
    <Main fixed className="gap-5 overflow-auto bg-muted/35">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-5" data-testid="releases-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-tight">{t('releases.title')}</h1>
            <p className="mt-1 max-w-4xl text-[12.5px] text-muted-foreground">{t('releases.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => router.push('/releases/new')}>
              <Plus className="size-4" />
              {t('releases.action.new')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <ReleaseMetricCard
            label={t('releases.metric.totalLines')}
            value={formatCount(summary.total)}
            detail={t('releases.metric.totalLinesHint')}
          />
          <ReleaseMetricCard
            tone="production"
            label={t('releases.metric.production')}
            value={formatCount(summary.production + summary.productionCanary)}
            detail={t('releases.metric.productionHint').replace('{count}', formatCount(summary.productionCanary))}
          />
          <ReleaseMetricCard
            tone="canary"
            label={t('releases.metric.canary')}
            value={formatCount(summary.productionCanary + summary.canary)}
            detail={t('releases.metric.canaryHint').replace('{count}', formatCount(summary.annotationOpen))}
          />
          <ReleaseMetricCard
            label={t('releases.metric.failureRate')}
            value={formatPercent(summary.failureRate)}
            detail={t('releases.metric.failureRateHint').replace('{count}', formatCount(summary.totalErrors))}
          />
          <ReleaseMetricCard
            label={t('releases.metric.processed')}
            value={formatCount(summary.totalProcessed)}
            detail={t('releases.metric.processedHint')}
          />
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1 sm:max-w-[420px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('releases.search')}
                className="pl-9"
              />
            </div>
            {FILTERS.map((item) => (
              <FilterChip
                key={item.value}
                active={filter === item.value}
                label={t(item.key)}
                count={counts[item.value]}
                onClick={() => setFilter(item.value)}
              />
            ))}
          </div>
          {releaseLineQuery.isError ? (
            <div className="mt-2 text-[12px] text-destructive">{t('releases.loadPartialFailed')}</div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <Table columns={RELEASE_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead column="line">{t('releases.table.line')}</TableHead>
                <TableHead column="production">{t('releases.table.production')}</TableHead>
                <TableHead column="canary">{t('releases.table.canary')}</TableHead>
                <TableHead column="traffic">{t('releases.table.traffic')}</TableHead>
                <TableHead column="connectors">{t('releases.table.connectors')}</TableHead>
                <TableHead column="createdAt">{t('releases.table.createdAt')}</TableHead>
                <TableHead column="updatedAt">{t('releases.table.updatedAt')}</TableHead>
                <TableHead column="actions" className="text-right">
                  {t('common.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releaseLineLoading ? (
                <TableSkeletonRows />
              ) : filtered.length === 0 ? (
                <TableEmpty>{t('releases.empty')}</TableEmpty>
              ) : (
                filtered.map((line) => (
                  <TableRow key={line.id} onClick={() => router.push(`/releases/${encodeURIComponent(line.id)}`)}>
                    <TableCell column="line">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-semibold">{line.label}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{line.promptName}</span>
                      </div>
                    </TableCell>
                    <TableCell column="production">
                      <LaneVersion version={line.productionVersionLabel} model={line.productionModelName} />
                    </TableCell>
                    <TableCell column="canary">
                      <LaneVersion version={line.canaryVersionLabel} model={line.canaryModelName} />
                    </TableCell>
                    <TableCell column="traffic">
                      <ReleaseTrafficBar line={line} />
                    </TableCell>
                    <TableCell column="connectors">
                      <ConnectorStack line={line} />
                    </TableCell>
                    <TableCell column="createdAt">
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {formatReleaseDateTime(line.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell column="updatedAt">
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {formatReleaseDateTime(line.updatedAt)}
                      </span>
                    </TableCell>
                    <TableCell column="actions" className="text-right">
                      <TableActionIconButton
                        label={t('releases.action.enter')}
                        onClick={() => router.push(`/releases/${encodeURIComponent(line.id)}`)}
                      >
                        <ChevronRight className="size-4" />
                      </TableActionIconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Main>
  );
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
      <span className="font-mono opacity-70">{count}</span>
    </button>
  );
}

function LaneVersion({ version, model }: { version: string | null; model: string | null }) {
  if (!version && !model) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="min-w-0">
      <div className="font-mono text-[12.5px] font-semibold">{version ?? '—'}</div>
      <div className="truncate font-mono text-[11.5px] text-muted-foreground">{model ?? '—'}</div>
    </div>
  );
}

function ConnectorStack({ line }: { line: ReleaseLineView }) {
  const output = line.outputConnectors.slice(0, 2);
  const extra = line.outputConnectors.length - output.length;

  return (
    <div className="min-w-0 space-y-1 font-mono text-[12px]">
      <div className="flex min-w-0 items-center gap-1.5">
        <ConnectorTypeBadge type={line.inputConnectorType} />
        <span className="truncate">{line.inputConnectorName ?? '—'}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
        {output.length === 0 ? (
          <span>—</span>
        ) : (
          output.map((connector) => (
            <span key={connector.id} className="inline-flex min-w-0 items-center gap-1">
              <ConnectorTypeBadge type={connector.type} />
              <span className="max-w-28 truncate">{connector.name}</span>
            </span>
          ))
        )}
        {extra > 0 ? <span className="text-[11px]">+{extra}</span> : null}
      </div>
    </div>
  );
}
