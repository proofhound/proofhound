'use client';

import type { PromptDeletionImpactDto, PromptDeletionImpactItemDto } from '@proofhound/shared';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '../../hooks/use-router';
import { useMemo, useState, type FormEvent } from 'react';
import { Archive, FlaskConical, History, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FilterChip,
  Input,
  ListRowsSkeleton,
  ListToolbar,
  PlatformLoaderOverlay,
  Skeleton,
  ResourcePaginationFooter,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableActionIconButton,
  ToolbarSearch,
  ToolbarSelectionBar,
  cn,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import {
  useArchivePrompt,
  useCreatePrompt,
  useDeletePrompt,
  usePromptDeleteImpact,
  usePrompts,
  useRestorePrompt,
} from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage, isProjectNameTaken } from '../../lib';
import {
  getPromptSearchText,
  toProjectPromptListItem,
  type ProjectPrompt,
  type PromptVersionStatus,
} from './prompt-model';
import { SelectionBox } from './prompt-ui';

type PromptFilter = 'all' | PromptVersionStatus;

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const FILTERS: Array<{ key: PromptFilter; labelKey: TranslationKey }> = [
  { key: 'all', labelKey: 'prompts.filter.all' },
  { key: 'editable', labelKey: 'prompts.status.editable' },
  { key: 'frozen', labelKey: 'prompts.status.frozen' },
];

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-mono font-medium text-foreground">{value}</span> {label}
    </span>
  );
}

function getFilterCount(prompts: ProjectPrompt[], filter: PromptFilter) {
  if (filter === 'all') return prompts.length;
  return prompts.filter((prompt) => prompt.status === filter).length;
}

function getPromptExperimentNewHref(prompt: ProjectPrompt) {
  const query = new URLSearchParams({ promptId: prompt.id });
  return `/experiments/new?${query.toString()}`;
}

function getPromptOptimizationNewHref(prompt: ProjectPrompt) {
  const query = new URLSearchParams({ origin: 'prompt', promptId: prompt.id });
  return `/optimizations/new?${query.toString()}`;
}


function ArchivedBadge() {
  const { t } = useI18n();

  return (
    <span className="status-archived inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium">
      <span className="dot-archived size-1.5 rounded-full" />
      {t('prompts.status.archived')}
    </span>
  );
}

function PromptActions({
  prompt,
  pending,
  onArchive,
  onDelete,
  onRestore,
}: {
  prompt: ProjectPrompt;
  pending?: boolean;
  onArchive: (prompt: ProjectPrompt) => void;
  onDelete: (prompt: ProjectPrompt) => void;
  onRestore: (prompt: ProjectPrompt) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const openVersionsLabel = t('prompts.action.openVersions');
  const archived = prompt.resourceStatus === 'archived';
  const primaryDisabled = archived || pending;

  return (
    <div className="inline-flex items-center justify-end gap-1">
      <TableActionIconButton
        label={t('prompts.action.startExperiment')}
        data-testid={`prompt-action-start-experiment-${prompt.id}`}
        disabled={primaryDisabled}
        onClick={(event) => {
          event.stopPropagation();
          router.push(getPromptExperimentNewHref(prompt));
        }}
      >
        <FlaskConical className="size-3.5" />
      </TableActionIconButton>
      <TableActionIconButton
        label={t('prompts.action.startOptimization')}
        data-testid={`prompt-action-start-optimization-${prompt.id}`}
        disabled={primaryDisabled}
        onClick={(event) => {
          event.stopPropagation();
          router.push(getPromptOptimizationNewHref(prompt));
        }}
      >
        <Sparkles className="size-3.5" />
      </TableActionIconButton>
      <TableActionIconButton
        label={`${openVersionsLabel} ${prompt.name}`}
        tooltipLabel={openVersionsLabel}
        data-testid={`prompt-action-open-${prompt.id}`}
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          router.push(`/prompts/${prompt.id}`);
        }}
      >
        <History className="size-3.5" />
      </TableActionIconButton>
      <TableActionIconButton
        label={archived ? t('prompts.action.restore') : t('prompts.action.archive')}
        data-testid={archived ? `prompt-action-restore-${prompt.id}` : `prompt-action-archive-${prompt.id}`}
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          if (archived) onRestore(prompt);
          else onArchive(prompt);
        }}
      >
        {archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
      </TableActionIconButton>
      <TableActionIconButton
        label={t('prompts.action.delete')}
        className="size-7 text-destructive hover:text-destructive"
        data-testid={`prompt-action-delete-${prompt.id}`}
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(prompt);
        }}
      >
        <Trash2 className="size-3.5" />
      </TableActionIconButton>
    </div>
  );
}

function VersionCell({ version }: { version?: number }) {
  return version ? (
    <span className="font-mono text-[12.5px]">v{version}</span>
  ) : (
    <span className="font-mono text-[12.5px] text-muted-foreground">-</span>
  );
}

function CustomLabelsCell({ labels }: { labels: ProjectPrompt['customLabels'] }) {
  if (labels.length === 0) {
    return <span className="font-mono text-[12.5px] text-muted-foreground">-</span>;
  }

  return (
    <div className="flex max-w-[260px] flex-wrap items-center gap-1">
      {labels.slice(0, 3).map((label) => (
        <span
          key={label.name}
          className="inline-flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
        >
          {label.name}
          <span className="text-[9.5px] opacity-75">v{label.versionNumber}</span>
        </span>
      ))}
      {labels.length > 3 && <span className="font-mono text-[10px] text-muted-foreground">+{labels.length - 3}</span>}
    </div>
  );
}

const IMPACT_LABEL_KEYS: Record<PromptDeletionImpactItemDto['kind'], TranslationKey> = {
  release_line: 'prompts.deleteImpactReleaseLine',
  experiment: 'prompts.deleteImpactExperiment',
  optimization: 'prompts.deleteImpactOptimization',
};

function ImpactRows({ items }: { items: PromptDeletionImpactItemDto[] }) {
  const { t } = useI18n();

  return (
    <div className="max-h-[260px] space-y-1 overflow-auto">
      {items.map((item) => (
        <div
          key={`${item.kind}-${item.id}`}
          className="flex items-center justify-between gap-3 rounded border px-2.5 py-2 text-xs"
        >
          <div className="min-w-0">
            <div className="truncate font-medium">
              {t(IMPACT_LABEL_KEYS[item.kind])} · {item.name ?? item.id}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {item.kind === 'release_line'
                ? (item.status ?? '-')
                : `${item.promptVersionNumber ? `v${item.promptVersionNumber}` : '-'} · ${item.status ?? '-'}`}
            </div>
          </div>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{item.id.slice(0, 8)}</span>
        </div>
      ))}
    </div>
  );
}

function DeleteImpactPanel({ impact, loading }: { impact: PromptDeletionImpactDto | undefined; loading: boolean }) {
  const { t } = useI18n();
  const items = impact ? [...impact.releaseLines, ...impact.experiments, ...impact.optimizations] : [];

  if (loading) {
    return (
      <div className="rounded-md border bg-muted/35 p-3 text-sm text-muted-foreground">
        {t('prompts.deleteImpactLoading')}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border bg-muted/35 p-3 text-sm text-muted-foreground">
        {t('prompts.deleteImpactEmpty')}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="prompts-delete-impact">
      <div className="text-sm font-medium">
        {t('prompts.deleteImpactTitle')} <span className="font-mono">{items.length}</span>
      </div>
      <ImpactRows items={items} />
    </div>
  );
}

function PromptsTable({
  prompts,
  selectedIds,
  mutatingPromptId,
  onArchive,
  onDelete,
  onRestore,
  onToggleSelected,
}: {
  prompts: ProjectPrompt[];
  selectedIds: string[];
  mutatingPromptId: string | null;
  onArchive: (prompt: ProjectPrompt) => void;
  onDelete: (prompt: ProjectPrompt) => void;
  onRestore: (prompt: ProjectPrompt) => void;
  onToggleSelected: (promptId: string) => void;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();

  return (
    <Table columns={PROMPTS_COLUMNS} containerTestId="prompts-table-view">
      <TableHeader>
        <TableRow>
          <TableHead column="select">
            <span className="sr-only">{t('prompts.select')}</span>
          </TableHead>
          <TableHead column="name">{t('prompts.table.name')}</TableHead>
          <TableHead column="latestVersion">{t('prompts.table.latestVersion')}</TableHead>
          <TableHead column="canaryVersion">{t('prompts.table.canaryVersion')}</TableHead>
          <TableHead column="onlineVersion">{t('prompts.table.onlineVersion')}</TableHead>
          <TableHead column="labels">{t('prompts.table.labels')}</TableHead>
          <TableHead column="createdAt">{t('prompts.table.createdAt')}</TableHead>
          <TableHead column="updatedAt">{t('prompts.table.updatedAt')}</TableHead>
          <TableHead column="actions" className="text-right">
            {t('common.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {prompts.map((prompt) => {
          const selected = selectedIds.includes(prompt.id);
          const archived = prompt.resourceStatus === 'archived';
          return (
            <TableRow
              key={prompt.id}
              selected={selected}
              onClick={() => router.push(`/prompts/${prompt.id}`)}
              className={cn(archived && 'opacity-70')}
            >
              <TableCell column="select">
                <SelectionBox
                  checked={selected}
                  disabled={archived}
                  ariaLabel={`${t('prompts.select')} ${prompt.name}`}
                  onClick={() => onToggleSelected(prompt.id)}
                />
              </TableCell>
              <TableCell column="name">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('truncate text-[13.5px] font-semibold', archived && 'text-muted-foreground')}>
                    {prompt.name}
                  </span>
                  {archived && <ArchivedBadge />}
                  {!archived && prompt.tags.includes('new') && (
                    <span className="rounded bg-[var(--status-canary-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--status-canary-fg)]">
                      {t('prompts.badge.new')}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell column="latestVersion">
                <VersionCell version={prompt.latestVersion} />
              </TableCell>
              <TableCell column="canaryVersion">
                <VersionCell version={prompt.canaryVersion} />
              </TableCell>
              <TableCell column="onlineVersion">
                <VersionCell version={prompt.onlineVersion} />
              </TableCell>
              <TableCell column="labels">
                <CustomLabelsCell labels={prompt.customLabels} />
              </TableCell>
              <TableCell column="createdAt">
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  {formatDateTime(prompt.createdAt)}
                </span>
              </TableCell>
              <TableCell column="updatedAt">
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  {formatDateTime(prompt.updatedAt)}
                </span>
              </TableCell>
              <TableCell column="actions" className="text-right">
                <PromptActions
                  prompt={prompt}
                  pending={mutatingPromptId === prompt.id}
                  onArchive={onArchive}
                  onDelete={onDelete}
                  onRestore={onRestore}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const PROMPTS_COLUMNS: TableColumn[] = [
  { key: 'select', width: 'narrow', sticky: 'left' },
  { key: 'name', width: 'wide', sticky: 'left' },
  { key: 'latestVersion', width: 'compact' },
  { key: 'canaryVersion', width: 'compact' },
  { key: 'onlineVersion', width: 'compact' },
  { key: 'labels', width: 'wide' },
  { key: 'createdAt', width: 'normal' },
  { key: 'updatedAt', width: 'normal' },
  { key: 'actions', width: 'normal', sticky: 'right' },
];

export function PromptsListPage({
  projectId,
  initialCreateDialogOpen = false,
}: {
  projectId: string;
  initialCreateDialogOpen?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const promptsQuery = usePrompts(projectId);
  const promptsLoading = useDelayedLoading(promptsQuery.isLoading);
  const archivePromptMutation = useArchivePrompt(projectId);
  const createPromptMutation = useCreatePrompt(projectId);
  const deletePromptMutation = useDeletePrompt(projectId);
  const restorePromptMutation = useRestorePrompt(projectId);
  const prompts = useMemo(
    () => (promptsQuery.data?.data ?? []).map((prompt) => toProjectPromptListItem(prompt)),
    [promptsQuery.data?.data],
  );
  const [activeFilter, setActiveFilter] = useState<PromptFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [deleteTarget, setDeleteTarget] = useState<ProjectPrompt | null>(null);
  const deleteImpactQuery = usePromptDeleteImpact(projectId, deleteTarget?.id ?? '');
  const createDialogRequested = initialCreateDialogOpen || searchParams.get('create') === '1';
  const [createDialogManuallyOpen, setCreateDialogManuallyOpen] = useState(false);
  const createDialogOpen = createDialogRequested || createDialogManuallyOpen;
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const filteredPrompts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return prompts
      .filter((prompt) => activeFilter === 'all' || prompt.status === activeFilter)
      .filter((prompt) => !query || getPromptSearchText(prompt).includes(query));
  }, [activeFilter, prompts, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredPrompts.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedPrompts = filteredPrompts.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);
  const editableCount = prompts.filter((prompt) => prompt.status === 'editable').length;
  const onlineCount = prompts.filter((prompt) => prompt.onlineVersion).length;
  const frozenCount = prompts.filter((prompt) => prompt.status === 'frozen').length;
  const createNameTaken = useMemo(() => isProjectNameTaken(createName, prompts), [createName, prompts]);
  const createNameMessage = createNameTaken ? t('common.formError.nameTaken') : createError;

  const toggleSelected = (promptId: string) => {
    setSelectedIds((current) =>
      current.includes(promptId) ? current.filter((item) => item !== promptId) : [...current, promptId],
    );
  };

  const deletePrompt = async (prompt: ProjectPrompt) => {
    setDeleteTarget(prompt);
  };

  const archivePrompt = (prompt: ProjectPrompt) => {
    void archivePromptMutation.mutateAsync({ promptId: prompt.id });
  };

  const restorePrompt = (prompt: ProjectPrompt) => {
    void restorePromptMutation.mutateAsync({ promptId: prompt.id });
  };

  const confirmDeletePrompt = async () => {
    if (!deleteTarget) return;
    await deletePromptMutation.mutateAsync(deleteTarget.id);
    setSelectedIds((current) => current.filter((item) => item !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const closeCreateDialog = (open: boolean) => {
    setCreateDialogManuallyOpen(open);
    if (!open) {
      setCreateName('');
      setCreateError(null);
      if (createDialogRequested) {
        router.replace(`/prompts`, { scroll: false });
      }
    }
  };

  const createPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name) {
      setCreateError(t('common.formError.requiredMissing'));
      return;
    }
    if (isProjectNameTaken(name, prompts)) {
      setCreateError(t('common.formError.nameTaken'));
      return;
    }

    try {
      const created = await createPromptMutation.mutateAsync({ name });
      setCreateDialogManuallyOpen(false);
      setCreateName('');
      setCreateError(null);
      router.replace(`/prompts/${created.id}`);
    } catch (error) {
      const message = getApiErrorMessage(error);
      setCreateError(
        message === 'prompt_name_taken' ? t('common.formError.nameTaken') : (message ?? t('common.loadFailedRefresh')),
      );
    }
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="prompts-page">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('prompts.title')}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              {promptsLoading ? (
                <Skeleton className="h-3.5 w-64" />
              ) : (
                <>
                  <HeaderStat label={t('prompts.header.items')} value={String(prompts.length)} />
                  <span>·</span>
                  <HeaderStat label={t('prompts.header.online')} value={String(onlineCount)} />
                  <span>·</span>
                  <HeaderStat label={t('prompts.header.editable')} value={String(editableCount)} />
                  <span>·</span>
                  <HeaderStat label={t('prompts.header.frozen')} value={String(frozenCount)} />
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="h-9" onClick={() => setCreateDialogManuallyOpen(true)}>
              <Plus className="size-4" />
              {t('prompts.create')}
            </Button>
          </div>
        </div>

        <section className="rounded-lg border bg-card" aria-label={t('prompts.listSurface')}>
          <ListToolbar
            lead={
              <>
                <ToolbarSearch
                  value={searchQuery}
                  onChange={(value) => {
                    setSearchQuery(value);
                    setPageIndex(0);
                  }}
                  placeholder={t('prompts.searchPlaceholder')}
                />
                {FILTERS.map((filter) => (
                  <FilterChip
                    key={filter.key}
                    active={activeFilter === filter.key}
                    count={getFilterCount(prompts, filter.key)}
                    label={t(filter.labelKey)}
                    onClick={() => {
                      setActiveFilter(filter.key);
                      setPageIndex(0);
                    }}
                  />
                ))}
              </>
            }
          />

          {selectedIds.length > 0 && (
            <ToolbarSelectionBar>
              <span className="text-xs text-muted-foreground">
                {t('prompts.selected')} <b className="font-mono text-foreground">{selectedIds.length}</b>
              </span>
              <Button type="button" variant="outline" size="sm" className="h-8">
                <Trash2 className="size-3.5" />
                {t('prompts.action.batchDelete')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto size-8"
                onClick={() => setSelectedIds([])}
                aria-label={t('prompts.clearSelection')}
              >
                <X className="size-3.5" />
              </Button>
            </ToolbarSelectionBar>
          )}

          {promptsLoading ? (
            <div className="relative">
              <ListRowsSkeleton rows={8} />
              <PlatformLoaderOverlay />
            </div>
          ) : (
            <>
              <PromptsTable
                prompts={pagedPrompts}
                selectedIds={selectedIds}
                mutatingPromptId={
                  archivePromptMutation.isPending
                    ? (archivePromptMutation.variables?.promptId ?? null)
                    : restorePromptMutation.isPending
                      ? (restorePromptMutation.variables?.promptId ?? null)
                      : null
                }
                onArchive={archivePrompt}
                onDelete={deletePrompt}
                onRestore={restorePrompt}
                onToggleSelected={toggleSelected}
              />

              <ResourcePaginationFooter
                summary={
                  <>
                    {t('prompts.totalPrefix')}{' '}
                    <span className="font-mono font-medium text-foreground">{filteredPrompts.length}</span>{' '}
                    {t('prompts.totalSuffix')} · {t('prompts.selected')}{' '}
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
                onPageSizeChange={(nextPageSize) => {
                  setPageSize(nextPageSize);
                  setPageIndex(0);
                }}
              />
            </>
          )}
        </section>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent data-testid="prompts-delete-dialog">
          <DialogHeader>
            <DialogTitle>{t('prompts.deleteBlockedTitle')}</DialogTitle>
            <DialogDescription>{t('prompts.deleteBlockedDescription')}</DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {deleteTarget.name} · {t('prompts.deleteBlockedReferences')}
            </div>
          )}
          <DeleteImpactPanel impact={deleteImpactQuery.data} loading={deleteImpactQuery.isLoading} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePromptMutation.isPending || deleteImpactQuery.isLoading}
              data-testid="prompts-delete-confirm"
              onClick={() => void confirmDeletePrompt()}
            >
              <Trash2 className="size-4" />
              {t('common.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={closeCreateDialog}>
        <DialogContent data-testid="prompt-create-dialog">
          <DialogHeader>
            <DialogTitle>{t('prompts.new.title')}</DialogTitle>
            <DialogDescription>{t('prompts.new.subtitle')}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={createPrompt}>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">{t('prompts.new.name')}</span>
              <Input
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value);
                  setCreateError(null);
                }}
                placeholder={t('prompts.new.namePlaceholder')}
                className="h-9"
                aria-invalid={createNameTaken || undefined}
                autoFocus
                data-testid="prompt-new-name"
              />
            </label>
            {createNameMessage && <p className="text-xs text-destructive">{createNameMessage}</p>}
            <div className="rounded-md border bg-muted/35 p-3 text-xs text-muted-foreground">
              {t('prompts.new.initialDraftHelp')}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => closeCreateDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={createPromptMutation.isPending || createNameTaken}
                data-testid="prompt-new-submit"
              >
                <Plus className="size-4" />
                {t('prompts.new.createAndOpen')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
