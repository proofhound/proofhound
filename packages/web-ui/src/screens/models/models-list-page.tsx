'use client';

import { Link } from '../../components/navigation/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from '../../hooks/use-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Cable,
  Check,
  CopyPlus,
  DollarSign,
  Download,
  Edit3,
  Grid2X2,
  List,
  MoreHorizontal,
  Power,
  Plus,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FilterChip,
  ListRowsSkeleton,
  ListToolbar,
  PlatformLoaderOverlay,
  ModalityIconGroup,
  Progress,
  formatProgressLabel,
  ResourcePaginationFooter,
  SlidingViewToggle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_ACTION_ICON_BUTTON_CLASS,
  TableActionIconButton,
  TableActionTooltip,
  ToolbarFilterPopover,
  ToolbarSearch,
  ToolbarSelectionBar,
  cn,
} from '@proofhound/ui';
import type { ModalityKind, TableColumn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage, getProviderTypeLabel } from '../../lib';
import {
  useDateTimeFormatter,
  useDeleteProjectModel,
  useDuplicateProjectModel,
  useProbeProjectModel,
  useProjectModels,
  useUpdateProjectModel,
} from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { dtoToProjectModel } from './project-model-adapter';
import {
  MODEL_SOURCE_LABEL_KEYS,
  MODEL_STATUS_CLASSES,
  MODEL_STATUS_LABEL_KEYS,
  getProjectModelSource,
  isProjectModelEditable,
  type ImageCapability,
  type ModelSource,
  type ModelStatus,
  type ProbeStatus,
  type ProjectModel,
} from './model-view-model';

type ViewMode = 'table' | 'cards';
type ModelFilter = 'all' | 'local' | 'enabled' | 'vision';
type ConnectivityStatus = 'success' | 'testing' | 'failed';

function resolveViewMode(value: string | null): ViewMode {
  return value === 'cards' ? 'cards' : 'table';
}
const MODELS_COLUMNS: TableColumn[] = [
  { key: 'select', width: 'narrow', sticky: 'left' },
  { key: 'name', width: 'wide', sticky: 'left' },
  { key: 'capability', width: 'compact' },
  { key: 'status', width: 'compact' },
  { key: 'rpm', width: 'normal' },
  { key: 'tpm', width: 'normal' },
  { key: 'concurrency', width: 'normal' },
  { key: 'pricing', width: 'normal' },
  { key: 'probe', width: 'normal' },
  { key: 'actions', width: 'normal', sticky: 'right' },
];

const SOURCE_CLASS_NAMES: Record<ModelSource, string> = {
  local: 'status-running',
};

const FILTERS: Array<{ key: ModelFilter; labelKey: TranslationKey }> = [
  { key: 'all', labelKey: 'models.filter.all' },
  { key: 'local', labelKey: 'models.filter.local' },
  { key: 'enabled', labelKey: 'models.filter.enabled' },
  { key: 'vision', labelKey: 'models.filter.vision' },
];

const CONNECTIVITY_STATUS_LABEL_KEYS: Record<ConnectivityStatus, TranslationKey> = {
  success: 'models.connectivity.status.success',
  testing: 'models.connectivity.status.testing',
  failed: 'models.connectivity.status.failed',
};

const CONNECTIVITY_STATUS_CLASSES: Record<ConnectivityStatus, string> = {
  success:
    'border-[color-mix(in_srgb,var(--src-prod)_30%,var(--border))] bg-[var(--src-prod-soft)] text-[var(--src-prod-fg)]',
  testing:
    'border-[color-mix(in_srgb,var(--src-canary)_30%,var(--border))] bg-[var(--src-canary-soft)] text-[var(--src-canary-fg)]',
  failed: 'border-[var(--field-expected-no-bd)] bg-[var(--field-expected-no-bg)] text-[var(--field-expected-no-fg)]',
};

const CONNECTIVITY_STATUS_DOT_CLASSES: Record<ConnectivityStatus, string> = {
  success: 'bg-[var(--src-prod)]',
  testing: 'bg-[var(--src-canary)]',
  failed: 'bg-[var(--field-expected-no-fg)]',
};

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function formatProbeDuration(durationMs: number | null): string {
  if (durationMs == null) return '--';
  const roundedMs = Math.max(0, Math.round(durationMs));
  if (roundedMs < 1000) return `${roundedMs} ms`;
  const seconds = roundedMs / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)} s`;
}

function matchesFilter(model: ProjectModel, filter: ModelFilter) {
  const source = getProjectModelSource(model);
  if (filter === 'local') return source === 'local';
  if (filter === 'enabled') return model.status === 'enabled';
  if (filter === 'vision') return model.imageCapability !== 'none';
  return true;
}

function getSearchText(model: ProjectModel) {
  return [model.name, getProviderTypeLabel(model.provider), model.provider, model.providerModelId, model.owner]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getFilterCount(models: ProjectModel[], filter: ModelFilter) {
  return models.filter((model) => matchesFilter(model, filter)).length;
}

function SourcePill({ source }: { source: ModelSource }) {
  const { t } = useI18n();

  return (
    <span
      className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', SOURCE_CLASS_NAMES[source])}
    >
      {t(MODEL_SOURCE_LABEL_KEYS[source])}
    </span>
  );
}

function StatusBadge({ status }: { status: ModelStatus }) {
  const { t } = useI18n();
  const config = MODEL_STATUS_CLASSES[status];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', config.pill)}
    >
      <span className={cn('size-1.5 rounded-full', config.dot)} />
      {t(MODEL_STATUS_LABEL_KEYS[status])}
    </span>
  );
}

function ProbeBadge({ status, testing }: { status: ProbeStatus; testing: boolean }) {
  const { t } = useI18n();
  const connectivityStatus: ConnectivityStatus | null = testing ? 'testing' : status === 'pending' ? null : status;
  const className = connectivityStatus ? CONNECTIVITY_STATUS_CLASSES[connectivityStatus] : 'status-archived';
  const dotClassName = connectivityStatus ? CONNECTIVITY_STATUS_DOT_CLASSES[connectivityStatus] : 'dot-archived';
  const label = connectivityStatus ? t(CONNECTIVITY_STATUS_LABEL_KEYS[connectivityStatus]) : t('models.probe.pending');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotClassName)} />
      {label}
    </span>
  );
}

function SelectionBox({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-[3px] border transition-colors',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/50 bg-background',
      )}
      aria-pressed={checked}
    >
      {checked && <Check className="size-3" />}
    </button>
  );
}

function QuotaMeter({
  label,
  limit,
  current,
  usage,
  compact = false,
}: {
  label?: string;
  limit: string;
  current: string;
  usage: number;
  compact?: boolean;
}) {
  const meterLabel = formatProgressLabel({
    value: usage,
    max: 100,
    percent: usage,
    valueLabel: current,
    maxLabel: limit,
  });

  return (
    <div className={cn(compact ? 'space-y-1' : 'min-w-[132px] space-y-1 text-right')}>
      {label && <div className="font-mono text-[10px] uppercase text-muted-foreground">{label}</div>}
      <Progress value={usage} label={meterLabel} />
    </div>
  );
}

function CapabilityIcons({ capability }: { capability: ImageCapability }) {
  const { t } = useI18n();
  const supportsImage = capability !== 'none';
  const imageTitle =
    capability === 'both'
      ? t('models.capability.imageBoth')
      : capability === 'url'
        ? t('models.capability.imageUrl')
        : t('models.capability.imageBase64');
  const textTitle = t('models.capability.text');
  const kinds: ModalityKind[] = supportsImage ? ['text', 'image'] : ['text'];
  const tooltips = supportsImage ? { text: textTitle, image: imageTitle } : { text: textTitle };
  const ariaLabels = tooltips;

  return <ModalityIconGroup kinds={kinds} tooltips={tooltips} ariaLabels={ariaLabels} />;
}

function PricingCell({ model, compact = false }: { model: ProjectModel; compact?: boolean }) {
  const { t } = useI18n();

  return (
    <div className={cn('font-mono', compact ? 'text-[11px]' : 'text-right text-[12px]')}>
      <div className="font-medium text-foreground">
        ${model.pricing.inputPerMillion} / ${model.pricing.outputPerMillion}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{t('models.table.pricingDirection')}</div>
      <div className="text-[10px] text-muted-foreground">{t('models.table.pricingUnit')}</div>
    </div>
  );
}

function ModelActions({
  model,
  onDelete,
  onCopy,
  onToggleStatus,
  onTestConnectivity,
  testing,
}: {
  model: ProjectModel;
  onDelete: (model: ProjectModel) => void;
  onCopy: (model: ProjectModel) => void;
  onToggleStatus: (model: ProjectModel) => void;
  onTestConnectivity: (model: ProjectModel) => void;
  testing: boolean;
}) {
  const { t } = useI18n();
  const editable = isProjectModelEditable(model);

  return (
    <div className="inline-flex items-center gap-1">
      <TableActionIconButton
        label={t('models.action.test')}
        disabled={testing}
        onClick={(event) => {
          event.stopPropagation();
          onTestConnectivity(model);
        }}
      >
        <Cable className="size-3.5" />
      </TableActionIconButton>
      <TableActionIconButton
        label={t('models.action.copy')}
        onClick={(event) => {
          event.stopPropagation();
          onCopy(model);
        }}
      >
        <CopyPlus className="size-3.5" />
      </TableActionIconButton>
      <DropdownMenu>
        <TableActionTooltip label={t('models.action.more')}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={TABLE_ACTION_ICON_BUTTON_CLASS}
              aria-label={t('models.action.more')}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TableActionTooltip>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem asChild>
            <Link href={`/models/${model.id}/edit`}>
              <Edit3 className="size-4" />
              {t('models.action.edit')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!editable}
            onClick={(event) => {
              event.stopPropagation();
              onToggleStatus(model);
            }}
          >
            <Power className="size-4" />
            {model.status === 'disabled' ? t('models.action.enable') : t('models.action.disable')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!editable}
            className="text-destructive focus:text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(model);
            }}
          >
            <Trash2 className="size-4" />
            {t('models.action.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ModelTable({
  models,
  selectedIds,
  onToggleSelected,
  onDelete,
  onCopy,
  onToggleStatus,
  onTestConnectivity,
  testingIds,
}: {
  models: ProjectModel[];
  selectedIds: string[];
  onToggleSelected: (modelId: string) => void;
  onDelete: (model: ProjectModel) => void;
  onCopy: (model: ProjectModel) => void;
  onToggleStatus: (model: ProjectModel) => void;
  onTestConnectivity: (model: ProjectModel) => void;
  testingIds: string[];
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();

  return (
    <Table columns={MODELS_COLUMNS} containerTestId="models-table-view">
      <TableHeader>
        <TableRow>
          <TableHead column="select">
            <span className="sr-only">{t('models.select')}</span>
          </TableHead>
          <TableHead column="name">{t('models.table.name')}</TableHead>
          <TableHead column="capability">{t('models.table.capability')}</TableHead>
          <TableHead column="status">{t('models.table.status')}</TableHead>
          <TableHead column="rpm">{t('models.table.rpm')}</TableHead>
          <TableHead column="tpm">{t('models.table.tpm')}</TableHead>
          <TableHead column="concurrency">{t('models.table.concurrency')}</TableHead>
          <TableHead column="pricing">{t('models.table.pricing')}</TableHead>
          <TableHead column="probe">{t('models.table.lastProbe')}</TableHead>
          <TableHead column="actions" className="text-right">
            {t('common.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => {
          const selected = selectedIds.includes(model.id);
          return (
            <TableRow
              key={model.id}
              selected={selected}
              onClick={() => router.push(`/models/${model.id}/edit`)}
              className={cn(model.status === 'disabled' && 'opacity-70')}
            >
              <TableCell column="select">
                <SelectionBox checked={selected} onClick={() => onToggleSelected(model.id)} />
              </TableCell>
              <TableCell column="name">
                <div className="truncate font-semibold">{model.name}</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {model.providerModelId}
                </div>
              </TableCell>
              <TableCell column="capability">
                <CapabilityIcons capability={model.imageCapability} />
              </TableCell>
              <TableCell column="status">
                <StatusBadge status={model.status} />
              </TableCell>
              <TableCell column="rpm">
                <QuotaMeter limit={model.rpm.limit} current={model.rpm.current} usage={model.rpm.usage} />
              </TableCell>
              <TableCell column="tpm">
                <QuotaMeter limit={model.tpm.limit} current={model.tpm.current} usage={model.tpm.usage} />
              </TableCell>
              <TableCell column="concurrency">
                <QuotaMeter
                  limit={model.concurrency.limit}
                  current={model.concurrency.current}
                  usage={model.concurrency.usage}
                />
              </TableCell>
              <TableCell column="pricing">
                <PricingCell model={model} />
              </TableCell>
              <TableCell column="probe">
                <div className="space-y-1">
                  <ProbeBadge status={model.probeStatus ?? 'pending'} testing={testingIds.includes(model.id)} />
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {model.lastProbedAt ? formatDateTime(model.lastProbedAt) : '--'}
                  </div>
                </div>
              </TableCell>
              <TableCell column="actions" className="text-right">
                <ModelActions
                  model={model}
                  onDelete={onDelete}
                  onCopy={onCopy}
                  onToggleStatus={onToggleStatus}
                  onTestConnectivity={onTestConnectivity}
                  testing={testingIds.includes(model.id)}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ModelCards({
  models,
  selectedIds,
  onToggleSelected,
  onDelete,
  onCopy,
  onToggleStatus,
  onTestConnectivity,
  testingIds,
}: {
  models: ProjectModel[];
  selectedIds: string[];
  onToggleSelected: (modelId: string) => void;
  onDelete: (model: ProjectModel) => void;
  onCopy: (model: ProjectModel) => void;
  onToggleStatus: (model: ProjectModel) => void;
  onTestConnectivity: (model: ProjectModel) => void;
  testingIds: string[];
}) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="models-card-view">
      {models.map((model) => {
        const selected = selectedIds.includes(model.id);
        return (
          <article
            key={model.id}
            className={cn(
              'relative rounded-lg border bg-card p-4 transition-colors hover:border-ring/50',
              model.status === 'disabled' && 'opacity-70',
            )}
            onClick={() => router.push(`/models/${model.id}/edit`)}
          >
            <div className="absolute left-3 top-3">
              <SelectionBox checked={selected} onClick={() => onToggleSelected(model.id)} />
            </div>
            <div className="min-w-0 pl-6">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold">{model.name}</h2>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {getProviderTypeLabel(model.provider)} · {model.providerModelId}
                  </div>
                </div>
                <ModelActions
                  model={model}
                  onDelete={onDelete}
                  onCopy={onCopy}
                  onToggleStatus={onToggleStatus}
                  onTestConnectivity={onTestConnectivity}
                  testing={testingIds.includes(model.id)}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <SourcePill source={getProjectModelSource(model)} />
                <StatusBadge status={model.status} />
                <CapabilityIcons capability={model.imageCapability} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-y py-3">
              <QuotaMeter
                compact
                label="RPM"
                limit={model.rpm.limit}
                current={model.rpm.current}
                usage={model.rpm.usage}
              />
              <QuotaMeter
                compact
                label="TPM"
                limit={model.tpm.limit}
                current={model.tpm.current}
                usage={model.tpm.usage}
              />
              <QuotaMeter
                compact
                label={t('models.table.concurrency')}
                limit={model.concurrency.limit}
                current={model.concurrency.current}
                usage={model.concurrency.usage}
              />
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/45 px-3 py-2">
              <DollarSign className="size-3.5 text-[var(--status-canary-fg)]" />
              <PricingCell model={model} compact />
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {!isProjectModelEditable(model)
                  ? t('models.card.readonlySource')
                  : `${t('models.card.references')} ${model.references}`}
              </span>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={(event) => event.stopPropagation()}
              >
                <Link href={`/models/${model.id}/edit`}>{t('models.action.edit')}</Link>
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ConnectivityDialog({
  model,
  testing,
  durationMs,
  onOpenChange,
}: {
  model: ProjectModel | null;
  testing: boolean;
  durationMs: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();

  if (!model) return null;

  const probeStatus: ProbeStatus = model.probeStatus ?? (testing ? 'pending' : 'success');
  const connectivityStatus: ConnectivityStatus = testing ? 'testing' : probeStatus === 'failed' ? 'failed' : 'success';
  const statusText = t(CONNECTIVITY_STATUS_LABEL_KEYS[connectivityStatus]);
  const errorMessage =
    !testing && probeStatus === 'failed' ? (model.lastProbeError ?? t('models.connectivity.failedDetail')) : null;
  const durationLabel = testing ? t('models.connectivity.elapsed') : t('models.connectivity.duration');

  return (
    <Dialog open={model !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('models.connectivity.title')}</DialogTitle>
          <DialogDescription>{model.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-3">
            <div>
              <div className="text-sm font-medium">
                {testing ? t('models.connectivity.running') : t('models.connectivity.done')}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {getProviderTypeLabel(model.provider)} · {model.providerModelId}
              </div>
            </div>
            <div
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium',
                CONNECTIVITY_STATUS_CLASSES[connectivityStatus],
              )}
            >
              <span className={cn('size-1.5 rounded-full', CONNECTIVITY_STATUS_DOT_CLASSES[connectivityStatus])} />
              {statusText}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Timer className="size-4 text-muted-foreground" />
              {durationLabel}
            </div>
            <div className="font-mono text-sm">{formatProbeDuration(durationMs)}</div>
          </div>
          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-[12.5px] leading-relaxed text-destructive"
            >
              {errorMessage}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ModelsListPage({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewMode = resolveViewMode(searchParams.get('view'));
  const [activeFilter, setActiveFilter] = useState<ModelFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const projectQuery = useProjectModels(projectId);
  const updateMutation = useUpdateProjectModel(projectId);
  const deleteMutation = useDeleteProjectModel(projectId);
  const probeMutation = useProbeProjectModel(projectId);
  const duplicateMutation = useDuplicateProjectModel(projectId);
  const queryModels = useMemo(() => (projectQuery.data?.data ?? []).map(dtoToProjectModel), [projectQuery.data]);
  const [models, setModels] = useState<ProjectModel[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync server query into local state used for optimistic mutation updates
    setModels(queryModels);
  }, [queryModels]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [onlyEditable, setOnlyEditable] = useState(false);
  const [onlyNearLimit, setOnlyNearLimit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectModel | null>(null);
  const [connectivityTarget, setConnectivityTarget] = useState<ProjectModel | null>(null);
  const [connectivityStartedAt, setConnectivityStartedAt] = useState<number | null>(null);
  const [connectivityElapsedMs, setConnectivityElapsedMs] = useState(0);
  const [connectivityDurationMs, setConnectivityDurationMs] = useState<number | null>(null);
  const [testingIds, setTestingIds] = useState<string[]>([]);
  useEffect(() => {
    if (connectivityStartedAt == null) return undefined;
    const updateElapsed = () => setConnectivityElapsedMs(Date.now() - connectivityStartedAt);
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(interval);
  }, [connectivityStartedAt]);

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return models
      .filter((model) => matchesFilter(model, activeFilter))
      .filter((model) => !onlyEditable || isProjectModelEditable(model))
      .filter((model) => !onlyNearLimit || Math.max(model.rpm.usage, model.tpm.usage, model.concurrency.usage) >= 80)
      .filter((model) => {
        if (!query) return true;
        return getSearchText(model).includes(query);
      });
  }, [activeFilter, models, onlyEditable, onlyNearLimit, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedModels = filteredModels.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);

  const modelsLoading = useDelayedLoading(projectQuery.isLoading && !projectQuery.data);

  const toggleSelected = (modelId: string) => {
    setSelectedIds((current) =>
      current.includes(modelId) ? current.filter((item) => item !== modelId) : [...current, modelId],
    );
  };

  const testConnectivity = (model: ProjectModel) => {
    const pendingModel = { ...model, probeStatus: 'pending' as const };
    const startedAt = Date.now();
    setConnectivityTarget(pendingModel);
    setConnectivityStartedAt(startedAt);
    setConnectivityElapsedMs(0);
    setConnectivityDurationMs(null);
    setTestingIds((current) => (current.includes(model.id) ? current : [...current, model.id]));
    setModels((current) => current.map((item) => (item.id === model.id ? pendingModel : item)));

    probeMutation.mutate(model.id, {
      onSuccess: (result) => {
        const status: ProbeStatus = result.status === 'success' ? 'success' : 'failed';
        const testedModel = {
          ...pendingModel,
          probeStatus: status,
          lastProbedAt: result.probedAt,
          lastProbeError: result.error,
        };
        setConnectivityDurationMs(result.durationMs);
        setModels((current) => current.map((item) => (item.id === model.id ? testedModel : item)));
        setConnectivityTarget((current) => (current?.id === model.id ? testedModel : current));
      },
      onError: (error) => {
        const failedModel = {
          ...pendingModel,
          probeStatus: 'failed' as const,
          lastProbeError: getApiErrorMessage(error) ?? t('models.connectivity.failedDetail'),
        };
        setConnectivityDurationMs(Date.now() - startedAt);
        setModels((current) => current.map((item) => (item.id === model.id ? failedModel : item)));
        setConnectivityTarget((current) => (current?.id === model.id ? failedModel : current));
      },
      onSettled: () => {
        setConnectivityStartedAt(null);
        setTestingIds((current) => current.filter((item) => item !== model.id));
      },
    });
  };

  const toggleStatus = (model: ProjectModel) => {
    if (!isProjectModelEditable(model)) return;
    const next: ModelStatus = model.status === 'disabled' ? 'enabled' : 'disabled';
    setModels((current) => current.map((item) => (item.id === model.id ? { ...item, status: next } : item)));
    updateMutation.mutate({ modelId: model.id, body: { status: next } });
  };

  const copyModel = (model: ProjectModel) => {
    duplicateMutation.mutate(model.id, {
      onSuccess: (created) => router.push(`/models/${created.id}/edit`),
    });
  };

  const updateViewMode = (nextViewMode: ViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextViewMode === 'cards') params.set('view', 'cards');
    else params.delete('view');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const requestDeleteModel = (model: ProjectModel) => {
    if (!isProjectModelEditable(model)) return;
    setDeleteTarget(model);
  };

  const confirmDeleteModel = () => {
    if (!deleteTarget || deleteTarget.references > 0) return;
    const target = deleteTarget;
    setModels((current) => current.filter((item) => item.id !== target.id));
    setSelectedIds((current) => current.filter((item) => item !== target.id));
    setDeleteTarget(null);
    deleteMutation.mutate({ modelId: target.id });
  };

  const deleteBlocked = Boolean(deleteTarget && deleteTarget.references > 0);

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="models-page">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('models.title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="h-9">
              <Link href={`/models/new`}>
                <Plus className="size-4" />
                {t('models.create')}
              </Link>
            </Button>
          </div>
        </div>

        <section className="rounded-lg border bg-card" aria-label={t('models.listSurface')}>
          <ListToolbar
            lead={
              <>
                <ToolbarSearch
                  value={searchQuery}
                  onChange={(value) => {
                    setSearchQuery(value);
                    setPageIndex(0);
                  }}
                  placeholder={t('models.searchPlaceholder')}
                />
                {FILTERS.map((filter) => (
                  <FilterChip
                    key={filter.key}
                    active={activeFilter === filter.key}
                    count={getFilterCount(models, filter.key)}
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
                <SlidingViewToggle
                  value={viewMode}
                  ariaLabel={t('models.viewMode')}
                  onChange={updateViewMode}
                  options={[
                    { value: 'table', label: t('models.viewTable'), icon: List },
                    { value: 'cards', label: t('models.viewCards'), icon: Grid2X2 },
                  ]}
                />
                <ToolbarFilterPopover
                  label={t('models.filterSettings')}
                  active={onlyEditable || onlyNearLimit}
                >
                  <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
                    {t('models.filterSettings')}
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={onlyEditable}
                      onChange={(event) => {
                        setOnlyEditable(event.target.checked);
                        setPageIndex(0);
                      }}
                      className="size-4 accent-primary"
                    />
                    <span>{t('models.filter.editableOnly')}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={onlyNearLimit}
                      onChange={(event) => {
                        setOnlyNearLimit(event.target.checked);
                        setPageIndex(0);
                      }}
                      className="size-4 accent-primary"
                    />
                    <span>{t('models.filter.nearLimitOnly')}</span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-8 w-full justify-start"
                    onClick={() => {
                      setActiveFilter('all');
                      setOnlyEditable(false);
                      setOnlyNearLimit(false);
                      setSearchQuery('');
                      setPageIndex(0);
                    }}
                  >
                    {t('models.filter.reset')}
                  </Button>
                </ToolbarFilterPopover>
              </>
            }
          />

          {selectedIds.length > 0 && (
            <ToolbarSelectionBar>
              <span className="text-xs text-muted-foreground">
                {t('models.selected')} <b className="font-mono text-foreground">{selectedIds.length}</b>
              </span>
              <Button type="button" variant="outline" size="sm" className="h-8">
                <Download className="size-3.5" />
                {t('models.action.exportCsv')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8">
                <Cable className="size-3.5" />
                {t('models.action.bulkTest')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto size-8"
                onClick={() => setSelectedIds([])}
                aria-label={t('models.clearSelection')}
              >
                <X className="size-3.5" />
              </Button>
            </ToolbarSelectionBar>
          )}

          {modelsLoading ? (
            <div className="relative">
              <ListRowsSkeleton rows={8} />
              <PlatformLoaderOverlay />
            </div>
          ) : viewMode === 'table' ? (
            <ModelTable
              models={pagedModels}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onDelete={requestDeleteModel}
              onCopy={copyModel}
              onToggleStatus={toggleStatus}
              onTestConnectivity={testConnectivity}
              testingIds={testingIds}
            />
          ) : (
            <ModelCards
              models={pagedModels}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onDelete={requestDeleteModel}
              onCopy={copyModel}
              onToggleStatus={toggleStatus}
              onTestConnectivity={testConnectivity}
              testingIds={testingIds}
            />
          )}

          {!modelsLoading && (
            <ResourcePaginationFooter
              summary={
                <>
                  {t('models.totalPrefix')}{' '}
                  <span className="font-mono font-medium text-foreground">{filteredModels.length}</span>{' '}
                  {t('models.totalSuffix')} · {t('models.selected')}{' '}
                  <span className="font-mono font-medium text-foreground">{selectedIds.length}</span>
                </>
              }
              pageIndex={safePageIndex}
              pageCount={pageCount}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              previousPageLabel={t('models.previousPage')}
              nextPageLabel={t('models.nextPage')}
              onPageChange={setPageIndex}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPageIndex(0);
              }}
            />
          )}
        </section>
      </div>
      <ConnectivityDialog
        model={connectivityTarget}
        testing={connectivityTarget ? testingIds.includes(connectivityTarget.id) : false}
        durationMs={
          connectivityTarget && testingIds.includes(connectivityTarget.id)
            ? connectivityElapsedMs
            : connectivityDurationMs
        }
        onOpenChange={(open) => {
          if (!open) {
            setConnectivityTarget(null);
            setConnectivityStartedAt(null);
            setConnectivityElapsedMs(0);
            setConnectivityDurationMs(null);
          }
        }}
      />
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteBlocked ? t('models.form.deleteBlockedTitle') : t('models.deleteDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {deleteBlocked ? t('models.form.deleteBlockedDescription') : t('models.deleteDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              deleteBlocked ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'bg-muted/45',
            )}
          >
            <div className="text-xs font-medium text-muted-foreground">
              {deleteBlocked ? t('models.form.deleteBlockedTitle') : t('models.deleteDialogTarget')}
            </div>
            <div className="mt-1 font-medium">{deleteTarget?.name}</div>
            {deleteBlocked && <div className="mt-1 text-xs">{t('models.form.deleteBlockedHelp')}</div>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              {deleteBlocked ? t('common.close') : t('common.cancel')}
            </Button>
            {!deleteBlocked && (
              <Button type="button" variant="destructive" onClick={confirmDeleteModel}>
                {t('models.deleteDialogConfirm')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
