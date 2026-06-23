'use client';

import { cn } from '../lib/utils';

/**
 * Unified quick-filter chip used across every list toolbar.
 *
 * Replaces the three near-identical local variants that previously lived in
 * datasets / models / prompts / annotations (`FilterChip`), experiments /
 * optimizations (`ChipFilter`), and connectors (raw `Button`).
 *
 * Tone is expressed as a caller-supplied `dotClassName` so the chip stays free
 * of any business status enum; pages map their own status → dot color.
 */
export function FilterChip({
  active,
  label,
  count,
  dotClassName,
  pulse,
  onClick,
  className,
}: {
  active: boolean;
  label: string;
  /** Optional live count rendered as a tabular monospaced figure. */
  count?: number;
  /** Optional leading status dot color (e.g. `bg-emerald-500`). */
  dotClassName?: string;
  /** Animate the status dot (only when not active). */
  pulse?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {dotClassName ? (
        <span
          className={cn(
            'size-1.5 rounded-full',
            dotClassName,
            pulse && !active && 'animate-pulse',
            active && 'bg-current opacity-90',
          )}
        />
      ) : null}
      <span>{label}</span>
      {typeof count === 'number' ? (
        <span className={cn('font-mono text-[11px] tabular-nums', active ? 'opacity-75' : 'text-muted-foreground')}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
