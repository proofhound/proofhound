'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  MODEL_PRESET_GROUPS,
  MODEL_PRESETS,
  QUICK_START_DEFAULT_CONCURRENCY,
  QUICK_START_DEFAULT_INITIAL_SAMPLES_PER_ROUND,
  QUICK_START_DEFAULT_INITIAL_SAMPLING_ROUNDS,
  QUICK_START_DEFAULT_MAX_ROUNDS,
  QUICK_START_DEFAULT_RPM_LIMIT,
  QUICK_START_DEFAULT_SAMPLE_TIMEOUT_SECONDS,
  QUICK_START_DEFAULT_TEMPERATURE,
  QUICK_START_DEFAULT_TPM_LIMIT,
  type CreateProjectModelDto,
  type CreateOptimizationGoalDto,
  type CreateQuickStartDto,
  type DatasetFieldMappingDto,
  type DatasetFieldRole,
  type DatasetUploadMetadataDto,
  type ModelImageCapability,
  type ModelPreset,
  type ModelPresetGroup,
  type QuickStartModelOptionDto,
  type QuickStartModelRefDto,
} from '@proofhound/shared';
import { AlertTriangle, ArrowLeft, Cable, Check, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { Main } from '@proofhound/ui/layout';
import { ModelProbeStatus, type ModelProbeFeedback, PromptLanguageSelect, type PromptLanguage } from '../../components';
import { Button, Input, Label, PlatformLoader, cn } from '@proofhound/ui';
import {
  useCreateQuickStart,
  useProbeQuickStartDraftModel,
  useProbeQuickStartExistingModel,
  useQuickStartModelOptions,
} from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage, buildProviderTypeOptions } from '../../lib';
import {
  useDatasetUploadAdapter,
  useDatasetUploadMaxBytes,
  useDatasetUploadProgressPanel,
  useProjectContext,
} from '../../providers';
import {
  getDatasetNameFromFile,
  inferRole,
  parseDatasetPreview,
  type ParsedDatasetFile,
} from '../datasets/dataset-upload-parser';
import {
  DatasetPreviewAndMappingPanel,
  DatasetUploadFileDropzone,
  DatasetUploadParseErrorBanner,
  droppedSelectionContainsDirectory,
  formatTemplate,
  getDatasetUploadFileSizeError,
  getDroppedFiles,
  normalizeExpectedRoles,
  toUploadSourceFormat,
} from '../datasets/dataset-upload-shared';
import { DatasetTransferProgressPanel, useDatasetTransferProgress } from '../datasets/dataset-transfer-progress';

type DraftModel = {
  name: string;
  providerType: string;
  providerModelId: string;
  endpoint: string;
  apiKey: string;
  contextWindowTokens: string;
  rpmLimit: string;
  tpmLimit: string;
  concurrencyLimit: string;
  inputPrice: string;
  outputPrice: string;
  imageCapability: ModelImageCapability;
};

type ModelChoice =
  | { mode: 'existing'; modelId: string }
  | { mode: 'draft'; presetKey: string | null; draft: DraftModel };

type ModelRunProfile = {
  name: string;
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
  signature: string;
};

type QuickStartGoalMetric = CreateOptimizationGoalDto['metric'];
type QuickStartGoalComparator = CreateOptimizationGoalDto['comparator'];

const GOAL_METRIC_OPTIONS: Array<{ value: QuickStartGoalMetric; labelKey: TranslationKey }> = [
  { value: 'accuracy', labelKey: 'optimizations.new.optimization.metric.accuracy' },
  { value: 'precision', labelKey: 'optimizations.new.optimization.metric.precision' },
  { value: 'recall', labelKey: 'optimizations.new.optimization.metric.recall' },
];

const GOAL_COMPARATOR_OPTIONS: Array<{ value: QuickStartGoalComparator; labelKey: TranslationKey }> = [
  { value: 'gte', labelKey: 'optimizations.new.optimization.comparator.gte' },
  { value: 'gt', labelKey: 'optimizations.new.optimization.comparator.gt' },
  { value: 'lte', labelKey: 'optimizations.new.optimization.comparator.lte' },
];

const DEFAULT_GOAL_TARGET = '0.8';
const DEFAULT_PRESET = MODEL_PRESETS.find((preset) => preset.featured) ?? MODEL_PRESETS[0]!;
const EMPTY_MODEL_OPTIONS: QuickStartModelOptionDto[] = [];

function presetToDraft(preset: ModelPreset): DraftModel {
  return {
    name: preset.name,
    providerType: preset.providerType,
    providerModelId: preset.providerModelId,
    endpoint: preset.endpoint,
    apiKey: '',
    contextWindowTokens: String(preset.contextWindowTokens),
    rpmLimit: String(preset.rpmLimit),
    tpmLimit: String(preset.tpmLimit),
    concurrencyLimit: String(preset.concurrencyLimit),
    inputPrice: String(preset.inputTokenPricePerMillion),
    outputPrice: String(preset.outputTokenPricePerMillion),
    imageCapability: preset.capabilities.image,
  };
}

function createInitialModelChoice(): ModelChoice {
  return { mode: 'draft', presetKey: DEFAULT_PRESET.key, draft: presetToDraft(DEFAULT_PRESET) };
}

function imageCapabilitySupportsUrl(capability: ModelImageCapability) {
  return capability === 'url' || capability === 'both';
}

function imageCapabilitySupportsBase64(capability: ModelImageCapability) {
  return capability === 'base64' || capability === 'both';
}

function toImageCapability(options: { url: boolean; base64: boolean }): ModelImageCapability {
  if (options.url && options.base64) return 'both';
  if (options.url) return 'url';
  if (options.base64) return 'base64';
  return 'none';
}

function runDefaultFromModelLimit(limit: number, fallback: number): number {
  return limit > 0 ? limit : fallback;
}

function SectionNumber({ value }: { value: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[11px] font-semibold text-primary-foreground">
      {value}
    </span>
  );
}

function Section({
  number,
  title,
  hint,
  children,
  complete = false,
}: {
  number: number;
  title: string;
  hint?: string;
  children: ReactNode;
  complete?: boolean;
}) {
  const { t } = useI18n();

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <SectionNumber value={number} />
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        {complete && (
          <span className="status-running inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
            <Check className="size-3" />
            {t('quickStart.complete')}
          </span>
        )}
        {hint && <span className="ml-auto text-[11.5px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MiniField({
  label,
  children,
  required = false,
  help,
  aside,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  help?: string;
  aside?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex min-h-4 items-center justify-between gap-2">
        <Label className="block text-xs font-medium">
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
        {aside && <span className="shrink-0 text-[11px] text-muted-foreground">{aside}</span>}
      </div>
      {children}
      {help && <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{help}</div>}
    </div>
  );
}

function DraftModelForm({
  choice,
  onChange,
}: {
  choice: Extract<ModelChoice, { mode: 'draft' }>;
  onChange: (choice: Extract<ModelChoice, { mode: 'draft' }>) => void;
}) {
  const { t } = useI18n();
  const [activePresetGroup, setActivePresetGroup] = useState<ModelPresetGroup>(DEFAULT_PRESET.group);
  const providerOptions = buildProviderTypeOptions(choice.draft.providerType);
  const presets = MODEL_PRESETS.filter((preset) => preset.group === activePresetGroup);

  const patchDraft = (patch: Partial<DraftModel>) => {
    onChange({ ...choice, draft: { ...choice.draft, ...patch } });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {MODEL_PRESET_GROUPS.map((group) => (
            <button
              key={group.key}
              type="button"
              className={cn(
                'inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors',
                activePresetGroup === group.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              aria-pressed={activePresetGroup === group.key}
              onClick={() => setActivePresetGroup(group.key)}
            >
              {group.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {presets.map((preset) => {
            const selected = choice.presetKey === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                className={cn(
                  'flex min-h-[94px] flex-col rounded-md border bg-background p-3 text-left transition-colors hover:border-ring/60 hover:bg-accent/45',
                  selected && 'border-primary bg-primary/5',
                )}
                aria-pressed={selected}
                onClick={() => onChange({ mode: 'draft', presetKey: preset.key, draft: presetToDraft(preset) })}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{preset.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {preset.providerModelId}
                    </span>
                  </span>
                  {preset.featured && <Sparkles className="size-4 shrink-0 text-[var(--status-canary-fg)]" />}
                </span>
                <span className="mt-auto pt-2 text-[11px] text-muted-foreground">
                  {preset.contextWindowTokens.toLocaleString()} {t('quickStart.model.tokens')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MiniField label={t('models.form.name')} required>
          <Input value={choice.draft.name} onChange={(event) => patchDraft({ name: event.target.value })} />
        </MiniField>
        <MiniField label={t('models.form.provider')} required>
          <select
            value={choice.draft.providerType}
            onChange={(event) => patchDraft({ providerType: event.target.value })}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </MiniField>
        <MiniField label={t('models.form.modelId')} required>
          <Input
            value={choice.draft.providerModelId}
            onChange={(event) => patchDraft({ providerModelId: event.target.value })}
          />
        </MiniField>
        <MiniField label={t('models.form.endpoint')} required>
          <Input value={choice.draft.endpoint} onChange={(event) => patchDraft({ endpoint: event.target.value })} />
        </MiniField>
        <MiniField label="API Key" required>
          <Input
            type="password"
            value={choice.draft.apiKey}
            onChange={(event) => patchDraft({ apiKey: event.target.value })}
            placeholder="sk-..."
          />
        </MiniField>
        <MiniField label={t('models.form.contextWindow')}>
          <Input
            inputMode="numeric"
            value={choice.draft.contextWindowTokens}
            onChange={(event) => patchDraft({ contextWindowTokens: event.target.value })}
          />
        </MiniField>
      </div>

      <details className="rounded-md border bg-background">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
          {t('quickStart.model.advanced')}
        </summary>
        <div className="grid gap-3 border-t p-3 md:grid-cols-3">
          <MiniField label="RPM">
            <Input
              inputMode="numeric"
              value={choice.draft.rpmLimit}
              onChange={(event) => patchDraft({ rpmLimit: event.target.value })}
            />
          </MiniField>
          <MiniField label="TPM">
            <Input
              inputMode="numeric"
              value={choice.draft.tpmLimit}
              onChange={(event) => patchDraft({ tpmLimit: event.target.value })}
            />
          </MiniField>
          <MiniField label={t('quickStart.advanced.concurrency')}>
            <Input
              inputMode="numeric"
              value={choice.draft.concurrencyLimit}
              onChange={(event) => patchDraft({ concurrencyLimit: event.target.value })}
            />
          </MiniField>
          <MiniField label={t('models.form.inputTokenPrice')}>
            <Input
              inputMode="decimal"
              value={choice.draft.inputPrice}
              onChange={(event) => patchDraft({ inputPrice: event.target.value })}
            />
          </MiniField>
          <MiniField label={t('models.form.outputTokenPrice')}>
            <Input
              inputMode="decimal"
              value={choice.draft.outputPrice}
              onChange={(event) => patchDraft({ outputPrice: event.target.value })}
            />
          </MiniField>
          <MiniField label={t('models.form.supportsImages')} help={t('quickStart.model.imageCapabilityHelp')}>
            <div className="grid gap-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent/45">
                <input
                  type="checkbox"
                  checked={imageCapabilitySupportsUrl(choice.draft.imageCapability)}
                  onChange={(event) =>
                    patchDraft({
                      imageCapability: toImageCapability({
                        url: event.target.checked,
                        base64: imageCapabilitySupportsBase64(choice.draft.imageCapability),
                      }),
                    })
                  }
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{t('models.form.imageUrl')}</span>
                  <span className="block text-[11px] leading-relaxed text-muted-foreground">
                    {t('models.form.imageUrlHelp')}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent/45">
                <input
                  type="checkbox"
                  checked={imageCapabilitySupportsBase64(choice.draft.imageCapability)}
                  onChange={(event) =>
                    patchDraft({
                      imageCapability: toImageCapability({
                        url: imageCapabilitySupportsUrl(choice.draft.imageCapability),
                        base64: event.target.checked,
                      }),
                    })
                  }
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{t('models.form.imageBase64')}</span>
                  <span className="block text-[11px] leading-relaxed text-muted-foreground">
                    {t('models.form.imageBase64Help')}
                  </span>
                </span>
              </label>
            </div>
          </MiniField>
        </div>
      </details>
    </div>
  );
}

function ModelPicker({
  title,
  choice,
  onChange,
  modelOptions,
}: {
  title: string;
  choice: ModelChoice;
  onChange: (choice: ModelChoice) => void;
  modelOptions: QuickStartModelOptionDto[];
}) {
  const { t } = useI18n();
  const existingProbe = useProbeQuickStartExistingModel();
  const draftProbe = useProbeQuickStartDraftModel();
  const [feedback, setFeedback] = useState<ModelProbeFeedback | null>(null);

  const selectedExisting = choice.mode === 'existing' ? choice.modelId : '';
  const draftChoice = choice.mode === 'draft' ? choice : createInitialModelChoice();

  const testConnectivity = () => {
    const startedAt = Date.now();
    setFeedback({ status: 'running', durationMs: null });

    if (choice.mode === 'existing') {
      if (!choice.modelId) {
        setFeedback({ status: 'failed', durationMs: 0, errorMessage: t('quickStart.model.required') });
        return;
      }
      existingProbe.mutate(choice.modelId, {
        onSuccess: (result) =>
          setFeedback({
            status: result.status === 'success' ? 'success' : 'failed',
            durationMs: result.durationMs,
            errorMessage: result.error,
          }),
        onError: (error) =>
          setFeedback({
            status: 'failed',
            durationMs: Date.now() - startedAt,
            errorMessage: getApiErrorMessage(error),
          }),
      });
      return;
    }

    const payload = readDraftModelPayload(choice.draft);
    if (!payload.ok) {
      setFeedback({ status: 'failed', durationMs: 0, errorMessage: t(payload.errorKey) });
      return;
    }

    draftProbe.mutate(payload.body, {
      onSuccess: (result) =>
        setFeedback({
          status: result.status === 'success' ? 'success' : 'failed',
          durationMs: result.durationMs,
          errorMessage: result.error,
        }),
      onError: (error) =>
        setFeedback({
          status: 'failed',
          durationMs: Date.now() - startedAt,
          errorMessage: getApiErrorMessage(error),
        }),
    });
  };

  const isTesting = existingProbe.isPending || draftProbe.isPending;

  return (
    <div className="space-y-4 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11.5px] text-muted-foreground">{t('quickStart.model.help')}</div>
        </div>
        <div className="inline-flex rounded-md border bg-muted p-0.5">
          <button
            type="button"
            className={cn(
              'h-7 rounded px-2.5 text-xs font-medium transition-colors',
              choice.mode === 'existing' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange({ mode: 'existing', modelId: modelOptions[0]?.id ?? '' })}
          >
            {t('quickStart.model.existing')}
          </button>
          <button
            type="button"
            className={cn(
              'h-7 rounded px-2.5 text-xs font-medium transition-colors',
              choice.mode === 'draft' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(createInitialModelChoice())}
          >
            {t('quickStart.model.preset')}
          </button>
        </div>
      </div>

      {choice.mode === 'existing' ? (
        <div className="grid gap-3">
          <MiniField label={t('quickStart.model.existing')} required>
            <select
              value={selectedExisting}
              onChange={(event) => onChange({ mode: 'existing', modelId: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {modelOptions.length === 0 && <option value="">{t('quickStart.model.noExisting')}</option>}
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.providerModelId}
                </option>
              ))}
            </select>
          </MiniField>
          {modelOptions.length === 0 && (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-[12px] text-muted-foreground">
              {t('quickStart.model.noExistingHelp')}
            </div>
          )}
        </div>
      ) : (
        <DraftModelForm
          choice={draftChoice as Extract<ModelChoice, { mode: 'draft' }>}
          onChange={(nextChoice) => onChange(nextChoice)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isTesting} onClick={testConnectivity}>
          {isTesting ? <Loader2 className="size-4 animate-spin" /> : <Cable className="size-4" />}
          {t('quickStart.model.test')}
        </Button>
        <ModelProbeStatus feedback={feedback} className="flex-1" />
      </div>
    </div>
  );
}

function readPositiveInteger(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readModelRateLimit(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && (value === -1 || value > 0) ? value : null;
}

function readNonnegativeNumber(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readDraftModelPayload(
  draft: DraftModel,
): { ok: true; body: CreateProjectModelDto } | { ok: false; errorKey: TranslationKey } {
  const required = [draft.name, draft.providerType, draft.providerModelId, draft.endpoint, draft.apiKey];
  if (required.some((value) => value.trim().length === 0)) {
    return { ok: false, errorKey: 'common.formError.requiredMissing' };
  }

  const contextWindowTokens = readPositiveInteger(draft.contextWindowTokens);
  const rpmLimit = readModelRateLimit(draft.rpmLimit);
  const tpmLimit = readModelRateLimit(draft.tpmLimit);
  const concurrencyLimit = readPositiveInteger(draft.concurrencyLimit);
  const inputPrice = readNonnegativeNumber(draft.inputPrice);
  const outputPrice = readNonnegativeNumber(draft.outputPrice);
  if (
    contextWindowTokens === null ||
    rpmLimit === null ||
    tpmLimit === null ||
    concurrencyLimit === null ||
    inputPrice === null ||
    outputPrice === null
  ) {
    return { ok: false, errorKey: 'common.formError.invalidNumber' };
  }

  return {
    ok: true,
    body: {
      name: draft.name.trim(),
      providerType: draft.providerType.trim(),
      providerModelId: draft.providerModelId.trim(),
      endpoint: draft.endpoint.trim(),
      apiKey: draft.apiKey,
      contextWindowTokens,
      rpm: { limit: rpmLimit },
      tpm: { limit: tpmLimit },
      concurrency: { limit: concurrencyLimit },
      autoConcurrency: true,
      pricing: { inputPerMillion: inputPrice, outputPerMillion: outputPrice },
      capabilities: { image: draft.imageCapability },
      extraBody: {},
    },
  };
}

function buildModelRef(
  choice: ModelChoice,
): { ok: true; ref: QuickStartModelRefDto } | { ok: false; errorKey: TranslationKey } {
  if (choice.mode === 'existing') {
    return choice.modelId
      ? { ok: true, ref: { kind: 'existing', modelId: choice.modelId } }
      : { ok: false, errorKey: 'quickStart.model.required' };
  }

  const payload = readDraftModelPayload(choice.draft);
  if (!payload.ok) return payload;
  return { ok: true, ref: { kind: 'draft', model: payload.body } };
}

function getModelRunProfile(choice: ModelChoice, modelOptions: QuickStartModelOptionDto[]): ModelRunProfile | null {
  if (choice.mode === 'existing') {
    const model = modelOptions.find((option) => option.id === choice.modelId);
    if (!model) return null;
    return {
      name: model.name,
      rpmLimit: model.rpm.limit,
      tpmLimit: model.tpm.limit,
      concurrencyLimit: model.concurrency.limit,
      signature: `existing:${model.id}:${model.rpm.limit}:${model.tpm.limit}:${model.concurrency.limit}`,
    };
  }

  const rpmLimit = readModelRateLimit(choice.draft.rpmLimit);
  const tpmLimit = readModelRateLimit(choice.draft.tpmLimit);
  const concurrencyLimit = readPositiveInteger(choice.draft.concurrencyLimit);
  if (rpmLimit === null || tpmLimit === null || concurrencyLimit === null) return null;

  return {
    name: choice.draft.name.trim() || choice.draft.providerModelId.trim() || 'model',
    rpmLimit,
    tpmLimit,
    concurrencyLimit,
    signature: `draft:${rpmLimit}:${tpmLimit}:${concurrencyLimit}`,
  };
}

function formatLimitValue(value: number, unlimitedLabel: string) {
  return value > 0 ? value.toLocaleString() : unlimitedLabel;
}

function isAbovePositiveLimit(value: number | null, limit: number) {
  return value !== null && limit > 0 && value > limit;
}

function getFileStem(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/u, '')
    .trim()
    .slice(0, 80);
}

function getDefaultOptimizationName(language: PromptLanguage, stem: string): string {
  return language === 'en-US' ? `${stem} Optimization #1` : `${stem} 优化 #1`;
}

export function QuickStartScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { projectId } = useProjectContext();
  const uploadDataset = useDatasetUploadAdapter();
  const datasetUploadMaxBytes = useDatasetUploadMaxBytes();
  const InjectedProgressPanel = useDatasetUploadProgressPanel();
  const uploadProgress = useDatasetTransferProgress();
  const modelOptionsQuery = useQuickStartModelOptions();
  const createQuickStart = useCreateQuickStart();
  const [optimizationName, setOptimizationName] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [promptLanguage, setPromptLanguage] = useState<PromptLanguage>('zh-CN');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDatasetFile | null>(null);
  const [fieldRoles, setFieldRoles] = useState<Record<string, DatasetFieldRole>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const importAbortRef = useRef<AbortController | null>(null);
  const [experimentChoice, setExperimentChoice] = useState<ModelChoice>(() => createInitialModelChoice());
  const [analysisSameAsExperiment, setAnalysisSameAsExperiment] = useState(true);
  const [analysisChoice, setAnalysisChoice] = useState<ModelChoice>(() => createInitialModelChoice());
  const [goalMetric, setGoalMetric] = useState<QuickStartGoalMetric>('accuracy');
  const [goalComparator, setGoalComparator] = useState<QuickStartGoalComparator>('gte');
  const [goalTarget, setGoalTarget] = useState(DEFAULT_GOAL_TARGET);
  const [goalScope, setGoalScope] = useState('overall');
  const [maxRounds, setMaxRounds] = useState(String(QUICK_START_DEFAULT_MAX_ROUNDS));
  const [samplingRounds, setSamplingRounds] = useState(String(QUICK_START_DEFAULT_INITIAL_SAMPLING_ROUNDS));
  const [samplesPerRound, setSamplesPerRound] = useState(String(QUICK_START_DEFAULT_INITIAL_SAMPLES_PER_ROUND));
  const [temperature, setTemperature] = useState(String(QUICK_START_DEFAULT_TEMPERATURE));
  const [rpmLimit, setRpmLimit] = useState(
    String(runDefaultFromModelLimit(DEFAULT_PRESET.rpmLimit, QUICK_START_DEFAULT_RPM_LIMIT)),
  );
  const [tpmLimit, setTpmLimit] = useState(
    String(runDefaultFromModelLimit(DEFAULT_PRESET.tpmLimit, QUICK_START_DEFAULT_TPM_LIMIT)),
  );
  const [concurrency, setConcurrency] = useState(
    String(runDefaultFromModelLimit(DEFAULT_PRESET.concurrencyLimit, QUICK_START_DEFAULT_CONCURRENCY)),
  );
  const [sampleTimeoutSeconds, setSampleTimeoutSeconds] = useState(String(QUICK_START_DEFAULT_SAMPLE_TIMEOUT_SECONDS));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDraggingDataset, setIsDraggingDataset] = useState(false);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const datasetSectionRef = useRef<HTMLDivElement | null>(null);
  const didScrollToDatasetImportRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedFileStem = selectedFile
    ? getFileStem(getDatasetNameFromFile(selectedFile.name) || getFileStem(selectedFile.name))
    : null;
  const modelOptions = modelOptionsQuery.data?.data ?? EMPTY_MODEL_OPTIONS;
  const selectedRunProfile = useMemo(
    () => getModelRunProfile(experimentChoice, modelOptions),
    [experimentChoice, modelOptions],
  );
  const expectedCount = Object.values(fieldRoles).filter((role) => role === 'expected').length;
  const inputFieldCount = Object.values(fieldRoles).filter((role) => role === 'text' || role === 'image').length;
  const datasetReady = parsedFile !== null && selectedFile !== null && expectedCount === 1 && inputFieldCount > 0;
  const rpmValue = readPositiveInteger(rpmLimit);
  const tpmValue = readPositiveInteger(tpmLimit);
  const concurrencyValue = readPositiveInteger(concurrency);
  const runConfigWithinModelLimits =
    selectedRunProfile === null ||
    (!isAbovePositiveLimit(rpmValue, selectedRunProfile.rpmLimit) &&
      !isAbovePositiveLimit(tpmValue, selectedRunProfile.tpmLimit) &&
      !isAbovePositiveLimit(concurrencyValue, selectedRunProfile.concurrencyLimit));
  const configReady =
    taskDescription.trim().length > 0 &&
    readPositiveInteger(maxRounds) !== null &&
    readPositiveInteger(samplingRounds) !== null &&
    readPositiveInteger(samplesPerRound) !== null &&
    readNonnegativeNumber(temperature) !== null &&
    rpmValue !== null &&
    tpmValue !== null &&
    concurrencyValue !== null &&
    readPositiveInteger(sampleTimeoutSeconds) !== null &&
    readNonnegativeNumber(goalTarget) !== null &&
    runConfigWithinModelLimits;
  const isStarting = isSubmitting || createQuickStart.isPending;
  const canSubmit = datasetReady && configReady && !isStarting;
  const isDatasetTransferRunning = uploadProgress.progress?.status === 'running';
  const datasetProgressValue =
    uploadProgress.progress?.percent !== null && uploadProgress.progress?.percent !== undefined
      ? Math.round(uploadProgress.progress.percent)
      : parsedFile
        ? 100
        : 0;
  const datasetTransferFooterTitle =
    uploadProgress.progress?.phase === 'processing'
      ? t('quickStart.footer.datasetProcessing')
      : t('quickStart.footer.datasetImporting');

  useEffect(() => {
    if (!isDatasetTransferRunning) {
      didScrollToDatasetImportRef.current = false;
      return;
    }
    if (didScrollToDatasetImportRef.current) return;

    didScrollToDatasetImportRef.current = true;
    datasetSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isDatasetTransferRunning]);

  useEffect(() => {
    if (!isSubmitting) return undefined;

    // Tab close / refresh while the single upload is in flight: warn before losing it.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isSubmitting]);

  useEffect(
    () => () => {
      importAbortRef.current?.abort();
    },
    [],
  );

  const optionsLoading = useDelayedLoading(modelOptionsQuery.isLoading && !modelOptionsQuery.data);
  if (optionsLoading) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1360px] px-4 py-6 pb-28 sm:px-6 lg:px-8" data-testid="quick-start-page">
          <PlatformLoader className="min-h-[560px]" />
        </div>
      </Main>
    );
  }

  const applyExperimentRunProfile = (profile: ModelRunProfile) => {
    setRpmLimit(String(runDefaultFromModelLimit(profile.rpmLimit, QUICK_START_DEFAULT_RPM_LIMIT)));
    setTpmLimit(String(runDefaultFromModelLimit(profile.tpmLimit, QUICK_START_DEFAULT_TPM_LIMIT)));
    setConcurrency(String(runDefaultFromModelLimit(profile.concurrencyLimit, QUICK_START_DEFAULT_CONCURRENCY)));
  };

  const handleExperimentChoiceChange = (nextChoice: ModelChoice) => {
    const previousSignature = selectedRunProfile?.signature ?? null;
    const nextProfile = getModelRunProfile(nextChoice, modelOptions);
    setExperimentChoice(nextChoice);
    if (nextProfile && nextProfile.signature !== previousSignature) {
      applyExperimentRunProfile(nextProfile);
    }
  };

  const upperLimitLabel = (limit: number | null | undefined) =>
    formatTemplate(t('quickStart.advanced.upperLimit'), {
      limit: limit === null || limit === undefined ? '-' : formatLimitValue(limit, t('quickStart.advanced.unlimited')),
    });

  const handlePromptLanguageChange = (nextLanguage: PromptLanguage) => {
    const previousLanguage = promptLanguage;
    setPromptLanguage(nextLanguage);
    if (!selectedFileStem) return;

    const previousOptimizationDefault = getDefaultOptimizationName(previousLanguage, selectedFileStem);
    setOptimizationName((current) =>
      current.length === 0 || current === previousOptimizationDefault
        ? getDefaultOptimizationName(nextLanguage, selectedFileStem)
        : current,
    );
  };

  const handleDatasetFile = async (file: File) => {
    setSelectedFile(null);
    setParsedFile(null);
    setParseError(null);
    uploadProgress.reset();
    setPreviewPageIndex(0);

    try {
      const fileSizeError = getDatasetUploadFileSizeError(file, datasetUploadMaxBytes);
      if (fileSizeError) throw new Error(fileSizeError);
      const parsed = await parseDatasetPreview(file);
      setSelectedFile(file);
      setParsedFile(parsed);
      setFieldRoles(
        normalizeExpectedRoles(
          Object.fromEntries(parsed.columns.map((column) => [column, inferRole(column, parsed.samples[0]?.[column])])),
        ),
      );
      const stem = getFileStem(getDatasetNameFromFile(file.name) || getFileStem(file.name));
      setOptimizationName((current) => current || getDefaultOptimizationName(promptLanguage, stem));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'parse_failed');
      setFieldRoles({});
    }
  };

  const updateFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    await handleDatasetFile(file);
  };

  const handleDatasetDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingDataset(true);
  };

  const handleDatasetDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingDataset(false);
    }
  };

  const handleDatasetDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingDataset(false);
    if (droppedSelectionContainsDirectory(event.dataTransfer)) {
      setSelectedFile(null);
      setParsedFile(null);
      setParseError('single_file_only');
      setFieldRoles({});
      return;
    }
    const files = getDroppedFiles(event.dataTransfer);
    if (files.length !== 1) {
      setSelectedFile(null);
      setParsedFile(null);
      setParseError('single_file_only');
      setFieldRoles({});
      return;
    }
    const file = files[0] ?? null;
    if (!file) return;
    await handleDatasetFile(file);
  };

  const importQuickStartDataset = async (fieldMappings: DatasetFieldMappingDto[], file: File) => {
    const totalBytes = Math.max(1, file.size);
    const controller = new AbortController();
    const metadata: DatasetUploadMetadataDto = {
      name: getDatasetNameFromFile(file.name) || getFileStem(file.name),
      description: taskDescription.trim() || null,
      fieldMappings,
      sourceFormat: toUploadSourceFormat(file.name),
      fileName: file.name,
    };

    importAbortRef.current = controller;
    uploadProgress.start(t('datasets.transfer.uploadTitle'), totalBytes, t('datasets.transfer.uploadDescription'));
    try {
      // Goes through the dataset upload adapter (OSS default = multipart client; a replacement
      // implementation can swap the transport) so Quick Start reuses the same seam as the upload page.
      const result = await uploadDataset(projectId, file, metadata, {
        signal: controller.signal,
        onProgress: (progress) => {
          uploadProgress.update(progress);
          if (progress.totalBytes !== null && progress.loadedBytes >= progress.totalBytes) {
            uploadProgress.setMessage(
              t('datasets.transfer.processingTitle'),
              t('datasets.transfer.processingDescription'),
              undefined,
              'processing',
            );
          }
        },
      });

      if (!result.datasetId) throw new Error('quick_start_dataset_import_failed');
      uploadProgress.complete(totalBytes);
      return result.datasetId;
    } catch (error) {
      uploadProgress.fail();
      throw error;
    } finally {
      importAbortRef.current = null;
    }
  };

  const submit = async () => {
    setSubmitError(null);
    if (!parsedFile || !selectedFile || !canSubmit) return;

    const experimentRef = buildModelRef(experimentChoice);
    if (!experimentRef.ok) {
      setSubmitError(t(experimentRef.errorKey));
      return;
    }
    const analysisRef = analysisSameAsExperiment ? experimentRef : buildModelRef(analysisChoice);
    if (!analysisRef.ok) {
      setSubmitError(t(analysisRef.errorKey));
      return;
    }

    const maxRoundsValue = readPositiveInteger(maxRounds);
    const samplingRoundsValue = readPositiveInteger(samplingRounds);
    const samplesPerRoundValue = readPositiveInteger(samplesPerRound);
    const temperatureValue = readNonnegativeNumber(temperature);
    const rpmValue = readPositiveInteger(rpmLimit);
    const tpmValue = readPositiveInteger(tpmLimit);
    const concurrencyValue = readPositiveInteger(concurrency);
    const timeoutValue = readPositiveInteger(sampleTimeoutSeconds);
    const goalTargetValue = readNonnegativeNumber(goalTarget);
    if (
      maxRoundsValue === null ||
      samplingRoundsValue === null ||
      samplesPerRoundValue === null ||
      temperatureValue === null ||
      rpmValue === null ||
      tpmValue === null ||
      concurrencyValue === null ||
      timeoutValue === null ||
      goalTargetValue === null
    ) {
      setSubmitError(t('common.formError.invalidNumber'));
      return;
    }
    if (!runConfigWithinModelLimits) {
      setSubmitError(t('quickStart.advanced.limitExceeded'));
      return;
    }

    const fieldMappings: DatasetFieldMappingDto[] = parsedFile.columns.map((column) => ({
      name: column,
      role: fieldRoles[column] ?? 'metadata',
    }));
    const uploadSource = {
      fileName: selectedFile.name,
      fileSizeBytes: selectedFile.size,
      contentType: selectedFile.type || undefined,
    };

    setIsSubmitting(true);
    try {
      const datasetId = await importQuickStartDataset(fieldMappings, selectedFile);
      const body: CreateQuickStartDto = {
        optimizationName: optimizationName.trim() || undefined,
        projectDescription: taskDescription.trim(),
        taskDescription: taskDescription.trim(),
        promptLanguage,
        dataset: {
          kind: 'imported',
          datasetId,
          name: getDatasetNameFromFile(selectedFile.name) || getFileStem(selectedFile.name),
          uploadSource,
          fieldMappings,
        },
        experimentModel: experimentRef.ref,
        analysisModel: analysisRef.ref,
        goals: [
          {
            metric: goalMetric,
            comparator: goalComparator,
            target: Math.min(1, goalTargetValue),
            scope: goalMetric === 'accuracy' ? 'overall' : goalScope.trim() || 'overall',
          },
        ],
        loopLimits: { maxRounds: maxRoundsValue, stopAfterNoImprovementRounds: 0 },
        runConfig: {
          temperature: Math.min(2, temperatureValue),
          rpmLimit: rpmValue,
          tpmLimit: tpmValue,
          concurrency: concurrencyValue,
          sampleTimeoutSeconds: timeoutValue,
        },
        strategyConfig: {
          initialSamplingRounds: samplingRoundsValue,
          initialSamplesPerRound: samplesPerRoundValue,
        },
      };
      const result = await createQuickStart.mutateAsync(body);
      router.push(`/optimizations/${result.optimizationId}`);
    } catch (error) {
      setSubmitError(getApiErrorMessage(error) ?? t('common.loadFailedRefresh'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1360px] px-4 py-6 pb-28 sm:px-6 lg:px-8" data-testid="quick-start-page">
        <div className="mb-1 font-mono text-[11.5px] text-muted-foreground">
          <Link className="hover:text-foreground" href="/dashboard">
            {t('dashboard.title')}
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">{t('quickStart.title')}</span>
        </div>
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('quickStart.title')}</h1>
            <p className="mt-1 max-w-3xl text-[12.5px] text-muted-foreground">{t('quickStart.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href="/dashboard">
                <ArrowLeft className="size-4" />
                {t('quickStart.back')}
              </Link>
            </Button>
            <Button type="button" size="sm" className="h-9" disabled={!canSubmit} onClick={submit}>
              {isStarting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {isStarting ? t('quickStart.starting') : t('quickStart.start')}
            </Button>
          </div>
        </div>

        {submitError && (
          <div className="mb-4 flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {submitError}
          </div>
        )}

        <div className="grid gap-4">
          <Section
            number={1}
            title={t('quickStart.model.title')}
            hint={t('quickStart.model.hint')}
            complete={
              buildModelRef(experimentChoice).ok && (analysisSameAsExperiment || buildModelRef(analysisChoice).ok)
            }
          >
            {modelOptionsQuery.isError && (
              <div className="mb-3 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {t('quickStart.model.loadFailed')}
              </div>
            )}
            <div className="space-y-3">
              <ModelPicker
                title={t('quickStart.model.experimentTitle')}
                choice={experimentChoice}
                onChange={handleExperimentChoiceChange}
                modelOptions={modelOptions}
              />
              <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={analysisSameAsExperiment}
                  onChange={(event) => setAnalysisSameAsExperiment(event.target.checked)}
                  className="size-4 accent-primary"
                />
                <span>{t('quickStart.model.sameAnalysis')}</span>
              </label>
              {!analysisSameAsExperiment && (
                <ModelPicker
                  title={t('quickStart.model.analysisTitle')}
                  choice={analysisChoice}
                  onChange={setAnalysisChoice}
                  modelOptions={modelOptions}
                />
              )}
            </div>
          </Section>

          <div ref={datasetSectionRef} className="scroll-mt-6">
            <Section
              number={2}
              title={t('quickStart.dataset.title')}
              hint={t('quickStart.dataset.hint')}
              complete={datasetReady}
            >
              <div className="space-y-4">
                <DatasetUploadFileDropzone
                  fileInputId="quick-start-dataset-file"
                  fileInputRef={fileInputRef}
                  selectedFile={selectedFile}
                  parsedFile={parsedFile}
                  isDragOver={isDraggingDataset}
                  progressValue={datasetProgressValue}
                  sampleCountLabel={`${parsedFile?.samples.length ?? 0} ${t('datasets.samples')}`}
                  statusLabel={isDatasetTransferRunning ? datasetTransferFooterTitle : undefined}
                  disabled={isStarting}
                  onOpenFilePicker={() => fileInputRef.current?.click()}
                  onFileInputChange={updateFileInput}
                  onDragEnter={handleDatasetDragOver}
                  onDragOver={handleDatasetDragOver}
                  onDragLeave={handleDatasetDragLeave}
                  onDrop={handleDatasetDrop}
                />

                <DatasetUploadParseErrorBanner parseError={parseError} maxBytes={datasetUploadMaxBytes} />

                {InjectedProgressPanel ? (
                  // A stable contract-provided component (from context, not created per render), so this never
                  // remounts; the static-components heuristic can't see that it comes from WebContracts.
                  // eslint-disable-next-line react-hooks/static-components
                  <InjectedProgressPanel progress={uploadProgress.progress} />
                ) : (
                  <DatasetTransferProgressPanel progress={uploadProgress.progress} />
                )}

                {parsedFile && expectedCount !== 1 && (
                  <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                    {t('quickStart.dataset.expectedRequired')}
                  </div>
                )}
                {parsedFile && inputFieldCount === 0 && (
                  <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                    {t('quickStart.dataset.inputRequired')}
                  </div>
                )}

                <DatasetPreviewAndMappingPanel
                  parsedFile={parsedFile}
                  fieldRoles={fieldRoles}
                  previewPageIndex={previewPageIndex}
                  sampleCountLabel={`${parsedFile?.samples.length ?? 0} ${t('datasets.samples')}`}
                  emptyLabel={t('quickStart.dataset.empty')}
                  showFieldSelection={false}
                  onPreviewPageIndexChange={setPreviewPageIndex}
                  onRoleChange={(column, role) =>
                    setFieldRoles((current) =>
                      normalizeExpectedRoles(
                        {
                          ...current,
                          [column]: role,
                        },
                        column,
                      ),
                    )
                  }
                />
              </div>
            </Section>
          </div>

          <Section
            number={3}
            title={t('quickStart.optimization.title')}
            hint={t('quickStart.optimization.hint')}
            complete={configReady}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <MiniField label={t('quickStart.optimization.name')}>
                  <Input
                    value={optimizationName}
                    onChange={(event) => setOptimizationName(event.target.value)}
                    placeholder={t('quickStart.optimization.namePlaceholder')}
                  />
                </MiniField>
              </div>
              <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
                <MiniField label={t('quickStart.goal.metric')}>
                  <select
                    value={goalMetric}
                    onChange={(event) => {
                      const nextMetric = event.target.value as QuickStartGoalMetric;
                      setGoalMetric(nextMetric);
                      if (nextMetric === 'accuracy') setGoalScope('overall');
                    }}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {GOAL_METRIC_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </MiniField>
                <MiniField label={t('quickStart.goal.comparator')}>
                  <select
                    value={goalComparator}
                    onChange={(event) => setGoalComparator(event.target.value as QuickStartGoalComparator)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {GOAL_COMPARATOR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </MiniField>
                <MiniField label={t('quickStart.goal.target')}>
                  <Input
                    inputMode="decimal"
                    value={goalTarget}
                    onChange={(event) => setGoalTarget(event.target.value)}
                  />
                </MiniField>
              </div>
              <div className="md:col-span-2">
                <MiniField label={t('quickStart.goal.scope')}>
                  <Input
                    value={goalMetric === 'accuracy' ? t('quickStart.goal.scopeOverall') : goalScope}
                    disabled={goalMetric === 'accuracy'}
                    onChange={(event) => setGoalScope(event.target.value)}
                    placeholder={t('quickStart.goal.scopePlaceholder')}
                  />
                </MiniField>
              </div>
              <div className="md:col-span-2">
                <PromptLanguageSelect
                  value={promptLanguage}
                  onChange={handlePromptLanguageChange}
                  helpKey="quickStart.promptLanguageHelp"
                  className="max-w-[420px]"
                  triggerClassName="h-8"
                />
              </div>
              <div className="md:col-span-2">
                <MiniField label={t('quickStart.taskDescription')} required help={t('quickStart.taskDescriptionHelp')}>
                  <textarea
                    value={taskDescription}
                    onChange={(event) => setTaskDescription(event.target.value)}
                    placeholder={t('quickStart.taskDescriptionPlaceholder')}
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </MiniField>
              </div>
              <MiniField label={t('quickStart.optimization.maxRounds')}>
                <Input inputMode="numeric" value={maxRounds} onChange={(event) => setMaxRounds(event.target.value)} />
              </MiniField>
            </div>
          </Section>

          <Section number={4} title={t('quickStart.advanced.title')}>
            <div className="rounded-md border bg-background">
              <div className="border-b px-3 py-2 text-[11.5px] text-muted-foreground">
                {selectedRunProfile
                  ? formatTemplate(t('quickStart.advanced.fromModel'), { model: selectedRunProfile.name })
                  : t('quickStart.advanced.modelUnavailable')}
              </div>
              <div className="grid gap-3 p-3 md:grid-cols-3">
                <MiniField label={t('quickStart.advanced.samplingRounds')}>
                  <Input
                    inputMode="numeric"
                    value={samplingRounds}
                    onChange={(event) => setSamplingRounds(event.target.value)}
                  />
                </MiniField>
                <MiniField label={t('quickStart.advanced.samplesPerRound')}>
                  <Input
                    inputMode="numeric"
                    value={samplesPerRound}
                    onChange={(event) => setSamplesPerRound(event.target.value)}
                  />
                </MiniField>
                <MiniField label={t('quickStart.advanced.temperature')}>
                  <Input
                    inputMode="decimal"
                    value={temperature}
                    onChange={(event) => setTemperature(event.target.value)}
                  />
                </MiniField>
                <MiniField label="RPM" aside={upperLimitLabel(selectedRunProfile?.rpmLimit)}>
                  <Input inputMode="numeric" value={rpmLimit} onChange={(event) => setRpmLimit(event.target.value)} />
                </MiniField>
                <MiniField label="TPM" aside={upperLimitLabel(selectedRunProfile?.tpmLimit)}>
                  <Input inputMode="numeric" value={tpmLimit} onChange={(event) => setTpmLimit(event.target.value)} />
                </MiniField>
                <MiniField
                  label={t('quickStart.advanced.concurrency')}
                  aside={upperLimitLabel(selectedRunProfile?.concurrencyLimit)}
                >
                  <Input
                    inputMode="numeric"
                    value={concurrency}
                    onChange={(event) => setConcurrency(event.target.value)}
                  />
                </MiniField>
                <MiniField label={t('quickStart.advanced.sampleTimeout')}>
                  <Input
                    inputMode="numeric"
                    value={sampleTimeoutSeconds}
                    onChange={(event) => setSampleTimeoutSeconds(event.target.value)}
                  />
                </MiniField>
              </div>
            </div>
            {!runConfigWithinModelLimits && (
              <div className="mt-3 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {t('quickStart.advanced.limitExceeded')}
              </div>
            )}
            <div className="mt-4 rounded-md border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
              {t('quickStart.advanced.defaults')}
            </div>
          </Section>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:left-[var(--sidebar-width)]">
          <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {isDatasetTransferRunning ? (
              <div className="flex flex-col gap-0.5 text-[12px] sm:flex-row sm:items-center sm:gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {datasetTransferFooterTitle}
                </span>
                <span className="text-muted-foreground">{t('quickStart.footer.datasetTransferHelp')}</span>
              </div>
            ) : (
              <div className="text-[12px] text-muted-foreground">
                {datasetReady ? t('quickStart.footer.datasetReady') : t('quickStart.footer.datasetPending')}
                <ChevronRight className="mx-1 inline size-3" />
                {configReady ? t('quickStart.footer.configReady') : t('quickStart.footer.configPending')}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard">{t('common.cancel')}</Link>
              </Button>
              <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
                {isStarting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {isStarting ? t('quickStart.starting') : t('quickStart.start')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Main>
  );
}
