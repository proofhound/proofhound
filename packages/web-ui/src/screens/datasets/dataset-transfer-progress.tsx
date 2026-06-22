'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DatasetTransferProgress as ApiTransferProgress } from '@proofhound/api-client';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Progress, formatProgressLabel, cn } from '@proofhound/ui';
import { useI18n } from '../../i18n';
type TransferStatus = 'running' | 'success' | 'error';

interface DatasetTransferState {
  title: string;
  description?: string;
  status: TransferStatus;
  loadedBytes: number;
  totalBytes: number | null;
  percentOverride: number | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface DatasetTransferSnapshot extends DatasetTransferState {
  elapsedMs: number;
  percent: number | null;
  remainingMs: number | null;
}

function now() {
  return Date.now();
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function formatDuration(ms: number, lessThanSecondLabel: string) {
  if (ms < 1000) return lessThanSecondLabel;

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function useDatasetTransferProgress() {
  const [state, setState] = useState<DatasetTransferState | null>(null);
  const [clock, setClock] = useState(now);

  useEffect(() => {
    if (state?.status !== 'running') return undefined;

    const timer = window.setInterval(() => setClock(now()), 500);
    return () => window.clearInterval(timer);
  }, [state?.status]);

  const start = useCallback((title: string, totalBytes?: number | null, description?: string) => {
    const startedAt = now();
    setClock(startedAt);
    setState({
      title,
      description,
      status: 'running',
      loadedBytes: 0,
      totalBytes: totalBytes ?? null,
      percentOverride: null,
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
    });
  }, []);

  const update = useCallback((progress: ApiTransferProgress) => {
    setState((current) => {
      if (!current) return current;

      return {
        ...current,
        loadedBytes: Math.max(current.loadedBytes, progress.loadedBytes),
        totalBytes: progress.totalBytes ?? current.totalBytes,
        percentOverride: null,
        updatedAt: now(),
      };
    });
  }, []);

  const setMessage = useCallback((title: string, description?: string, percentOverride?: number | null) => {
    setState((current) => {
      if (!current) return current;
      return {
        ...current,
        title,
        description,
        percentOverride:
          percentOverride === undefined
            ? current.percentOverride
            : percentOverride === null
              ? null
              : clampPercent(percentOverride),
        updatedAt: now(),
      };
    });
  }, []);

  const complete = useCallback((loadedBytes?: number) => {
    setState((current) => {
      if (!current) return current;

      const finishedAt = now();
      const nextLoadedBytes = loadedBytes ?? current.totalBytes ?? current.loadedBytes;

      return {
        ...current,
        status: 'success',
        loadedBytes: nextLoadedBytes,
        totalBytes: current.totalBytes ?? nextLoadedBytes,
        percentOverride: null,
        updatedAt: finishedAt,
        finishedAt,
      };
    });
  }, []);

  const fail = useCallback(() => {
    setState((current) => {
      if (!current) return current;
      const finishedAt = now();
      return {
        ...current,
        status: 'error',
        percentOverride: null,
        updatedAt: finishedAt,
        finishedAt,
      };
    });
  }, []);

  const reset = useCallback(() => setState(null), []);

  const progress = useMemo<DatasetTransferSnapshot | null>(() => {
    if (!state) return null;

    const referenceTime = state.status === 'running' ? clock : (state.finishedAt ?? state.updatedAt);
    const elapsedMs = Math.max(0, referenceTime - state.startedAt);
    const measuredPercent =
      state.totalBytes && state.totalBytes > 0
        ? clampPercent((state.loadedBytes / state.totalBytes) * 100)
        : state.status === 'success'
          ? 100
          : null;
    const percent = state.percentOverride ?? measuredPercent;
    const remainingMs =
      state.status === 'running' && percent !== null && percent > 0 && percent < 100
        ? (elapsedMs / percent) * (100 - percent)
        : null;

    return {
      ...state,
      elapsedMs,
      percent,
      remainingMs,
    };
  }, [clock, state]);

  return { complete, fail, progress, reset, setMessage, start, update };
}

export function DatasetTransferProgressPanel({
  progress,
  className,
}: {
  progress: DatasetTransferSnapshot | null;
  className?: string;
}) {
  const { t } = useI18n();

  if (!progress) return null;

  const Icon = progress.status === 'success' ? CheckCircle2 : progress.status === 'error' ? AlertTriangle : Loader2;
  const statusLabel =
    progress.status === 'success'
      ? t('datasets.transfer.completed')
      : progress.status === 'error'
        ? t('datasets.transfer.failed')
        : progress.percent === null
          ? t('datasets.transfer.calculating')
          : `${Math.round(progress.percent)}%`;
  const loadedLabel = progress.totalBytes
    ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}`
    : formatBytes(progress.loadedBytes);
  const usesPercentOverride = progress.percentOverride !== null;
  const progressLabel =
    progress.percent !== null && progress.totalBytes && !usesPercentOverride
      ? formatProgressLabel({
          value: progress.loadedBytes,
          max: progress.totalBytes,
          percent: progress.percent,
          valueLabel: formatBytes(progress.loadedBytes),
          maxLabel: formatBytes(progress.totalBytes),
        })
      : statusLabel;
  const remainingLabel =
    progress.remainingMs === null
      ? progress.status === 'success'
        ? formatDuration(0, t('datasets.transfer.lessThanSecond'))
        : t('datasets.transfer.calculating')
      : formatDuration(progress.remainingMs, t('datasets.transfer.lessThanSecond'));
  const timingLabel = formatTemplate(t('common.progress.timing'), {
    elapsed: formatDuration(progress.elapsedMs, t('datasets.transfer.lessThanSecond')),
    remaining: remainingLabel,
  });

  return (
    <div className={cn('rounded-lg border bg-card p-3 shadow-sm', className)} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon
            className={cn(
              'mt-0.5 size-4 shrink-0',
              progress.status === 'running' && 'animate-spin text-[var(--status-running-fg)]',
              progress.status === 'success' && 'text-[var(--status-running-fg)]',
              progress.status === 'error' && 'text-destructive',
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{progress.title}</div>
            {progress.description ? (
              <div className="mt-0.5 truncate text-[11.5px] font-normal text-muted-foreground">
                {progress.description}
              </div>
            ) : null}
          </div>
        </div>
        <span className="font-mono text-[12px] text-muted-foreground">{statusLabel}</span>
      </div>
      <Progress
        value={progress.percent ?? 0}
        indeterminate={progress.percent === null && progress.status === 'running'}
        label={progressLabel}
        className="mt-3"
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="font-mono">{timingLabel}</span>
        <span>
          {t('datasets.transfer.size')}: <b className="font-mono text-foreground">{loadedLabel}</b>
        </span>
      </div>
    </div>
  );
}
