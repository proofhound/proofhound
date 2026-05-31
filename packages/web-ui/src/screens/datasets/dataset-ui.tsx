'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  Image as ImageIcon,
  Info,
  Minus,
} from 'lucide-react';
import type { DatasetExportFormatDto } from '@proofhound/shared';
import {
  Button,
  ImagePreviewDialog,
  ImageZoomHoverOverlay,
  isRenderableImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ModalityIconGroup,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@proofhound/ui';
import type { ModalityKind } from '@proofhound/ui';
import { useI18n, type Language } from '../../i18n';
import {
  DATASET_MODALITY_LABEL_KEYS,
  DATASET_ROLE_LABEL_KEYS,
  type DatasetCategoryProfile,
  type DatasetFieldRole,
  type DatasetModality,
  type ProjectDataset,
} from './dataset-types';

const ROLE_STYLES: Record<DatasetFieldRole, { pill: string; dot: string; text: string }> = {
  text: {
    pill: 'border-[var(--modality-text-bd)] bg-[var(--modality-text-bg)] text-[var(--modality-text-fg)]',
    dot: 'bg-[var(--modality-text-dot)]',
    text: 'text-[var(--modality-text-fg)]',
  },
  image: {
    pill: 'border-[var(--modality-image-bd)] bg-[var(--modality-image-bg)] text-[var(--modality-image-fg)]',
    dot: 'bg-[var(--modality-image-dot)]',
    text: 'text-[var(--modality-image-fg)]',
  },
  expected: {
    pill: 'border-[var(--modality-number-bd)] bg-[var(--modality-number-bg)] text-[var(--modality-number-fg)]',
    dot: 'bg-[var(--modality-number-dot)]',
    text: 'text-[var(--modality-number-fg)]',
  },
  metadata: {
    pill: 'border-[var(--field-meta-bd)] bg-[var(--field-meta-bg)] text-[var(--field-meta-fg)]',
    dot: 'bg-[var(--field-meta-dot)]',
    text: 'text-[var(--field-meta-fg)]',
  },
  id: {
    pill: 'border-[var(--field-id-bd)] bg-[var(--field-id-bg)] text-[var(--field-id-fg)]',
    dot: 'bg-[var(--field-id-dot)]',
    text: 'text-[var(--field-id-fg)]',
  },
};

const CATEGORY_SEGMENT_COLORS = [
  'var(--status-canary-dot)',
  'var(--status-running-dot)',
  'var(--status-pending-dot)',
  'var(--destructive)',
  'var(--primary)',
  'var(--muted-foreground)',
];

function getCategorySegmentColor(index: number) {
  return CATEGORY_SEGMENT_COLORS[index % CATEGORY_SEGMENT_COLORS.length] ?? 'var(--primary)';
}

function formatPercent(value: number, language: Language) {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)}%`;
}

export function RolePill({
  role,
  className,
  size = 'default',
}: {
  role: DatasetFieldRole;
  className?: string;
  size?: 'default' | 'micro';
}) {
  const { t } = useI18n();
  const style = ROLE_STYLES[role];
  const sizeClass =
    size === 'micro'
      ? 'gap-1 rounded-[4px] border px-1.5 py-0 font-mono text-[10px] font-medium leading-[14px]'
      : 'gap-1.5 rounded-[5px] border px-2 py-0.5 font-mono text-[11px] font-medium leading-4';

  return (
    <span
      data-testid={size === 'micro' ? 'role-pill-micro' : 'role-pill'}
      className={cn('inline-flex items-center', sizeClass, style.pill, className)}
    >
      <span className={cn('size-1.5 rounded-full', style.dot)} />
      {t(DATASET_ROLE_LABEL_KEYS[role])}
    </span>
  );
}

export function RoleArrowLabel({ role }: { role: DatasetFieldRole }) {
  const { t } = useI18n();

  return (
    <span className={cn('font-mono text-[10px] font-normal', ROLE_STYLES[role].text)}>
      {'->'} {t(DATASET_ROLE_LABEL_KEYS[role])}
    </span>
  );
}

function modalityToKind(modality: DatasetModality): ModalityKind {
  return modality;
}

export function ModalityBadge({ modalities }: { modalities: DatasetModality[] }) {
  const { t } = useI18n();
  if (modalities.length === 0) return null;
  const tooltips: Partial<Record<ModalityKind, string>> = {};
  const ariaLabels: Partial<Record<ModalityKind, string>> = {};
  for (const modality of modalities) {
    const kind = modalityToKind(modality);
    const label = t(DATASET_MODALITY_LABEL_KEYS[modality]);
    tooltips[kind] = label;
    ariaLabels[kind] = label;
  }
  const kinds = modalities.map(modalityToKind);
  return <ModalityIconGroup kinds={kinds} tooltips={tooltips} ariaLabels={ariaLabels} />;
}

export function DeletedBadge() {
  const { t } = useI18n();

  return (
    <span className="status-archived inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium">
      <span className="dot-archived size-1.5 rounded-full" />
      {t('datasets.status.deleted')}
    </span>
  );
}

export function SelectionBox({
  checked,
  indeterminate = false,
  disabled = false,
  ariaLabel,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onClick: () => void;
}) {
  const filled = checked || indeterminate;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-[3px] border transition-colors',
        filled ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/50 bg-background',
        disabled && 'cursor-not-allowed opacity-40',
      )}
      aria-pressed={checked}
      data-state={indeterminate ? 'indeterminate' : checked ? 'checked' : 'unchecked'}
      aria-label={ariaLabel}
    >
      {indeterminate ? <Minus className="size-3" /> : checked ? <Check className="size-3" /> : null}
    </button>
  );
}

export function ImageThumb({ large = false }: { large?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md border border-[var(--modality-image-bd)] bg-[var(--modality-image-bg)] text-[var(--modality-image-fg)]',
        large ? 'size-14' : 'size-8',
      )}
    >
      <ImageIcon className={large ? 'size-6' : 'size-4'} />
    </span>
  );
}

export { ImagePreviewDialog, isRenderableImage };

export function ImageCell({
  value,
  fieldName,
  onPreview,
  imageCount = 1,
  size = 'cell',
}: {
  value: string;
  fieldName: string;
  onPreview: () => void;
  imageCount?: number;
  size?: 'cell' | 'inline';
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const renderable = isRenderableImage(value) && !failed;
  const trimmed = value.trim();
  const extraCount = Math.max(0, imageCount - 1);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onPreview();
      }}
      className={cn(
        'group flex items-center gap-2 rounded-md text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        size === 'inline' ? 'p-1' : 'p-0.5',
      )}
      aria-label={`${t('datasets.detail.imagePreview')}: ${fieldName}${imageCount > 1 ? ` (${imageCount})` : ''}`}
    >
      <span className="relative inline-flex shrink-0 overflow-hidden rounded-md">
        {renderable ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trimmed}
            alt={fieldName}
            onError={() => setFailed(true)}
            className="size-8 rounded-md border border-border object-cover bg-muted"
          />
        ) : (
          <ImageThumb />
        )}
        {extraCount > 0 && (
          <span className="absolute bottom-0 right-0 rounded-tl-md bg-background/95 px-1 py-0.5 font-mono text-[10px] font-semibold text-foreground shadow-sm">
            +{extraCount}
          </span>
        )}
        <ImageZoomHoverOverlay className="rounded-md" />
      </span>
      <span className="min-w-0 max-w-[140px] truncate font-mono text-[11.5px] text-muted-foreground">
        {trimmed || '-'}
      </span>
    </button>
  );
}

export function CategoryDistribution({ profile }: { profile: DatasetCategoryProfile }) {
  const { language, t } = useI18n();

  if (profile.slices.length === 0) {
    const hasExpectedOutput = Boolean(profile.field || profile.openOutput);
    const Icon = hasExpectedOutput ? Info : AlertTriangle;
    const label = hasExpectedOutput
      ? t('datasets.category.noDistribution').replace('{field}', profile.field ?? t('datasets.legend.openText'))
      : t('datasets.category.openOutput');

    return (
      <div className="space-y-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px]',
            hasExpectedOutput
              ? 'border-[var(--field-expected-yes-bd)] bg-[var(--field-expected-yes-bg)] text-[var(--field-expected-yes-fg)]'
              : 'border-[var(--field-expected-no-bd)] bg-[var(--field-expected-no-bg)] text-[var(--field-expected-no-fg)]',
          )}
        >
          <Icon className="size-3" />
          {label}
        </span>
      </div>
    );
  }

  const total = profile.total ?? profile.slices.reduce((sum, slice) => sum + slice.count, 0);

  return (
    <div className="min-w-[260px] space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span className="font-mono font-medium text-foreground">
          {profile.slices.length} {t('datasets.category.classes')}
        </span>
        <span className="font-mono">
          {formatCount(total)} {t('datasets.samples')}
        </span>
      </div>
      <TooltipProvider delayDuration={120}>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" data-testid="dataset-category-distribution">
          {profile.slices.map((slice, index) => (
            <Tooltip key={`${slice.label}-${index}`}>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="h-full min-w-px outline-none ring-ring transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  style={{ flexGrow: slice.count, flexBasis: 0, background: getCategorySegmentColor(index) }}
                  aria-label={`${slice.label}: ${formatCount(slice.count)}, ${formatPercent(slice.percent, language)}`}
                  data-testid="dataset-category-segment"
                  data-category-label={slice.label}
                />
              </TooltipTrigger>
              <TooltipContent className="space-y-1 text-xs">
                <div className="font-medium">{slice.label}</div>
                <div className="font-mono text-muted-foreground">
                  {t('datasets.category.tooltipCount')}: {formatCount(slice.count)}
                </div>
                <div className="font-mono text-muted-foreground">
                  {t('datasets.category.tooltipPercent')}: {formatPercent(slice.percent, language)}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}

export function ReferenceText({ dataset }: { dataset: ProjectDataset }) {
  const { t } = useI18n();
  const pieces: string[] = [];

  if (dataset.references.experiments > 0) {
    pieces.push(`${dataset.references.experiments} ${t('datasets.referenceExperiment')}`);
  }

  if (dataset.references.optimizations > 0) {
    pieces.push(`${dataset.references.optimizations} ${t('datasets.referenceOptimization')}`);
  }

  if (dataset.references.completedExperiments && dataset.references.completedExperiments > 0) {
    pieces.push(`${dataset.references.completedExperiments} ${t('datasets.referenceCompletedExperiment')}`);
  }

  return (
    <span className={cn('whitespace-nowrap font-mono text-[11.5px]', pieces.length === 0 && 'text-muted-foreground')}>
      {pieces.length > 0 ? pieces.join(' · ') : t('datasets.noReferences')}
    </span>
  );
}

export function ExportFormatMenu({
  size = 'sm',
  variant = 'outline',
  disabled = false,
  onExport,
}: {
  size?: 'sm' | 'default';
  variant?: 'outline' | 'default';
  disabled?: boolean;
  onExport?: (format: DatasetExportFormatDto) => void;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          className={cn(size === 'sm' && 'h-8')}
          disabled={disabled || !onExport}
        >
          <Download className="size-4" />
          {t('datasets.download')}
          <ChevronDown className="size-3 opacity-80" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('datasets.exportFormat')}</DropdownMenuLabel>
        <DropdownMenuItem disabled={disabled || !onExport} onSelect={() => onExport?.('csv')}>
          <FileSpreadsheet className="size-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm">{t('datasets.exportCsv')}</div>
            <div className="text-[11px] text-muted-foreground">{t('datasets.exportCsvHelp')}</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled || !onExport} onSelect={() => onExport?.('jsonl')}>
          <FileJson className="size-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm">{t('datasets.exportJsonl')}</div>
            <div className="text-[11px] text-muted-foreground">{t('datasets.exportJsonlHelp')}</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="items-start">
          <Info className="mt-0.5 size-4" />
          <span className="text-[11.5px] leading-4">{t('datasets.exportStorageNote')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function formatSize(sizeMb: number) {
  if (!Number.isFinite(sizeMb) || sizeMb <= 0) return '0 B';
  const bytes = sizeMb * 1024 * 1024;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (sizeMb < 1024) return sizeMb >= 10 ? `${Math.round(sizeMb)} MB` : `${sizeMb.toFixed(1)} MB`;
  return `${(sizeMb / 1024).toFixed(2)} GB`;
}

export function formatCount(value: number) {
  return value.toLocaleString('zh-CN').replace(/,/g, ' ');
}

export function saveBlobAsFile(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
