'use client';

import { Check } from 'lucide-react';
import { Progress, formatProgressNumber, cn } from '@proofhound/ui';
import { useI18n } from '../../i18n';
import {
  EXPERIMENT_STATUS_LABEL_KEYS,
  EXPERIMENT_STATUS_TONE,
  type ExperimentDisplayStatus,
  type ExperimentStatus,
} from './experiment-view-model';
import { experimentTone } from './experiment-theme';

export function ExperimentStatusBadge({
  status,
  compact = false,
}: {
  status: ExperimentDisplayStatus;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const tone = EXPERIMENT_STATUS_TONE[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium whitespace-nowrap',
        compact ? 'gap-1 px-1.5 py-0.5 text-[10.5px]' : 'gap-1.5 px-2 py-0.5 text-[11.5px]',
        tone.pill,
      )}
    >
      <span className={cn(compact ? 'size-1' : 'size-1.5', 'rounded-full', tone.dot, tone.pulse && 'animate-pulse')} />
      {t(EXPERIMENT_STATUS_LABEL_KEYS[status])}
    </span>
  );
}

export function SelectionBox({
  checked,
  ariaLabel,
  disabled,
  onClick,
}: {
  checked: boolean;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-[3px] border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/50 bg-background',
      )}
      aria-label={ariaLabel}
      aria-pressed={checked}
    >
      {checked && <Check className="size-3" />}
    </button>
  );
}

export function ProgressBar({
  percent,
  label,
}: {
  status: ExperimentDisplayStatus;
  percent: number;
  label: string;
  size?: 'sm' | 'md';
}) {
  const safePercent = Math.max(0, Math.min(100, percent));

  return <Progress value={safePercent} label={label} />;
}

export function formatPercent(part: number, total: number, fractionDigits = 0) {
  if (!total) return '0';
  return ((part / total) * 100).toFixed(fractionDigits);
}

export function formatNumber(value: number) {
  return formatProgressNumber(value);
}

export function ChipFilter({
  active,
  label,
  count,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  tone?: ExperimentStatus;
  onClick: () => void;
}) {
  const toneStyle = tone ? EXPERIMENT_STATUS_TONE[tone] : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {tone && toneStyle && (
        <span
          className={cn(
            'size-1.5 rounded-full',
            toneStyle.dot,
            toneStyle.pulse && !active && 'animate-pulse',
            active && 'bg-current opacity-90',
          )}
        />
      )}
      <span>{label}</span>
      <span className={cn('font-mono text-[11px]', active ? 'opacity-75' : 'text-muted-foreground')}>{count}</span>
    </button>
  );
}

export function Lineage({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="truncate font-mono text-[12.5px] text-foreground">{primary}</span>
      <span className="truncate font-mono text-[11px] text-muted-foreground">{secondary}</span>
    </div>
  );
}

export function MetricPair({
  primary,
  secondary,
  highlight,
}: {
  primary?: number;
  secondary?: number;
  highlight?: 'ok' | 'bad';
}) {
  if (typeof primary !== 'number' || typeof secondary !== 'number') {
    return (
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[13px] text-muted-foreground">—</span>
        <span className="font-mono text-[13px] text-muted-foreground">—</span>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className={cn(
          'font-mono text-[13px] font-semibold tabular-nums',
          highlight === 'ok' && experimentTone.positive.text,
          highlight === 'bad' && experimentTone.danger.text,
        )}
      >
        {primary.toFixed(3)}
      </span>
      <span className="font-mono text-[13px] font-medium tabular-nums">{secondary.toFixed(3)}</span>
    </div>
  );
}
