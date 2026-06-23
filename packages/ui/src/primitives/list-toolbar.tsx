'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Shared layout shell for the "functional bar" that sits above a list/table.
 *
 * It owns the single responsive grammar shared by every list page:
 *   - `lead` (left, flex-1, wraps): the "find" affordances — search + quick-filter chips
 *   - `trail` (right): the "shape" affordances — sort, view toggle, advanced filters
 *
 * It is intentionally i18n-agnostic; pages pass already-translated nodes in.
 */
export function ListToolbar({
  lead,
  trail,
  className,
}: {
  lead: ReactNode;
  trail?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between',
        className,
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">{lead}</div>
      {trail ? <div className="flex flex-wrap items-center gap-2">{trail}</div> : null}
    </div>
  );
}
