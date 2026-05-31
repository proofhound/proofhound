'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Check,
  ChevronRight,
  Database,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Loader2,
  Play,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Main } from '@/components/layout/main';
import { PromptVersionPickerRow, PromptVersionPickerTag } from '@/components/prompt-version-picker-row';
import { PromptLanguageSelect } from '@/components/prompt-language-select';
import { useI18n, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { formatDateTime, formatLatencySeconds } from '@/lib/format';
import { useOptimizations, useCreateOptimization } from '@/hooks/optimization';
import { useDatasets } from '@/hooks/dataset';
import { useExperiments } from '@/hooks/experiment';
import { useProjectModels } from '@/hooks/model';
import { usePrompt, usePrompts } from '@/hooks/prompt';
import { useDelayedLoading } from '@/hooks/use-delayed-loading';
import { getApiErrorMessage } from '@/lib/api-error';
import { isProjectNameTaken } from '@/lib/project-name';
import { composePromptPreview } from '../../../prompts/_components/prompt-preview';
import { renderPromptPreviewParts } from '../../../prompts/_components/prompt-preview-parts';
import { VARIABLE_TONE_CLASSES } from '../../../prompts/_components/prompt-ui';
import type { PromptVariableType } from '../../../prompts/_components/prompt-model';
import {
  DEFAULT_PROMPT_LANGUAGE,
  type OptimizationGoalComparatorDto,
  type OptimizationStartingModeDto,
  type CreateOptimizationDto,
  type DatasetFieldSchemaDto,
  type DatasetListItemDto,
  type ExperimentListItemDto,
  type PromptLanguageDto,
  type ProjectModelListItemDto,
  type PromptListItemDto,
  type PromptVersionDto,
} from '@proofhound/shared';
import { optimizationTone } from '../../_components/optimization-theme';

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

type OriginMode = 'experiment' | 'prompt' | 'dataset';
type GoalMetric = CreateOptimizationDto['goals'][number]['metric'];
type GoalComparator = 'gte' | 'gt' | 'lte';

interface GoalDraft {
  id: string;
  metric: GoalMetric;
  comparator: GoalComparator;
  target: string;
  scope: string; // 'overall' or a class label
}

const METRIC_LABEL_KEY: Record<GoalMetric, TranslationKey> = {
  accuracy: 'optimizations.new.optimization.metric.accuracy',
  precision: 'optimizations.new.optimization.metric.precision',
  recall: 'optimizations.new.optimization.metric.recall',
};

const COMPARATOR_LABEL_KEY: Record<GoalComparator, TranslationKey> = {
  gte: 'optimizations.new.optimization.comparator.gte',
  gt: 'optimizations.new.optimization.comparator.gt',
  lte: 'optimizations.new.optimization.comparator.lte',
};

const PROMPT_LANGUAGE_LABEL_KEY: Record<PromptLanguageDto, TranslationKey> = {
  'zh-CN': 'promptLanguage.zhCN',
  'en-US': 'promptLanguage.enUS',
};

const PROMPT_STATUS_LABEL_KEY: Record<string, TranslationKey> = {
  editable: 'optimizations.new.origin.promptStatus.editable',
  frozen: 'optimizations.new.origin.promptStatus.frozen',
};

interface PromptVersionOption {
  id: string;
  name: string;
  version: string;
  promptLanguage: PromptLanguageDto;
  isLatest: boolean;
  isOnline: boolean;
  status: PromptVersionDto['status'];
  updatedAt: string;
  variables: Array<{ name: string; type: PromptVariableType; required: boolean }>;
  promptPreview: string;
  template: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function formatThousand(value: number) {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

function defaultName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `optm-${yyyy}-${mm}${dd}-`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value === 0) return '0';
  if (value >= 1)
    return value
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function mapPromptVersionToOption(prompt: PromptListItemDto, version: PromptVersionDto): PromptVersionOption {
  const promptLanguage = version.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;

  return {
    id: version.id,
    name: prompt.name,
    version: `v${version.versionNumber}`,
    promptLanguage,
    isLatest: version.versionNumber === prompt.latestVersionNumber,
    isOnline: version.versionNumber === prompt.currentOnlineVersionNumber,
    status: version.status,
    updatedAt: formatDateTime(version.createdAt),
    variables: version.variables.map((variable) => ({
      name: variable.name,
      type: variable.type,
      required: variable.required,
    })),
    promptPreview: composePromptPreview({
      body: version.body,
      outputSchema: version.outputSchema,
      promptLanguage,
    }),
    template: version.body,
  };
}

// model.{rpm|tpm|concurrency}.limit = -1 means unlimited
function formatModelLimit(limit: number): string {
  return limit < 0 ? '∞' : formatThousand(limit);
}

// expected_output is the ground truth (used for judgment); it is neither a prompt input field nor
// metadata — injecting it into the prompt would leak the answer; backend toLoopFieldWhitelist also strips it as a backstop.
function deriveDatasetFields(dataset: DatasetListItemDto | null | undefined): {
  inputs: DatasetFieldSchemaDto[];
  metas: DatasetFieldSchemaDto[];
} {
  if (!dataset) return { inputs: [], metas: [] };
  const inputs: DatasetFieldSchemaDto[] = [];
  const metas: DatasetFieldSchemaDto[] = [];
  for (const field of dataset.fieldSchema) {
    if (field.role === 'expected_output') continue;
    if (field.role === 'metadata') metas.push(field);
    else inputs.push(field);
  }
  return { inputs, metas };
}

function classScopes(dataset: DatasetListItemDto | null | undefined): string[] {
  if (!dataset) return [];
  return dataset.categoryDistribution.categories.map((category) => category.label);
}

// ---- Lightweight metric formatters used inside the detail panel (not extracted; the experiment detail page has a similar one with a different signature) ----

function formatMetricFraction(value: number | null | undefined, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function formatMetricInteger(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US');
}

function formatMetricCost(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatMetricLatencyMs(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${formatLatencySeconds(value, 2)}s`;
}

// ---------------------------------------------------------------------------
// shared primitives
// ---------------------------------------------------------------------------

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-full border',
        checked ? 'border-primary bg-primary/10' : 'border-border bg-background',
      )}
    >
      {checked && <span className="size-2 rounded-full bg-primary" />}
    </span>
  );
}

function FieldCheckbox({
  checked,
  locked,
  ariaLabel,
  onClick,
}: {
  checked: boolean;
  locked?: boolean;
  ariaLabel: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={locked || undefined}
      aria-label={ariaLabel}
      disabled={locked}
      onClick={onClick}
      className={cn(
        'inline-flex size-3.5 flex-none items-center justify-center rounded-[3px] border transition-colors',
        locked
          ? cn(optimizationTone.positive.border, optimizationTone.positive.bg, optimizationTone.positive.text)
          : checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-foreground/50 bg-background',
      )}
    >
      {(checked || locked) && <Check className="size-2.5" strokeWidth={3} />}
    </button>
  );
}

function StepIndicator({
  step,
  state,
  title,
  detail,
}: {
  step: number;
  state: 'current' | 'pending' | 'done';
  title: string;
  detail: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-md border bg-card px-3 py-2',
        state === 'current' && cn('border-primary/40 bg-primary/5'),
        state === 'done' && cn(optimizationTone.positive.border, optimizationTone.positive.bg),
      )}
    >
      <span
        className={cn(
          'inline-flex size-5 flex-none items-center justify-center rounded-full border font-mono text-[11px] font-semibold',
          state === 'current'
            ? 'border-primary bg-primary text-primary-foreground'
            : state === 'done'
              ? cn(optimizationTone.positive.pill, 'border-transparent')
              : 'border-border bg-muted text-muted-foreground',
        )}
      >
        {state === 'done' ? <Check className="size-3" /> : step}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="text-[12.5px] font-semibold">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function StepAnchor({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-full border font-mono text-[11px]',
        optimizationTone.info.pill,
      )}
    >
      {index}
    </span>
  );
}

function SubSectionHead({ tone, label }: { tone: 'info' | 'positive'; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-2.5 w-[3px] rounded-[1.5px]',
          tone === 'info' ? optimizationTone.info.fill : optimizationTone.positive.fill,
        )}
      />
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
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/60 px-3 py-2 backdrop-blur">
      <Search className="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-6 w-full min-w-0 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function Tag({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'info' | 'positive' | 'warning';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10.5px]',
        tone === 'info' && optimizationTone.info.pill,
        tone === 'positive' && optimizationTone.positive.pill,
        tone === 'warning' && optimizationTone.warning.pill,
        tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function PickerEmpty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{children}</div>;
}

function Slider({
  value,
  min,
  max,
  step = 1,
  formatValue,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  formatValue: (value: number) => string;
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
        onChange={(event) => onChange(Number(event.target.value))}
        className="flex-1 accent-primary"
      />
      <span className="w-16 text-right font-mono text-[13.5px] font-semibold tabular-nums">{formatValue(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// origin tile
// ---------------------------------------------------------------------------

function ModeTile({
  active,
  icon: Icon,
  title,
  description,
  onClick,
  testId,
}: {
  active: boolean;
  icon: typeof FlaskConical;
  title: string;
  description: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-md border px-3.5 py-3 text-left transition-colors',
        active
          ? cn(
              optimizationTone.info.border,
              'bg-[color-mix(in_oklab,var(--status-canary-bg)_55%,var(--background))]',
              'shadow-[0_0_0_1px_var(--status-canary-bd)]',
            )
          : 'border-border bg-background hover:bg-muted/40',
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-[7px] border',
            active
              ? cn(optimizationTone.info.pill, 'border-transparent')
              : 'border-border bg-secondary text-muted-foreground',
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="text-[13.5px] font-semibold">{title}</span>
      </span>
      <span className="text-[12px] leading-snug text-muted-foreground">{description}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// option rows (per-resource)
// ---------------------------------------------------------------------------

// ---- Experiment info panel: right column full profile (basic / quality / run params / engineering metrics / per-class) ----

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2',
        highlight && 'border-primary/40 bg-primary/5',
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-[15px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function SpecLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="min-w-[64px] flex-none text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all font-mono text-[12px] text-foreground">{value}</span>
    </div>
  );
}

function SectionDetails({
  title,
  defaultOpen = false,
  children,
  testid,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <details className="group rounded-md border bg-card" open={defaultOpen} data-testid={testid}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
        {title}
      </summary>
      <div className="border-t bg-background px-3 py-3">{children}</div>
    </details>
  );
}

function ExperimentDetailPanel({
  experiment,
  modelMissing,
}: {
  experiment: ExperimentListItemDto | null;
  modelMissing: boolean;
}) {
  const { t } = useI18n();

  if (!experiment) {
    return (
      <div
        className="flex min-h-[180px] items-center justify-center rounded-md border bg-card px-4 py-8 text-center text-[12px] text-muted-foreground"
        data-testid="optimization-new-experiment-detail-panel"
      >
        {t('optimizations.new.origin.experimentDetail.placeholder')}
      </div>
    );
  }

  const metrics = experiment.metrics ?? null;
  const runConfig = experiment.runConfig ?? null;
  const perClass = metrics?.perClass ?? null;

  return (
    <div className="space-y-2.5" data-testid="optimization-new-experiment-detail-panel">
      {modelMissing && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 flex-none" aria-hidden="true" />
          <span>{t('optimizations.new.origin.experimentDetail.modelMissing')}</span>
        </div>
      )}

      {/* Basic info: always visible */}
      <div className="rounded-md border bg-card px-3 py-3">
        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          {t('optimizations.new.origin.experimentDetail.basicSection')}
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <SpecLine
            label={t('optimizations.new.origin.experimentDetail.prompt')}
            value={`${experiment.promptName} ${experiment.promptVersionLabel}`}
          />
          <SpecLine
            label={t('optimizations.new.origin.experimentDetail.dataset')}
            value={`${experiment.datasetName} · ${formatThousand(experiment.datasetSamples)}`}
          />
          <SpecLine label={t('optimizations.new.origin.experimentDetail.model')} value={experiment.modelName} />
          <SpecLine
            label={t('optimizations.new.origin.experimentDetail.finishedAt')}
            value={formatDateTime(experiment.finishedAt)}
          />
        </div>
      </div>

      {/* Quality metrics: always visible, 4 cards */}
      <div className="rounded-md border bg-card px-3 py-3">
        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          {t('optimizations.new.origin.experimentDetail.qualitySection')}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricCard
            label={t('optimizations.new.optimization.metric.accuracy')}
            value={formatMetricFraction(metrics?.accuracy)}
            highlight
          />
          <MetricCard
            label={t('optimizations.new.optimization.metric.precision')}
            value={formatMetricFraction(metrics?.precision)}
          />
          <MetricCard
            label={t('optimizations.new.optimization.metric.recall')}
            value={formatMetricFraction(metrics?.recall)}
          />
          <MetricCard label={t('optimizations.new.optimization.metric.f1')} value={formatMetricFraction(metrics?.f1)} />
        </div>
      </div>

      {/* Run parameters: collapsible */}
      <SectionDetails
        title={t('optimizations.new.origin.experimentDetail.runConfigSection')}
        testid="optimization-new-experiment-detail-runconfig"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SpecLine
            label={t('optimizations.new.origin.experimentDetail.temperature')}
            value={runConfig?.temperature ?? '—'}
          />
          <SpecLine
            label={t('optimizations.new.origin.experimentDetail.concurrency')}
            value={runConfig?.concurrency ?? '—'}
          />
          <SpecLine label={t('optimizations.new.origin.experimentDetail.rpm')} value={runConfig?.rpmLimit ?? '—'} />
          <SpecLine
            label={t('optimizations.new.origin.experimentDetail.tpm')}
            value={
              runConfig?.tpmLimit !== undefined && runConfig?.tpmLimit !== null
                ? formatThousand(runConfig.tpmLimit)
                : '—'
            }
          />
        </div>
      </SectionDetails>

      {/* Engineering metrics: collapsible */}
      <SectionDetails
        title={t('optimizations.new.origin.experimentDetail.engineeringSection')}
        testid="optimization-new-experiment-detail-engineering"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MetricCard
            label={t('optimizations.new.origin.experimentDetail.inputTokens')}
            value={formatMetricInteger(metrics?.inputTokens)}
          />
          <MetricCard
            label={t('optimizations.new.origin.experimentDetail.outputTokens')}
            value={formatMetricInteger(metrics?.outputTokens)}
          />
          <MetricCard
            label={t('optimizations.new.origin.experimentDetail.cost')}
            value={formatMetricCost(metrics?.costEstimate)}
          />
          <MetricCard
            label={t('optimizations.new.origin.experimentDetail.latencyAvg')}
            value={formatMetricLatencyMs(metrics?.averageLatencyMs)}
          />
          <MetricCard
            label={t('optimizations.new.origin.experimentDetail.latencyP50')}
            value={formatMetricLatencyMs(metrics?.p50LatencyMs)}
          />
          <MetricCard
            label={t('optimizations.new.origin.experimentDetail.latencyP95')}
            value={formatMetricLatencyMs(metrics?.p95LatencyMs)}
          />
        </div>
      </SectionDetails>

      {/* per-class: collapsible */}
      <SectionDetails
        title={t('optimizations.new.origin.experimentDetail.perClassSection')}
        testid="optimization-new-experiment-detail-per-class"
      >
        {perClass && perClass.length > 0 ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 text-left font-medium">
                  {t('optimizations.new.origin.experimentDetail.perClassLabel')}
                </th>
                <th className="py-1 text-right font-medium">P</th>
                <th className="py-1 text-right font-medium">R</th>
                <th className="py-1 text-right font-medium">F1</th>
                <th className="py-1 text-right font-medium">
                  {t('optimizations.new.origin.experimentDetail.perClassSupport')}
                </th>
              </tr>
            </thead>
            <tbody>
              {perClass.map((entry) => (
                <tr key={entry.label} className="border-b last:border-b-0">
                  <td className="py-1.5 font-mono">{entry.label}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{formatMetricFraction(entry.precision)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{formatMetricFraction(entry.recall)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{formatMetricFraction(entry.f1)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{formatMetricInteger(entry.support)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-[11.5px] text-muted-foreground">
            {t('optimizations.new.origin.experimentDetail.perClassEmpty')}
          </div>
        )}
      </SectionDetails>
    </div>
  );
}

function ExperimentRow({
  experiment,
  selected,
  onSelect,
}: {
  experiment: ExperimentListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-[color-mix(in_oklab,var(--status-canary-bg)_55%,var(--background))]',
      )}
    >
      <Radio checked={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold">{experiment.name}</span>
        </div>
        {experiment.description && (
          <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{experiment.description}</div>
        )}
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          {formatTemplate(t('optimizations.new.origin.experimentCreatedAt'), {
            date: formatDateTime(experiment.createdAt),
          })}
        </div>
      </div>
    </button>
  );
}

function PromptRow({
  prompt,
  selected,
  onSelect,
}: {
  prompt: PromptListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const statusKey = PROMPT_STATUS_LABEL_KEY[prompt.latestVersionStatus];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-[color-mix(in_oklab,var(--status-canary-bg)_55%,var(--background))]',
      )}
    >
      <Radio checked={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold">{prompt.name}</span>
          {statusKey && (
            <Tag tone={prompt.latestVersionStatus === 'frozen' ? 'positive' : 'neutral'}>{t(statusKey)}</Tag>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Tag>
            {formatTemplate(t('optimizations.new.origin.promptVersionCount'), {
              count: prompt.latestVersionNumber,
            })}
          </Tag>
          {prompt.currentOnlineVersionNumber ? (
            <Tag tone="positive">
              {formatTemplate(t('optimizations.new.origin.promptOnlineVersion'), {
                version: `v${prompt.currentOnlineVersionNumber}`,
              })}
            </Tag>
          ) : (
            <Tag>{t('optimizations.new.origin.promptNoOnlineVersion')}</Tag>
          )}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          {prompt.createdByDisplayName ? `@${prompt.createdByDisplayName}` : '@unknown'} ·{' '}
          {formatDateTime(prompt.updatedAt)}
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
  option: PromptVersionOption;
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
        option.isOnline ? (
          <PromptVersionPickerTag tone="positive">
            {t('optimizations.new.origin.promptVersionOnline')}
          </PromptVersionPickerTag>
        ) : option.isLatest ? (
          <PromptVersionPickerTag tone="info">
            {t('optimizations.new.origin.promptVersionLatest')}
          </PromptVersionPickerTag>
        ) : null
      }
      createdAt={option.updatedAt}
      trailing={<PromptVersionPickerTag>{t(PROMPT_LANGUAGE_LABEL_KEY[option.promptLanguage])}</PromptVersionPickerTag>}
    />
  );
}

function PromptVersionPreview({ option }: { option: PromptVersionOption | null }) {
  const { t } = useI18n();
  const previewParts = useMemo(
    () => renderPromptPreviewParts(option?.promptPreview ?? '', option?.variables ?? []),
    [option],
  );
  if (!option) {
    return (
      <div
        className="border-t px-3 py-6 text-center text-[12px] text-muted-foreground"
        data-testid="optimization-new-prompt-preview"
      >
        {t('optimizations.new.origin.promptPreviewEmpty')}
      </div>
    );
  }

  return (
    <div className="border-t px-3 py-3" data-testid="optimization-new-prompt-preview">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {t('optimizations.new.origin.promptPreview')}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {option.name} · {option.version}
          </span>
        </div>
        <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
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
                {part.value}
              </span>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

function DatasetRow({
  dataset,
  selected,
  onSelect,
}: {
  dataset: DatasetListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const meta = formatTemplate(t('optimizations.new.origin.datasetMeta'), {
    samples: formatThousand(dataset.sampleCount),
    fields: dataset.fieldSchema.length,
  });
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-[color-mix(in_oklab,var(--status-canary-bg)_55%,var(--background))]',
      )}
    >
      <Radio checked={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold">{dataset.name}</span>
          {dataset.hasImages && (
            <Tag tone="info">
              <ImageIcon className="size-2.5" aria-hidden="true" />
              {t('optimizations.new.origin.datasetHasImages')}
            </Tag>
          )}
        </div>
        {dataset.description && (
          <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{dataset.description}</div>
        )}
        <div className="mt-1 text-[11.5px] text-muted-foreground">{meta}</div>
      </div>
    </button>
  );
}

function ModelOptionRow({
  model,
  selected,
  onSelect,
}: {
  model: ProjectModelListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const ctx = model.contextWindowTokens
    ? formatTemplate(t('optimizations.new.experiment.modelCap.ctx'), {
        value:
          model.contextWindowTokens >= 1000
            ? `${Math.round(model.contextWindowTokens / 1000)}K`
            : String(model.contextWindowTokens),
      })
    : null;
  const unlimited = t('optimizations.new.experiment.modelUnlimited');
  const rpmText = model.rpm.limit < 0 ? unlimited : formatThousand(model.rpm.limit);
  const tpmText = model.tpm.limit < 0 ? unlimited : formatThousand(model.tpm.limit);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-[color-mix(in_oklab,var(--status-canary-bg)_55%,var(--background))]',
      )}
    >
      <Radio checked={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold">{model.name}</span>
          {model.status === 'disabled' && <Tag tone="neutral">{t('optimizations.new.experiment.modelDisabled')}</Tag>}
          {model.status === 'testing' && <Tag tone="warning">{t('optimizations.new.experiment.modelTesting')}</Tag>}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{model.providerType}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {ctx && <Tag>{ctx}</Tag>}
          {model.capabilities.image !== 'none' && (
            <Tag tone="info">{t('optimizations.new.experiment.modelCap.vision')}</Tag>
          )}
          <Tag>{formatTemplate(t('optimizations.new.experiment.modelRpmTpm'), { rpm: rpmText, tpm: tpmText })}</Tag>
        </div>
      </div>
      <div className="flex-none text-right font-mono text-[11.5px] text-muted-foreground">
        <div className="font-semibold text-foreground">
          {formatTemplate(t('optimizations.new.experiment.modelPriceLabel'), {
            input: formatPrice(model.pricing.inputPerMillion),
            output: formatPrice(model.pricing.outputPerMillion),
          })}
        </div>
        <div className="text-[10.5px] text-muted-foreground">{t('optimizations.new.experiment.modelPriceUnit')}</div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// main page
// ---------------------------------------------------------------------------

export function OptimizationNewPage({
  projectId,
  initialDatasetId,
  initialPromptId,
  initialPromptVersionId,
  initialSourceExperimentId,
}: {
  projectId: string;
  initialDatasetId?: string | null;
  initialPromptId?: string | null;
  initialPromptVersionId?: string | null;
  initialSourceExperimentId?: string | null;
}) {
  const { t } = useI18n();

  // basic
  const [name, setName] = useState<string>(defaultName);
  const [description, setDescription] = useState<string>('');
  const [optimizationHint, setOptimizationHint] = useState<string>('');

  // origin
  const [originMode, setOriginMode] = useState<OriginMode>(
    initialSourceExperimentId ? 'experiment' : initialDatasetId ? 'dataset' : initialPromptId ? 'prompt' : 'experiment',
  );
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>(initialSourceExperimentId ?? '');
  const [selectedPromptId, setSelectedPromptId] = useState<string>(initialPromptId ?? '');
  const [selectedPromptVersionId, setSelectedPromptVersionId] = useState<string>(initialPromptVersionId ?? '');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(initialDatasetId ?? '');
  const [experimentSearch, setExperimentSearch] = useState('');
  const [promptSearch, setPromptSearch] = useState('');
  const [datasetSearch, setDatasetSearch] = useState('');

  // experiment config
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [modelSearch, setModelSearch] = useState('');
  const [temperature, setTemperature] = useState(0);
  const [concurrency, setConcurrency] = useState(8);
  const [rpm, setRpm] = useState(60);
  const [tpm, setTpm] = useState(120_000);
  const [sampleTimeoutSeconds, setSampleTimeoutSeconds] = useState(20);
  const [retries, setRetries] = useState(0);
  const [imageEncoding, setImageEncoding] = useState<'url' | 'base64'>('url');

  // optimization
  const [goals, setGoals] = useState<GoalDraft[]>([
    { id: 'g1', metric: 'accuracy', comparator: 'gte', target: '0.90', scope: 'overall' },
  ]);
  const [analysisModelId, setAnalysisModelId] = useState<string>('');
  const [analysisModelSearch, setAnalysisModelSearch] = useState('');
  const [maxRounds, setMaxRounds] = useState(5);
  const [noImprovementRounds, setNoImprovementRounds] = useState(0);
  const [initialSamplingRounds, setInitialSamplingRounds] = useState(1);
  const [initialSamplesPerRound, setInitialSamplesPerRound] = useState(20);
  const [datasetPromptLanguage, setDatasetPromptLanguage] = useState<PromptLanguageDto>(DEFAULT_PROMPT_LANGUAGE);

  // meta-field user overrides keyed by `${datasetId}:${fieldName}` so changing
  // datasets resets the field state cleanly without an effect
  const [metaOverrides, setMetaOverrides] = useState<Record<string, boolean>>({});

  // data hooks
  const experimentsQuery = useExperiments(projectId);
  const optimizationsQuery = useOptimizations(projectId);
  const promptsQuery = usePrompts(projectId);
  const datasetsQuery = useDatasets(projectId);
  const modelsQuery = useProjectModels(projectId, { autoRefresh: false });

  const experiments = useMemo(() => experimentsQuery.data?.data ?? [], [experimentsQuery.data]);
  const optimizations = useMemo(() => optimizationsQuery.data?.data ?? [], [optimizationsQuery.data]);
  const prompts = useMemo(() => promptsQuery.data?.data ?? [], [promptsQuery.data]);
  const datasets = useMemo(() => datasetsQuery.data?.data ?? [], [datasetsQuery.data]);
  const models = useMemo(() => modelsQuery.data?.data ?? [], [modelsQuery.data]);
  const optimizationNameTaken = useMemo(() => isProjectNameTaken(name, optimizations), [optimizations, name]);

  // Effective selections: user choice or fall back to first-fit. Derived (no setState in render).
  // experiment fallback uses successExperiments[0]: after list filtering, running/failed etc. are excluded;
  // must align here, otherwise the form falls onto an invisible experiment when the user has not selected one
  const successExperimentsHead = useMemo(
    () => experiments.find((item) => item.status === 'success') ?? null,
    [experiments],
  );
  const effectiveExperimentId = selectedExperimentId || successExperimentsHead?.id || '';
  const effectivePromptId = selectedPromptId || prompts[0]?.id || '';

  // Start = experiment and the user has not manually picked a model: experiment model / analysis model defaults follow the experiment's bound model;
  // when the bound model has been soft-deleted, returns undefined and falls back to models[0]
  const experimentDefaultModelId = useMemo(() => {
    if (originMode !== 'experiment') return undefined;
    const exp = experiments.find((item) => item.id === effectiveExperimentId);
    if (!exp) return undefined;
    return models.find((m) => m.id === exp.modelId)?.id;
  }, [originMode, effectiveExperimentId, experiments, models]);

  const effectiveModelId = selectedModelId || experimentDefaultModelId || models[0]?.id || '';
  const effectiveAnalysisModelId = analysisModelId || experimentDefaultModelId || models[0]?.id || '';

  // resolve currently-selected resource
  const selectedExperiment = useMemo(
    () => experiments.find((item) => item.id === effectiveExperimentId),
    [experiments, effectiveExperimentId],
  );
  const selectedPrompt = useMemo(
    () => prompts.find((item) => item.id === effectivePromptId),
    [prompts, effectivePromptId],
  );
  const promptDetailQuery = usePrompt(projectId, selectedPrompt?.id ?? '');
  const experimentsLoading = useDelayedLoading(experimentsQuery.isLoading);
  const promptsLoading = useDelayedLoading(promptsQuery.isLoading);
  const promptDetailLoading = useDelayedLoading(promptDetailQuery.isLoading);
  const datasetsLoading = useDelayedLoading(datasetsQuery.isLoading);
  const modelsLoading = useDelayedLoading(modelsQuery.isLoading);
  const promptVersions = useMemo(
    () =>
      selectedPrompt && promptDetailQuery.data
        ? promptDetailQuery.data.versions.map((version) => mapPromptVersionToOption(selectedPrompt, version))
        : [],
    [promptDetailQuery.data, selectedPrompt],
  );
  const preferredPromptVersion = useMemo(() => {
    if (promptVersions.length === 0) return null;
    const fromUrl = initialPromptVersionId
      ? promptVersions.find((option) => option.id === initialPromptVersionId)
      : null;
    const online = selectedPrompt?.currentOnlineVersionNumber
      ? promptVersions.find((option) => option.version === `v${selectedPrompt.currentOnlineVersionNumber}`)
      : null;
    const latest = promptVersions.find((option) => option.isLatest);
    return fromUrl ?? online ?? latest ?? promptVersions[0] ?? null;
  }, [initialPromptVersionId, promptVersions, selectedPrompt]);
  const effectivePromptVersionId =
    selectedPromptVersionId && promptVersions.some((option) => option.id === selectedPromptVersionId)
      ? selectedPromptVersionId
      : (preferredPromptVersion?.id ?? '');
  const selectedPromptVersion = useMemo(
    () => promptVersions.find((option) => option.id === effectivePromptVersionId) ?? null,
    [effectivePromptVersionId, promptVersions],
  );
  // Dataset selection priority: user choice → (prompt mode) prompt.defaultDatasetId → first dataset.
  const effectiveDatasetId =
    selectedDatasetId ||
    (originMode === 'prompt' ? (selectedPrompt?.defaultDatasetId ?? '') : '') ||
    datasets[0]?.id ||
    '';
  const selectedDataset = useMemo(
    () => datasets.find((item) => item.id === effectiveDatasetId),
    [datasets, effectiveDatasetId],
  );

  const impliedDatasetId =
    originMode === 'experiment' ? (selectedExperiment?.datasetId ?? null) : effectiveDatasetId || null; // Both prompt and dataset modes use effectiveDatasetId

  const impliedDataset = useMemo(
    () => (impliedDatasetId ? (datasets.find((item) => item.id === impliedDatasetId) ?? null) : null),
    [datasets, impliedDatasetId],
  );

  const { inputs: inputFields, metas: metaFields } = useMemo(
    () => deriveDatasetFields(impliedDataset),
    [impliedDataset],
  );

  const selectedModel = useMemo(() => models.find((item) => item.id === effectiveModelId), [models, effectiveModelId]);
  const selectedAnalysisModel = useMemo(
    () => models.find((item) => item.id === effectiveAnalysisModelId),
    [models, effectiveAnalysisModelId],
  );

  // filtered lists — the experiment list only accepts status==='success' as a baseline candidate;
  // only completed experiments have trustworthy run parameters + metrics that can be group-imported
  const successExperiments = useMemo(() => experiments.filter((item) => item.status === 'success'), [experiments]);
  const filteredExperiments = useMemo(() => {
    const query = experimentSearch.trim().toLowerCase();
    if (!query) return successExperiments;
    return successExperiments.filter((item) =>
      `${item.name} ${item.description ?? ''} ${item.promptName} ${item.datasetName} ${item.modelName}`
        .toLowerCase()
        .includes(query),
    );
  }, [successExperiments, experimentSearch]);
  const filteredPrompts = useMemo(() => {
    const query = promptSearch.trim().toLowerCase();
    if (!query) return prompts;
    return prompts.filter((item) => item.name.toLowerCase().includes(query));
  }, [prompts, promptSearch]);
  const filteredDatasets = useMemo(() => {
    const query = datasetSearch.trim().toLowerCase();
    if (!query) return datasets;
    return datasets.filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query));
  }, [datasets, datasetSearch]);
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((item) =>
      `${item.name} ${item.providerType} ${item.providerModelId}`.toLowerCase().includes(query),
    );
  }, [models, modelSearch]);
  const filteredAnalysisModels = useMemo(() => {
    const query = analysisModelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((item) =>
      `${item.name} ${item.providerType} ${item.providerModelId}`.toLowerCase().includes(query),
    );
  }, [models, analysisModelSearch]);

  // ---- Run parameter auto-sync helper (avoiding §4.21: all setState goes through a callback, not a useEffect listening to the same-name state) ----

  // Look up the model in the project model list; returns undefined when not found (soft-deleted)
  const modelOf = useCallback(
    (id: string | null | undefined) => (id ? models.find((item) => item.id === id) : undefined),
    [models],
  );

  // Selecting an experiment = whole-group override: modelId / analysisModelId(= modelId) / temperature / concurrency / rpm / tpm
  // Experiment runConfig priority → model limit fallback → hardcoded backstop
  const applyExperimentDefaults = useCallback(
    (exp: ExperimentListItemDto) => {
      setSelectedExperimentId(exp.id);
      const expModel = modelOf(exp.modelId);
      if (expModel) {
        setSelectedModelId(exp.modelId);
        setAnalysisModelId(exp.modelId);
      }
      setTemperature(exp.runConfig?.temperature ?? 0);
      setConcurrency(exp.runConfig?.concurrency ?? expModel?.concurrency.limit ?? 8);
      setRpm(exp.runConfig?.rpmLimit ?? expModel?.rpm.limit ?? 60);
      setTpm(exp.runConfig?.tpmLimit ?? expModel?.tpm.limit ?? 120_000);
      setSampleTimeoutSeconds(exp.runConfig?.sampleTimeoutSeconds ?? 20);
      setRetries(exp.runConfig?.retries ?? 0);
      setImageEncoding(exp.runConfig?.imageEncoding ?? 'url');
    },
    [modelOf],
  );

  // Switch model / switch away from experiment mode → run parameters follow the model default (temperature has no model field; keep user value)
  const applyModelDefaults = useCallback((model: ProjectModelListItemDto) => {
    setSelectedModelId(model.id);
    setConcurrency(model.concurrency.limit > 0 ? model.concurrency.limit : 8);
    setRpm(model.rpm.limit > 0 ? model.rpm.limit : 60);
    setTpm(model.tpm.limit > 0 ? model.tpm.limit : 120_000);
  }, []);

  const handlePromptSelect = useCallback((promptId: string) => {
    setSelectedPromptId(promptId);
    setSelectedPromptVersionId('');
  }, []);

  // Switching start mode (experiment → other only) triggers applyModelDefaults, falling back to the run parameters bound to the experiment
  const handleOriginModeChange = useCallback(
    (next: OriginMode) => {
      setOriginMode((current) => {
        if (current === 'experiment' && next !== 'experiment' && selectedModel) {
          applyModelDefaults(selectedModel);
        }
        return next;
      });
    },
    [applyModelDefaults, selectedModel],
  );

  // URL ?sourceExperimentId=<success-id> one-shot sync entry (the only allowed useEffect)
  // ref sentinel ensures setState-induced re-renders do not retrigger this effect, so no loop
  const didInitialSyncRef = useRef(false);
  useEffect(() => {
    if (didInitialSyncRef.current) return;
    if (!initialSourceExperimentId) return;
    if (experiments.length === 0) return;
    const exp = experiments.find((item) => item.id === initialSourceExperimentId);
    if (exp && exp.status === 'success') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL entry first-time sync; ref guarantees one-shot
      applyExperimentDefaults(exp);
    }
    didInitialSyncRef.current = true;
  }, [experiments, initialSourceExperimentId, applyExperimentDefaults]);

  // scope options derived from current dataset's category distribution
  const scopeOptions = useMemo(() => classScopes(impliedDataset), [impliedDataset]);

  // goal handlers
  const addGoal = () => {
    const id = `g${goals.length + 1}-${Date.now()}`;
    setGoals((current) => [...current, { id, metric: 'recall', comparator: 'gte', target: '0.80', scope: 'overall' }]);
  };
  const updateGoal = (id: string, patch: Partial<GoalDraft>) => {
    setGoals((current) => current.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)));
  };
  const removeGoal = (id: string) => {
    setGoals((current) => current.filter((goal) => goal.id !== id));
  };

  // field selection handlers (override-based; key namespaced by datasetId)
  const metaOverrideKey = (fieldName: string) => (impliedDataset ? `${impliedDataset.id}:${fieldName}` : fieldName);
  const isMetaChecked = (fieldName: string) => metaOverrides[metaOverrideKey(fieldName)] ?? false;
  const toggleMetaField = (fieldName: string) => {
    const key = metaOverrideKey(fieldName);
    setMetaOverrides((current) => ({ ...current, [key]: !(current[key] ?? false) }));
  };

  // origin picker status
  const originStatus =
    originMode === 'experiment'
      ? selectedExperiment
        ? 'done'
        : 'current'
      : originMode === 'prompt'
        ? selectedPrompt && selectedPromptVersion
          ? 'done'
          : 'current'
        : selectedDataset
          ? 'done'
          : 'current';
  const expStatus = selectedModel ? 'done' : 'current';
  const optStatus = goals.length > 0 && selectedAnalysisModel ? 'done' : 'current';

  // estimate (mockup-aligned synthetic numbers)
  const sampleCount = impliedDataset?.sampleCount ?? selectedExperiment?.datasetSamples ?? 0;
  const totalRuns = maxRounds;
  const totalAnalysisTokens = maxRounds * 160_000;
  const totalExperimentTokens = sampleCount * 2500 * totalRuns;
  const experimentCost = selectedModel
    ? ((totalExperimentTokens * 0.7) / 1_000_000) * selectedModel.pricing.inputPerMillion +
      ((totalExperimentTokens * 0.3) / 1_000_000) * selectedModel.pricing.outputPerMillion
    : 0;
  const analysisCost = selectedAnalysisModel
    ? ((totalAnalysisTokens * 0.7) / 1_000_000) * selectedAnalysisModel.pricing.inputPerMillion +
      ((totalAnalysisTokens * 0.3) / 1_000_000) * selectedAnalysisModel.pricing.outputPerMillion
    : 0;
  const totalCost = experimentCost + analysisCost;

  // --------------------------- submit ---------------------------
  const router = useRouter();
  const createMutation = useCreateOptimization(projectId);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const buildDto = (): CreateOptimizationDto | null => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError(t('optimizations.new.error.nameRequired'));
      return null;
    }
    if (optimizationNameTaken) {
      setSubmitError(t('common.formError.nameTaken'));
      return null;
    }
    if (!effectiveDatasetId && originMode === 'dataset') {
      setSubmitError(t('optimizations.new.error.datasetRequired'));
      return null;
    }
    if (!effectiveModelId) {
      setSubmitError(t('optimizations.new.error.modelRequired'));
      return null;
    }
    if (!effectiveAnalysisModelId) {
      setSubmitError(t('optimizations.new.error.analysisModelRequired'));
      return null;
    }

    let startingMode: OptimizationStartingModeDto;
    let sourceExperimentId: string | null = null;
    let promptIdValue: string | null = null;
    let baseVersionIdValue: string | null = null;
    let resolvedDatasetId: string;

    if (originMode === 'experiment') {
      if (!selectedExperiment) {
        setSubmitError(t('optimizations.new.error.experimentRequired'));
        return null;
      }
      startingMode = 'from_experiment';
      sourceExperimentId = selectedExperiment.id;
      resolvedDatasetId = selectedExperiment.datasetId;
    } else if (originMode === 'prompt') {
      if (!selectedPrompt) {
        setSubmitError(t('optimizations.new.error.promptRequired'));
        return null;
      }
      if (!selectedPromptVersion) {
        setSubmitError(t('optimizations.new.error.promptVersionRequired'));
        return null;
      }
      if (!effectiveDatasetId) {
        setSubmitError(t('optimizations.new.error.datasetRequired'));
        return null;
      }
      startingMode = 'from_prompt_version';
      promptIdValue = selectedPrompt.id;
      baseVersionIdValue = selectedPromptVersion.id;
      resolvedDatasetId = effectiveDatasetId;
    } else {
      if (!selectedDataset) {
        setSubmitError(t('optimizations.new.error.datasetRequired'));
        return null;
      }
      startingMode = 'from_dataset_only';
      resolvedDatasetId = selectedDataset.id;
    }

    const numericGoals = goals.map((goal) => ({
      metric: goal.metric,
      comparator: goal.comparator as OptimizationGoalComparatorDto,
      target: Number(goal.target),
      scope: goal.scope,
    }));
    if (numericGoals.some((goal) => !Number.isFinite(goal.target) || goal.target < 0 || goal.target > 1)) {
      setSubmitError(t('optimizations.new.error.goalTargetInvalid'));
      return null;
    }
    if (numericGoals.length === 0) {
      setSubmitError(t('optimizations.new.error.goalsRequired'));
      return null;
    }

    const selectedMetaFields = metaFields.filter((field) => isMetaChecked(field.name)).map((field) => field.name);
    const inputFieldNames = inputFields.map((field) => field.name);
    const fieldWhitelist = impliedDataset ? { inputFields: inputFieldNames, metaFields: selectedMetaFields } : null;

    const strategyConfig: Record<string, unknown> | undefined =
      startingMode === 'from_dataset_only' ? { initialSamplingRounds, initialSamplesPerRound } : undefined;
    return {
      name: trimmedName,
      description: description.trim() ? description.trim() : null,
      optimizationHint: optimizationHint.trim() ? optimizationHint.trim() : null,
      promptLanguage: originMode === 'dataset' ? datasetPromptLanguage : undefined,
      strategy: 'error_pattern_analysis',
      strategyConfig,
      startingMode,
      sourceExperimentId,
      promptId: promptIdValue,
      baseVersionId: baseVersionIdValue,
      datasetId: resolvedDatasetId,
      experimentModelId: effectiveModelId,
      analysisModelId: effectiveAnalysisModelId,
      goals: numericGoals,
      fieldWhitelist,
      runConfig: {
        temperature,
        concurrency,
        rpmLimit: rpm,
        tpmLimit: tpm,
        sampleTimeoutSeconds,
        retries,
        imageEncoding,
      },
      loopLimits: {
        maxRounds,
        stopAfterNoImprovementRounds: noImprovementRounds,
      },
    };
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    const dto = buildDto();
    if (!dto) return;
    try {
      const created = await createMutation.mutateAsync(dto);
      router.push(`/optimizations/${created.id}`);
    } catch (error) {
      const message = getApiErrorMessage(error);
      setSubmitError(
        message === 'optimization_name_taken'
          ? t('common.formError.nameTaken')
          : (message ?? t('optimizations.new.error.submitFailed')),
      );
    }
  };

  const isSubmitting = createMutation.isPending;
  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="optimization-new-page">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href={`/optimizations`} className="hover:text-foreground">
            {t('optimizations.new.backToList')}
          </Link>
        </div>

        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('optimizations.new.title')}</h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{t('optimizations.new.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild type="button" variant="ghost" size="sm" className="h-9">
              <Link href={`/optimizations`}>{t('optimizations.new.cancel')}</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-9" disabled={isSubmitting}>
              {t('optimizations.new.saveDraft')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1"
              onClick={handleSubmit}
              disabled={isSubmitting || optimizationNameTaken}
              data-testid="optimization-new-submit"
            >
              {isSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t('optimizations.new.start')}
            </Button>
          </div>
        </div>

        {submitError && (
          <div
            role="alert"
            className={cn(
              'mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]',
              'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            <AlertTriangle className="mt-0.5 size-3.5 flex-none" aria-hidden="true" />
            <span className="flex-1">{submitError}</span>
            <button
              type="button"
              onClick={() => setSubmitError(null)}
              aria-label={t('optimizations.new.error.dismiss')}
              className="ml-2 inline-flex size-5 items-center justify-center rounded text-destructive/80 hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StepIndicator
            step={1}
            state={originStatus as 'current' | 'done'}
            title={t('optimizations.new.steps.naming')}
            detail={t('optimizations.new.steps.namingDetail')}
          />
          <StepIndicator
            step={2}
            state={expStatus as 'current' | 'done'}
            title={t('optimizations.new.steps.experiment')}
            detail={t('optimizations.new.steps.experimentDetail')}
          />
          <StepIndicator
            step={3}
            state={optStatus as 'current' | 'done'}
            title={t('optimizations.new.steps.optimization')}
            detail={t('optimizations.new.steps.optimizationDetail')}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* ----------- LEFT main column ----------- */}
          <div className="flex min-w-0 flex-col gap-4">
            {/* card 1: naming + starting point */}
            <section className="rounded-lg border bg-card" data-testid="optimization-new-step-naming">
              <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
                <StepAnchor index={1} />
                <h3 className="text-[14px] font-semibold">{t('optimizations.new.steps.naming')}</h3>
                <span className="text-[12px] text-muted-foreground">{t('optimizations.new.steps.namingDetail')}</span>
              </div>
              <div className="space-y-5 p-5">
                <div>
                  <SubSectionHead tone="info" label={t('optimizations.new.naming.section')} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.naming.name')} <span className="text-destructive">*</span>
                      </label>
                      <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="font-mono text-[13px]"
                        placeholder={t('optimizations.new.naming.namePlaceholder')}
                        aria-invalid={optimizationNameTaken || undefined}
                        data-testid="optimization-new-name"
                      />
                      {optimizationNameTaken ? (
                        <div className="text-[11px] text-destructive">{t('common.formError.nameTaken')}</div>
                      ) : (
                        <div className="text-[11px] text-muted-foreground">
                          {t('optimizations.new.naming.nameHelp')}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.naming.description')}
                      </label>
                      <Input
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={t('optimizations.new.naming.descriptionPlaceholder')}
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t border-dashed pt-5">
                  <SubSectionHead tone="info" label={t('optimizations.new.naming.startingPoint')} />
                  <label className="mb-2 block text-[12.5px] font-medium">
                    {t('optimizations.new.origin.label')} <span className="text-destructive">*</span>
                  </label>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div className="contents">
                      <ModeTile
                        testId="optimization-new-origin-mode-experiment"
                        active={originMode === 'experiment'}
                        icon={FlaskConical}
                        title={t('optimizations.new.origin.experimentTitle')}
                        description={t('optimizations.new.origin.experimentDesc')}
                        onClick={() => handleOriginModeChange('experiment')}
                      />
                    </div>
                    <div className="contents">
                      <ModeTile
                        testId="optimization-new-origin-mode-prompt"
                        active={originMode === 'prompt'}
                        icon={FileText}
                        title={t('optimizations.new.origin.promptTitle')}
                        description={t('optimizations.new.origin.promptDesc')}
                        onClick={() => handleOriginModeChange('prompt')}
                      />
                    </div>
                    <div className="contents">
                      <ModeTile
                        testId="optimization-new-origin-mode-dataset"
                        active={originMode === 'dataset'}
                        icon={Database}
                        title={t('optimizations.new.origin.datasetTitle')}
                        description={t('optimizations.new.origin.datasetDesc')}
                        onClick={() => handleOriginModeChange('dataset')}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2" data-testid={`optimization-new-origin-picker-${originMode}`}>
                    <label className="block text-[12.5px] font-medium">
                      {originMode === 'experiment'
                        ? t('optimizations.new.origin.experimentPicker')
                        : originMode === 'prompt'
                          ? t('optimizations.new.origin.promptPicker')
                          : t('optimizations.new.origin.datasetPicker')}{' '}
                      <span className="text-destructive">*</span>
                    </label>
                    {originMode === 'experiment' ? (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,300px)_1fr]">
                        <div className="max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                          <MiniSearch
                            value={experimentSearch}
                            onChange={setExperimentSearch}
                            placeholder={t('optimizations.new.origin.searchExperiment')}
                          />
                          {experimentsLoading ? (
                            <PickerEmpty>{t('optimizations.new.origin.experimentLoading')}</PickerEmpty>
                          ) : experimentsQuery.isError ? (
                            <PickerEmpty>{t('optimizations.new.origin.experimentError')}</PickerEmpty>
                          ) : filteredExperiments.length === 0 ? (
                            <PickerEmpty>
                              {experiments.length === 0
                                ? t('optimizations.new.origin.experimentEmpty')
                                : t('optimizations.new.origin.experimentEmptySuccess')}
                            </PickerEmpty>
                          ) : (
                            filteredExperiments.map((experiment) => (
                              <ExperimentRow
                                key={experiment.id}
                                experiment={experiment}
                                selected={experiment.id === effectiveExperimentId}
                                onSelect={() => applyExperimentDefaults(experiment)}
                              />
                            ))
                          )}
                        </div>
                        <ExperimentDetailPanel
                          experiment={selectedExperiment ?? null}
                          modelMissing={!!selectedExperiment && !modelOf(selectedExperiment.modelId)}
                        />
                      </div>
                    ) : originMode === 'prompt' ? (
                      <div className="rounded-md border bg-background">
                        <MiniSearch
                          value={promptSearch}
                          onChange={setPromptSearch}
                          placeholder={t('optimizations.new.origin.searchPrompt')}
                        />
                        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="border-b md:border-b-0 md:border-r">
                            <div className="border-b px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                              {t('optimizations.new.origin.promptColumn')}
                            </div>
                            <div className="max-h-[360px] overflow-y-auto overflow-x-hidden">
                              {promptsLoading ? (
                                <PickerEmpty>{t('optimizations.new.origin.promptLoading')}</PickerEmpty>
                              ) : promptsQuery.isError ? (
                                <PickerEmpty>{t('optimizations.new.origin.promptError')}</PickerEmpty>
                              ) : filteredPrompts.length === 0 ? (
                                <PickerEmpty>{t('optimizations.new.origin.promptEmpty')}</PickerEmpty>
                              ) : (
                                filteredPrompts.map((prompt) => (
                                  <div key={prompt.id} data-testid={`optimization-new-prompt-row-${prompt.id}`}>
                                    <PromptRow
                                      prompt={prompt}
                                      selected={prompt.id === effectivePromptId}
                                      onSelect={() => handlePromptSelect(prompt.id)}
                                    />
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="border-b px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                              {t('optimizations.new.origin.versionColumn')}
                            </div>
                            <div className="max-h-[360px] overflow-y-auto overflow-x-hidden">
                              {promptDetailLoading ? (
                                <PickerEmpty>{t('optimizations.new.origin.promptVersionLoading')}</PickerEmpty>
                              ) : promptDetailQuery.isError ? (
                                <PickerEmpty>{t('optimizations.new.origin.promptVersionError')}</PickerEmpty>
                              ) : promptVersions.length === 0 ? (
                                <PickerEmpty>{t('optimizations.new.origin.promptVersionEmpty')}</PickerEmpty>
                              ) : (
                                promptVersions.map((version) => (
                                  <div key={version.id} data-testid={`optimization-new-version-row-${version.id}`}>
                                    <PromptVersionRow
                                      option={version}
                                      selected={version.id === effectivePromptVersionId}
                                      onSelect={() => setSelectedPromptVersionId(version.id)}
                                    />
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                        <PromptVersionPreview option={selectedPromptVersion} />
                      </div>
                    ) : (
                      <div className="max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                        <MiniSearch
                          value={datasetSearch}
                          onChange={setDatasetSearch}
                          placeholder={t('optimizations.new.origin.searchDataset')}
                        />
                        {datasetsLoading ? (
                          <PickerEmpty>{t('optimizations.new.origin.datasetLoading')}</PickerEmpty>
                        ) : datasetsQuery.isError ? (
                          <PickerEmpty>{t('optimizations.new.origin.datasetError')}</PickerEmpty>
                        ) : filteredDatasets.length === 0 ? (
                          <PickerEmpty>{t('optimizations.new.origin.datasetEmpty')}</PickerEmpty>
                        ) : (
                          filteredDatasets.map((dataset) => (
                            <div key={dataset.id} data-testid={`optimization-new-dataset-row-${dataset.id}`}>
                              <DatasetRow
                                dataset={dataset}
                                selected={dataset.id === effectiveDatasetId}
                                onSelect={() => setSelectedDatasetId(dataset.id)}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {originMode === 'dataset' && (
                    <div
                      className={cn(
                        'mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]',
                        optimizationTone.info.border,
                        optimizationTone.info.bg,
                      )}
                      data-testid="optimization-new-dataset-first-version-hint"
                    >
                      <Sparkles
                        className="mt-0.5 size-3.5 shrink-0 text-[var(--status-canary-fg)]"
                        aria-hidden="true"
                      />
                      <span>{t('optimizations.new.origin.datasetFirstVersionHint')}</span>
                    </div>
                  )}

                  {originMode === 'prompt' && (
                    <div className="mt-4 space-y-2" data-testid="optimization-new-origin-prompt-dataset-picker">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <label className="block text-[12.5px] font-medium">
                          {t('optimizations.new.origin.promptDatasetPicker')}{' '}
                          <span className="text-destructive">*</span>
                        </label>
                        {selectedPrompt?.defaultDatasetId &&
                          effectiveDatasetId &&
                          effectiveDatasetId !== selectedPrompt.defaultDatasetId && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px]',
                                optimizationTone.warning.pill,
                              )}
                            >
                              <AlertTriangle className="size-3" aria-hidden="true" />
                              {t('optimizations.new.origin.promptDatasetMismatch')}
                            </span>
                          )}
                        {selectedPrompt?.defaultDatasetId && effectiveDatasetId === selectedPrompt.defaultDatasetId && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px]',
                              optimizationTone.positive.pill,
                            )}
                          >
                            <Check className="size-3" aria-hidden="true" />
                            {t('optimizations.new.origin.promptDatasetDefault')}
                          </span>
                        )}
                      </div>
                      <div className="max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                        <MiniSearch
                          value={datasetSearch}
                          onChange={setDatasetSearch}
                          placeholder={t('optimizations.new.origin.searchDataset')}
                        />
                        {datasetsLoading ? (
                          <PickerEmpty>{t('optimizations.new.origin.datasetLoading')}</PickerEmpty>
                        ) : datasetsQuery.isError ? (
                          <PickerEmpty>{t('optimizations.new.origin.datasetError')}</PickerEmpty>
                        ) : filteredDatasets.length === 0 ? (
                          <PickerEmpty>{t('optimizations.new.origin.datasetEmpty')}</PickerEmpty>
                        ) : (
                          filteredDatasets.map((dataset) => (
                            <div key={dataset.id} data-testid={`optimization-new-dataset-row-${dataset.id}`}>
                              <DatasetRow
                                dataset={dataset}
                                selected={dataset.id === effectiveDatasetId}
                                onSelect={() => setSelectedDatasetId(dataset.id)}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* card 2: experiment config */}
            <section className="rounded-lg border bg-card" data-testid="optimization-new-step-experiment">
              <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
                <StepAnchor index={2} />
                <h3 className="text-[14px] font-semibold">{t('optimizations.new.steps.experiment')}</h3>
                <span className="text-[12px] text-muted-foreground">
                  {t('optimizations.new.steps.experimentDetail')}
                </span>
              </div>
              <div className="space-y-5 p-5">
                <div>
                  <label className="mb-1.5 block text-[12.5px] font-medium">
                    {t('optimizations.new.experiment.modelPicker')} <span className="text-destructive">*</span>
                  </label>
                  <div className="max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                    <MiniSearch
                      value={modelSearch}
                      onChange={setModelSearch}
                      placeholder={t('optimizations.new.experiment.searchModel')}
                    />
                    {modelsLoading ? (
                      <PickerEmpty>{t('optimizations.new.experiment.modelLoading')}</PickerEmpty>
                    ) : modelsQuery.isError ? (
                      <PickerEmpty>{t('optimizations.new.experiment.modelError')}</PickerEmpty>
                    ) : filteredModels.length === 0 ? (
                      <PickerEmpty>{t('optimizations.new.experiment.modelEmpty')}</PickerEmpty>
                    ) : (
                      filteredModels.map((model) => (
                        <div key={model.id} data-testid={`optimization-new-model-row-${model.id}`}>
                          <ModelOptionRow
                            model={model}
                            selected={model.id === effectiveModelId}
                            onSelect={() => applyModelDefaults(model)}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-t border-dashed pt-5">
                  <SubSectionHead tone="info" label={t('optimizations.new.experiment.params')} />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.experiment.temperature')}
                      </label>
                      <Input
                        value={temperature}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next)) setTemperature(next);
                        }}
                        className="font-mono text-[13px]"
                        data-testid="optimization-new-temperature"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.experiment.concurrency')}
                      </label>
                      <Input
                        value={concurrency}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next)) setConcurrency(next);
                        }}
                        className="font-mono text-[13px]"
                        data-testid="optimization-new-concurrency"
                      />
                      <div
                        className="font-mono text-[10.5px] text-muted-foreground"
                        data-testid="optimization-new-concurrency-limit"
                      >
                        {selectedModel
                          ? formatTemplate(t('optimizations.new.experiment.modelLimitSuffix'), {
                              limit: formatModelLimit(selectedModel.concurrency.limit),
                            })
                          : t('optimizations.new.experiment.modelLimitMissing')}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">{t('optimizations.new.experiment.rpm')}</label>
                      <Input
                        value={rpm}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next)) setRpm(next);
                        }}
                        className="font-mono text-[13px]"
                        data-testid="optimization-new-rpm"
                      />
                      <div
                        className="font-mono text-[10.5px] text-muted-foreground"
                        data-testid="optimization-new-rpm-limit"
                      >
                        {selectedModel
                          ? formatTemplate(t('optimizations.new.experiment.modelLimitSuffix'), {
                              limit: formatModelLimit(selectedModel.rpm.limit),
                            })
                          : t('optimizations.new.experiment.modelLimitMissing')}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">{t('optimizations.new.experiment.tpm')}</label>
                      <Input
                        value={formatThousand(tpm)}
                        onChange={(event) => {
                          const next = Number(event.target.value.replace(/\s/g, ''));
                          if (Number.isFinite(next)) setTpm(next);
                        }}
                        className="font-mono text-[13px]"
                        data-testid="optimization-new-tpm"
                      />
                      <div
                        className="font-mono text-[10.5px] text-muted-foreground"
                        data-testid="optimization-new-tpm-limit"
                      >
                        {selectedModel
                          ? formatTemplate(t('optimizations.new.experiment.modelLimitSuffix'), {
                              limit: formatModelLimit(selectedModel.tpm.limit),
                            })
                          : t('optimizations.new.experiment.modelLimitMissing')}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.experiment.sampleTimeoutSeconds')}
                      </label>
                      <Input
                        value={sampleTimeoutSeconds}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next > 0) setSampleTimeoutSeconds(next);
                        }}
                        className="font-mono text-[13px]"
                        data-testid="optimization-new-sample-timeout"
                      />
                      <div className="font-mono text-[10.5px] text-muted-foreground">
                        {t('optimizations.new.experiment.sampleTimeoutSecondsHint')}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.experiment.retries')}
                      </label>
                      <Input
                        value={retries}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next >= 0) setRetries(next);
                        }}
                        className="font-mono text-[13px]"
                        data-testid="optimization-new-retries"
                      />
                      <div className="font-mono text-[10.5px] text-muted-foreground">
                        {t('optimizations.new.experiment.retriesHint')}
                      </div>
                    </div>
                    {(impliedDataset?.hasImages ||
                      (originMode === 'experiment' && selectedExperiment?.datasetHasImages)) && (
                      <div className="space-y-1.5">
                        <label className="block text-[12.5px] font-medium">
                          {t('optimizations.new.experiment.imageEncoding')}
                        </label>
                        <div
                          className="inline-flex rounded-md border bg-background p-0.5"
                          data-testid="optimization-new-image-encoding"
                        >
                          <button
                            type="button"
                            onClick={() => setImageEncoding('url')}
                            className={cn(
                              'cursor-pointer rounded px-3 py-1 font-mono text-[12px] transition-colors',
                              imageEncoding === 'url'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-muted',
                            )}
                            data-testid="optimization-new-image-encoding-url"
                          >
                            {t('optimizations.new.experiment.imageEncodingUrl')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setImageEncoding('base64')}
                            className={cn(
                              'cursor-pointer rounded px-3 py-1 font-mono text-[12px] transition-colors',
                              imageEncoding === 'base64'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-muted',
                            )}
                            data-testid="optimization-new-image-encoding-base64"
                          >
                            {t('optimizations.new.experiment.imageEncodingBase64')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* card 3: optimization config */}
            <section className="rounded-lg border bg-card" data-testid="optimization-new-step-optimization">
              <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
                <StepAnchor index={3} />
                <h3 className="text-[14px] font-semibold">{t('optimizations.new.steps.optimization')}</h3>
                <span className="text-[12px] text-muted-foreground">
                  {t('optimizations.new.steps.optimizationDetail')}
                </span>
              </div>
              <div className="space-y-6 p-5">
                {/* prompt generation hint */}
                <div>
                  <SubSectionHead tone="info" label={t('optimizations.new.optimization.hintSection')} />
                  {originMode === 'dataset' && (
                    <PromptLanguageSelect
                      value={datasetPromptLanguage}
                      onChange={setDatasetPromptLanguage}
                      helpKey="optimizations.new.optimization.datasetPromptLanguageHelp"
                      className="mb-4 max-w-[420px]"
                      triggerClassName="h-8"
                    />
                  )}
                  <label
                    htmlFor="optimization-new-optimization-hint"
                    className="mb-1.5 block text-[12.5px] font-medium"
                  >
                    {t('optimizations.new.optimization.hint')}
                  </label>
                  <textarea
                    id="optimization-new-optimization-hint"
                    data-testid="optimization-new-optimization-hint"
                    value={optimizationHint}
                    onChange={(event) => setOptimizationHint(event.target.value)}
                    maxLength={4000}
                    rows={4}
                    className="min-h-[96px] w-full resize-y rounded-md border bg-background px-3 py-2 text-[12.5px] text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder={t('optimizations.new.optimization.hintPlaceholder')}
                  />
                  <div className="mt-1 flex justify-end font-mono text-[10.5px] text-muted-foreground">
                    {formatTemplate(t('optimizations.new.optimization.hintCounter'), {
                      count: optimizationHint.length,
                    })}
                  </div>
                </div>

                {/* goals */}
                <div>
                  <SubSectionHead tone="info" label={t('optimizations.new.optimization.goalsSection')} />
                  {goals.length === 0 ? (
                    <PickerEmpty>{t('optimizations.new.optimization.goalEmpty')}</PickerEmpty>
                  ) : (
                    <div className="space-y-2">
                      {goals.map((goal) => (
                        <div
                          key={goal.id}
                          className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1.4fr_0.8fr_0.8fr_1.1fr_28px]"
                        >
                          <select
                            value={goal.metric}
                            onChange={(event) => updateGoal(goal.id, { metric: event.target.value as GoalMetric })}
                            className="h-8 rounded-md border bg-background px-2.5 font-mono text-[12.5px] text-foreground"
                            aria-label={t('optimizations.new.optimization.metric.accuracy')}
                            data-testid="optimization-new-goal-metric"
                          >
                            {(Object.keys(METRIC_LABEL_KEY) as GoalMetric[]).map((metric) => (
                              <option key={metric} value={metric}>
                                {t(METRIC_LABEL_KEY[metric])}
                              </option>
                            ))}
                          </select>
                          <select
                            value={goal.comparator}
                            onChange={(event) =>
                              updateGoal(goal.id, { comparator: event.target.value as GoalComparator })
                            }
                            className="h-8 rounded-md border bg-background px-2.5 font-mono text-[12.5px] text-foreground"
                            aria-label={t('optimizations.new.optimization.comparator.gte')}
                            data-testid="optimization-new-goal-comparator"
                          >
                            {(Object.keys(COMPARATOR_LABEL_KEY) as GoalComparator[]).map((cmp) => (
                              <option key={cmp} value={cmp}>
                                {t(COMPARATOR_LABEL_KEY[cmp])}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={goal.target}
                            onChange={(event) => updateGoal(goal.id, { target: event.target.value })}
                            className="h-8 font-mono text-[12.5px]"
                            data-testid="optimization-new-goal-target"
                          />
                          <select
                            value={goal.scope}
                            onChange={(event) => updateGoal(goal.id, { scope: event.target.value })}
                            className="h-8 rounded-md border bg-background px-2.5 font-mono text-[12.5px] text-foreground"
                            aria-label={t('optimizations.new.optimization.scope.overall')}
                          >
                            <option value="overall">{t('optimizations.new.optimization.scope.overall')}</option>
                            {scopeOptions.map((label) => (
                              <option key={label} value={label}>
                                {formatTemplate(t('optimizations.new.optimization.scope.class'), { label })}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeGoal(goal.id)}
                            aria-label={t('optimizations.new.optimization.removeGoal')}
                            className="inline-flex size-7 items-center justify-center self-center justify-self-end rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addGoal}
                    className="mt-2 h-8 gap-1 self-start"
                    data-testid="optimization-new-goal-add"
                  >
                    <Plus className="size-3.5" />
                    {t('optimizations.new.optimization.addGoal')}
                  </Button>
                </div>

                {/* iter config: fields + analysis model + loop limits */}
                <div className="border-t border-dashed pt-5">
                  <SubSectionHead tone="positive" label={t('optimizations.new.optimization.iterSection')} />

                  {/* field selection */}
                  <label className="mb-2 block text-[12.5px] font-medium">
                    {t('optimizations.new.optimization.fields')}
                  </label>
                  {!impliedDataset ? (
                    <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-[12px] text-muted-foreground">
                      {originMode === 'prompt'
                        ? t('optimizations.new.optimization.fieldsHint')
                        : datasetsLoading
                          ? t('optimizations.new.optimization.fieldsLoading')
                          : t('optimizations.new.optimization.fieldsHint')}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* input fields — locked */}
                      <div className="max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                        <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-2">
                          <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                            <span
                              aria-hidden="true"
                              className={cn('inline-block size-1.5 rounded-full', optimizationTone.info.fill)}
                            />
                            {t('optimizations.new.optimization.inputFields')}
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            {t('optimizations.new.optimization.inputFieldsHint')}
                          </span>
                        </div>
                        {inputFields.length > 0 ? (
                          inputFields.map((field) => (
                            <div
                              key={field.name}
                              className="flex items-center gap-2.5 border-b px-3 py-2 font-mono text-[12px] last:border-b-0"
                            >
                              <FieldCheckbox checked locked ariaLabel={field.name} />
                              <span className="flex-1 font-medium text-foreground">{field.name}</span>
                              <Tag>{field.type}</Tag>
                            </div>
                          ))
                        ) : (
                          <PickerEmpty>{t('optimizations.new.optimization.fieldsInputEmpty')}</PickerEmpty>
                        )}
                      </div>

                      {/* meta fields — toggle */}
                      <div className="max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                        <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-2">
                          <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                            <span
                              aria-hidden="true"
                              className={cn('inline-block size-1.5 rounded-full', optimizationTone.warning.fill)}
                            />
                            {t('optimizations.new.optimization.metaFields')}
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            {t('optimizations.new.optimization.metaFieldsHint')}
                          </span>
                        </div>
                        {metaFields.length > 0 ? (
                          metaFields.map((field) => (
                            <div
                              key={field.name}
                              className="flex items-center gap-2.5 border-b px-3 py-2 font-mono text-[12px] last:border-b-0"
                            >
                              <FieldCheckbox
                                checked={isMetaChecked(field.name)}
                                ariaLabel={field.name}
                                onClick={() => toggleMetaField(field.name)}
                              />
                              <span className="flex-1 font-medium text-foreground">{field.name}</span>
                              <Tag>{field.type}</Tag>
                            </div>
                          ))
                        ) : (
                          <PickerEmpty>{t('optimizations.new.optimization.fieldsMetaEmpty')}</PickerEmpty>
                        )}
                      </div>
                    </div>
                  )}

                  {/* analysis model */}
                  <div className="mt-5">
                    <label className="mb-1.5 block text-[12.5px] font-medium">
                      {t('optimizations.new.optimization.analysisModel')} <span className="text-destructive">*</span>
                    </label>
                    <div className="text-[11px] text-muted-foreground">
                      {t('optimizations.new.optimization.analysisModelHelp')}
                    </div>
                    <div className="mt-2 max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                      <MiniSearch
                        value={analysisModelSearch}
                        onChange={setAnalysisModelSearch}
                        placeholder={t('optimizations.new.optimization.searchAnalysisModel')}
                      />
                      {modelsLoading ? (
                        <PickerEmpty>{t('optimizations.new.experiment.modelLoading')}</PickerEmpty>
                      ) : modelsQuery.isError ? (
                        <PickerEmpty>{t('optimizations.new.experiment.modelError')}</PickerEmpty>
                      ) : filteredAnalysisModels.length === 0 ? (
                        <PickerEmpty>{t('optimizations.new.experiment.modelEmpty')}</PickerEmpty>
                      ) : (
                        filteredAnalysisModels.map((model) => (
                          <div key={model.id} data-testid={`optimization-new-analysis-model-row-${model.id}`}>
                            <ModelOptionRow
                              model={model}
                              selected={model.id === effectiveAnalysisModelId}
                              onSelect={() => setAnalysisModelId(model.id)}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* loop limits */}
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.optimization.maxRounds')}
                      </label>
                      <Slider
                        value={maxRounds}
                        min={3}
                        max={20}
                        onChange={setMaxRounds}
                        formatValue={(value) =>
                          formatTemplate(t('optimizations.new.optimization.maxRoundsValue'), { value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12.5px] font-medium">
                        {t('optimizations.new.optimization.noImprovement')}
                      </label>
                      <Slider
                        value={noImprovementRounds}
                        min={0}
                        max={5}
                        onChange={setNoImprovementRounds}
                        formatValue={(value) =>
                          value === 0
                            ? t('optimizations.new.optimization.noImprovementUnlimited')
                            : formatTemplate(t('optimizations.new.optimization.noImprovementValue'), { value })
                        }
                      />
                    </div>
                  </div>

                  {/* dataset-only sampling params (initial prompt generation) */}
                  {originMode === 'dataset' && (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="block text-[12.5px] font-medium">
                          {t('optimizations.new.optimization.initialSamplingRounds')}
                        </label>
                        <Slider
                          value={initialSamplingRounds}
                          min={1}
                          max={10}
                          onChange={setInitialSamplingRounds}
                          formatValue={(value) =>
                            formatTemplate(t('optimizations.new.optimization.initialSamplingRoundsValue'), { value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[12.5px] font-medium">
                          {t('optimizations.new.optimization.initialSamplesPerRound')}
                        </label>
                        <Slider
                          value={initialSamplesPerRound}
                          min={5}
                          max={200}
                          step={5}
                          onChange={setInitialSamplesPerRound}
                          formatValue={(value) =>
                            formatTemplate(t('optimizations.new.optimization.initialSamplesPerRoundValue'), { value })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* action bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[11.5px] text-muted-foreground">{t('optimizations.new.footerNote')}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-9" disabled={isSubmitting}>
                  {t('optimizations.new.saveDraft')}
                </Button>
                <Button asChild type="button" variant="outline" size="sm" className="h-9">
                  <Link href={`/optimizations`}>{t('optimizations.new.cancel')}</Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 gap-1"
                  onClick={handleSubmit}
                  disabled={isSubmitting || optimizationNameTaken}
                >
                  {isSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  {t('optimizations.new.start')}
                </Button>
              </div>
            </div>
          </div>

          {/* ----------- RIGHT rail ----------- */}
          <aside
            className="flex flex-col gap-3 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1"
            data-testid="optimization-new-side-panel"
          >
            <div
              className={cn(
                'rounded-lg border p-4',
                optimizationTone.info.border,
                'bg-[color-mix(in_oklab,var(--status-canary-bg)_50%,var(--card))]',
                optimizationTone.info.text,
              )}
            >
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
                <Calculator className="size-3.5" aria-hidden="true" />
                {t('optimizations.new.estimate.title')}
              </div>
              <div className="space-y-2 text-[12.5px]">
                <EstimateRow
                  label={t('optimizations.new.estimate.experimentTokens')}
                  valueLabel={
                    totalExperimentTokens > 0
                      ? `~ ${(totalExperimentTokens / 1_000_000).toFixed(1)} M`
                      : t('optimizations.new.estimate.unknown')
                  }
                />
                <EstimateRow
                  label={t('optimizations.new.estimate.experimentCost')}
                  valueLabel={
                    experimentCost > 0 ? `$ ${experimentCost.toFixed(2)}` : t('optimizations.new.estimate.unknown')
                  }
                />
                <EstimateRow
                  label={t('optimizations.new.estimate.analysisTokens')}
                  valueLabel={
                    totalAnalysisTokens > 0
                      ? `~ ${(totalAnalysisTokens / 1_000_000).toFixed(2)} M`
                      : t('optimizations.new.estimate.unknown')
                  }
                />
                <EstimateRow
                  label={t('optimizations.new.estimate.analysisCost')}
                  valueLabel={
                    analysisCost > 0 ? `$ ${analysisCost.toFixed(2)}` : t('optimizations.new.estimate.unknown')
                  }
                />
                <div
                  className={cn(
                    'mt-1 flex items-baseline justify-between border-t pt-2 text-[13px]',
                    optimizationTone.info.border,
                  )}
                >
                  <span className="opacity-80">
                    {formatTemplate(t('optimizations.new.estimate.totalCost'), { rounds: maxRounds })}
                  </span>
                  <span className="font-mono text-[16px] font-semibold">$ {totalCost.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Main>
  );
}

function EstimateRow({ label, valueLabel, subLabel }: { label: string; valueLabel: string; subLabel?: string }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 border-b border-dashed pb-2 last:border-b-0 last:pb-0',
        optimizationTone.info.border,
      )}
    >
      <span className="opacity-80">{label}</span>
      <span className="font-mono font-semibold tabular-nums">
        {valueLabel}
        {subLabel && <span className="ml-1 text-[11px] font-medium text-muted-foreground">{subLabel}</span>}
      </span>
    </div>
  );
}
