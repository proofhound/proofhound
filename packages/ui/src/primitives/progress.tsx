import { cn } from '../lib/utils';

function safeMax(max: number) {
  return Number.isFinite(max) && max > 0 ? max : 100;
}

export function getProgressPercent(value: number, max = 100) {
  const resolvedMax = safeMax(max);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, (value / resolvedMax) * 100));
}

export function formatProgressNumber(value: number) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

export function formatProgressLabel({
  value,
  max,
  percent,
  fractionDigits = 0,
  valueLabel,
  maxLabel,
}: {
  value: number;
  max: number;
  percent?: number | null;
  fractionDigits?: number;
  valueLabel?: string;
  maxLabel?: string;
}) {
  const resolvedPercent = percent ?? getProgressPercent(value, max);
  const safePercent = Math.min(100, Math.max(0, resolvedPercent));
  return `${safePercent.toFixed(fractionDigits)}% · ${valueLabel ?? formatProgressNumber(value)} / ${
    maxLabel ?? formatProgressNumber(max)
  }`;
}

export function Progress({
  value,
  max = 100,
  indeterminate = false,
  label,
  className,
  indicatorClassName,
  ariaLabel,
}: {
  value: number;
  max?: number;
  indeterminate?: boolean;
  label?: string;
  className?: string;
  indicatorClassName?: string;
  ariaLabel?: string;
}) {
  const resolvedMax = safeMax(max);
  const safeValue = Math.min(resolvedMax, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = getProgressPercent(safeValue, resolvedMax);

  return (
    <div
      className={cn('relative h-6 w-full overflow-hidden rounded-full border border-border bg-muted', className)}
      role="progressbar"
      aria-label={ariaLabel ?? label}
      aria-valuemin={0}
      aria-valuemax={resolvedMax}
      aria-valuenow={indeterminate ? undefined : safeValue}
    >
      {label && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-[13px] font-medium leading-none tabular-nums text-foreground">
          {label}
        </span>
      )}
      <div
        className="absolute inset-0 transition-[clip-path] duration-300 ease-out"
        style={indeterminate ? undefined : { clipPath: `inset(0 ${100 - percent}% 0 0)` }}
      >
        <span
          className={cn(
            'absolute inset-y-0 left-0 right-0 bg-primary',
            indeterminate && 'right-auto w-1/3 animate-pulse opacity-70',
            indicatorClassName,
          )}
        />
        {label && !indeterminate && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-[13px] font-medium leading-none tabular-nums text-primary-foreground">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
