'use client';

import { ArrowUpDown, type LucideIcon } from 'lucide-react';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

export interface ToolbarSortOption<TValue extends string> {
  value: TValue;
  label: string;
}

/**
 * Standardized sort control for the list toolbar.
 *
 * Renders `${label}: ${currentLabel}` so the prefix ("Sort") lives once in the
 * trigger instead of being baked into every option string. Uses `ArrowUpDown`
 * by default, keeping `SlidersHorizontal` reserved for advanced-filter popovers.
 */
export function ToolbarSortMenu<TValue extends string>({
  value,
  options,
  onChange,
  label,
  icon: Icon = ArrowUpDown,
  align = 'end',
}: {
  value: TValue;
  options: ReadonlyArray<ToolbarSortOption<TValue>>;
  onChange: (value: TValue) => void;
  /** Prefix shown before the active option (e.g. the translated "Sort"). */
  label?: string;
  icon?: LucideIcon;
  align?: 'start' | 'center' | 'end';
}) {
  const current = options.find((option) => option.value === value);
  const triggerLabel = label && current ? `${label}: ${current.label}` : (current?.label ?? label);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5">
          <Icon className="size-4" />
          {triggerLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
