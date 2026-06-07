'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ListChecks, Plus, Search } from 'lucide-react';
import { AnnotationClaimDialog } from '../../components';
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
import { useAnnotationTaskList, useClaimAnnotationSamples, useDateTimeFormatter } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import {
  buildAnnotationTasks,
  filterAnnotationTasks,
  summarizeAnnotationTasks,
  type AnnotationTaskFilter,
  type AnnotationTaskView,
} from './annotation-task-model';
import {
  AnnotationMetricCard,
  AnnotationProgressBlock,
  AnnotationScopeBadge,
  AnnotationTaskStatusBadge,
  formatCount,
  formatDateTimeOrDash,
  formatPercent,
} from './annotation-ui';

const FILTERS: Array<{ value: AnnotationTaskFilter; key: TranslationKey }> = [
  { value: 'all', key: 'annotations.filter.all' },
  { value: 'open', key: 'annotations.filter.open' },
  { value: 'claimed', key: 'annotations.filter.claimed' },
  { value: 'submitted', key: 'annotations.filter.submitted' },
  { value: 'completed', key: 'annotations.filter.completed' },
];

const TASK_COLUMNS: TableColumn[] = [
  { key: 'task', width: 'flex', minPx: 260 },
  { key: 'source', width: 'normal' },
  { key: 'model', width: 'normal' },
  { key: 'progress', width: 'wide' },
  { key: 'updatedAt', width: 'compact' },
  { key: 'actions', width: 'compact', sticky: 'right' },
];

export function AnnotationsListPage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const tasksQuery = useAnnotationTaskList(projectId);
  const tasksLoading = useDelayedLoading(tasksQuery.isLoading);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AnnotationTaskFilter>('all');
  const [claimTarget, setClaimTarget] = useState<AnnotationTaskView | null>(null);
  const claimMutation = useClaimAnnotationSamples(projectId, claimTarget?.id ?? '');

  const tasks = useMemo(() => buildAnnotationTasks(tasksQuery.data?.data ?? []), [tasksQuery.data]);
  const summary = useMemo(() => summarizeAnnotationTasks(tasks), [tasks]);
  const filtered = useMemo(() => filterAnnotationTasks(tasks, filter, search), [filter, search, tasks]);
  const counts: Record<AnnotationTaskFilter, number> = {
    all: tasks.length,
    open: tasks.filter((task) => task.open > 0).length,
    claimed: tasks.filter((task) => task.claimed > 0).length,
    submitted: tasks.filter((task) => task.submitted > 0).length,
    completed: tasks.filter((task) => task.status === 'completed').length,
  };

  const openClaimDialog = (task: AnnotationTaskView) => {
    setClaimTarget(task);
  };

  const closeClaimDialog = () => {
    if (!claimMutation.isPending) setClaimTarget(null);
  };

  const handleClaim = async (batchSize: number) => {
    if (!claimTarget) return;
    claimMutation.mutate(
      { batchSize },
      {
        onSuccess: () => {
          router.push(`/annotations/${encodeURIComponent(claimTarget.id)}?status=claimed`);
        },
      },
    );
  };

  return (
    <Main fixed className="gap-5 overflow-auto bg-muted/35">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-5" data-testid="annotations-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-tight">{t('annotations.title')}</h1>
            <p className="mt-1 max-w-4xl text-[12.5px] text-muted-foreground">{t('annotations.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild>
              <Link href="/annotations/new">
                <Plus className="size-4" />
                {t('annotations.action.new')}
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <AnnotationMetricCard
            label={t('annotations.metric.totalTasks')}
            value={formatCount(summary.totalTasks)}
            detail={t('annotations.metric.totalTasksHint')}
          />
          <AnnotationMetricCard
            tone="active"
            label={t('annotations.metric.activeTasks')}
            value={formatCount(summary.activeTasks)}
            detail={t('annotations.metric.activeTasksHint')}
          />
          <AnnotationMetricCard
            tone="active"
            label={t('annotations.metric.openSamples')}
            value={formatCount(summary.openSamples)}
            detail={t('annotations.metric.openSamplesHint')}
          />
          <AnnotationMetricCard
            label={t('annotations.metric.claimedSamples')}
            value={formatCount(summary.claimedSamples)}
            detail={t('annotations.metric.claimedSamplesHint')}
          />
          <AnnotationMetricCard
            tone="success"
            label={t('annotations.metric.completionRate')}
            value={formatPercent(summary.completionRate)}
            detail={t('annotations.metric.completionRateHint').replace(
              '{count}',
              formatCount(summary.submittedSamples),
            )}
          />
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1 sm:max-w-[420px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('annotations.search')}
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
          {tasksQuery.isError ? (
            <div className="mt-2 text-[12px] text-destructive">{t('annotations.loadFailed')}</div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <Table columns={TASK_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead column="task">{t('annotations.table.task')}</TableHead>
                <TableHead column="source">{t('annotations.table.source')}</TableHead>
                <TableHead column="model">{t('annotations.table.model')}</TableHead>
                <TableHead column="progress">{t('annotations.table.progress')}</TableHead>
                <TableHead column="updatedAt">{t('annotations.table.updatedAt')}</TableHead>
                <TableHead column="actions" className="text-right">
                  {t('common.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasksLoading ? (
                <TableSkeletonRows />
              ) : filtered.length === 0 ? (
                <TableEmpty>{t('annotations.empty')}</TableEmpty>
              ) : (
                filtered.map((task) => (
                  <TableRow key={task.id} onClick={() => router.push(`/annotations/${encodeURIComponent(task.id)}`)}>
                    <TableCell column="task">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-semibold">{task.name}</span>
                          <AnnotationTaskStatusBadge status={task.status} />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <AnnotationScopeBadge scope={task.scope} />
                          <span className="font-mono text-[11px] text-muted-foreground">{task.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell column="source">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12.5px]">{task.sourceName}</div>
                        <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
                          {task.releaseVariantLabel} · {task.promptVersionLabel ?? '-'}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell column="model">
                      <span className="font-mono text-[12px] text-muted-foreground">{task.modelName ?? '-'}</span>
                    </TableCell>
                    <TableCell column="progress">
                      <AnnotationProgressBlock task={task} />
                    </TableCell>
                    <TableCell column="updatedAt">
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {formatDateTimeOrDash(task.updatedAt, formatDateTime)}
                      </span>
                    </TableCell>
                    <TableCell column="actions" className="text-right">
                      <div className="inline-flex items-center justify-end gap-0.5">
                        <TableActionIconButton
                          label={t('annotations.action.claim')}
                          disabled={task.open < 1}
                          onClick={(event) => {
                            event.stopPropagation();
                            openClaimDialog(task);
                          }}
                        >
                          <ListChecks className="size-3.5" />
                        </TableActionIconButton>
                        <TableActionIconButton
                          label={t('annotations.action.open')}
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push(`/annotations/${encodeURIComponent(task.id)}`);
                          }}
                        >
                          <ArrowRight className="size-3.5" />
                        </TableActionIconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {claimTarget ? (
        <AnnotationClaimDialog
          open={Boolean(claimTarget)}
          onOpenChange={(open) => {
            if (!open) closeClaimDialog();
          }}
          inputId="annotation-list-claim-size"
          maxClaimable={claimTarget.open}
          isPending={claimMutation.isPending}
          onSubmit={handleClaim}
          onCancel={closeClaimDialog}
        />
      ) : null}
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
        'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[12.5px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 font-mono text-[10.5px]',
          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {formatCount(count)}
      </span>
    </button>
  );
}
