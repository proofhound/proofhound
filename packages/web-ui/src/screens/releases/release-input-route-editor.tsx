'use client';

import { useMemo, useState } from 'react';
import {
  CANARY_RELEASE_FILTER_MAX_DEPTH,
  CANARY_RELEASE_FILTER_OPS,
  promptVariableSchema,
  type CanaryReleaseFilterNodeDto,
  type CanaryReleaseFilterOpDto,
  type PromptVariableDto,
  type PromptVariableTypeDto,
} from '@proofhound/shared';
import { Check, ChevronDown, Filter, Info, Plus, Search, X } from 'lucide-react';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../../i18n';

export interface InputRouteFieldOption {
  key: string;
  type: string;
  description: string;
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');
}

function fieldOptionFromUnknown(value: unknown): InputRouteFieldOption | null {
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

function flattenSchemaProperties(properties: Record<string, unknown>, prefix = ''): InputRouteFieldOption[] {
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
    const current: InputRouteFieldOption = {
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

function schemaToFieldOptions(value: unknown): InputRouteFieldOption[] {
  if (!isRecord(value)) return [];
  const properties = isRecord(value.properties) ? value.properties : value;
  return flattenSchemaProperties(properties);
}

export function dedupeInputFieldOptions(fields: InputRouteFieldOption[]): InputRouteFieldOption[] {
  const seen = new Set<string>();
  const result: InputRouteFieldOption[] = [];
  for (const field of fields) {
    const key = normalizeFieldKey(field.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...field, key });
  }
  return result;
}

export function extractInputFieldOptionsFromSnapshot(snapshot: unknown): InputRouteFieldOption[] {
  const record = readRecord(snapshot);
  const config = readRecord(record?.config) ?? {};
  const candidates: unknown[] = [
    record?.expectedPayloadSchema,
    record?.confirmedPayloadSchema,
    record?.lastPeekPayloadSchema,
    record?.peekPayloadSchema,
    record?.fieldSchema,
    record?.fields,
    record?.payloadFields,
    config.expectedPayloadSchema,
    config.confirmedPayloadSchema,
    config.lastPeekPayloadSchema,
    config.peekPayloadSchema,
    config.fieldSchema,
    config.fields,
    config.payloadFields,
  ];
  const options: InputRouteFieldOption[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      options.push(
        ...candidate.map(fieldOptionFromUnknown).filter((field): field is InputRouteFieldOption => Boolean(field)),
      );
    } else {
      options.push(...schemaToFieldOptions(candidate));
    }
  }
  return dedupeInputFieldOptions(options);
}

export function mergeInputFieldOptions(
  fields: InputRouteFieldOption[],
  keys: Array<string | null | undefined>,
): InputRouteFieldOption[] {
  const options = [...fields];
  const seen = new Set(options.map((field) => field.key));
  for (const value of keys) {
    const key = normalizeFieldKey(value ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({ key, type: 'unknown', description: '' });
  }
  return options;
}

export function collectFilterRuleFields(value: CanaryReleaseFilterNodeDto | null): string[] {
  if (!value) return [];
  if (value.type === 'atom') return [value.field];
  if (value.type === 'not') return collectFilterRuleFields(value.child);
  return value.children.flatMap(collectFilterRuleFields);
}

function promptVariableTypeFromUnknown(value: unknown): PromptVariableTypeDto {
  if (value === 'image' || value === 'image_url' || value === 'image_base64' || value === 'number') return value;
  return 'text';
}

export function extractPromptVariablesFromSnapshot(
  snapshot: unknown,
  mapping: Record<string, string>,
): PromptVariableDto[] {
  const record = readRecord(snapshot);
  const variables = Array.isArray(record?.variables) ? record.variables : [];
  const parsedVariables = variables
    .map((variable) => promptVariableSchema.safeParse(variable))
    .filter((parse): parse is { success: true; data: PromptVariableDto } => parse.success)
    .map((parse) => parse.data);
  const seen = new Set(parsedVariables.map((variable) => variable.name));
  const fallbackVariables = Object.keys(mapping)
    .filter((target) => target !== 'id' && !seen.has(target))
    .map((target) => ({
      name: target,
      type: promptVariableTypeFromUnknown(undefined),
      required: false,
    }));
  return [...parsedVariables, ...fallbackVariables];
}

export function inputRouteMappingRecord(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((item): item is { source: string; target: string } => {
          return Boolean(item) && typeof item === 'object' && 'source' in item && 'target' in item;
        })
        .map((item) => [item.target, item.source]),
    );
  }
  if (!isRecord(value)) return {};
  const mapping: Record<string, string> = {};
  for (const [target, source] of Object.entries(value)) {
    if (typeof source === 'string') mapping[target] = source;
  }
  return mapping;
}

export function canaryInputRouteMappingFromRecord(
  mapping: Record<string, string>,
  promptVariables: PromptVariableDto[],
  externalIdField: string,
) {
  const requiredByTarget = new Map(promptVariables.map((variable) => [variable.name, variable.required]));
  const normalized = { ...mapping };
  if (externalIdField.trim()) normalized.id = externalIdField.trim();
  return Object.entries(normalized)
    .map(([target, source]) => ({
      source: source.trim(),
      target,
      required: target === 'id' || Boolean(requiredByTarget.get(target)),
    }))
    .filter((item) => item.source.length > 0 && item.target.length > 0);
}

function Tag({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10.5px]',
        tone === 'warning' &&
          'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
      )}
    >
      {children}
    </span>
  );
}

function MappingOptionPicker({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  disabled = false,
  allowEmpty = false,
  variant = 'box',
  className,
  testId,
  optionTestIdPrefix,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; meta?: string }>;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  variant?: 'box' | 'line';
  className?: string;
  testId?: string;
  optionTestIdPrefix?: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedOption = options.find((option) => option.value === value);
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.meta ?? ''}`.toLowerCase().includes(normalizedQuery),
    );
  }, [options, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            variant === 'box'
              ? 'flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
              : 'flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 font-mono text-[12.5px] outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60',
            !value && 'font-sans italic text-muted-foreground',
            className,
          )}
          data-testid={testId}
        >
          <span className="min-w-0 flex-1 truncate text-left">{selectedOption?.label ?? (value || placeholder)}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[300px] overflow-hidden p-0"
        onWheelCapture={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          className="max-h-[280px] overflow-y-auto overscroll-contain p-1"
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMoveCapture={(event) => event.stopPropagation()}
        >
          {allowEmpty ? (
            <button
              type="button"
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted',
                !value && 'bg-primary/5',
              )}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              <Check className={cn('size-3 shrink-0 text-primary opacity-0', !value && 'opacity-100')} />
              <span className="min-w-0 flex-1 truncate italic text-muted-foreground">{placeholder}</span>
            </button>
          ) : null}
          {visibleOptions.length === 0 ? (
            <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">{emptyLabel}</div>
          ) : (
            visibleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[12.5px] hover:bg-muted',
                  option.value === value && 'bg-primary/5',
                )}
                data-testid={
                  optionTestIdPrefix ? `${optionTestIdPrefix}-${sanitizeInputRouteTestId(option.value)}` : undefined
                }
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mt-0.5 size-3 shrink-0 text-primary opacity-0',
                    option.value === value && 'opacity-100',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function sanitizeInputRouteTestId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function normalizeTargetRows(rows: string[], targetNames: string[]): string[] {
  const allowed = new Set(targetNames);
  const next = rows.filter((target) => allowed.has(target));
  for (const target of targetNames) {
    if (!next.includes(target)) next.push(target);
  }
  return next;
}

function usePromptVariableTargetRows(promptVariables: PromptVariableDto[]) {
  const targetNames = useMemo(() => promptVariables.map((variable) => variable.name), [promptVariables]);
  const targetNamesKey = targetNames.join('\u0000');
  const [targetState, setTargetState] = useState(() => ({ key: targetNamesKey, rows: targetNames }));
  const targetRows = useMemo(
    () => normalizeTargetRows(targetState.key === targetNamesKey ? targetState.rows : targetNames, targetNames),
    [targetNames, targetNamesKey, targetState],
  );
  const setTargetRows = (updater: (current: string[]) => string[]) => {
    setTargetState((current) => {
      const baseRows = normalizeTargetRows(current.key === targetNamesKey ? current.rows : targetNames, targetNames);
      return { key: targetNamesKey, rows: normalizeTargetRows(updater(baseRows), targetNames) };
    });
  };

  return [targetRows, setTargetRows] as const;
}

function MappingInfoIcon({ label, detail }: { label: string; detail: string }) {
  return (
    <TooltipProvider delayDuration={140}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            aria-label={label}
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px]">
          <div className="text-[11.5px] font-semibold">{label}</div>
          <div className="mt-1 text-[11px] leading-relaxed">{detail}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function FieldMappingTable({
  fields,
  promptVariables,
  externalIdField,
  mapping,
  readOnly = false,
  compact = false,
  testIdPrefix = 'release-input-route',
  onExternalIdFieldChange,
  onMappingChange,
  onMappingTargetChange,
}: {
  fields: InputRouteFieldOption[];
  promptVariables: PromptVariableDto[];
  externalIdField: string;
  mapping: Record<string, string>;
  readOnly?: boolean;
  compact?: boolean;
  testIdPrefix?: string;
  onExternalIdFieldChange: (next: string) => void;
  onMappingChange: (target: string, source: string) => void;
  onMappingTargetChange?: (target: string, nextTarget: string) => void;
}) {
  const { t } = useI18n();
  const externalIdLabel = t('canaryReleases.new.field.externalIdField');
  const externalIdHelp = t('canaryReleases.new.field.externalIdFieldHelp');
  const fieldOptions = useMemo(
    () => fields.map((field) => ({ value: field.key, label: field.key, meta: field.type })),
    [fields],
  );
  const targetOptions = useMemo(
    () =>
      promptVariables.map((variable) => ({
        value: variable.name,
        label: variable.name,
        meta: `${variable.type} · ${
          variable.required ? t('canaryReleases.new.mapping.required') : t('canaryReleases.new.mapping.optional')
        }`,
      })),
    [promptVariables, t],
  );
  const variableByName = useMemo(
    () => new Map(promptVariables.map((variable) => [variable.name, variable])),
    [promptVariables],
  );
  const [targetRows, setTargetRows] = usePromptVariableTargetRows(promptVariables);
  const gridClass = compact
    ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_64px]'
    : 'grid grid-cols-[minmax(180px,0.9fr)_minmax(0,1.1fr)_96px]';

  function updateTargetRow(index: number, target: string, nextTarget: string) {
    if (!nextTarget || nextTarget === target) return;
    setTargetRows((current) => {
      const next = [...current];
      const duplicateIndex = next.findIndex((item, itemIndex) => item === nextTarget && itemIndex !== index);
      next[index] = nextTarget;
      if (duplicateIndex >= 0) next[duplicateIndex] = target;
      return next;
    });
    onMappingTargetChange?.(target, nextTarget);
  }

  if (compact) {
    return (
      <div className="rounded-md border bg-background px-2 py-1">
        <div className="grid grid-cols-[minmax(0,1.18fr)_16px_minmax(0,0.82fr)] items-center gap-1 border-t border-dashed py-1 first:border-t-0">
          <MappingOptionPicker
            value={externalIdField}
            options={fieldOptions}
            placeholder={t('canaryReleases.new.fieldSelectPlaceholder')}
            searchPlaceholder={t('canaryReleases.new.mapping.sourceSearch')}
            emptyLabel={t('canaryReleases.new.mapping.sourceEmpty')}
            disabled={readOnly}
            variant="line"
            testId={`${testIdPrefix}-mapping-external-id`}
            optionTestIdPrefix={`${testIdPrefix}-mapping-external-id-option`}
            onChange={onExternalIdFieldChange}
          />
          <span className="text-center text-[12px] text-muted-foreground">→</span>
          <div
            className="flex h-8 min-w-0 items-center gap-1 border-b border-dashed px-1 font-mono text-[12.5px]"
            title={`id · ${externalIdLabel}`}
          >
            <span className="min-w-0 truncate font-semibold">id</span>
            <MappingInfoIcon label={externalIdLabel} detail={externalIdHelp} />
          </div>
        </div>
        {promptVariables.length === 0 ? (
          <div className="border-t border-dashed px-2 py-2 text-center text-xs text-muted-foreground">
            {t('canaryReleases.new.promptVariablesEmpty')}
          </div>
        ) : (
          targetRows.map((target, index) => {
            const variable = variableByName.get(target);
            const variableMeta = variable
              ? `${variable.type} · ${
                  variable.required
                    ? t('canaryReleases.new.mapping.required')
                    : t('canaryReleases.new.mapping.optional')
                }`
              : t('canaryReleases.new.mapping.optional');
            return (
              <div
                key={`${target}:${index}`}
                className="grid grid-cols-[minmax(0,1.18fr)_16px_minmax(0,0.82fr)] items-center gap-1 border-t border-dashed py-1"
              >
                <MappingOptionPicker
                  value={mapping[target] ?? ''}
                  options={fieldOptions}
                  placeholder={t('canaryReleases.new.mapping.unmapped')}
                  searchPlaceholder={t('canaryReleases.new.mapping.sourceSearch')}
                  emptyLabel={t('canaryReleases.new.mapping.sourceEmpty')}
                  allowEmpty
                  disabled={readOnly}
                  variant="line"
                  testId={`${testIdPrefix}-mapping-source-${target}`}
                  optionTestIdPrefix={`${testIdPrefix}-mapping-source-${target}-option`}
                  onChange={(source) => onMappingChange(target, source)}
                />
                <span className="text-center text-[12px] text-muted-foreground">→</span>
                {readOnly || !onMappingTargetChange ? (
                  <div
                    className="flex h-8 min-w-0 items-center gap-1 border-b border-dashed px-1 font-mono text-[12.5px]"
                    title={`${target} · ${variableMeta}`}
                  >
                    <span className="min-w-0 truncate font-semibold">{target}</span>
                    <span className="max-w-[112px] shrink-0 truncate font-sans text-[11px] italic text-muted-foreground">
                      {variableMeta}
                    </span>
                  </div>
                ) : (
                  <MappingOptionPicker
                    value={target}
                    options={targetOptions}
                    placeholder={t('canaryReleases.new.promptVariablesEmpty')}
                    searchPlaceholder={t('canaryReleases.new.mapping.targetSearch')}
                    emptyLabel={t('canaryReleases.new.mapping.targetEmpty')}
                    variant="line"
                    className="border-b border-dashed px-1"
                    testId={`${testIdPrefix}-mapping-target-${index}`}
                    optionTestIdPrefix={`${testIdPrefix}-mapping-target-${index}-option`}
                    onChange={(nextTarget) => updateTargetRow(index, target, nextTarget)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

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
            <MappingOptionPicker
              value={externalIdField}
              options={fieldOptions}
              placeholder={t('canaryReleases.new.fieldSelectPlaceholder')}
              searchPlaceholder={t('canaryReleases.new.mapping.sourceSearch')}
              emptyLabel={t('canaryReleases.new.mapping.sourceEmpty')}
              testId={`${testIdPrefix}-mapping-external-id`}
              optionTestIdPrefix={`${testIdPrefix}-mapping-external-id-option`}
              onChange={onExternalIdFieldChange}
            />
          )}
        </label>
      </div>
      <div className="overflow-x-auto rounded-md border bg-background">
        <div
          className={`${gridClass} min-w-[320px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground`}
        >
          <span>{t('canaryReleases.new.mapping.variable')}</span>
          <span>{t('canaryReleases.new.mapping.source')}</span>
          <span>{t('canaryReleases.new.mapping.type')}</span>
        </div>
        {promptVariables.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {t('canaryReleases.new.promptVariablesEmpty')}
          </div>
        ) : (
          targetRows.map((target, index) => {
            const variable = variableByName.get(target);
            const variableMeta = variable
              ? variable.required
                ? t('canaryReleases.new.mapping.required')
                : t('canaryReleases.new.mapping.optional')
              : t('canaryReleases.new.mapping.optional');
            return (
              <div
                key={`${target}:${index}`}
                className={`${gridClass} min-w-[320px] items-center gap-2 border-t px-3 py-2`}
              >
                <div className="min-w-0">
                  {readOnly ? (
                    <div className="min-h-8 rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
                      {target || '—'}
                    </div>
                  ) : (
                    <MappingOptionPicker
                      value={target}
                      options={targetOptions}
                      placeholder={t('canaryReleases.new.promptVariablesEmpty')}
                      searchPlaceholder={t('canaryReleases.new.mapping.targetSearch')}
                      emptyLabel={t('canaryReleases.new.mapping.targetEmpty')}
                      testId={`${testIdPrefix}-mapping-target-${index}`}
                      optionTestIdPrefix={`${testIdPrefix}-mapping-target-${index}-option`}
                      onChange={(nextTarget) => updateTargetRow(index, target, nextTarget)}
                    />
                  )}
                  <div className="text-[11px] text-muted-foreground">{variableMeta}</div>
                </div>
                {readOnly ? (
                  <div className="min-h-8 rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
                    {mapping[target] || t('canaryReleases.new.mapping.unmapped')}
                  </div>
                ) : (
                  <MappingOptionPicker
                    value={mapping[target] ?? ''}
                    options={fieldOptions}
                    placeholder={t('canaryReleases.new.mapping.unmapped')}
                    searchPlaceholder={t('canaryReleases.new.mapping.sourceSearch')}
                    emptyLabel={t('canaryReleases.new.mapping.sourceEmpty')}
                    allowEmpty
                    testId={`${testIdPrefix}-mapping-source-${target}`}
                    optionTestIdPrefix={`${testIdPrefix}-mapping-source-${target}-option`}
                    onChange={(source) => onMappingChange(target, source)}
                  />
                )}
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {variable?.type ?? 'unknown'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ReadOnlyFilterRules({ value }: { value: CanaryReleaseFilterNodeDto | null }) {
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

export function FilterRulesBuilder({
  value,
  fields,
  onChange,
  compact = false,
}: {
  value: CanaryReleaseFilterNodeDto | null;
  fields: InputRouteFieldOption[];
  onChange: (next: CanaryReleaseFilterNodeDto | null) => void;
  compact?: boolean;
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
    <div className={cn('space-y-2 rounded-md border bg-background', compact ? 'p-2' : 'p-3')}>
      <FilterNodeEditor
        node={value}
        depth={1}
        fields={fields}
        compact={compact}
        onChange={onChange}
        onRemove={() => onChange(null)}
      />
    </div>
  );
}

function FilterNodeEditor({
  node,
  depth,
  fields,
  compact,
  onChange,
  onRemove,
}: {
  node: CanaryReleaseFilterNodeDto;
  depth: number;
  fields: InputRouteFieldOption[];
  compact: boolean;
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
    if (compact) {
      return (
        <div className="space-y-2 rounded-md border bg-card p-2">
          <select
            value={node.field}
            onChange={(event) => onChange({ ...node, field: event.target.value })}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{t('canaryReleases.new.fieldSelectPlaceholder')}</option>
            {fields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.key}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-[96px_minmax(0,1fr)_32px] items-center gap-2">
            <select
              value={node.op}
              onChange={(event) => {
                const op = event.target.value as CanaryReleaseFilterOpDto;
                onChange(
                  op === 'exists' ? { type: 'atom', field: node.field, op } : { ...node, op, value: node.value ?? '' },
                );
              }}
              className="h-8 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                needsValue
                  ? t('canaryReleases.new.filter.valuePlaceholder')
                  : t('canaryReleases.new.filter.valueDisabled')
              }
              className="h-8 min-w-0 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onRemove}
              aria-label={t('canaryReleases.new.filter.remove')}
              title={t('canaryReleases.new.filter.remove')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 items-center gap-2 rounded-md border bg-card p-2 md:grid-cols-[minmax(0,1fr)_132px_minmax(0,1fr)_32px]">
        <select
          value={node.field}
          onChange={(event) => onChange({ ...node, field: event.target.value })}
          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          title={t('canaryReleases.new.filter.remove')}
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
            title={t('canaryReleases.new.filter.remove')}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <FilterNodeEditor
          node={node.child}
          depth={depth + 1}
          fields={fields}
          compact={compact}
          onChange={(child) => onChange({ type: 'not', child })}
          onRemove={() => onChange({ type: 'not', child: createAtom() })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/25 p-2">
      <div
        className={cn(
          'gap-2',
          compact ? 'grid grid-cols-[minmax(0,1fr)_32px]' : 'flex flex-wrap items-center justify-between',
        )}
      >
        <div
          className={cn(
            'min-w-0',
            compact ? 'grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2' : 'flex items-center gap-2',
          )}
        >
          <select
            value={node.type}
            onChange={(event) => onChange({ type: event.target.value as 'and' | 'or', children: node.children })}
            className="h-8 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="and">AND</option>
            <option value="or">OR</option>
          </select>
          <span className="truncate text-xs text-muted-foreground">
            {formatTemplate(t('canaryReleases.new.filter.depth'), { depth })}
          </span>
        </div>
        {compact ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onRemove}
            aria-label={t('canaryReleases.new.filter.remove')}
            title={t('canaryReleases.new.filter.remove')}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
        <div className={compact ? 'col-span-2 grid grid-cols-3 gap-1.5' : 'flex flex-wrap items-center gap-1.5'}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('h-8', compact && 'min-w-0 px-2 text-[11px]')}
            onClick={() => onChange({ ...node, children: [...node.children, createAtom()] })}
            title={t('canaryReleases.new.filter.addCondition')}
          >
            <Plus className="size-3.5" />
            <span className="truncate">{t('canaryReleases.new.filter.addCondition')}</span>
          </Button>
          {canNest ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn('h-8', compact && 'min-w-0 px-2 text-[11px]')}
                onClick={() => onChange({ ...node, children: [...node.children, createGroup('and')] })}
                title={t('canaryReleases.new.filter.addGroup')}
              >
                <span className="truncate">{t('canaryReleases.new.filter.addGroup')}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn('h-8', compact && 'min-w-0 px-2 text-[11px]')}
                onClick={() =>
                  onChange({ ...node, children: [...node.children, { type: 'not', child: createAtom() }] })
                }
                title="NOT"
              >
                NOT
              </Button>
            </>
          ) : null}
          {!compact ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onRemove}
              aria-label={t('canaryReleases.new.filter.remove')}
              title={t('canaryReleases.new.filter.remove')}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className={cn('space-y-2 border-l', compact ? 'ml-1 pl-2' : 'pl-3')}>
        {node.children.map((child, index) => (
          <FilterNodeEditor
            key={index}
            node={child}
            depth={depth + 1}
            fields={fields}
            compact={compact}
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
