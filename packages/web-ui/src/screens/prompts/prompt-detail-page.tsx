'use client';

import {
  promptVersionLabelNameSchema,
  type PromptDeletionImpactDto,
  type PromptDeletionImpactItemDto,
} from '@proofhound/shared';
import { Link } from '../../components/navigation/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from '../../hooks/use-router';
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  FlaskConical,
  GitCompareArrows,
  Info,
  Lock,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PlatformLoaderOverlay,
  DetailPageSkeleton,
  Skeleton,
  TableActionRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  ModalityIcon,
  ModalityIconGroup,
  UnusedImagesBadge,
  cn,
} from '@proofhound/ui';
import type { TableActionDescriptor, ModalityKind } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { PromptDiffSplitView, PromptVariableModalityBadges } from '../../components';
import { useDatasets } from '../../hooks';
import {
  useCreatePromptDraftVersion,
  useDeletePromptDraftVersion,
  useDateTimeFormatter,
  usePrompt,
  usePromptMetrics,
  usePromptVersionDeleteImpact,
  useUpdatePrompt,
  useUpdatePromptDraftVersion,
  useUpdatePromptVersionLabel,
} from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { PromptLanguageSelect, type PromptLanguage } from '../../components';
import { useI18n, type TranslationKey } from '../../i18n';
import { DATASET_MODALITY_LABEL_KEYS, type DatasetModality, type ProjectDataset } from '../datasets/dataset-types';
import { toProjectDataset } from '../datasets/dataset-mappers';
import {
  deriveJudgmentField,
  toProjectPrompt,
  upsertJudgmentField,
  type ProjectPrompt,
  type PromptOutputField,
  type PromptVariable,
  type PromptVersion,
} from './prompt-model';
import { toPromptVariablesFromDataset } from './prompt-dataset-variables';
import { PromptBodyEditor, type PromptBodyEditorHandle } from './prompt-body-editor';
import { composePromptPreview } from './prompt-preview';
import { countPromptVariableUsages, renderPromptPreviewParts } from './prompt-preview-parts';
import { StatusBadge, VARIABLE_TONE_CLASSES, VariableToken, hasImageVariable } from './prompt-ui';

type DetailTab = 'versions' | 'metrics';
type PromptMainTab = 'prompt' | 'config';
type PendingNavigation =
  | { kind: 'href'; href: string; external: boolean }
  | { kind: 'back' }
  | { kind: 'version'; versionId: string }
  | { kind: 'blankVersion' }
  | { kind: 'copyVersion'; sourceVersionId: string };
type ActionMessage = { kind: 'success' | 'error'; text: string; autoDismiss?: boolean };

const LABEL_ACTION_MESSAGE_DISMISS_MS = 3000;

const PROMPT_VERSION_SYSTEM_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  latest: 'prompts.labels.system.latest',
  canary: 'prompts.labels.system.canary',
  production: 'prompts.labels.system.production',
};

const TAB_LABEL_KEYS: Record<DetailTab, TranslationKey> = {
  versions: 'prompts.detail.tab.versions',
  metrics: 'prompts.detail.tab.metrics',
};

const PROMPT_MAIN_TAB_LABEL_KEYS: Record<PromptMainTab, TranslationKey> = {
  prompt: 'prompts.detail.subtab.prompt',
  config: 'prompts.detail.subtab.config',
};

function resolveDetailTab(value: string | null): DetailTab {
  return value === 'metrics' ? 'metrics' : 'versions';
}

function resolvePromptMainTab(value: string | null): PromptMainTab {
  return value === 'config' ? 'config' : 'prompt';
}

const OUTPUT_SCHEMA_PANEL_STRICT_JSON_LABEL: Record<PromptLanguage, string> = {
  'zh-CN': '请严格输出 JSON：',
  'en-US': 'Return strict JSON:',
};

const UNSAVED_HISTORY_GUARD_KEY = '__proofhoundPromptUnsavedGuard';

const PROMPT_MODALITY_LABEL_KEYS: Record<ModalityKind, TranslationKey> = {
  text: 'prompts.variableType.text',
  image: 'prompts.variableType.image',
  number: 'prompts.variableType.number',
};

const IMPACT_LABEL_KEYS: Record<PromptDeletionImpactItemDto['kind'], TranslationKey> = {
  release_line: 'prompts.deleteImpactReleaseLine',
  experiment: 'prompts.deleteImpactExperiment',
  optimization: 'prompts.deleteImpactOptimization',
};

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
    <div className="space-y-2">
      <div className="text-sm font-medium">
        {t('prompts.deleteImpactTitle')} <span className="font-mono">{items.length}</span>
      </div>
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
    </div>
  );
}

interface PromptDatasetOption {
  id: string;
  name: string;
  description: string;
  modalities: DatasetModality[];
  hasImages: boolean;
  sampleCount: number;
  fieldCount: number;
  updatedAt: string;
  status: 'active' | 'archived';
}

function DatasetSelectionPanel({
  variables,
  datasets,
  selectedDatasetId,
  onSelectDataset,
  readOnly = false,
}: {
  variables: PromptVariable[];
  datasets: ProjectDataset[];
  selectedDatasetId: string | null;
  onSelectDataset: (datasetId: string) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [datasetSearch, setDatasetSearch] = useState('');
  const selectedCount = variables.filter((variable) => variable.selected).length;
  const datasetOptions = useMemo<PromptDatasetOption[]>(() => {
    return datasets
      .filter((dataset) => dataset.status === 'active')
      .map((dataset) => ({
        id: dataset.id,
        name: dataset.name,
        description: dataset.description,
        modalities: dataset.modalities,
        hasImages: dataset.hasImages,
        sampleCount: dataset.sampleCount,
        fieldCount: dataset.fieldCount,
        updatedAt: dataset.updatedAt,
        status: dataset.status,
      }));
  }, [datasets]);
  const filteredDatasets = useMemo(() => {
    const query = datasetSearch.trim().toLowerCase();
    if (!query) return datasetOptions;
    return datasetOptions.filter((dataset) =>
      `${dataset.name} ${dataset.description} ${dataset.id}`.toLowerCase().includes(query),
    );
  }, [datasetOptions, datasetSearch]);
  const selectedDataset = datasetOptions.find((dataset) => dataset.id === selectedDatasetId) ?? null;
  const isUnbound = !selectedDatasetId;

  return (
    <>
      {isUnbound && (
        <div
          className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
          role="alert"
          data-testid="prompt-dataset-unbound-warning"
        >
          {t('prompts.detail.datasetUnboundWarning')}
        </div>
      )}
      <section
        className="mb-4 overflow-hidden rounded-lg border bg-card"
        aria-label={t('prompts.detail.boundDataset')}
        data-testid="prompt-dataset-selector"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold">
              <Database className="size-4 text-[var(--status-pending-fg)]" />
              {t('prompts.detail.boundDataset')}
              {selectedDataset?.hasImages && !hasImageVariable(variables) && (
                <UnusedImagesBadge
                  size="sm"
                  tooltip={t('prompts.detail.unusedImagesTooltip')}
                  aria-label={t('prompts.detail.unusedImagesTooltip')}
                />
              )}
            </div>
            <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
              {selectedDataset
                ? t('prompts.detail.selectedDataset').replace('{dataset}', selectedDataset.name)
                : t('prompts.detail.noDatasetSelected')}
              {' · '}
              {t('prompts.detail.datasetFieldSummary')
                .replace('{fieldCount}', String(selectedDataset?.fieldCount ?? 0))
                .replace('{selectedCount}', String(selectedCount))}
            </div>
          </div>
          <div className="relative w-full sm:w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={datasetSearch}
              onChange={(event) => setDatasetSearch(event.target.value)}
              placeholder={t('prompts.detail.datasetSearchPlaceholder')}
              className="h-9 pl-8 text-xs"
            />
          </div>
        </div>
        <div className="max-h-[190px] overflow-auto p-2">
          {filteredDatasets.length > 0 ? (
            <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {filteredDatasets.map((dataset) => {
                const selected = dataset.id === selectedDatasetId;
                return (
                  <button
                    key={dataset.id}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onSelectDataset(dataset.id)}
                    className={cn(
                      'flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/40',
                      selected ? 'border-primary bg-primary/5' : 'border-border bg-background',
                      readOnly && 'cursor-not-allowed opacity-60',
                    )}
                    aria-pressed={selected}
                  >
                    <span
                      className={cn(
                        'mt-0.5 inline-flex size-3.5 flex-none items-center justify-center rounded-full border',
                        selected ? 'border-primary bg-primary/10' : 'border-border bg-background',
                      )}
                      aria-hidden="true"
                    >
                      {selected && <span className="size-1.5 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px] font-semibold">{dataset.name}</span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                        {dataset.description}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {dataset.sampleCount.toLocaleString()} {t('prompts.detail.samples')}
                        </span>
                        <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {t('prompts.detail.datasetFields').replace('{count}', String(dataset.fieldCount))}
                        </span>
                        <ModalityIconGroup
                          kinds={dataset.modalities}
                          size="sm"
                          tooltips={dataset.modalities.reduce<Partial<Record<DatasetModality, string>>>(
                            (acc, modality) => {
                              acc[modality] = t(DATASET_MODALITY_LABEL_KEYS[modality]);
                              return acc;
                            },
                            {},
                          )}
                        />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
              {t('prompts.detail.datasetNoMatch')}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function getNextOutputFieldKey(fields: PromptOutputField[]) {
  let index = fields.length + 1;
  const existingKeys = new Set(fields.map((field) => field.key));
  while (existingKeys.has(`field_${index}`)) index += 1;
  return `field_${index}`;
}

function OutputSchemaPanel({
  fields,
  promptLanguage,
  onFieldsChange,
  readOnly = false,
}: {
  fields: PromptOutputField[];
  promptLanguage: PromptLanguage;
  onFieldsChange: (fields: PromptOutputField[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const updateField = (index: number, patch: Partial<PromptOutputField>) => {
    onFieldsChange(
      fields.map((field, fieldIndex) => (fieldIndex === index && !field.isJudgment ? { ...field, ...patch } : field)),
    );
  };
  const addField = () => {
    onFieldsChange([
      ...fields,
      {
        key: getNextOutputFieldKey(fields),
        value: '',
        isJudgment: false,
      },
    ]);
  };
  const removeField = (index: number) => {
    onFieldsChange(fields.filter((field, fieldIndex) => !(fieldIndex === index && !field.isJudgment)));
  };

  return (
    <div className="border-t bg-muted/55">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <CheckCircle2 className="size-3.5 text-[var(--status-canary-fg)]" />
        <span className="text-[12.5px] font-semibold text-muted-foreground">{t('prompts.detail.outputSchema')}</span>
        <span className="text-[11px] text-muted-foreground">{t('prompts.detail.outputSchemaHelp')}</span>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10.5px] text-[var(--status-running-fg)]">
          <span className="size-1 rounded-full bg-[var(--status-running-dot)]" />
          {t('prompts.detail.schemaLinked')}
        </span>
      </div>
      <div className="px-4 pb-3 font-mono text-[12px] leading-7 text-muted-foreground">
        <div>
          {OUTPUT_SCHEMA_PANEL_STRICT_JSON_LABEL[promptLanguage] ?? OUTPUT_SCHEMA_PANEL_STRICT_JSON_LABEL['zh-CN']}
        </div>
        <div>{'{'}</div>
        {fields.map((field, index) => (
          <div
            key={index}
            className={cn(
              'my-1 rounded-md border bg-background px-3 py-2',
              field.isJudgment &&
                'border-l-2 border-l-[var(--status-pending-bd)] bg-[color-mix(in_srgb,var(--status-pending-bg)_60%,transparent)]',
            )}
            data-testid="prompt-output-field-row"
            data-judgment={field.isJudgment ? 'true' : 'false'}
          >
            <div className="grid gap-2 lg:grid-cols-[minmax(140px,0.6fr)_minmax(200px,1fr)_32px] lg:items-center">
              <Input
                value={field.key}
                onChange={(event) => updateField(index, { key: event.target.value })}
                disabled={field.isJudgment || readOnly}
                aria-label={t('prompts.detail.outputFieldKey')}
                placeholder={t('prompts.detail.outputFieldKeyPlaceholder')}
                className="h-8 font-mono text-xs"
                data-testid={field.isJudgment ? 'prompt-output-judgment-key' : 'prompt-output-field-key'}
              />
              <Input
                value={field.value}
                onChange={(event) => updateField(index, { value: event.target.value })}
                disabled={field.isJudgment || readOnly}
                aria-label={t('prompts.detail.outputFieldValue')}
                placeholder={t('prompts.detail.outputFieldValuePlaceholder')}
                className="h-8 font-mono text-xs"
                data-testid={field.isJudgment ? 'prompt-output-judgment-value' : 'prompt-output-field-value'}
              />
              {field.isJudgment ? (
                <span
                  className="inline-flex h-8 items-center justify-center text-muted-foreground"
                  aria-label={t('prompts.detail.outputFieldJudgmentReadonly')}
                  title={t('prompts.detail.outputFieldJudgmentReadonly')}
                >
                  <Lock className="size-3.5" />
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  aria-label={t('prompts.detail.deleteOutputField')}
                  onClick={() => removeField(index)}
                  disabled={readOnly}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <div className="py-1 pl-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-dashed px-2 text-xs"
              onClick={addField}
            >
              <Plus className="size-3.5" />
              {t('prompts.detail.addOutputField')}
            </Button>
          </div>
        )}
        <div>{'}'}</div>
      </div>
    </div>
  );
}

const IMAGE_VARIABLE_TYPES = new Set<PromptVariable['type']>(['image', 'image_url', 'image_base64']);

function toPromptVariableModalityKind(type: PromptVariable['type']): ModalityKind {
  if (type === 'number') return 'number';
  if (IMAGE_VARIABLE_TYPES.has(type)) return 'image';
  return 'text';
}

function VariableRow({
  variable,
  usageCount,
  onInsertVariable,
}: {
  variable: PromptVariable;
  usageCount: number;
  onInsertVariable?: (name: string) => void;
}) {
  const { t } = useI18n();
  const isImage = IMAGE_VARIABLE_TYPES.has(variable.type);
  const canInsert = !isImage && onInsertVariable !== undefined;
  const isUsed = usageCount > 0;
  const modalityKind = toPromptVariableModalityKind(variable.type);
  const modalityLabel = t(PROMPT_MODALITY_LABEL_KEYS[modalityKind]);
  const usageLabel = t('prompts.detail.variables.usageCount').replace('{count}', String(usageCount));
  const addToPromptLabel = t('prompts.detail.variables.addToPrompt');
  const rowClassName = cn(
    'group flex w-full items-center gap-2.5 border-b border-l-2 px-4 py-2.5 text-left transition-colors',
    isUsed ? 'border-l-primary bg-primary/5 hover:bg-primary/10' : 'border-l-transparent hover:bg-accent',
    canInsert &&
      'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  );

  const rowContent = (
    <>
      <VariableToken variable={variable} dimmed={!isUsed} />
      <ModalityIcon kind={modalityKind} size="sm" tooltip={modalityLabel} aria-label={modalityLabel} />
      <span className="ml-auto inline-flex min-w-[116px] items-center justify-end gap-1.5">
        <span className="truncate text-[10.5px] text-muted-foreground">{usageLabel}</span>
        {canInsert && (
          <TooltipProvider delayDuration={160}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-focus:opacity-100">
                  <Plus className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">{addToPromptLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </>
  );

  if (canInsert) {
    return (
      <button
        type="button"
        className={rowClassName}
        aria-label={`${addToPromptLabel} · ${variable.name} · ${usageLabel}`}
        onClick={() => onInsertVariable?.(variable.name)}
        data-testid={`prompt-variable-insert-${variable.name}`}
      >
        {rowContent}
      </button>
    );
  }

  return <div className={rowClassName}>{rowContent}</div>;
}

function VariablesPanel({
  variables,
  usageCounts,
  onInsertVariable,
  hasBoundDataset,
  hasDatasets,
  onRequestDatasetBinding,
  onRequestDatasetUpload,
}: {
  variables: PromptVariable[];
  usageCounts: ReadonlyMap<string, number>;
  onInsertVariable?: (name: string) => void;
  hasBoundDataset: boolean;
  hasDatasets: boolean;
  onRequestDatasetBinding: () => void;
  onRequestDatasetUpload: () => void;
}) {
  const { t } = useI18n();
  const usedCount = variables.filter((variable) => (usageCounts.get(variable.name) ?? 0) > 0).length;
  const textVars = variables.filter((variable) => !IMAGE_VARIABLE_TYPES.has(variable.type));
  const imageVars = variables.filter((variable) => IMAGE_VARIABLE_TYPES.has(variable.type));
  const datasetActionLabel = hasDatasets
    ? t('prompts.detail.variables.bindDataset')
    : t('prompts.detail.variables.uploadDataset');

  const imageExample = `{
  "role": "user",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "{{image_url}}" } }
  ]
}`;

  return (
    <aside className="flex min-w-0 flex-col lg:border-l">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Pencil className="size-3.5 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">{t('prompts.detail.variables')}</span>
        <span className="text-[11px] text-muted-foreground">
          · {usedCount} / {variables.length}
        </span>
        {!hasBoundDataset && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={hasDatasets ? onRequestDatasetBinding : onRequestDatasetUpload}
            data-testid="prompt-variables-bind-dataset"
          >
            {hasDatasets ? <Database className="size-3.5" /> : <Upload className="size-3.5" />}
            {datasetActionLabel}
          </Button>
        )}
      </div>
      <div className="max-h-[520px] flex-1 overflow-auto" data-testid="prompt-variables-panel">
        {textVars.length > 0 && (
          <section data-testid="prompt-variables-text-group">
            <header className="flex items-center gap-2 bg-muted/35 px-4 py-1.5 text-[10.5px] font-medium text-muted-foreground">
              <span>{t('prompts.detail.variables.textGroup')}</span>
              <span className="font-mono">· {textVars.length}</span>
            </header>
            {textVars.map((variable) => (
              <VariableRow
                key={variable.name}
                variable={variable}
                usageCount={usageCounts.get(variable.name) ?? 0}
                onInsertVariable={onInsertVariable}
              />
            ))}
          </section>
        )}
        {imageVars.length > 0 && (
          <section data-testid="prompt-variables-image-group">
            <header className="flex items-center gap-2 bg-muted/35 px-4 py-1.5 text-[10.5px] font-medium text-muted-foreground">
              <span>{t('prompts.detail.variables.imageGroup')}</span>
              <span className="font-mono">· {imageVars.length}</span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      aria-label={t('prompts.detail.variables.imageHint')}
                      data-testid="prompt-variables-image-info"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[320px] text-left">
                    <p className="mb-2 text-[11.5px] leading-relaxed">{t('prompts.detail.variables.imageHint')}</p>
                    <pre className="overflow-auto whitespace-pre rounded bg-muted/40 p-2 font-mono text-[10.5px] text-foreground">
                      {imageExample}
                    </pre>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </header>
            {imageVars.map((variable) => (
              <VariableRow key={variable.name} variable={variable} usageCount={usageCounts.get(variable.name) ?? 0} />
            ))}
          </section>
        )}
      </div>
      <div className="border-t bg-muted/25 px-4 py-3 text-[11.5px] text-muted-foreground">
        {t('prompts.detail.variablesFooter')}
      </div>
    </aside>
  );
}

function EditorTab({
  body,
  promptLanguage,
  variables,
  outputFields,
  onBodyChange,
  onOutputFieldsChange,
  hasBoundDataset,
  hasDatasets,
  onRequestDatasetBinding,
  onRequestDatasetUpload,
  dirty,
  saveError,
  isSaving,
  onCancelChanges,
  onSaveChanges,
  readOnly,
}: {
  body: string;
  promptLanguage: PromptLanguage;
  variables: PromptVariable[];
  outputFields: PromptOutputField[];
  onBodyChange: (value: string) => void;
  onOutputFieldsChange: (fields: PromptOutputField[]) => void;
  hasBoundDataset: boolean;
  hasDatasets: boolean;
  onRequestDatasetBinding: () => void;
  onRequestDatasetUpload: () => void;
  dirty: boolean;
  saveError: string | null;
  isSaving: boolean;
  onCancelChanges: () => void;
  onSaveChanges: () => Promise<boolean>;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const editorRef = useRef<PromptBodyEditorHandle | null>(null);
  const lineCount = Math.max(1, body.split('\n').length);
  const tokenEstimate = Math.max(1, Math.round(body.length / 4));
  const fullPreview = useMemo(
    () =>
      composePromptPreview({
        body,
        outputFields,
        promptLanguage,
      }),
    [body, outputFields, promptLanguage],
  );
  const previewParts = useMemo(() => renderPromptPreviewParts(fullPreview, variables), [fullPreview, variables]);
  const variableUsageCounts = useMemo(() => countPromptVariableUsages(body, variables), [body, variables]);

  const insertVariable = useCallback((name: string) => {
    editorRef.current?.insertVariable(name);
  }, []);

  return (
    <div data-testid="prompt-editor-tab">
      <section
        className="mb-4 overflow-hidden rounded-lg border bg-card"
        aria-label={t('prompts.detail.editorSurface')}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/35 px-4 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">{t('prompts.detail.editorSurface')}</span>
          {!readOnly && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {saveError && <span className="text-xs text-destructive">{saveError}</span>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!dirty || isSaving}
                onClick={onCancelChanges}
              >
                <X className="size-3.5" />
                {t('prompts.detail.cancelChanges')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={!dirty || isSaving}
                onClick={() => void onSaveChanges()}
                data-testid="prompt-version-save"
              >
                <Save className="size-3.5" />
                {isSaving ? t('common.savePending') : t('prompts.detail.saveChanges')}
              </Button>
            </div>
          )}
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0" data-testid="prompt-version-body">
            <div className="flex items-center gap-2 border-b px-4 py-2">
              <Pencil className="size-3.5 text-muted-foreground" />
              <span className="text-[12.5px] font-semibold">{t('prompts.detail.bodyTemplate')}</span>
              <span className="text-[11.5px] text-muted-foreground">{t('prompts.detail.bodyTemplateHelp')}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                L {lineCount} · token ≈ {tokenEstimate}
              </span>
            </div>
            <PromptBodyEditor
              ref={editorRef}
              value={body}
              onChange={onBodyChange}
              variables={variables}
              placeholder={t('prompts.detail.bodyTemplatePlaceholder')}
              readOnly={readOnly}
            />
            <OutputSchemaPanel
              fields={outputFields}
              promptLanguage={promptLanguage}
              onFieldsChange={onOutputFieldsChange}
              readOnly={readOnly}
            />
          </div>
          <VariablesPanel
            variables={variables}
            usageCounts={variableUsageCounts}
            onInsertVariable={readOnly ? undefined : insertVariable}
            hasBoundDataset={hasBoundDataset}
            hasDatasets={hasDatasets}
            onRequestDatasetBinding={onRequestDatasetBinding}
            onRequestDatasetUpload={onRequestDatasetUpload}
          />
        </div>
      </section>
      <section
        className="mb-4 overflow-hidden rounded-lg border bg-card"
        aria-label={t('prompts.detail.fullPromptPreview')}
        data-testid="prompt-full-preview"
      >
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/35 px-4 py-2.5">
          <Eye className="size-3.5 text-muted-foreground" />
          <span className="text-[12.5px] font-semibold">{t('prompts.detail.fullPromptPreview')}</span>
          <span className="text-[11px] text-muted-foreground">{t('prompts.detail.fullPromptPreviewHelp')}</span>
        </div>
        <pre className="overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11.5px] leading-6 text-foreground">
          {previewParts.map((part, index) => {
            if (part.kind === 'text') return <span key={index}>{part.value}</span>;
            const tone = part.varType
              ? VARIABLE_TONE_CLASSES[part.varType]
              : 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';
            return (
              <span
                key={index}
                className={cn('inline rounded border px-1 font-mono text-[11px]', tone)}
                data-variable-name={part.name}
              >
                {`{{${part.name}}}`}
              </span>
            );
          })}
        </pre>
      </section>
    </div>
  );
}

function ConfigTab({
  datasets,
  variables,
  promptLanguage,
  onPromptLanguageChange,
  selectedDatasetId,
  onSelectDataset,
  saveError,
  readOnly,
}: {
  datasets: ProjectDataset[];
  variables: PromptVariable[];
  promptLanguage: PromptLanguage;
  onPromptLanguageChange: (value: PromptLanguage) => void;
  selectedDatasetId: string | null;
  onSelectDataset: (datasetId: string) => void;
  saveError: string | null;
  readOnly: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-4" data-testid="prompt-config-tab">
      {saveError && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
          role="alert"
        >
          {saveError}
        </div>
      )}
      <section className="overflow-hidden rounded-lg border bg-card" aria-label={t('prompts.detail.subtab.config')}>
        <div className="border-b bg-muted/35 px-4 py-2.5 text-xs font-medium text-muted-foreground">
          {t('promptLanguage.label')}
        </div>
        <div className="px-4 py-3">
          <PromptLanguageSelect
            value={promptLanguage}
            onChange={onPromptLanguageChange}
            disabled={readOnly}
            helpKey="prompts.detail.promptLanguageHelp"
            className="max-w-[380px]"
            triggerClassName="h-8"
          />
        </div>
      </section>
      <DatasetSelectionPanel
        variables={variables}
        datasets={datasets}
        selectedDatasetId={selectedDatasetId}
        onSelectDataset={onSelectDataset}
        readOnly={readOnly}
      />
    </div>
  );
}

function getVersionLabel(version: PromptVersion) {
  return `v${version.version}`;
}

function renderVersionPromptPreview(version: PromptVersion | undefined) {
  if (!version) return '';
  return composePromptPreview({
    body: version.body,
    outputFields: version.outputFields,
    promptLanguage: version.promptLanguage,
  });
}

function serializePromptVariables(variables: PromptVariable[]) {
  return JSON.stringify(
    variables.map((variable) => ({
      name: variable.name,
      type: variable.type,
      required: variable.required,
      datasetField: variable.datasetField,
      description: variable.description,
    })),
  );
}

function serializeOutputFields(fields: PromptOutputField[]) {
  return JSON.stringify(
    fields.map((field) => ({
      key: field.key,
      value: field.value,
      isJudgment: field.isJudgment,
    })),
  );
}

function getDatasetJudgmentField(dataset: ProjectDataset | null): PromptOutputField {
  const expectedField = dataset?.fields.find((field) => field.role === 'expected');
  const labels = dataset?.categoryProfile.slices.map((slice) => slice.label) ?? [];
  return deriveJudgmentField({
    expectedOutputFieldName: expectedField?.name ?? null,
    categoryLabels: labels,
  });
}

function getPromptVersionSyncKey({
  promptId,
  versionId,
  body,
  promptLanguage,
  variables,
  outputFields,
}: {
  promptId: string;
  versionId: string;
  body: string;
  promptLanguage: PromptLanguage;
  variables: PromptVariable[];
  outputFields: PromptOutputField[];
}) {
  return `${promptId}:${versionId}:${body}:${promptLanguage}:${serializePromptVariables(variables)}:${serializeOutputFields(
    outputFields,
  )}`;
}

function VersionLabelPill({ label, onRemove }: { label: PromptVersion['labels'][number]; onRemove?: () => void }) {
  const { t } = useI18n();
  const system = label.type === 'system';
  const displayName = formatPromptVersionLabel(label, t);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium',
        system
          ? 'border-[var(--status-running-bd)] bg-[var(--status-running-bg)] text-[var(--status-running-fg)]'
          : 'border-border bg-muted/50 text-muted-foreground',
      )}
    >
      {displayName}
      {onRemove && (
        <button
          type="button"
          className="inline-flex size-3.5 items-center justify-center rounded-sm hover:bg-background/70"
          aria-label={t('prompts.labels.remove').replace('{label}', displayName)}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}

function formatPromptVersionLabel(label: PromptVersion['labels'][number], t: (key: TranslationKey) => string) {
  const key = PROMPT_VERSION_SYSTEM_LABEL_KEYS[label.name];
  return key ? t(key) : label.name;
}

function VersionSidebar({
  prompt,
  activeVersionId,
  onActivateVersion,
  onRequestBlankVersion,
  onRequestCopy,
  onRequestDelete,
  onUpdateLabel,
  isCopying,
  isDeleting,
  isUpdatingLabel,
  initialVersionId,
}: {
  prompt: ProjectPrompt;
  activeVersionId: string | null;
  onActivateVersion: (versionId: string) => void;
  onRequestBlankVersion: () => void;
  onRequestCopy: (versionId: string) => void;
  onRequestDelete: (versionId: string) => void;
  onUpdateLabel: (label: string, versionId: string | null) => void;
  isCopying: boolean;
  isDeleting: boolean;
  isUpdatingLabel: boolean;
  initialVersionId?: string | null;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const [selectedVersions, setSelectedVersions] = useState<number[]>([]);
  const [initialVersionAppliedId, setInitialVersionAppliedId] = useState<string | null>(null);
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [versionSearch, setVersionSearch] = useState('');
  if (initialVersionId && initialVersionAppliedId !== initialVersionId) {
    const targetVersion = prompt.versions.find((v) => v.id === initialVersionId);
    if (targetVersion) {
      setInitialVersionAppliedId(initialVersionId);
      setSelectedVersions([targetVersion.version]);
    }
  }

  const filteredVersions = useMemo(() => {
    const query = versionSearch.trim().toLowerCase();
    if (!query) return prompt.versions;
    return prompt.versions.filter((version) => {
      const haystack = [
        getVersionLabel(version),
        version.status,
        version.author,
        version.createdAt,
        ...version.labels.map((label) => label.name),
        ...version.labels.map((label) => formatPromptVersionLabel(label, t)),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [prompt.versions, t, versionSearch]);

  const stopRowClick = useCallback((event: React.MouseEvent | React.ChangeEvent) => {
    event.stopPropagation();
  }, []);

  const compareVersions = useMemo(() => {
    const selected = prompt.versions.filter((version) => selectedVersions.includes(version.version));
    return selected.slice(0, 2);
  }, [prompt.versions, selectedVersions]);
  const fromVersion = compareVersions[1];
  const toVersion = compareVersions[0];
  const fromPromptPreview = useMemo(() => renderVersionPromptPreview(fromVersion), [fromVersion]);
  const toPromptPreview = useMemo(() => renderVersionPromptPreview(toVersion), [toVersion]);
  const toggleVersion = (version: number) => {
    setSelectedVersions((current) => {
      if (current.includes(version)) return current.filter((item) => item !== version);
      return [version, ...current].slice(0, 2);
    });
  };

  return (
    <aside
      className="flex min-h-[640px] flex-col border-b bg-background lg:min-h-[calc(100vh-240px)] lg:border-b-0 lg:border-r"
      data-testid="prompt-version-sidebar"
    >
      <div className="border-b p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{t('prompts.detail.tab.versions')}</div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              {t('prompts.detail.versionShowing')
                .replace('{visible}', String(filteredVersions.length))
                .replace('{total}', String(prompt.versions.length))}
            </div>
          </div>
          <Button type="button" size="sm" className="h-8 shrink-0" disabled={isCopying} onClick={onRequestBlankVersion}>
            <Plus className="size-4" />
            {t('prompts.detail.createDraftVersion')}
          </Button>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={versionSearch}
            onChange={(event) => setVersionSearch(event.target.value)}
            placeholder={t('prompts.detail.versionSearchPlaceholder')}
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {filteredVersions.length > 0 ? (
          <div className="space-y-2">
            {filteredVersions.map((version) => {
              const selected = selectedVersions.includes(version.version);
              const active = version.id === activeVersionId;
              const frozen = version.frozen;
              const editLabel = frozen ? t('prompts.detail.viewFrozenVersion') : t('prompts.detail.editVersion');
              return (
                <div
                  key={version.id}
                  className={cn(
                    'cursor-pointer rounded-lg border bg-card p-3 transition-colors hover:bg-muted/35',
                    active && 'border-primary bg-primary/5',
                  )}
                  onClick={() => onActivateVersion(version.id)}
                  data-testid={`prompt-version-row-${version.version}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-primary"
                      checked={selected}
                      aria-label={`${t('prompts.detail.compare')} ${getVersionLabel(version)}`}
                      onClick={stopRowClick}
                      onChange={() => toggleVersion(version.version)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px] font-semibold">{getVersionLabel(version)}</span>
                        <span className="inline-flex items-center gap-1">
                          <StatusBadge status={version.status} compact />
                          <PromptVariableModalityBadges variables={version.variables} />
                        </span>
                        {version.version === prompt.onlineVersion && (
                          <span className="rounded bg-[var(--status-running-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--status-running-fg)]">
                            {t('prompts.badge.online')}
                          </span>
                        )}
                      </div>
                      {version.labels.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1" onClick={stopRowClick}>
                          {version.labels.map((label) => (
                            <VersionLabelPill
                              key={label.name}
                              label={label}
                              onRemove={
                                label.name === 'latest' || isUpdatingLabel
                                  ? undefined
                                  : () => onUpdateLabel(label.name, null)
                              }
                            />
                          ))}
                        </div>
                      )}
                      <div className="mt-2 truncate text-[11.5px] text-muted-foreground">
                        {formatDateTime(version.createdAt)}
                      </div>
                    </div>
                    <div onClick={stopRowClick}>
                      <TableActionRow
                        maxInline={0}
                        moreLabel={t('prompts.action.moreActions')}
                        actions={
                          [
                            {
                              key: 'edit',
                              label: editLabel,
                              icon: frozen ? Eye : Pencil,
                              onClick: () => onActivateVersion(version.id),
                            },
                            {
                              key: 'copy',
                              label: t('prompts.detail.copyVersion'),
                              icon: Copy,
                              disabled: isCopying,
                              onClick: () => onRequestCopy(version.id),
                            },
                            {
                              key: 'delete',
                              label: t('prompts.detail.deleteDraftVersion'),
                              icon: Trash2,
                              destructive: true,
                              disabled: isDeleting,
                              onClick: () => onRequestDelete(version.id),
                            },
                          ] satisfies TableActionDescriptor[]
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-[12px] text-muted-foreground">
            {t('prompts.detail.versionNoMatch')}
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-muted-foreground">
            {t('prompts.detail.selectedForDiff').replace('{count}', String(selectedVersions.length))}
          </span>
          {compareVersions.map((version) => (
            <span key={version.version} className="rounded border bg-background px-1.5 py-0.5 font-mono text-xs">
              {getVersionLabel(version)}
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setSelectedVersions([])}
          >
            {t('prompts.detail.clearDiff')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!fromVersion || !toVersion}
            onClick={() => setDiffDialogOpen(true)}
          >
            <GitCompareArrows className="size-3.5" />
            {t('prompts.detail.openDiff')}
          </Button>
        </div>
      </div>

      <Dialog open={diffDialogOpen} onOpenChange={setDiffDialogOpen}>
        <DialogContent className="max-h-[86vh] max-w-[1100px] overflow-hidden p-0">
          <DialogHeader className="border-b px-6 pt-6">
            <DialogTitle className="flex items-center gap-2">
              <GitCompareArrows className="size-4" />
              {t('prompts.detail.diffRenderedPrompt')}
            </DialogTitle>
            <DialogDescription>
              {fromVersion && toVersion
                ? `${getVersionLabel(fromVersion)} -> ${getVersionLabel(toVersion)}`
                : t('prompts.detail.diffNeedsTwo')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[68vh] space-y-3 overflow-auto px-6 pb-6">
            {fromVersion && toVersion && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded border bg-destructive/10 px-1.5 py-0.5 text-destructive">
                    - {t('prompts.detail.diffRemoved')}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--status-running-bd)] bg-[var(--status-running-bg)] px-1.5 py-0.5 text-[var(--status-running-fg)]">
                    + {t('prompts.detail.diffAdded')}
                  </span>
                </div>
                <PromptDiffSplitView
                  fromLabel={getVersionLabel(fromVersion)}
                  toLabel={getVersionLabel(toVersion)}
                  fromText={fromPromptPreview}
                  toText={toPromptPreview}
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function ActiveVersionLabels({
  activeVersion,
  onUpdateLabel,
  isUpdatingLabel,
}: {
  activeVersion: PromptVersion | null;
  onUpdateLabel: (label: string, versionId: string | null) => Promise<void>;
  isUpdatingLabel: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const cleanLabelInput = labelInput.trim();
  const labelValidation = cleanLabelInput ? promptVersionLabelNameSchema.safeParse(cleanLabelInput) : null;
  const labelError = labelValidation && !labelValidation.success ? t('prompts.labels.invalidFormat') : null;
  const submitLabel = async () => {
    if (!activeVersion || !cleanLabelInput || labelError || isUpdatingLabel) return;
    await onUpdateLabel(cleanLabelInput, activeVersion.id);
    setLabelInput('');
    setEditing(false);
  };

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {activeVersion && activeVersion.labels.length > 0 ? (
        activeVersion.labels.map((label) => (
          <VersionLabelPill
            key={label.name}
            label={label}
            onRemove={label.name === 'latest' || isUpdatingLabel ? undefined : () => onUpdateLabel(label.name, null)}
          />
        ))
      ) : (
        <span className="text-xs text-muted-foreground">{t('prompts.labels.empty')}</span>
      )}
      {!editing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!activeVersion || isUpdatingLabel}
          onClick={() => setEditing(true)}
        >
          <Plus className="size-3.5" />
          {t('prompts.detail.addLabel')}
        </Button>
      )}
      {editing && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submitLabel();
          }}
        >
          <div className="flex min-w-[190px] flex-col gap-1">
            <Input
              value={labelInput}
              onChange={(event) => setLabelInput(event.target.value)}
              placeholder={t('prompts.detail.labelPlaceholder')}
              className={cn('h-7 w-[190px] font-mono text-xs', labelError && 'border-destructive')}
              aria-invalid={Boolean(labelError)}
              data-testid="prompt-version-label-input"
            />
            {labelError && <span className="max-w-[260px] text-[11px] text-destructive">{labelError}</span>}
          </div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!activeVersion || !cleanLabelInput || Boolean(labelError) || isUpdatingLabel}
          >
            <Tags className="size-3.5" />
            {t('prompts.detail.applyLabel')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => {
              setLabelInput('');
              setEditing(false);
            }}
            aria-label={t('common.cancel')}
          >
            <X className="size-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}

function formatMetricNumber(value: number) {
  return value.toLocaleString();
}

function formatMetricMs(value: number | null) {
  if (value === null) return '-';
  return `${Math.round(value).toLocaleString()} ms`;
}

function formatMetricCost(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatMetricPercent(value: number | null) {
  if (value === null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function MetricSummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-xl font-semibold leading-none">{value}</div>
      {sub && <div className="mt-2 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PromptMetricsTab({ projectId, promptId }: { projectId: string; promptId: string }) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const metricsQuery = usePromptMetrics(projectId, promptId);
  const metrics = metricsQuery.data;

  const metricsLoading = useDelayedLoading(metricsQuery.isLoading);
  if (metricsLoading) {
    return (
      <div className="relative min-h-[420px]" data-testid="prompt-metrics-tab" aria-busy="true">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
        <PlatformLoaderOverlay placement="container" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        {t('prompts.metrics.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="prompt-metrics-tab">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BarChart3 className="size-4 text-muted-foreground" />
        {t('prompts.detail.tab.metrics')}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricSummaryCard
          label={t('prompts.metrics.totalRuns')}
          value={formatMetricNumber(metrics.totals.runCount)}
          sub={`${t('prompts.metrics.success')} ${formatMetricNumber(metrics.totals.successCount)} · ${t(
            'prompts.metrics.errors',
          )} ${formatMetricNumber(metrics.totals.errorCount)}`}
        />
        <MetricSummaryCard
          label={t('prompts.metrics.totalTokens')}
          value={formatMetricNumber(metrics.totals.totalInputTokens + metrics.totals.totalOutputTokens)}
          sub={`${t('prompts.metrics.inputTokens')} ${formatMetricNumber(
            metrics.totals.totalInputTokens,
          )} · ${t('prompts.metrics.outputTokens')} ${formatMetricNumber(metrics.totals.totalOutputTokens)}`}
        />
        <MetricSummaryCard
          label={t('prompts.metrics.totalCost')}
          value={formatMetricCost(metrics.totals.totalCostEstimate)}
        />
        <MetricSummaryCard
          label={t('prompts.metrics.versionsWithRuns')}
          value={formatMetricNumber(metrics.versions.filter((version) => version.runCount > 0).length)}
          sub={`${formatMetricNumber(metrics.versions.length)} ${t('prompts.detail.versionTotalSuffix')}`}
        />
      </div>

      <section className="overflow-hidden rounded-lg border bg-card" aria-label={t('prompts.detail.tab.metrics')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-left text-xs font-medium text-muted-foreground">
                <th className="px-3 py-3">{t('prompts.detail.version')}</th>
                <th className="w-44 px-3 py-3">{t('prompts.detail.labels')}</th>
                <th className="w-28 px-3 py-3">{t('prompts.table.status')}</th>
                <th className="w-24 px-3 py-3 text-right">{t('prompts.metrics.runs')}</th>
                <th className="w-24 px-3 py-3 text-right">{t('prompts.metrics.accuracy')}</th>
                <th className="w-32 px-3 py-3 text-right">{t('prompts.metrics.medianLatency')}</th>
                <th className="w-32 px-3 py-3 text-right">{t('prompts.metrics.medianTokens')}</th>
                <th className="w-28 px-3 py-3 text-right">{t('prompts.metrics.cost')}</th>
                <th className="w-36 px-3 py-3">{t('prompts.metrics.lastRun')}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.versions.map((version) => (
                <tr key={version.promptVersionId} className="border-b last:border-b-0">
                  <td className="px-3 py-3 font-mono font-semibold">v{version.versionNumber}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {version.labels.length > 0 ? (
                        version.labels.map((label) => <VersionLabelPill key={label.name} label={label} />)
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={version.status} compact />
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{formatMetricNumber(version.runCount)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatMetricPercent(version.accuracy)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatMetricMs(version.medianLatencyMs)}</td>
                  <td className="px-3 py-3 text-right font-mono">
                    {version.medianInputTokens === null && version.medianOutputTokens === null
                      ? '-'
                      : `${Math.round(version.medianInputTokens ?? 0)} / ${Math.round(
                          version.medianOutputTokens ?? 0,
                        )}`}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{formatMetricCost(version.totalCostEstimate)}</td>
                  <td className="px-3 py-3 font-mono text-[11.5px] text-muted-foreground">
                    {formatDateTime(version.lastRunAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function PromptDetailPage({ projectId, promptId }: { projectId: string; promptId: string }) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialVersionParam = searchParams?.get('version') ?? null;
  const urlDetailTab = resolveDetailTab(searchParams?.get('tab') ?? null);
  const urlMainTab = resolvePromptMainTab(searchParams?.get('panel') ?? null);
  const promptQuery = usePrompt(projectId, promptId);
  const datasetsQuery = useDatasets(projectId);
  const updateDraftVersionMutation = useUpdatePromptDraftVersion(projectId);
  const updatePromptMutation = useUpdatePrompt(projectId);
  const createDraftVersionMutation = useCreatePromptDraftVersion(projectId);
  const deleteDraftVersionMutation = useDeletePromptDraftVersion(projectId);
  const updateVersionLabelMutation = useUpdatePromptVersionLabel(projectId);
  const activeTab = urlDetailTab;
  const activeMainTab = urlMainTab;
  const requestedVersionId = activeTab === 'versions' ? initialVersionParam : null;
  const [body, setBody] = useState('');
  const [savedBody, setSavedBody] = useState('');
  const [promptLanguage, setPromptLanguage] = useState<PromptLanguage>('zh-CN');
  const [savedPromptLanguage, setSavedPromptLanguage] = useState<PromptLanguage>('zh-CN');
  const [variables, setVariables] = useState<PromptVariable[]>([]);
  const [savedVariables, setSavedVariables] = useState<PromptVariable[]>([]);
  const [customOutputFields, setCustomOutputFields] = useState<PromptOutputField[]>([]);
  const [savedCustomOutputFields, setSavedCustomOutputFields] = useState<PromptOutputField[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [activeSyncKey, setActiveSyncKey] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTargetVersionId, setDeleteTargetVersionId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const allowNavigationRef = useRef(false);
  const popGuardArmedRef = useRef(false);
  const prompt = useMemo(() => (promptQuery.data ? toProjectPrompt(promptQuery.data) : null), [promptQuery.data]);
  const deleteImpactQuery = usePromptVersionDeleteImpact(projectId, prompt?.id ?? '', deleteTargetVersionId ?? '');
  const datasets = useMemo(
    () => (datasetsQuery.data?.data ?? []).map((dataset) => toProjectDataset(dataset)),
    [datasetsQuery.data?.data],
  );
  const activeDatasets = useMemo(() => datasets.filter((dataset) => dataset.status === 'active'), [datasets]);

  const editableVersions = useMemo(
    () => (prompt?.versions ?? []).filter((version) => !version.frozen),
    [prompt?.versions],
  );

  const activeVersion = useMemo<PromptVersion | null>(() => {
    if (!prompt) return null;
    if (requestedVersionId) {
      const match = prompt.versions.find((version) => version.id === requestedVersionId);
      if (match) return match;
    }
    if (editableVersions.length > 0) return editableVersions[0] ?? null;
    return prompt.versions[0] ?? null;
  }, [editableVersions, prompt, requestedVersionId]);

  const isReadOnly = activeVersion ? activeVersion.frozen : false;

  const activeVersionSyncKey =
    prompt && activeVersion
      ? getPromptVersionSyncKey({
          promptId: prompt.id,
          versionId: activeVersion.id,
          body: activeVersion.body ?? '',
          promptLanguage: activeVersion.promptLanguage,
          variables: activeVersion.variables ?? [],
          outputFields: activeVersion.outputFields ?? [],
        })
      : '';
  if (prompt && activeVersion && activeSyncKey !== activeVersionSyncKey) {
    const sourceBody = activeVersion.body ?? prompt.body;
    const sourcePromptLanguage = activeVersion.promptLanguage;
    const sourceVariables = activeVersion.variables ?? prompt.variables;
    const sourceFields = (activeVersion.outputFields ?? prompt.outputFields).filter((field) => !field.isJudgment);
    setActiveSyncKey(activeVersionSyncKey);
    setBody(sourceBody);
    setSavedBody(sourceBody);
    setPromptLanguage(sourcePromptLanguage);
    setSavedPromptLanguage(sourcePromptLanguage);
    setVariables(sourceVariables);
    setSavedVariables(sourceVariables);
    setCustomOutputFields(sourceFields);
    setSavedCustomOutputFields(sourceFields);
    setSelectedDatasetId(prompt.defaultDatasetId);
    setSaveError(null);
  }

  const selectedDataset = useMemo(
    () => (selectedDatasetId ? (datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null) : null),
    [datasets, selectedDatasetId],
  );

  const derivedJudgmentField = useMemo<PromptOutputField>(
    () => getDatasetJudgmentField(selectedDataset),
    [selectedDataset],
  );

  const outputFields = useMemo(
    () => upsertJudgmentField(customOutputFields, derivedJudgmentField),
    [customOutputFields, derivedJudgmentField],
  );

  const handleOutputFieldsChange = useCallback((next: PromptOutputField[]) => {
    setCustomOutputFields(next.filter((field) => !field.isJudgment));
  }, []);

  const variablesDirty = serializePromptVariables(variables) !== serializePromptVariables(savedVariables);
  const outputFieldsDirty =
    serializeOutputFields(customOutputFields) !== serializeOutputFields(savedCustomOutputFields);
  const dirty =
    !isReadOnly &&
    (body !== savedBody || promptLanguage !== savedPromptLanguage || variablesDirty || outputFieldsDirty);

  const requestUnsavedNavigation = useCallback((navigation: PendingNavigation) => {
    setPendingNavigation(navigation);
    setUnsavedDialogOpen(true);
  }, []);

  const replaceDetailUrl = useCallback(
    ({
      nextTab = activeTab,
      nextMainTab = activeMainTab,
      versionId,
    }: {
      nextTab?: DetailTab;
      nextMainTab?: PromptMainTab;
      versionId?: string | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());

      if (nextTab === 'versions') params.delete('tab');
      else params.set('tab', nextTab);

      if (nextTab === 'versions' && nextMainTab === 'config') params.set('panel', nextMainTab);
      else params.delete('panel');

      if (versionId !== undefined) {
        if (versionId) params.set('version', versionId);
        else params.delete('version');
      }
      if (nextTab !== 'versions') params.delete('version');

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [activeMainTab, activeTab, pathname, router, searchParams],
  );

  const selectDetailTab = useCallback(
    (tab: DetailTab) => {
      replaceDetailUrl({ nextTab: tab });
    },
    [replaceDetailUrl],
  );

  const selectPromptMainTab = useCallback(
    (tab: PromptMainTab) => {
      replaceDetailUrl({ nextTab: 'versions', nextMainTab: tab });
    },
    [replaceDetailUrl],
  );

  useEffect(() => {
    if (!dirty) return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty || popGuardArmedRef.current) return;
    const currentState = typeof window.history.state === 'object' && window.history.state ? window.history.state : {};
    window.history.pushState({ ...currentState, [UNSAVED_HISTORY_GUARD_KEY]: true }, '', window.location.href);
    popGuardArmedRef.current = true;
  }, [dirty]);

  useEffect(() => {
    const onPopState = () => {
      if (allowNavigationRef.current || !dirty) {
        allowNavigationRef.current = false;
        return;
      }

      const currentState = typeof window.history.state === 'object' && window.history.state ? window.history.state : {};
      window.history.pushState({ ...currentState, [UNSAVED_HISTORY_GUARD_KEY]: true }, '', window.location.href);
      popGuardArmedRef.current = true;
      requestUnsavedNavigation({ kind: 'back' });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dirty, requestUnsavedNavigation]);

  useEffect(() => {
    if (!dirty) return undefined;

    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.hasAttribute('download')) return;
      if (target.target && target.target !== '_self') return;

      const rawHref = target.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#')) return;

      const url = new URL(target.href, window.location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const nextPath = `${url.pathname}${url.search}${url.hash}`;
      if (url.origin === window.location.origin && nextPath === currentPath) return;

      event.preventDefault();
      event.stopPropagation();
      requestUnsavedNavigation({
        kind: 'href',
        href: url.origin === window.location.origin ? nextPath : url.toString(),
        external: url.origin !== window.location.origin,
      });
    };

    document.addEventListener('click', onDocumentClick, true);
    return () => document.removeEventListener('click', onDocumentClick, true);
  }, [dirty, requestUnsavedNavigation]);

  useEffect(() => {
    if (!actionMessage?.autoDismiss) return undefined;

    const timer = window.setTimeout(() => {
      setActionMessage((current) => (current === actionMessage ? null : current));
    }, LABEL_ACTION_MESSAGE_DISMISS_MS);

    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  const saveDraft = useCallback(async () => {
    if (!prompt || !activeVersion || isReadOnly) {
      setSaveError(t('prompts.detail.noEditableDraft'));
      return false;
    }

    try {
      const nextPrompt = await updateDraftVersionMutation.mutateAsync({
        promptId: prompt.id,
        versionId: activeVersion.id,
        body: {
          body,
          promptLanguage,
          variables: variables.map(({ selected: _selected, ...variable }) => variable),
          outputSchema: {
            fields: outputFields.map((field) => ({
              key: field.key,
              value: field.value,
              isJudgment: field.isJudgment,
            })),
          },
          judgmentRules: { rules: activeVersion.judgmentRules },
          changeReason: activeVersion.changeReason || null,
        },
      });

      const nextProjectPrompt = toProjectPrompt(nextPrompt);
      const nextActive = nextProjectPrompt.versions.find((version) => version.id === activeVersion.id) ?? null;
      const nextBody = nextActive?.body ?? nextProjectPrompt.body ?? body;
      const nextPromptLanguage = nextActive?.promptLanguage ?? promptLanguage;
      const nextVariables = nextActive?.variables ?? nextProjectPrompt.variables;
      const nextOutputFields = nextActive?.outputFields ?? nextProjectPrompt.outputFields;
      const nextCustomFields = nextOutputFields.filter((field) => !field.isJudgment);
      setBody(nextBody);
      setSavedBody(nextBody);
      setPromptLanguage(nextPromptLanguage);
      setSavedPromptLanguage(nextPromptLanguage);
      setVariables(nextVariables);
      setSavedVariables(nextVariables);
      setCustomOutputFields(nextCustomFields);
      setSavedCustomOutputFields(nextCustomFields);
      setActiveSyncKey(
        getPromptVersionSyncKey({
          promptId: nextProjectPrompt.id,
          versionId: activeVersion.id,
          body: nextBody,
          promptLanguage: nextPromptLanguage,
          variables: nextVariables,
          outputFields: nextOutputFields,
        }),
      );
      setSaveError(null);
      return true;
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error as Error)?.message ??
        t('prompts.detail.saveFailed');
      setSaveError(String(message));
      return false;
    }
  }, [activeVersion, body, isReadOnly, outputFields, prompt, promptLanguage, t, updateDraftVersionMutation, variables]);

  const autoSaveConfigVersion = useCallback(
    async ({
      nextPromptLanguage = savedPromptLanguage,
      nextVariables = savedVariables,
      nextDataset = selectedDataset,
    }: {
      nextPromptLanguage?: PromptLanguage;
      nextVariables?: PromptVariable[];
      nextDataset?: ProjectDataset | null;
    }) => {
      if (!prompt || !activeVersion || isReadOnly) return false;

      const nextOutputFields = upsertJudgmentField(savedCustomOutputFields, getDatasetJudgmentField(nextDataset));

      try {
        const nextPrompt = await updateDraftVersionMutation.mutateAsync({
          promptId: prompt.id,
          versionId: activeVersion.id,
          body: {
            body: savedBody,
            promptLanguage: nextPromptLanguage,
            variables: nextVariables.map(({ selected: _selected, ...variable }) => variable),
            outputSchema: {
              fields: nextOutputFields.map((field) => ({
                key: field.key,
                value: field.value,
                isJudgment: field.isJudgment,
              })),
            },
            judgmentRules: { rules: activeVersion.judgmentRules },
            changeReason: activeVersion.changeReason || null,
          },
        });

        const nextProjectPrompt = toProjectPrompt(nextPrompt);
        const nextActive = nextProjectPrompt.versions.find((version) => version.id === activeVersion.id) ?? null;
        const persistedBody = nextActive?.body ?? savedBody;
        const persistedPromptLanguage = nextActive?.promptLanguage ?? nextPromptLanguage;
        const persistedVariables = nextActive?.variables ?? nextVariables;
        const persistedOutputFields = nextActive?.outputFields ?? nextOutputFields;
        const persistedCustomFields = persistedOutputFields.filter((field) => !field.isJudgment);

        setSavedBody(persistedBody);
        setPromptLanguage(persistedPromptLanguage);
        setSavedPromptLanguage(persistedPromptLanguage);
        setVariables(persistedVariables);
        setSavedVariables(persistedVariables);
        setSavedCustomOutputFields(persistedCustomFields);
        setActiveSyncKey(
          getPromptVersionSyncKey({
            promptId: nextProjectPrompt.id,
            versionId: activeVersion.id,
            body: persistedBody,
            promptLanguage: persistedPromptLanguage,
            variables: persistedVariables,
            outputFields: persistedOutputFields,
          }),
        );
        setSaveError(null);
        return true;
      } catch (error) {
        const message =
          (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (error as Error)?.message ??
          t('prompts.detail.saveFailed');
        setSaveError(String(message));
        return false;
      }
    },
    [
      activeVersion,
      isReadOnly,
      prompt,
      savedBody,
      savedCustomOutputFields,
      savedPromptLanguage,
      savedVariables,
      selectedDataset,
      t,
      updateDraftVersionMutation,
    ],
  );

  const handlePromptLanguageChange = useCallback(
    (nextLanguage: PromptLanguage) => {
      if (nextLanguage === promptLanguage) return;
      const previousLanguage = promptLanguage;
      setPromptLanguage(nextLanguage);
      void autoSaveConfigVersion({ nextPromptLanguage: nextLanguage }).then((saved) => {
        if (!saved) setPromptLanguage(previousLanguage);
      });
    },
    [autoSaveConfigVersion, promptLanguage],
  );

  const selectDataset = useCallback(
    (datasetId: string) => {
      const nextDataset = datasets.find((dataset) => dataset.id === datasetId);
      if (!nextDataset) return;

      const previousDatasetId = selectedDatasetId;
      const previousVariables = variables;
      const nextVariables = toPromptVariablesFromDataset(nextDataset);
      setSelectedDatasetId(datasetId);
      setVariables(nextVariables);

      void (async () => {
        try {
          if (prompt && prompt.defaultDatasetId !== datasetId) {
            await updatePromptMutation.mutateAsync({ promptId: prompt.id, body: { defaultDatasetId: datasetId } });
          }
          const saved = await autoSaveConfigVersion({
            nextPromptLanguage: savedPromptLanguage,
            nextVariables,
            nextDataset,
          });
          if (!saved) {
            setSelectedDatasetId(previousDatasetId);
            setVariables(previousVariables);
          }
        } catch (error) {
          setSelectedDatasetId(previousDatasetId);
          setVariables(previousVariables);
          const message =
            (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            (error as Error)?.message ??
            t('prompts.detail.datasetBindFailed');
          setSaveError(String(message));
        }
      })();
    },
    [
      autoSaveConfigVersion,
      datasets,
      prompt,
      savedPromptLanguage,
      selectedDatasetId,
      t,
      updatePromptMutation,
      variables,
    ],
  );

  const navigateWithGuard = useCallback(
    (href: string) => {
      if (!dirty) {
        router.push(href);
        return;
      }

      requestUnsavedNavigation({ kind: 'href', href, external: false });
    },
    [dirty, requestUnsavedNavigation, router],
  );

  const closeUnsavedDialog = () => {
    setUnsavedDialogOpen(false);
    setPendingNavigation(null);
  };

  const discardAndLeave = () => {
    const navigation = pendingNavigation;
    setBody(savedBody);
    setPromptLanguage(savedPromptLanguage);
    setVariables(savedVariables);
    setCustomOutputFields(savedCustomOutputFields);
    setSelectedDatasetId(null);
    setUnsavedDialogOpen(false);
    setPendingNavigation(null);
    runPendingNavigation(navigation);
  };

  const saveAndLeave = async () => {
    const navigation = pendingNavigation;
    const saved = await saveDraft();
    if (!saved) return;
    setUnsavedDialogOpen(false);
    setPendingNavigation(null);
    runPendingNavigation(navigation);
  };

  const cancelDraftChanges = useCallback(() => {
    if (!prompt) return;
    setBody(savedBody);
    setPromptLanguage(savedPromptLanguage);
    setVariables(savedVariables);
    setCustomOutputFields(savedCustomOutputFields);
    setSelectedDatasetId(prompt.defaultDatasetId);
    setSaveError(null);
  }, [prompt, savedBody, savedCustomOutputFields, savedPromptLanguage, savedVariables]);

  const activateVersion = useCallback(
    (versionId: string) => {
      replaceDetailUrl({ nextTab: 'versions', versionId });
    },
    [replaceDetailUrl],
  );

  const handleActivateVersion = useCallback(
    (versionId: string) => {
      if (dirty && versionId !== activeVersion?.id) {
        requestUnsavedNavigation({ kind: 'version', versionId });
        return;
      }

      activateVersion(versionId);
    },
    [activateVersion, activeVersion?.id, dirty, requestUnsavedNavigation],
  );

  const createBlankVersion = useCallback(async () => {
    if (!prompt) return;
    const inheritedDataset = selectedDataset;
    try {
      const next = await createDraftVersionMutation.mutateAsync({
        promptId: prompt.id,
        body: {},
      });
      let nextProjectPrompt = toProjectPrompt(next);
      let created = nextProjectPrompt.versions[0] ?? null;
      if (created && inheritedDataset) {
        const createdVersionId = created.id;
        const inheritedVariables = toPromptVariablesFromDataset(inheritedDataset);
        const inheritedOutputFields = upsertJudgmentField([], getDatasetJudgmentField(inheritedDataset));
        const updated = await updateDraftVersionMutation.mutateAsync({
          promptId: prompt.id,
          versionId: createdVersionId,
          body: {
            body: '',
            promptLanguage: created.promptLanguage,
            variables: inheritedVariables.map(({ selected: _selected, ...variable }) => variable),
            outputSchema: {
              fields: inheritedOutputFields.map((field) => ({
                key: field.key,
                value: field.value,
                isJudgment: field.isJudgment,
              })),
            },
            judgmentRules: { rules: created.judgmentRules },
            changeReason: created.changeReason || null,
          },
        });
        nextProjectPrompt = toProjectPrompt(updated);
        created = nextProjectPrompt.versions.find((version) => version.id === createdVersionId) ?? created;
      }
      if (created) {
        replaceDetailUrl({ nextTab: 'versions', nextMainTab: 'prompt', versionId: created.id });
      }
      setActionMessage({ kind: 'success', text: t('prompts.versions.createBlankSuccess') });
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error as Error)?.message ??
        t('prompts.versions.createBlankFailed');
      setActionMessage({ kind: 'error', text: String(message) });
    }
  }, [createDraftVersionMutation, prompt, replaceDetailUrl, selectedDataset, t, updateDraftVersionMutation]);

  const handleRequestBlankVersion = useCallback(() => {
    if (dirty) {
      requestUnsavedNavigation({ kind: 'blankVersion' });
      return;
    }

    void createBlankVersion();
  }, [createBlankVersion, dirty, requestUnsavedNavigation]);

  const copyVersion = useCallback(
    async (sourceVersionId: string) => {
      if (!prompt) return;
      try {
        const next = await createDraftVersionMutation.mutateAsync({
          promptId: prompt.id,
          body: { sourceVersionId },
        });
        const nextProjectPrompt = toProjectPrompt(next);
        const created = nextProjectPrompt.versions[0] ?? null;
        if (created) {
          replaceDetailUrl({ nextTab: 'versions', nextMainTab: 'prompt', versionId: created.id });
        }
        setActionMessage({ kind: 'success', text: t('prompts.versions.copySuccess') });
      } catch (error) {
        const message =
          (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (error as Error)?.message ??
          t('prompts.versions.copyFailed');
        setActionMessage({ kind: 'error', text: String(message) });
      }
    },
    [createDraftVersionMutation, prompt, replaceDetailUrl, t],
  );

  const handleRequestCopy = useCallback(
    (sourceVersionId: string) => {
      if (dirty) {
        requestUnsavedNavigation({ kind: 'copyVersion', sourceVersionId });
        return;
      }

      void copyVersion(sourceVersionId);
    },
    [copyVersion, dirty, requestUnsavedNavigation],
  );

  function runPendingNavigation(navigation: PendingNavigation | null) {
    if (!navigation) return;

    switch (navigation.kind) {
      case 'href':
        allowNavigationRef.current = true;
        if (navigation.external) window.location.assign(navigation.href);
        else router.push(navigation.href);
        return;
      case 'back':
        allowNavigationRef.current = true;
        window.history.go(popGuardArmedRef.current ? -2 : -1);
        return;
      case 'version':
        activateVersion(navigation.versionId);
        return;
      case 'blankVersion':
        void createBlankVersion();
        return;
      case 'copyVersion':
        void copyVersion(navigation.sourceVersionId);
        return;
    }
  }

  const handleRequestDelete = useCallback((versionId: string) => {
    setDeleteTargetVersionId(versionId);
  }, []);

  const handleUpdateLabel = useCallback(
    async (label: string, versionId: string | null) => {
      if (!prompt) return;
      try {
        await updateVersionLabelMutation.mutateAsync({
          promptId: prompt.id,
          body: { label, versionId },
        });
        setActionMessage({
          kind: 'success',
          text: versionId ? t('prompts.labels.updateSuccess') : t('prompts.labels.deleteSuccess'),
          autoDismiss: true,
        });
      } catch (error) {
        const message =
          (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (error as Error)?.message ??
          t('prompts.labels.updateFailed');
        setActionMessage({ kind: 'error', text: String(message) });
      }
    },
    [prompt, t, updateVersionLabelMutation],
  );

  const confirmDelete = useCallback(async () => {
    if (!prompt || !deleteTargetVersionId) return;
    try {
      await deleteDraftVersionMutation.mutateAsync({
        promptId: prompt.id,
        versionId: deleteTargetVersionId,
      });
      if (requestedVersionId === deleteTargetVersionId) {
        replaceDetailUrl({ nextTab: 'versions', versionId: null });
      }
      setDeleteTargetVersionId(null);
      setActionMessage({ kind: 'success', text: t('prompts.versions.deleteSuccess') });
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error as Error)?.message ??
        t('prompts.versions.deleteFailed');
      setActionMessage({ kind: 'error', text: String(message) });
      setDeleteTargetVersionId(null);
    }
  }, [deleteDraftVersionMutation, deleteTargetVersionId, prompt, replaceDetailUrl, requestedVersionId, t]);

  const deleteTargetVersion = useMemo(
    () =>
      prompt && deleteTargetVersionId ? (prompt.versions.find((v) => v.id === deleteTargetVersionId) ?? null) : null,
    [deleteTargetVersionId, prompt],
  );

  const promptLoading = useDelayedLoading(promptQuery.isLoading);
  if (promptLoading) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1680px] px-4 pb-10 pt-6 sm:px-6 lg:px-8" data-testid="prompt-detail-page">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  if (!prompt) {
    return (
      <Main className="bg-muted/35">
        <div className="mx-auto w-full max-w-3xl rounded-lg border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">{t('prompts.detail.notFoundTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('prompts.detail.notFoundDescription')}</p>
          <Button asChild className="mt-4">
            <Link href={`/prompts`}>{t('prompts.detail.backToList')}</Link>
          </Button>
        </div>
      </Main>
    );
  }

  const promptMetaParts = [
    t('prompts.detail.derivedFrom').replace(
      '{version}',
      `v${prompt.versions[0]?.parentVersion ?? prompt.latestVersion - 1}`,
    ),
    prompt.owner,
    formatDateTime(prompt.updatedAt),
  ].filter(Boolean);

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1680px] px-4 pb-10 pt-6 sm:px-6 lg:px-8" data-testid="prompt-detail-page">
        <button
          type="button"
          onClick={() => navigateWithGuard(`/prompts`)}
          className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('prompts.detail.backToList')}
        </button>

        <div className="mb-2">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-[26px] font-semibold leading-tight">{prompt.name}</h1>
              <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 font-mono text-[11.5px] font-medium text-muted-foreground">
                v{prompt.latestVersion}
              </span>
            </div>
            <div className="text-[12.5px] text-muted-foreground">{promptMetaParts.join(' · ')}</div>
          </div>
        </div>

        <div className="mb-5 mt-3 flex items-end gap-1 border-b">
          {(Object.keys(TAB_LABEL_KEYS) as DetailTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => selectDetailTab(tab)}
              className={cn(
                'border-b-2 px-4 py-2 text-[13.5px] font-medium transition-colors',
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(TAB_LABEL_KEYS[tab])}
            </button>
          ))}
        </div>

        {activeTab === 'versions' && (
          <div
            className="grid overflow-hidden border bg-background lg:grid-cols-[340px_minmax(0,1fr)]"
            data-testid="prompt-version-workspace"
          >
            <VersionSidebar
              prompt={prompt}
              activeVersionId={activeVersion?.id ?? null}
              onActivateVersion={handleActivateVersion}
              onRequestBlankVersion={handleRequestBlankVersion}
              onRequestCopy={handleRequestCopy}
              onRequestDelete={handleRequestDelete}
              onUpdateLabel={handleUpdateLabel}
              isCopying={createDraftVersionMutation.isPending}
              isDeleting={deleteDraftVersionMutation.isPending}
              isUpdatingLabel={updateVersionLabelMutation.isPending}
              initialVersionId={initialVersionParam}
            />
            <section className="min-w-0 bg-background" data-testid="prompt-version-main">
              <div className="border-b px-5 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {activeVersion && (
                        <>
                          <span className="font-mono text-sm font-semibold">v{activeVersion.version}</span>
                          <h2 className="truncate text-xl font-semibold leading-tight">{prompt.name}</h2>
                          {activeVersion.frozen ? (
                            <span data-testid="prompt-version-frozen-badge">
                              <StatusBadge status={activeVersion.status} compact />
                            </span>
                          ) : (
                            <StatusBadge status={activeVersion.status} compact />
                          )}
                        </>
                      )}
                    </div>
                    <ActiveVersionLabels
                      activeVersion={activeVersion}
                      onUpdateLabel={handleUpdateLabel}
                      isUpdatingLabel={updateVersionLabelMutation.isPending}
                    />
                  </div>
                  {activeVersion && (
                    <div className="flex max-w-full flex-wrap items-center justify-start gap-2 xl:justify-end">
                      {actionMessage && (
                        <span
                          className={cn(
                            'text-xs',
                            actionMessage.kind === 'success' ? 'text-[var(--status-running-fg)]' : 'text-destructive',
                          )}
                        >
                          {actionMessage.text}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={createDraftVersionMutation.isPending}
                        onClick={() => handleRequestCopy(activeVersion.id)}
                      >
                        <Copy className="size-3.5" />
                        {t('prompts.detail.copyAsNew')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() =>
                          navigateWithGuard(
                            `/experiments/new?promptId=${prompt.id}&promptVersionId=${activeVersion.id}`,
                          )
                        }
                      >
                        <FlaskConical className="size-3.5" />
                        {t('prompts.action.startExperiment')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() =>
                          navigateWithGuard(
                            `/optimizations/new?promptId=${prompt.id}&promptVersionId=${activeVersion.id}`,
                          )
                        }
                      >
                        <Sparkles className="size-3.5" />
                        {t('prompts.action.startOptimization')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-end gap-1 border-b px-5">
                {(Object.keys(PROMPT_MAIN_TAB_LABEL_KEYS) as PromptMainTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => selectPromptMainTab(tab)}
                    className={cn(
                      'border-b-2 px-3 py-3 text-[13.5px] font-medium transition-colors',
                      activeMainTab === tab
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(PROMPT_MAIN_TAB_LABEL_KEYS[tab])}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {activeMainTab === 'prompt' && (
                  <EditorTab
                    body={body}
                    promptLanguage={promptLanguage}
                    variables={variables}
                    outputFields={outputFields}
                    onBodyChange={setBody}
                    onOutputFieldsChange={handleOutputFieldsChange}
                    hasBoundDataset={Boolean(selectedDatasetId)}
                    hasDatasets={datasetsQuery.isLoading || activeDatasets.length > 0}
                    onRequestDatasetBinding={() => selectPromptMainTab('config')}
                    onRequestDatasetUpload={() => navigateWithGuard('/datasets/new')}
                    dirty={dirty}
                    saveError={saveError}
                    isSaving={updateDraftVersionMutation.isPending}
                    onCancelChanges={cancelDraftChanges}
                    onSaveChanges={saveDraft}
                    readOnly={isReadOnly}
                  />
                )}
                {activeMainTab === 'config' && (
                  <ConfigTab
                    datasets={datasets}
                    variables={variables}
                    promptLanguage={promptLanguage}
                    onPromptLanguageChange={handlePromptLanguageChange}
                    selectedDatasetId={selectedDatasetId}
                    onSelectDataset={selectDataset}
                    saveError={saveError}
                    readOnly={isReadOnly || updateDraftVersionMutation.isPending || updatePromptMutation.isPending}
                  />
                )}
              </div>
            </section>
          </div>
        )}
        {activeTab === 'metrics' && <PromptMetricsTab projectId={projectId} promptId={prompt.id} />}
      </div>
      <Dialog open={unsavedDialogOpen} onOpenChange={(open) => !open && closeUnsavedDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('prompts.detail.unsavedTitle')}</DialogTitle>
            <DialogDescription>{t('prompts.detail.unsavedDescription')}</DialogDescription>
          </DialogHeader>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeUnsavedDialog}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="ghost" onClick={discardAndLeave}>
              {t('prompts.detail.leaveWithoutSaving')}
            </Button>
            <Button type="button" onClick={() => void saveAndLeave()} disabled={updateDraftVersionMutation.isPending}>
              <Save className="size-4" />
              {t('prompts.detail.saveAndLeave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteTargetVersionId !== null} onOpenChange={(open) => !open && setDeleteTargetVersionId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('prompts.versions.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('prompts.versions.deleteConfirmBody').replace(
                '{version}',
                deleteTargetVersion ? `v${deleteTargetVersion.version}` : '',
              )}
            </DialogDescription>
          </DialogHeader>
          <DeleteImpactPanel impact={deleteImpactQuery.data} loading={deleteImpactQuery.isLoading} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTargetVersionId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteDraftVersionMutation.isPending || deleteImpactQuery.isLoading}
            >
              <Trash2 className="size-4" />
              {t('common.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
