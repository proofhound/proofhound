'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import type {
  DatasetFieldMappingDto,
  DatasetFieldRole,
  DatasetImportSourceFormat,
  DatasetUploadMetadataDto,
} from '@proofhound/shared';
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
import { useUploadDataset } from '../../hooks';
import {
  useDatasetNameChecker,
  useDatasetUploadMaxBytes,
  useDatasetUploadProgressPanel,
  useDatasetUploadReportIssue,
} from '../../providers';
import { useI18n, type TranslationKey } from '../../i18n';
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
  selectDatasetFile,
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

function droppedSelectionContainsDirectory(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.items).some((item) => {
    const getEntry = (item as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry;
    return getEntry?.call(item)?.isDirectory === true;
  });
}

function getDroppedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.files);
}

/** Best-effort error code from a failed upload: an Axios response body, a nested payload, or an Error. */
export function extractUploadErrorCode(error: unknown): string | null {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (data && typeof data === 'object') {
    const record = data as { message?: unknown; error?: unknown };
    if (typeof record.message === 'string') return record.message;
    if (record.message && typeof record.message === 'object') {
      const nested = (record.message as { error?: unknown }).error;
      if (typeof nested === 'string') return nested;
    }
    if (typeof record.error === 'string') return record.error;
  }
  if (error instanceof Error && error.message) return error.message;
  return null;
}

function getParseErrorKey(parseError: string | null): TranslationKey {
  if (parseError === 'unsupported_file_type') return 'datasets.upload.unsupportedFile';
  if (parseError === 'large_requires_streaming_format') return 'datasets.upload.largeRequiresStreamingFormat';
  if (parseError === 'file_too_large') return 'datasets.upload.fileTooLarge';
  if (parseError === 'single_file_only') return 'datasets.upload.singleFileOnly';
  return 'datasets.upload.parseFailed';
}

// Files larger than this are not parsed whole on selection: only a head prefix is read for preview.
const PREVIEW_PREFIX_MAX_BYTES = 1024 * 1024;

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

function UploadLimitInfoIcon({ maxBytes }: { maxBytes: number }) {
  const { t } = useI18n();
  const uploadLimit = formatByteLimit(maxBytes);

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
              {formatTemplate(t('datasets.upload.limitInfoUpload'), {
                uploadLimit,
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
  const uploadDataset = useUploadDataset(projectId);
  const uploadMaxBytes = useDatasetUploadMaxBytes();
  const checkNameAvailable = useDatasetNameChecker();
  const reportUploadIssue = useDatasetUploadReportIssue();
  const InjectedProgressPanel = useDatasetUploadProgressPanel();
  const uploadProgress = useDatasetTransferProgress();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [datasetName, setDatasetName] = useState('');
  // Last resolved availability check, keyed by the name it ran for so a stale result auto-clears on edit.
  const [nameCheck, setNameCheck] = useState<{ name: string; available: boolean } | null>(null);
  // Raw error from the most recent failed submit that was NOT a name clash (name clashes surface at the
  // name input instead). Drives the generic failure banner + the optional report-issue button.
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDatasetFile | null>(null);
  const [fieldRoles, setFieldRoles] = useState<Record<string, DatasetFieldRole>>({});
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const leaveActionRef = useRef<(() => void) | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);

  // Warn about a taken dataset name while typing, before a file is uploaded. Debounced; the result is
  // keyed by the checked name (so it auto-clears on edit) and a failed check is ignored so the server
  // stays the authoritative gate. Only the async callback sets state — never synchronously in the effect.
  useEffect(() => {
    const trimmed = datasetName.trim();
    if (projectId.length === 0 || trimmed.length === 0) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkNameAvailable(projectId, trimmed)
        .then((available) => {
          if (!cancelled) setNameCheck({ name: trimmed, available });
        })
        .catch(() => {
          if (!cancelled) setNameCheck(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [datasetName, projectId, checkNameAvailable]);

  // Leaving before the upload finishes aborts the in-flight request.
  useEffect(
    () => () => {
      uploadAbortRef.current?.abort();
    },
    [],
  );

  // While an upload is in flight, guard every way to leave so the user is warned before losing it.
  useEffect(() => {
    if (!isUploading) return undefined;

    // Tab close / refresh / hard URL change: only the browser's native prompt is possible here.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
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
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [isUploading, router]);

  const confirmLeaveUpload = () => {
    setLeaveDialogOpen(false);
    uploadAbortRef.current?.abort();
    setIsUploading(false);
    const action = leaveActionRef.current;
    leaveActionRef.current = null;
    action?.();
  };

  const cancelLeaveUpload = () => {
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
  const uploadLimitLabel = formatByteLimit(uploadMaxBytes);
  const isSubmitting = isUploading;
  const nameTaken = nameCheck !== null && nameCheck.name === datasetName.trim() && !nameCheck.available;
  const canImport =
    projectId.length > 0 &&
    datasetName.trim().length > 0 &&
    !nameTaken &&
    parsedFile !== null &&
    selectedFile !== null &&
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
      if (file.size > uploadMaxBytes) {
        throw new Error('file_too_large');
      }
      const large = file.size > PREVIEW_PREFIX_MAX_BYTES;
      if (large && !isStreamingImportFile(file)) {
        // Large JSON arrays / ZIPs cannot be previewed with a bounded prefix parser.
        throw new Error('large_requires_streaming_format');
      }
      // Streaming formats read only a head prefix; small whole files parse fully for preview.
      const parsed = large ? await parseStreamingPrefix(file) : await parseDatasetFile(file);
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

  const importDataset = async () => {
    if (!parsedFile || !selectedFile || !canImport) return;

    const fieldMappings: DatasetFieldMappingDto[] = selectedColumns.map((column) => ({
      name: column,
      role: fieldRoles[column] ?? 'metadata',
    }));
    const metadata: DatasetUploadMetadataDto = {
      name: datasetName.trim(),
      description: description.trim() || null,
      fieldMappings,
      sourceFormat: toUploadSourceFormat(selectedFile.name),
      fileName: getUploadFilePath(selectedFile),
      ...(isLargeFile ? {} : { declaredTotalRows: parsedFile.samples.length }),
    };

    const totalBytes = selectedFile.size;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setSubmitError(null);
    setIsUploading(true);
    uploadProgress.start(
      t('datasets.transfer.uploadTitle'),
      totalBytes,
      t('datasets.transfer.uploadDescription'),
    );

    try {
      await uploadDataset.mutateAsync({
        file: selectedFile,
        metadata,
        signal: controller.signal,
        onProgress: (progress) => {
          uploadProgress.update(progress);
          // Once the bytes are fully sent, the server parses + promotes: switch to the `processing`
          // phase so a determinate default panel shows "processing" and an injected panel can render
          // its own post-upload progress.
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
      uploadProgress.complete(totalBytes);
      router.push(`/datasets`);
    } catch (error) {
      uploadProgress.fail();
      if (extractUploadErrorCode(error) === 'dataset_name_taken') {
        // A name clash slipped past the pre-check (race): surface it at the name input, not the banner.
        setNameCheck({ name: datasetName.trim(), available: false });
      } else {
        setSubmitError(error);
      }
    } finally {
      setIsUploading(false);
      uploadAbortRef.current = null;
    }
  };

  const openFilePicker = () => {
    if (isUploading) return;
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

        {submitError !== null && (
          <div className="mb-4 flex gap-2 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-2">
              <span>{t('datasets.upload.importFailed')}</span>
              {reportUploadIssue ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => reportUploadIssue(submitError)}
                  data-testid="dataset-upload-report-issue"
                >
                  {t('datasets.upload.reportIssue')}
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {isUploading && (
          <div
            className="mb-4 flex gap-2 rounded-md border border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] p-3 text-sm text-[var(--status-pending-fg)]"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{t('datasets.upload.importingNoticeTitle')}</div>
              <div className="mt-0.5 text-[12.5px]">{t('datasets.upload.importingNoticeBody')}</div>
            </div>
          </div>
        )}

        {InjectedProgressPanel ? (
          // A stable contract-provided component (from context, not created per render), so this never
          // remounts; the static-components heuristic can't see that it comes from WebContracts.
          // eslint-disable-next-line react-hooks/static-components
          <InjectedProgressPanel progress={uploadProgress.progress} className="mb-4" />
        ) : (
          <DatasetTransferProgressPanel progress={uploadProgress.progress} className="mb-4" />
        )}

        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Section
            number={1}
            title={t('datasets.upload.file')}
            hint={
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{t('datasets.upload.fileHint')}</span>
                <span className="text-[11px] text-muted-foreground">
                  {formatTemplate(t('datasets.upload.limitInline'), { uploadLimit: uploadLimitLabel })}
                </span>
                <UploadLimitInfoIcon maxBytes={uploadMaxBytes} />
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
                  className={cn(
                    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    nameTaken && 'border-destructive focus-visible:ring-destructive',
                  )}
                  value={datasetName}
                  onChange={(event) => setDatasetName(event.target.value)}
                  placeholder="risk-eval-v4"
                  aria-invalid={nameTaken}
                />
                {nameTaken ? (
                  <div className="mt-1 text-[11px] text-destructive" data-testid="dataset-upload-name-taken">
                    {t('datasets.upload.nameTaken')}
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-muted-foreground">{t('datasets.upload.nameHelp')}</div>
                )}
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
          if (!open) cancelLeaveUpload();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('datasets.upload.leaveConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('datasets.upload.leaveConfirmBody')}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelLeaveUpload}>
              {t('datasets.upload.leaveConfirmStay')}
            </Button>
            <Button type="button" variant="destructive" onClick={confirmLeaveUpload}>
              {t('datasets.upload.leaveConfirmLeave')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
