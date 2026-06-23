'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '../lib/utils';

/**
 * Advanced-filter affordance for the list toolbar: a `SlidersHorizontal` icon
 * button that opens a popover. Pages pass their own controls (checkboxes,
 * selects, a reset action) as children.
 *
 * Replaces the hand-rolled absolute-positioned panel previously in models.
 */
export function ToolbarFilterPopover({
  label,
  active,
  children,
  align = 'end',
  contentClassName,
}: {
  /** Accessible label for the trigger (e.g. the translated "Filters"). */
  label: string;
  /** Highlight the trigger when any advanced filter is applied. */
  active?: boolean;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'outline'}
          size="icon"
          className="size-9"
          aria-label={label}
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn('w-60 p-2 text-sm', contentClassName)}
        onEscapeKeyDown={() => setOpen(false)}
        onInteractOutside={() => setOpen(false)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
