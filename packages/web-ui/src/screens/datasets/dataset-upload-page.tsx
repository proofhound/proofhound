'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  DATASET_IMPORT_MAX_FILE_BYTES,
  DATASET_IMPORT_ZIP_MAX_FILE_BYTES,
  type CreateDatasetDto,
  type CreateDatasetImportDto,
  type DatasetFieldRole,
} from '@proofhound/shared';
import { datasetImportClient } from '@proofhound/api-client';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Info,
  Loader2,
  Upload,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Progress,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  formatProgressLabel,
  cn,
} from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useI18n, type TranslationKey } from '../../i18n';
import { projectSampleRowsToBatches, runDatasetImport } from './dataset-import-runner';
import { DatasetTransferProgressPanel, useDatasetTransferProgress } from './dataset-transfer-progress';
import { RoleArrowLabel, RolePill } from './dataset-ui';
import {
  FORMAT_CHIPS,
  getDatasetImportSourceFormat,
  getDatasetNameFromFile,
  getDatasetPreviewPage,
  getDisplayValue,
  getUploadFilePath,
  inferRole,
  isStreamingImportFile,
  parseDatasetPreview,
  parseDatasetFile,
  selectDatasetFile,
  streamDatasetRows,
  type ParsedDatasetFile,
} from './dataset-upload-parser';
import {
  createDatasetUploadUppy,
  replaceDatasetUploadUppyFiles,
  useDatasetUploadUppyFileCount,
} from './dataset-upload-uppy';

const ROLE_OPTIONS: Array<{ role: DatasetFieldRole; labelKey: TranslationKey }> = [
  { role: 'id', labelKey: 'datasets.role.id' },
  { role: 'text', labelKey: 'datasets.role.text' },
  { role: 'image', labelKey: 'datasets.role.image' },
  { role: 'expected', labelKey: 'datasets.role.expected' },
  { role: 'metadata', labelKey: 'datasets.role.metadata' },
];

const directoryInputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;

export const DATASET_IMAGE_SAMPLE_DOWNLOADS: Array<{
  labelKey: TranslationKey;
  href: string;
  fileName: string;
}> = [
  {
    labelKey: 'datasets.upload.imageSamples.urlFields',
    href: '/examples/datasets/images/image-url-fields.csv',
    fileName: 'proofhound-image-url-fields.csv',
  },
  {
    labelKey: 'datasets.upload.imageSamples.urlArray',
    href: '/examples/datasets/images/image-url-array.csv',
    fileName: 'proofhound-image-url-array.csv',
  },
  {
    labelKey: 'datasets.upload.imageSamples.base64',
    href: '/examples/datasets/images/image-base64.jsonl',
    fileName: 'proofhound-image-base64.jsonl',
  },
  {
    labelKey: 'datasets.upload.imageSamples.zip',
    href: '/examples/datasets/images/image-zip-relative-paths.zip',
    fileName: 'proofhound-image-zip-relative-paths.zip',
  },
];

function normalizeExpectedRoles(
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
  className,
}: {
  number: number;
  title: string;
  hint: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <SectionNumber value={number} />
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        <span className="ml-auto text-[11.5px] text-muted-foreground">{hint}</span>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatByteLimit(bytes: number) {
  if (bytes < 1024 * 1024 * 1024) return formatFileSize(bytes);
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function withRelativePath(file: File, relativePath: string) {
  Object.defineProperty(file, 'proofhoundRelativePath', {
    configurable: true,
    value: relativePath,
  });
  return file;
}

function readFileEntry(entry: FileSystemFileEntry, relativePath: string) {
  return new Promise<File>((resolve, reject) => {
    entry.file((file) => resolve(withRelativePath(file, relativePath)), reject);
  });
}

async function readDirectoryEntry(entry: FileSystemDirectoryEntry, parentPath: string): Promise<File[]> {
  const reader = entry.createReader();
  const entries: FileSystemEntry[] = [];

  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }

  const nestedFiles = await Promise.all(entries.map((item) => readEntryFiles(item, `${parentPath}${entry.name}/`)));
  return nestedFiles.flat();
}

function readEntryFiles(entry: FileSystemEntry, parentPath = ''): Promise<File[]> {
  if (entry.isFile) {
    return readFileEntry(entry as FileSystemFileEntry, `${parentPath}${entry.name}`).then((file) => [file]);
  }

  if (entry.isDirectory) {
    return readDirectoryEntry(entry as FileSystemDirectoryEntry, parentPath);
  }

  return Promise.resolve([]);
}

async function getDroppedFiles(dataTransfer: DataTransfer) {
  const entries = Array.from(dataTransfer.items)
    .map((item) => {
      const getEntry = (item as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry;
      return getEntry?.call(item) ?? null;
    })
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return Array.from(dataTransfer.files);
  }

  const files = await Promise.all(entries.map((entry) => readEntryFiles(entry)));
  const flattenedFiles = files.flat();
  return flattenedFiles.length > 0 ? flattenedFiles : Array.from(dataTransfer.files);
}

function getParseErrorKey(parseError: string | null): TranslationKey {
  if (parseError === 'unsupported_file_type') return 'datasets.upload.unsupportedFile';
  if (parseError === 'large_requires_streaming_format') return 'datasets.upload.largeRequiresStreamingFormat';
  if (parseError === 'zip_file_too_large') return 'datasets.upload.zipFileTooLarge';
  if (parseError === 'file_too_large') return 'datasets.upload.fileTooLarge';
  return 'datasets.upload.parseFailed';
}

export function estimateUploadProgressBytes(sourceFile: CreateDatasetDto['uploadSource']) {
  return Math.max(1, sourceFile.fileSizeBytes);
}

const BUFFERED_IMPORT_MAX_BYTES = DATASET_IMPORT_ZIP_MAX_FILE_BYTES;
const IMPORT_BATCH_SIZE = 1000;
const DATASET_IMPORT_DEBUG_PREFIX = '[dataset-import-debug]';
const DATASET_IMPORT_DEBUG_BYTE_INTERVAL = 64 * 1024 * 1024;

export type DatasetUploadImportPath = 'buffered' | 'streaming';

function isStreamingImportFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.jsonl') || lower.endsWith('.csv') || lower.endsWith('.tsv');
}

export function selectDatasetUploadImportPath({
  file,
}: {
  file: Pick<File, 'name' | 'size'>;
}): DatasetUploadImportPath {
  return isStreamingImportFileName(file.name) ? 'streaming' : 'buffered';
}

function getDatasetUploadFileSizeError(file: Pick<File, 'name' | 'size'>) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.zip') && file.size > DATASET_IMPORT_ZIP_MAX_FILE_BYTES) return 'zip_file_too_large';
  if (file.size > DATASET_IMPORT_MAX_FILE_BYTES) return 'file_too_large';
  return null;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function debugDatasetImport(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.warn(DATASET_IMPORT_DEBUG_PREFIX, event, {
      at: new Date().toISOString(),
      ...data,
    });
  } catch {
    // Temporary diagnostics must never affect upload behavior.
  }
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new DOMException('aborted', 'AbortError');
}

export async function* projectBufferedSampleBatches(
  samples: Array<Record<string, unknown>>,
  columns: string[],
  size: number,
  signal?: AbortSignal,
) {
  async function* rows() {
    for (let index = 0; index < samples.length; index += 1) {
      throwIfAborted(signal);
      if (index > 0 && index % size === 0) await yieldToBrowser();
      throwIfAborted(signal);
      yield samples[index] ?? {};
    }
  }

  yield* projectSampleRowsToBatches(rows(), columns, { maxRows: size, signal });
}

// Streams a large JSONL/CSV/TSV file off disk, projecting each batch to the selected columns before upload.
async function* projectedStreamingFileBatches(
  file: File,
  columns: string[],
  size: number,
  onBytes: (readBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
) {
  yield* projectSampleRowsToBatches(streamDatasetRows(file, onBytes, signal), columns, { maxRows: size, signal });
}

function UploadLimitInfoIcon() {
  const { t } = useI18n();
  const maxLimit = formatByteLimit(DATASET_IMPORT_MAX_FILE_BYTES);
  const bufferedLimit = formatByteLimit(BUFFERED_IMPORT_MAX_BYTES);

  return (
    <TooltipProvider delayDuration={140}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('datasets.upload.limitInfoLabel')}
            data-testid="dataset-upload-limit-info"
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[340px] text-left">
          <div className="text-[11.5px] font-semibold">{t('datasets.upload.limitInfoTitle')}</div>
          <div className="mt-1.5 space-y-1 text-[11px] leading-relaxed">
            <p>
              {formatTemplate(t('datasets.upload.limitInfoPreview'), {
                maxLimit,
              })}
            </p>
            <p>{t('datasets.upload.limitInfoStreaming')}</p>
            <p>
              {formatTemplate(t('datasets.upload.limitInfoBuffered'), {
                bufferedLimit,
              })}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ImageSampleDownloads() {
  const { t } = useI18n();

  return (
    <div className="border-t pt-3" data-testid="dataset-upload-image-samples">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[12px] font-semibold">{t('datasets.upload.imageSamples.title')}</div>
        <div className="text-[11.5px] text-muted-foreground">{t('datasets.upload.imageSamples.hint')}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {DATASET_IMAGE_SAMPLE_DOWNLOADS.map((sample) => {
          const label = t(sample.labelKey);
          return (
            <a
              key={sample.href}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted"
              href={sample.href}
              download={sample.fileName}
              aria-label={formatTemplate(t('datasets.upload.imageSamples.downloadAria'), { name: label })}
              data-testid={`dataset-image-sample-${sample.fileName}`}
            >
              <Download className="size-3.5" />
              {label}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function DatasetUploadPage({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const uploadProgress = useDatasetTransferProgress();
  const [uppy] = useState(() => createDatasetUploadUppy());
  const uppyFileCount = useDatasetUploadUppyFileCount(uppy);
  const fileInputId = useId();
  const folderInputId = useId();
  const [datasetName, setDatasetName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDatasetFile | null>(null);
  const [fieldRoles, setFieldRoles] = useState<Record<string, DatasetFieldRole>>({});
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [importError, setImportError] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [usesStreamingImport, setUsesStreamingImport] = useState(false);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const importAbortRef = useRef<AbortController | null>(null);
  const importIdRef = useRef<string | null>(null);
  const abortOnLeaveRef = useRef(false);
  const finalizeTimersRef = useRef<number[]>([]);
  const leaveActionRef = useRef<(() => void) | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  // Before import completion, leaving cancels the client-driven batch session and clears staging.
  useEffect(
    () => () => {
      if (abortOnLeaveRef.current) importAbortRef.current?.abort();
      finalizeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      finalizeTimersRef.current = [];
      uppy.destroy();
    },
    [uppy],
  );

  // While an import is in flight, guard every way to leave so the user is warned before losing it.
  useEffect(() => {
    if (!isImporting) return undefined;

    // Tab close / refresh / hard URL change: only the browser's native prompt is possible here.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    // The page is actually being torn down (prompt resolved in favor of leaving). A normal fetch
    // would be cancelled mid-flight, so use sendBeacon to tell the server to clear staging rows.
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return; // bfcache: page may be restored, keep the session alive.
      const importId = importIdRef.current;
      if (importId) datasetImportClient.abortDatasetImportBeacon(projectId, importId);
    };

    const promptLeave = (action: () => void) => {
      leaveActionRef.current = action;
      setLeaveDialogOpen(true);
    };

    // In-app link navigation (sidebar / breadcrumb / cancel / etc.): intercept and show a custom dialog.
    const onClickCapture = (event: MouseEvent) => {
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
      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      const href = anchor?.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      event.preventDefault();
      event.stopPropagation();
      promptLeave(() => router.push(href));
    };

    // Browser back / forward: re-pin the current entry, then prompt.
    const onPopState = () => {
      window.history.pushState(null, '', window.location.href);
      promptLeave(() => router.push(`/datasets`));
    };

    window.history.pushState(null, '', window.location.href);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [isImporting, router, projectId]);

  const confirmLeaveImport = () => {
    setLeaveDialogOpen(false);
    if (abortOnLeaveRef.current) importAbortRef.current?.abort();
    setIsImporting(false);
    const action = leaveActionRef.current;
    leaveActionRef.current = null;
    action?.();
  };

  const cancelLeaveImport = () => {
    setLeaveDialogOpen(false);
    leaveActionRef.current = null;
  };

  const previewPage = useMemo(
    () => getDatasetPreviewPage(parsedFile?.samples ?? [], previewPageIndex),
    [parsedFile, previewPageIndex],
  );
  const previewRows = previewPage.rows;
  const selectedColumns = useMemo(
    () => parsedFile?.columns.filter((column) => selectedFields[column]) ?? [],
    [parsedFile, selectedFields],
  );
  const isSubmitting = isImporting;
  const canImport =
    projectId.length > 0 &&
    datasetName.trim().length > 0 &&
    parsedFile !== null &&
    selectedColumns.length > 0 &&
    !isSubmitting;
  const parseErrorKey = getParseErrorKey(parseError);
  // Streaming imports keep only preview rows in state, so show an import-time count label instead of a fake total.
  const sampleCountLabel = usesStreamingImport
    ? t('datasets.upload.streamingFile')
    : `${parsedFile?.samples.length ?? 0} ${t('datasets.samples')}`;
  const importButtonLabel = parsedFile
    ? `${t('datasets.upload.importRows')} (${sampleCountLabel} · ${selectedColumns.length} ${t('datasets.detail.fields')})`
    : t('datasets.upload.importRows');
  const parseErrorMessage =
    parseError === 'zip_file_too_large'
      ? formatTemplate(t(parseErrorKey), { zipLimit: formatByteLimit(DATASET_IMPORT_ZIP_MAX_FILE_BYTES) })
      : parseError === 'file_too_large'
        ? formatTemplate(t(parseErrorKey), { maxLimit: formatByteLimit(DATASET_IMPORT_MAX_FILE_BYTES) })
        : t(parseErrorKey);

  const updateFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const startedAt = nowMs();
    debugDatasetImport('webUi.datasetUpload.updateFiles.start', {
      fileCount: files.length,
      files: files.map((file) => ({ name: file.name, size: file.size, type: file.type || null })),
    });

    setSelectedFile(null);
    setParsedFile(null);
    setParseError(null);
    setImportError(false);
    setUsesStreamingImport(false);
    setPreviewPageIndex(0);
    uploadProgress.reset();

    try {
      const normalizedFiles = replaceDatasetUploadUppyFiles(uppy, files);
      const file = await selectDatasetFile(normalizedFiles);
      debugDatasetImport('webUi.datasetUpload.file.selected', {
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: file.name,
        fileSizeBytes: file.size,
        type: file.type || null,
      });
      const fileSizeError = getDatasetUploadFileSizeError(file);
      if (fileSizeError) throw new Error(fileSizeError);
      const usesStreaming = isStreamingImportFile(file);
      if (!isStreamingImportFile(file) && file.size > BUFFERED_IMPORT_MAX_BYTES) {
        throw new Error('large_requires_streaming_format');
      }
      const parsed = await parseDatasetPreview(file);
      debugDatasetImport('webUi.datasetUpload.preview.done', {
        columnCount: parsed.columns.length,
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: file.name,
        previewRows: parsed.samples.length,
        usesStreaming,
      });
      setSelectedFile(file);
      setParsedFile(parsed);
      setUsesStreamingImport(usesStreaming);
      setFieldRoles(
        normalizeExpectedRoles(
          Object.fromEntries(parsed.columns.map((column) => [column, inferRole(column, parsed.samples[0]?.[column])])),
        ),
      );
      setSelectedFields(Object.fromEntries(parsed.columns.map((column) => [column, true])));
      setDatasetName((current) => current || getDatasetNameFromFile(file.name));
    } catch (error) {
      debugDatasetImport('webUi.datasetUpload.updateFiles.failed', {
        elapsedMs: Math.round(nowMs() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      setParseError(error instanceof Error ? error.message : 'parse_failed');
      setFieldRoles({});
      setSelectedFields({});
    }
  };

  const updateFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    await updateFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    await updateFiles(await getDroppedFiles(event.dataTransfer));
  };

  const importStreamingDataset = async (
    fieldMappings: CreateDatasetDto['fieldMappings'],
    sourceFile: CreateDatasetDto['uploadSource'],
    file: File,
  ) => {
    const startedAt = nowMs();
    const totalBytes = file.size;
    const createBody: CreateDatasetImportDto = {
      name: datasetName.trim(),
      description: description.trim() || null,
      fieldMappings,
      sourceFile,
      sourceFormat: getDatasetImportSourceFormat(sourceFile.fileName),
    };

    const controller = new AbortController();
    let lastProgressLogBytes = 0;
    let lastProgressLogAt = 0;
    const showFinalizeProgress = () => {
      debugDatasetImport('webUi.datasetUpload.streaming.finalize_progress.start', {
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: sourceFile.fileName,
        totalBytes,
      });
      finalizeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      finalizeTimersRef.current = [];
      uploadProgress.update({ loadedBytes: totalBytes, totalBytes });
      uploadProgress.setMessage(
        t('datasets.transfer.serverFinalizeTitle'),
        t('datasets.transfer.serverFinalizeDescription'),
      );
      finalizeTimersRef.current.push(
        window.setTimeout(() => {
          uploadProgress.setMessage(
            t('datasets.transfer.serverOffloadTitle'),
            t('datasets.transfer.serverOffloadDescription'),
          );
        }, 800),
        window.setTimeout(() => {
          uploadProgress.setMessage(
            t('datasets.transfer.serverCommitTitle'),
            t('datasets.transfer.serverCommitDescription'),
          );
        }, 2600),
      );
    };
    importAbortRef.current = controller;
    abortOnLeaveRef.current = true;
    setIsImporting(true);
    uploadProgress.start(
      t('datasets.transfer.streamingUploadTitle'),
      totalBytes,
      t('datasets.transfer.streamingUploadDescription'),
    );
    debugDatasetImport('webUi.datasetUpload.streaming.start', {
      fileName: sourceFile.fileName,
      fileSizeBytes: sourceFile.fileSizeBytes,
      projectId,
      selectedColumns: selectedColumns.length,
      sourceFormat: createBody.sourceFormat,
    });
    await yieldToBrowser();
    try {
      await runDatasetImport({
        projectId,
        createBody,
        batches: projectedStreamingFileBatches(
          file,
          selectedColumns,
          IMPORT_BATCH_SIZE,
          (readBytes) => {
            uploadProgress.update({ loadedBytes: readBytes, totalBytes });
            const now = nowMs();
            if (
              readBytes - lastProgressLogBytes >= DATASET_IMPORT_DEBUG_BYTE_INTERVAL ||
              now - lastProgressLogAt >= 1000 ||
              readBytes >= totalBytes
            ) {
              lastProgressLogBytes = readBytes;
              lastProgressLogAt = now;
              debugDatasetImport('webUi.datasetUpload.streaming.progress_update', {
                elapsedMs: Math.round(now - startedAt),
                fileName: sourceFile.fileName,
                loadedBytes: readBytes,
                totalBytes,
              });
            }
          },
          controller.signal,
        ),
        signal: controller.signal,
        onCreated: (id) => {
          importIdRef.current = id;
        },
        onProgress: ({ phase }) => {
          if (phase === 'completing') {
            showFinalizeProgress();
          }
        },
      });
      uploadProgress.complete(totalBytes);
      debugDatasetImport('webUi.datasetUpload.streaming.done', {
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: sourceFile.fileName,
        totalBytes,
      });
      router.push(`/datasets`);
    } catch (error) {
      debugDatasetImport('webUi.datasetUpload.streaming.failed', {
        elapsedMs: Math.round(nowMs() - startedAt),
        error: error instanceof Error ? error.message : String(error),
        fileName: sourceFile.fileName,
      });
      uploadProgress.fail();
      setImportError(true);
    } finally {
      setIsImporting(false);
      importAbortRef.current = null;
      importIdRef.current = null;
      abortOnLeaveRef.current = false;
      finalizeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      finalizeTimersRef.current = [];
    }
  };

  const importBufferedDataset = async (
    fieldMappings: CreateDatasetDto['fieldMappings'],
    sourceFile: CreateDatasetDto['uploadSource'],
    samples: Array<Record<string, unknown>>,
    columns: string[],
  ) => {
    const startedAt = nowMs();
    const totalRows = samples.length;
    const estimatedBytes = estimateUploadProgressBytes(sourceFile);
    const createBody: CreateDatasetImportDto = {
      name: datasetName.trim(),
      description: description.trim() || null,
      fieldMappings,
      sourceFile,
      sourceFormat: getDatasetImportSourceFormat(sourceFile.fileName),
      declaredTotalRows: totalRows,
    };

    const controller = new AbortController();
    const showFinalizeProgress = () => {
      debugDatasetImport('webUi.datasetUpload.buffered.finalize_progress.start', {
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: sourceFile.fileName,
        totalRows,
      });
      finalizeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      finalizeTimersRef.current = [];
      uploadProgress.update({ loadedBytes: estimatedBytes, totalBytes: estimatedBytes });
      uploadProgress.setMessage(
        t('datasets.transfer.serverFinalizeTitle'),
        t('datasets.transfer.serverFinalizeDescription'),
      );
      finalizeTimersRef.current.push(
        window.setTimeout(() => {
          uploadProgress.setMessage(
            t('datasets.transfer.serverOffloadTitle'),
            t('datasets.transfer.serverOffloadDescription'),
          );
        }, 800),
        window.setTimeout(() => {
          uploadProgress.setMessage(
            t('datasets.transfer.serverCommitTitle'),
            t('datasets.transfer.serverCommitDescription'),
          );
        }, 2600),
      );
    };
    importAbortRef.current = controller;
    abortOnLeaveRef.current = true;
    setIsImporting(true);
    uploadProgress.start(
      t('datasets.transfer.batchUploadTitle'),
      estimatedBytes,
      t('datasets.transfer.batchUploadDescription'),
    );
    debugDatasetImport('webUi.datasetUpload.buffered.start', {
      estimatedBytes,
      fileName: sourceFile.fileName,
      projectId,
      selectedColumns: columns.length,
      sourceFormat: createBody.sourceFormat,
      totalRows,
    });
    await yieldToBrowser();
    try {
      await runDatasetImport({
        projectId,
        createBody,
        batches: projectBufferedSampleBatches(samples, columns, IMPORT_BATCH_SIZE, controller.signal),
        signal: controller.signal,
        onCreated: (id) => {
          importIdRef.current = id;
        },
        onProgress: ({ phase, receivedRows }) => {
          if (phase === 'completing') {
            showFinalizeProgress();
          }
          uploadProgress.update({
            loadedBytes: totalRows > 0 ? Math.round((estimatedBytes * receivedRows) / totalRows) : estimatedBytes,
            totalBytes: estimatedBytes,
          });
        },
      });
      uploadProgress.complete(estimatedBytes);
      debugDatasetImport('webUi.datasetUpload.buffered.done', {
        elapsedMs: Math.round(nowMs() - startedAt),
        estimatedBytes,
        fileName: sourceFile.fileName,
        totalRows,
      });
      router.push(`/datasets`);
    } catch (error) {
      debugDatasetImport('webUi.datasetUpload.buffered.failed', {
        elapsedMs: Math.round(nowMs() - startedAt),
        error: error instanceof Error ? error.message : String(error),
        fileName: sourceFile.fileName,
      });
      uploadProgress.fail();
      setImportError(true);
    } finally {
      setIsImporting(false);
      importAbortRef.current = null;
      importIdRef.current = null;
      abortOnLeaveRef.current = false;
      finalizeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      finalizeTimersRef.current = [];
    }
  };

  const importDataset = async () => {
    const startedAt = nowMs();
    if (!parsedFile || !selectedFile || !canImport) {
      debugDatasetImport('webUi.datasetUpload.import_guard_blocked', {
        canImport,
        elapsedMs: Math.round(nowMs() - startedAt),
        hasParsedFile: Boolean(parsedFile),
        hasSelectedFile: Boolean(selectedFile),
        isSubmitting,
        selectedColumns: selectedColumns.length,
      });
      return;
    }

    const fieldMappings = selectedColumns.map((column) => ({
      name: column,
      role: fieldRoles[column] ?? 'metadata',
    }));
    const sourceFile: CreateDatasetDto['uploadSource'] = {
      fileName: getUploadFilePath(selectedFile),
      fileSizeBytes: selectedFile.size,
      contentType: selectedFile.type || undefined,
    };
    const importPath = selectDatasetUploadImportPath({
      file: selectedFile,
    });
    debugDatasetImport('webUi.datasetUpload.import_click', {
      columnCount: selectedColumns.length,
      elapsedMs: Math.round(nowMs() - startedAt),
      fieldCount: fieldMappings.length,
      fileName: sourceFile.fileName,
      fileSizeBytes: sourceFile.fileSizeBytes,
      importPath,
      projectId,
    });
    if (importPath === 'streaming') {
      await importStreamingDataset(fieldMappings, sourceFile, selectedFile);
      return;
    }
    try {
      debugDatasetImport('webUi.datasetUpload.buffered.parse_full.start', {
        fileName: sourceFile.fileName,
        fileSizeBytes: sourceFile.fileSizeBytes,
        projectId,
      });
      const fullParsedFile = await parseDatasetFile(selectedFile);
      debugDatasetImport('webUi.datasetUpload.buffered.parse_full.done', {
        elapsedMs: Math.round(nowMs() - startedAt),
        fileName: sourceFile.fileName,
        sampleCount: fullParsedFile.samples.length,
      });
      await importBufferedDataset(fieldMappings, sourceFile, fullParsedFile.samples, selectedColumns);
    } catch (error) {
      debugDatasetImport('webUi.datasetUpload.import_failed', {
        elapsedMs: Math.round(nowMs() - startedAt),
        error: error instanceof Error ? error.message : String(error),
        fileName: sourceFile.fileName,
      });
      setImportError(true);
    }
  };

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div
        className="mx-auto w-full max-w-[1440px] px-4 py-6 pb-36 sm:px-6 sm:pb-28 lg:px-8"
        data-testid="dataset-upload-page"
      >
        <div className="mb-1 font-mono text-[11.5px] text-muted-foreground">
          <Link className="hover:text-foreground" href={`/datasets`}>
            {t('datasets.title')}
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">{t('datasets.upload.title')}</span>
        </div>
        <div className="mb-5">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold">{t('datasets.upload.title')}</h1>
            <div className="mt-1 text-[12.5px] text-muted-foreground">{t('datasets.upload.subtitle')}</div>
          </div>
        </div>

        {importError && (
          <div className="mb-4 flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t('datasets.upload.importFailed')}
          </div>
        )}

        {isImporting && (
          <div
            className="mb-4 flex gap-2 rounded-md border border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] p-3 text-sm text-[var(--status-pending-fg)]"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{t('datasets.upload.clientImportingNoticeTitle')}</div>
              <div className="mt-0.5 text-[12.5px]">{t('datasets.upload.clientImportingNoticeBody')}</div>
            </div>
          </div>
        )}

        <DatasetTransferProgressPanel progress={uploadProgress.progress} className="mb-4" />

        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Section number={1} title={t('datasets.upload.file')} hint={t('datasets.upload.fileHint')}>
            <div className="space-y-3">
              <div
                className={cn(
                  'block rounded-lg border border-dashed border-[var(--status-running-bd)] bg-[var(--status-running-bg)]/45 p-4 transition-colors hover:bg-[var(--status-running-bg)]/65',
                  isDragOver && 'border-primary bg-primary/10',
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragOver(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
              >
                <input
                  id={fileInputId}
                  type="file"
                  accept={FORMAT_CHIPS.join(',')}
                  className="sr-only"
                  onChange={updateFileInput}
                />
                <input
                  id={folderInputId}
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={updateFileInput}
                  {...directoryInputProps}
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
                        : uppyFileCount > 0
                          ? formatTemplate(t('datasets.upload.selectedFileCount'), { count: uppyFileCount })
                          : t('datasets.upload.chooseFileHelp')}
                    </div>
                    <Progress
                      value={parsedFile ? 100 : 0}
                      label={formatProgressLabel({ value: parsedFile ? 1 : 0, max: 1 })}
                      className="mt-2"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-3">
                      <span className="font-mono text-[10.5px] text-[var(--status-running-fg)]">
                        {parsedFile
                          ? t('datasets.upload.uploadReady')
                          : isDragOver
                            ? t('datasets.upload.dropHere')
                            : t('datasets.upload.waitingForFile')}
                      </span>
                      <div className="flex items-center gap-2 text-[11.5px]">
                        <label
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                          htmlFor={fileInputId}
                        >
                          {selectedFile ? t('datasets.action.replaceFile') : t('datasets.upload.browse')}
                        </label>
                        <span className="text-muted-foreground">·</span>
                        <label
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                          htmlFor={folderInputId}
                        >
                          {t('datasets.upload.browseFolder')}
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {parseError && (
                <div className="flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-[12px] text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>{parseErrorMessage}</div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {t('datasets.upload.supportedFormats')}
                </span>
                <UploadLimitInfoIcon />
                {FORMAT_CHIPS.map((format) => (
                  <span
                    key={format}
                    className="inline-flex rounded-[5px] border bg-muted px-2 py-0.5 font-mono text-[11px]"
                  >
                    {format}
                  </span>
                ))}
              </div>
              <ImageSampleDownloads />
            </div>
          </Section>

          <Section number={2} title={t('datasets.upload.basicInfo')} hint={t('datasets.upload.basicInfoHint')}>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium">
                  {t('datasets.upload.name')} <span className="text-destructive">*</span>
                </label>
                <input
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={datasetName}
                  onChange={(event) => setDatasetName(event.target.value)}
                  placeholder="risk-eval-v4"
                />
                <div className="mt-1 text-[11px] text-muted-foreground">{t('datasets.upload.nameHelp')}</div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium">{t('datasets.upload.description')}</label>
                <textarea
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t('datasets.upload.descriptionPlaceholder')}
                />
              </div>
            </div>
          </Section>

          <Section
            number={3}
            title={t('datasets.upload.previewAndMapping')}
            hint={
              parsedFile
                ? `${parsedFile.columns.length} ${t('datasets.detail.fields')} · ${sampleCountLabel}`
                : t('datasets.upload.previewAndMappingHint')
            }
            className="xl:col-span-2"
          >
            {!parsedFile ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                {t('datasets.upload.noPreview')}
              </div>
            ) : (
              <div className="-m-4">
                <div className="border-b">
                  <div className="flex flex-col gap-2 bg-muted/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{t('datasets.upload.samplePreview')}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {t('datasets.upload.samplePreviewHint')}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {t('datasets.upload.fieldRoleHint')}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[880px] text-sm">
                      <thead>
                        <tr className="border-b bg-muted/60 text-left text-xs font-medium text-muted-foreground">
                          {parsedFile.columns.map((column) => (
                            <th key={column} className={cn('px-3 py-3', !selectedFields[column] && 'opacity-45')}>
                              <div className="flex flex-col">
                                <span>{column}</span>
                                {selectedFields[column] ? (
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
                        {previewRows.map((row, index) => (
                          <tr key={index} className="border-b last:border-b-0 hover:bg-muted/35">
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
                        onClick={() => setPreviewPageIndex((current) => Math.max(0, current - 1))}
                      >
                        <ChevronLeft className="size-3.5" />
                      </Button>
                      <span className="font-mono">
                        {previewPage.rangeStart}-{previewPage.rangeEnd} / {previewPage.totalRows}{' '}
                        {usesStreamingImport ? `· ${t('datasets.upload.previewPrefixOnly')}` : ''}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t('common.nextPage')}
                        disabled={!previewPage.canGoNext}
                        onClick={() =>
                          setPreviewPageIndex((current) => Math.min(previewPage.pageCount - 1, current + 1))
                        }
                      >
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </div>
                    <span className="font-mono text-[11.5px]">
                      {sampleCountLabel} · {selectedColumns.length} {t('datasets.detail.fields')}{' '}
                      {selectedColumns.length > 0
                        ? t('datasets.upload.readyToImport')
                        : t('datasets.upload.noSelectedFields')}
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
                  <div className="grid grid-cols-[44px_96px_minmax(0,1fr)_minmax(0,1.2fr)_200px] border-t bg-muted/60 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                    <div>#</div>
                    <div>{t('datasets.upload.importField')}</div>
                    <div>{t('datasets.upload.originalColumn')}</div>
                    <div>{t('datasets.upload.firstRow')}</div>
                    <div>{t('datasets.upload.role')}</div>
                  </div>
                  {parsedFile.columns.map((column, index) => (
                    <div
                      key={column}
                      className={cn(
                        'grid grid-cols-[44px_96px_minmax(0,1fr)_minmax(0,1.2fr)_200px] items-center border-t px-4 py-3 text-sm',
                        !selectedFields[column] && 'bg-muted/25 text-muted-foreground',
                      )}
                    >
                      <span className="flex size-6 items-center justify-center rounded bg-muted font-mono text-[11px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <label className="inline-flex items-center gap-2 text-xs font-medium">
                        <input
                          type="checkbox"
                          checked={selectedFields[column] ?? false}
                          onChange={(event) =>
                            setSelectedFields((current) => ({
                              ...current,
                              [column]: event.target.checked,
                            }))
                          }
                          className="size-4 accent-primary"
                          aria-label={`${t('datasets.upload.importField')}: ${column}`}
                        />
                        {selectedFields[column] ? t('datasets.upload.importField') : t('datasets.upload.notImported')}
                      </label>
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12.5px] font-semibold">{column}</div>
                      </div>
                      <div className="truncate rounded-md bg-muted/45 px-2 py-1 font-mono text-[11.5px] text-muted-foreground">
                        {getDisplayValue(parsedFile.samples[0]?.[column])}
                      </div>
                      <select
                        value={fieldRoles[column] ?? 'metadata'}
                        onChange={(event) =>
                          setFieldRoles((current) =>
                            normalizeExpectedRoles(
                              {
                                ...current,
                                [column]: event.target.value as DatasetFieldRole,
                              },
                              column,
                            ),
                          )
                        }
                        disabled={!selectedFields[column]}
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
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75 md:left-[var(--sidebar-width)]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">
            {parsedFile ? (
              <span>
                {sampleCountLabel} · {selectedColumns.length} {t('datasets.detail.fields')} ·{' '}
                {selectedColumns.length > 0
                  ? t('datasets.upload.readyToImport')
                  : t('datasets.upload.noSelectedFields')}
              </span>
            ) : (
              <span>{t('datasets.upload.waitingForFile')}</span>
            )}
          </div>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button asChild variant="outline" size="sm" className="h-9 w-full sm:w-auto">
              <Link href={`/datasets`}>{t('common.cancel')}</Link>
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 w-full sm:w-auto"
              disabled={!canImport}
              aria-busy={isSubmitting}
              onPointerDownCapture={() => {
                const startedAt = nowMs();
                debugDatasetImport('webUi.datasetUpload.import_button.pointer_down_capture', {
                  canImport,
                  hasParsedFile: Boolean(parsedFile),
                  hasSelectedFile: Boolean(selectedFile),
                  isSubmitting,
                  selectedColumns: selectedColumns.length,
                });
                queueMicrotask(() => {
                  debugDatasetImport('webUi.datasetUpload.import_button.pointer_down_after_microtask', {
                    elapsedMs: Math.round(nowMs() - startedAt),
                  });
                });
                window.setTimeout(() => {
                  debugDatasetImport('webUi.datasetUpload.import_button.pointer_down_after_timeout', {
                    elapsedMs: Math.round(nowMs() - startedAt),
                  });
                }, 0);
                window.requestAnimationFrame(() => {
                  debugDatasetImport('webUi.datasetUpload.import_button.pointer_down_after_raf', {
                    elapsedMs: Math.round(nowMs() - startedAt),
                  });
                });
              }}
              onClick={() => {
                debugDatasetImport('webUi.datasetUpload.import_button.click_handler_enter', {
                  canImport,
                  hasParsedFile: Boolean(parsedFile),
                  hasSelectedFile: Boolean(selectedFile),
                  isSubmitting,
                  selectedColumns: selectedColumns.length,
                });
                void importDataset();
              }}
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {importButtonLabel}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={leaveDialogOpen}
        onOpenChange={(open) => {
          if (!open) cancelLeaveImport();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('datasets.upload.leaveConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('datasets.upload.leaveConfirmBody')}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelLeaveImport}>
              {t('datasets.upload.leaveConfirmStay')}
            </Button>
            <Button type="button" variant="destructive" onClick={confirmLeaveImport}>
              {t('datasets.upload.leaveConfirmLeave')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
