'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import type {
  CreateDatasetDto,
  CreateDatasetImportDto,
  DatasetFieldRole,
  DatasetImportStatusDto,
  DatasetImportSourceFormat,
  DatasetRawImportCapabilitiesDto,
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
import { useCreateDataset } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import {
  projectSampleRowsToBatches,
  runDatasetImport,
  runRawDatasetImport,
  type DatasetImportProgress,
} from './dataset-import-runner';
import { DatasetTransferProgressPanel, useDatasetTransferProgress } from './dataset-transfer-progress';
import { RoleArrowLabel, RolePill } from './dataset-ui';
import {
  FORMAT_CHIPS,
  PREVIEW_LIMIT,
  getDatasetNameFromFile,
  getDatasetPreviewPage,
  getDisplayValue,
  getUploadFilePath,
  inferRole,
  isStreamingImportFile,
  parseDatasetFile,
  parseStreamingPrefix,
  projectSamplesToColumns,
  selectDatasetFile,
  streamDatasetRows,
  type ParsedDatasetFile,
} from './dataset-upload-parser';

const ROLE_OPTIONS: Array<{ role: DatasetFieldRole; labelKey: TranslationKey }> = [
  { role: 'id', labelKey: 'datasets.role.id' },
  { role: 'text', labelKey: 'datasets.role.text' },
  { role: 'image', labelKey: 'datasets.role.image' },
  { role: 'expected', labelKey: 'datasets.role.expected' },
  { role: 'metadata', labelKey: 'datasets.role.metadata' },
];

export type DatasetImageSampleDownload = {
  labelKey: TranslationKey;
  fileName: string;
  mimeType: string;
  content: string;
  encoding?: 'base64';
};

const IMAGE_ZIP_RELATIVE_PATHS_BASE64 = [
  'UEsDBBQAAAAAAAAAAAC417L5IAAAACAAAAANAAAAbWFuaWZlc3QuanNvbnsKICAiZmlsZSI6ICJkYXRhL2ltYWdlcy5jc3YiCn0K',
  'UEsDBBQAAAAAAAAAAADVSiYxQQEAAEEBAAAPAAAAZGF0YS9pbWFnZXMuY3N2c2FtcGxlX2lkLHRleHQsaW1hZ2VfcGF0aCxp',
  'bWFnZV9wYXRocyxleHBlY3RlZF9vdXRwdXQKemlwLTEsIkltYWdlcyBjYW4gYmUgcmVmZXJlbmNlZCBieSByZWxhdGl2ZSBw',
  'YXRoIGluc2lkZSB0aGUgWklQIixpbWFnZXMvcmVkLnN2ZywiWyIiaW1hZ2VzL3JlZC5zdmciIiwiImltYWdlcy9ibHVlLnN2',
  'ZyIiXSIscmVkLWJsdWUKemlwLTIsIlRoZSBwYXJzZXIgaW5saW5lcyBaSVAgaW1hZ2VzIGludG8gZGF0YSBVUkxzIGJlZm9y',
  'ZSBpbXBvcnQiLGltYWdlcy9ibHVlLnN2ZywiWyIiaW1hZ2VzL2JsdWUuc3ZnIiIsIiJpbWFnZXMvcmVkLnN2ZyIiXSIsYmx1',
  'ZS1yZWQKUEsDBBQAAAAAAAAAAADpvKld8AAAAPAAAAAOAAAAaW1hZ2VzL3JlZC5zdmc8c3ZnIHhtbG5zPSJodHRwOi8vd3d3',
  'LnczLm9yZy8yMDAwL3N2ZyIgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3',
  'aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0iI2VmNDQ0NCIvPjx0ZXh0IHg9IjY0IiB5PSI3MiIgdGV4dC1hbmNob3I9',
  'Im1pZGRsZSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjIwIiBmaWxsPSJ3aGl0ZSI+cmVkPC90ZXh0Pjwvc3Zn',
  'PgpQSwMEFAAAAAAAAAAAALFgrlrxAAAA8QAAAA8AAABpbWFnZXMvYmx1ZS5zdmc8c3ZnIHhtbG5zPSJodHRwOi8vd3d3Lncz',
  'Lm9yZy8yMDAwL3N2ZyIgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0',
  'aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0iIzI1NjNlYiIvPjx0ZXh0IHg9IjY0IiB5PSI3MiIgdGV4dC1hbmNob3I9Im1p',
  'ZGRsZSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjIwIiBmaWxsPSJ3aGl0ZSI+Ymx1ZTwvdGV4dD48L3N2Zz4K',
  'UEsBAhQAFAAAAAAAAAAAALjXsvkgAAAAIAAAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAAAAAA',
  'AAAA1UomMUEBAABBAQAADwAAAAAAAAAAAAAAAABLAAAAZGF0YS9pbWFnZXMuY3N2UEsBAhQAFAAAAAAAAAAAAOm8qV3wAAAA',
  '8AAAAA4AAAAAAAAAAAAAAAAAuQEAAGltYWdlcy9yZWQuc3ZnUEsBAhQAFAAAAAAAAAAAALFgrlrxAAAA8QAAAA8AAAAAAAAA',
  'AAAAAAAA1QIAAGltYWdlcy9ibHVlLnN2Z1BLBQYAAAAABAAEAPEAAADzAwAAAAA=',
].join('');

export const DATASET_IMAGE_SAMPLE_DOWNLOADS: DatasetImageSampleDownload[] = [
  {
    labelKey: 'datasets.upload.imageSamples.urlFields',
    fileName: 'proofhound-image-url-fields.csv',
    mimeType: 'text/csv;charset=utf-8',
    content: [
      'sample_id,text,front_image_url,back_image_url,expected_output',
      'url-1,"Classify the object from two public image URLs","https://placehold.co/128x128/png?text=front","https://placehold.co/128x128/png?text=back","same-product"',
      'url-2,"Use one or more columns as image fields","https://placehold.co/128x128/png?text=left","https://placehold.co/128x128/png?text=right","compare"',
      '',
    ].join('\n'),
  },
  {
    labelKey: 'datasets.upload.imageSamples.urlArray',
    fileName: 'proofhound-image-url-array.csv',
    mimeType: 'text/csv;charset=utf-8',
    content: [
      'sample_id,text,image_urls,expected_output',
      'array-1,"A single CSV field can contain multiple image URLs","[""https://placehold.co/128x128/png?text=a"",""https://placehold.co/128x128/png?text=b&query=1,2""]","two-images"',
      'array-2,"Keep the value as a valid JSON array string","[""https://placehold.co/128x128/png?text=front"",""https://placehold.co/128x128/png?text=back""]","paired"',
      '',
    ].join('\n'),
  },
  {
    labelKey: 'datasets.upload.imageSamples.base64',
    fileName: 'proofhound-image-base64.jsonl',
    mimeType: 'application/x-ndjson;charset=utf-8',
    content: [
      '{"sample_id":"base64-1","text":"This sample stores the image as a data URL.","image_base64":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=","expected_output":"tiny-pixel"}',
      '{"sample_id":"base64-2","text":"A single field may also hold an array of data URLs.","image_base64s":["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=","data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="],"expected_output":"two-pixels"}',
      '',
    ].join('\n'),
  },
  {
    labelKey: 'datasets.upload.imageSamples.zip',
    fileName: 'proofhound-image-zip-relative-paths.zip',
    mimeType: 'application/zip',
    content: IMAGE_ZIP_RELATIVE_PATHS_BASE64,
    encoding: 'base64',
  },
];

export function getDatasetImageSampleDownloadHref(sample: DatasetImageSampleDownload) {
  if (sample.encoding === 'base64') {
    return `data:${sample.mimeType};base64,${sample.content}`;
  }
  return `data:${sample.mimeType},${encodeURIComponent(sample.content)}`;
}

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
  hint: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <SectionNumber value={number} />
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        <div className="ml-auto flex items-center text-[11.5px] text-muted-foreground">{hint}</div>
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

type DatasetServerProgressPhase = 'finalizing' | 'offloading' | 'committing';

function isDatasetServerProgressPhase(phase: DatasetImportProgress['phase']): phase is DatasetServerProgressPhase {
  return phase === 'finalizing' || phase === 'offloading' || phase === 'committing';
}

function importStatusPercent(status?: DatasetImportStatusDto): number | null {
  return status?.progress.percentage ?? null;
}

function droppedSelectionContainsDirectory(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.items).some((item) => {
    const getEntry = (item as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry;
    return getEntry?.call(item)?.isDirectory === true;
  });
}

function getDroppedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.files);
}

function getParseErrorKey(parseError: string | null): TranslationKey {
  if (parseError === 'unsupported_file_type') return 'datasets.upload.unsupportedFile';
  if (parseError === 'large_requires_streaming_format') return 'datasets.upload.largeRequiresStreamingFormat';
  if (parseError === 'file_too_large') return 'datasets.upload.fileTooLarge';
  if (parseError === 'single_file_only') return 'datasets.upload.singleFileOnly';
  return 'datasets.upload.parseFailed';
}

export function estimateUploadProgressBytes(sourceFile: CreateDatasetDto['uploadSource']) {
  return Math.max(1, sourceFile.fileSizeBytes);
}

export async function selectSingleDatasetUploadFile(files: File[]): Promise<File> {
  if (files.length !== 1) throw new Error('single_file_only');
  return selectDatasetFile(files);
}

// Files larger than this are not parsed whole on drop: only a head prefix is read for preview.
// They prefer raw upload + server-side import when object storage supports browser upload sessions.
const SYNC_MAX_FILE_BYTES = 1024 * 1024;
// Below the file-size threshold a parsed dataset still routes through the import session once it exceeds
// this many samples, because the synchronous POST /datasets path is capped server-side.
const SYNC_MAX_SAMPLES = 5000;
const IMPORT_BATCH_SIZE = 1000;
const DEFAULT_RAW_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const HARD_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const RAW_IMPORT_MIN_BYTES = 500 * 1024 * 1024;
const RAW_BUFFERED_FORMAT_MAX_BYTES = 64 * 1024 * 1024;

export type DatasetUploadImportPath = 'sync' | 'buffered' | 'streaming' | 'raw';

function toImportSourceFormat(fileName: string): DatasetImportSourceFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.zip')) return 'zip';
  return 'jsonl';
}

function isStreamingImportFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.jsonl') || lower.endsWith('.csv') || lower.endsWith('.tsv');
}

function isRawImportFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.jsonl') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.zip')
  );
}

function canUseRawImportForFile(
  file: Pick<File, 'name' | 'size'>,
  capabilities: DatasetRawImportCapabilitiesDto | null,
) {
  if (capabilities?.supported !== true) return false;
  if (!isRawImportFileName(file.name) || file.size > getEffectiveUploadMaxBytes(capabilities)) return false;
  return isStreamingImportFileName(file.name) || file.size <= RAW_BUFFERED_FORMAT_MAX_BYTES;
}

function getEffectiveUploadMaxBytes(capabilities: DatasetRawImportCapabilitiesDto | null) {
  if (capabilities?.supported !== true || capabilities.maxBytes <= 0) return HARD_UPLOAD_MAX_BYTES;
  return Math.min(capabilities?.maxBytes ?? DEFAULT_RAW_UPLOAD_MAX_BYTES, HARD_UPLOAD_MAX_BYTES);
}

export function selectDatasetUploadImportPath({
  file,
  isLargeFile,
  parsedSampleCount,
  rawImportCapabilities,
}: {
  file: Pick<File, 'name' | 'size'>;
  isLargeFile: boolean;
  parsedSampleCount: number;
  rawImportCapabilities: DatasetRawImportCapabilitiesDto | null;
}): DatasetUploadImportPath {
  if (file.size <= SYNC_MAX_FILE_BYTES && parsedSampleCount <= SYNC_MAX_SAMPLES) {
    return 'sync';
  }

  if (
    canUseRawImportForFile(file, rawImportCapabilities) &&
    (!isStreamingImportFileName(file.name) || file.size >= RAW_IMPORT_MIN_BYTES)
  ) {
    return 'raw';
  }

  if (isLargeFile) {
    return 'streaming';
  }

  return 'buffered';
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

function UploadLimitInfoIcon({ rawMaxBytes }: { rawMaxBytes: number }) {
  const { t } = useI18n();
  const rawLimit = formatByteLimit(rawMaxBytes);
  const rawMin = formatByteLimit(RAW_IMPORT_MIN_BYTES);
  const syncLimit = formatByteLimit(SYNC_MAX_FILE_BYTES);

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
              {formatTemplate(t('datasets.upload.limitInfoSmall'), {
                syncLimit,
                rawMin,
              })}
            </p>
            <p>{t('datasets.upload.limitInfoStreaming')}</p>
            <p>
              {formatTemplate(t('datasets.upload.limitInfoRaw'), {
                rawLimit,
              })}
            </p>
            <p>{t('datasets.upload.limitInfoJsonZip')}</p>
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
          const href = getDatasetImageSampleDownloadHref(sample);
          return (
            <a
              key={sample.fileName}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted"
              href={href}
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
  const createDataset = useCreateDataset(projectId);
  const uploadProgress = useDatasetTransferProgress();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [datasetName, setDatasetName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDatasetFile | null>(null);
  const [fieldRoles, setFieldRoles] = useState<Record<string, DatasetFieldRole>>({});
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [rawImportCapabilities, setRawImportCapabilities] = useState<DatasetRawImportCapabilitiesDto | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const importIdRef = useRef<string | null>(null);
  const abortOnLeaveRef = useRef(false);
  const leaveActionRef = useRef<(() => void) | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [activeImportPath, setActiveImportPath] = useState<DatasetUploadImportPath | null>(null);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);

  // Leaving before completion cancels the import and asks the server to clear any staged/raw data.
  useEffect(
    () => () => {
      if (abortOnLeaveRef.current) importAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    datasetImportClient
      .getRawImportCapabilities(projectId)
      .then((capabilities) => {
        if (!cancelled) setRawImportCapabilities(capabilities);
      })
      .catch(() => {
        if (!cancelled) setRawImportCapabilities({ supported: false, maxBytes: 1 });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
    const importId = importIdRef.current;
    if (importId) datasetImportClient.abortDatasetImportBeacon(projectId, importId);
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

  const previewRows = useMemo(() => parsedFile?.samples.slice(0, PREVIEW_LIMIT) ?? [], [parsedFile]);
  const previewPage = useMemo(
    () => getDatasetPreviewPage(previewRows, previewPageIndex),
    [previewRows, previewPageIndex],
  );
  const selectedColumns = useMemo(
    () => parsedFile?.columns.filter((column) => selectedFields[column]) ?? [],
    [parsedFile, selectedFields],
  );
  const isSubmitting = createDataset.isPending || isImporting;
  const canImport =
    projectId.length > 0 &&
    datasetName.trim().length > 0 &&
    parsedFile !== null &&
    selectedColumns.length > 0 &&
    !isSubmitting;
  const parseErrorKey = getParseErrorKey(parseError);
  // Large files keep only a preview prefix in state, so show a streaming label instead of a misleading row count.
  const sampleCountLabel = isLargeFile
    ? t('datasets.upload.streamingFile')
    : `${parsedFile?.samples.length ?? 0} ${t('datasets.samples')}`;
  const importButtonLabel = parsedFile
    ? `${t('datasets.upload.importRows')} (${sampleCountLabel} · ${selectedColumns.length} ${t('datasets.detail.fields')})`
    : t('datasets.upload.importRows');

  const showServerImportProgress = (
    event: DatasetImportProgress,
    fallbackTitleKey: TranslationKey,
    fallbackDescriptionKey: TranslationKey,
  ) => {
    const serverProgress = event.status?.progress;
    const phase = serverProgress?.phase ?? event.phase;
    const percent = serverProgress?.percentage ?? (isDatasetServerProgressPhase(phase) ? 90 : null);

    if (phase === 'offloading') {
      const totalShards = serverProgress?.totalShards ?? null;
      const completedShards = serverProgress?.completedShards ?? null;
      uploadProgress.setMessage(
        t('datasets.transfer.serverOffloadTitle'),
        totalShards && completedShards !== null
          ? formatTemplate(t('datasets.transfer.serverOffloadProgressDescription'), {
              completed: completedShards,
              total: totalShards,
            })
          : t('datasets.transfer.serverOffloadDescription'),
        percent,
      );
      return;
    }

    if (phase === 'committing') {
      const totalRows = serverProgress?.totalRows ?? null;
      const committedRows = serverProgress?.committedRows ?? null;
      uploadProgress.setMessage(
        t('datasets.transfer.serverCommitTitle'),
        totalRows && committedRows !== null && committedRows > 0
          ? formatTemplate(t('datasets.transfer.serverCommitProgressDescription'), {
              committed: committedRows,
              total: totalRows,
            })
          : t('datasets.transfer.serverCommitDescription'),
        serverProgress?.percentage ?? 98,
      );
      return;
    }

    uploadProgress.setMessage(
      t(phase === 'finalizing' ? 'datasets.transfer.serverFinalizeTitle' : fallbackTitleKey),
      t(phase === 'finalizing' ? 'datasets.transfer.serverFinalizeDescription' : fallbackDescriptionKey),
      percent,
    );
  };

  const resetFileSelection = (error: string | null = null) => {
    setSelectedFile(null);
    setParsedFile(null);
    setParseError(error);
    setIsLargeFile(false);
    setFieldRoles({});
    setSelectedFields({});
    setPreviewPageIndex(0);
    uploadProgress.reset();
  };

  const updateFiles = async (files: File[]) => {
    if (files.length === 0) return;

    resetFileSelection();

    try {
      const file = await selectSingleDatasetUploadFile(files);
      if (file.size > getEffectiveUploadMaxBytes(rawImportCapabilities)) {
        throw new Error('file_too_large');
      }
      const large = file.size > SYNC_MAX_FILE_BYTES;
      const canRawImportWholeFile = canUseRawImportForFile(file, rawImportCapabilities);
      if (large && !isStreamingImportFile(file) && !canRawImportWholeFile) {
        // Large JSON arrays / ZIPs are only previewed with a bounded parser before raw import.
        throw new Error('large_requires_streaming_format');
      }
      // Streaming formats read only a head prefix; bounded JSON/ZIP raw imports may parse the small whole file for preview.
      const parsed =
        large && isStreamingImportFile(file) ? await parseStreamingPrefix(file) : await parseDatasetFile(file);
      setSelectedFile(file);
      setParsedFile(parsed);
      setIsLargeFile(large);
      setPreviewPageIndex(0);
      setFieldRoles(
        normalizeExpectedRoles(
          Object.fromEntries(parsed.columns.map((column) => [column, inferRole(column, parsed.samples[0]?.[column])])),
        ),
      );
      setSelectedFields(Object.fromEntries(parsed.columns.map((column) => [column, true])));
      setDatasetName((current) => current || getDatasetNameFromFile(file.name));
    } catch (error) {
      resetFileSelection(error instanceof Error ? error.message : 'parse_failed');
    }
  };

  const updateFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    await updateFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    if (droppedSelectionContainsDirectory(event.dataTransfer)) {
      resetFileSelection('single_file_only');
      return;
    }
    await updateFiles(getDroppedFiles(event.dataTransfer));
  };

  const importStreamingDataset = async (
    fieldMappings: CreateDatasetDto['fieldMappings'],
    sourceFile: CreateDatasetDto['uploadSource'],
    file: File,
  ) => {
    const totalBytes = file.size;
    const createBody: CreateDatasetImportDto = {
      name: datasetName.trim(),
      description: description.trim() || null,
      fieldMappings,
      sourceFile,
      sourceFormat: toImportSourceFormat(sourceFile.fileName),
    };

    const controller = new AbortController();
    importAbortRef.current = controller;
    abortOnLeaveRef.current = true;
    setActiveImportPath('streaming');
    setIsImporting(true);
    uploadProgress.start(
      t('datasets.transfer.streamingUploadTitle'),
      totalBytes,
      t('datasets.transfer.streamingUploadDescription'),
    );
    await yieldToBrowser();
    try {
      await runDatasetImport({
        projectId,
        createBody,
        batches: projectedStreamingFileBatches(
          file,
          selectedColumns,
          IMPORT_BATCH_SIZE,
          (readBytes) => uploadProgress.update({ loadedBytes: readBytes, totalBytes }),
          controller.signal,
        ),
        signal: controller.signal,
        onCreated: (id) => {
          importIdRef.current = id;
        },
        onProgress: (event) => {
          if (event.phase === 'completing' || event.status) {
            showServerImportProgress(
              event,
              'datasets.transfer.streamingCompleteTitle',
              'datasets.transfer.streamingCompleteDescription',
            );
          }
        },
      });
      uploadProgress.complete(totalBytes);
      router.push(`/datasets`);
    } catch {
      uploadProgress.fail();
    } finally {
      setIsImporting(false);
      importAbortRef.current = null;
      importIdRef.current = null;
      abortOnLeaveRef.current = false;
      setActiveImportPath(null);
    }
  };

  const importRawDataset = async (
    fieldMappings: CreateDatasetDto['fieldMappings'],
    sourceFile: CreateDatasetDto['uploadSource'],
    file: File,
  ) => {
    const totalBytes = file.size;
    const createBody: CreateDatasetImportDto = {
      name: datasetName.trim(),
      description: description.trim() || null,
      fieldMappings,
      sourceFile,
      sourceFormat: toImportSourceFormat(sourceFile.fileName),
    };

    const controller = new AbortController();
    importAbortRef.current = controller;
    abortOnLeaveRef.current = true;
    setActiveImportPath('raw');
    setIsImporting(true);
    uploadProgress.start(
      t('datasets.transfer.rawUploadTitle'),
      totalBytes,
      t('datasets.transfer.rawUploadDescription'),
    );
    await yieldToBrowser();
    try {
      await runRawDatasetImport({
        projectId,
        createBody,
        file,
        signal: controller.signal,
        onCreated: (id) => {
          importIdRef.current = id;
        },
        onUploadProgress: uploadProgress.update,
        onUploaded: () => {
          uploadProgress.update({ loadedBytes: totalBytes, totalBytes });
          uploadProgress.setMessage(t('datasets.transfer.rawVerifyTitle'), t('datasets.transfer.rawVerifyDescription'));
        },
        onProgress: (event) => {
          const phase = event.status?.progress.phase ?? event.phase;
          if (phase === 'queued') {
            uploadProgress.setMessage(
              t('datasets.transfer.rawQueuedTitle'),
              t('datasets.transfer.rawQueuedDescription'),
              importStatusPercent(event.status),
            );
          } else if (phase === 'parsing') {
            uploadProgress.setMessage(
              t('datasets.transfer.rawParsingTitle'),
              t('datasets.transfer.rawParsingDescription'),
              importStatusPercent(event.status),
            );
          } else if (phase === 'importing') {
            uploadProgress.setMessage(
              t('datasets.transfer.rawImportingTitle'),
              t('datasets.transfer.rawImportingDescription'),
              importStatusPercent(event.status),
            );
          } else if (isDatasetServerProgressPhase(phase)) {
            showServerImportProgress(
              event,
              'datasets.transfer.serverFinalizeTitle',
              'datasets.transfer.serverFinalizeDescription',
            );
          }
        },
      });
      uploadProgress.complete(totalBytes);
      router.push(`/datasets`);
    } catch {
      uploadProgress.fail();
    } finally {
      setIsImporting(false);
      importAbortRef.current = null;
      importIdRef.current = null;
      abortOnLeaveRef.current = false;
      setActiveImportPath(null);
    }
  };

  const importBufferedDataset = async (
    fieldMappings: CreateDatasetDto['fieldMappings'],
    sourceFile: CreateDatasetDto['uploadSource'],
    samples: Array<Record<string, unknown>>,
    columns: string[],
  ) => {
    const totalRows = samples.length;
    const estimatedBytes = estimateUploadProgressBytes(sourceFile);
    const createBody: CreateDatasetImportDto = {
      name: datasetName.trim(),
      description: description.trim() || null,
      fieldMappings,
      sourceFile,
      sourceFormat: toImportSourceFormat(sourceFile.fileName),
      declaredTotalRows: totalRows,
    };

    const controller = new AbortController();
    importAbortRef.current = controller;
    abortOnLeaveRef.current = true;
    setActiveImportPath('buffered');
    setIsImporting(true);
    uploadProgress.start(
      t('datasets.transfer.batchUploadTitle'),
      estimatedBytes,
      t('datasets.transfer.batchUploadDescription'),
    );
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
        onProgress: (event) => {
          uploadProgress.update({
            loadedBytes: totalRows > 0 ? Math.round((estimatedBytes * event.receivedRows) / totalRows) : estimatedBytes,
            totalBytes: estimatedBytes,
          });
          if (event.phase === 'completing' || event.status) {
            showServerImportProgress(
              event,
              'datasets.transfer.batchCompleteTitle',
              'datasets.transfer.batchCompleteDescription',
            );
          }
        },
      });
      uploadProgress.complete(estimatedBytes);
      router.push(`/datasets`);
    } catch {
      uploadProgress.fail();
    } finally {
      setIsImporting(false);
      importAbortRef.current = null;
      importIdRef.current = null;
      abortOnLeaveRef.current = false;
      setActiveImportPath(null);
    }
  };

  const importDataset = async () => {
    if (!parsedFile || !selectedFile || !canImport) return;

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
      isLargeFile,
      parsedSampleCount: parsedFile.samples.length,
      rawImportCapabilities,
    });
    if (importPath === 'raw') {
      await importRawDataset(fieldMappings, sourceFile, selectedFile);
      return;
    }
    if (importPath === 'streaming') {
      await importStreamingDataset(fieldMappings, sourceFile, selectedFile);
      return;
    }

    if (importPath === 'buffered') {
      await importBufferedDataset(fieldMappings, sourceFile, parsedFile.samples, selectedColumns);
      return;
    }

    const samples = projectSamplesToColumns(parsedFile.samples, selectedColumns);
    const body: CreateDatasetDto = {
      name: datasetName.trim(),
      description: description.trim() || null,
      uploadSource: sourceFile,
      fieldMappings,
      samples,
    };

    const estimatedBytes = estimateUploadProgressBytes(sourceFile);
    uploadProgress.start(t('datasets.transfer.uploadTitle'), estimatedBytes);

    try {
      await createDataset.mutateAsync({
        body,
        onProgress: uploadProgress.update,
      });
      uploadProgress.complete(estimatedBytes);
      router.push(`/datasets`);
    } catch {
      uploadProgress.fail();
    }
  };

  const openFilePicker = () => {
    if (isImporting) return;
    fileInputRef.current?.click();
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

        {createDataset.isError && (
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
              <div className="font-medium">
                {t(
                  activeImportPath === 'raw'
                    ? 'datasets.upload.importingNoticeTitle'
                    : 'datasets.upload.clientImportingNoticeTitle',
                )}
              </div>
              <div className="mt-0.5 text-[12.5px]">
                {t(
                  activeImportPath === 'raw'
                    ? 'datasets.upload.importingNoticeBody'
                    : 'datasets.upload.clientImportingNoticeBody',
                )}
              </div>
            </div>
          </div>
        )}

        <DatasetTransferProgressPanel progress={uploadProgress.progress} className="mb-4" />

        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Section
            number={1}
            title={t('datasets.upload.file')}
            hint={
              <div className="flex items-center gap-2">
                <span className="font-mono">{t('datasets.upload.fileHint')}</span>
                <UploadLimitInfoIcon rawMaxBytes={getEffectiveUploadMaxBytes(rawImportCapabilities)} />
              </div>
            }
          >
            <div className="space-y-3">
              <div
                className={cn(
                  'block cursor-pointer rounded-lg border border-dashed border-[var(--status-running-bd)] bg-[var(--status-running-bg)]/45 p-4 transition-colors hover:bg-[var(--status-running-bg)]/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isDragOver && 'border-primary bg-primary/10',
                )}
                role="button"
                tabIndex={0}
                aria-label={selectedFile ? t('datasets.action.replaceFile') : t('datasets.upload.chooseFile')}
                onClick={openFilePicker}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  openFilePicker();
                }}
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
                  ref={fileInputRef}
                  type="file"
                  accept={FORMAT_CHIPS.join(',')}
                  className="sr-only"
                  onChange={updateFileInput}
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
                      value={parsedFile ? 100 : 0}
                      label={formatProgressLabel({ value: parsedFile ? 1 : 0, max: 1 })}
                      className="mt-2"
                    />
                    <div className="mt-1.5 flex items-center gap-3">
                      <span className="font-mono text-[10.5px] text-[var(--status-running-fg)]">
                        {parsedFile
                          ? t('datasets.upload.uploadReady')
                          : isDragOver
                            ? t('datasets.upload.dropHere')
                            : t('datasets.upload.waitingForFile')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {parseError && (
                <div className="flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-[12px] text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>{t(parseErrorKey)}</div>
                </div>
              )}

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
                        {previewPage.rows.map((row, index) => (
                          <tr
                            key={previewPage.rangeStart + index - 1}
                            className="border-b last:border-b-0 hover:bg-muted/35"
                          >
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
                        onClick={() => setPreviewPageIndex(Math.max(0, previewPage.pageIndex - 1))}
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
                        onClick={() =>
                          setPreviewPageIndex(Math.min(previewPage.pageCount - 1, previewPage.pageIndex + 1))
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
              onClick={() => void importDataset()}
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
