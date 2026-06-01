'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export interface SlidingViewToggleOption<TValue extends string> {
  value: TValue;
  label: string;
  icon?: LucideIcon;
}

export function SlidingViewToggle<TValue extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  className,
}: {
  value: TValue;
  options: [SlidingViewToggleOption<TValue>, SlidingViewToggleOption<TValue>];
  ariaLabel: string;
  onChange: (value: TValue) => void;
  className?: string;
}) {
  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      className={cn('relative inline-grid h-9 grid-cols-2 rounded-md border bg-muted p-0.5', className)}
      role="group"
      aria-label={ariaLabel}
    >
      <span
        className={cn(
          'pointer-events-none absolute bottom-0.5 top-0.5 w-[calc(50%-2px)] rounded-[calc(var(--radius)-4px)] bg-background shadow-sm transition-transform duration-200 ease-out',
          selectedIndex === 1 && 'translate-x-full',
        )}
        aria-hidden="true"
      />
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 inline-flex h-8 min-w-16 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={active}
          >
            {Icon && <Icon className="size-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
