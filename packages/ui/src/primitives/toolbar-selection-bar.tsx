'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Bulk-action strip rendered inside the list surface, directly below the
 * toolbar, when one or more rows are selected. Standardizes the previously
 * divergent placements (title-row cluster vs. a free-floating row).
 *
 * Pages fill it with the selection count, bulk action buttons, and a clear
 * control.
 */
export function ToolbarSelectionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}
