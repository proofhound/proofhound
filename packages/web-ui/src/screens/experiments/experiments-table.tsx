'use client';

import { useRouter } from '../../hooks/use-router';
import type { ReactNode } from 'react';
import { CopyPlus, Loader2, Rocket, Sparkles, Trash2 } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableActionRow,
  UnusedImagesBadge,
} from '@proofhound/ui';
import type { TableColumn, TableActionDescriptor } from '@proofhound/ui';
import { useI18n } from '../../i18n';

import { progressLabel, progressTimingLabel } from './experiment-progress';
import { appendNumberSearchParam, appendSearchParam, buildRepeatExperimentHref } from './experiment-repeat-href';
import { hasImagePromptVariable, type ExperimentSummary } from './experiment-view-model';
import {
  ExperimentStatusBadge,
  Lineage,
  ProgressBar,
  SelectionBox,
  formatNumber,
  formatPercent,
} from './experiment-ui';

export const EXPERIMENT_TABLE_COLUMNS: TableColumn[] = [
  { key: 'select', width: 'narrow', sticky: 'left' },
  { key: 'name', width: 'wide', sticky: 'left' },
  { key: 'prompt', width: 'normal' },
  { key: 'dataset', width: 'normal' },
  { key: 'model', width: 'normal' },
  { key: 'status', width: 'compact' },
  { key: 'progress', width: 'flex', minPx: 220 },
  { key: 'actions', width: 'normal', sticky: 'right' },
];

function getOptimizationNewHref(experiment: ExperimentSummary): string {
  const params = new URLSearchParams();
  params.set('origin', 'experiment');
  params.set('sourceExperimentId', experiment.id);
  params.set('sourceExperimentName', experiment.name);
  if (experiment.promptId) params.set('promptId', experiment.promptId);
  if (experiment.promptVersionId) params.set('promptVersionId', experiment.promptVersionId);
  if (experiment.datasetId) params.set('datasetId', experiment.datasetId);
  if (experiment.modelId) params.set('modelId', experiment.modelId);
  return `/optimizations/new?${params.toString()}`;
}

function getReleaseNewHref(experiment: ExperimentSummary): string {
  const params = new URLSearchParams();
  appendSearchParam(params, 'eventType', 'from_experiment');
  appendSearchParam(params, 'sourceExperimentId', experiment.id);
  appendSearchParam(params, 'sourceExperimentName', experiment.name);
  appendSearchParam(params, 'promptId', experiment.promptId);
  appendSearchParam(params, 'promptVersionId', experiment.promptVersionId);
  appendSearchParam(params, 'modelId', experiment.modelId);
  appendNumberSearchParam(params, 'rpmLimit', experiment.runConfig.rpmLimit);
  appendNumberSearchParam(params, 'tpmLimit', experiment.runConfig.tpmLimit);
  appendNumberSearchParam(params, 'concurrency', experiment.runConfig.concurrency);
  appendNumberSearchParam(params, 'temperature', experiment.runConfig.temperature);
  return `/releases/new?${params.toString()}`;
}

function ExperimentRowActions({
  experiment,
  projectId,
  pending,
  onDelete,
}: {
  experiment: ExperimentSummary;
  projectId: string;
  pending?: boolean;
  onDelete: (experimentId: string) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const actions: TableActionDescriptor[] = [
    {
      key: 'optimization',
      label: t('experiments.action.startOptimization'),
      icon: Sparkles,
      onClick: () => router.push(getOptimizationNewHref(experiment)),
      disabled: pending,
    },
    {
      key: 'release',
      label: t('experiments.action.publish'),
      icon: Rocket,
      onClick: () => router.push(getReleaseNewHref(experiment)),
      disabled: pending,
    },
    {
      key: 'repeat',
      label: t('experiments.action.copyNew'),
      icon: CopyPlus,
      onClick: () => router.push(buildRepeatExperimentHref(projectId, experiment)),
      disabled: pending,
    },
    {
      key: 'delete',
      label: t('experiments.action.delete'),
      icon: pending ? Loader2 : Trash2,
      onClick: () => onDelete(experiment.id),
      destructive: true,
      disabled: pending,
      loading: pending,
    },
  ];

  return <TableActionRow actions={actions} moreLabel={t('experiments.action.more')} />;
}

export interface ExperimentsTableProps {
  experiments: ExperimentSummary[];
  projectId: string;
  selectedIds: string[];
  headState: 'off' | 'some' | 'all';
  pendingExperimentId: string | null;
  emptyMessage?: ReactNode;
  onToggleSelected: (experimentId: string) => void;
  onToggleAll: () => void;
  onDelete: (experimentId: string) => void;
  onRowClick: (experiment: ExperimentSummary) => void;
}

export function ExperimentsTable({
  experiments,
  projectId,
  selectedIds,
  headState,
  pendingExperimentId,
  emptyMessage,
  onToggleSelected,
  onToggleAll,
  onDelete,
  onRowClick,
}: ExperimentsTableProps) {
  const { t } = useI18n();

  return (
    <Table columns={EXPERIMENT_TABLE_COLUMNS} containerTestId="experiments-table-view">
      <TableHeader>
        <TableRow>
          <TableHead column="select">
            <SelectionBox checked={headState === 'all'} ariaLabel={t('experiments.selectAll')} onClick={onToggleAll} />
          </TableHead>
          <TableHead column="name">{t('experiments.table.name')}</TableHead>
          <TableHead column="prompt">{t('experiments.table.prompt')}</TableHead>
          <TableHead column="dataset">{t('experiments.table.dataset')}</TableHead>
          <TableHead column="model">{t('experiments.table.model')}</TableHead>
          <TableHead column="status">{t('experiments.table.status')}</TableHead>
          <TableHead column="progress">{t('experiments.table.progress')}</TableHead>
          <TableHead column="actions" className="text-right">
            {t('common.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {experiments.length === 0 ? (
          <TableEmpty>{emptyMessage}</TableEmpty>
        ) : (
          experiments.map((experiment) => {
            const selected = selectedIds.includes(experiment.id);
            const percent = experiment.progressTotal
              ? Number(formatPercent(experiment.progressDone, experiment.progressTotal, 1))
              : 0;
            return (
              <TableRow
                key={experiment.id}
                selected={selected}
                onClick={() => onRowClick(experiment)}
                className={experiment.isArchived ? 'opacity-65' : undefined}
              >
                <TableCell column="select">
                  <SelectionBox
                    checked={selected}
                    ariaLabel={`${t('experiments.select')} ${experiment.name}`}
                    onClick={() => onToggleSelected(experiment.id)}
                  />
                </TableCell>
                <TableCell column="name">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-[13.5px] font-semibold">{experiment.name}</span>
                      {experiment.isArchived ? (
                        <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {t('experiments.archived')}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{experiment.description}</div>
                  </div>
                </TableCell>
                <TableCell column="prompt">
                  <Lineage primary={experiment.promptName} secondary={experiment.promptVersion} />
                </TableCell>
                <TableCell column="dataset">
                  <div className="flex min-w-0 items-center gap-2">
                    <Lineage
                      primary={experiment.datasetName}
                      secondary={`${formatNumber(experiment.datasetSamples)} ${t('experiments.sampleSuffix')}`}
                    />
                    {experiment.datasetHasImages && !hasImagePromptVariable(experiment.promptVariableTypes ?? []) ? (
                      <UnusedImagesBadge
                        size="sm"
                        tooltip={t('experiments.unusedImagesTooltip')}
                        aria-label={t('experiments.unusedImagesTooltip')}
                      />
                    ) : null}
                  </div>
                </TableCell>
                <TableCell column="model">
                  <span className="block truncate font-mono text-[12.5px] text-foreground">{experiment.modelName}</span>
                </TableCell>
                <TableCell column="status">
                  <ExperimentStatusBadge status={experiment.status} />
                </TableCell>
                <TableCell column="progress">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <ProgressBar
                      status={experiment.status}
                      percent={percent}
                      label={progressLabel(experiment, percent)}
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {progressTimingLabel(t, experiment)}
                    </span>
                  </div>
                </TableCell>
                <TableCell column="actions" className="text-right">
                  <ExperimentRowActions
                    experiment={experiment}
                    projectId={projectId}
                    pending={pendingExperimentId === experiment.id}
                    onDelete={onDelete}
                  />
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
