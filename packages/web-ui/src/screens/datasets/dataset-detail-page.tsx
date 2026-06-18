'use client';

import { Link } from '../../components/navigation/link';
import { useEffect, useMemo, useState } from 'react';
import type { DatasetExportFormatDto, DatasetSampleDto } from '@proofhound/shared';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Edit3,
  FlaskConical,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useDatasetSamples, useDeleteDatasetSamples, useDownloadDataset } from '../../hooks';
import { useI18n } from '../../i18n';
import {
  getReferenceCount,
  type DatasetField,
  type DatasetFieldRole,
  type DatasetSample,
  type ProjectDataset,
} from './dataset-types';
import { DatasetTransferProgressPanel, useDatasetTransferProgress } from './dataset-transfer-progress';
import {
  ExportFormatMenu,
  ImageCell,
  ImagePreviewDialog,
  ImageThumb,
  ModalityBadge,
  ReferenceText,
  RolePill,
  formatCount,
  saveBlobAsFile,
} from './dataset-ui';
import {
  getImageReferences,
  getImageSourceType,
  getPrimaryImageReference,
  mergeFieldsWithSampleData,
  normalizeExpectedRoles,
  parseImageReferenceArrayInput,
  type ImageSourceType,
} from './dataset-detail-helpers';
import { DatasetSamplesTable } from './dataset-samples-table';
import { getDisplayValue } from './dataset-upload-parser';

const FIELD_ROLE_OPTIONS: DatasetFieldRole[] = ['id', 'text', 'image', 'expected', 'metadata'];
const FIELD_ROLE_ORDER: Record<DatasetFieldRole, number> = {
  id: 0,
  text: 1,
  image: 2,
  expected: 3,
  metadata: 4,
};
const DEFAULT_HIDDEN_FIELDS = new Set(['created_at', 'createdAt', 'updated_at', 'updatedAt']);

interface OutputSchemaField {
  name: string;
  type: string;
  count: number;
  enumCount: number;
}

function getDatasetQuery(dataset: ProjectDataset) {
  return new URLSearchParams({
    datasetId: dataset.id,
    datasetName: dataset.name,
    sampleCount: String(dataset.sampleCount),
  }).toString();
}

function getExperimentNewHref(projectId: string, dataset: ProjectDataset) {
  return `/experiments/new?${getDatasetQuery(dataset)}`;
}

function getOptimizationNewHref(projectId: string, dataset: ProjectDataset) {
  return `/optimizations/new?origin=dataset&${getDatasetQuery(dataset)}`;
}

function cloneFields(fields: DatasetField[]) {
  return fields.map((field) => ({ ...field }));
}

function isDefaultHiddenField(fieldName: string) {
  return DEFAULT_HIDDEN_FIELDS.has(fieldName);
}

function getOrderedFields(fields: DatasetField[]) {
  return fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => !isDefaultHiddenField(field.name))
    .sort(
      (left, right) =>
        FIELD_ROLE_ORDER[left.field.role] - FIELD_ROLE_ORDER[right.field.role] || left.index - right.index,
    )
    .map(({ field }) => field);
}

function getSampleDisplayId(sample: DatasetSample, fields: DatasetField[]) {
  const idField =
    fields.find((field) => field.role === 'id') ??
    fields.find((field) => {
      const normalized = field.name.toLowerCase();
      return normalized === 'id' || normalized === 'sample_id';
    });
  const value = idField ? getDisplayValue(sample.data[idField.name]) : '';
  return value || sample.id;
}

function getSampleFieldDisplayValue(sample: DatasetSample, field: DatasetField) {
  return getDisplayValue(sample.data[field.name]);
}

function getEditableValue(value: unknown) {
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return getDisplayValue(value);
}

function sampleToDraft(sample: DatasetSample, fields: DatasetField[]) {
  return Object.fromEntries(fields.map((field) => [field.name, getEditableValue(sample.data[field.name])]));
}

function toDatasetSamples(samplesData: DatasetSampleDto[] | undefined) {
  if (!samplesData || samplesData.length === 0) return [];

  return samplesData.map((sample) => ({
    id: sample.externalId ?? sample.id,
    data: sample.data,
    createdAt: sample.createdAt,
    updatedAt: sample.updatedAt,
  }));
}

function getImageMeta(value: string) {
  const extension = value.split('.').at(-1);
  return extension && extension !== value ? extension.toUpperCase() : '';
}

function getValueType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function parseExpectedOutputObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function getExpectedField(fields: DatasetField[]) {
  return fields.find((field) => field.role === 'expected') ?? null;
}

function toEnumKey(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  return `j:${JSON.stringify(value)}`;
}

function deriveOutputSchemaFields(samples: DatasetSample[], fields: DatasetField[]): OutputSchemaField[] {
  const expectedField = getExpectedField(fields);
  if (!expectedField) return [];

  type FieldStat = { name: string; type: string; count: number; enumValues: Set<string> };
  const fieldStats = new Map<string, FieldStat>();
  const recordValue = (name: string, type: string, value: unknown) => {
    const enumKey = toEnumKey(value);
    const current = fieldStats.get(name);
    if (current) {
      current.count += 1;
      current.enumValues.add(enumKey);
    } else {
      fieldStats.set(name, { name, type, count: 1, enumValues: new Set([enumKey]) });
    }
  };

  for (const sample of samples) {
    if (sample.deletedAt) continue;

    const rawExpectedValue = sample.data[expectedField.name];
    const expectedValue = parseExpectedOutputObject(rawExpectedValue);
    if (!expectedValue) {
      if (rawExpectedValue !== undefined && rawExpectedValue !== null && getDisplayValue(rawExpectedValue).length > 0) {
        recordValue(expectedField.name, getValueType(rawExpectedValue), rawExpectedValue);
      }
      continue;
    }

    for (const [fieldName, value] of Object.entries(expectedValue)) {
      recordValue(fieldName, getValueType(value), value);
    }
  }

  return Array.from(fieldStats.values())
    .map((stat) => ({ name: stat.name, type: stat.type, count: stat.count, enumCount: stat.enumValues.size }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getOutputSchemaExtraFields(value: string, outputSchemaFields: OutputSchemaField[]) {
  const expectedValue = parseExpectedOutputObject(value);
  if (!expectedValue) return [];

  const schemaNames = new Set(outputSchemaFields.map((field) => field.name));
  return Object.keys(expectedValue).filter((fieldName) => !schemaNames.has(fieldName));
}

function upsertExpectedOutputField(value: string, fieldName: string) {
  const expectedValue = parseExpectedOutputObject(value) ?? (value.trim().length > 0 ? { [fieldName]: value } : {});
  if (!(fieldName in expectedValue)) expectedValue[fieldName] = '';
  return JSON.stringify(expectedValue, null, 2);
}

function getDraftData(fields: DatasetField[], draft: Record<string, string>) {
  return Object.fromEntries(
    fields.map((field) => {
      const value = draft[field.name] ?? '';
      const expectedValue = field.role === 'expected' ? parseExpectedOutputObject(value) : null;
      const imageReferences = field.role === 'image' ? parseImageReferenceArrayInput(value) : null;
      return [field.name, imageReferences ?? expectedValue ?? value];
    }),
  );
}

function applyFieldRoleChange(fields: DatasetField[], fieldName: string, nextRole: DatasetFieldRole): DatasetField[] {
  return fields.map((field) => {
    if (field.name === fieldName) return { ...field, role: nextRole };
    if (nextRole === 'expected' && field.role === 'expected') {
      return { ...field, role: 'metadata' as DatasetFieldRole };
    }
    return field;
  });
}

function FieldRoleBadgeButton({
  field,
  onRoleChange,
  size = 'default',
}: {
  field: DatasetField;
  onRoleChange: (role: DatasetFieldRole) => void;
  size?: 'default' | 'micro';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-sm transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          aria-label={`${t('datasets.detail.fieldRolePopover.title')}: ${field.name}`}
        >
          <RolePill role={field.role} size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-60 p-3">
        <div className="space-y-3">
          <div className="space-y-0.5">
            <div className="text-xs font-semibold">{t('datasets.detail.fieldRolePopover.title')}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{field.name}</div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">
              {t('datasets.detail.fieldRolePopover.changeRoleLabel')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_ROLE_OPTIONS.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => {
                    if (role !== field.role) onRoleChange(role);
                    setOpen(false);
                  }}
                  className={cn(
                    'inline-flex items-center rounded-md border px-2 py-1 transition hover:bg-accent',
                    field.role === role && 'border-primary bg-accent',
                  )}
                  aria-pressed={field.role === role}
                >
                  <RolePill role={role} className="border-0 bg-transparent px-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CurrentSamplePanel({
  sample,
  fields,
  outputSchemaFields,
  onPrevious,
  onNext,
  onSave,
  onDelete,
}: {
  sample: DatasetSample;
  fields: DatasetField[];
  outputSchemaFields: OutputSchemaField[];
  onPrevious: () => void;
  onNext: () => void;
  onSave: (sample: DatasetSample) => void;
  onDelete: (sampleId: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, string>>(() => sampleToDraft(sample, fields));
  const [preview, setPreview] = useState<{ field: string; value: string } | null>(null);

  const dirty = fields.some((field) => draft[field.name] !== getSampleFieldDisplayValue(sample, field));
  const displayId = getSampleDisplayId(sample, fields);

  const updateDraftField = (fieldName: string, value: string) => {
    setDraft((current) => ({ ...current, [fieldName]: value }));
  };

  return (
    <section className="rounded-lg border bg-card" data-testid="dataset-output-schema-panel">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Edit3 className="size-4 text-[var(--status-canary-fg)]" />
          <h2 className="truncate text-sm font-semibold">
            {t('datasets.detail.currentSample')} · <span className="font-mono">{displayId}</span>
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t('datasets.detail.previousSample')}
            onClick={onPrevious}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t('datasets.detail.nextSample')}
            onClick={onNext}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {fields.map((field) => {
          const value = draft[field.name] ?? '';
          const isImage = field.role === 'image';
          const imageReferences = isImage ? getImageReferences(value) : [];
          const imagePreviewValue = isImage ? getPrimaryImageReference(value) : value;
          const isImageArrayValue = isImage && value.trim().startsWith('[');
          const isMultiImage = isImageArrayValue || imageReferences.length > 1;
          const imageSource: ImageSourceType | null = isImage ? getImageSourceType(value) : null;
          const sourceLabelKey: 'url' | 'base64' | 'file' | null =
            imageSource === null ? null : imageSource === 'empty' ? 'file' : imageSource;
          const shouldUseTextarea =
            !isImage && (field.role === 'text' || field.role === 'expected' || value.length > 80);
          const extraOutputFields =
            field.role === 'expected' ? getOutputSchemaExtraFields(value, outputSchemaFields) : [];

          return (
            <div key={field.name}>
              <label className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium">
                <span className="min-w-0 truncate font-mono">{field.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5">
                  {field.role === 'expected' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-[11px] font-medium hover:bg-accent"
                          aria-label={`${t('datasets.detail.fillExpectedField')}: ${field.name}`}
                        >
                          {t('datasets.detail.fillExpectedField')}
                          <ChevronDown className="size-3 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {outputSchemaFields.length === 0 ? (
                          <DropdownMenuItem disabled>{t('datasets.detail.emptyOutputSchema')}</DropdownMenuItem>
                        ) : (
                          outputSchemaFields.map((schemaField) => (
                            <DropdownMenuItem
                              key={schemaField.name}
                              onSelect={() =>
                                updateDraftField(field.name, upsertExpectedOutputField(value, schemaField.name))
                              }
                            >
                              <span className="font-mono">{schemaField.name}</span>
                              <span className="ml-2 text-[11px] text-muted-foreground">{schemaField.type}</span>
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {sourceLabelKey && (
                    <span
                      className="inline-flex items-center rounded-[4px] border border-border bg-muted/40 px-1.5 py-0 font-mono text-[10px] uppercase text-muted-foreground"
                      data-testid={`image-source-chip-${field.name}`}
                    >
                      {t(`datasets.detail.imageSourceType.${sourceLabelKey}`)}
                    </span>
                  )}
                  <RolePill role={field.role} />
                </span>
              </label>
              {isMultiImage && (
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2">
                    <ImageCell
                      value={imagePreviewValue}
                      fieldName={field.name}
                      imageCount={Math.max(imageReferences.length, 1)}
                      onPreview={() => setPreview({ field: field.name, value: imagePreviewValue })}
                      size="inline"
                    />
                  </div>
                  <textarea
                    value={value}
                    onChange={(event) => updateDraftField(field.name, event.target.value)}
                    wrap="off"
                    spellCheck={false}
                    className="block max-h-40 min-h-20 w-full overflow-auto rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${t('datasets.action.replaceImage')}: ${field.name}`}
                  />
                </div>
              )}
              {!isMultiImage && imageSource === 'url' && (
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2">
                    <ImageCell
                      value={imagePreviewValue}
                      fieldName={field.name}
                      onPreview={() => setPreview({ field: field.name, value: imagePreviewValue })}
                      size="inline"
                    />
                  </div>
                  <Input
                    type="url"
                    value={value}
                    onChange={(event) => updateDraftField(field.name, event.target.value)}
                    placeholder="https://"
                    className="h-9 font-mono text-sm"
                    aria-label={`${t('datasets.action.replaceImageUrl')}: ${field.name}`}
                  />
                </div>
              )}
              {!isMultiImage && imageSource === 'base64' && (
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2">
                    <ImageCell
                      value={imagePreviewValue}
                      fieldName={field.name}
                      onPreview={() => setPreview({ field: field.name, value: imagePreviewValue })}
                      size="inline"
                    />
                  </div>
                  <textarea
                    value={value}
                    onChange={(event) => updateDraftField(field.name, event.target.value)}
                    wrap="off"
                    spellCheck={false}
                    className="block max-h-40 min-h-20 w-full overflow-auto rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${t('datasets.action.replaceImageBase64')}: ${field.name}`}
                  />
                </div>
              )}
              {!isMultiImage && (imageSource === 'file' || imageSource === 'empty') && (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
                  <ImageThumb large />
                  <div className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
                    <div className="truncate font-mono">{value || '-'}</div>
                    <div className="font-mono">{getImageMeta(value) || field.preview}</div>
                    <label className="mt-1.5 inline-flex cursor-pointer text-xs font-medium text-[var(--status-canary-fg)] hover:underline">
                      {t('datasets.action.replaceImage')}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;

                          updateDraftField(field.name, file.name);
                          event.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
              {!isImage && shouldUseTextarea && (
                <textarea
                  value={value}
                  onChange={(event) => updateDraftField(field.name, event.target.value)}
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              )}
              {!isImage && !shouldUseTextarea && (
                <Input
                  value={value}
                  onChange={(event) => updateDraftField(field.name, event.target.value)}
                  className="h-9 font-mono text-sm"
                />
              )}
              {extraOutputFields.length > 0 && (
                <div className="mt-1 flex items-start gap-1.5 rounded-md border border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] px-2 py-1.5 text-[11px] text-[var(--status-pending-fg)]">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>
                    {t('datasets.detail.outputSchemaExtraWarning').replace('{fields}', extraOutputFields.join(', '))}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 justify-start text-destructive hover:text-destructive"
            onClick={() => onDelete(sample.id)}
          >
            <Trash2 className="size-3.5" />
            {t('datasets.detail.deleteSample')}
          </Button>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              disabled={!dirty}
              onClick={() => setDraft(sampleToDraft(sample, fields))}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!dirty}
              onClick={() => onSave({ ...sample, data: { ...sample.data, ...getDraftData(fields, draft) } })}
            >
              {t('datasets.action.saveChanges')}
            </Button>
          </div>
        </div>
      </div>
      <ImagePreviewDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
        fieldName={preview?.field ?? ''}
        value={preview?.value ?? ''}
      />
    </section>
  );
}

export function DatasetDetailPage({
  projectId,
  dataset,
}: {
  projectId: string;
  dataset: ProjectDataset;
}) {
  const { t } = useI18n();
  const downloadDatasetMutation = useDownloadDataset(projectId);
  const deleteSamplesMutation = useDeleteDatasetSamples(projectId, dataset.id);
  const downloadProgress = useDatasetTransferProgress();
  const [fields, setFields] = useState<DatasetField[]>(() => cloneFields(dataset.fields));

  // Server-side pagination + search: only the current page of samples is ever loaded into the browser.
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const samplesQuery = useDatasetSamples(projectId, dataset.id, { page: pageIndex + 1, pageSize, search });
  const total = samplesQuery.data?.total ?? 0;
  const pageSamples = useMemo(() => toDatasetSamples(samplesQuery.data?.data), [samplesQuery.data]);

  const [samples, setSamples] = useState<DatasetSample[]>(pageSamples);
  const [selectedSampleId, setSelectedSampleId] = useState('');
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [pendingDeleteSampleIds, setPendingDeleteSampleIds] = useState<string[] | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  // Debounce the search box; reset to the first page when the term changes.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // Re-sync the editable working copy + selection whenever the server page changes (page / search / refetch).
  // React-recommended "adjust state during render" pattern — avoids the setState-in-effect cascading render
  // flagged by react-hooks/set-state-in-effect. pageSamples is a useMemo keyed on the query data, so the
  // guard only fires when the page data actually changes (no render loop).
  const [syncedPageSamples, setSyncedPageSamples] = useState(pageSamples);
  if (syncedPageSamples !== pageSamples) {
    setSyncedPageSamples(pageSamples);
    setSamples(pageSamples);
    setSelectedSampleIds([]);
    setSelectedSampleId(pageSamples[0]?.id ?? '');
  }

  const displayFields = useMemo(() => {
    const merged = mergeFieldsWithSampleData(fields, samples);
    const preferred = fields.find((field) => field.role === 'expected')?.name ?? null;
    return normalizeExpectedRoles(merged, preferred);
  }, [fields, samples]);
  const orderedFields = useMemo(() => getOrderedFields(displayFields), [displayFields]);
  const outputSchemaFields = useMemo(() => deriveOutputSchemaFields(samples, orderedFields), [orderedFields, samples]);
  const displayDataset = useMemo(
    () => ({
      ...dataset,
      fields: displayFields,
      fieldCount: displayFields.length,
    }),
    [dataset, displayFields],
  );
  const handleFieldRoleChange = (fieldName: string, nextRole: DatasetFieldRole) => {
    setFields(applyFieldRoleChange(displayFields, fieldName, nextRole));
  };

  // The server already applied search + pagination; show the page rows minus any locally-deleted ones.
  const visibleSamples = useMemo(() => samples.filter((sample) => !sample.deletedAt), [samples]);

  const selectedSample =
    visibleSamples.find((sample) => sample.id === selectedSampleId) ?? visibleSamples[0] ?? null;

  const selectRelativeSample = (direction: -1 | 1) => {
    if (!selectedSample) return;
    const index = visibleSamples.findIndex((sample) => sample.id === selectedSample.id);
    const next = visibleSamples[Math.min(visibleSamples.length - 1, Math.max(0, index + direction))];
    if (next) setSelectedSampleId(next.id);
  };

  const toggleSampleSelected = (sampleId: string) => {
    setSelectedSampleIds((current) =>
      current.includes(sampleId) ? current.filter((item) => item !== sampleId) : [...current, sampleId],
    );
  };

  const filteredSampleIds = useMemo(() => visibleSamples.map((sample) => sample.id), [visibleSamples]);
  const sampleHeadState: 'off' | 'some' | 'all' = useMemo(() => {
    if (selectedSampleIds.length === 0 || filteredSampleIds.length === 0) return 'off';
    if (filteredSampleIds.every((id) => selectedSampleIds.includes(id))) return 'all';
    return 'some';
  }, [filteredSampleIds, selectedSampleIds]);

  const toggleAllFilteredSamples = () => {
    if (filteredSampleIds.length === 0) return;
    setSelectedSampleIds((current) => {
      const visibleSet = new Set(filteredSampleIds);
      const allSelected = filteredSampleIds.every((id) => current.includes(id));
      if (allSelected) {
        return current.filter((id) => !visibleSet.has(id));
      }
      const merged = new Set(current);
      for (const id of filteredSampleIds) merged.add(id);
      return Array.from(merged);
    });
  };

  const saveSample = (nextSample: DatasetSample) => {
    setSamples((current) => current.map((sample) => (sample.id === nextSample.id ? nextSample : sample)));
  };

  const requestDeleteSamples = (sampleIds: string[]) => {
    if (sampleIds.length === 0) return;
    if (getReferenceCount(displayDataset) > 0) {
      setDeleteBlocked(true);
      return;
    }
    setPendingDeleteSampleIds(sampleIds);
  };

  const confirmDeleteSamples = async () => {
    if (!pendingDeleteSampleIds || pendingDeleteSampleIds.length === 0) return;
    const sampleIds = pendingDeleteSampleIds;

    try {
      await deleteSamplesMutation.mutateAsync({ sampleIds });
    } catch {
      return;
    }

    const deleteIds = new Set(sampleIds);
    const activeSamples = samples.filter((sample) => !sample.deletedAt);
    const currentIndex = activeSamples.findIndex((sample) => sample.id === selectedSampleId);
    const remainingSamples = activeSamples.filter((sample) => !deleteIds.has(sample.id));
    const nextSample =
      remainingSamples[Math.min(Math.max(currentIndex, 0), remainingSamples.length - 1)] ?? remainingSamples[0];

    setSamples((current) => current.filter((sample) => !deleteIds.has(sample.id)));
    setSelectedSampleIds((current) => current.filter((sampleId) => !deleteIds.has(sampleId)));
    if (deleteIds.has(selectedSampleId) || !remainingSamples.some((sample) => sample.id === selectedSampleId)) {
      setSelectedSampleId(nextSample?.id ?? '');
    }
    setPendingDeleteSampleIds(null);
  };

  const downloadDataset = async (format: DatasetExportFormatDto) => {
    downloadProgress.start(`${t('datasets.transfer.downloadTitle')}: ${displayDataset.name}`, null);

    try {
      const file = await downloadDatasetMutation.mutateAsync({
        datasetId: displayDataset.id,
        format,
        onProgress: downloadProgress.update,
      });
      downloadProgress.complete(file.blob.size);
      saveBlobAsFile(file.blob, file.fileName);
    } catch {
      downloadProgress.fail();
    }
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="dataset-detail-page">
        <div className="mb-1 font-mono text-[11.5px] text-muted-foreground">
          <Link className="hover:text-foreground" href={`/datasets`}>
            {t('datasets.title')}
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">{displayDataset.name}</span>
        </div>
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-semibold">{displayDataset.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
              <ModalityBadge modalities={displayDataset.modalities} />
              <span>
                {formatCount(displayDataset.sampleCount)} {t('datasets.samples')} · {displayDataset.fieldCount}{' '}
                {t('datasets.detail.fields')}
              </span>
              <span>·</span>
              <ReferenceText dataset={displayDataset} />
              <span>·</span>
              <span>
                {t('datasets.detail.uploadedBy')} {displayDataset.owner}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportFormatMenu
              disabled={downloadDatasetMutation.isPending}
              onExport={(format) => void downloadDataset(format)}
            />
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href={getExperimentNewHref(projectId, displayDataset)}>
                <FlaskConical className="size-4" />
                {t('datasets.action.startExperiment')}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href={getOptimizationNewHref(projectId, displayDataset)}>
                <Sparkles className="size-4" />
                {t('datasets.action.startOptimization')}
              </Link>
            </Button>
          </div>
        </div>

        <DatasetTransferProgressPanel progress={downloadProgress.progress} className="mb-4" />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 rounded-lg border bg-card">
            <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-[360px]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={t('datasets.detail.sampleSearchPlaceholder')}
                    className="h-9 pl-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedSampleIds.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 text-destructive hover:text-destructive"
                    onClick={() => requestDeleteSamples(selectedSampleIds)}
                    data-testid="dataset-detail-delete-selected"
                  >
                    <Trash2 className="size-4" />
                    {t('datasets.detail.deleteSelected')} {selectedSampleIds.length} {t('datasets.header.items')}
                  </Button>
                ) : null}
              </div>
            </div>

            <DatasetSamplesTable
              data={visibleSamples}
              fields={orderedFields}
              selectedSampleId={selectedSample?.id ?? ''}
              selectedIds={selectedSampleIds}
              headState={sampleHeadState}
              total={total}
              pageIndex={pageIndex}
              pageSize={pageSize}
              onPageIndexChange={setPageIndex}
              onPageSizeChange={setPageSize}
              onSelectSample={setSelectedSampleId}
              onToggleSelected={toggleSampleSelected}
              onToggleAll={toggleAllFilteredSamples}
              onDeleteSample={(sampleId) => requestDeleteSamples([sampleId])}
              renderFieldHeaderTrailing={(field) => (
                <FieldRoleBadgeButton
                  field={field}
                  size="micro"
                  onRoleChange={(role) => handleFieldRoleChange(field.name, role)}
                />
              )}
            />
          </section>

          <aside className="space-y-4" data-testid="dataset-detail-side-rail">
            {selectedSample ? (
              <CurrentSamplePanel
                key={`${selectedSample.id}-${orderedFields.map((field) => `${field.name}:${field.role}`).join('|')}`}
                sample={selectedSample}
                fields={orderedFields}
                outputSchemaFields={outputSchemaFields}
                onPrevious={() => selectRelativeSample(-1)}
                onNext={() => selectRelativeSample(1)}
                onSave={saveSample}
                onDelete={(sampleId) => requestDeleteSamples([sampleId])}
              />
            ) : (
              <section className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                {t('datasets.detail.emptySamples')}
              </section>
            )}
          </aside>
        </div>
      </div>

      <Dialog
        open={pendingDeleteSampleIds !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSamplesMutation.isPending) setPendingDeleteSampleIds(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('datasets.detail.confirmDeleteTitle').replace('{count}', String(pendingDeleteSampleIds?.length ?? 0))}
            </DialogTitle>
            <DialogDescription>{t('datasets.detail.confirmDeleteDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleteSamplesMutation.isPending}
              onClick={() => setPendingDeleteSampleIds(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteSamplesMutation.isPending}
              onClick={() => void confirmDeleteSamples()}
              data-testid="dataset-detail-confirm-delete"
            >
              {t('datasets.detail.confirmDeleteButton')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteBlocked} onOpenChange={(open) => !open && setDeleteBlocked(false)}>
        <DialogContent data-testid="dataset-detail-delete-blocked">
          <DialogHeader>
            <DialogTitle>{t('datasets.detail.deleteBlockedTitle')}</DialogTitle>
            <DialogDescription>{t('datasets.detail.deleteBlockedDescription')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <ReferenceText dataset={displayDataset} />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteBlocked(false)}>
              {t('common.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
