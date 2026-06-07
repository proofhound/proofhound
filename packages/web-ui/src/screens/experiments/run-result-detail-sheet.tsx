'use client';

import { useState, type ReactNode } from 'react';
import { Copy, X } from 'lucide-react';
import {
  Button,
  ImagePreviewDialog,
  ImageZoomHoverOverlay,
  isRenderableImage,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  cn,
} from '@proofhound/ui';
import { useI18n } from '../../i18n';
import { useRunResult } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { experimentTone } from './experiment-theme';
import {
  formatRunResultFailureReason,
  getBinaryRunResultJudgmentStatus,
  getRunResultJudgmentLabelKey,
  getRunResultStatusLabelKey,
} from './run-result-labels';
import {
  compactHumanValue,
  datasetFieldDisplays,
  formatHumanValue,
  getRenderedPromptMessages,
  isRecord,
  parseJsonString,
  type VariableDisplay,
} from './run-result-display';

interface Props {
  projectId: string;
  experimentId: string;
  runResultId: string | null;
  onClose: () => void;
}

export function RunResultDetailSheet({ projectId, experimentId, runResultId, onClose }: Props) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const open = Boolean(runResultId);
  const { data: detail, isLoading, error } = useRunResult(projectId, experimentId, runResultId);
  const [imagePreview, setImagePreview] = useState<{ field: string; value: string } | null>(null);

  const imagePreviewLabel = t('datasets.detail.imagePreview');
  const imageFailedLabel = t('experiments.detail.samples.image.failed');

  const handleCopy = (value: unknown) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    void navigator.clipboard.writeText(text ?? '');
  };

  const statusLabel = detail ? t(getRunResultStatusLabelKey(detail.status)) : '';
  const judgmentLabel = detail ? t(getRunResultJudgmentLabelKey(detail)) : '—';
  const judgmentStatus = detail ? getBinaryRunResultJudgmentStatus(detail) : null;
  const failureReason = detail ? formatRunResultFailureReason(detail, t) : null;
  const parsedRawResponse = detail ? parseJsonString(detail.rawResponse) : null;
  const modelOutput =
    detail?.parsedOutput ?? parsedRawResponse ?? detail?.rawResponse ?? detail?.decisionOutput ?? null;
  const textVariables = detail ? datasetFieldDisplays(detail.datasetTextFields, 'text') : [];
  const imageVariables = detail ? datasetFieldDisplays(detail.datasetImageFields, 'image') : [];

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" showClose={false} className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center justify-between gap-2">
            <span>{t('experiments.detail.runResultSheet.title')}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 cursor-pointer"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <X className="size-4" />
            </Button>
          </SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="flex flex-col gap-4 pb-6" aria-busy="true">
            <section className="rounded-md border bg-muted/35 p-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </section>
            <Skeleton className="h-40 rounded-md" />
          </div>
        )}
        {error && (
          <p className={cn('px-1 py-6 text-[12.5px]', experimentTone.danger.text)}>
            {t('experiments.detail.runResultSheet.loadFailed')}
          </p>
        )}

        {detail && (
          <div className="flex flex-col gap-4 pb-6">
            <section className="rounded-md border bg-muted/35 p-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                <DT
                  label={t('experiments.detail.runResultSheet.externalId')}
                  value={detail.externalId ?? detail.sampleId ?? '—'}
                  mono
                />
                <DT
                  label={t('experiments.detail.runResultSheet.status')}
                  value={statusLabel}
                  tone={detail.status === 'success' ? 'positive' : 'danger'}
                />
                <DT
                  label={t('experiments.detail.runResultSheet.judgment')}
                  value={judgmentLabel}
                  tone={judgmentStatus === 'correct' ? 'positive' : judgmentStatus === 'incorrect' ? 'danger' : undefined}
                />
                <DT label={t('experiments.detail.runResultSheet.decision')} value={detail.decisionOutput ?? '—'} />
                <DT label={t('experiments.detail.runResultSheet.expected')} value={detail.expectedOutput ?? '—'} />
                <DT label={t('experiments.detail.runResultSheet.attempt')} value={String(detail.attempt)} />
                <DT
                  label={t('experiments.detail.runResultSheet.latency')}
                  value={detail.latencyMs !== null ? `${detail.latencyMs} ms` : '—'}
                />
                <DT
                  label={t('experiments.detail.runResultSheet.tokens')}
                  value={`${detail.inputTokens ?? 0} / ${detail.outputTokens ?? 0}`}
                />
                <DT
                  label={t('experiments.detail.runResultSheet.cost')}
                  value={detail.costEstimate !== null ? `$${detail.costEstimate.toFixed(6)}` : '—'}
                />
                <DT label={t('experiments.detail.runResultSheet.createdAt')} value={formatDateTime(detail.createdAt)} />
              </dl>
              <div className="mt-3 border-t pt-2">
                <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12px]">
                  <DT label={t('experiments.detail.runResultSheet.id')} value={detail.id} mono />
                </dl>
              </div>
            </section>

            {failureReason && (
              <section
                className={cn(
                  'rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[12px]',
                  experimentTone.danger.text,
                )}
              >
                {detail.errorClass && (
                  <p className="mb-1 font-mono text-[10.5px] uppercase tracking-wide">{detail.errorClass}</p>
                )}
                <p className="break-words text-foreground">{failureReason}</p>
              </section>
            )}

            <ReadableSection
              title={t('experiments.detail.runResultSheet.inputVariables')}
              copyLabel={t('experiments.detail.runResultSheet.copy')}
              copyValue={detail.inputVariables}
              onCopy={handleCopy}
            >
              <VariableGroup
                title={t('experiments.detail.samples.col.textVariables')}
                variables={textVariables}
                imageFailedLabel={imageFailedLabel}
                imagePreviewLabel={imagePreviewLabel}
                onPreviewImage={setImagePreview}
              />
              <VariableGroup
                title={t('experiments.detail.samples.col.imageVariables')}
                variables={imageVariables}
                imageFailedLabel={imageFailedLabel}
                imagePreviewLabel={imagePreviewLabel}
                onPreviewImage={setImagePreview}
              />
            </ReadableSection>

            <ReadableSection
              title={t('experiments.detail.runResultSheet.modelOutput')}
              copyLabel={t('experiments.detail.runResultSheet.copy')}
              copyValue={modelOutput}
              onCopy={handleCopy}
            >
              <ReadableValue value={modelOutput} />
            </ReadableSection>

            {detail.rawResponse && detail.parsedOutput !== null && (
              <ReadableSection
                title={t('experiments.detail.runResultSheet.rawResponse')}
                copyLabel={t('experiments.detail.runResultSheet.copy')}
                copyValue={detail.rawResponse}
                onCopy={handleCopy}
              >
                <ReadableValue value={parsedRawResponse ?? detail.rawResponse} />
              </ReadableSection>
            )}

            <ReadableSection
              title={t('experiments.detail.runResultSheet.renderedPrompt')}
              copyLabel={t('experiments.detail.runResultSheet.copy')}
              copyValue={detail.renderedPrompt}
              onCopy={handleCopy}
            >
              <RenderedPromptView value={detail.renderedPrompt} />
            </ReadableSection>
          </div>
        )}
      </SheetContent>
      <ImagePreviewDialog
        open={imagePreview !== null}
        onOpenChange={(next) => {
          if (!next) setImagePreview(null);
        }}
        fieldName={imagePreview?.field ?? ''}
        value={imagePreview?.value ?? ''}
      />
    </Sheet>
  );
}

function ImageVariableThumb({
  src,
  fieldName,
  failedLabel,
  previewLabel,
  onPreview,
}: {
  src: string;
  fieldName: string;
  failedLabel: string;
  previewLabel: string;
  onPreview: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const renderable = isRenderableImage(src) && !failed;
  if (!renderable) {
    return (
      <button
        type="button"
        onClick={onPreview}
        aria-label={`${previewLabel}: ${fieldName}`}
        className="group relative inline-flex h-14 w-[112px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed text-[10.5px] text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        {failedLabel}
        <ImageZoomHoverOverlay className="rounded-md" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onPreview}
      aria-label={`${previewLabel}: ${fieldName}`}
      className="group relative inline-flex shrink-0 cursor-pointer overflow-hidden rounded-md transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={fieldName}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-14 w-[112px] rounded-md border bg-muted/30 object-cover"
      />
      <ImageZoomHoverOverlay className="rounded-md" />
    </button>
  );
}

function DT({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'positive' | 'danger';
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'break-words',
          mono && 'font-mono text-[11.5px]',
          tone === 'positive' && experimentTone.positive.text,
          tone === 'danger' && experimentTone.danger.text,
        )}
      >
        {value}
      </dd>
    </>
  );
}

function ReadableSection({
  title,
  children,
  copyValue,
  copyLabel,
  onCopy,
}: {
  title: string;
  children: ReactNode;
  copyValue: unknown;
  copyLabel: string;
  onCopy: (value: unknown) => void;
}) {
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 cursor-pointer"
          aria-label={copyLabel}
          onClick={() => onCopy(copyValue)}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

function VariableGroup({
  title,
  variables,
  imageFailedLabel,
  imagePreviewLabel,
  onPreviewImage,
}: {
  title: string;
  variables: VariableDisplay[];
  imageFailedLabel: string;
  imagePreviewLabel: string;
  onPreviewImage: (preview: { field: string; value: string }) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{title}</div>
      {variables.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">—</p>
      ) : (
        <div className="space-y-2">
          {variables.map((variable) => {
            const hasImage = variable.kind === 'image' && Boolean(variable.imageSrc);
            const previewSrc = variable.imageSrc ?? '';
            return (
              <div key={variable.name} className="rounded-md border bg-muted/25 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{variable.name}</span>
                </div>
                {hasImage ? (
                  <div className="flex items-start gap-3">
                    <ImageVariableThumb
                      src={previewSrc}
                      fieldName={variable.name}
                      failedLabel={imageFailedLabel}
                      previewLabel={imagePreviewLabel}
                      onPreview={() => onPreviewImage({ field: variable.name, value: previewSrc })}
                    />
                    <code
                      className="block min-w-0 flex-1 break-all font-mono text-[11px] text-muted-foreground"
                      title={previewSrc}
                    >
                      {compactHumanValue(previewSrc, 120)}
                    </code>
                  </div>
                ) : (
                  <ReadableValue value={variable.rawValue} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RenderedPromptView({ value }: { value: unknown }) {
  const messages = getRenderedPromptMessages(value);
  if (messages.length === 0) {
    return <ReadableValue value={value} />;
  }
  return (
    <div className="space-y-2">
      {messages.map((message, index) => (
        <div key={`${message.role}-${index}`} className="rounded-md border bg-muted/25 p-2.5">
          <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {message.role}
          </div>
          <ReadableValue value={message.content} />
        </div>
      ))}
    </div>
  );
}

function ReadableValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const parsed = typeof value === 'string' ? parseJsonString(value) : null;
  const displayValue = parsed ?? value;

  if (depth > 3) {
    return <p className="break-words text-[12px] leading-relaxed">{compactHumanValue(displayValue, 240)}</p>;
  }

  if (displayValue === null || displayValue === undefined || typeof displayValue !== 'object') {
    return (
      <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">{formatHumanValue(displayValue)}</p>
    );
  }

  if (Array.isArray(displayValue)) {
    if (displayValue.length === 0) return <p className="text-[12px] text-muted-foreground">—</p>;
    return (
      <div className="space-y-2">
        {displayValue.map((item, index) => (
          <div key={index} className="rounded border bg-background px-2 py-1.5">
            <div className="mb-1 font-mono text-[10px] text-muted-foreground">#{index + 1}</div>
            <ReadableValue value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (!isRecord(displayValue)) {
    return <p className="break-words text-[12.5px]">{formatHumanValue(displayValue)}</p>;
  }

  const entries = Object.entries(displayValue);
  if (entries.length === 0) return <p className="text-[12px] text-muted-foreground">—</p>;

  return (
    <dl className="divide-y rounded-md border bg-background">
      {entries.map(([key, item]) => (
        <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-2.5 py-2">
          <dt className="break-words font-mono text-[11px] text-muted-foreground">{key}</dt>
          <dd className="min-w-0">
            <ReadableValue value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
