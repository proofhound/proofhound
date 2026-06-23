'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useMemo, useState } from 'react';
import type { CreateExperimentDto, PromptListItemDto } from '@proofhound/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Check,
  ChevronDown,
  Link2,
  Loader2,
  Play,
  Search,
  X,
} from 'lucide-react';
import { Button, Input, cn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { PromptVersionPickerRow, PromptVersionPickerTag, RuntimeConcurrencyInfoIcon } from '../../components';
import { useDatasets } from '../../hooks';
import { useCreateExperiment, useExperiments } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useProjectModels } from '../../hooks';
import { usePrompt, usePrompts } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage, isProjectNameTaken } from '../../lib';
import { capConcurrencyValue, resolveEffectiveConcurrencyLimit, useRuntimeLimits } from '../../providers';
import type { PromptVariableType } from '../prompts/prompt-model';
import { renderPromptPreviewParts } from '../prompts/prompt-preview-parts';
import { VARIABLE_TONE_CLASSES } from '../prompts/prompt-ui';
import {
  type ExperimentDatasetOption,
  type ExperimentModelOption,
  type ExperimentPromptOption,
} from './experiment-view-model';
import { experimentTone } from './experiment-theme';
import {
  estimateExperimentRun,
  getModelImageEncodings,
  hasImagePromptVariables,
  isExperimentRunParamsComplete,
  mapDatasetToOption,
  mapProjectModelToOption,
  mapPromptVersionToOption,
  normalizeTemperature,
  resolveExperimentDatasetId,
  validateDatasetVariableCoverage,
  type EncodingMode,
} from './experiment-option-adapter';
import { isExperimentReadinessChecking } from './experiment-new-readiness';

interface ExperimentNewPageProps {
  projectId: string;
  initialPromptId?: string | null;
  initialPromptVersionId?: string | null;
  initialDatasetId?: string | null;
  initialModelId?: string | null;
  initialDatasetName?: string | null;
  initialDatasetSampleCount?: string | null;
  initialName?: string | null;
  initialDescription?: string | null;
  initialConcurrency?: string | null;
  initialRpmLimit?: string | null;
  initialTpmLimit?: string | null;
  initialTemperature?: string | null;
  initialSampleTimeoutSeconds?: string | null;
  initialRetries?: string | null;
  initialImageEncoding?: string | null;
}

function buildDefaultExperimentName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `exp-${yyyy}-${mm}${dd}-`;
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function parsePositiveInteger(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonnegativeIntegerText(value: string | null | undefined, fallback: string) {
  if (value == null || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : fallback;
}

function parsePositiveIntegerText(value: string | null | undefined, fallback: string) {
  if (value == null || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : fallback;
}

function parseTemperature(value: string | null | undefined) {
  if (value == null || value.trim().length === 0) return 0.3;
  const parsed = Number(value);
  return normalizeTemperature(Number.isFinite(parsed) ? parsed : 0.3);
}

function parseEncoding(value: string | null | undefined): EncodingMode {
  return value === 'base64' ? 'base64' : 'url';
}

function integerFromText(value: string) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : null;
}

function formatModelLimit(limit: number) {
  return limit === -1 ? '∞' : String(limit);
}

function StepHeading({ index, label, complete = true }: { index: number; label: string; complete?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[13px] font-semibold">
      <span
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-full border font-mono text-[11px]',
          complete ? experimentTone.positive.pill : 'border-border bg-muted text-muted-foreground',
        )}
      >
        {index}
      </span>
      {label}
    </div>
  );
}

function MiniSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-[220px]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 pl-7 text-xs"
      />
    </div>
  );
}

function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'info' | 'warn' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10.5px]',
        tone === 'info' && experimentTone.info.pill,
        tone === 'warn' && experimentTone.warning.pill,
        tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-full border',
        checked ? 'border-primary bg-primary/10' : 'border-border bg-background',
      )}
      aria-hidden="true"
    >
      {checked && <span className="size-2 rounded-full bg-primary" />}
    </span>
  );
}

function EmptyState({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mx-auto mt-1 max-w-[320px] leading-relaxed">{description}</div>
      <Button asChild type="button" variant="outline" size="sm" className="mt-3 h-8">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  );
}

function PromptNameRow({
  prompt,
  selected,
  onSelect,
  testId,
}: {
  prompt: PromptListItemDto;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const latestVersion = `v${prompt.latestVersionNumber}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-primary/5',
      )}
      aria-pressed={selected}
    >
      <Radio checked={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold">{prompt.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px]',
              experimentTone.positive.bg,
              experimentTone.positive.text,
            )}
          >
            {formatTemplate(t('experiments.new.section.promptLatestVersion'), { version: latestVersion })}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Tag>
            {formatTemplate(t('experiments.new.section.promptVersionCount'), { count: prompt.latestVersionNumber })}
          </Tag>
          <Tag>
            {prompt.createdByDisplayName ? `@${prompt.createdByDisplayName}` : '@unknown'} ·{' '}
            {formatDateTime(prompt.updatedAt)}
          </Tag>
        </div>
      </div>
    </button>
  );
}

function PromptVersionRow({
  option,
  selected,
  onSelect,
}: {
  option: ExperimentPromptOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <PromptVersionPickerRow
      version={option.version}
      status={option.status}
      variables={option.variables}
      selected={selected}
      onSelect={onSelect}
      badges={
        option.isLatest ? (
          <PromptVersionPickerTag tone="positive">{t('experiments.new.section.recommended')}</PromptVersionPickerTag>
        ) : null
      }
      createdAt={option.updatedAgo}
    />
  );
}

function PromptVersionPreview({ option }: { option: ExperimentPromptOption }) {
  const { t } = useI18n();
  const previewParts = useMemo(
    () =>
      renderPromptPreviewParts(
        option.promptPreview,
        option.variables.map((variable) => ({
          name: variable.name,
          type: variable.type as PromptVariableType,
        })),
      ),
    [option],
  );

  return (
    <div className="mt-3" data-testid="experiment-new-prompt-preview">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {t('experiments.new.section.promptPreview')}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {option.name} · {option.version}
          </span>
        </div>
        <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
          {previewParts.map((part, index) => {
            if (part.kind === 'text') return <span key={index}>{part.value}</span>;
            const tone =
              (part.varType ? VARIABLE_TONE_CLASSES[part.varType] : undefined) ??
              'border-muted-foreground/30 bg-muted/40 text-muted-foreground';
            return (
              <span
                key={index}
                className={cn('inline rounded border px-1 font-mono text-[11px]', tone)}
                data-variable-name={part.name}
              >
                {part.value}
              </span>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

function DatasetCard({
  option,
  selected,
  defaultLinkLabel,
  onSelect,
  testId,
}: {
  option: ExperimentDatasetOption;
  selected: boolean;
  defaultLinkLabel?: string;
  onSelect: () => void;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-primary/5',
      )}
      aria-pressed={selected}
    >
      <Radio checked={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold">{option.name}</span>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {option.sampleCount.toLocaleString('en-US').replace(/,/g, ' ')} {t('experiments.sampleSuffix')}
          </span>
          {defaultLinkLabel && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px]',
                experimentTone.info.pill,
              )}
              title={defaultLinkLabel}
            >
              <Link2 className="size-2.5" />
              {t('experiments.new.section.defaultLink')}
            </span>
          )}
        </div>
        <div className="mt-1 text-[12px] text-muted-foreground">{option.description}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {option.expectedField && (
            <Tag>{formatTemplate(t('experiments.new.section.datasetExpected'), { field: option.expectedField })}</Tag>
          )}
          <Tag>{formatTemplate(t('experiments.new.section.datasetInputs'), { count: option.inputFieldCount })}</Tag>
          <Tag>{formatTemplate(t('experiments.new.section.datasetUpdatedAt'), { at: option.updatedAgo })}</Tag>
        </div>
      </div>
    </button>
  );
}

function ModelRow({
  option,
  selected,
  onSelect,
  testId,
}: {
  option: ExperimentModelOption;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'grid w-full grid-cols-[20px_minmax(160px,1.5fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] items-center gap-3 border-b px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-primary/5',
      )}
      aria-pressed={selected}
    >
      <Radio checked={selected} />
      <div className="min-w-0">
        <div className="font-mono text-[13px] font-semibold">{option.name}</div>
        <div className="text-[11px] text-muted-foreground">{option.provider}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag>{formatTemplate(t('experiments.new.section.modelCap.ctx'), { value: option.contextWindow })}</Tag>
        {option.capabilities.map((cap) => (
          <Tag key={cap} tone={cap === 'vision' ? 'info' : 'neutral'}>
            {t(`experiments.new.section.modelCap.${cap}` as TranslationKey)}
          </Tag>
        ))}
      </div>
      <div className="font-mono text-[12px] text-muted-foreground">
        {formatTemplate(t('experiments.new.section.modelRpmTpm'), { rpm: option.rpm, tpm: option.tpm })}
      </div>
      <div className="text-right font-mono text-[12.5px]">
        {formatTemplate(t('experiments.new.section.modelPrice'), { price: option.pricePer1Mt })}
      </div>
    </button>
  );
}

function SliderRow({
  value,
  min,
  max,
  step = 1,
  ariaLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabel?: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        className="flex-1 accent-primary"
      />
      <span className="w-12 text-right font-mono text-[13px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function EncodingOption({
  active,
  disabled,
  onClick,
  title,
  description,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
        active ? 'border-primary bg-primary/5' : 'border-border bg-background',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      aria-pressed={active}
    >
      <span className="flex items-center gap-2 text-[12.5px] font-semibold">
        <Radio checked={active} />
        {title}
      </span>
      <span className="pl-6 text-[11.5px] text-muted-foreground">{description}</span>
    </button>
  );
}

function CheckItem({
  state,
  title,
  detail,
}: {
  state: 'ok' | 'warn' | 'error' | 'pending';
  title: string;
  detail: string;
}) {
  return (
    <div
      role={state === 'error' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2.5 rounded-md border-l-2 px-3 py-2 text-[12px]',
        state === 'pending' && 'border-border bg-muted text-muted-foreground',
        state === 'ok' &&
          cn(
            experimentTone.positive.border,
            'bg-[color-mix(in_srgb,var(--status-running-bg)_60%,var(--card))]',
            experimentTone.positive.text,
          ),
        state === 'warn' &&
          cn(
            experimentTone.warning.border,
            'bg-[color-mix(in_srgb,var(--status-pending-bg)_60%,var(--card))]',
            experimentTone.warning.text,
          ),
        state === 'error' && cn(experimentTone.danger.border, experimentTone.danger.bg, experimentTone.danger.text),
      )}
    >
      <span className="mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-full border bg-background text-current">
        {state === 'pending' && <Loader2 className="size-3 animate-spin" />}
        {state === 'ok' && <Check className="size-3" />}
        {state === 'warn' && <AlertTriangle className="size-3" />}
        {state === 'error' && <X className="size-3" />}
      </span>
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 font-mono text-[11px] opacity-80">{detail}</div>
      </div>
    </div>
  );
}

export function ExperimentNewPage(props: ExperimentNewPageProps) {
  const {
    projectId,
    initialPromptId,
    initialPromptVersionId,
    initialDatasetId,
    initialModelId,
    initialName,
    initialDescription,
    initialConcurrency,
    initialRpmLimit,
    initialTpmLimit,
    initialTemperature,
    initialSampleTimeoutSeconds,
    initialRetries,
    initialImageEncoding,
  } = props;
  const { t } = useI18n();
  const runtimeLimits = useRuntimeLimits();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();
  const promptsQuery = usePrompts(projectId);
  const datasetsQuery = useDatasets(projectId);
  const modelsQuery = useProjectModels(projectId, { autoRefresh: false });
  const experimentsQuery = useExperiments(projectId);
  const createExperiment = useCreateExperiment(projectId);

  const prompts = useMemo(() => promptsQuery.data?.data ?? [], [promptsQuery.data]);
  const datasets = useMemo(
    () => (datasetsQuery.data?.data ?? []).map((dataset) => mapDatasetToOption(dataset, formatDateTime)),
    [datasetsQuery.data, formatDateTime],
  );
  const models = useMemo(() => (modelsQuery.data?.data ?? []).map(mapProjectModelToOption), [modelsQuery.data]);
  const experiments = useMemo(() => experimentsQuery.data?.data ?? [], [experimentsQuery.data]);
  const datasetDtos = useMemo(() => datasetsQuery.data?.data ?? [], [datasetsQuery.data]);

  const [name, setName] = useState(initialName ?? buildDefaultExperimentName());
  const [description, setDescription] = useState(initialDescription ?? '');
  const [promptSearch, setPromptSearch] = useState('');
  const [datasetSearch, setDatasetSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [selectedPromptListId, setSelectedPromptListId] = useState(initialPromptId ?? '');
  const [selectedPromptVersionId, setSelectedPromptVersionId] = useState(initialPromptVersionId ?? '');
  const [selectedDatasetId, setSelectedDatasetId] = useState(initialDatasetId ?? '');
  const [datasetTouched, setDatasetTouched] = useState(Boolean(initialDatasetId));
  const [selectedModelId, setSelectedModelId] = useState(initialModelId ?? '');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [concurrency, setConcurrency] = useState(() =>
    capConcurrencyValue(parsePositiveInteger(initialConcurrency, 24), runtimeLimits.concurrency?.max),
  );
  const [rpm, setRpm] = useState(parsePositiveIntegerText(initialRpmLimit, ''));
  const [tpm, setTpm] = useState(parsePositiveIntegerText(initialTpmLimit, ''));
  const [temperature, setTemperature] = useState(parseTemperature(initialTemperature));
  const [timeoutSeconds, setTimeoutSeconds] = useState(parsePositiveIntegerText(initialSampleTimeoutSeconds, '20'));
  const [retries, setRetries] = useState(parseNonnegativeIntegerText(initialRetries, '2'));
  const [encoding, setEncoding] = useState<EncodingMode>(parseEncoding(initialImageEncoding));
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedPromptSummary = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptListId) ?? null,
    [prompts, selectedPromptListId],
  );
  const promptDetailQuery = usePrompt(projectId, selectedPromptSummary?.id ?? '');
  const promptsLoading = useDelayedLoading(promptsQuery.isLoading);
  const promptDetailLoading = useDelayedLoading(promptDetailQuery.isLoading);
  const datasetsLoading = useDelayedLoading(datasetsQuery.isLoading);
  const modelsLoading = useDelayedLoading(modelsQuery.isLoading);
  const promptVersions = useMemo(
    () =>
      promptDetailQuery.data
        ? promptDetailQuery.data.versions.map((version) =>
            mapPromptVersionToOption(promptDetailQuery.data, version, formatDateTime),
          )
        : [],
    [formatDateTime, promptDetailQuery.data],
  );
  const selectedPrompt = useMemo(
    () => promptVersions.find((option) => option.id === selectedPromptVersionId) ?? null,
    [promptVersions, selectedPromptVersionId],
  );
  const promptNeedsImages = useMemo(
    () => (selectedPrompt ? hasImagePromptVariables(selectedPrompt.variables) : false),
    [selectedPrompt],
  );
  const compatibleModels = useMemo(
    () =>
      promptNeedsImages ? models.filter((option) => getModelImageEncodings(option.imageCapability).length > 0) : models,
    [models, promptNeedsImages],
  );
  const selectedDataset = useMemo(
    () => datasets.find((option) => option.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  );
  const selectedDatasetDto = useMemo(
    () => datasetDtos.find((item) => item.id === selectedDatasetId) ?? null,
    [datasetDtos, selectedDatasetId],
  );
  const selectedModel = useMemo(
    () => compatibleModels.find((option) => option.id === selectedModelId) ?? null,
    [compatibleModels, selectedModelId],
  );
  const effectiveConcurrencyLimit = resolveEffectiveConcurrencyLimit(selectedModel?.concurrencyLimit, runtimeLimits);
  const concurrencyInputMax = effectiveConcurrencyLimit ?? 50;
  const effectiveConcurrency = capConcurrencyValue(concurrency, effectiveConcurrencyLimit);
  const recommendedConcurrency = Math.min(30, effectiveConcurrencyLimit ?? selectedModel?.concurrencyLimit ?? 30);
  const defaultDatasetForPrompt = useMemo(
    () =>
      selectedPrompt?.defaultDatasetId
        ? (datasets.find((option) => option.id === selectedPrompt.defaultDatasetId) ?? null)
        : null,
    [datasets, selectedPrompt],
  );

  const availableEncodings = useMemo(() => {
    if (!selectedModel) return [] as EncodingMode[];
    const modelEncodings = getModelImageEncodings(selectedModel.imageCapability);
    return modelEncodings.length > 0 ? modelEncodings : (['url', 'base64'] as EncodingMode[]);
  }, [selectedModel]);

  const [prevPromptsRef, setPrevPromptsRef] = useState(prompts);
  if (prevPromptsRef !== prompts) {
    setPrevPromptsRef(prompts);
    if (prompts.length > 0 && !(selectedPromptListId && prompts.some((prompt) => prompt.id === selectedPromptListId))) {
      const preferred = initialPromptId ? prompts.find((prompt) => prompt.id === initialPromptId) : null;
      setSelectedPromptListId((preferred ?? prompts[0]!).id);
    }
  }

  const [prevPromptVersionsRef, setPrevPromptVersionsRef] = useState(promptVersions);
  if (prevPromptVersionsRef !== promptVersions) {
    setPrevPromptVersionsRef(promptVersions);
    if (promptVersions.length === 0) {
      if (selectedPromptVersionId) setSelectedPromptVersionId('');
    } else if (!(selectedPromptVersionId && promptVersions.some((option) => option.id === selectedPromptVersionId))) {
      const preferred = initialPromptVersionId
        ? promptVersions.find((option) => option.id === initialPromptVersionId)
        : null;
      const latest = promptVersions.find((option) => option.isLatest);
      setSelectedPromptVersionId((preferred ?? latest ?? promptVersions[0]!).id);
    }
  }

  const datasetContextKey = `${datasetTouched ? '1' : '0'}|${selectedPrompt?.defaultDatasetId ?? ''}`;
  const [prevDatasetsRef, setPrevDatasetsRef] = useState(datasets);
  const [prevDatasetContextKey, setPrevDatasetContextKey] = useState(datasetContextKey);
  if (prevDatasetsRef !== datasets || prevDatasetContextKey !== datasetContextKey) {
    setPrevDatasetsRef(datasets);
    setPrevDatasetContextKey(datasetContextKey);
    const datasetIds = datasets.map((option) => option.id);
    if (datasetIds.length > 0) {
      if (!datasetTouched && selectedPrompt?.defaultDatasetId && datasetIds.includes(selectedPrompt.defaultDatasetId)) {
        if (selectedDatasetId !== selectedPrompt.defaultDatasetId) {
          setSelectedDatasetId(selectedPrompt.defaultDatasetId);
        }
      } else if (!(selectedDatasetId && datasetIds.includes(selectedDatasetId))) {
        const resolved = resolveExperimentDatasetId({
          explicitDatasetId: initialDatasetId,
          promptDefaultDatasetId: selectedPrompt?.defaultDatasetId,
          datasetIds,
        });
        if (resolved) setSelectedDatasetId(resolved);
      }
    }
  }

  const [prevCompatibleModelsRef, setPrevCompatibleModelsRef] = useState(compatibleModels);
  if (prevCompatibleModelsRef !== compatibleModels) {
    setPrevCompatibleModelsRef(compatibleModels);
    if (compatibleModels.length === 0) {
      if (selectedModelId) setSelectedModelId('');
    } else if (!(selectedModelId && compatibleModels.some((option) => option.id === selectedModelId))) {
      const preferred = initialModelId ? compatibleModels.find((option) => option.id === initialModelId) : null;
      setSelectedModelId((preferred ?? compatibleModels[0]!).id);
    }
  }

  const [prevSelectedModelRef, setPrevSelectedModelRef] = useState(selectedModel);
  if (prevSelectedModelRef !== selectedModel) {
    const previous = prevSelectedModelRef;
    setPrevSelectedModelRef(selectedModel);
    if (selectedModel) {
      const switched = Boolean(previous) && previous!.id !== selectedModel.id;
      if (switched) {
        setConcurrency(capConcurrencyValue(Math.min(30, selectedModel.concurrencyLimit), effectiveConcurrencyLimit));
        setRpm(String(selectedModel.rpmLimit));
        setTpm(String(selectedModel.tpmLimit));
      } else {
        if (effectiveConcurrencyLimit !== null && concurrency > effectiveConcurrencyLimit) {
          setConcurrency(effectiveConcurrencyLimit);
        }
        if (!rpm) setRpm(String(selectedModel.rpmLimit));
        if (!tpm) setTpm(String(selectedModel.tpmLimit));
      }
    }
  }

  const [prevEffectiveConcurrencyLimitRef, setPrevEffectiveConcurrencyLimitRef] = useState(effectiveConcurrencyLimit);
  if (prevEffectiveConcurrencyLimitRef !== effectiveConcurrencyLimit) {
    setPrevEffectiveConcurrencyLimitRef(effectiveConcurrencyLimit);
    if (effectiveConcurrencyLimit !== null && concurrency > effectiveConcurrencyLimit) {
      setConcurrency(effectiveConcurrencyLimit);
    }
  }

  const [prevAvailableEncodingsRef, setPrevAvailableEncodingsRef] = useState(availableEncodings);
  if (prevAvailableEncodingsRef !== availableEncodings) {
    setPrevAvailableEncodingsRef(availableEncodings);
    if (availableEncodings.length > 0 && !availableEncodings.includes(encoding)) {
      setEncoding(availableEncodings[0]!);
    }
  }

  const filteredPrompts = useMemo(() => {
    const query = promptSearch.trim().toLowerCase();
    if (!query) return prompts;
    return prompts.filter((prompt) =>
      [prompt.name, prompt.createdByDisplayName ?? '', `v${prompt.latestVersionNumber}`]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [promptSearch, prompts]);

  const filteredDatasets = useMemo(() => {
    const query = datasetSearch.trim().toLowerCase();
    if (!query) return datasets;
    return datasets.filter((option) => `${option.name} ${option.description}`.toLowerCase().includes(query));
  }, [datasetSearch, datasets]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return compatibleModels;
    return compatibleModels.filter((option) => `${option.name} ${option.provider}`.toLowerCase().includes(query));
  }, [compatibleModels, modelSearch]);

  const datasetCoverage = useMemo(() => {
    if (!selectedPrompt || !selectedDatasetDto) return null;
    return validateDatasetVariableCoverage({
      variables: selectedPrompt.variables,
      fieldSchema: selectedDatasetDto.fieldSchema,
    });
  }, [selectedDatasetDto, selectedPrompt]);

  const modelSupportsImages = selectedModel ? getModelImageEncodings(selectedModel.imageCapability).length > 0 : false;
  const visionUnsupported = promptNeedsImages && !modelSupportsImages;
  const datasetMismatch =
    Boolean(defaultDatasetForPrompt) && Boolean(selectedDataset) && selectedDataset?.id !== defaultDatasetForPrompt?.id;
  const rpmValue = integerFromText(rpm);
  const tpmValue = integerFromText(tpm);
  const timeoutValue = integerFromText(timeoutSeconds);
  const retriesValue = integerFromText(retries);
  const runParamsComplete = isExperimentRunParamsComplete({
    concurrency,
    rpm,
    tpm,
    temperature,
    timeoutSeconds,
    retries,
    encoding,
  });
  const estimate =
    selectedDataset && selectedModel
      ? estimateExperimentRun({
          totalSamples: selectedDataset.sampleCount,
          concurrency: effectiveConcurrency,
          rpmLimit: rpmValue ?? -1,
          inputPricePerMillion: selectedModel.inputPricePerMillion,
          outputPricePerMillion: selectedModel.outputPricePerMillion,
        })
      : null;
  const experimentNameTaken = useMemo(() => isProjectNameTaken(name, experiments), [experiments, name]);
  const readinessChecking = isExperimentReadinessChecking({
    dependenciesLoading:
      promptsQuery.isLoading || datasetsQuery.isLoading || modelsQuery.isLoading || experimentsQuery.isLoading,
    promptDetailLoading: promptDetailQuery.isLoading,
    promptsCount: prompts.length,
    promptVersionsCount: promptVersions.length,
    datasetsCount: datasets.length,
    compatibleModelsCount: compatibleModels.length,
    selectedPromptSummary,
    selectedPrompt,
    selectedDataset,
    selectedModel,
  });
  const blockingCount =
    (datasetCoverage && !datasetCoverage.ok ? 1 : 0) +
    (visionUnsupported ? 1 : 0) +
    (!runParamsComplete ? 1 : 0) +
    (experimentNameTaken ? 1 : 0) +
    (!selectedPrompt || !selectedDataset || !selectedModel || !name.trim() ? 1 : 0);
  const passedCount =
    (datasetCoverage?.ok ? 1 : 0) + (!visionUnsupported && selectedModel ? 1 : 0) + (runParamsComplete ? 1 : 0);
  const warningCount = datasetMismatch ? 1 : 0;
  const canSubmit =
    blockingCount === 0 &&
    Boolean(selectedPrompt && selectedDataset && selectedModel && name.trim() && !experimentNameTaken) &&
    !createExperiment.isPending;

  const handleSelectPrompt = (promptId: string) => {
    setSelectedPromptListId(promptId);
    setSelectedPromptVersionId('');
  };

  const handleCreate = () => {
    if (!selectedPrompt || !selectedDataset || !selectedModel || !name.trim()) return;
    if (experimentNameTaken) {
      setSubmitError(t('common.formError.nameTaken'));
      return;
    }
    if (!runParamsComplete || !rpmValue || !tpmValue || !timeoutValue || retriesValue === null) return;
    const payload: CreateExperimentDto = {
      name: name.trim(),
      promptVersionId: selectedPrompt.id,
      datasetId: selectedDataset.id,
      modelId: selectedModel.id,
      runConfig: {
        description: description.trim() || null,
        concurrency: effectiveConcurrency,
        rpmLimit: rpmValue,
        tpmLimit: tpmValue,
        temperature: normalizeTemperature(temperature),
        sampleTimeoutSeconds: timeoutValue,
        retries: retriesValue,
        imageEncoding: encoding,
      },
    };
    setSubmitError(null);
    createExperiment.mutate(payload, {
      onSuccess: (experiment) => router.push(`/experiments/${experiment.id}`),
      onError: (error) => {
        const message = getApiErrorMessage(error);
        setSubmitError(
          message === 'experiment_name_taken'
            ? t('common.formError.nameTaken')
            : (message ?? t('common.loadFailedRefresh')),
        );
      },
    });
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="experiment-new-page">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href={`/experiments`} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            {t('experiments.new.backToList')}
          </Link>
        </div>

        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('experiments.new.title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild type="button" variant="ghost" size="sm" className="h-9">
              <Link href={`/experiments`}>{t('experiments.new.cancel')}</Link>
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1"
              disabled={!canSubmit}
              onClick={handleCreate}
              data-testid="experiment-new-submit"
            >
              {createExperiment.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {createExperiment.isPending
                ? t('experiments.new.createAndStartLoading')
                : t('experiments.new.createAndStart')}
            </Button>
          </div>
        </div>

        {submitError && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="rounded-lg border bg-card p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-[12.5px] font-medium">
                    {t('experiments.new.basic.name')} <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-label={t('experiments.new.basic.name')}
                    aria-invalid={experimentNameTaken || undefined}
                    className="font-mono text-[13px]"
                    placeholder={t('experiments.new.basic.namePlaceholder')}
                    data-testid="experiment-new-name"
                  />
                  {experimentNameTaken ? (
                    <div className="text-[11px] text-destructive">{t('common.formError.nameTaken')}</div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">{t('experiments.new.basic.nameHelp')}</div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[12.5px] font-medium">{t('experiments.new.basic.description')}</label>
                  <Input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    aria-label={t('experiments.new.basic.description')}
                    placeholder={t('experiments.new.basic.descriptionPlaceholder')}
                  />
                  <div className="text-[11px] text-muted-foreground">{t('experiments.new.basic.descriptionHelp')}</div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border bg-card" data-testid="experiment-new-prompt-section">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                <StepHeading index={1} label={t('experiments.new.section.prompt')} />
                <MiniSearch
                  value={promptSearch}
                  onChange={setPromptSearch}
                  placeholder={t('experiments.new.section.searchPrompt')}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="border-b md:border-b-0 md:border-r" data-testid="experiment-new-prompt-name-column">
                  <div className="border-b px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t('experiments.new.section.promptColumn')}
                  </div>
                  {promptsLoading ? (
                    <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                      {t('experiments.new.loading.prompts')}
                    </div>
                  ) : prompts.length === 0 ? (
                    <EmptyState
                      title={t('experiments.new.empty.prompts.title')}
                      description={t('experiments.new.empty.prompts.desc')}
                      href={`/prompts`}
                      action={t('experiments.new.empty.prompts.cta')}
                    />
                  ) : filteredPrompts.length > 0 ? (
                    <div className="max-h-[360px] overflow-y-auto overflow-x-hidden px-2 py-1">
                      {filteredPrompts.map((prompt) => (
                        <PromptNameRow
                          key={prompt.id}
                          prompt={prompt}
                          selected={prompt.id === selectedPromptListId}
                          onSelect={() => handleSelectPrompt(prompt.id)}
                          testId={`experiment-new-prompt-row-${prompt.id}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                      {t('experiments.new.section.promptNoMatch')}
                    </div>
                  )}
                </div>
                <div data-testid="experiment-new-prompt-version-column">
                  <div className="border-b px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t('experiments.new.section.versionColumn')}
                  </div>
                  {promptDetailLoading ? (
                    <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                      {t('experiments.new.loading.versions')}
                    </div>
                  ) : promptVersions.length > 0 ? (
                    <div className="max-h-[360px] overflow-y-auto overflow-x-hidden px-2 py-1">
                      {promptVersions.map((option) => (
                        <div key={option.id} data-testid={`experiment-new-prompt-version-row-${option.id}`}>
                          <PromptVersionRow
                            option={option}
                            selected={option.id === selectedPromptVersionId}
                            onSelect={() => setSelectedPromptVersionId(option.id)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                      {t('experiments.new.empty.versions')}
                    </div>
                  )}
                </div>
              </div>
              {selectedPrompt && (
                <div className="border-t px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setShowPromptPreview((open) => !open)}
                    className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                    aria-expanded={showPromptPreview}
                  >
                    <ChevronDown className={cn('size-3.5 transition-transform', !showPromptPreview && '-rotate-90')} />
                    {t('experiments.new.section.viewPromptPreview')}
                  </button>
                  {showPromptPreview && <PromptVersionPreview option={selectedPrompt} />}
                </div>
              )}
            </section>

            <section className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                <StepHeading index={2} label={t('experiments.new.section.dataset')} />
                <MiniSearch
                  value={datasetSearch}
                  onChange={setDatasetSearch}
                  placeholder={t('experiments.new.section.searchDataset')}
                />
              </div>
              {datasetMismatch && defaultDatasetForPrompt && selectedDataset && (
                <div
                  className={cn(
                    'm-4 flex items-start gap-3 rounded-md border px-3 py-2 text-[12px]',
                    experimentTone.warning.pill,
                  )}
                >
                  <AlertTriangle className="mt-0.5 size-3.5 flex-none" />
                  <div className="flex-1">
                    {formatTemplate(t('experiments.new.section.datasetMismatch'), {
                      current: selectedDataset.name,
                      prompt: `${selectedPrompt?.name ?? ''} ${selectedPrompt?.version ?? ''}`,
                      expected: defaultDatasetForPrompt.name,
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      setDatasetTouched(true);
                      setSelectedDatasetId(defaultDatasetForPrompt.id);
                    }}
                  >
                    {t('experiments.new.section.useDefault')}
                  </Button>
                </div>
              )}
              <div className="px-2 py-1">
                {datasetsLoading ? (
                  <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                    {t('experiments.new.loading.datasets')}
                  </div>
                ) : datasets.length === 0 ? (
                  <EmptyState
                    title={t('experiments.new.empty.datasets.title')}
                    description={t('experiments.new.empty.datasets.desc')}
                    href={`/datasets/new`}
                    action={t('experiments.new.empty.datasets.cta')}
                  />
                ) : filteredDatasets.length > 0 ? (
                  <div className="max-h-[360px] overflow-y-auto overflow-x-hidden">
                    {filteredDatasets.map((option) => (
                      <DatasetCard
                        key={option.id}
                        option={option}
                        testId={`experiment-new-dataset-row-${option.id}`}
                        selected={option.id === selectedDatasetId}
                        defaultLinkLabel={
                          option.id === selectedPrompt?.defaultDatasetId
                            ? formatTemplate(t('experiments.new.section.defaultLinkTooltip'), {
                                prompt: `${selectedPrompt.name} ${selectedPrompt.version}`,
                              })
                            : undefined
                        }
                        onSelect={() => {
                          setDatasetTouched(true);
                          setSelectedDatasetId(option.id);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('common.noData')}</div>
                )}
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                <StepHeading index={3} label={t('experiments.new.section.model')} />
                <MiniSearch
                  value={modelSearch}
                  onChange={setModelSearch}
                  placeholder={t('experiments.new.section.searchModel')}
                />
              </div>
              <div>
                {modelsLoading ? (
                  <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                    {t('experiments.new.loading.models')}
                  </div>
                ) : models.length === 0 ? (
                  <EmptyState
                    title={t('experiments.new.empty.models.title')}
                    description={t('experiments.new.empty.models.desc')}
                    href={`/models/new`}
                    action={t('experiments.new.empty.models.cta')}
                  />
                ) : filteredModels.length > 0 ? (
                  <div className="max-h-[360px] overflow-y-auto overflow-x-hidden">
                    {filteredModels.map((option) => (
                      <ModelRow
                        key={option.id}
                        option={option}
                        selected={option.id === selectedModelId}
                        onSelect={() => setSelectedModelId(option.id)}
                        testId={`experiment-new-model-row-${option.id}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                    {t('experiments.new.section.modelNoMatch')}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <div className="flex items-center gap-3 border-b px-5 py-3">
                <StepHeading index={4} label={t('experiments.new.section.runparams')} complete={runParamsComplete} />
              </div>
              <div className="space-y-5 p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('experiments.new.params.concurrency')}
                      </label>
                      <RuntimeConcurrencyInfoIcon />
                    </div>
                    <SliderRow
                      value={concurrency}
                      min={1}
                      max={concurrencyInputMax}
                      ariaLabel={t('experiments.new.params.concurrency')}
                      onChange={(next) => setConcurrency(capConcurrencyValue(next, effectiveConcurrencyLimit))}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      {formatTemplate(t('experiments.new.params.concurrencyHelp'), {
                        limit: selectedModel ? formatModelLimit(selectedModel.concurrencyLimit) : '—',
                        recommend: recommendedConcurrency,
                      })}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[12.5px] font-medium">{t('experiments.new.params.rpm')}</label>
                    <div className="flex items-center rounded-md border bg-background pr-2">
                      <input
                        value={rpm}
                        onChange={(event) => setRpm(event.target.value)}
                        aria-label={t('experiments.new.params.rpm')}
                        className="h-9 w-full bg-transparent px-3 font-mono text-[13px] outline-none"
                      />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatTemplate(t('experiments.new.params.rpmSuffix'), {
                          limit: selectedModel ? formatModelLimit(selectedModel.rpmLimit) : '—',
                        })}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t('experiments.new.params.rpmHelp')}</div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[12.5px] font-medium">{t('experiments.new.params.tpm')}</label>
                    <div className="flex items-center rounded-md border bg-background pr-2">
                      <input
                        value={tpm}
                        onChange={(event) => setTpm(event.target.value)}
                        aria-label={t('experiments.new.params.tpm')}
                        className="h-9 w-full bg-transparent px-3 font-mono text-[13px] outline-none"
                      />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatTemplate(t('experiments.new.params.tpmSuffix'), {
                          limit: selectedModel ? formatModelLimit(selectedModel.tpmLimit) : '—',
                        })}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t('experiments.new.params.tpmHelp')}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <label className="block text-[12.5px] font-medium">{t('experiments.new.params.temperature')}</label>
                    <SliderRow
                      value={temperature}
                      min={0}
                      max={2}
                      step={0.1}
                      ariaLabel={t('experiments.new.params.temperature')}
                      onChange={(next) => setTemperature(normalizeTemperature(next))}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      {t('experiments.new.params.temperatureHelp')}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[12.5px] font-medium">{t('experiments.new.params.timeout')}</label>
                    <div className="flex items-center rounded-md border bg-background pr-2">
                      <input
                        value={timeoutSeconds}
                        onChange={(event) => setTimeoutSeconds(event.target.value)}
                        aria-label={t('experiments.new.params.timeout')}
                        className="h-9 w-full bg-transparent px-3 font-mono text-[13px] outline-none"
                      />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t('experiments.new.params.timeoutSuffix')}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t('experiments.new.params.timeoutHelp')}</div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[12.5px] font-medium">{t('experiments.new.params.retries')}</label>
                    <div className="flex items-center rounded-md border bg-background pr-2">
                      <input
                        value={retries}
                        onChange={(event) => setRetries(event.target.value)}
                        aria-label={t('experiments.new.params.retries')}
                        className="h-9 w-full bg-transparent px-3 font-mono text-[13px] outline-none"
                      />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t('experiments.new.params.retriesSuffix')}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t('experiments.new.params.retriesHelp')}</div>
                  </div>
                </div>

                {promptNeedsImages && (
                  <div className="space-y-2">
                    <label className="block text-[12.5px] font-medium">
                      {t('experiments.new.params.imageEncoding')}{' '}
                      <span className="ml-1 font-normal text-muted-foreground">
                        · {t('experiments.new.params.imageEncodingSubtitle')}
                      </span>
                    </label>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {availableEncodings.includes('url') && (
                        <EncodingOption
                          active={encoding === 'url'}
                          onClick={() => setEncoding('url')}
                          title={t('experiments.new.params.encoding.url')}
                          description={t('experiments.new.params.encoding.urlHelp')}
                        />
                      )}
                      {availableEncodings.includes('base64') && (
                        <EncodingOption
                          active={encoding === 'base64'}
                          onClick={() => setEncoding('base64')}
                          title={t('experiments.new.params.encoding.base64')}
                          description={t('experiments.new.params.encoding.base64Help')}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside
            className="flex max-h-[calc(100vh-7rem)] flex-col gap-3 overflow-y-auto xl:sticky xl:top-20"
            data-testid="experiment-new-side-panel"
          >
            <div
              className={cn(
                'rounded-lg border bg-[color-mix(in_srgb,var(--status-canary-bg)_55%,var(--card))] p-4',
                experimentTone.info.border,
                experimentTone.info.text,
              )}
            >
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
                <Calculator className="size-3.5" />
                {t('experiments.new.estimate.title')}
              </div>
              <div className="space-y-2 text-[12px]">
                <div
                  className={cn(
                    'flex items-baseline justify-between border-t border-dashed pt-2 first:border-t-0 first:pt-0',
                    experimentTone.info.border,
                  )}
                >
                  <span className="opacity-80">{t('experiments.new.estimate.totalSamples')}</span>
                  <span className="font-mono text-[14px] font-semibold">
                    {estimate?.totalSamples.toLocaleString('en-US').replace(/,/g, ' ') ?? '—'}
                  </span>
                </div>
                <div
                  className={cn(
                    'flex items-baseline justify-between border-t border-dashed pt-2',
                    experimentTone.info.border,
                  )}
                >
                  <span className="opacity-80">{t('experiments.new.estimate.duration')}</span>
                  <span className="font-mono text-[14px] font-semibold">
                    {estimate?.durationLabel ?? '—'}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      {formatTemplate(t('experiments.new.estimate.durationDetail'), {
                        concurrency,
                        rpm: rpmValue ?? '—',
                      })}
                    </span>
                  </span>
                </div>
                <div
                  className={cn(
                    'flex items-baseline justify-between border-t border-dashed pt-2',
                    experimentTone.info.border,
                  )}
                >
                  <span className="opacity-80">{t('experiments.new.estimate.tokens')}</span>
                  <span className="font-mono text-[14px] font-semibold">
                    {estimate?.tokensLabel ?? '—'}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      {formatTemplate(t('experiments.new.estimate.tokensDetail'), {
                        input: estimate?.tokensInLabel ?? '—',
                        output: estimate?.tokensOutLabel ?? '—',
                      })}
                    </span>
                  </span>
                </div>
                <div
                  className={cn(
                    'flex items-baseline justify-between border-t border-dashed pt-2',
                    experimentTone.info.border,
                  )}
                >
                  <span className="opacity-80">{t('experiments.new.estimate.cost')}</span>
                  <span className="font-mono text-[14px] font-semibold">{estimate?.costLabel ?? '—'}</span>
                </div>
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">{t('experiments.new.estimate.note')}</div>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
                <Check className="size-3.5" />
                {t('experiments.new.check.title')}
              </div>
              <div className="mb-3 flex items-center justify-between border-b pb-3 text-[12px] text-muted-foreground">
                <span>{t('experiments.new.check.preSubmit')}</span>
                <div className="flex items-center gap-2">
                  {readinessChecking ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      <Loader2 className="size-3 animate-spin" />
                      {t('experiments.new.check.checking')}
                    </span>
                  ) : (
                    <>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]',
                          experimentTone.positive.pill,
                        )}
                      >
                        {formatTemplate(t('experiments.new.check.passed'), { count: passedCount })}
                      </span>
                      {warningCount > 0 && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]',
                            experimentTone.warning.pill,
                          )}
                        >
                          {formatTemplate(t('experiments.new.check.warning'), { count: warningCount })}
                        </span>
                      )}
                      {blockingCount > 0 && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]',
                            experimentTone.danger.pill,
                          )}
                        >
                          {formatTemplate(t('experiments.new.check.blocked'), { count: blockingCount })}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                {readinessChecking ? (
                  <CheckItem
                    state="pending"
                    title={t('experiments.new.check.loadingTitle')}
                    detail={t('experiments.new.check.loadingDetail')}
                  />
                ) : (
                  <>
                    <CheckItem
                      state={datasetCoverage?.ok ? 'ok' : 'error'}
                      title={
                        datasetCoverage?.ok
                          ? t('experiments.new.check.varsCoverTitle')
                          : t('experiments.new.check.varsMissingTitle')
                      }
                      detail={
                        datasetCoverage?.ok
                          ? formatTemplate(t('experiments.new.check.varsCoverDetail'), {
                              vars: datasetCoverage.coveredVariables.join(' · ') || '—',
                            })
                          : formatTemplate(t('experiments.new.check.varsMissingDetail'), {
                              vars: datasetCoverage?.missingVariables.join(' · ') || '—',
                            })
                      }
                    />
                    <CheckItem
                      state={visionUnsupported ? 'error' : 'ok'}
                      title={
                        visionUnsupported
                          ? t('experiments.new.check.visionUnsupportedTitle')
                          : t('experiments.new.check.judgeAlignTitle')
                      }
                      detail={
                        visionUnsupported
                          ? formatTemplate(t('experiments.new.check.visionUnsupportedDetail'), {
                              model: selectedModel?.name ?? '—',
                            })
                          : formatTemplate(t('experiments.new.check.judgeAlignDetail'), {
                              field: selectedDataset?.expectedField ?? '—',
                            })
                      }
                    />
                    <CheckItem
                      state={runParamsComplete ? 'ok' : 'error'}
                      title={t('experiments.new.steps.runparams')}
                      detail={
                        runParamsComplete
                          ? formatTemplate(t('experiments.new.steps.runparamsDone'), { temperature, concurrency })
                          : t('common.formError.invalidNumber')
                      }
                    />
                  </>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-9 flex-1 gap-1"
                  disabled={!canSubmit}
                  onClick={handleCreate}
                >
                  {createExperiment.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  {createExperiment.isPending
                    ? t('experiments.new.createAndStartLoading')
                    : t('experiments.new.createAndStart')}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Main>
  );
}
