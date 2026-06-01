'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, Clock3, PauseCircle, RadioTower } from 'lucide-react';
import { Progress, formatProgressLabel, cn } from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../../i18n';
import { formatDateTime } from '../../lib';
import type { AnnotationTaskStatus, AnnotationTaskView } from './annotation-task-model';

export function formatCount(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-US');
}

export function formatPercent(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDateTimeOrDash(value: string | null | undefined) {
  return value ? formatDateTime(value) : '-';
}

export function AnnotationMetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'neutral' | 'active' | 'success';
  testId?: string;
}) {
  const style =
    tone === 'active'
      ? {
          background: 'color-mix(in srgb, var(--status-canary-dot) 4%, var(--card))',
          borderColor: 'color-mix(in srgb, var(--status-canary-dot) 28%, var(--border))',
        }
      : tone === 'success'
        ? {
            background: 'color-mix(in srgb, var(--status-running-dot) 4%, var(--card))',
            borderColor: 'color-mix(in srgb, var(--status-running-dot) 30%, var(--border))',
          }
        : undefined;

  return (
    <div className="rounded-lg border bg-card px-4 py-3" style={style} data-testid={testId}>
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div
        className="mt-1 font-mono text-[26px] font-semibold leading-none tabular-nums"
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </div>
      {detail ? <div className="mt-1.5 text-[11.5px] text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function taskStatusKey(status: AnnotationTaskStatus): TranslationKey {
  switch (status) {
    case 'active':
      return 'annotations.status.active';
    case 'completed':
      return 'annotations.status.completed';
    case 'archived':
      return 'annotations.status.archived';
  }
}

export function AnnotationTaskStatusBadge({ status, className }: { status: AnnotationTaskStatus; className?: string }) {
  const { t } = useI18n();
  const token =
    status === 'completed'
      ? {
          bg: 'var(--status-running-bg)',
          fg: 'var(--status-running-fg)',
          bd: 'var(--status-running-bd)',
          dot: 'var(--status-running-dot)',
        }
      : status === 'archived'
        ? {
            bg: 'var(--status-archived-bg)',
            fg: 'var(--status-archived-fg)',
            bd: 'var(--status-archived-bd)',
            dot: 'var(--status-archived-dot)',
          }
        : {
            bg: 'var(--status-canary-bg)',
            fg: 'var(--status-canary-fg)',
            bd: 'var(--status-canary-bd)',
            dot: 'var(--status-canary-dot)',
          };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-[18px]',
        className,
      )}
      style={{ background: token.bg, color: token.fg, borderColor: token.bd }}
    >
      <i className="inline-block size-1.5 rounded-full" style={{ background: token.dot }} />
      {t(taskStatusKey(status))}
    </span>
  );
}

export function AnnotationScopeBadge({ scope = 'canary' }: { scope?: AnnotationTaskView['scope'] }) {
  const { t } = useI18n();
  const isOnline = scope === 'online';
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4"
      style={{
        background: isOnline ? 'var(--src-prod-soft)' : 'var(--status-canary-bg)',
        color: isOnline ? 'var(--src-prod-fg)' : 'var(--status-canary-fg)',
        borderColor: isOnline ? 'color-mix(in srgb, var(--src-prod) 30%, transparent)' : 'var(--status-canary-bd)',
      }}
    >
      {t(isOnline ? 'annotations.scope.online' : 'annotations.scope.canary')}
    </span>
  );
}

export function AnnotationProgressBlock({ task }: { task: AnnotationTaskView }) {
  const { t } = useI18n();
  return (
    <div className="min-w-[180px]">
      <Progress
        value={task.submitted}
        max={Math.max(1, task.total)}
        label={formatProgressLabel({
          value: task.submitted,
          max: Math.max(1, task.total),
        })}
      />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
        <span>
          {t('annotations.progress.pending')}: {formatCount(task.pending)}
        </span>
        <span>
          {t('annotations.progress.claimed')}: {formatCount(task.claimed)}
        </span>
      </div>
    </div>
  );
}

export function AnnotationStepCard({
  active,
  done,
  title,
  detail,
  icon,
}: {
  active?: boolean;
  done?: boolean;
  title: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4',
        active && 'border-[var(--status-canary-bd)] bg-[color-mix(in_oklab,var(--status-canary-bg)_35%,var(--card))]',
        done && 'border-[var(--status-running-bd)] bg-[color-mix(in_oklab,var(--status-running-bg)_30%,var(--card))]',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'inline-flex size-9 flex-none items-center justify-center rounded-md border bg-background text-muted-foreground',
            active && 'border-[var(--status-canary-bd)] text-[var(--status-canary-fg)]',
            done && 'border-[var(--status-running-bd)] text-[var(--status-running-fg)]',
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="mt-1 text-[12px] leading-5 text-muted-foreground">{detail}</div>
        </div>
      </div>
    </div>
  );
}

export function AnnotationLifecycle({ task }: { task?: AnnotationTaskView | null }) {
  const { t } = useI18n();
  const hasSamples = Boolean(task && task.total > 0);
  const hasClaimed = Boolean(task && task.claimed > 0);
  const done = Boolean(task && task.total > 0 && task.submitted >= task.total);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <AnnotationStepCard
        active={!task}
        done={Boolean(task)}
        icon={<RadioTower className="size-4" />}
        title={t('annotations.lifecycle.source')}
        detail={task?.sourceName ?? t('annotations.lifecycle.sourceEmpty')}
      />
      <AnnotationStepCard
        active={Boolean(task) && !hasSamples}
        done={hasSamples}
        icon={<Clock3 className="size-4" />}
        title={t('annotations.lifecycle.sample')}
        detail={task ? t('annotations.lifecycle.sampleDetail').replace('{count}', formatCount(task.total)) : '-'}
      />
      <AnnotationStepCard
        active={hasSamples && !done}
        done={hasClaimed}
        icon={<PauseCircle className="size-4" />}
        title={t('annotations.lifecycle.claim')}
        detail={task ? t('annotations.lifecycle.claimDetail').replace('{count}', formatCount(task.claimed)) : '-'}
      />
      <AnnotationStepCard
        done={done}
        icon={<CheckCircle2 className="size-4" />}
        title={t('annotations.lifecycle.submit')}
        detail={task ? t('annotations.lifecycle.submitDetail').replace('{count}', formatCount(task.submitted)) : '-'}
      />
    </div>
  );
}
