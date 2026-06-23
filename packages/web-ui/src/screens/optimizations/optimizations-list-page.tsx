'use client';

import { Link } from '../../components/navigation/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from '../../hooks/use-router';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Ban, Check, ChevronDown, Columns3, List, Play, Plus, Square, Trash2, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FilterChip,
  KanbanScrollArea,
  ListRowsSkeleton,
  ListToolbar,
  ResourcePaginationFooter,
  SlidingViewToggle,
  ToolbarSearch,
  ToolbarSelectionBar,
  ToolbarSortMenu,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableActionRow,
  cn,
} from '@proofhound/ui';
import type { TableColumn, TableActionDescriptor } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useOptimizations, useControlOptimization, useDeleteOptimization } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import {
  OPTIMIZATION_STATUS_TONE,
  getStatusCount,
  mapDtoToSummary,
  type OptimizationStatus,
  type OptimizationSummary,
} from './optimization-mappers';
import { optimizationTone } from './optimization-theme';
import {
  OptimizationStatusBadge,
  GoalList,
  LoopProgressBar,
  OriginBadge,
  SelectionBox,
  SparkLine,
  formatTemplate,
  hitCount,
  renderRichInline,
} from './optimization-ui';

type ViewMode = 'table' | 'kanban';
type StatusFilter = 'all' | OptimizationStatus;
type OptimizationDeleteTarget = {
  ids: string[];
  names: string[];
};

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const STATUS_FILTERS: Array<{ key: OptimizationStatus; labelKey: TranslationKey }> = [
  { key: 'running', labelKey: 'optimizations.status.running' },
  { key: 'success', labelKey: 'optimizations.status.success' },
  { key: 'failed', labelKey: 'optimizations.status.failed' },
  { key: 'stopped', labelKey: 'optimizations.status.stopped' },
  { key: 'cancelled', labelKey: 'optimizations.status.cancelled' },
];

const SORT_LABEL_KEYS: Record<'bestMetric' | 'updated' | 'round', TranslationKey> = {
  bestMetric: 'optimizations.sort.bestMetric',
  updated: 'optimizations.sort.updated',
  round: 'optimizations.sort.round',
};

function resolveViewMode(value: string | null): ViewMode {
  return value === 'kanban' ? 'kanban' : 'table';
}

function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes}m ${String(restSeconds).padStart(2, '0')}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

function optimizationProgressTimingLabel(t: (key: TranslationKey) => string, item: OptimizationSummary) {
  const startedAt = new Date(item.createdAt).getTime();
  const updatedAt = new Date(item.updatedAt).getTime();
  const elapsedMs =
    Number.isFinite(startedAt) && Number.isFinite(updatedAt) ? Math.max(0, updatedAt - startedAt) : null;
  const remainingRounds = Math.max(0, item.maxRounds - item.currentRound);
  const isComplete = item.status === 'success' || item.status === 'failed' || item.status === 'cancelled';
  const remainingMs = isComplete
    ? 0
    : item.currentRound > 0 && elapsedMs !== null
      ? (elapsedMs / item.currentRound) * remainingRounds
      : null;

  return formatTemplate(t('common.progress.timing'), {
    elapsed: formatDurationMs(elapsedMs),
    remaining:
      remainingMs === null
        ? t('common.progress.calculating')
        : remainingMs <= 0
          ? t('common.progress.done')
          : formatDurationMs(remainingMs),
  });
}

function LiveCard({ item }: { item: OptimizationSummary }) {
  const { t } = useI18n();
  const hit = hitCount(item);
  const total = item.goals.length;
  const targetForSpark = item.goals[0]?.target;
  const hasBaseline = item.trendHasBaseline === true;
  const baselineForSpark = hasBaseline ? item.trend?.[0] : undefined;

  return (
    <Link
      href={`/optimizations/${item.id}`}
      className={cn(
        'group relative block rounded-lg border bg-card p-4 transition-colors hover:border-[var(--status-canary-bd)]',
        optimizationTone.info.border,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-semibold">{item.name}</div>
          <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{item.description}</div>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap',
            OPTIMIZATION_STATUS_TONE[item.status].pill,
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              OPTIMIZATION_STATUS_TONE[item.status].dot,
              OPTIMIZATION_STATUS_TONE[item.status].pulse && 'animate-pulse',
            )}
          />
          {formatTemplate(t('optimizations.live.roundShort'), { round: item.currentRound })}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {t('optimizations.live.goalHeader')}
        </span>
        {item.goals.map((goal, idx) => (
          <span
            key={`${goal.metric}-${idx}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono',
              goal.status === 'hit'
                ? optimizationTone.positive.pill
                : goal.status === 'fail'
                  ? optimizationTone.danger.pill
                  : 'border-dashed border-border text-muted-foreground',
            )}
          >
            {goal.status === 'hit' && <Check className="size-2.5" aria-hidden="true" />}
            <span className="text-foreground">
              {goal.metric}
              {goal.classLabel ? ` · ${goal.classLabel}` : ''}
            </span>
            <span className="tabular-nums">
              {goal.comparator} {goal.target.toFixed(2)}
            </span>
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {renderRichInline(t('optimizations.live.goalHit'), { hit, total }).map((part, i) =>
            part.bold ? (
              <b
                key={i}
                className={cn('font-bold', hit > 0 ? optimizationTone.positive.text : 'text-muted-foreground')}
              >
                {part.text}
              </b>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </span>
      </div>

      <div className="flex min-w-0 flex-col rounded-md border bg-muted/30 p-3">
        {item.trend && item.trend.length > 0 ? (
          <SparkLine
            values={item.trend}
            totalRounds={item.maxRounds}
            target={targetForSpark}
            baseline={baselineForSpark}
            hasBaseline={hasBaseline}
            status={item.status}
          />
        ) : (
          <div className="flex h-[160px] items-center justify-center text-[11.5px] text-muted-foreground">
            {t('optimizations.live.trendEmpty')}
          </div>
        )}
      </div>
    </Link>
  );
}

interface RowActionHandlers {
  onControl: (item: OptimizationSummary, action: 'stop' | 'resume' | 'cancel') => void;
  onDelete: (item: OptimizationSummary) => void;
  disabled: boolean;
}

function OptimizationRowActions({ item, handlers }: { item: OptimizationSummary; handlers: RowActionHandlers }) {
  const { t } = useI18n();
  const { onControl, onDelete, disabled } = handlers;
  const status = item.status;
  const canStop = status === 'running';
  const canResume = status === 'stopped';
  const canCancel = status === 'running' || status === 'stopped' || status === 'failed';
  const canDelete = status !== 'running';

  const actions: TableActionDescriptor[] = [
    {
      key: 'stop',
      label: t('optimizations.action.stop'),
      icon: Square,
      disabled,
      hide: !canStop,
      onClick: () => onControl(item, 'stop'),
    },
    {
      key: 'resume',
      label: t('optimizations.action.resume'),
      icon: Play,
      disabled,
      hide: !canResume,
      onClick: () => onControl(item, 'resume'),
    },
    {
      key: 'cancel',
      label: t('optimizations.action.cancel'),
      icon: Ban,
      disabled,
      hide: !canCancel,
      onClick: () => onControl(item, 'cancel'),
    },
    {
      key: 'delete',
      label: t('optimizations.action.delete'),
      icon: Trash2,
      destructive: true,
      disabled,
      hide: !canDelete,
      onClick: () => onDelete(item),
    },
  ];

  return <TableActionRow actions={actions} moreLabel={t('optimizations.action.more')} />;
}

function OptimizationsTable({
  items,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  headState,
  rowHandlers,
}: {
  items: OptimizationSummary[];
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
  onToggleAll: () => void;
  headState: 'off' | 'some' | 'all';
  rowHandlers: RowActionHandlers;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();

  return (
    <Table columns={OPTIMIZATIONS_COLUMNS} containerTestId="optimizations-table-view">
      <TableHeader>
        <TableRow>
          <TableHead column="select">
            <SelectionBox
              checked={headState === 'all'}
              ariaLabel={t('optimizations.selectAll')}
              onClick={onToggleAll}
            />
          </TableHead>
          <TableHead column="name">{t('optimizations.table.name')}</TableHead>
          <TableHead column="origin">{t('optimizations.table.origin')}</TableHead>
          <TableHead column="status">{t('optimizations.table.status')}</TableHead>
          <TableHead column="loop">{t('optimizations.table.loop')}</TableHead>
          <TableHead column="bestGoal">{t('optimizations.table.bestGoal')}</TableHead>
          <TableHead column="createdAt">{t('optimizations.table.createdAt')}</TableHead>
          <TableHead column="updatedAt">{t('optimizations.table.updatedAt')}</TableHead>
          <TableHead column="actions" className="text-right">
            {t('common.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableEmpty>{t('optimizations.kanban.empty')}</TableEmpty>
        ) : (
          items.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <TableRow key={item.id} selected={selected} onClick={() => router.push(`/optimizations/${item.id}`)}>
                <TableCell column="select">
                  <SelectionBox
                    checked={selected}
                    ariaLabel={`${t('optimizations.select')} ${item.name}`}
                    onClick={() => onToggleSelected(item.id)}
                  />
                </TableCell>
                <TableCell column="name">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-[13.5px] font-semibold">{item.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{item.description}</div>
                  </div>
                </TableCell>
                <TableCell column="origin">
                  <OriginBadge origin={item.origin} originRef={item.originRef} />
                </TableCell>
                <TableCell column="status">
                  <OptimizationStatusBadge status={item.status} />
                </TableCell>
                <TableCell column="loop">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <LoopProgressBar status={item.status} current={item.currentRound} total={item.maxRounds} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {optimizationProgressTimingLabel(t, item)}
                    </span>
                  </div>
                </TableCell>
                <TableCell column="bestGoal">
                  <GoalList goals={item.goals} scope={item.goalScope.kind} classes={item.goalScope.classes} />
                </TableCell>
                <TableCell column="createdAt" className="font-mono text-[11.5px] text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </TableCell>
                <TableCell column="updatedAt" className="font-mono text-[11.5px] text-muted-foreground">
                  {formatDateTime(item.updatedAt)}
                </TableCell>
                <TableCell column="actions" className="text-right">
                  <OptimizationRowActions item={item} handlers={rowHandlers} />
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

const OPTIMIZATIONS_COLUMNS: TableColumn[] = [
  { key: 'select', width: 'narrow', sticky: 'left' },
  { key: 'name', width: 'wide', sticky: 'left' },
  { key: 'origin', width: 'normal' },
  { key: 'status', width: 'compact' },
  { key: 'loop', width: 'flex', minPx: 220 },
  { key: 'bestGoal', width: 'flex', minPx: 280 },
  { key: 'createdAt', width: 'normal' },
  { key: 'updatedAt', width: 'normal' },
  { key: 'actions', width: 'normal', sticky: 'right' },
];

function KanbanCard({ item }: { item: OptimizationSummary }) {
  const { t } = useI18n();
  const tone = OPTIMIZATION_STATUS_TONE[item.status];

  return (
    <Link
      href={`/optimizations/${item.id}`}
      className={cn(
        'block space-y-2 rounded-md border bg-background p-2.5 transition-colors hover:bg-accent',
        item.status === 'running' && 'border-l-2 border-l-primary',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px] font-semibold">{item.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {item.bestMetricLabel} · {item.originRef}
          </div>
        </div>
        {typeof item.bestMetricValue === 'number' && (
          <span
            className={cn(
              'font-mono text-[12px] font-semibold',
              item.status === 'failed'
                ? optimizationTone.danger.text
                : item.status === 'stopped'
                  ? optimizationTone.warning.text
                  : item.status === 'running'
                    ? optimizationTone.info.text
                    : optimizationTone.positive.text,
            )}
          >
            {item.bestMetricValue.toFixed(3)}
          </span>
        )}
      </div>
      <LoopProgressBar status={item.status} current={item.currentRound} total={item.maxRounds} size="sm" />
      <div className="text-[11px] text-muted-foreground">
        <span className="truncate">{optimizationProgressTimingLabel(t, item)}</span>
      </div>
      {item.status === 'running' && (
        <span className={cn('inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wide', tone.laneHeader)}>
          <span className={cn('size-1.5 rounded-full', tone.dot, tone.pulse && 'animate-pulse')} />
          {t('optimizations.kanban.live')}
        </span>
      )}
      {item.status === 'stopped' && (
        <span className={cn('inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wide', tone.laneHeader)}>
          ▶ {t('optimizations.kanban.recoverable')}
        </span>
      )}
    </Link>
  );
}

function OptimizationsKanban({ items }: { items: OptimizationSummary[] }) {
  const { t } = useI18n();
  const columns: Array<{
    key: 'running' | 'success' | 'failed' | 'other';
    titleKey: TranslationKey;
    tone: OptimizationStatus;
    items: OptimizationSummary[];
  }> = [
    {
      key: 'running',
      titleKey: 'optimizations.status.running',
      tone: 'running',
      items: items.filter((item) => item.status === 'running'),
    },
    {
      key: 'success',
      titleKey: 'optimizations.status.success',
      tone: 'success',
      items: items.filter((item) => item.status === 'success'),
    },
    {
      key: 'failed',
      titleKey: 'optimizations.status.failed',
      tone: 'failed',
      items: items.filter((item) => item.status === 'failed'),
    },
    {
      key: 'other',
      titleKey: 'optimizations.status.other',
      tone: 'cancelled',
      items: items.filter((item) => item.status === 'stopped' || item.status === 'cancelled'),
    },
  ];

  return (
    <KanbanScrollArea data-testid="optimizations-kanban-view">
      <div className="grid min-w-[1120px] grid-cols-4 gap-3">
        {columns.map((column) => {
          const tone = OPTIMIZATION_STATUS_TONE[column.tone];

          return (
            <section key={column.key} className="flex min-h-[320px] flex-col rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn('size-1.5 rounded-full', tone.dot, tone.pulse && 'animate-pulse')} />
                  <span className={cn('text-[13px] font-semibold', tone.laneHeader)}>{t(column.titleKey)}</span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{column.items.length}</span>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {column.items.length === 0 ? (
                  <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                    {t('optimizations.kanban.empty')}
                  </div>
                ) : (
                  column.items.map((item) => <KanbanCard key={item.id} item={item} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </KanbanScrollArea>
  );
}

export function OptimizationsListPage({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewMode = resolveViewMode(searchParams.get('view'));
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortMode, setSortMode] = useState<'bestMetric' | 'updated' | 'round'>('updated');
  const [liveExpanded, setLiveExpanded] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OptimizationDeleteTarget | null>(null);

  const deferredSearch = useDeferredValue(searchInput.trim());

  const optimizationsQuery = useOptimizations(projectId, {
    status: activeFilter === 'all' ? undefined : activeFilter,
    search: deferredSearch || undefined,
    sort: sortMode,
  });
  const { refetch: refetchOptimizations } = optimizationsQuery;

  const optimizationsLoading = useDelayedLoading(optimizationsQuery.isLoading);
  const controlMutation = useControlOptimization(projectId);
  const deleteMutation = useDeleteOptimization(projectId);
  const mutationPending = controlMutation.isPending || deleteMutation.isPending;

  const items = useMemo<OptimizationSummary[]>(
    () => (optimizationsQuery.data?.data ?? []).map(mapDtoToSummary),
    [optimizationsQuery.data],
  );

  const liveItems = useMemo(() => items.filter((item) => item.status === 'running'), [items]);

  const onAutoRefreshTick = useCallback(async () => {
    await refetchOptimizations();
  }, [refetchOptimizations]);

  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: liveItems.length > 0,
    onTick: onAutoRefreshTick,
  });

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const paged = items.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);

  const headState: 'off' | 'some' | 'all' = useMemo(() => {
    if (selectedIds.length === 0) return 'off';
    if (paged.length === 0) return 'off';
    if (paged.every((item) => selectedIds.includes(item.id))) return 'all';
    return 'some';
  }, [paged, selectedIds]);

  const selectedItems = items.filter((item) => selectedIds.includes(item.id));

  const handleControl = async (item: OptimizationSummary, action: 'stop' | 'resume' | 'cancel') => {
    setActionError(null);
    try {
      await controlMutation.mutateAsync({ optimizationId: item.id, action });
    } catch (error) {
      setActionError(getApiErrorMessage(error) ?? t('optimizations.list.actionFailed'));
    }
  };

  const openDeleteDialog = (targets: OptimizationSummary[]) => {
    if (targets.length === 0) return;
    setDeleteTarget({
      ids: targets.map((item) => item.id),
      names: targets.map((item) => item.name),
    });
  };

  const runBulkControl = async (action: 'stop' | 'resume') => {
    const targets = selectedItems.filter((item) =>
      action === 'stop' ? item.status === 'running' : item.status === 'stopped',
    );
    if (targets.length === 0) return;
    setActionError(null);
    const results = await Promise.allSettled(
      targets.map((item) => controlMutation.mutateAsync({ optimizationId: item.id, action })),
    );
    const failed = targets.filter((_, index) => results[index]?.status === 'rejected');
    if (failed.length > 0) {
      setActionError(
        formatTemplate(t('optimizations.bulk.errorTemplate'), {
          names: failed.map((item) => item.name).join('、'),
        }),
      );
    }
    setSelectedIds((current) => current.filter((id) => failed.some((item) => item.id === id)));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setActionError(null);
    const targets = deleteTarget.ids;
    const results = await Promise.allSettled(targets.map((id) => deleteMutation.mutateAsync(id)));
    const failedIds = targets.filter((_, index) => results[index]?.status === 'rejected');
    const failed = items.filter((item) => failedIds.includes(item.id));
    if (failed.length > 0) {
      setActionError(
        formatTemplate(t('optimizations.bulk.errorTemplate'), {
          names: failed.map((item) => item.name).join('、'),
        }),
      );
    }
    setSelectedIds((current) => current.filter((id) => failedIds.includes(id)));
    setDeleteTarget(null);
  };

  const rowHandlers: RowActionHandlers = {
    onControl: (item, action) => {
      void handleControl(item, action);
    },
    onDelete: (item) => {
      openDeleteDialog([item]);
    },
    disabled: mutationPending,
  };

  const bulkStopDisabled = mutationPending || !selectedItems.some((item) => item.status === 'running');
  const bulkResumeDisabled = mutationPending || !selectedItems.some((item) => item.status === 'stopped');
  const bulkDeleteDisabled = mutationPending || selectedItems.length === 0;

  const bulkBreakdown = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const groups: Partial<Record<OptimizationStatus, number>> = {};
    selectedItems.forEach((item) => {
      groups[item.status] = (groups[item.status] ?? 0) + 1;
    });
    return (Object.entries(groups) as Array<[OptimizationStatus, number]>)
      .map(([status, count]) => `${count} ${t(`optimizations.status.${status}` as TranslationKey)}`)
      .join(' · ');
  }, [selectedItems, t]);

  const toggleSelected = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );

  const toggleAll = () => {
    if (headState === 'all') {
      setSelectedIds((current) => current.filter((id) => !paged.some((item) => item.id === id)));
    } else {
      const ids = new Set(selectedIds);
      paged.forEach((item) => ids.add(item.id));
      setSelectedIds([...ids]);
    }
  };

  const updateViewMode = (nextViewMode: ViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextViewMode === 'kanban') params.set('view', 'kanban');
    else params.delete('view');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="optimizations-page">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('optimizations.title')}</h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{t('optimizations.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="h-9">
              <Link href={`/optimizations/new`}>
                <Plus className="size-4" />
                {t('optimizations.create')}
              </Link>
            </Button>
          </div>
        </div>

        {(actionError || optimizationsQuery.isError) && (
          <div
            role="alert"
            className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
            data-testid="optimizations-error-banner"
          >
            {actionError ?? t('optimizations.list.loadFailed')}
          </div>
        )}

        {liveItems.length > 0 && (
          <section className="mb-5 rounded-lg border bg-card" data-testid="optimizations-live-board">
            <button
              type="button"
              onClick={() => setLiveExpanded((prev) => !prev)}
              aria-expanded={liveExpanded}
              aria-controls="optimizations-live-content"
              aria-label={t(liveExpanded ? 'optimizations.live.collapse' : 'optimizations.live.expand')}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/30',
                liveExpanded && 'rounded-b-none border-b',
              )}
            >
              <h2 className="inline-flex items-center gap-2 text-[13px] font-semibold">
                <span
                  className={cn('size-1.5 animate-pulse rounded-full', OPTIMIZATION_STATUS_TONE.running.dot)}
                  aria-hidden="true"
                />
                {t('optimizations.live.title')}
                <span className="font-mono text-[11.5px] font-normal text-muted-foreground">{liveItems.length}</span>
              </h2>
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform duration-200',
                  liveExpanded ? 'rotate-0' : '-rotate-90',
                )}
                aria-hidden="true"
              />
            </button>
            {liveExpanded && (
              <div id="optimizations-live-content" className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {liveItems.map((item) => (
                  <LiveCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        )}

        <section className="rounded-lg border bg-card" aria-label={t('optimizations.listSurface')}>
          <ListToolbar
            lead={
              <>
                <ToolbarSearch
                  value={searchInput}
                  onChange={(value) => {
                    setSearchInput(value);
                    setPageIndex(0);
                  }}
                  placeholder={t('optimizations.searchPlaceholder')}
                />
                <FilterChip
                  active={activeFilter === 'all'}
                  count={optimizationsQuery.data?.total ?? items.length}
                  label={t('optimizations.filter.all')}
                  onClick={() => {
                    setActiveFilter('all');
                    setPageIndex(0);
                  }}
                />
                {STATUS_FILTERS.map((filter) => (
                  <FilterChip
                    key={filter.key}
                    active={activeFilter === filter.key}
                    dotClassName={OPTIMIZATION_STATUS_TONE[filter.key].dot}
                    pulse={OPTIMIZATION_STATUS_TONE[filter.key].pulse}
                    count={getStatusCount(items, filter.key)}
                    label={t(filter.labelKey)}
                    onClick={() => {
                      setActiveFilter(filter.key);
                      setPageIndex(0);
                    }}
                  />
                ))}
              </>
            }
            trail={
              <>
                <ToolbarSortMenu
                  value={sortMode}
                  label={t('common.toolbar.sort')}
                  options={(Object.keys(SORT_LABEL_KEYS) as Array<keyof typeof SORT_LABEL_KEYS>).map((mode) => ({
                    value: mode,
                    label: t(SORT_LABEL_KEYS[mode]),
                  }))}
                  onChange={(mode) => {
                    setSortMode(mode);
                    setPageIndex(0);
                  }}
                />
                <SlidingViewToggle
                  value={viewMode}
                  ariaLabel={t('optimizations.viewMode')}
                  onChange={updateViewMode}
                  options={[
                    { value: 'table', label: t('optimizations.viewTable'), icon: List },
                    { value: 'kanban', label: t('optimizations.viewKanban'), icon: Columns3 },
                  ]}
                />
              </>
            }
          />

          {selectedIds.length > 0 && (
            <ToolbarSelectionBar>
              <span className="text-xs text-muted-foreground">
                {t('optimizations.selected')} <b className="font-mono text-foreground">{selectedIds.length}</b>
                {bulkBreakdown && <span className="ml-1.5 text-muted-foreground">· {bulkBreakdown}</span>}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                disabled={bulkResumeDisabled}
                onClick={() => void runBulkControl('resume')}
              >
                <Play className="size-3.5" /> {t('optimizations.bulk.resume')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                disabled={bulkStopDisabled}
                onClick={() => void runBulkControl('stop')}
              >
                <Square className="size-3.5" /> {t('optimizations.bulk.stop')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 border-destructive/40 text-destructive hover:text-destructive"
                disabled={bulkDeleteDisabled}
                onClick={() => openDeleteDialog(selectedItems)}
              >
                <Trash2 className="size-3.5" /> {t('optimizations.bulk.delete')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto size-8"
                onClick={() => setSelectedIds([])}
                aria-label={t('optimizations.clearSelection')}
              >
                <X className="size-3.5" />
              </Button>
            </ToolbarSelectionBar>
          )}

          {optimizationsLoading ? (
            <ListRowsSkeleton rows={6} />
          ) : viewMode === 'table' ? (
            <OptimizationsTable
              items={paged}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onToggleAll={toggleAll}
              headState={headState}
              rowHandlers={rowHandlers}
            />
          ) : (
            <OptimizationsKanban items={items} />
          )}

          <ResourcePaginationFooter
            summary={
              <>
                {t('optimizations.totalPrefix')}{' '}
                <span className="font-mono font-medium text-foreground">{items.length}</span>{' '}
                {t('optimizations.totalSuffix')} · {t('optimizations.selected')}{' '}
                <span className="font-mono font-medium text-foreground">{selectedIds.length}</span>
              </>
            }
            pageIndex={safePageIndex}
            pageCount={pageCount}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            previousPageLabel={t('common.previousPage')}
            nextPageLabel={t('common.nextPage')}
            onPageChange={setPageIndex}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPageIndex(0);
            }}
          />
        </section>
        <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent data-testid="optimizations-delete-dialog">
            <DialogHeader>
              <DialogTitle>
                {deleteTarget && deleteTarget.ids.length > 1
                  ? formatTemplate(t('optimizations.delete.bulkTitle'), { count: deleteTarget.ids.length })
                  : t('optimizations.delete.title')}
              </DialogTitle>
              <DialogDescription>
                {deleteTarget && deleteTarget.ids.length > 1
                  ? t('optimizations.delete.bulkDescription')
                  : t('optimizations.delete.description')}
              </DialogDescription>
            </DialogHeader>
            {deleteTarget && (
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('optimizations.delete.targetLabel')}
                </div>
                <div className="mt-1.5 space-y-1 text-[12.5px]">
                  {deleteTarget.names.slice(0, 5).map((name) => (
                    <div key={name} className="truncate font-mono text-foreground">
                      {name}
                    </div>
                  ))}
                  {deleteTarget.names.length > 5 && (
                    <div className="text-muted-foreground">
                      {formatTemplate(t('optimizations.delete.more'), { count: deleteTarget.names.length - 5 })}
                    </div>
                  )}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={mutationPending}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmDelete()}
                disabled={mutationPending || !deleteTarget}
                data-testid="optimizations-delete-confirm"
              >
                {mutationPending ? t('optimizations.delete.pending') : t('optimizations.delete.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Main>
  );
}
