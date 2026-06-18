'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  CopyPlus,
  Download,
  FileDown,
  Hourglass,
  Play,
  RefreshCw,
  Search,
  Square,
  X,
} from 'lucide-react';
import type {
  DatasetFieldSchemaDto,
  ExperimentExportFormatDto,
  ExperimentListItemDto,
  ExperimentStatusDto,
  RunResultDatasetFieldValueDto,
  RunResultJudgmentStatusDto,
  RunResultListItemDto,
  RunResultStatusDto,
} from '@proofhound/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ImagePreviewDialog,
  ImageZoomHoverOverlay,
  Input,
  ModalityIcon,
  ModalityIconGroup,
  DetailPageSkeleton,
  Progress,
  formatProgressLabel,
  ResourcePaginationFooter,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TooltipProvider,
  cn,
} from '@proofhound/ui';
import type { ModalityKind, TableColumn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useI18n, type TranslationKey } from '../../i18n';
import { formatLatencySeconds } from '../../lib';
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useControlExperiment, useDownloadExperiment, useExperiment } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useExperimentRunResults } from '../../hooks';
import { experimentTone } from './experiment-theme';
import { buildRepeatExperimentHref } from './experiment-repeat-href';
import { derivePromptModalityKinds } from './experiment-view-model';
import { ExperimentStatusBadge, formatNumber } from './experiment-ui';
import {
  compactHumanValue,
  getModelOutputFieldValue,
  getModelOutputValue,
  hasStructuredModelOutput,
} from './run-result-display';
import {
  formatRunResultFailureReason,
  getBinaryRunResultJudgmentStatus,
  getRunResultJudgmentLabelKey,
} from './run-result-labels';
import { RunResultDetailSheet } from './run-result-detail-sheet';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function safeNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const ms = Math.max(0, Math.round(value));
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)} s`;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getExperimentDurationSeconds(
  detail: Pick<ExperimentListItemDto, 'createdAt' | 'finishedAt' | 'startedAt' | 'status' | 'updatedAt'>,
) {
  const startedAt = Date.parse(detail.startedAt ?? detail.createdAt);
  const endedAt = detail.finishedAt
    ? Date.parse(detail.finishedAt)
    : detail.status === 'running'
      ? Date.now()
      : Date.parse(detail.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return Math.round((endedAt - startedAt) / 1000);
}

function getDurationParts(totalSeconds: number | null) {
  if (totalSeconds === null || totalSeconds < 0 || !Number.isFinite(totalSeconds)) return null;
  const seconds = Math.round(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) {
    return [
      { label: 'd', value: days },
      { label: 'h', value: hours, pad: true },
      { label: 'm', value: minutes, pad: true },
      { label: 's', value: remainingSeconds, pad: true },
    ];
  }
  if (hours > 0) {
    return [
      { label: 'h', value: hours },
      { label: 'm', value: minutes, pad: true },
      { label: 's', value: remainingSeconds, pad: true },
    ];
  }
  if (minutes > 0) {
    return [
      { label: 'm', value: minutes },
      { label: 's', value: remainingSeconds, pad: true },
    ];
  }
  return [{ label: 's', value: remainingSeconds }];
}

function TimePoint({ date, includeDate }: { date: Date | null; includeDate: boolean }) {
  const { formatDate, formatTime } = useDateTimeFormatter();
  if (!date) return <span className="font-mono text-[10.5px] text-muted-foreground">—</span>;

  return (
    <span className="inline-flex items-baseline gap-1 font-mono tabular-nums">
      {includeDate && <span className="text-[10px] text-muted-foreground">{formatDate(date)}</span>}
      <span className="text-[10.5px] font-semibold text-foreground sm:text-[11px]">{formatTime(date)}</span>
    </span>
  );
}

function ExperimentTimingSubtitle({ detail, className }: { detail: ExperimentListItemDto; className?: string }) {
  const { formatDate } = useDateTimeFormatter();
  const startDate = parseDate(detail.startedAt ?? detail.createdAt);
  const finishedDate = parseDate(detail.finishedAt);
  const durationSeconds = getExperimentDurationSeconds(detail);
  const duration = getDurationParts(durationSeconds);
  const comparisonEndDate = finishedDate ?? (detail.status === 'running' ? new Date() : parseDate(detail.updatedAt));
  const includeDate = Boolean(
    startDate && comparisonEndDate && formatDate(startDate) !== formatDate(comparisonEndDate),
  );

  return (
    <div className={cn('flex w-fit max-w-full flex-col items-center gap-0.5', className)}>
      <div
        className={cn(
          'flex flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono tabular-nums',
          experimentTone.positive.text,
        )}
      >
        <Hourglass className="size-3 self-center" aria-hidden="true" />
        {duration ? (
          <>
            {duration.map((part) => (
              <span key={part.label} className="inline-flex items-baseline gap-0.5">
                <span className="text-[10px] font-semibold leading-none tracking-normal sm:text-[11px]">
                  {part.pad ? String(part.value).padStart(2, '0') : part.value}
                </span>
                <span className="text-[8px] font-semibold sm:text-[8.5px]">{part.label}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="text-[10px] font-semibold leading-none tracking-normal sm:text-[11px]">—</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Play
          className={cn('size-2 fill-current stroke-current', experimentTone.positive.text)}
          aria-hidden="true"
        />
        <TimePoint date={startDate} includeDate={includeDate} />
        <span className="font-mono text-[10.5px] text-muted-foreground/70 sm:text-[11px]" aria-hidden="true">
          →
        </span>
        <TimePoint date={finishedDate} includeDate={includeDate} />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  detail,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  highlight?: boolean;
  tone?: 'destructive';
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md border bg-card px-3 py-2.5',
        highlight && 'border-primary/40 bg-primary/5',
      )}
    >
      <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-mono text-[18px] font-semibold tabular-nums',
          tone === 'destructive' && experimentTone.danger.text,
        )}
      >
        {value}
        {unit && <span className="ml-1 text-[12px] font-normal text-muted-foreground">{unit}</span>}
      </span>
      <span className="text-[11px] text-muted-foreground">{detail ?? ' '}</span>
    </div>
  );
}

function SpecLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="min-w-[76px] text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

interface ControlButton {
  action: 'stop' | 'resume' | 'cancel' | 'retry';
  labelKey: TranslationKey;
  variant: 'outline' | 'default';
  destructive?: boolean;
  icon: React.ReactNode;
}

function deriveControlButtons(status: ExperimentStatusDto, controlState: string | null): ControlButton[] {
  if (controlState === 'cancel' || (status === 'running' && controlState === 'stop')) {
    return []; // pending state is expressed by the UI
  }
  switch (status) {
    case 'running':
      return [
        {
          action: 'stop',
          labelKey: 'experiments.action.stopExperiment',
          variant: 'outline',
          destructive: true,
          icon: <Square className="size-4" />,
        },
        {
          action: 'cancel',
          labelKey: 'experiments.action.cancel',
          variant: 'outline',
          destructive: true,
          icon: <X className="size-4" />,
        },
      ];
    case 'stopped':
      return [
        {
          action: 'resume',
          labelKey: 'experiments.action.resume',
          variant: 'default',
          icon: <RefreshCw className="size-4" />,
        },
        {
          action: 'retry',
          labelKey: 'experiments.action.repeatExperiment',
          variant: 'outline',
          icon: <CopyPlus className="size-4" />,
        },
        {
          action: 'cancel',
          labelKey: 'experiments.action.cancel',
          variant: 'outline',
          destructive: true,
          icon: <X className="size-4" />,
        },
      ];
    case 'success':
    case 'failed':
    case 'cancelled':
      return [
        {
          action: 'retry',
          labelKey: 'experiments.action.repeatExperiment',
          variant: 'outline',
          icon: <CopyPlus className="size-4" />,
        },
      ];
    default:
      return [];
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  if (typeof window === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function FailureBanner({ detail }: { detail: ExperimentListItemDto }) {
  const { t } = useI18n();
  if (!detail.failureKind && !detail.failureReason) return null;
  return (
    <div
      className={cn(
        'mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-[12.5px]',
        experimentTone.danger.text,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">
        <p className="font-mono text-[11px] uppercase tracking-wide">
          {detail.failureKind ?? t('experiments.detail.failureBanner.unknown')}
        </p>
        <p className="mt-1 break-words text-foreground">
          {detail.failureReason ?? t('experiments.detail.failureBanner.noDetail')}
        </p>
      </div>
    </div>
  );
}

function MiniBar({ correct, wrong }: { correct: number; wrong: number }) {
  const total = correct + wrong || 1;
  return (
    <div className="flex h-4 min-w-[120px] overflow-hidden rounded border">
      <span
        className={cn('text-center font-mono text-[10px]', experimentTone.positive.bg, experimentTone.positive.text)}
        style={{ width: `${(correct / total) * 100}%` }}
      >
        {correct}
      </span>
      <span
        className={cn('text-center font-mono text-[10px]', experimentTone.danger.bg, experimentTone.danger.text)}
        style={{ width: `${(wrong / total) * 100}%` }}
      >
        {wrong}
      </span>
    </div>
  );
}

interface SampleFilterValue {
  judgmentStatus: RunResultJudgmentStatusDto[] | undefined;
  status: RunResultStatusDto[] | undefined;
  isCorrect: boolean | undefined;
  search: string;
}

type InputFieldRole = 'text' | 'image' | 'image_url' | 'image_base64';

const INPUT_FIELD_ROLES: ReadonlySet<DatasetFieldSchemaDto['role']> = new Set([
  'text',
  'image',
  'image_url',
  'image_base64',
]);

function isInputFieldRole(role: DatasetFieldSchemaDto['role']): role is InputFieldRole {
  return INPUT_FIELD_ROLES.has(role);
}

function mapRoleToModality(role: InputFieldRole): ModalityKind {
  return role === 'text' ? 'text' : 'image';
}

function ImageThumbnail({
  url,
  failedLabel,
  previewLabel,
  onPreview,
}: {
  url: string;
  failedLabel: string;
  previewLabel: string;
  onPreview?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const interactive = Boolean(onPreview);
  const handleClick = (event: React.MouseEvent) => {
    if (!onPreview) return;
    event.stopPropagation();
    onPreview();
  };
  if (failed) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={!interactive}
        aria-label={previewLabel}
        className="group relative inline-flex h-10 w-[80px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm border border-dashed text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed"
      >
        {failedLabel}
        {interactive && <ImageZoomHoverOverlay className="rounded-sm" />}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!interactive}
      aria-label={previewLabel}
      className="group relative inline-flex shrink-0 cursor-pointer overflow-hidden rounded-sm transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-10 w-[80px] rounded-sm border bg-muted/30 object-cover"
      />
      {interactive && <ImageZoomHoverOverlay className="rounded-sm" />}
    </button>
  );
}

function InputCell({
  role,
  value,
  imageFailedLabel,
  imagePreviewLabel,
  onPreviewImage,
  fieldName,
}: {
  role: InputFieldRole;
  value: unknown;
  imageFailedLabel: string;
  imagePreviewLabel: string;
  onPreviewImage?: (preview: { field: string; value: string }) => void;
  fieldName: string;
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }

  if (role === 'text') {
    const stringValue = typeof value === 'string' ? value : compactHumanValue(value, 240);
    return (
      <span
        className="block max-w-[280px] truncate text-[12px] text-foreground"
        title={typeof value === 'string' ? value : compactHumanValue(value, 800)}
      >
        {compactHumanValue(stringValue, 120)}
      </span>
    );
  }

  if (role === 'image_base64') {
    const charCount = typeof value === 'string' ? value.length : null;
    const hint = charCount !== null ? `(base64 · ${charCount.toLocaleString('en-US')} chars)` : '(base64)';
    const base64Value = typeof value === 'string' ? value : '';
    const previewSrc = base64Value.startsWith('data:image/') ? base64Value : `data:image/*;base64,${base64Value}`;
    const handlePreviewBase64 = onPreviewImage
      ? () => onPreviewImage({ field: fieldName, value: previewSrc })
      : undefined;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <ImageThumbnail
          url={previewSrc}
          failedLabel={imageFailedLabel}
          previewLabel={imagePreviewLabel}
          onPreview={handlePreviewBase64}
        />
        <span className="font-mono text-[11px] text-muted-foreground">{hint}</span>
      </span>
    );
  }

  const urlString = typeof value === 'string' ? value : compactHumanValue(value, 200);
  const handlePreview = onPreviewImage ? () => onPreviewImage({ field: fieldName, value: urlString }) : undefined;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ImageThumbnail
        url={urlString}
        failedLabel={imageFailedLabel}
        previewLabel={imagePreviewLabel}
        onPreview={handlePreview}
      />
      <span className="block min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={urlString}>
        {compactHumanValue(urlString, 60)}
      </span>
    </span>
  );
}

function buildSampleFieldValueMap(
  textFields: RunResultDatasetFieldValueDto[],
  imageFields: RunResultDatasetFieldValueDto[],
): Map<string, RunResultDatasetFieldValueDto> {
  const map = new Map<string, RunResultDatasetFieldValueDto>();
  for (const field of textFields) map.set(field.name, field);
  for (const field of imageFields) map.set(field.name, field);
  return map;
}

function RunResultJudgmentBadge({ sample }: { sample: RunResultListItemDto }) {
  const { t } = useI18n();
  const labelKey = getRunResultJudgmentLabelKey(sample);
  const judgmentStatus = getBinaryRunResultJudgmentStatus(sample);
  const positive = judgmentStatus === 'correct';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        positive ? experimentTone.positive.pill : experimentTone.danger.pill,
      )}
    >
      {t(labelKey)}
    </span>
  );
}

function SampleResultsSection({
  detail,
  projectId,
  experimentId,
  onOpenDetail,
}: {
  detail: ExperimentListItemDto;
  projectId: string;
  experimentId: string;
  onOpenDetail: (runResultId: string) => void;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const [filter, setFilter] = useState<'all' | 'ok' | 'bad' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const inputColumns = useMemo(
    () =>
      (detail.datasetFieldSchema ?? []).filter((field): field is DatasetFieldSchemaDto & { role: InputFieldRole } =>
        isInputFieldRole(field.role),
      ),
    [detail.datasetFieldSchema],
  );
  const outputFields = useMemo(() => detail.outputSchema?.fields ?? [], [detail.outputSchema]);
  const hasDynamicOutput = outputFields.length > 0;
  const sampleResultColumns = useMemo<TableColumn[]>(() => {
    const baseCols: TableColumn[] = [
      { key: 'externalId', width: 'compact', sticky: 'left' },
      ...inputColumns.map<TableColumn>((col) => ({
        key: `field:${col.name}`,
        width: col.role === 'text' ? 'wide' : 'normal',
      })),
    ];
    const outputCols: TableColumn[] = hasDynamicOutput
      ? outputFields.map<TableColumn>((field) => {
          if (outputFields.length === 1) {
            return { key: `output:${field.key}`, width: 'flex', minPx: 280 };
          }
          const width: TableColumn['width'] =
            outputFields.length <= 2 ? 'wide' : outputFields.length <= 4 ? 'normal' : 'compact';
          return { key: `output:${field.key}`, width };
        })
      : [{ key: 'output', width: 'flex', minPx: 320 }];
    return [
      ...baseCols,
      ...outputCols,
      { key: 'expected', width: 'normal' },
      { key: 'judgment', width: 'compact' },
      { key: 'failure', width: 'normal' },
      { key: 'latency', width: 'compact' },
      { key: 'createdAt', width: 'normal' },
    ];
  }, [inputColumns, hasDynamicOutput, outputFields]);
  const imageFailedLabel = t('experiments.detail.samples.image.failed');
  const imagePreviewLabel = t('datasets.detail.imagePreview');
  const [imagePreview, setImagePreview] = useState<{ field: string; value: string } | null>(null);

  const filterValue = useMemo<SampleFilterValue>(() => {
    if (filter === 'ok') return { isCorrect: true, judgmentStatus: undefined, status: undefined, search };
    if (filter === 'bad') return { isCorrect: false, judgmentStatus: undefined, status: undefined, search };
    if (filter === 'error')
      return { isCorrect: undefined, judgmentStatus: undefined, status: ['failed'], search };
    return { isCorrect: undefined, judgmentStatus: undefined, status: undefined, search };
  }, [filter, search]);

  const { data, isLoading } = useExperimentRunResults(projectId, experimentId, {
    page: pageIndex + 1,
    pageSize,
    sort: 'created_desc',
    isCorrect: filterValue.isCorrect,
    judgmentStatus: filterValue.judgmentStatus,
    status: filterValue.status,
    search: filterValue.search.trim() || undefined,
  });

  const total = data?.total ?? 0;
  const samples = data?.data ?? [];
  const samplesLoading = useDelayedLoading(isLoading);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, total);

  const filterOptions: Array<{ key: typeof filter; label: string; count?: number }> = [
    { key: 'all', label: t('experiments.detail.samples.all'), count: detail.processedSamples },
    { key: 'ok', label: t('experiments.detail.samples.correct') },
    { key: 'bad', label: t('experiments.detail.samples.wrong') },
    { key: 'error', label: t('experiments.detail.samples.error'), count: detail.failedSamples },
  ];

  return (
    <section
      className="mt-4 rounded-lg border bg-card"
      data-testid="experiment-samples"
      data-experiment-id={experimentId}
      data-project-id={projectId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-semibold">{t('experiments.detail.samples')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {filterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setFilter(option.key);
                  setPageIndex(0);
                }}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors',
                  filter === option.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span>{option.label}</span>
                {typeof option.count === 'number' && (
                  <span
                    className={cn(
                      'font-mono text-[11px]',
                      filter === option.key ? 'opacity-80' : 'text-muted-foreground',
                    )}
                  >
                    {option.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="relative w-full max-w-[360px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPageIndex(0);
            }}
            placeholder={t('experiments.detail.samples.searchPlaceholder')}
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>
      <Table columns={sampleResultColumns}>
        <TableHeader>
          <TableRow>
            <TableHead column="externalId">
              {t('experiments.detail.samples.col.externalId')}
            </TableHead>
            {inputColumns.map((col) => {
              const isImage = col.role !== 'text';
              return (
                <TableHead key={col.name} column={`field:${col.name}`}>
                  <span className="flex items-center gap-1.5">
                    <ModalityIcon kind={mapRoleToModality(col.role)} size="sm" />
                    <span className="font-mono text-[12px] text-foreground">{col.name}</span>
                    {isImage && (
                      <span className="font-mono text-[10px] normal-case text-muted-foreground">{col.role}</span>
                    )}
                  </span>
                </TableHead>
              );
            })}
            {hasDynamicOutput ? (
              outputFields.map((field) => {
                const titleParts: string[] = [];
                if (field.value) titleParts.push(field.value);
                if (field.isJudgment) titleParts.push(t('experiments.detail.samples.output.judgmentBadge'));
                const headTitle = titleParts.join(' · ') || undefined;
                return (
                  <TableHead key={field.key} column={`output:${field.key}`}>
                    <span className="flex items-center gap-1.5" title={headTitle}>
                      <span className="font-mono text-[12px] text-foreground">{field.key}</span>
                      {field.isJudgment && (
                        <span
                          aria-label={t('experiments.detail.samples.output.judgmentBadge')}
                          className="font-mono text-[10px] text-muted-foreground"
                        >
                          [J]
                        </span>
                      )}
                    </span>
                  </TableHead>
                );
              })
            ) : (
              <TableHead column="output">{t('experiments.detail.samples.col.output')}</TableHead>
            )}
            <TableHead column="expected">{t('experiments.detail.samples.col.expected')}</TableHead>
            <TableHead column="judgment">{t('experiments.detail.samples.col.judgment')}</TableHead>
            <TableHead column="failure">{t('experiments.detail.samples.col.failure')}</TableHead>
            <TableHead column="latency">{t('experiments.detail.samples.col.latency')}</TableHead>
            <TableHead column="createdAt">{t('experiments.detail.samples.col.createdAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {samplesLoading && samples.length === 0 && <TableSkeletonRows />}
          {!isLoading && samples.length === 0 && <TableEmpty>{t('experiments.detail.samples.none')}</TableEmpty>}
          {samples.map((sample) => {
            const fieldMap = buildSampleFieldValueMap(sample.datasetTextFields, sample.datasetImageFields);
            const externalId = sample.externalId ?? sample.sampleId ?? sample.id;
            const failureReason = formatRunResultFailureReason(sample, t);
            return (
              <TableRow key={sample.id} onClick={() => onOpenDetail(sample.id)}>
                <TableCell
                  column="externalId"
                  truncate
                  className="font-mono text-[11.5px] text-muted-foreground"
                >
                  <span title={externalId}>{externalId}</span>
                </TableCell>
                {inputColumns.map((col) => {
                  const field = fieldMap.get(col.name);
                  return (
                    <TableCell key={col.name} column={`field:${col.name}`}>
                      <InputCell
                        role={col.role}
                        value={field?.value ?? null}
                        imageFailedLabel={imageFailedLabel}
                        imagePreviewLabel={imagePreviewLabel}
                        onPreviewImage={setImagePreview}
                        fieldName={col.name}
                      />
                    </TableCell>
                  );
                })}
                {hasDynamicOutput ? (
                  hasStructuredModelOutput(sample) ? (
                    outputFields.map((field) => {
                      const fieldValue = getModelOutputFieldValue(sample, field.key);
                      return (
                        <TableCell
                          key={field.key}
                          column={`output:${field.key}`}
                          truncate
                          className="text-[12px]"
                        >
                          <span title={compactHumanValue(fieldValue, 500)}>
                            {compactHumanValue(fieldValue, 180)}
                          </span>
                        </TableCell>
                      );
                    })
                  ) : (
                    outputFields.map((field, idx) => (
                      <TableCell
                        key={field.key}
                        column={`output:${field.key}`}
                        truncate
                        className="text-[12px]"
                      >
                        {idx === 0 ? (
                          <span title={compactHumanValue(getModelOutputValue(sample), 500)}>
                            {compactHumanValue(getModelOutputValue(sample), 180)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ))
                  )
                ) : (
                  <TableCell column="output" truncate className="text-[12px]">
                    <span title={compactHumanValue(getModelOutputValue(sample), 500)}>
                      {compactHumanValue(getModelOutputValue(sample), 180)}
                    </span>
                  </TableCell>
                )}
                <TableCell column="expected" truncate className="text-[12px] text-muted-foreground">
                  <span title={sample.expectedOutput ?? '—'}>{compactHumanValue(sample.expectedOutput, 120)}</span>
                </TableCell>
                <TableCell column="judgment">
                  <RunResultJudgmentBadge sample={sample} />
                </TableCell>
                <TableCell column="failure" truncate className="text-[12px] text-destructive">
                  <span title={failureReason ?? undefined}>
                    {failureReason ? compactHumanValue(failureReason, 120) : '—'}
                  </span>
                </TableCell>
                <TableCell column="latency" className="font-mono text-[11.5px] text-muted-foreground">
                  {formatDurationMs(sample.latencyMs)}
                </TableCell>
                <TableCell column="createdAt" className="font-mono text-[11.5px] text-muted-foreground">
                  {formatDateTime(sample.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ResourcePaginationFooter
        summary={
          <span>
            {formatTemplate(t('experiments.detail.samples.summary'), {
              from,
              to,
              total: total.toLocaleString('en-US').replace(/,/g, ' '),
            })}
          </span>
        }
        pageIndex={pageIndex}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        previousPageLabel={t('common.previousPage')}
        nextPageLabel={t('common.nextPage')}
        onPageChange={setPageIndex}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPageIndex(0);
        }}
      />
      <ImagePreviewDialog
        open={imagePreview !== null}
        onOpenChange={(next) => {
          if (!next) setImagePreview(null);
        }}
        fieldName={imagePreview?.field ?? ''}
        value={imagePreview?.value ?? ''}
      />
    </section>
  );
}

export function ExperimentDetailPage({ projectId, experimentId }: { projectId: string; experimentId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { data: detail, isLoading, error } = useExperiment(projectId, experimentId);
  const [selectedRunResultId, setSelectedRunResultId] = useState<string | null>(null);

  const controlExperiment = useControlExperiment(projectId);
  const downloadExperiment = useDownloadExperiment(projectId);

  const queryClient = useQueryClient();
  const isLive = detail?.status === 'running';
  const onTick = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['experiments', projectId], exact: false }),
      queryClient.invalidateQueries({ queryKey: ['run-results', projectId, experimentId], exact: false }),
    ]);
  }, [queryClient, projectId, experimentId]);
  useAutoRefresh({
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    enabled: isLive,
    onTick,
  });

  const detailLoading = useDelayedLoading(isLoading);
  if (detailLoading) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div
          className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8"
          data-testid="experiment-detail-page"
        >
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  if (error || !detail) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-12" data-testid="experiment-detail-page">
          <h1 className="text-[20px] font-semibold">{t('experiments.detail.notFound.title')}</h1>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{t('experiments.detail.notFound.description')}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={`/experiments`}>{t('experiments.new.backToList')}</Link>
          </Button>
        </div>
      </Main>
    );
  }

  const buttons = deriveControlButtons(detail.status, detail.controlState);
  const inProgressAction = controlExperiment.isPending ? controlExperiment.variables?.action : null;
  const inProgressDownload = downloadExperiment.isPending;

  const percent = detail.totalSamples > 0 ? (detail.processedSamples / detail.totalSamples) * 100 : 0;
  const progressLabel = formatProgressLabel({
    value: detail.processedSamples,
    max: Math.max(1, detail.totalSamples),
    percent,
    fractionDigits: 1,
  });
  const failedCorrect = Math.max(0, detail.processedSamples - detail.failedSamples);

  const metrics = detail.metrics ?? {};
  const accuracy = safeNumber(metrics.accuracy ?? null, NaN);
  const precision = safeNumber(metrics.precision ?? null, NaN);
  const recall = safeNumber(metrics.recall ?? null, NaN);
  const f1 = safeNumber(metrics.f1 ?? null, NaN);
  const perClass = metrics.perClass ?? [];
  const inputTokens = safeNumber(metrics.inputTokens ?? null, 0);
  const outputTokens = safeNumber(metrics.outputTokens ?? null, 0);
  const totalTokens = inputTokens + outputTokens;
  const costEstimate = safeNumber(metrics.costEstimate ?? null, 0);

  const handleControl = (action: 'stop' | 'resume' | 'cancel' | 'retry') => {
    if (action === 'retry') {
      router.push(buildRepeatExperimentHref(projectId, detail));
      return;
    }
    controlExperiment.mutate({ experimentId, action });
  };

  const handleExport = (format: ExperimentExportFormatDto) => {
    downloadExperiment.mutate(
      { experimentId, format },
      {
        onSuccess: (result) => downloadBlob(result.blob, result.fileName),
      },
    );
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <TooltipProvider>
        <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="experiment-detail-page">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <Link href={`/experiments`} className="hover:text-foreground">
              {t('experiments.new.backToList')}
            </Link>
          </div>

          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-[24px] font-semibold tracking-tight">
                <span className="font-mono">{detail.name}</span>
                <span data-testid="experiment-detail-status-badge">
                  <ExperimentStatusBadge status={detail.status} />
                </span>
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1"
                    disabled={inProgressDownload}
                    aria-label={t('experiments.action.download')}
                  >
                    <Download className="size-4" />
                    {t('experiments.action.download')}
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={inProgressDownload} onClick={() => handleExport('csv')}>
                    <Download className="size-4" />
                    {t('experiments.action.exportCsv')}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={inProgressDownload} onClick={() => handleExport('jsonl')}>
                    <FileDown className="size-4" />
                    {t('experiments.action.exportJsonl')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {buttons.map((btn) => (
                <Button
                  key={btn.action}
                  type="button"
                  variant={btn.variant}
                  size="sm"
                  className={cn(
                    'h-9 gap-1',
                    btn.destructive && 'border-destructive/40 text-destructive hover:text-destructive',
                  )}
                  disabled={controlExperiment.isPending}
                  onClick={() => handleControl(btn.action)}
                >
                  {btn.icon}
                  {t(btn.labelKey)}
                  {inProgressAction === btn.action && '…'}
                </Button>
              ))}
            </div>
          </div>

          <FailureBanner detail={detail} />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <section className="rounded-lg border bg-card">
                <div className="border-b px-4 py-3">
                  <h2 className="text-[13px] font-semibold">{t('experiments.detail.progress')}</h2>
                </div>
                <div className="space-y-3 p-5">
                  <Progress
                    value={detail.processedSamples}
                    max={Math.max(1, detail.totalSamples)}
                    label={progressLabel}
                  />
                  <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                    <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] text-muted-foreground">
                      <span>
                        {t('experiments.detail.totalSamples')}{' '}
                        <span className="text-foreground">{detail.totalSamples}</span>
                      </span>
                      <span>
                        {t('experiments.detail.processedSamples')}{' '}
                        <span className="text-foreground">{detail.processedSamples}</span>
                      </span>
                      <span className={cn(detail.failedSamples > 0 && experimentTone.danger.text)}>
                        {t('experiments.detail.failedSamples')}{' '}
                        <span className="text-foreground">{detail.failedSamples}</span>
                      </span>
                    </div>
                    <ExperimentTimingSubtitle detail={detail} className="ml-auto" />
                  </div>
                </div>
              </section>

              <section>
                <h2 className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('experiments.detail.engineering')}
                </h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <MetricCard
                    label={t('experiments.detail.metricTokensLabel')}
                    value={formatNumber(totalTokens)}
                    detail={formatTemplate(t('experiments.detail.metricTokensSplit'), {
                      input: formatNumber(inputTokens),
                      output: formatNumber(outputTokens),
                    })}
                    highlight
                  />
                  <MetricCard label={t('experiments.detail.metricCostLabel')} value={`$${costEstimate.toFixed(4)}`} />
                  <MetricCard
                    label={t('experiments.detail.metricFailures')}
                    value={String(detail.failedSamples)}
                    tone={detail.failedSamples > 0 ? 'destructive' : undefined}
                  />
                  <MetricCard
                    label={t('experiments.detail.metricLatencyLabel')}
                    value={formatLatencySeconds(detail.metrics?.averageLatencyMs)}
                    unit="s"
                    detail={formatTemplate(t('experiments.detail.metricLatencySplit'), {
                      p50: formatLatencySeconds(detail.metrics?.p50LatencyMs),
                      p95: formatLatencySeconds(detail.metrics?.p95LatencyMs),
                    })}
                  />
                </div>
              </section>

              <section className="rounded-lg border bg-card">
                <div className="border-b px-4 py-3">
                  <h2 className="text-[13px] font-semibold">{t('experiments.detail.quality')}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/60 text-left font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2">{t('experiments.detail.classHeader.category')}</th>
                        <th className="px-3 py-2">{t('experiments.detail.classHeader.samples')}</th>
                        <th className="px-3 py-2">{t('experiments.detail.classHeader.accuracy')}</th>
                        <th className="px-3 py-2">{t('experiments.detail.classHeader.precision')}</th>
                        <th className="px-3 py-2">{t('experiments.detail.classHeader.recall')}</th>
                        <th className="px-3 py-2">{t('experiments.detail.classHeader.f1')}</th>
                        <th className="px-3 py-2">{t('experiments.detail.classHeader.confusion')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b bg-primary/5">
                        <td className="px-3 py-2 font-semibold">{t('experiments.detail.classOverall')}</td>
                        <td className="px-3 py-2 font-mono text-[12.5px]">{detail.processedSamples}</td>
                        <td className="px-3 py-2 font-mono text-[12.5px] tabular-nums">
                          {Number.isFinite(accuracy) ? accuracy.toFixed(3) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12.5px] tabular-nums">
                          {Number.isFinite(precision) ? precision.toFixed(3) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12.5px] tabular-nums">
                          {Number.isFinite(recall) ? recall.toFixed(3) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12.5px] tabular-nums">
                          {Number.isFinite(f1) ? f1.toFixed(3) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <MiniBar correct={failedCorrect} wrong={detail.failedSamples} />
                        </td>
                      </tr>
                      {perClass.map((row) => (
                        <tr key={row.label} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-mono text-[11.5px]">{row.label}</td>
                          <td className="px-3 py-2 font-mono text-[12.5px]">{row.support}</td>
                          <td className="px-3 py-2 font-mono text-[12.5px] text-muted-foreground">—</td>
                          <td className="px-3 py-2 font-mono text-[12.5px] tabular-nums">
                            {row.precision !== null ? row.precision.toFixed(3) : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[12.5px] tabular-nums">
                            {row.recall !== null ? row.recall.toFixed(3) : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[12.5px] tabular-nums">
                            {row.f1 !== null ? row.f1.toFixed(3) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {typeof row.tp === 'number' && typeof row.fn === 'number' ? (
                              <MiniBar correct={row.tp} wrong={row.fn} />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {perClass.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-4 text-center text-[11.5px] text-muted-foreground">
                            {t('experiments.detail.quality.noPerClass')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <aside className="flex flex-col gap-3 xl:sticky xl:top-20">
              <section className="rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <span className="text-[13px] font-semibold">{t('experiments.detail.spec')}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('experiments.detail.specCopy')}
                    onClick={() => {
                      if (typeof navigator !== 'undefined') {
                        void navigator.clipboard.writeText(JSON.stringify(detail.runConfig, null, 2));
                      }
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <div className="space-y-5 px-4 py-3 font-mono text-[12px]">
                  <div>
                    <div className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('experiments.detail.spec.essentials')}
                    </div>
                    <div className="space-y-1.5">
                      <SpecLine
                        label={t('experiments.detail.spec.prompt')}
                        value={
                          <span className="inline-flex items-center gap-1.5 break-all">
                            <Link
                              href={`/prompts/${detail.promptId}?version=${detail.promptVersionId}`}
                              className="hover:underline"
                            >
                              {`${detail.promptName} ${detail.promptVersionLabel}`}
                            </Link>
                            <ModalityIconGroup
                              kinds={derivePromptModalityKinds(detail.promptVariableTypes ?? [])}
                              size="sm"
                              tooltips={{
                                text: t('experiments.promptModality.text'),
                                image: t('experiments.promptModality.image'),
                                number: t('experiments.promptModality.number'),
                              }}
                              ariaLabels={{
                                text: t('experiments.promptModality.text'),
                                image: t('experiments.promptModality.image'),
                                number: t('experiments.promptModality.number'),
                              }}
                            />
                          </span>
                        }
                      />
                      <SpecLine
                        label={t('experiments.detail.spec.dataset')}
                        value={
                          <span className="inline-flex items-center gap-1.5 break-all">
                            <span>
                              <Link
                                href={`/datasets/${detail.datasetId}`}
                                className="hover:underline"
                              >
                                {detail.datasetName}
                              </Link>
                              {` · ${formatNumber(detail.datasetSamples)}`}
                            </span>
                            <ModalityIconGroup
                              kinds={detail.datasetModalities ?? []}
                              size="sm"
                              tooltips={{
                                text: t('experiments.datasetModality.text'),
                                image: t('experiments.datasetModality.image'),
                              }}
                              ariaLabels={{
                                text: t('experiments.datasetModality.text'),
                                image: t('experiments.datasetModality.image'),
                              }}
                            />
                          </span>
                        }
                      />
                      <SpecLine
                        label={t('experiments.detail.spec.model')}
                        value={
                          <Link
                            href={`/models/${detail.modelId}/edit`}
                            className="break-all hover:underline"
                          >
                            {detail.modelName}
                          </Link>
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('experiments.detail.spec.runParams')}
                    </div>
                    <div className="space-y-1.5">
                      <SpecLine
                        label={t('experiments.detail.spec.temperature')}
                        value={detail.runConfig.temperature?.toFixed(1) ?? '-'}
                      />
                      <SpecLine
                        label={t('experiments.detail.spec.concurrency')}
                        value={String(detail.runConfig.concurrency ?? '-')}
                      />
                      <SpecLine
                        label={t('experiments.detail.spec.rpmTpm')}
                        value={`${detail.runConfig.rpmLimit ?? '-'} / ${
                          detail.runConfig.tpmLimit ? `${detail.runConfig.tpmLimit / 1000}K` : '-'
                        }`}
                      />
                      <SpecLine
                        label={t('experiments.detail.spec.timeout')}
                        value={
                          detail.runConfig.sampleTimeoutSeconds ? `${detail.runConfig.sampleTimeoutSeconds} s` : '-'
                        }
                      />
                      <SpecLine
                        label={t('experiments.detail.spec.retries')}
                        value={
                          detail.runConfig.retries !== undefined
                            ? formatTemplate(t('experiments.detail.spec.retriesUnit'), {
                                count: detail.runConfig.retries,
                              })
                            : '-'
                        }
                      />
                    </div>
                  </div>
                </div>
              </section>
            </aside>
          </div>

          <SampleResultsSection
            detail={detail}
            projectId={projectId}
            experimentId={experimentId}
            onOpenDetail={setSelectedRunResultId}
          />
        </div>
      </TooltipProvider>

      <RunResultDetailSheet
        projectId={projectId}
        experimentId={experimentId}
        runResultId={selectedRunResultId}
        onClose={() => setSelectedRunResultId(null)}
      />
    </Main>
  );
}
