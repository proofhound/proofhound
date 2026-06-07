'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CANARY_RELEASE_FILTER_MAX_DEPTH,
  CANARY_RELEASE_FILTER_OPS,
  DEFAULT_PROMPT_LANGUAGE,
  canaryReleaseFilterRulesSchema,
  type CanaryReleaseFilterNodeDto,
  type CanaryReleaseFilterOpDto,
  type ConnectorDetailDto,
  type ConnectorListItemDto,
  type CreateCanaryReleaseInputDto,
  type CreateProductionReleaseInputDto,
  type ProjectModelListItemDto,
  type PromptListItemDto,
  type PromptOutputSchemaDto,
  type PromptVariableDto,
  type PromptVariableTypeDto,
  type PromptVersionDto,
} from '@proofhound/shared';
import { AlertCircle, Check, Filter, ImageIcon, Loader2, Plus, Search, X } from 'lucide-react';
import { Main } from '@proofhound/ui/layout';
import {
  ModalityIconGroup,
  Button,
  Input,
  Label,
  cn,
} from '@proofhound/ui';
import type { ModalityKind } from '@proofhound/ui';
import { PromptVersionPickerRow, PromptVersionPickerTag } from '../../components';
import { useConnector, useConnectors } from '../../hooks';
import { useCreateCanaryRelease, useStartCanaryRelease } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useProjectModels } from '../../hooks';
import { useCreateProductionRelease } from '../../hooks';
import { usePrompt, usePrompts } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useReleaseLineList } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage, getReleaseLineId } from '../../lib';
import { composePromptPreview } from '../prompts/prompt-preview';
import { renderPromptPreviewParts } from '../prompts/prompt-preview-parts';
import { VARIABLE_TONE_CLASSES } from '../prompts/prompt-ui';
import { deriveRecordCategoryOptions, releaseRecordModeFromCategories } from './release-new-model';

interface ReleaseNewPageProps {
  projectId: string;
}

interface PromptVersionOption {
  id: string;
  name: string;
  version: string;
  isLatest: boolean;
  isOnline: boolean;
  status: PromptVersionDto['status'];
  updatedAt: string;
  variables: PromptVariableDto[];
  outputSchema: PromptOutputSchemaDto;
  promptPreview: string;
}

interface FieldOption {
  key: string;
  type: string;
  description: string;
}

const IMAGE_PROMPT_VARIABLE_TYPES = new Set<PromptVariableTypeDto>(['image', 'image_url', 'image_base64']);
const DEFAULT_RPM = 60;
const DEFAULT_TPM = 120_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_QUEUE_TRAFFIC_PERCENT = 10;
const TRAFFIC_PERCENT_PRESETS = [1, 5, 20, 50, 100] as const;
type ReleaseTrafficMode = CreateCanaryReleaseInputDto['trafficMode'];

function buildDefaultReleaseName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `release-${yyyy}${mm}${dd}-`;
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function formatThousand(value: number) {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
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

function formatModelLimit(limit: number): string {
  return limit < 0 ? '∞' : formatThousand(limit);
}

function modelLimitDefaultValue(limit: number, fallback: number): string {
  return String(limit > 0 ? limit : fallback);
}

function formatContextWindow(tokens: number | null): string {
  if (!tokens || tokens <= 0) return '—';
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

function positiveIntegerFromText(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function numberTextWithinLimit(value: string, limit: number | null | undefined): boolean {
  const parsed = positiveIntegerFromText(value);
  return parsed !== null && (!limit || limit < 0 || parsed <= limit);
}

function temperatureFromText(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : null;
}

function trafficPercentFromText(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

function initialTrafficPercentFromParams(params: Pick<URLSearchParams, 'get'>): string {
  const percent = params.get('trafficPercent');
  if (percent && trafficPercentFromText(percent) !== null) return percent;
  const ratio = Number(params.get('trafficRatio'));
  if (Number.isFinite(ratio) && ratio > 0 && ratio <= 1) return String(Math.round(ratio * 100));
  return String(DEFAULT_QUEUE_TRAFFIC_PERCENT);
}

function initialTrafficModeFromParams(params: Pick<URLSearchParams, 'get'>): ReleaseTrafficMode {
  return params.get('trafficMode') === 'dual_run' ? 'dual_run' : 'split';
}

function normalizeLineId(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');
}

function fieldOptionFromUnknown(value: unknown): FieldOption | null {
  if (typeof value === 'string') {
    const key = normalizeFieldKey(value);
    return key ? { key, type: 'unknown', description: '' } : null;
  }
  if (!isRecord(value)) return null;
  const rawKey = value.key ?? value.name ?? value.field;
  const key = typeof rawKey === 'string' ? normalizeFieldKey(rawKey) : '';
  if (!key) return null;
  return {
    key,
    type: typeof value.type === 'string' ? value.type : 'unknown',
    description: typeof value.description === 'string' ? value.description : '',
  };
}

function flattenSchemaProperties(properties: Record<string, unknown>, prefix = ''): FieldOption[] {
  const skipKeys = new Set([
    'type',
    'properties',
    'required',
    'additionalProperties',
    '$schema',
    'title',
    'description',
  ]);
  return Object.entries(properties).flatMap(([key, fieldValue]) => {
    if (skipKeys.has(key)) return [];
    const record = isRecord(fieldValue) ? fieldValue : {};
    const rawType = typeof record.type === 'string' ? record.type : typeof fieldValue;
    const fullKey = normalizeFieldKey(prefix ? `${prefix}.${key}` : key);
    const current: FieldOption = {
      key: fullKey,
      type: rawType,
      description: typeof record.description === 'string' ? record.description : '',
    };
    if (rawType === 'object' && isRecord(record.properties)) {
      const children = flattenSchemaProperties(record.properties, fullKey);
      return children.length > 0 ? [current, ...children] : [current];
    }
    return [current];
  });
}

function schemaToFieldOptions(value: unknown): FieldOption[] {
  if (!isRecord(value)) return [];
  const properties = isRecord(value.properties) ? value.properties : value;
  return flattenSchemaProperties(properties);
}

function dedupeFieldOptions(fields: FieldOption[]): FieldOption[] {
  const seen = new Set<string>();
  const result: FieldOption[] = [];
  for (const field of fields) {
    const key = normalizeFieldKey(field.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...field, key });
  }
  return result;
}

function extractFieldOptionsFromConnector(connector: ConnectorDetailDto | null | undefined): FieldOption[] {
  if (!connector) return [];
  const config: Record<string, unknown> = isRecord(connector.config) ? connector.config : {};
  const candidates: unknown[] = [
    config.expectedPayloadSchema,
    config.confirmedPayloadSchema,
    config.lastPeekPayloadSchema,
    config.peekPayloadSchema,
    config.fieldSchema,
    config.fields,
    config.payloadFields,
  ];
  const options: FieldOption[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      options.push(...candidate.map(fieldOptionFromUnknown).filter((field): field is FieldOption => Boolean(field)));
    } else {
      options.push(...schemaToFieldOptions(candidate));
    }
  }
  return dedupeFieldOptions(options);
}

function inferSourceForVariable(variable: PromptVariableDto, fields: FieldOption[]): string {
  const fieldNames = new Set(fields.map((field) => field.key));
  const candidates = [
    variable.datasetField,
    variable.name,
    `payload.${variable.name}`,
    `data.${variable.name}`,
    `body.${variable.name}`,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (fieldNames.has(candidate)) return candidate;
  }
  const suffix = fields.find((field) => field.key.endsWith(`.${variable.name}`));
  return suffix?.key ?? '';
}

function inferExternalIdField(fields: FieldOption[]): string {
  const candidates = ['id', 'external_id', 'externalId', 'payload.id', 'data.id', 'body.id'];
  const fieldNames = new Set(fields.map((field) => field.key));
  for (const candidate of candidates) {
    if (fieldNames.has(candidate)) return candidate;
  }
  return fields.find((field) => /(^|\.)id$/iu.test(field.key))?.key ?? '';
}

function productionMappingToRecord(
  value: CreateProductionReleaseInputDto['variableMapping'] | unknown,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (!isRecord(value)) return mapping;
  for (const [target, source] of Object.entries(value)) {
    if (typeof source === 'string') mapping[target] = source;
  }
  return mapping;
}

function mergeIds(first: string[], second: string[]) {
  return Array.from(new Set([...first, ...second].filter(Boolean)));
}

function normalizeInheritedFilterRules(value: CreateProductionReleaseInputDto['filterRules'] | unknown) {
  const parsed = canaryReleaseFilterRulesSchema.safeParse(value ?? null);
  return parsed.success ? parsed.data : null;
}

function mapPromptVersionToOption(
  prompt: PromptListItemDto,
  version: PromptVersionDto,
  formatDateTime: (value: string | null | undefined) => string,
): PromptVersionOption {
  const promptLanguage = version.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  return {
    id: version.id,
    name: prompt.name,
    version: `v${version.versionNumber}`,
    isLatest: version.versionNumber === prompt.latestVersionNumber,
    isOnline: version.versionNumber === prompt.currentOnlineVersionNumber,
    status: version.status,
    updatedAt: formatDateTime(version.createdAt),
    variables: version.variables,
    outputSchema: version.outputSchema,
    promptPreview: composePromptPreview({
      body: version.body,
      outputSchema: version.outputSchema,
      promptLanguage,
    }),
  };
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-full border',
        checked ? 'border-primary bg-primary/10' : 'border-border bg-background',
      )}
    >
      {checked ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-[3px] border',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
      )}
    >
      {checked ? <Check className="size-2.5" strokeWidth={3} /> : null}
    </span>
  );
}

function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'positive' | 'warning';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10.5px]',
        tone === 'info' &&
          'border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]',
        tone === 'positive' &&
          'border-[var(--status-success-bd)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
        tone === 'warning' &&
          'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
        tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
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
    <div className="flex items-center gap-2 border-b bg-background px-2.5 py-2">
      <Search className="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-5 w-full min-w-0 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function PickerEmpty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{children}</div>;
}

function StepNumber({ index, done }: { index: number; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-full border font-mono text-[11px] font-semibold',
        done
          ? 'border-[var(--status-running-bd)] bg-[var(--status-running-bg)] text-[var(--status-running-fg)]'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {index}
    </span>
  );
}

function StepCard({
  index,
  done,
  title,
  detail,
  testId,
  children,
}: {
  index: number;
  done: boolean;
  title: string;
  detail: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <StepNumber index={index} done={done} />
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <span className="text-[12px] text-muted-foreground">{detail}</span>
      </div>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

function SubSectionHead({ label }: { label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      <span aria-hidden="true" className="inline-block h-2.5 w-[3px] rounded-[1.5px] bg-primary" />
      {label}
    </div>
  );
}

function RuntimeLimitField({
  label,
  value,
  modelLimit,
  onChange,
}: {
  label: string;
  value: string;
  modelLimit: string;
  onChange: (next: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <Label className="text-[12.5px]">
        {label} <span className="text-destructive">*</span>
      </Label>
      <div className="flex h-9 items-center rounded-md border bg-background pr-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="numeric"
          aria-label={label}
          className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] outline-none"
        />
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
          {formatTemplate(t('canaryReleases.new.field.runConfig.limitSuffix'), { limit: modelLimit })}
        </span>
      </div>
    </div>
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
  const { formatDateTime } = useDateTimeFormatter();
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
          <Tag>{formatTemplate(t('canaryReleases.new.promptVersionCount'), { count: prompt.latestVersionNumber })}</Tag>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {prompt.currentOnlineVersionNumber ? (
            <Tag tone="positive">
              {formatTemplate(t('optimizations.new.origin.promptOnlineVersion'), {
                version: `v${prompt.currentOnlineVersionNumber}`,
              })}
            </Tag>
          ) : (
            <Tag>{t('optimizations.new.origin.promptNoOnlineVersion')}</Tag>
          )}
          <Tag>{prompt.latestVersionStatus}</Tag>
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
          <PromptVersionPickerTag tone="positive">{t('canaryReleases.new.promptVersionOnline')}</PromptVersionPickerTag>
        ) : option.isLatest ? (
          <PromptVersionPickerTag tone="info">{t('canaryReleases.new.promptVersionLatest')}</PromptVersionPickerTag>
        ) : null
      }
      createdAt={option.updatedAt}
    />
  );
}

function PromptVersionPreview({ option }: { option: PromptVersionOption | null }) {
  const { t } = useI18n();
  const previewParts = useMemo(
    () => renderPromptPreviewParts(option?.promptPreview ?? '', option?.variables ?? []),
    [option],
  );
  const imageVariables = useMemo(
    () => option?.variables.filter((variable) => IMAGE_PROMPT_VARIABLE_TYPES.has(variable.type)) ?? [],
    [option],
  );

  if (!option) return <PickerEmpty>{t('canaryReleases.new.promptPreviewEmpty')}</PickerEmpty>;
  return (
    <div className="border-t px-4 py-3" data-testid="release-new-prompt-preview">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {t('canaryReleases.new.promptPreviewTitle')}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {option.name} · {option.version}
        </span>
      </div>
      <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
        {previewParts.map((part, index) => {
          if (part.kind === 'text' || !part.varType || IMAGE_PROMPT_VARIABLE_TYPES.has(part.varType)) {
            return <span key={index}>{part.value}</span>;
          }
          return (
            <span
              key={index}
              className={cn('inline rounded border px-1 font-mono text-[11px]', VARIABLE_TONE_CLASSES[part.varType])}
              data-variable-name={part.name}
            >
              {part.value}
            </span>
          );
        })}
      </pre>
      {imageVariables.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium">
            <ImageIcon className="size-3.5" aria-hidden="true" />
            {t('canaryReleases.new.promptImageVariables')}
          </span>
          {imageVariables.map((variable) => (
            <span
              key={variable.name}
              className={cn(
                'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px]',
                VARIABLE_TONE_CLASSES[variable.type],
              )}
            >
              {`{{${variable.name}}}`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
  const imageCapability = model.capabilities.image;
  const supportsImage = imageCapability !== 'none';
  const modalityKinds: ModalityKind[] = supportsImage ? ['text', 'image'] : ['text'];
  const textCapabilityLabel = t('models.capability.text');
  const imageCapabilityLabel =
    imageCapability === 'both'
      ? t('models.capability.imageBoth')
      : imageCapability === 'url'
        ? t('models.capability.imageUrl')
        : t('models.capability.imageBase64');
  const modalityLabels = supportsImage
    ? { text: textCapabilityLabel, image: imageCapabilityLabel }
    : { text: textCapabilityLabel };
  const ctx = model.contextWindowTokens
    ? formatTemplate(t('canaryReleases.new.modelCap.ctx'), { value: formatContextWindow(model.contextWindowTokens) })
    : null;
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
          {model.status === 'testing' ? <Tag tone="warning">{t('canaryReleases.new.modelTesting')}</Tag> : null}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{model.providerType}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {ctx ? <Tag>{ctx}</Tag> : null}
          <ModalityIconGroup kinds={modalityKinds} size="sm" tooltips={modalityLabels} ariaLabels={modalityLabels} />
          <Tag>
            {formatTemplate(t('canaryReleases.new.modelRpmTpm'), {
              rpm: formatModelLimit(model.rpm.limit),
              tpm: formatModelLimit(model.tpm.limit),
            })}
          </Tag>
        </div>
      </div>
      <div className="flex-none text-right font-mono text-[11.5px] text-muted-foreground">
        <div className="font-semibold text-foreground">
          {formatTemplate(t('canaryReleases.new.modelPriceLabel'), {
            input: formatPrice(model.pricing.inputPerMillion),
            output: formatPrice(model.pricing.outputPerMillion),
          })}
        </div>
        <div className="text-[10.5px] text-muted-foreground">{t('canaryReleases.new.modelPriceUnit')}</div>
      </div>
    </button>
  );
}

function ConnectorOptionRow({
  connector,
  selected,
  multiple = false,
  onSelect,
}: {
  connector: ConnectorListItemDto;
  selected: boolean;
  multiple?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'grid w-full grid-cols-[minmax(140px,0.85fr)_minmax(0,1.15fr)] gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-[color-mix(in_oklab,var(--status-canary-bg)_55%,var(--background))]',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {multiple ? <CheckBox checked={selected} /> : <Radio checked={selected} />}
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold">{connector.name}</div>
          {connector.description ? (
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{connector.description}</div>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 text-[11.5px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag>{connector.type}</Tag>
          <Tag>{connector.healthStatus}</Tag>
        </div>
        <div className="mt-1 truncate font-mono">{connector.configSummary}</div>
      </div>
    </button>
  );
}

function ReadOnlyConnectorRow({
  connector,
  name,
  type,
  emptyLabel,
}: {
  connector?: ConnectorListItemDto | null;
  name?: string | null;
  type?: string | null;
  emptyLabel: string;
}) {
  return (
    <div className="grid w-full grid-cols-[minmax(140px,0.85fr)_minmax(0,1.15fr)] gap-3 rounded-md border bg-muted/35 px-3 py-2.5 text-left">
      <div className="flex min-w-0 items-start gap-2.5">
        <CheckBox checked />
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold">{connector?.name ?? name ?? emptyLabel}</div>
          {connector?.description ? (
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{connector.description}</div>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 text-[11.5px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag>{connector?.type ?? type ?? 'connector'}</Tag>
          {connector ? <Tag>{connector.healthStatus}</Tag> : null}
        </div>
        <div className="mt-1 truncate font-mono">{connector?.configSummary ?? '—'}</div>
      </div>
    </div>
  );
}

function FieldMappingTable({
  fields,
  promptVariables,
  externalIdField,
  mapping,
  readOnly = false,
  onExternalIdFieldChange,
  onMappingChange,
}: {
  fields: FieldOption[];
  promptVariables: PromptVariableDto[];
  externalIdField: string;
  mapping: Record<string, string>;
  readOnly?: boolean;
  onExternalIdFieldChange: (next: string) => void;
  onMappingChange: (target: string, source: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-background p-3">
        <label className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.2fr)]">
          <span className="text-xs font-medium">
            {t('canaryReleases.new.field.externalIdField')} <span className="text-destructive">*</span>
          </span>
          {readOnly ? (
            <div className="min-h-9 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
              {externalIdField || '—'}
            </div>
          ) : (
            <select
              value={externalIdField}
              onChange={(event) => onExternalIdFieldChange(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="release-new-mapping-external-id"
            >
              <option value="">{t('canaryReleases.new.fieldSelectPlaceholder')}</option>
              {fields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.key}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>
      <div className="overflow-hidden rounded-md border bg-background">
        <div className="grid grid-cols-[minmax(180px,0.9fr)_minmax(0,1.1fr)_96px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>{t('canaryReleases.new.mapping.variable')}</span>
          <span>{t('canaryReleases.new.mapping.source')}</span>
          <span>{t('canaryReleases.new.mapping.type')}</span>
        </div>
        {promptVariables.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {t('canaryReleases.new.promptVariablesEmpty')}
          </div>
        ) : (
          promptVariables.map((variable) => (
            <div
              key={variable.name}
              className="grid grid-cols-[minmax(180px,0.9fr)_minmax(0,1.1fr)_96px] items-center gap-2 border-t px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs font-semibold">{variable.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {variable.required
                    ? t('canaryReleases.new.mapping.required')
                    : t('canaryReleases.new.mapping.optional')}
                </div>
              </div>
              {readOnly ? (
                <div className="min-h-8 rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
                  {mapping[variable.name] || t('canaryReleases.new.mapping.unmapped')}
                </div>
              ) : (
                <select
                  value={mapping[variable.name] ?? ''}
                  onChange={(event) => onMappingChange(variable.name, event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`release-new-mapping-source-${variable.name}`}
                >
                  <option value="">{t('canaryReleases.new.mapping.unmapped')}</option>
                  {fields.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.key}
                    </option>
                  ))}
                </select>
              )}
              <span className="font-mono text-[11px] text-muted-foreground">{variable.type}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReadOnlyFilterRules({ value }: { value: CanaryReleaseFilterNodeDto | null }) {
  const { t } = useI18n();
  if (!value) {
    return (
      <div className="rounded-md border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
        {t('canaryReleases.new.filter.empty')}
      </div>
    );
  }
  return (
    <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function FilterRulesBuilder({
  value,
  fields,
  onChange,
}: {
  value: CanaryReleaseFilterNodeDto | null;
  fields: FieldOption[];
  onChange: (next: CanaryReleaseFilterNodeDto | null) => void;
}) {
  const { t } = useI18n();
  const createAtom = (): CanaryReleaseFilterNodeDto => ({
    type: 'atom',
    field: fields[0]?.key ?? '',
    op: 'eq',
    value: '',
  });

  if (!value) {
    return (
      <div className="rounded-md border border-dashed bg-background px-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">{t('canaryReleases.new.filter.empty')}</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ type: 'and', children: [createAtom()] })}
          >
            <Filter className="size-3.5" />
            {t('canaryReleases.new.filter.enable')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <FilterNodeEditor node={value} depth={1} fields={fields} onChange={onChange} onRemove={() => onChange(null)} />
    </div>
  );
}

function FilterNodeEditor({
  node,
  depth,
  fields,
  onChange,
  onRemove,
}: {
  node: CanaryReleaseFilterNodeDto;
  depth: number;
  fields: FieldOption[];
  onChange: (next: CanaryReleaseFilterNodeDto) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const canNest = depth < CANARY_RELEASE_FILTER_MAX_DEPTH;
  const createAtom = (): CanaryReleaseFilterNodeDto => ({
    type: 'atom',
    field: fields[0]?.key ?? '',
    op: 'eq',
    value: '',
  });
  const createGroup = (type: 'and' | 'or'): CanaryReleaseFilterNodeDto => ({ type, children: [createAtom()] });

  if (node.type === 'atom') {
    const needsValue = node.op !== 'exists';
    return (
      <div className="grid grid-cols-1 items-center gap-2 rounded-md border bg-card p-2 md:grid-cols-[minmax(0,1fr)_132px_minmax(0,1fr)_32px]">
        <select
          value={node.field}
          onChange={(event) => onChange({ ...node, field: event.target.value })}
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{t('canaryReleases.new.fieldSelectPlaceholder')}</option>
          {fields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.key}
            </option>
          ))}
        </select>
        <select
          value={node.op}
          onChange={(event) => {
            const op = event.target.value as CanaryReleaseFilterOpDto;
            onChange(
              op === 'exists' ? { type: 'atom', field: node.field, op } : { ...node, op, value: node.value ?? '' },
            );
          }}
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {CANARY_RELEASE_FILTER_OPS.map((op) => (
            <option key={op} value={op}>
              {t(`canaryReleases.new.filter.op.${op}` as TranslationKey)}
            </option>
          ))}
        </select>
        <Input
          value={needsValue ? String(node.value ?? '') : ''}
          disabled={!needsValue}
          onChange={(event) => onChange({ ...node, value: event.target.value })}
          placeholder={
            needsValue ? t('canaryReleases.new.filter.valuePlaceholder') : t('canaryReleases.new.filter.valueDisabled')
          }
          className="h-8 font-mono text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onRemove}
          aria-label={t('canaryReleases.new.filter.remove')}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  if (node.type === 'not') {
    return (
      <div className="space-y-2 rounded-md border bg-muted/25 p-2">
        <div className="flex items-center justify-between gap-2">
          <Tag tone="warning">NOT</Tag>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onRemove}
            aria-label={t('canaryReleases.new.filter.remove')}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <FilterNodeEditor
          node={node.child}
          depth={depth + 1}
          fields={fields}
          onChange={(child) => onChange({ type: 'not', child })}
          onRemove={() => onChange({ type: 'not', child: createAtom() })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/25 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            value={node.type}
            onChange={(event) => onChange({ type: event.target.value as 'and' | 'or', children: node.children })}
            className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="and">AND</option>
            <option value="or">OR</option>
          </select>
          <span className="text-xs text-muted-foreground">
            {formatTemplate(t('canaryReleases.new.filter.depth'), { depth })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => onChange({ ...node, children: [...node.children, createAtom()] })}
          >
            <Plus className="size-3.5" />
            {t('canaryReleases.new.filter.addCondition')}
          </Button>
          {canNest ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => onChange({ ...node, children: [...node.children, createGroup('and')] })}
              >
                {t('canaryReleases.new.filter.addGroup')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() =>
                  onChange({ ...node, children: [...node.children, { type: 'not', child: createAtom() }] })
                }
              >
                NOT
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onRemove}
            aria-label={t('canaryReleases.new.filter.remove')}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="space-y-2 border-l pl-3">
        {node.children.map((child, index) => (
          <FilterNodeEditor
            key={index}
            node={child}
            depth={depth + 1}
            fields={fields}
            onChange={(nextChild) =>
              onChange({
                ...node,
                children: node.children.map((item, itemIndex) => (itemIndex === index ? nextChild : item)),
              })
            }
            onRemove={() => {
              const nextChildren = node.children.filter((_, itemIndex) => itemIndex !== index);
              onChange({ ...node, children: nextChildren.length > 0 ? nextChildren : [createAtom()] });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function RecordCategoriesField({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const allSelected = options.length > 0 && options.every((option) => value.includes(option));

  if (options.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-background px-3 py-4 text-center text-xs text-muted-foreground">
        {t('canaryReleases.new.field.recordCategoriesEmpty')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t('canaryReleases.new.field.recordCategoriesSelected').replace('{count}', String(value.length))}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => onChange(allSelected ? [] : options)}
        >
          {allSelected
            ? t('canaryReleases.new.field.recordCategoriesClear')
            : t('canaryReleases.new.field.recordCategoriesSelectAll')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-3">
        {options.map((option) => {
          const checked = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(checked ? value.filter((item) => item !== option) : [...value, option])}
              aria-pressed={checked}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                checked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              {checked ? <Check className="size-3" strokeWidth={3} /> : null}
              <span className="font-mono">{option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TrafficSelectionField({
  isQueueInput,
  value,
  trafficMode,
  showTrafficMode = false,
  onChange,
  onTrafficModeChange,
}: {
  isQueueInput: boolean;
  value: string;
  trafficMode: ReleaseTrafficMode;
  showTrafficMode?: boolean;
  onChange: (next: string) => void;
  onTrafficModeChange: (next: ReleaseTrafficMode) => void;
}) {
  const { t } = useI18n();
  const parsed = trafficPercentFromText(value);
  const sliderValue = parsed ?? DEFAULT_QUEUE_TRAFFIC_PERCENT;

  if (!isQueueInput) {
    return (
      <div className="rounded-md border bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[13px] font-semibold">{t('releases.new.traffic.production100')}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              {t('canaryReleases.new.field.trafficRatioWebhookHelp')}
            </div>
          </div>
          <Tag tone="positive">100%</Tag>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      {showTrafficMode ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onTrafficModeChange('split')}
            aria-pressed={trafficMode === 'split'}
            className={cn(
              'rounded-md border px-3 py-2 text-left transition-colors',
              trafficMode === 'split' ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-muted/50',
            )}
          >
            <div className="flex items-start gap-2">
              <Radio checked={trafficMode === 'split'} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{t('releases.new.trafficMode.split')}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">{t('releases.new.trafficMode.splitHelp')}</div>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => onTrafficModeChange('dual_run')}
            aria-pressed={trafficMode === 'dual_run'}
            className={cn(
              'rounded-md border px-3 py-2 text-left transition-colors',
              trafficMode === 'dual_run'
                ? 'border-primary bg-primary/10'
                : 'border-border bg-muted/30 hover:bg-muted/50',
            )}
          >
            <div className="flex items-start gap-2">
              <Radio checked={trafficMode === 'dual_run'} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{t('releases.new.trafficMode.dualRun')}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {t('releases.new.trafficMode.dualRunHelp')}
                </div>
              </div>
            </div>
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[13px] font-semibold">{t('releases.new.traffic.queueTitle')}</div>
          <div className="mt-1 max-w-2xl text-[12px] text-muted-foreground">{t('releases.new.traffic.queueHint')}</div>
        </div>
        <Tag tone={sliderValue === 100 ? 'positive' : 'info'}>{sliderValue}%</Tag>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={sliderValue}
          aria-label={t('releases.new.traffic.percentAriaLabel')}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 accent-primary"
        />
        <label className="flex w-full items-center gap-2 sm:w-32">
          <Input
            type="number"
            min={1}
            max={100}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={t('releases.new.traffic.percentInput')}
            className="h-8 font-mono text-xs"
            data-testid="release-new-traffic"
          />
          <span className="font-mono text-xs text-muted-foreground">%</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {TRAFFIC_PERCENT_PRESETS.map((preset) => {
          const selected = parsed === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(String(preset))}
              aria-pressed={selected}
              className={cn(
                'rounded-md border px-2.5 py-1 font-mono text-[11.5px] transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              {preset}%
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 min-h-5 break-words text-[12.5px] font-medium">{value}</div>
    </div>
  );
}

function DeployButton({
  canSubmit,
  isPending,
  label,
  pendingLabel,
  className,
  testId,
}: {
  canSubmit: boolean;
  isPending: boolean;
  label: string;
  pendingLabel: string;
  className?: string;
  testId?: string;
}) {
  return (
    <Button type="submit" className={className} disabled={!canSubmit} data-testid={testId}>
      {isPending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

export function ReleaseNewPage({ projectId }: ReleaseNewPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const initialPromptId = searchParams.get('promptId') ?? '';
  const initialPromptVersionId = searchParams.get('promptVersionId') ?? '';
  const initialModelId = searchParams.get('modelId') ?? '';
  const initialSourceExperimentId =
    searchParams.get('eventType') === 'from_experiment' ? (searchParams.get('sourceExperimentId') ?? '') : '';
  const requestedMode = searchParams.get('mode');
  const requestedLineId = normalizeLineId(searchParams.get('line'));
  const isCanaryLineMode = requestedMode === 'canary' && requestedLineId.length > 0;

  const promptsQuery = usePrompts(projectId);
  const modelsQuery = useProjectModels(projectId, { autoRefresh: false });
  const inputConnectorsQuery = useConnectors(projectId, { direction: 'input' });
  const outputConnectorsQuery = useConnectors(projectId, { direction: 'output' });
  const releaseLinesQuery = useReleaseLineList(projectId);
  const createRelease = useCreateProductionRelease(projectId);
  const createCanaryRelease = useCreateCanaryRelease(projectId);
  const startCanaryRelease = useStartCanaryRelease(projectId);

  const prompts = useMemo(() => promptsQuery.data?.data ?? [], [promptsQuery.data]);
  const models = useMemo(
    () => (modelsQuery.data?.data ?? []).filter((model) => model.status !== 'disabled'),
    [modelsQuery.data],
  );
  const inputConnectors = useMemo(() => inputConnectorsQuery.data?.data ?? [], [inputConnectorsQuery.data]);
  const outputConnectors = useMemo(() => outputConnectorsQuery.data?.data ?? [], [outputConnectorsQuery.data]);
  const outputConnectorById = useMemo(
    () => new Map(outputConnectors.map((connector) => [connector.id, connector])),
    [outputConnectors],
  );
  const selectedReleaseLine = useMemo(
    () => releaseLinesQuery.data.find((line) => line.id === requestedLineId) ?? null,
    [releaseLinesQuery.data, requestedLineId],
  );
  const parentProductionEvent = selectedReleaseLine?.production?.currentEvent ?? null;
  const isAddCanaryToProduction = isCanaryLineMode && Boolean(parentProductionEvent);
  const inheritedVariableMapping = useMemo(
    () => productionMappingToRecord(parentProductionEvent?.variableMapping),
    [parentProductionEvent?.variableMapping],
  );
  const inheritedFilterRules = useMemo(
    () => normalizeInheritedFilterRules(parentProductionEvent?.filterRules),
    [parentProductionEvent?.filterRules],
  );
  const inheritedOutputConnectorIds = useMemo(
    () => parentProductionEvent?.outputConnectorIds ?? [],
    [parentProductionEvent?.outputConnectorIds],
  );
  const inheritedOutputConnectorIdSet = useMemo(
    () => new Set(inheritedOutputConnectorIds),
    [inheritedOutputConnectorIds],
  );

  const [releaseName, setReleaseName] = useState(buildDefaultReleaseName);
  const [description, setDescription] = useState('');
  const [promptSearch, setPromptSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState(initialPromptId);
  const [selectedVersionId, setSelectedVersionId] = useState(initialPromptVersionId);
  const [selectedModelId, setSelectedModelId] = useState(initialModelId);
  const [selectedInputConnectorId, setSelectedInputConnectorId] = useState('');
  const [selectedOutputConnectorIds, setSelectedOutputConnectorIds] = useState<string[]>([]);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});
  const [externalIdFieldOverride, setExternalIdFieldOverride] = useState('');
  const [filterRules, setFilterRules] = useState<CanaryReleaseFilterNodeDto | null>(null);
  const [trafficPercent, setTrafficPercent] = useState(() => initialTrafficPercentFromParams(searchParams));
  const [trafficMode, setTrafficMode] = useState<ReleaseTrafficMode>(() => initialTrafficModeFromParams(searchParams));
  const [recordCategorySelection, setRecordCategorySelection] = useState<string[] | null>(null);
  const [rpm, setRpm] = useState(searchParams.get('rpmLimit') ?? '');
  const [tpm, setTpm] = useState(searchParams.get('tpmLimit') ?? '');
  const [concurrency, setConcurrency] = useState(searchParams.get('concurrency') ?? '');
  const [temperature, setTemperature] = useState(searchParams.get('temperature') ?? '0.3');
  const [runtimeDefaultsModelId, setRuntimeDefaultsModelId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const lockedPromptId = isAddCanaryToProduction ? (selectedReleaseLine?.promptId ?? '') : '';
  const effectivePromptId = lockedPromptId || selectedPromptId || prompts[0]?.id || '';
  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === effectivePromptId) ?? null,
    [effectivePromptId, prompts],
  );
  const selectedPromptQuery = usePrompt(projectId, selectedPrompt?.id ?? '');
  const selectedPromptLoading = useDelayedLoading(selectedPromptQuery.isLoading);
  const promptVersions = useMemo(
    () =>
      selectedPrompt && selectedPromptQuery.data
        ? selectedPromptQuery.data.versions
            .map((version) => mapPromptVersionToOption(selectedPrompt, version, formatDateTime))
            .sort((left, right) => Number(right.version.slice(1)) - Number(left.version.slice(1)))
        : [],
    [formatDateTime, selectedPrompt, selectedPromptQuery.data],
  );
  const availablePromptVersions = useMemo(
    () =>
      isAddCanaryToProduction && parentProductionEvent
        ? promptVersions.filter((option) => option.id !== parentProductionEvent.promptVersionId)
        : promptVersions,
    [isAddCanaryToProduction, parentProductionEvent, promptVersions],
  );
  const preferredVersion = useMemo(() => {
    const latest = availablePromptVersions.find((option) => option.isLatest);
    const online = availablePromptVersions.find((option) => option.isOnline);
    return latest ?? online ?? availablePromptVersions[0] ?? null;
  }, [availablePromptVersions]);
  const effectiveVersionId =
    selectedVersionId && availablePromptVersions.some((option) => option.id === selectedVersionId)
      ? selectedVersionId
      : (preferredVersion?.id ?? '');
  const selectedVersion = useMemo(
    () => availablePromptVersions.find((option) => option.id === effectiveVersionId) ?? null,
    [availablePromptVersions, effectiveVersionId],
  );

  const effectiveModelId = selectedModelId || models[0]?.id || '';
  const selectedModel = useMemo(
    () => models.find((model) => model.id === effectiveModelId) ?? null,
    [effectiveModelId, models],
  );
  if (selectedModel && runtimeDefaultsModelId !== selectedModel.id) {
    setRuntimeDefaultsModelId(selectedModel.id);
    setRpm((current) =>
      current.trim().length > 0 ? current : modelLimitDefaultValue(selectedModel.rpm.limit, DEFAULT_RPM),
    );
    setTpm((current) =>
      current.trim().length > 0 ? current : modelLimitDefaultValue(selectedModel.tpm.limit, DEFAULT_TPM),
    );
    setConcurrency((current) =>
      current.trim().length > 0
        ? current
        : modelLimitDefaultValue(selectedModel.concurrency.limit, DEFAULT_CONCURRENCY),
    );
  }
  const lockedInputConnectorId = isAddCanaryToProduction ? (parentProductionEvent?.inputConnectorId ?? '') : '';
  const effectiveInputConnectorId = lockedInputConnectorId || selectedInputConnectorId || inputConnectors[0]?.id || '';
  const selectedInputConnector = useMemo(
    () => inputConnectors.find((connector) => connector.id === effectiveInputConnectorId) ?? null,
    [effectiveInputConnectorId, inputConnectors],
  );
  const inputConnectorDetailQuery = useConnector(projectId, effectiveInputConnectorId);
  const inputFieldOptions = useMemo(
    () => extractFieldOptionsFromConnector(inputConnectorDetailQuery.data ?? null),
    [inputConnectorDetailQuery.data],
  );
  const inputFieldKeySet = useMemo(() => new Set(inputFieldOptions.map((field) => field.key)), [inputFieldOptions]);
  const effectiveExternalIdField = isAddCanaryToProduction
    ? (parentProductionEvent?.externalIdField ?? '')
    : externalIdFieldOverride && inputFieldKeySet.has(externalIdFieldOverride)
      ? externalIdFieldOverride
      : inferExternalIdField(inputFieldOptions);
  const isQueueInput = selectedInputConnector?.type === 'redis' || selectedInputConnector?.type === 'kafka';
  const trafficPercentValue = isQueueInput ? trafficPercentFromText(trafficPercent) : 100;
  const trafficRatioValue = trafficPercentValue === null ? null : trafficPercentValue / 100;
  const shouldCreateCanaryRelease =
    isAddCanaryToProduction || (isQueueInput && trafficRatioValue !== null && trafficRatioValue < 1);
  const isSubmitting = createRelease.isPending || createCanaryRelease.isPending || startCanaryRelease.isPending;

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

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) =>
      `${model.name} ${model.providerType} ${model.providerModelId}`.toLowerCase().includes(query),
    );
  }, [modelSearch, models]);

  const validSelectedOutputConnectorIds = useMemo(
    () => selectedOutputConnectorIds.filter((id) => outputConnectors.some((connector) => connector.id === id)),
    [outputConnectors, selectedOutputConnectorIds],
  );
  const extraOutputConnectorIds = useMemo(
    () => validSelectedOutputConnectorIds.filter((id) => !inheritedOutputConnectorIdSet.has(id)),
    [inheritedOutputConnectorIdSet, validSelectedOutputConnectorIds],
  );
  const validOutputConnectorIds = useMemo(() => {
    if (!isAddCanaryToProduction) return validSelectedOutputConnectorIds;
    return trafficMode === 'dual_run'
      ? mergeIds(inheritedOutputConnectorIds, extraOutputConnectorIds)
      : inheritedOutputConnectorIds;
  }, [
    extraOutputConnectorIds,
    inheritedOutputConnectorIds,
    isAddCanaryToProduction,
    trafficMode,
    validSelectedOutputConnectorIds,
  ]);
  const recordCategoryOptions = useMemo(
    () => deriveRecordCategoryOptions(selectedVersion?.outputSchema ?? null),
    [selectedVersion],
  );
  const effectiveRecordCategories = useMemo(
    () =>
      recordCategorySelection === null
        ? recordCategoryOptions
        : recordCategorySelection.filter((category) => recordCategoryOptions.includes(category)),
    [recordCategoryOptions, recordCategorySelection],
  );

  const rpmValue = positiveIntegerFromText(rpm);
  const tpmValue = positiveIntegerFromText(tpm);
  const concurrencyValue = positiveIntegerFromText(concurrency);
  const temperatureValue = temperatureFromText(temperature);

  const sourceForVariable = (variable: PromptVariableDto) => {
    if (isAddCanaryToProduction) return inheritedVariableMapping[variable.name] ?? '';
    const override = mappingOverrides[variable.name];
    if (override && inputFieldKeySet.has(override)) return override;
    return inferSourceForVariable(variable, inputFieldOptions);
  };
  const requiredVariableMappingComplete =
    !selectedVersion ||
    selectedVersion.variables.every((variable) => !variable.required || sourceForVariable(variable).trim().length > 0);
  const effectiveFilterRules = isAddCanaryToProduction ? inheritedFilterRules : filterRules;
  const filterRulesValid = canaryReleaseFilterRulesSchema.safeParse(effectiveFilterRules).success;
  const runConfigValid =
    numberTextWithinLimit(rpm, selectedModel?.rpm.limit) &&
    numberTextWithinLimit(tpm, selectedModel?.tpm.limit) &&
    numberTextWithinLimit(concurrency, selectedModel?.concurrency.limit) &&
    temperatureValue !== null;
  const effectiveReleaseName = isAddCanaryToProduction ? '' : releaseName.trim();
  const effectiveDescription = isAddCanaryToProduction ? '' : description.trim();
  const basicComplete = Boolean((isAddCanaryToProduction || effectiveReleaseName) && selectedVersion && selectedModel);
  const connectorComplete =
    (!isCanaryLineMode || isAddCanaryToProduction) &&
    Boolean(selectedInputConnector) &&
    (!isQueueInput || effectiveExternalIdField.trim().length > 0) &&
    requiredVariableMappingComplete &&
    filterRulesValid &&
    trafficRatioValue !== null;
  const runtimeComplete =
    runConfigValid && (recordCategoryOptions.length === 0 || effectiveRecordCategories.length > 0);
  const canSubmit = basicComplete && connectorComplete && runtimeComplete && !isSubmitting;

  const handlePromptSelect = (promptId: string) => {
    if (isAddCanaryToProduction) return;
    setSelectedPromptId(promptId);
    setSelectedVersionId('');
    setMappingOverrides({});
    setExternalIdFieldOverride('');
    setRecordCategorySelection(null);
  };

  const handleVersionSelect = (versionId: string) => {
    setSelectedVersionId(versionId);
    setMappingOverrides({});
    setRecordCategorySelection(null);
  };

  const handleModelSelect = (model: ProjectModelListItemDto) => {
    setSelectedModelId(model.id);
    setRuntimeDefaultsModelId(model.id);
    setRpm(modelLimitDefaultValue(model.rpm.limit, DEFAULT_RPM));
    setTpm(modelLimitDefaultValue(model.tpm.limit, DEFAULT_TPM));
    setConcurrency(modelLimitDefaultValue(model.concurrency.limit, DEFAULT_CONCURRENCY));
  };

  const handleInputConnectorSelect = (connectorId: string) => {
    if (isAddCanaryToProduction) return;
    setSelectedInputConnectorId(connectorId);
    setMappingOverrides({});
    setExternalIdFieldOverride('');
    setFilterRules(null);
  };

  const handleOutputConnectorToggle = (connectorId: string, selected: boolean) => {
    if (isAddCanaryToProduction) {
      if (trafficMode !== 'dual_run' || inheritedOutputConnectorIdSet.has(connectorId)) return;
    }
    setSelectedOutputConnectorIds((current) =>
      selected ? current.filter((id) => id !== connectorId) : [...current, connectorId],
    );
  };

  const formatCreateError = (error: unknown) => {
    const message = getApiErrorMessage(error);
    if (message === 'release_name_taken') return t('common.formError.nameTaken');
    return message ?? t('releases.new.error.createFailed');
  };

  const buildVariableMapping = () => {
    const mapping: Record<string, string> = {};
    for (const variable of selectedVersion?.variables ?? []) {
      const source = sourceForVariable(variable).trim();
      if (source) mapping[variable.name] = source;
    }
    if (effectiveExternalIdField && !mapping.id) mapping.id = effectiveExternalIdField;
    return mapping;
  };

  const buildCanaryVariableMapping = (mapping: Record<string, string>) => {
    const requiredByTarget = new Map(
      (selectedVersion?.variables ?? []).map((variable) => [variable.name, variable.required]),
    );
    return Object.entries(mapping).map(([target, source]) => ({
      source,
      target,
      required: target === 'id' || Boolean(requiredByTarget.get(target)),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    if (
      !canSubmit ||
      !rpmValue ||
      !tpmValue ||
      !concurrencyValue ||
      trafficRatioValue === null ||
      temperatureValue === null ||
      !selectedVersion ||
      !selectedModel ||
      !selectedInputConnector
    ) {
      setSubmitError(t('common.formError.requiredMissing'));
      return;
    }

    const submitReason = effectiveDescription
      ? `${effectiveReleaseName}\n${effectiveDescription}`
      : effectiveReleaseName;
    const variableMapping = buildVariableMapping();
    const recordMode = releaseRecordModeFromCategories(effectiveRecordCategories, recordCategoryOptions);
    const productionRunConfig: CreateProductionReleaseInputDto['runConfig'] = {
      rpmLimit: rpmValue,
      tpmLimit: tpmValue,
      concurrency: concurrencyValue,
      temperature: temperatureValue,
    };
    const canaryRunConfig: CreateCanaryReleaseInputDto['runConfig'] = {
      rpmLimit: rpmValue,
      tpmLimit: tpmValue,
      concurrency: concurrencyValue,
      temperature: temperatureValue,
    };

    if (shouldCreateCanaryRelease) {
      const payload: CreateCanaryReleaseInputDto = {
        ...(isAddCanaryToProduction
          ? {}
          : {
              name: effectiveReleaseName,
              description: effectiveDescription,
            }),
        promptVersionId: selectedVersion.id,
        modelId: selectedModel.id,
        inputConnectorId: selectedInputConnector.id,
        outputConnectorIds: validOutputConnectorIds,
        trafficRatio: trafficRatioValue,
        trafficMode,
        runMode: 'manual',
        recordMode,
        variableMapping: buildCanaryVariableMapping(variableMapping),
        outputMapping: [],
        filterRules: effectiveFilterRules,
        stopConditions: null,
        externalIdField: effectiveExternalIdField,
        annotationSchema: [],
        storageCategories:
          effectiveRecordCategories.length === recordCategoryOptions.length ? [] : effectiveRecordCategories,
        targetDatasetId: null,
        runConfig: canaryRunConfig,
      };

      try {
        const canary = await createCanaryRelease.mutateAsync(payload);
        await startCanaryRelease.mutateAsync(canary.id);
        router.push(`/releases/${getReleaseLineId(effectivePromptId, canary.inputConnectorId)}`);
      } catch (error) {
        setSubmitError(formatCreateError(error));
      }
      return;
    }

    const payload: CreateProductionReleaseInputDto = {
      promptId: effectivePromptId,
      promptVersionId: selectedVersion.id,
      modelId: selectedModel.id,
      inputConnectorId: selectedInputConnector.id,
      outputConnectorIds: validOutputConnectorIds,
      eventType: initialSourceExperimentId ? 'from_experiment' : 'from_prompt',
      runConfig: productionRunConfig,
      variableMapping,
      filterRules: effectiveFilterRules as Record<string, unknown> | null,
      recordMode,
      externalIdField: effectiveExternalIdField || null,
      retentionDays: null,
      submitReason,
      sourceExperimentId: initialSourceExperimentId || null,
      sourceCanaryId: null,
      sourceMetricsSnapshot: null,
      rollbackTargetEventId: null,
    };

    createRelease.mutate(payload, {
      onSuccess: (event) => {
        router.push(`/releases/${getReleaseLineId(event.promptId, event.inputConnectorId)}`);
      },
      onError: (error) => {
        setSubmitError(formatCreateError(error));
      },
    });
  };

  return (
    <Main fixed className="gap-5 overflow-auto bg-muted/35 pb-24">
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex w-full max-w-[1280px] flex-col gap-5"
        data-testid="release-new-page"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-tight">
              {isAddCanaryToProduction ? t('releases.new.canary.title') : t('releases.new.title')}
            </h1>
            <p className="mt-1 max-w-3xl text-[12.5px] text-muted-foreground">
              {isAddCanaryToProduction ? t('releases.new.canary.subtitle') : t('releases.new.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/releases">{t('common.cancel')}</Link>
            </Button>
            <DeployButton
              canSubmit={canSubmit}
              isPending={isSubmitting}
              label={
                shouldCreateCanaryRelease
                  ? t('canaryReleases.new.action.submit')
                  : t('productionReleases.new.action.submit')
              }
              pendingLabel={
                shouldCreateCanaryRelease
                  ? t('canaryReleases.new.action.submitting')
                  : t('productionReleases.new.action.submitting')
              }
            />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <StepCard
              index={1}
              done={basicComplete}
              title={t('releases.new.steps.basic')}
              detail={
                isAddCanaryToProduction
                  ? t('releases.new.steps.basicCanaryDetail')
                  : t('releases.new.steps.basicDetail')
              }
              testId="release-new-step-basic"
            >
              {!isAddCanaryToProduction ? (
                <div>
                  <SubSectionHead label={t('releases.new.basic.section')} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[12.5px]">
                        {t('releases.new.field.name')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={releaseName}
                        onChange={(event) => setReleaseName(event.target.value)}
                        placeholder={t('releases.new.field.namePlaceholder')}
                        className="font-mono text-[13px]"
                        data-testid="release-new-name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12.5px]">{t('releases.new.field.description')}</Label>
                      <Input
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={t('releases.new.field.descriptionPlaceholder')}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className={cn(!isAddCanaryToProduction && 'border-t border-dashed pt-5')}>
                <SubSectionHead label={t('canaryReleases.new.field.prompt')} />
                <div className="rounded-md border bg-background">
                  {isAddCanaryToProduction ? (
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
                      <div className="border-b lg:border-b-0 lg:border-r">
                        <div className="border-b px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                          {t('canaryReleases.new.promptColumn')}
                        </div>
                        <div className="space-y-3 p-3">
                          <div className="rounded-md border bg-muted/35 p-3">
                            <SummaryRow
                              label={t('releases.new.canary.lockedPrompt')}
                              value={selectedPrompt?.name ?? selectedReleaseLine?.label ?? '—'}
                            />
                            <div className="mt-3">
                              <SummaryRow
                                label={t('releases.new.summary.prompt')}
                                value={selectedReleaseLine?.productionVersionLabel ?? '—'}
                              />
                            </div>
                          </div>
                          <p className="text-[12px] text-muted-foreground">
                            {t('releases.new.canary.lockedPromptHelp')}
                          </p>
                        </div>
                      </div>
                      <div>
                        <div className="border-b px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                          {t('canaryReleases.new.versionColumn')}
                        </div>
                        <div className="max-h-[340px] overflow-y-auto overflow-x-hidden">
                          {selectedPromptLoading ? (
                            <PickerEmpty>{t('canaryReleases.new.versionLoading')}</PickerEmpty>
                          ) : selectedPromptQuery.isError ? (
                            <PickerEmpty>{t('canaryReleases.new.versionEmpty')}</PickerEmpty>
                          ) : availablePromptVersions.length === 0 ? (
                            <PickerEmpty>{t('releases.new.canary.versionEmpty')}</PickerEmpty>
                          ) : (
                            availablePromptVersions.map((version) => (
                              <div key={version.id} data-testid={`release-new-version-row-${version.id}`}>
                                <PromptVersionRow
                                  option={version}
                                  selected={version.id === effectiveVersionId}
                                  onSelect={() => handleVersionSelect(version.id)}
                                />
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <MiniSearch
                        value={promptSearch}
                        onChange={setPromptSearch}
                        placeholder={t('canaryReleases.new.promptSearch')}
                      />
                      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
                        <div className="border-b lg:border-b-0 lg:border-r">
                          <div className="border-b px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                            {t('canaryReleases.new.promptColumn')}
                          </div>
                          <div className="max-h-[340px] overflow-y-auto overflow-x-hidden">
                            {promptsQuery.isError ? (
                              <PickerEmpty>{t('canaryReleases.new.promptEmpty')}</PickerEmpty>
                            ) : filteredPrompts.length === 0 ? (
                              <PickerEmpty>{t('canaryReleases.new.promptEmpty')}</PickerEmpty>
                            ) : (
                              filteredPrompts.map((prompt) => (
                                <div key={prompt.id} data-testid={`release-new-prompt-row-${prompt.id}`}>
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
                            {t('canaryReleases.new.versionColumn')}
                          </div>
                          <div className="max-h-[340px] overflow-y-auto overflow-x-hidden">
                            {selectedPromptLoading ? (
                              <PickerEmpty>{t('canaryReleases.new.versionLoading')}</PickerEmpty>
                            ) : selectedPromptQuery.isError ? (
                              <PickerEmpty>{t('canaryReleases.new.versionEmpty')}</PickerEmpty>
                            ) : availablePromptVersions.length === 0 ? (
                              <PickerEmpty>{t('canaryReleases.new.versionEmpty')}</PickerEmpty>
                            ) : (
                              availablePromptVersions.map((version) => (
                                <div key={version.id} data-testid={`release-new-version-row-${version.id}`}>
                                  <PromptVersionRow
                                    option={version}
                                    selected={version.id === effectiveVersionId}
                                    onSelect={() => handleVersionSelect(version.id)}
                                  />
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  <PromptVersionPreview option={selectedVersion} />
                </div>
              </div>

              <div className="border-t border-dashed pt-5">
                <SubSectionHead label={t('canaryReleases.new.field.model')} />
                <div className="max-h-[360px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                  <MiniSearch
                    value={modelSearch}
                    onChange={setModelSearch}
                    placeholder={t('canaryReleases.new.modelSearch')}
                  />
                  {modelsQuery.isError ? (
                    <PickerEmpty>{t('canaryReleases.new.modelEmpty')}</PickerEmpty>
                  ) : filteredModels.length === 0 ? (
                    <PickerEmpty>{t('canaryReleases.new.modelEmpty')}</PickerEmpty>
                  ) : (
                    filteredModels.map((model) => (
                      <div key={model.id} data-testid={`release-new-model-row-${model.id}`}>
                        <ModelOptionRow
                          model={model}
                          selected={model.id === effectiveModelId}
                          onSelect={() => handleModelSelect(model)}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </StepCard>

            <StepCard
              index={2}
              done={connectorComplete}
              title={t('releases.new.steps.connectors')}
              detail={t('releases.new.steps.connectorsDetail')}
              testId="release-new-step-connectors"
            >
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label>{t('canaryReleases.new.field.inputConnector')}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isAddCanaryToProduction
                        ? t('releases.new.canary.lockedInputConnectorHelp')
                        : t('canaryReleases.new.field.inputConnectorHelp')}
                    </p>
                  </div>
                  {isAddCanaryToProduction ? null : (
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/connectors/new?direction=input">
                        <Plus className="size-3.5" />
                        {t('releases.new.action.newInputConnector')}
                      </Link>
                    </Button>
                  )}
                </div>
                {isAddCanaryToProduction ? (
                  <ReadOnlyConnectorRow
                    connector={selectedInputConnector}
                    name={parentProductionEvent?.inputConnectorId ?? null}
                    emptyLabel={t('releases.new.placeholder.inputConnector')}
                  />
                ) : (
                  <div className="max-h-[260px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                    {inputConnectors.length === 0 ? (
                      <PickerEmpty>{t('canaryReleases.new.inputConnectorEmpty')}</PickerEmpty>
                    ) : (
                      inputConnectors.map((connector) => (
                        <div key={connector.id} data-testid={`release-new-input-connector-${connector.id}`}>
                          <ConnectorOptionRow
                            connector={connector}
                            selected={connector.id === effectiveInputConnectorId}
                            onSelect={() => handleInputConnectorSelect(connector.id)}
                          />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-dashed pt-5">
                <Label>{t('canaryReleases.new.field.variableMapping')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isAddCanaryToProduction
                    ? t('releases.new.canary.lockedMappingHelp')
                    : t('canaryReleases.new.field.variableMappingHelp')}
                </p>
                <div className="mt-3">
                  <FieldMappingTable
                    fields={inputFieldOptions}
                    promptVariables={selectedVersion?.variables ?? []}
                    externalIdField={effectiveExternalIdField}
                    mapping={Object.fromEntries(
                      (selectedVersion?.variables ?? []).map((variable) => [
                        variable.name,
                        sourceForVariable(variable),
                      ]),
                    )}
                    readOnly={isAddCanaryToProduction}
                    onExternalIdFieldChange={setExternalIdFieldOverride}
                    onMappingChange={(target, source) =>
                      setMappingOverrides((current) => ({ ...current, [target]: source }))
                    }
                  />
                </div>
                {effectiveInputConnectorId && inputFieldOptions.length === 0 ? (
                  <div className="mt-2 text-[11.5px] text-muted-foreground">
                    {selectedInputConnector?.type === 'webhook'
                      ? t('canaryReleases.new.fieldMappingEmptyWebhook')
                      : t('canaryReleases.new.fieldMappingEmptyQueue')}
                  </div>
                ) : null}
              </div>

              <div className="border-t border-dashed pt-5">
                <Label>{t('canaryReleases.new.field.filterRules')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isAddCanaryToProduction
                    ? t('releases.new.canary.lockedFilterHelp')
                    : t('canaryReleases.new.field.filterRulesHelp')}
                </p>
                <div className="mt-3">
                  {isAddCanaryToProduction ? (
                    <ReadOnlyFilterRules value={effectiveFilterRules} />
                  ) : (
                    <FilterRulesBuilder value={filterRules} fields={inputFieldOptions} onChange={setFilterRules} />
                  )}
                </div>
              </div>

              <div className="border-t border-dashed pt-5">
                <Label>{t('releases.new.field.traffic')}</Label>
                <div className="mt-2">
                  <TrafficSelectionField
                    isQueueInput={isQueueInput}
                    value={isQueueInput ? trafficPercent : '100'}
                    trafficMode={trafficMode}
                    showTrafficMode={isAddCanaryToProduction}
                    onChange={setTrafficPercent}
                    onTrafficModeChange={setTrafficMode}
                  />
                </div>
              </div>

              <div className="border-t border-dashed pt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label>{t('canaryReleases.new.field.outputConnector')}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isAddCanaryToProduction
                        ? trafficMode === 'dual_run'
                          ? t('releases.new.canary.outputDualRunHelp')
                          : t('releases.new.canary.outputSplitLocked')
                        : t('canaryReleases.new.field.outputConnectorHelp')}
                    </p>
                  </div>
                  {isAddCanaryToProduction && trafficMode === 'split' ? null : (
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/connectors/new?direction=output">
                        <Plus className="size-3.5" />
                        {t('releases.new.action.newOutputConnector')}
                      </Link>
                    </Button>
                  )}
                </div>
                {isAddCanaryToProduction && trafficMode === 'split' ? (
                  <div className="space-y-2">
                    {inheritedOutputConnectorIds.length === 0 ? (
                      <PickerEmpty>{t('releases.new.canary.noInheritedOutput')}</PickerEmpty>
                    ) : (
                      inheritedOutputConnectorIds.map((connectorId) => (
                        <ReadOnlyConnectorRow
                          key={connectorId}
                          connector={outputConnectorById.get(connectorId)}
                          name={connectorId}
                          emptyLabel={connectorId}
                        />
                      ))
                    )}
                  </div>
                ) : (
                  <div className="max-h-[260px] overflow-y-auto overflow-x-hidden rounded-md border bg-background">
                    {outputConnectors.length === 0 ? (
                      <PickerEmpty>{t('canaryReleases.new.outputConnectorEmpty')}</PickerEmpty>
                    ) : (
                      outputConnectors.map((connector) => {
                        const selected = validOutputConnectorIds.includes(connector.id);
                        const locked = isAddCanaryToProduction && inheritedOutputConnectorIdSet.has(connector.id);
                        return (
                          <ConnectorOptionRow
                            key={connector.id}
                            connector={connector}
                            multiple
                            selected={selected || locked}
                            onSelect={() => handleOutputConnectorToggle(connector.id, selected)}
                          />
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </StepCard>

            <StepCard
              index={3}
              done={runtimeComplete}
              title={t('releases.new.steps.runtime')}
              detail={t('releases.new.steps.runtimeDetail')}
              testId="release-new-step-runtime"
            >
              <div>
                <SubSectionHead label={t('productionReleases.new.section.runtime')} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <RuntimeLimitField
                    label={t('productionReleases.new.field.rpm')}
                    value={rpm}
                    modelLimit={selectedModel ? formatModelLimit(selectedModel.rpm.limit) : '—'}
                    onChange={setRpm}
                  />
                  <RuntimeLimitField
                    label={t('productionReleases.new.field.tpm')}
                    value={tpm}
                    modelLimit={selectedModel ? formatModelLimit(selectedModel.tpm.limit) : '—'}
                    onChange={setTpm}
                  />
                  <RuntimeLimitField
                    label={t('productionReleases.new.field.concurrency')}
                    value={concurrency}
                    modelLimit={selectedModel ? formatModelLimit(selectedModel.concurrency.limit) : '—'}
                    onChange={setConcurrency}
                  />
                  <div className="space-y-1.5">
                    <Label className="text-[12.5px]">
                      {t('productionReleases.new.field.temperature')} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={temperature}
                      onChange={(event) => setTemperature(event.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-dashed pt-5">
                <Label>{t('canaryReleases.new.field.recordCategories')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('canaryReleases.new.field.recordCategoriesHelp')}
                </p>
                <div className="mt-3">
                  <RecordCategoriesField
                    value={effectiveRecordCategories}
                    options={recordCategoryOptions}
                    onChange={setRecordCategorySelection}
                  />
                </div>
              </div>
            </StepCard>
          </div>

          <aside className="flex flex-col gap-3 xl:sticky xl:top-20 xl:self-start">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-[14px] font-semibold">{t('releases.new.section.summary')}</h2>
              <div className="mt-4 space-y-3">
                {!isAddCanaryToProduction ? (
                  <SummaryRow label={t('releases.new.field.name')} value={effectiveReleaseName || '—'} />
                ) : null}
                <SummaryRow
                  label={t('releases.new.summary.prompt')}
                  value={
                    selectedPrompt && selectedVersion ? `${selectedPrompt.name} · ${selectedVersion.version}` : '—'
                  }
                />
                <SummaryRow
                  label={t('productionReleases.new.field.model')}
                  value={selectedModel ? `${selectedModel.name} · ${selectedModel.providerModelId}` : '—'}
                />
                <SummaryRow label={t('releases.new.summary.connector')} value={selectedInputConnector?.name ?? '—'} />
                <SummaryRow
                  label={t('releases.new.field.traffic')}
                  value={
                    trafficRatioValue === null
                      ? '—'
                      : isQueueInput
                        ? `${Math.round(trafficRatioValue * 100)}%`
                        : t('releases.new.traffic.production100')
                  }
                />
                {shouldCreateCanaryRelease ? (
                  <SummaryRow
                    label={t('releases.new.summary.trafficMode')}
                    value={
                      trafficMode === 'dual_run'
                        ? t('releases.new.trafficMode.dualRun')
                        : t('releases.new.trafficMode.split')
                    }
                  />
                ) : null}
                <SummaryRow
                  label={t('releases.new.summary.outputs')}
                  value={
                    validOutputConnectorIds.length > 0
                      ? String(validOutputConnectorIds.length)
                      : t('productionReleases.new.noOutputConnector')
                  }
                />
                <SummaryRow
                  label={t('releases.new.summary.runtime')}
                  value={
                    rpmValue && tpmValue && concurrencyValue
                      ? `${rpmValue} RPM / ${tpmValue} TPM / C${concurrencyValue}`
                      : '—'
                  }
                />
              </div>

              <div className="mt-4 rounded-md border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
                {canSubmit ? t('releases.new.submitReady') : t('releases.new.submitDisabled')}
              </div>

              {submitError ? (
                <div className="mt-3 flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              ) : null}
              <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">
                {t('productionReleases.new.confirmIrreversible')}
              </p>
            </div>
          </aside>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgb(15_23_42/0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:left-[var(--sidebar-width)]">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-muted-foreground">{t('productionReleases.new.confirmIrreversible')}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link href="/releases">{t('common.cancel')}</Link>
              </Button>
              <DeployButton
                canSubmit={canSubmit}
                isPending={isSubmitting}
                label={
                  shouldCreateCanaryRelease
                    ? t('canaryReleases.new.action.submit')
                    : t('productionReleases.new.action.submit')
                }
                pendingLabel={
                  shouldCreateCanaryRelease
                    ? t('canaryReleases.new.action.submitting')
                    : t('productionReleases.new.action.submitting')
                }
                className="min-w-28"
                testId="release-new-submit"
              />
            </div>
          </div>
        </div>
      </form>
    </Main>
  );
}
