'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Download,
  Edit3,
  FlaskConical,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { DatasetExportFormatDto } from '@proofhound/shared';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_ACTION_ICON_BUTTON_CLASS,
  TableActionIconButton,
  TableActionTooltip,
  cn,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useDatasets, useDeleteDataset, useDownloadDataset, useUpdateDataset } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import { DatasetTransferProgressPanel, useDatasetTransferProgress } from './dataset-transfer-progress';
import { getReferenceCount, type ProjectDataset, type DatasetModality } from './dataset-types';
import { toProjectDataset } from './dataset-mappers';
import {
  CategoryDistribution,
  DeletedBadge,
  ExportFormatMenu,
  ModalityBadge,
  ReferenceText,
  SelectionBox,
  formatCount,
  saveBlobAsFile,
} from './dataset-ui';

type SortMode = 'updated' | 'samples' | 'name';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const SORT_LABEL_KEYS: Record<SortMode, TranslationKey> = {
  updated: 'datasets.sort.updated',
  samples: 'datasets.sort.samples',
  name: 'datasets.sort.name',
};

const DATASETS_COLUMNS: TableColumn[] = [
  { key: 'select', width: 'narrow', sticky: 'left' },
  { key: 'name', width: 'wide', sticky: 'left' },
  { key: 'sampleCount', width: 'compact' },
  { key: 'category', width: 'flex', minPx: 320 },
  { key: 'modality', width: 'compact' },
  { key: 'references', width: 'wide' },
  { key: 'createdAt', width: 'normal' },
  { key: 'updatedAt', width: 'normal' },
  { key: 'actions', width: 'normal', sticky: 'right' },
];

function getSearchText(dataset: ProjectDataset) {
  return [
    dataset.name,
    dataset.description,
    dataset.owner,
    dataset.uploadSource,
    dataset.modalities.join(' '),
    dataset.status,
  ]
    .join(' ')
    .toLowerCase();
}

function sortDatasets(datasets: ProjectDataset[], sortMode: SortMode) {
  return [...datasets].sort((a, b) => {
    if (sortMode === 'samples') return b.sampleCount - a.sampleCount;
    if (sortMode === 'name') return a.name.localeCompare(b.name);
    return b.updatedAtRaw.localeCompare(a.updatedAtRaw);
  });
}

function getDatasetQuery(dataset: ProjectDataset) {
  return new URLSearchParams({
    datasetId: dataset.id,
    datasetName: dataset.name,
    sampleCount: String(dataset.sampleCount),
  }).toString();
}

function getExperimentNewHref(projectId: string, dataset: ProjectDataset) {
  return `/experiments/new?${getDatasetQuery(dataset)}`;
}

function getOptimizationNewHref(projectId: string, dataset: ProjectDataset) {
  return `/optimizations/new?origin=dataset&${getDatasetQuery(dataset)}`;
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-mono font-medium text-foreground">{value}</span> {label}
    </span>
  );
}

function FilterChip({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
      <span className={cn('font-mono text-[11px]', active ? 'opacity-75' : 'text-muted-foreground')}>{count}</span>
    </button>
  );
}

function getModalityCount(datasets: ProjectDataset[], modality: DatasetModality) {
  return datasets.filter((dataset) => dataset.modalities.includes(modality) && dataset.status !== 'deleted').length;
}

function DatasetActions({
  dataset,
  downloading,
  deleting,
  onDelete,
  onDownload,
  onEdit,
  onStartOptimization,
  onStartExperiment,
}: {
  dataset: ProjectDataset;
  downloading: boolean;
  deleting?: boolean;
  onDelete: (dataset: ProjectDataset) => void;
  onDownload: (dataset: ProjectDataset) => void;
  onEdit: (dataset: ProjectDataset) => void;
  onStartOptimization: (dataset: ProjectDataset) => void;
  onStartExperiment: (dataset: ProjectDataset) => void;
}) {
  const { t } = useI18n();
  const disabled = dataset.status === 'deleted' || deleting;

  return (
    <div className="inline-flex items-center justify-end gap-1">
      <TableActionIconButton
        label={t('datasets.action.startExperiment')}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onStartExperiment(dataset);
        }}
      >
        <FlaskConical className="size-3.5" />
      </TableActionIconButton>
      <TableActionIconButton
        label={t('datasets.action.startOptimization')}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onStartOptimization(dataset);
        }}
      >
        <Sparkles className="size-3.5" />
      </TableActionIconButton>
      <TableActionIconButton
        label={`${t('datasets.download')} ${dataset.name}`}
        tooltipLabel={t('datasets.download')}
        disabled={disabled || downloading}
        onClick={(event) => {
          event.stopPropagation();
          onDownload(dataset);
        }}
      >
        {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      </TableActionIconButton>
      <DropdownMenu>
        <TableActionTooltip label={t('datasets.action.more')} disabled={disabled}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={TABLE_ACTION_ICON_BUTTON_CLASS}
              aria-label={t('datasets.action.more')}
              disabled={disabled}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TableActionTooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(dataset)}>
            <Edit3 className="size-4 text-muted-foreground" />
            {t('datasets.action.editName')}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(dataset)}>
            <Trash2 className="size-4" />
            {t('datasets.action.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DatasetTable({
  datasets,
  projectId,
  selectedIds,
  downloadingDatasetId,
  deletingDatasetId,
  onDelete,
  onDownload,
  onEdit,
  onToggleSelected,
}: {
  datasets: ProjectDataset[];
  projectId: string;
  selectedIds: string[];
  downloadingDatasetId: string | null;
  deletingDatasetId: string | null;
  onDelete: (dataset: ProjectDataset) => void;
  onDownload: (dataset: ProjectDataset) => void;
  onEdit: (dataset: ProjectDataset) => void;
  onToggleSelected: (datasetId: string) => void;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();

  return (
    <Table columns={DATASETS_COLUMNS} containerTestId="datasets-table-view">
      <TableHeader>
        <TableRow>
          <TableHead column="select">
            <span className="sr-only">{t('datasets.select')}</span>
          </TableHead>
          <TableHead column="name">{t('datasets.name')}</TableHead>
          <TableHead column="sampleCount" className="text-center">
            {t('datasets.sampleCount')}
          </TableHead>
          <TableHead column="category">{t('datasets.categoryDistribution')}</TableHead>
          <TableHead column="modality">{t('datasets.modality')}</TableHead>
          <TableHead column="references">{t('datasets.references')}</TableHead>
          <TableHead column="createdAt">{t('datasets.createdAt')}</TableHead>
          <TableHead column="updatedAt">{t('datasets.updatedAt')}</TableHead>
          <TableHead column="actions" className="text-right">
            {t('common.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {datasets.map((dataset) => {
          const selected = selectedIds.includes(dataset.id);
          const deleted = dataset.status === 'deleted';
          const description = dataset.description.trim();
          return (
            <TableRow
              key={dataset.id}
              selected={selected}
              onClick={() => router.push(`/datasets/${dataset.id}`)}
              className={cn(deleted && 'opacity-65')}
            >
              <TableCell column="select">
                <SelectionBox
                  checked={selected}
                  disabled={deleted}
                  ariaLabel={`${t('datasets.select')} ${dataset.name}`}
                  onClick={() => onToggleSelected(dataset.id)}
                />
              </TableCell>
              <TableCell column="name">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'truncate text-[13.5px] font-semibold',
                      deleted && 'line-through text-muted-foreground',
                    )}
                  >
                    {dataset.name}
                  </span>
                  {deleted && <DeletedBadge />}
                </div>
                {description && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</div>}
              </TableCell>
              <TableCell column="sampleCount" className="text-center">
                <span
                  className={cn('font-mono text-[13px] font-medium', deleted && 'line-through text-muted-foreground')}
                >
                  {formatCount(dataset.sampleCount)}
                </span>
              </TableCell>
              <TableCell column="category">
                {deleted ? (
                  <span className="text-[11.5px] text-muted-foreground">-</span>
                ) : (
                  <CategoryDistribution profile={dataset.categoryProfile} />
                )}
              </TableCell>
              <TableCell column="modality">
                {deleted ? (
                  <span className="text-[11.5px] text-muted-foreground">-</span>
                ) : (
                  <ModalityBadge modalities={dataset.modalities} />
                )}
              </TableCell>
              <TableCell column="references">
                <ReferenceText dataset={dataset} />
              </TableCell>
              <TableCell column="createdAt">
                <span className="font-mono text-[11.5px] text-muted-foreground" data-testid={`dataset-created-at-${dataset.id}`}>
                  {formatDateTime(dataset.createdAtRaw)}
                </span>
              </TableCell>
              <TableCell column="updatedAt">
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  {formatDateTime(dataset.updatedAtRaw)}
                </span>
              </TableCell>
              <TableCell column="actions" className="text-right">
                {deleted ? (
                  <span className="font-mono text-[11px] text-muted-foreground">{t('datasets.readonly')}</span>
                ) : (
                  <DatasetActions
                    dataset={dataset}
                    downloading={downloadingDatasetId === dataset.id}
                    deleting={deletingDatasetId === dataset.id}
                    onDelete={onDelete}
                    onDownload={onDownload}
                    onEdit={onEdit}
                    onStartOptimization={(item) => router.push(getOptimizationNewHref(projectId, item))}
                    onStartExperiment={(item) => router.push(getExperimentNewHref(projectId, item))}
                  />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function DatasetsListPage({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const datasetsQuery = useDatasets(projectId);
  const datasetsLoading = useDelayedLoading(datasetsQuery.isLoading);
  const deleteDatasetMutation = useDeleteDataset(projectId);
  const downloadDatasetMutation = useDownloadDataset(projectId);
  const updateDatasetMutation = useUpdateDataset(projectId);
  const downloadProgress = useDatasetTransferProgress();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeModality, setActiveModality] = useState<'all' | DatasetModality>('all');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDataset | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<ProjectDataset | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [downloadingDatasetId, setDownloadingDatasetId] = useState<string | null>(null);
  const datasets = useMemo(() => (datasetsQuery.data?.data ?? []).map(toProjectDataset), [datasetsQuery.data]);

  const activeDatasets = datasets.filter((dataset) => dataset.status !== 'deleted');
  const totalSamples = datasets.reduce((sum, dataset) => sum + dataset.sampleCount, 0);
  const selectedDatasets = datasets.filter((dataset) => selectedIds.includes(dataset.id));
  const selectedSamples = selectedDatasets.reduce((sum, dataset) => sum + dataset.sampleCount, 0);

  const filteredDatasets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortDatasets(
      datasets
        .filter((dataset) => activeModality === 'all' || dataset.modalities.includes(activeModality))
        .filter((dataset) => !query || getSearchText(dataset).includes(query)),
      sortMode,
    );
  }, [activeModality, datasets, searchQuery, sortMode]);

  const pageCount = Math.max(1, Math.ceil(filteredDatasets.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedDatasets = filteredDatasets.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);

  const toggleSelected = (datasetId: string) => {
    setSelectedIds((current) =>
      current.includes(datasetId) ? current.filter((item) => item !== datasetId) : [...current, datasetId],
    );
  };

  const deleteTargetHasReferences = deleteTarget ? getReferenceCount(deleteTarget) > 0 : false;
  const deleteTargetPending =
    deleteTarget !== null && deleteDatasetMutation.isPending && deleteDatasetMutation.variables === deleteTarget.id;

  const deleteDataset = (dataset: ProjectDataset) => {
    setDeleteError(null);
    setDeleteTarget(dataset);
  };

  const closeDeleteDialog = () => {
    if (deleteTargetPending) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDeleteDataset = async () => {
    if (!deleteTarget || deleteTargetHasReferences) return;

    const datasetId = deleteTarget.id;
    try {
      await deleteDatasetMutation.mutateAsync(datasetId);
      setSelectedIds((current) => current.filter((item) => item !== datasetId));
      setDeleteTarget(null);
      setDeleteError(null);
    } catch (error) {
      const message = getApiErrorMessage(error);
      setDeleteError(
        message === 'dataset_referenced' ? t('datasets.deleteReferencedError') : message || t('datasets.deleteFailed'),
      );
    }
  };

  const editDataset = (dataset: ProjectDataset) => {
    setEditTarget(dataset);
    setEditName(dataset.name);
    setEditDescription(dataset.description);
    setEditError(null);
  };

  const closeEditDialog = () => {
    if (updateDatasetMutation.isPending) return;
    setEditTarget(null);
    setEditName('');
    setEditDescription('');
    setEditError(null);
  };

  const submitEditDataset = async () => {
    if (!editTarget) return;

    try {
      await updateDatasetMutation.mutateAsync({
        datasetId: editTarget.id,
        body: {
          name: editName.trim(),
          description: editDescription.trim() || null,
        },
      });
      closeEditDialog();
    } catch (error) {
      const message = getApiErrorMessage(error);
      setEditError(
        message === 'dataset_name_taken' ? t('datasets.editNameDuplicate') : message || t('datasets.editNameFailed'),
      );
    }
  };

  const downloadDataset = async (dataset: ProjectDataset, format: DatasetExportFormatDto = 'csv') => {
    setDownloadingDatasetId(dataset.id);
    downloadProgress.start(`${t('datasets.transfer.downloadTitle')}: ${dataset.name}`, null);

    try {
      const file = await downloadDatasetMutation.mutateAsync({
        datasetId: dataset.id,
        format,
        onProgress: downloadProgress.update,
      });
      downloadProgress.complete(file.blob.size);
      saveBlobAsFile(file.blob, file.fileName);
    } catch {
      downloadProgress.fail();
    } finally {
      setDownloadingDatasetId(null);
    }
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="datasets-page">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('datasets.title')}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              <span>{t('datasets.subtitle')}</span>
              <span>·</span>
              {datasetsLoading ? (
                <Skeleton className="h-3.5 w-44" />
              ) : (
                <>
                  <HeaderStat label={t('datasets.header.items')} value={formatCount(datasets.length)} />
                  <span>·</span>
                  <HeaderStat label={t('datasets.header.totalSamples')} value={formatCount(totalSamples)} />
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-r pr-3">
                <span className="text-xs text-muted-foreground">
                  {t('datasets.selected')} <b className="font-mono text-foreground">{selectedIds.length}</b>
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('datasets.aggregateSamples')} {formatCount(selectedSamples)} {t('datasets.samples')}
                </span>
                <ExportFormatMenu variant="outline" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setSelectedIds([])}
                  aria-label={t('datasets.clearSelection')}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
            <Button asChild size="sm" className="h-9 self-start">
              <Link href={`/datasets/new`}>
                <Plus className="size-4" />
                {t('datasets.create')}
              </Link>
            </Button>
          </div>
        </div>

        <DatasetTransferProgressPanel progress={downloadProgress.progress} className="mb-4" />

        <section className="rounded-lg border bg-card" aria-label={t('datasets.listSurface')}>
          <div className="relative flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between">
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
                  placeholder={t('datasets.searchPlaceholder')}
                  className="h-9 pl-8 text-sm"
                />
              </div>
              <FilterChip
                active={activeModality === 'all'}
                count={activeDatasets.length}
                label={t('datasets.filter.all')}
                onClick={() => {
                  setActiveModality('all');
                  setPageIndex(0);
                }}
              />
              <FilterChip
                active={activeModality === 'text'}
                count={getModalityCount(datasets, 'text')}
                label={t('datasets.modality.text')}
                onClick={() => {
                  setActiveModality('text');
                  setPageIndex(0);
                }}
              />
              <FilterChip
                active={activeModality === 'image'}
                count={getModalityCount(datasets, 'image')}
                label={t('datasets.modality.image')}
                onClick={() => {
                  setActiveModality('image');
                  setPageIndex(0);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-9">
                    <SlidersHorizontal className="size-4" />
                    {t(SORT_LABEL_KEYS[sortMode])}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(SORT_LABEL_KEYS) as SortMode[]).map((mode) => (
                    <DropdownMenuItem
                      key={mode}
                      onClick={() => {
                        setSortMode(mode);
                        setPageIndex(0);
                      }}
                    >
                      {t(SORT_LABEL_KEYS[mode])}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {datasetsLoading ? (
            <div className="relative">
              <ListRowsSkeleton rows={8} />
              <PlatformLoaderOverlay />
            </div>
          ) : (
            <>
              <DatasetTable
                datasets={pagedDatasets}
                projectId={projectId}
                selectedIds={selectedIds}
                downloadingDatasetId={downloadingDatasetId}
                deletingDatasetId={deleteDatasetMutation.isPending ? (deleteDatasetMutation.variables ?? null) : null}
                onDelete={deleteDataset}
                onDownload={(dataset) => void downloadDataset(dataset)}
                onEdit={editDataset}
                onToggleSelected={toggleSelected}
              />

              <ResourcePaginationFooter
                summary={
                  <>
                    {t('datasets.totalPrefix')}{' '}
                    <span className="font-mono font-medium text-foreground">{filteredDatasets.length}</span>{' '}
                    {t('datasets.totalSuffix')} · {t('datasets.selected')}{' '}
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

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTargetHasReferences ? t('datasets.deleteBlockedTitle') : t('datasets.deleteConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {deleteTargetHasReferences
                ? t('datasets.deleteBlockedDescription')
                : t('datasets.deleteConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div
              className={cn(
                'rounded-md border p-3 text-sm',
                deleteTargetHasReferences
                  ? 'border-destructive/30 bg-destructive/5 text-destructive'
                  : 'border-border bg-muted/35',
              )}
            >
              <div className="font-medium">{deleteTarget.name}</div>
              <div className={cn('mt-1 text-xs', !deleteTargetHasReferences && 'text-muted-foreground')}>
                <ReferenceText dataset={deleteTarget} />
              </div>
            </div>
          )}
          {deleteError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </div>
          )}
          <DialogFooter>
            {deleteTargetHasReferences ? (
              <Button type="button" variant="outline" onClick={closeDeleteDialog}>
                {t('common.close')}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={closeDeleteDialog} disabled={deleteTargetPending}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void confirmDeleteDataset()}
                  disabled={deleteTargetPending || !deleteTarget}
                  data-testid="datasets-delete-confirm"
                >
                  {deleteTargetPending ? t('datasets.deletePending') : t('datasets.deleteConfirmButton')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('datasets.editNameTitle')}</DialogTitle>
            <DialogDescription>{t('datasets.editNameDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium" htmlFor="dataset-edit-name">
                {t('datasets.upload.name')}
              </label>
              <Input
                id="dataset-edit-name"
                value={editName}
                onChange={(event) => {
                  setEditName(event.target.value);
                  setEditError(null);
                }}
                className="h-9 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium" htmlFor="dataset-edit-description">
                {t('datasets.upload.description')}
              </label>
              <textarea
                id="dataset-edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {editError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {editError}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={updateDatasetMutation.isPending}
              onClick={closeEditDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={updateDatasetMutation.isPending || editName.trim().length === 0}
              onClick={() => void submitEditDataset()}
            >
              {updateDatasetMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('common.savePending')}
                </>
              ) : (
                t('common.save')
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
