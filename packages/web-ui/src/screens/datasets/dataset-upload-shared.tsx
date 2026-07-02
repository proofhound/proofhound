'use client';

import { type ChangeEvent, type DragEvent, type KeyboardEvent, type RefObject, type ReactNode } from 'react';
import type { DatasetFieldRole, DatasetImportSourceFormat } from '@proofhound/shared';
import { AlertTriangle, ChevronLeft, ChevronRight, FileText, Upload } from 'lucide-react';
import { Button, Progress, formatProgressLabel, cn } from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../../i18n';
import { RoleArrowLabel, RolePill } from './dataset-ui';
import {
  FORMAT_CHIPS,
  PREVIEW_LIMIT,
  getDatasetPreviewPage,
  getDisplayValue,
  getUploadFilePath,
  selectDatasetFile,
  type ParsedDatasetFile,
} from './dataset-upload-parser';

export const ROLE_OPTIONS: Array<{ role: DatasetFieldRole; labelKey: TranslationKey }> = [
  { role: 'id', labelKey: 'datasets.role.id' },
  { role: 'text', labelKey: 'datasets.role.text' },
  { role: 'image', labelKey: 'datasets.role.image' },
  { role: 'expected', labelKey: 'datasets.role.expected' },
  { role: 'metadata', labelKey: 'datasets.role.metadata' },
];

// Files larger than this are not parsed whole on selection: only a head prefix is read for preview.
export const PREVIEW_PREFIX_MAX_BYTES = 1024 * 1024;

export function normalizeExpectedRoles(
  roles: Record<string, DatasetFieldRole>,
  preferredColumn?: string,
): Record<string, DatasetFieldRole> {
  let expectedColumn: string | null = preferredColumn && roles[preferredColumn] === 'expected' ? preferredColumn : null;

  if (!expectedColumn) {
    expectedColumn = Object.entries(roles).find(([, role]) => role === 'expected')?.[0] ?? null;
  }

  return Object.fromEntries(
    Object.entries(roles).map(([column, role]) => [
      column,
      role === 'expected' && column !== expectedColumn ? 'metadata' : role,
    ]),
  );
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatByteLimit(bytes: number) {
  if (bytes < 1024 * 1024 * 1024) return formatFileSize(bytes);
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function getDatasetUploadParseErrorKey(parseError: string | null): TranslationKey {
  if (parseError === 'unsupported_file_type') return 'datasets.upload.unsupportedFile';
  if (parseError === 'large_requires_streaming_format') return 'datasets.upload.largeRequiresStreamingFormat';
  if (parseError === 'zip_file_too_large') return 'datasets.upload.zipFileTooLarge';
  if (parseError === 'file_too_large') return 'datasets.upload.fileTooLarge';
  if (parseError === 'single_file_only') return 'datasets.upload.singleFileOnly';
  return 'datasets.upload.parseFailed';
}

export function getDatasetUploadParseErrorMessage(
  t: (key: TranslationKey) => string,
  parseError: string | null,
  maxBytes: number,
) {
  const key = getDatasetUploadParseErrorKey(parseError);
  if (parseError === 'zip_file_too_large') return formatTemplate(t(key), { zipLimit: formatByteLimit(maxBytes) });
  if (parseError === 'file_too_large') return formatTemplate(t(key), { maxLimit: formatByteLimit(maxBytes) });
  return t(key);
}

export function getDatasetUploadFileSizeError(file: Pick<File, 'name' | 'size'>, maxBytes: number) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.zip') && file.size > maxBytes) return 'zip_file_too_large';
  if (file.size > maxBytes) return 'file_too_large';
  return null;
}

export function droppedSelectionContainsDirectory(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.items).some((item) => {
    const getEntry = (item as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry;
    return getEntry?.call(item)?.isDirectory === true;
  });
}

export function getDroppedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.files);
}

export async function selectSingleDatasetUploadFile(files: File[]): Promise<File> {
  if (files.length !== 1) throw new Error('single_file_only');
  return selectDatasetFile(files);
}

export function toUploadSourceFormat(fileName: string): DatasetImportSourceFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.zip')) return 'zip';
  return 'jsonl';
}

export function DatasetUploadParseErrorBanner({
  parseError,
  maxBytes,
  className,
}: {
  parseError: string | null;
  maxBytes: number;
  className?: string;
}) {
  const { t } = useI18n();
  if (!parseError) return null;

  return (
    <div
      className={cn(
        'flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-[12px] text-destructive',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>{getDatasetUploadParseErrorMessage(t, parseError, maxBytes)}</div>
    </div>
  );
}

export function DatasetUploadFileDropzone({
  fileInputId,
  fileInputRef,
  selectedFile,
  parsedFile,
  isDragOver,
  progressValue,
  sampleCountLabel,
  statusLabel,
  disabled = false,
  onOpenFilePicker,
  onFileInputChange,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  selectedFile: File | null;
  parsedFile: ParsedDatasetFile | null;
  isDragOver: boolean;
  progressValue: number;
  sampleCountLabel: string;
  statusLabel?: string;
  disabled?: boolean;
  onOpenFilePicker: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void | Promise<void>;
}) {
  const { t } = useI18n();

  const openFilePicker = () => {
    if (disabled) return;
    onOpenFilePicker();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFilePicker();
  };

  return (
    <div
      className={cn(
        'block cursor-pointer rounded-lg border border-dashed border-[var(--status-running-bd)] bg-[var(--status-running-bg)]/45 p-4 transition-colors hover:bg-[var(--status-running-bg)]/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        isDragOver && 'border-primary bg-primary/10',
        disabled && 'cursor-not-allowed opacity-65 hover:bg-[var(--status-running-bg)]/45',
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={selectedFile ? t('datasets.action.replaceFile') : t('datasets.upload.chooseFile')}
      aria-disabled={disabled}
      onClick={openFilePicker}
      onKeyDown={handleKeyDown}
      onDragEnter={disabled ? undefined : onDragEnter}
      onDragOver={disabled ? undefined : onDragOver}
      onDragLeave={disabled ? undefined : onDragLeave}
      onDrop={disabled ? undefined : onDrop}
    >
      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        accept={FORMAT_CHIPS.join(',')}
        className="sr-only"
        disabled={disabled}
        onChange={onFileInputChange}
      />
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--status-running-bg)] text-[var(--status-running-fg)]">
          {selectedFile ? <FileText className="size-5" /> : <Upload className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">
              {selectedFile ? getUploadFilePath(selectedFile) : t('datasets.upload.chooseFile')}
            </span>
            {selectedFile && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatFileSize(selectedFile.size)} · {selectedFile.type || t('datasets.upload.unknownType')}
              </span>
            )}
            {parsedFile && (
              <span className="status-running ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium">
                <span className="dot-running size-1.5 rounded-full" />
                {t('datasets.upload.parsed')}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
            {parsedFile
              ? `${sampleCountLabel} · ${parsedFile.columns.length} ${t('datasets.detail.fields')}`
              : t('datasets.upload.chooseFileHelp')}
          </div>
          <Progress
            value={progressValue}
            label={formatProgressLabel({ value: progressValue, max: 100 })}
            className="mt-2"
          />
          <div className="mt-1.5 flex items-center gap-3">
            <span className="font-mono text-[10.5px] text-[var(--status-running-fg)]">
              {statusLabel ??
                (parsedFile
                  ? t('datasets.upload.uploadReady')
                  : isDragOver
                    ? t('datasets.upload.dropHere')
                    : t('datasets.upload.waitingForFile'))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DatasetPreviewAndMappingPanel({
  parsedFile,
  fieldRoles,
  selectedFields,
  previewPageIndex,
  sampleCountLabel,
  emptyLabel,
  isLargeFile = false,
  showFieldSelection = true,
  onPreviewPageIndexChange,
  onRoleChange,
  onSelectedFieldChange,
}: {
  parsedFile: ParsedDatasetFile | null;
  fieldRoles: Record<string, DatasetFieldRole>;
  selectedFields?: Record<string, boolean>;
  previewPageIndex: number;
  sampleCountLabel: string;
  emptyLabel: ReactNode;
  isLargeFile?: boolean;
  showFieldSelection?: boolean;
  onPreviewPageIndexChange: (pageIndex: number) => void;
  onRoleChange: (column: string, role: DatasetFieldRole) => void;
  onSelectedFieldChange?: (column: string, selected: boolean) => void;
}) {
  const { t } = useI18n();

  if (!parsedFile) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const previewRows = parsedFile.samples.slice(0, PREVIEW_LIMIT);
  const previewPage = getDatasetPreviewPage(previewRows, previewPageIndex);
  const isSelected = (column: string) => (selectedFields ? (selectedFields[column] ?? false) : true);
  const selectedColumns = parsedFile.columns.filter(isSelected);
  const gridColumns = showFieldSelection
    ? 'grid-cols-[44px_96px_minmax(0,1fr)_minmax(0,1.2fr)_200px]'
    : 'grid-cols-[44px_minmax(0,1fr)_minmax(0,1.2fr)_200px]';

  return (
    <div className="-m-4">
      <div className="border-b">
        <div className="flex flex-col gap-2 bg-muted/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{t('datasets.upload.samplePreview')}</span>
            <span className="text-[11px] text-muted-foreground">{t('datasets.upload.samplePreviewHint')}</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">{t('datasets.upload.fieldRoleHint')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-left text-xs font-medium text-muted-foreground">
                {parsedFile.columns.map((column) => (
                  <th key={column} className={cn('px-3 py-3', !isSelected(column) && 'opacity-45')}>
                    <div className="flex flex-col">
                      <span>{column}</span>
                      {isSelected(column) ? (
                        <RoleArrowLabel role={fieldRoles[column] ?? 'metadata'} />
                      ) : (
                        <span className="font-mono text-[10px] font-normal text-muted-foreground">
                          {'->'} {t('datasets.upload.notImported')}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewPage.rows.map((row, index) => (
                <tr key={previewPage.rangeStart + index - 1} className="border-b last:border-b-0 hover:bg-muted/35">
                  {parsedFile.columns.map((column) => (
                    <td key={column} className="max-w-[280px] truncate px-3 py-3 font-mono text-[12px]">
                      {getDisplayValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('common.previousPage')}
              disabled={!previewPage.canGoPrevious}
              onClick={() => onPreviewPageIndexChange(Math.max(0, previewPage.pageIndex - 1))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="font-mono">
              {previewPage.rangeStart}-{previewPage.rangeEnd} / {previewPage.totalRows}{' '}
              {isLargeFile ? `· ${t('datasets.upload.previewPrefixOnly')}` : null}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('common.nextPage')}
              disabled={!previewPage.canGoNext}
              onClick={() => onPreviewPageIndexChange(Math.min(previewPage.pageCount - 1, previewPage.pageIndex + 1))}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
          <span className="font-mono text-[11.5px]">
            {sampleCountLabel} · {selectedColumns.length} {t('datasets.detail.fields')}{' '}
            {selectedColumns.length > 0 ? t('datasets.upload.readyToImport') : t('datasets.upload.noSelectedFields')}
          </span>
        </div>
      </div>

      <div>
        <div className="flex flex-col gap-2 bg-muted/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{t('datasets.upload.fieldMapping')}</span>
            <span className="text-[11px] text-muted-foreground">{t('datasets.upload.fieldMappingHint')}</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('datasets.upload.selectedFields')}: {selectedColumns.length} / {parsedFile.columns.length}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {ROLE_OPTIONS.map((option) => (
              <RolePill key={option.role} role={option.role} />
            ))}
          </div>
        </div>
        <div
          className={cn('grid border-t bg-muted/60 px-4 py-2.5 text-xs font-medium text-muted-foreground', gridColumns)}
        >
          <div>#</div>
          {showFieldSelection && <div>{t('datasets.upload.importField')}</div>}
          <div>{t('datasets.upload.originalColumn')}</div>
          <div>{t('datasets.upload.firstRow')}</div>
          <div>{t('datasets.upload.role')}</div>
        </div>
        {parsedFile.columns.map((column, index) => {
          const selected = isSelected(column);
          return (
            <div
              key={column}
              className={cn(
                'grid items-center border-t px-4 py-3 text-sm',
                gridColumns,
                !selected && 'bg-muted/25 text-muted-foreground',
              )}
            >
              <span className="flex size-6 items-center justify-center rounded bg-muted font-mono text-[11px] text-muted-foreground">
                {index + 1}
              </span>
              {showFieldSelection && (
                <label className="inline-flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => onSelectedFieldChange?.(column, event.target.checked)}
                    className="size-4 accent-primary"
                    aria-label={`${t('datasets.upload.importField')}: ${column}`}
                  />
                  {selected ? t('datasets.upload.importField') : t('datasets.upload.notImported')}
                </label>
              )}
              <div className="min-w-0">
                <div className="truncate font-mono text-[12.5px] font-semibold">{column}</div>
              </div>
              <div className="truncate rounded-md bg-muted/45 px-2 py-1 font-mono text-[11.5px] text-muted-foreground">
                {getDisplayValue(parsedFile.samples[0]?.[column])}
              </div>
              <select
                value={fieldRoles[column] ?? 'metadata'}
                onChange={(event) => onRoleChange(column, event.target.value as DatasetFieldRole)}
                disabled={!selected}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${t('datasets.upload.role')}: ${column}`}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.role} value={option.role}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
