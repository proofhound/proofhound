'use client';

import { forwardRef, type ReactNode } from 'react';
import { cn } from '@proofhound/ui';

export const CLOUD_CONSOLE_TOP_BAR_OFFSET_CLASS = 'pt-14';
export const CLOUD_CONSOLE_SIDEBAR_OFFSET_CLASS = 'top-14 h-[calc(100svh-3.5rem)]';

const CLOUD_CONSOLE_HEADER_BACKGROUND_CLASS = 'bg-[color-mix(in_srgb,var(--background)_88%,var(--secondary))]';

type CloudConsoleTopBarProps = {
  children: ReactNode;
  className?: string;
};

export const CloudConsoleTopBar = forwardRef<HTMLElement, CloudConsoleTopBarProps>(
  function CloudConsoleTopBar({ children, className }, ref) {
    return (
      <header
        ref={ref}
        className={cn(
          'fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-border px-4 backdrop-blur sm:px-5',
          CLOUD_CONSOLE_HEADER_BACKGROUND_CLASS,
          className,
        )}
      >
        {children}
      </header>
    );
  },
);
