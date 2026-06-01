'use client';

import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { cn } from '@proofhound/ui';

export type ModelProbeFeedback = {
  status: 'running' | 'success' | 'failed';
  durationMs: number | null;
  errorMessage?: string | null;
};

export function formatModelProbeDuration(durationMs: number | null): string {
  if (durationMs == null) return '--';
  const roundedMs = Math.max(0, Math.round(durationMs));
  if (roundedMs < 1000) return `${roundedMs} ms`;
  const seconds = roundedMs / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)} s`;
}

export function ModelProbeStatus({
  feedback,
  className,
}: {
  feedback: ModelProbeFeedback | null;
  className?: string;
}) {
  const { t } = useI18n();

  if (!feedback) return null;

  const isRunning = feedback.status === 'running';
  const isSuccess = feedback.status === 'success';
  const Icon = isRunning ? Loader2 : isSuccess ? Check : AlertTriangle;
  const title = isRunning
    ? t('models.probe.running')
    : isSuccess
      ? t('models.probe.successTitle')
      : t('models.probe.failedTitle');
  const detail = isRunning
    ? t('models.probe.runningDetail')
    : isSuccess
      ? `${t('models.probe.successDetail')} · ${formatModelProbeDuration(feedback.durationMs)}`
      : `${feedback.errorMessage?.trim() || t('models.probe.failedDetail')} · ${formatModelProbeDuration(feedback.durationMs)}`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="model-probe-status"
      className={cn(
        'flex max-w-full items-start gap-2 rounded-md border px-3 py-2 text-[12.5px] leading-relaxed',
        isRunning && 'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
        isSuccess && 'border-[var(--status-running-bd)] bg-[var(--status-running-bg)] text-[var(--status-running-fg)]',
        feedback.status === 'failed' && 'border-destructive/40 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', isRunning && 'animate-spin')} />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 font-mono text-[11px] opacity-85">{detail}</div>
      </div>
    </div>
  );
}
