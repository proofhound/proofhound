'use client';

import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { useRouter } from '../../hooks/use-router';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowRight, Play, Plus, RotateCcw, Search, Square } from 'lucide-react';
import { Main } from '@proofhound/ui/layout';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh, useDateTimeFormatter } from '../../hooks';
import {
  useArchiveReleaseLine,
  useReleaseLineList,
  useStartReleaseLine,
  useStopReleaseLine,
  useUnarchiveReleaseLine,
} from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n } from '../../i18n';
import { filterReleaseLines, getReleaseStopConfirmationName, summarizeReleaseLines } from '../../lib';
import type { ReleaseLineView } from '../../lib';
import {
  ConnectorTypeBadge,
  ReleaseMetricCard,
  ReleaseLineStatusBadge,
  ReleaseTrafficBar,
  formatCount,
  formatPercent,
} from './release-line-ui';

const RELEASE_COLUMNS: TableColumn[] = [
  { key: 'line', width: 'wide' },
  { key: 'production', width: 'normal' },
  { key: 'canary', width: 'normal' },
  { key: 'traffic', width: 'compact' },
  { key: 'connectors', width: 'flex', minPx: 380 },
  { key: 'createdAt', width: 'compact' },
  { key: 'updatedAt', width: 'compact' },
  { key: 'actions', width: 'compact', sticky: 'right' },
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
  const stopLineMutation = useStopReleaseLine(projectId);
  const startLineMutation = useStartReleaseLine(projectId);
  const archiveLineMutation = useArchiveReleaseLine(projectId);
  const unarchiveLineMutation = useUnarchiveReleaseLine(projectId);
  const releaseLineLoading = useDelayedLoading(releaseLineQuery.isLoading);
  const [search, setSearch] = useState('');
  const [stopTarget, setStopTarget] = useState<ReleaseLineView | null>(null);
  const [stopConfirmationText, setStopConfirmationText] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<ReleaseLineView | null>(null);
  const lines = releaseLineQuery.data;
  const stopTargetName = useMemo(() => getReleaseStopConfirmationName(stopTarget), [stopTarget]);
  const canConfirmStop = stopConfirmationText === stopTargetName && stopTargetName.length > 0;
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
  const filtered = useMemo(() => filterReleaseLines(lines, 'all', search), [lines, search]);

  function openStopDialog(event: MouseEvent, line: ReleaseLineView) {
    event.stopPropagation();
    setStopTarget(line);
    setStopConfirmationText('');
  }

  function closeStopDialog() {
    if (stopLineMutation.isPending) return;
    setStopTarget(null);
    setStopConfirmationText('');
  }

  function confirmStopLine() {
    if (!stopTarget || !canConfirmStop) return;
    stopLineMutation.mutate(
      {
        releaseLineId: stopTarget.id,
        body: { reason: t('releases.stopReason') },
      },
      {
        onSuccess: () => {
          setStopTarget(null);
          setStopConfirmationText('');
        },
      },
    );
  }

  function startLine(event: MouseEvent, line: ReleaseLineView) {
    event.stopPropagation();
    startLineMutation.mutate({
      releaseLineId: line.id,
      body: { reason: t('releases.startReason') },
    });
  }

  function openArchiveDialog(event: MouseEvent, line: ReleaseLineView) {
    event.stopPropagation();
    setArchiveTarget(line);
  }

  function closeArchiveDialog() {
    if (archiveLineMutation.isPending) return;
    setArchiveTarget(null);
  }

  function confirmArchiveLine() {
    if (!archiveTarget) return;
    archiveLineMutation.mutate(
      {
        releaseLineId: archiveTarget.id,
        body: { reason: t('releases.archiveReason') },
      },
      {
        onSuccess: () => setArchiveTarget(null),
      },
    );
  }

  function unarchiveLine(event: MouseEvent, line: ReleaseLineView) {
    event.stopPropagation();
    unarchiveLineMutation.mutate({
      releaseLineId: line.id,
      body: { reason: t('releases.unarchiveReason') },
    });
  }

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
            label={t('releases.metric.running')}
            value={formatCount(summary.running)}
            detail={t('releases.metric.runningHint')}
          />
          <ReleaseMetricCard
            tone="canary"
            label={t('releases.metric.stopped')}
            value={formatCount(summary.stopped)}
            detail={t('releases.metric.stoppedHint').replace('{count}', formatCount(summary.archived))}
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
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate font-semibold">{line.label}</span>
                          <ReleaseLineStatusBadge status={line.status} />
                        </div>
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
                      <div
                        className="inline-flex items-center justify-end gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {line.status === 'running' ? (
                          <TableActionIconButton
                            label={t('releases.action.stop')}
                            onClick={(event) => openStopDialog(event, line)}
                            disabled={stopLineMutation.isPending}
                            className="text-destructive hover:text-destructive"
                          >
                            <Square className="size-4" />
                          </TableActionIconButton>
                        ) : null}
                        {line.status === 'stopped' ? (
                          <TableActionIconButton
                            label={t('releases.action.start')}
                            onClick={(event) => startLine(event, line)}
                            disabled={startLineMutation.isPending}
                          >
                            <Play className="size-4" />
                          </TableActionIconButton>
                        ) : null}
                        {line.status === 'stopped' ? (
                          <TableActionIconButton
                            label={t('releases.action.archive')}
                            onClick={(event) => openArchiveDialog(event, line)}
                            disabled={archiveLineMutation.isPending}
                          >
                            <Archive className="size-4" />
                          </TableActionIconButton>
                        ) : null}
                        {line.status === 'archived' ? (
                          <TableActionIconButton
                            label={t('releases.action.unarchive')}
                            onClick={(event) => unarchiveLine(event, line)}
                            disabled={unarchiveLineMutation.isPending}
                          >
                            <RotateCcw className="size-4" />
                          </TableActionIconButton>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <Dialog open={Boolean(stopTarget)} onOpenChange={(open) => (open ? undefined : closeStopDialog())}>
        <DialogContent data-testid="release-line-stop-dialog">
          <DialogHeader>
            <DialogTitle>{t('releases.detail.stopDialog.title')}</DialogTitle>
            <DialogDescription>{t('releases.detail.stopDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[11.5px] font-medium text-muted-foreground">
              {t('releases.detail.stopDialog.releaseName')}
            </div>
            <div className="mt-1 break-all font-mono text-[13px] font-semibold">{stopTargetName || '—'}</div>
          </div>
          <div className="space-y-2">
            <label htmlFor="release-line-stop-name" className="text-[12.5px] font-medium">
              {t('releases.detail.stopDialog.inputLabel')}
            </label>
            <Input
              id="release-line-stop-name"
              value={stopConfirmationText}
              onChange={(event) => setStopConfirmationText(event.target.value)}
              placeholder={t('releases.detail.stopDialog.inputPlaceholder').replace('{name}', stopTargetName)}
              autoComplete="off"
            />
            {stopConfirmationText.length > 0 && !canConfirmStop ? (
              <p className="text-[12px] text-destructive">{t('releases.detail.stopDialog.mismatch')}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeStopDialog} disabled={stopLineMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmStopLine}
              disabled={!canConfirmStop || stopLineMutation.isPending}
            >
              <Square className="size-4" />
              {stopLineMutation.isPending
                ? t('releases.detail.stopDialog.stopping')
                : t('releases.detail.stopDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => (open ? undefined : closeArchiveDialog())}>
        <DialogContent data-testid="release-line-archive-dialog">
          <DialogHeader>
            <DialogTitle>{t('releases.archiveDialog.title')}</DialogTitle>
            <DialogDescription>{t('releases.archiveDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-[11.5px] font-medium text-muted-foreground">
              {t('releases.detail.stopDialog.releaseName')}
            </div>
            <div className="mt-1 break-all font-mono text-[13px] font-semibold">{archiveTarget?.label ?? '—'}</div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeArchiveDialog} disabled={archiveLineMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={confirmArchiveLine} disabled={archiveLineMutation.isPending}>
              <Archive className="size-4" />
              {archiveLineMutation.isPending ? t('releases.archiveDialog.archiving') : t('releases.archiveDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Main>
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
  const { t } = useI18n();
  const output = line.outputConnectors.slice(0, 2);
  const extra = line.outputConnectors.length - output.length;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-mono text-[12px]">
      <div
        className="flex min-w-0 items-center gap-1.5"
        aria-label={t('releases.detail.field.upstream')}
        title={t('releases.detail.field.upstream')}
      >
        <span className="shrink-0">
          <ConnectorTypeBadge type={line.inputConnectorType} />
        </span>
        <span className="min-w-0 truncate">{line.inputConnectorName ?? '—'}</span>
      </div>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div
        className="flex min-w-0 flex-col gap-1 text-muted-foreground"
        aria-label={t('releases.detail.field.downstream')}
        title={t('releases.detail.field.downstream')}
      >
        {output.length === 0 ? (
          <span>—</span>
        ) : (
          output.map((connector) => (
            <span key={connector.id} className="inline-flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">
                <ConnectorTypeBadge type={connector.type} />
              </span>
              <span className="min-w-0 truncate">{connector.name}</span>
            </span>
          ))
        )}
        {extra > 0 ? <span className="text-[11px]">+{extra}</span> : null}
      </div>
    </div>
  );
}
