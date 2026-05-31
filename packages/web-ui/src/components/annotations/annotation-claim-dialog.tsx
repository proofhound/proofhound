'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  cn,
} from '@proofhound/ui';
import { useI18n } from '../../i18n';
export const MAX_ANNOTATION_CLAIM_BATCH_SIZE = 100;

const PRESETS = [5, 10, 20, 50];

export function getDefaultAnnotationClaimSize(maxClaimable: number | null | undefined): number {
  if (maxClaimable === null || maxClaimable === undefined) return 0;
  return Math.min(MAX_ANNOTATION_CLAIM_BATCH_SIZE, Math.max(0, Math.floor(maxClaimable)));
}

export function AnnotationClaimDialog({
  open,
  onOpenChange,
  inputId,
  maxClaimable,
  isLoadingMax = false,
  isPending = false,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputId: string;
  maxClaimable: number | null | undefined;
  isLoadingMax?: boolean;
  isPending?: boolean;
  onSubmit?: (batchSize: number) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const defaultClaimSize = getDefaultAnnotationClaimSize(maxClaimable);
  const contentKey = `${open ? 'open' : 'closed'}:${isLoadingMax ? 'loading' : defaultClaimSize}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnnotationClaimDialogContent
        key={contentKey}
        inputId={inputId}
        defaultClaimSize={defaultClaimSize}
        isLoadingMax={isLoadingMax}
        isPending={isPending}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onOpenChange={onOpenChange}
        title={t('annotations.claim.title')}
        batchSizeLabel={t('annotations.claim.batchSize')}
        presetLabel={t('annotations.claim.preset')}
        summaryTemplate={t('annotations.claim.summary')}
        submitLabel={t('annotations.claim.submit')}
        cancelLabel={t('annotations.claim.cancel')}
      />
    </Dialog>
  );
}

function AnnotationClaimDialogContent({
  inputId,
  defaultClaimSize,
  isLoadingMax,
  isPending,
  onSubmit,
  onCancel,
  onOpenChange,
  title,
  batchSizeLabel,
  presetLabel,
  summaryTemplate,
  submitLabel,
  cancelLabel,
}: {
  inputId: string;
  defaultClaimSize: number;
  isLoadingMax: boolean;
  isPending: boolean;
  onSubmit?: (batchSize: number) => void | Promise<void>;
  onCancel?: () => void;
  onOpenChange: (open: boolean) => void;
  title: string;
  batchSizeLabel: string;
  presetLabel: string;
  summaryTemplate: string;
  submitLabel: string;
  cancelLabel: string;
}) {
  const [batchSizeInput, setBatchSizeInput] = useState(String(defaultClaimSize));

  const presetOptions = useMemo(() => {
    const options = new Set(PRESETS);
    if (defaultClaimSize > 0) options.add(defaultClaimSize);
    return Array.from(options).sort((a, b) => a - b);
  }, [defaultClaimSize]);

  const parsedBatchSize = Number(batchSizeInput);
  const normalizedBatchSize =
    Number.isInteger(parsedBatchSize) && parsedBatchSize >= 0 ? parsedBatchSize : 0;
  const summaryCount =
    batchSizeInput.trim().length === 0 || !Number.isFinite(parsedBatchSize)
      ? 0
      : Math.max(0, Math.floor(parsedBatchSize));
  const canSubmit =
    Boolean(onSubmit) &&
    !isPending &&
    !isLoadingMax &&
    normalizedBatchSize >= 1 &&
    normalizedBatchSize <= defaultClaimSize;

  async function handleSubmit() {
    if (!onSubmit || !canSubmit) return;
    await onSubmit(normalizedBatchSize);
  }

  function handleCancel() {
    if (onCancel) {
      onCancel();
      return;
    }
    onOpenChange(false);
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{batchSizeLabel}</Label>
          <Input
            id={inputId}
            type="number"
            min={defaultClaimSize > 0 ? 1 : 0}
            max={defaultClaimSize}
            value={batchSizeInput}
            onChange={(event) => {
              setBatchSizeInput(event.target.value);
            }}
            className="max-w-[120px] font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{presetLabel}</div>
          <div className="flex flex-wrap gap-1.5">
            {presetOptions.map((preset) => {
              const disabled = preset > defaultClaimSize || defaultClaimSize === 0;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setBatchSizeInput(String(preset));
                  }}
                  className={cn(
                    'inline-flex cursor-pointer items-center rounded-full border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
                    normalizedBatchSize === preset && !disabled
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent',
                  )}
                >
                  {preset}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {summaryTemplate.replace('{count}', String(summaryCount))}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={handleCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          {isPending ? '...' : submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
