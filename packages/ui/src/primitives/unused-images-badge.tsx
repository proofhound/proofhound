'use client';

import type { ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

export interface UnusedImagesBadgeProps {
  tooltip: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function UnusedImagesBadge({
  tooltip,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: UnusedImagesBadgeProps) {
  const sizing =
    size === 'sm' ? { box: 'size-5', icon: 'size-3' } : { box: 'size-6', icon: 'size-3.5' };

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="unused-images-badge"
            aria-label={ariaLabel}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted text-muted-foreground',
              sizing.box,
              className,
            )}
          >
            <ImageOff className={sizing.icon} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
