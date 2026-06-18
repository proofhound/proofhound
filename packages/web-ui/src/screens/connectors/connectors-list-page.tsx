'use client';

import { Link } from '../../components/navigation/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from '../../hooks/use-router';
import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ListRowsSkeleton,
  PlatformLoaderOverlay,
  ResourcePaginationFooter,
  SlidingViewToggle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableActionIconButton,
  cn,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useBulkDeleteConnectors, useConnectors, useDeleteConnector } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import {
  type ConnectorFilter,
  type ConnectorListItem,
  connectorMatchesFilter,
  getConnectorSearchText,
  getReferenceTotal,
} from './connector-types';
import { ConnectorTypeBadge, DirectionBadge, HealthBadge, SelectionBox } from './connector-ui';

const FILTER_CHIPS: Array<{ filter: ConnectorFilter; labelKey: TranslationKey }> = [
  { filter: { kind: 'all' }, labelKey: 'connectors.filter.all' },
  { filter: { kind: 'direction', value: 'input' }, labelKey: 'connectors.filter.input' },
  { filter: { kind: 'direction', value: 'output' }, labelKey: 'connectors.filter.output' },
  { filter: { kind: 'type', value: 'redis' }, labelKey: 'connectors.filter.redis' },
  { filter: { kind: 'type', value: 'kafka' }, labelKey: 'connectors.filter.kafka' },
  { filter: { kind: 'type', value: 'webhook' }, labelKey: 'connectors.filter.webhook' },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const CONNECTORS_COLUMNS: TableColumn[] = [
  { key: 'select', width: 'narrow', sticky: 'left' },
  { key: 'name', width: 'normal', sticky: 'left' },
  { key: 'direction', width: 'compact' },
  { key: 'type', width: 'compact' },
  { key: 'configSummary', width: 'flex', minPx: 220 },
  { key: 'health', width: 'compact' },
  { key: 'lastProbe', width: 'normal' },
  { key: 'references', width: 'compact' },
  { key: 'lastUpdated', width: 'normal' },
  { key: 'actions', width: 'compact', sticky: 'right' },
];

type ConnectorView = 'list' | 'card';

function resolveConnectorView(value: string | null): ConnectorView {
  return value === 'card' ? 'card' : 'list';
}

interface DeleteState {
  open: boolean;
  ids: string[];
  blockedIds: string[];
  totalRefs: number;
  force: boolean;
  reason: string;
}

const EMPTY_DELETE_STATE: DeleteState = {
  open: false,
  ids: [],
  blockedIds: [],
  totalRefs: 0,
  force: false,
  reason: '',
};

export function ConnectorsListPage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const connectorsQuery = useConnectors(projectId);
  const deleteMutation = useDeleteConnector(projectId);
  const bulkDeleteMutation = useBulkDeleteConnectors(projectId);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConnectorFilter>({ kind: 'all' });
  const view = resolveConnectorView(searchParams.get('view'));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [deleteState, setDeleteState] = useState<DeleteState>(EMPTY_DELETE_STATE);
  const [bulkResultBanner, setBulkResultBanner] = useState<{ deleted: number; rejected: number } | null>(null);

  const all = useMemo(() => connectorsQuery.data?.data ?? [], [connectorsQuery.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((item) => {
      if (!connectorMatchesFilter(item, filter)) return false;
      if (needle && !getConnectorSearchText(item).includes(needle)) return false;
      return true;
    });
  }, [all, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(offset, offset + pageSize);

  const connectorsLoading = useDelayedLoading(connectorsQuery.isLoading && !connectorsQuery.data);

  function toggleSelection(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage(checked: boolean) {
    setSelection((prev) => {
      const next = new Set(prev);
      for (const item of paginated) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  function openDeleteDialog(ids: string[]) {
    const targets = all.filter((item) => ids.includes(item.id));
    const blockedIds: string[] = [];
    let totalRefs = 0;
    for (const item of targets) {
      const refs = getReferenceTotal(item.references);
      if (refs > 0) {
        blockedIds.push(item.id);
        totalRefs += refs;
      }
    }
    setDeleteState({ open: true, ids, blockedIds, totalRefs, force: false, reason: '' });
  }

  function updateView(nextView: ConnectorView) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === 'card') params.set('view', 'card');
    else params.delete('view');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function submitDelete() {
    const { ids, blockedIds, force, reason } = deleteState;
    if (blockedIds.length > 0 && !force) return;
    if (force && reason.trim().length === 0) return;
    try {
      if (ids.length === 1) {
        await deleteMutation.mutateAsync({
          connectorId: ids[0]!,
          options: force ? { force: true, reason: reason.trim() } : undefined,
        });
        setSelection((prev) => {
          const next = new Set(prev);
          next.delete(ids[0]!);
          return next;
        });
      } else {
        const result = await bulkDeleteMutation.mutateAsync({
          ids,
          force,
          reason: force ? reason.trim() : undefined,
        });
        setBulkResultBanner({ deleted: result.deletedIds.length, rejected: result.rejected.length });
        setSelection((prev) => {
          const next = new Set(prev);
          for (const id of result.deletedIds) next.delete(id);
          return next;
        });
      }
      setDeleteState(EMPTY_DELETE_STATE);
    } catch (error) {
      console.error(getApiErrorMessage(error));
    }
  }

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="project-connectors-page">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('connectors.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('connectors.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild data-testid="project-connectors-create">
              <Link href={`/connectors/new`}>
                <Plus className="mr-2 h-4 w-4" />
                {t('connectors.create')}
              </Link>
            </Button>
          </div>
        </div>

        {/* toolbar */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t('connectors.searchPlaceholder')}
            className="w-72"
            data-testid="project-connectors-search"
          />
          <SlidingViewToggle
            value={view}
            ariaLabel="view-toggle"
            onChange={updateView}
            options={[
              { value: 'list', label: 'List' },
              { value: 'card', label: 'Card' },
            ]}
          />
        </div>

        {/* chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTER_CHIPS.map(({ filter: chipFilter, labelKey }) => {
            const active = isSameFilter(filter, chipFilter);
            return (
              <Button
                key={`${chipFilter.kind}:${'value' in chipFilter ? chipFilter.value : '*'}`}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => {
                  setFilter(chipFilter);
                  setPage(1);
                }}
              >
                {t(labelKey)}
              </Button>
            );
          })}
        </div>

        {/* bulk banner */}
        {bulkResultBanner && (
          <div
            className="mt-4 rounded-md border bg-muted/40 px-4 py-2 text-sm"
            data-testid="project-connectors-bulk-banner"
          >
            {t('connectors.delete.bulk.partialTitle')} ·{' '}
            {t('connectors.delete.bulk.partialBody')
              .replace('{{deleted}}', String(bulkResultBanner.deleted))
              .replace('{{rejected}}', String(bulkResultBanner.rejected))}
            <Button variant="link" size="sm" className="ml-2" onClick={() => setBulkResultBanner(null)}>
              ×
            </Button>
          </div>
        )}

        {/* selection toolbar */}
        {selection.size > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-md border bg-card px-4 py-2 text-sm">
            <span>{`${selection.size} ${t('connectors.totalSuffix')}`}</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => openDeleteDialog([...selection])}
              data-testid="project-connectors-bulk-delete"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('connectors.action.bulkDelete')}
            </Button>
          </div>
        )}

        {/* table or cards */}
        {connectorsLoading ? (
          <div className="relative rounded-lg border bg-card">
            <ListRowsSkeleton rows={8} />
            <PlatformLoaderOverlay />
          </div>
        ) : (
          <>
            {view === 'list' ? (
              <ListView
                items={paginated}
                allSelected={paginated.every((item) => selection.has(item.id))}
                onToggleAll={selectAllOnPage}
                isSelected={(id) => selection.has(id)}
                onToggle={toggleSelection}
                onDelete={(id) => openDeleteDialog([id])}
              />
            ) : (
              <CardView
                items={paginated}
                isSelected={(id) => selection.has(id)}
                onToggle={toggleSelection}
                onDelete={(id) => openDeleteDialog([id])}
              />
            )}

            {filtered.length === 0 && (
              <p className="mt-8 text-center text-sm text-muted-foreground" data-testid="project-connectors-empty">
                {t('connectors.empty')}
              </p>
            )}

            <ResourcePaginationFooter
              pageIndex={currentPage - 1}
              pageCount={totalPages}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              previousPageLabel="Previous"
              nextPageLabel="Next"
              onPageChange={(index) => setPage(index + 1)}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(1);
              }}
            />
          </>
        )}
      </div>

      {/* delete dialog */}
      <Dialog open={deleteState.open} onOpenChange={(open) => !open && setDeleteState(EMPTY_DELETE_STATE)}>
        <DialogContent data-testid="project-connectors-delete-dialog">
          <DialogHeader>
            <DialogTitle>
              {deleteState.blockedIds.length > 0
                ? t('connectors.delete.referencedTitle')
                : t('connectors.delete.confirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {deleteState.blockedIds.length > 0
                ? t('connectors.delete.referencedBody')
                : t('connectors.delete.confirmBody')}
            </DialogDescription>
          </DialogHeader>
          {deleteState.blockedIds.length > 0 && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer accent-primary"
                  checked={deleteState.force}
                  onChange={(event) => setDeleteState((prev) => ({ ...prev, force: event.target.checked }))}
                />
                {t('connectors.delete.forceLabel')}
              </label>
              {deleteState.force && (
                <div>
                  <Label className="text-xs">{t('connectors.delete.reasonLabel')}</Label>
                  <Input
                    value={deleteState.reason}
                    onChange={(e) => setDeleteState((prev) => ({ ...prev, reason: e.target.value }))}
                    data-testid="project-connectors-delete-reason"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteState(EMPTY_DELETE_STATE)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitDelete()}
              disabled={
                (deleteState.blockedIds.length > 0 && !deleteState.force) ||
                (deleteState.force && deleteState.reason.trim().length === 0) ||
                deleteMutation.isPending ||
                bulkDeleteMutation.isPending
              }
              data-testid="project-connectors-delete-confirm"
            >
              {t('connectors.action.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Main>
  );

  function ListView({
    items,
    allSelected,
    onToggleAll,
    isSelected,
    onToggle,
    onDelete,
  }: {
    items: ConnectorListItem[];
    allSelected: boolean;
    onToggleAll: (checked: boolean) => void;
    isSelected: (id: string) => boolean;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
  }) {
    return (
      <div className="mt-4 overflow-hidden rounded-lg border bg-card" data-testid="project-connectors-table">
        <Table columns={CONNECTORS_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead column="select">
                <SelectionBox
                  ariaLabel="select-all-connectors"
                  checked={items.length > 0 && allSelected}
                  disabled={items.length === 0}
                  onClick={() => onToggleAll(!(items.length > 0 && allSelected))}
                />
              </TableHead>
              <TableHead column="name">{t('connectors.table.name')}</TableHead>
              <TableHead column="direction">{t('connectors.table.direction')}</TableHead>
              <TableHead column="type">{t('connectors.table.type')}</TableHead>
              <TableHead column="configSummary">{t('connectors.table.configSummary')}</TableHead>
              <TableHead column="health">{t('connectors.table.health')}</TableHead>
              <TableHead column="lastProbe">{t('connectors.table.lastProbe')}</TableHead>
              <TableHead column="references">{t('connectors.table.references')}</TableHead>
              <TableHead column="lastUpdated">{t('connectors.table.lastUpdated')}</TableHead>
              <TableHead column="actions" className="text-right">
                {t('connectors.table.actions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const selected = isSelected(item.id);
              return (
                <TableRow
                  key={item.id}
                  selected={selected}
                  onClick={() => router.push(`/connectors/${item.id}`)}
                  data-testid={`project-connector-row-${item.id}`}
                >
                  <TableCell column="select">
                    <SelectionBox
                      ariaLabel={`select-${item.name}`}
                      checked={selected}
                      onClick={() => onToggle(item.id)}
                    />
                  </TableCell>
                  <TableCell column="name" stopPropagation={false}>
                    <span className="font-medium">{item.name}</span>
                    {item.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </TableCell>
                  <TableCell column="direction">
                    <DirectionBadge direction={item.direction} />
                  </TableCell>
                  <TableCell column="type">
                    <ConnectorTypeBadge type={item.type} />
                  </TableCell>
                  <TableCell column="configSummary" className="text-muted-foreground" truncate>
                    {item.configSummary}
                  </TableCell>
                  <TableCell column="health">
                    <HealthBadge status={item.healthStatus} />
                  </TableCell>
                  <TableCell column="lastProbe">
                    <ProbeSummary item={item} />
                  </TableCell>
                  <TableCell column="references" className="text-muted-foreground">
                    {getReferenceTotal(item.references)}
                  </TableCell>
                  <TableCell column="lastUpdated" className="text-muted-foreground">
                    {formatDateTime(item.updatedAt)}
                  </TableCell>
                  <TableCell column="actions">
                    <div className="flex items-center justify-end gap-1">
                      <TableActionIconButton
                        label={t('connectors.action.edit')}
                        onClick={() => router.push(`/connectors/${item.id}/edit`)}
                      >
                        <Pencil className="h-4 w-4" />
                      </TableActionIconButton>
                      <TableActionIconButton
                        label={t('connectors.action.delete')}
                        onClick={() => onDelete(item.id)}
                        className="text-destructive hover:text-destructive"
                        data-testid={`project-connector-delete-${item.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </TableActionIconButton>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  function CardView({
    items,
    isSelected,
    onToggle,
    onDelete,
  }: {
    items: ConnectorListItem[];
    isSelected: (id: string) => boolean;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
  }) {
    return (
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="project-connectors-cards">
        {items.map((item) => {
          const selected = isSelected(item.id);
          return (
            <div
              key={item.id}
              className={cn(
                'flex flex-col gap-2 rounded-lg border bg-card p-4',
                selected && 'border-l-2 border-l-primary',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SelectionBox
                    ariaLabel={`select-${item.name}`}
                    checked={selected}
                    onClick={() => onToggle(item.id)}
                  />
                  <Link href={`/connectors/${item.id}`} className="font-medium hover:underline">
                    {item.name}
                  </Link>
                </div>
                <HealthBadge status={item.healthStatus} />
              </div>
              {item.description && <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <DirectionBadge direction={item.direction} />
                <ConnectorTypeBadge type={item.type} />
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1">{item.configSummary}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(item.updatedAt)}</p>
              <ProbeSummary item={item} compact />
              <div className="mt-1 flex items-center justify-end gap-1">
                <TableActionIconButton
                  label={t('connectors.action.edit')}
                  onClick={() => router.push(`/connectors/${item.id}/edit`)}
                >
                  <Pencil className="h-4 w-4" />
                </TableActionIconButton>
                <TableActionIconButton
                  label={t('connectors.action.delete')}
                  onClick={() => onDelete(item.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </TableActionIconButton>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
}

function isSameFilter(left: ConnectorFilter, right: ConnectorFilter): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'all') return true;
  return (
    (left as Exclude<ConnectorFilter, { kind: 'all' }>).value ===
    (right as Exclude<ConnectorFilter, { kind: 'all' }>).value
  );
}

function ProbeSummary({ item, compact = false }: { item: ConnectorListItem; compact?: boolean }) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const status = item.lastProbedAt ? (item.lastProbeError ? 'failed' : 'success') : 'pending';
  const label =
    status === 'success'
      ? t('connectors.probe.success')
      : status === 'failed'
        ? t('connectors.probe.failed')
        : t('connectors.probe.pending');

  return (
    <div className={cn('min-w-0 text-xs', compact ? 'text-muted-foreground' : '')}>
      <div className="truncate font-medium">{label}</div>
      <div className="truncate text-muted-foreground">
        {item.lastProbedAt ? formatDateTime(item.lastProbedAt) : t('connectors.detail.health.never')}
      </div>
      {!compact && item.lastProbeError ? (
        <div className="truncate text-destructive" title={item.lastProbeError}>
          {item.lastProbeError}
        </div>
      ) : null}
    </div>
  );
}
