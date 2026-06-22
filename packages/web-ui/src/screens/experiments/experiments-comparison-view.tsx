'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Database, GitBranch, ListPlus, MessageSquare, Plus, X } from 'lucide-react';
import type { OptimizationListItemDto } from '@proofhound/shared';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../../i18n';
import { useOptimizations } from '../../hooks';

import {
  EXPERIMENT_ENGINEERING_METRIC_KEYS,
  EXPERIMENT_OVERALL_QUALITY_DIMENSION,
  EXPERIMENT_QUALITY_METRIC_KEYS,
  getExperimentComparisonClassLabels,
  getExperimentComparisonMetricDomainMax,
  getExperimentComparisonMetricValue,
  type ExperimentComparisonMetricKey,
  type ExperimentEngineeringMetricKey,
  type ExperimentQualityDimensionKey,
  type ExperimentQualityMetricKey,
  type ExperimentSummary,
} from './experiment-view-model';
import { ExperimentStatusBadge, formatNumber } from './experiment-ui';

const COMPARISON_TABLE_COLUMNS: TableColumn[] = [
  { key: 'name', width: 'wide' },
  { key: 'prompt', width: 'normal' },
  { key: 'dataset', width: 'normal' },
  { key: 'model', width: 'normal' },
  { key: 'status', width: 'compact' },
  { key: 'quality', width: 'compact' },
  { key: 'engineering', width: 'normal' },
  { key: 'actions', width: 'compact' },
];

const EXPERIMENT_COMPARISON_COLORS = [
  'var(--src-canary)',
  'var(--src-prod)',
  'var(--src-iter)',
  'var(--status-pending-dot)',
  'var(--status-archived-dot)',
  'var(--destructive)',
] as const;

const METRIC_LABEL_KEYS: Record<ExperimentComparisonMetricKey, TranslationKey> = {
  accuracy: 'experiments.comparison.metric.accuracy',
  precision: 'experiments.comparison.metric.precision',
  recall: 'experiments.comparison.metric.recall',
  f1: 'experiments.comparison.metric.f1',
  p50LatencyMs: 'experiments.comparison.metric.p50Latency',
  p95LatencyMs: 'experiments.comparison.metric.p95Latency',
  averageLatencyMs: 'experiments.comparison.metric.averageLatency',
  totalTokens: 'experiments.comparison.metric.totalTokens',
  costEstimate: 'experiments.comparison.metric.cost',
  failedSamples: 'experiments.comparison.metric.failedSamples',
};

interface QuickAddGroup {
  key: string;
  label: string;
  meta?: string;
  experimentIds: string[];
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function formatRatio(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatLatency(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function formatCompactNumber(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatCost(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `$ ${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`;
}

function formatMetricValue(key: ExperimentComparisonMetricKey, value: number | undefined) {
  if (key === 'costEstimate') return formatCost(value);
  if (key === 'totalTokens' || key === 'failedSamples') return formatCompactNumber(value);
  if (key === 'p50LatencyMs' || key === 'p95LatencyMs' || key === 'averageLatencyMs') return formatLatency(value);
  return formatRatio(value);
}

function getComparisonColor(index: number) {
  return EXPERIMENT_COMPARISON_COLORS[index % EXPERIMENT_COMPARISON_COLORS.length];
}

function addUniqueExperimentId(group: QuickAddGroup, experimentId: string) {
  if (!group.experimentIds.includes(experimentId)) group.experimentIds.push(experimentId);
}

function getPromptQuickAddGroups(experiments: ExperimentSummary[]): QuickAddGroup[] {
  const groups = new Map<string, QuickAddGroup>();
  for (const experiment of experiments) {
    const key = experiment.promptId ?? `prompt:${experiment.promptName}`;
    const group = groups.get(key) ?? {
      key,
      label: experiment.promptName,
      experimentIds: [],
    };
    addUniqueExperimentId(group, experiment.id);
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.experimentIds.length > 0);
}

function getDatasetQuickAddGroups(experiments: ExperimentSummary[], sampleSuffix: string): QuickAddGroup[] {
  const groups = new Map<string, QuickAddGroup>();
  for (const experiment of experiments) {
    const key = experiment.datasetId ?? `dataset:${experiment.datasetName}`;
    const group = groups.get(key) ?? {
      key,
      label: experiment.datasetName,
      meta: `${formatNumber(experiment.datasetSamples)} ${sampleSuffix}`,
      experimentIds: [],
    };
    addUniqueExperimentId(group, experiment.id);
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.experimentIds.length > 0);
}

function getOptimizationQuickAddGroups(
  experiments: ExperimentSummary[],
  optimizations: OptimizationListItemDto[],
  getMeta: (item: OptimizationListItemDto) => string,
): QuickAddGroup[] {
  return optimizations
    .map((item) => {
      const experimentIds = experiments
        .filter((experiment) => experiment.optimizationId === item.id || experiment.id === item.sourceExperimentId)
        .map((experiment) => experiment.id);
      return {
        key: item.id,
        label: item.name,
        meta: getMeta(item),
        experimentIds,
      };
    })
    .filter((group) => group.experimentIds.length > 0);
}

function ComparisonTable({
  experiments,
  onRemove,
  onRowClick,
}: {
  experiments: ExperimentSummary[];
  onRemove: (experimentId: string) => void;
  onRowClick: (experiment: ExperimentSummary) => void;
}) {
  const { t } = useI18n();

  return (
    <Table columns={COMPARISON_TABLE_COLUMNS} containerTestId="experiments-comparison-table">
      <TableHeader>
        <TableRow>
          <TableHead column="name">{t('experiments.comparison.table.experiment')}</TableHead>
          <TableHead column="prompt">{t('experiments.table.prompt')}</TableHead>
          <TableHead column="dataset">{t('experiments.table.dataset')}</TableHead>
          <TableHead column="model">{t('experiments.table.model')}</TableHead>
          <TableHead column="status">{t('experiments.table.status')}</TableHead>
          <TableHead column="quality">{t('experiments.comparison.table.quality')}</TableHead>
          <TableHead column="engineering">{t('experiments.comparison.table.engineering')}</TableHead>
          <TableHead column="actions" className="text-right">
            {t('common.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {experiments.length === 0 ? (
          <TableEmpty>{t('experiments.comparison.empty')}</TableEmpty>
        ) : (
          experiments.map((experiment, index) => {
            const tokens = getExperimentComparisonMetricValue(experiment, 'totalTokens');
            return (
              <TableRow key={experiment.id} onClick={() => onRowClick(experiment)}>
                <TableCell column="name">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ background: getComparisonColor(index) }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[13px] font-semibold">{experiment.name}</div>
                      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        {experiment.description}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell column="prompt">
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-mono text-[12px]">{experiment.promptName}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {experiment.promptVersion}
                    </div>
                  </div>
                </TableCell>
                <TableCell column="dataset">
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-mono text-[12px]">{experiment.datasetName}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {formatNumber(experiment.datasetSamples)} {t('experiments.sampleSuffix')}
                    </div>
                  </div>
                </TableCell>
                <TableCell column="model">
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-mono text-[12px]">{experiment.modelName}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {experiment.modelVariant}
                    </div>
                  </div>
                </TableCell>
                <TableCell column="status">
                  <ExperimentStatusBadge status={experiment.displayStatus} compact />
                </TableCell>
                <TableCell column="quality">
                  <span className="font-mono text-[12px] tabular-nums">
                    {formatTemplate(t('experiments.comparison.table.qualityValue'), {
                      accuracy: formatRatio(experiment.accuracy),
                      f1: formatRatio(experiment.f1),
                    })}
                  </span>
                </TableCell>
                <TableCell column="engineering">
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {formatTemplate(t('experiments.comparison.table.engineeringValue'), {
                      latency: formatLatency(experiment.p95LatencyMs),
                      tokens: formatCompactNumber(tokens),
                    })}
                  </span>
                </TableCell>
                <TableCell column="actions" className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={formatTemplate(t('experiments.comparison.removeExperiment'), {
                      name: experiment.name,
                    })}
                    onClick={() => onRemove(experiment.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function MetricBars({
  metricKey,
  experiments,
  qualityDimension = EXPERIMENT_OVERALL_QUALITY_DIMENSION,
}: {
  metricKey: ExperimentComparisonMetricKey;
  experiments: ExperimentSummary[];
  qualityDimension?: ExperimentQualityDimensionKey;
}) {
  const { t } = useI18n();
  const max = getExperimentComparisonMetricDomainMax(experiments, metricKey, qualityDimension);
  const hasValues = experiments.some(
    (experiment) => getExperimentComparisonMetricValue(experiment, metricKey, qualityDimension) !== undefined,
  );

  return (
    <section className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold">{t(METRIC_LABEL_KEYS[metricKey])}</h3>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {hasValues ? formatMetricValue(metricKey, max) : '-'}
        </span>
      </div>
      <div className="mt-3 space-y-2.5">
        {experiments.map((experiment, index) => {
          const value = getExperimentComparisonMetricValue(experiment, metricKey, qualityDimension);
          const width = value && value > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
          return (
            <div
              key={`${metricKey}-${experiment.id}`}
              className="grid min-h-8 grid-cols-[minmax(88px,148px)_minmax(0,1fr)_minmax(56px,auto)] items-center gap-2"
            >
              <div className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">{experiment.name}</div>
              <div className="h-2.5 min-w-0 rounded-full bg-muted">
                <div
                  className={cn('h-2.5 rounded-full', value === undefined && 'opacity-0')}
                  style={{
                    width: `${width}%`,
                    background: getComparisonColor(index),
                  }}
                />
              </div>
              <div className="text-right font-mono text-[11.5px] tabular-nums">
                {formatMetricValue(metricKey, value)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricGroup({
  title,
  metricKeys,
  experiments,
  headerAction,
  qualityDimension = EXPERIMENT_OVERALL_QUALITY_DIMENSION,
}: {
  title: string;
  metricKeys: ReadonlyArray<ExperimentQualityMetricKey | ExperimentEngineeringMetricKey>;
  experiments: ExperimentSummary[];
  headerAction?: ReactNode;
  qualityDimension?: ExperimentQualityDimensionKey;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        </div>
        {headerAction}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {metricKeys.map((metricKey) => (
          <MetricBars
            key={metricKey}
            metricKey={metricKey}
            experiments={experiments}
            qualityDimension={qualityDimension}
          />
        ))}
      </div>
    </section>
  );
}

function QuickAddSubMenu({
  label,
  icon,
  groups,
  emptyLabel,
  selectedSet,
  onAdd,
}: {
  label: string;
  icon: ReactNode;
  groups: QuickAddGroup[];
  emptyLabel: string;
  selectedSet: Set<string>;
  onAdd: (experimentIds: string[]) => void;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {icon}
        <span>{label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[360px]">
        {groups.length === 0 ? (
          <DropdownMenuItem disabled>{emptyLabel}</DropdownMenuItem>
        ) : (
          groups.map((group) => {
            const newCount = group.experimentIds.filter((id) => !selectedSet.has(id)).length;
            return (
              <DropdownMenuItem
                key={group.key}
                disabled={newCount === 0}
                onClick={() => onAdd(group.experimentIds)}
                className="items-start gap-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] font-medium">{group.label}</div>
                  {group.meta && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{group.meta}</div>}
                </div>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground">
                  {newCount === 0
                    ? t('experiments.comparison.quickAdd.allAdded')
                    : formatTemplate(t('experiments.comparison.quickAdd.count'), {
                        newCount,
                        count: group.experimentIds.length,
                      })}
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function QuickAddMenu({
  promptGroups,
  datasetGroups,
  optimizationGroups,
  optimizationsLoading,
  selectedSet,
  onAdd,
}: {
  promptGroups: QuickAddGroup[];
  datasetGroups: QuickAddGroup[];
  optimizationGroups: QuickAddGroup[];
  optimizationsLoading: boolean;
  selectedSet: Set<string>;
  onAdd: (experimentIds: string[]) => void;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
          <ListPlus className="size-3.5" />
          {t('experiments.comparison.quickAdd')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        <QuickAddSubMenu
          label={t('experiments.comparison.quickAdd.prompt')}
          icon={<MessageSquare className="size-3.5" />}
          groups={promptGroups}
          emptyLabel={t('experiments.comparison.quickAdd.emptyPrompt')}
          selectedSet={selectedSet}
          onAdd={onAdd}
        />
        <QuickAddSubMenu
          label={t('experiments.comparison.quickAdd.dataset')}
          icon={<Database className="size-3.5" />}
          groups={datasetGroups}
          emptyLabel={t('experiments.comparison.quickAdd.emptyDataset')}
          selectedSet={selectedSet}
          onAdd={onAdd}
        />
        <DropdownMenuSeparator />
        {optimizationsLoading ? (
          <DropdownMenuItem disabled>{t('experiments.comparison.quickAdd.loadingOptimization')}</DropdownMenuItem>
        ) : (
          <QuickAddSubMenu
            label={t('experiments.comparison.quickAdd.optimization')}
            icon={<GitBranch className="size-3.5" />}
            groups={optimizationGroups}
            emptyLabel={t('experiments.comparison.quickAdd.emptyOptimization')}
            selectedSet={selectedSet}
            onAdd={onAdd}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExperimentsComparisonView({
  projectId,
  experiments,
  candidateExperiments,
  selectedIds,
  onSelectedIdsChange,
  onRowClick,
}: {
  projectId: string;
  experiments: ExperimentSummary[];
  candidateExperiments: ExperimentSummary[];
  selectedIds: string[];
  onSelectedIdsChange: (nextIds: string[]) => void;
  onRowClick: (experiment: ExperimentSummary) => void;
}) {
  const { t } = useI18n();
  const optimizationsQuery = useOptimizations(projectId, { sort: 'updated' });
  const selectedSet = new Set(selectedIds);
  const selectedExperiments = selectedIds
    .map((id) => experiments.find((experiment) => experiment.id === id))
    .filter((experiment): experiment is ExperimentSummary => Boolean(experiment));
  const addableExperiments = candidateExperiments.filter((experiment) => !selectedSet.has(experiment.id));
  const promptQuickAddGroups = useMemo(() => getPromptQuickAddGroups(experiments), [experiments]);
  const datasetQuickAddGroups = useMemo(
    () => getDatasetQuickAddGroups(experiments, t('experiments.sampleSuffix')),
    [experiments, t],
  );
  const optimizationQuickAddGroups = useMemo(
    () =>
      getOptimizationQuickAddGroups(experiments, optimizationsQuery.data?.data ?? [], (item) =>
        formatTemplate(t('experiments.comparison.quickAdd.optimizationMeta'), {
          dataset: item.datasetName,
          round: item.currentRound,
          max: item.maxRounds,
        }),
      ),
    [optimizationsQuery.data?.data, experiments, t],
  );
  const [requestedQualityDimension, setRequestedQualityDimension] = useState<ExperimentQualityDimensionKey>(
    EXPERIMENT_OVERALL_QUALITY_DIMENSION,
  );
  const qualityClassLabels = useMemo(
    () => getExperimentComparisonClassLabels(selectedExperiments),
    [selectedExperiments],
  );
  const activeQualityDimension =
    requestedQualityDimension === EXPERIMENT_OVERALL_QUALITY_DIMENSION ||
    qualityClassLabels.includes(requestedQualityDimension)
      ? requestedQualityDimension
      : EXPERIMENT_OVERALL_QUALITY_DIMENSION;
  const qualityDimensionLabel =
    activeQualityDimension === EXPERIMENT_OVERALL_QUALITY_DIMENSION
      ? t('experiments.comparison.dimension.overall')
      : formatTemplate(t('experiments.comparison.dimension.class'), { label: activeQualityDimension });

  const removeExperiment = (experimentId: string) => {
    onSelectedIdsChange(selectedIds.filter((id) => id !== experimentId));
  };
  const addExperimentIds = (experimentIds: string[]) => {
    onSelectedIdsChange([...new Set([...selectedIds, ...experimentIds])]);
  };

  return (
    <div data-testid="experiments-comparison-view">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h2 className="truncate text-[13px] font-semibold">{t('experiments.comparison.title')}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {formatTemplate(t('experiments.comparison.selectedCount'), { count: selectedExperiments.length })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickAddMenu
            promptGroups={promptQuickAddGroups}
            datasetGroups={datasetQuickAddGroups}
            optimizationGroups={optimizationQuickAddGroups}
            optimizationsLoading={optimizationsQuery.isLoading}
            selectedSet={selectedSet}
            onAdd={addExperimentIds}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
                <Plus className="size-3.5" />
                {t('experiments.comparison.addExperiment')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[340px]">
              {addableExperiments.length === 0 ? (
                <DropdownMenuItem disabled>{t('experiments.comparison.optionEmpty')}</DropdownMenuItem>
              ) : (
                addableExperiments.map((experiment) => (
                  <DropdownMenuItem
                    key={experiment.id}
                    onClick={() => onSelectedIdsChange([...selectedIds, experiment.id])}
                    className="items-start"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[12px] font-medium">{experiment.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {formatTemplate(t('experiments.comparison.optionMeta'), {
                          prompt: experiment.promptName,
                          version: experiment.promptVersion,
                          dataset: experiment.datasetName,
                        })}
                      </div>
                    </div>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {formatRatio(experiment.accuracy)}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ComparisonTable experiments={selectedExperiments} onRemove={removeExperiment} onRowClick={onRowClick} />

      {selectedExperiments.length > 0 ? (
        <div className="grid gap-5 border-t p-4 xl:grid-cols-2">
          <MetricGroup
            title={t('experiments.comparison.qualityMetrics')}
            metricKeys={EXPERIMENT_QUALITY_METRIC_KEYS}
            experiments={selectedExperiments}
            qualityDimension={activeQualityDimension}
            headerAction={
              qualityClassLabels.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 max-w-[240px] gap-1.5"
                      aria-label={t('experiments.comparison.dimension.ariaLabel')}
                    >
                      <span className="truncate">{qualityDimensionLabel}</span>
                      <ChevronDown className="size-3.5 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[240px]">
                    <DropdownMenuItem
                      onClick={() => setRequestedQualityDimension(EXPERIMENT_OVERALL_QUALITY_DIMENSION)}
                    >
                      {t('experiments.comparison.dimension.overall')}
                    </DropdownMenuItem>
                    {qualityClassLabels.map((label) => (
                      <DropdownMenuItem key={label} onClick={() => setRequestedQualityDimension(label)}>
                        <span className="min-w-0 truncate font-mono text-[12px]">{label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null
            }
          />
          <MetricGroup
            title={t('experiments.comparison.engineeringMetrics')}
            metricKeys={EXPERIMENT_ENGINEERING_METRIC_KEYS}
            experiments={selectedExperiments}
          />
        </div>
      ) : (
        <div className="border-t px-4 py-10 text-center text-[12px] text-muted-foreground">
          {t('experiments.comparison.empty')}
        </div>
      )}
    </div>
  );
}
