import { type ReactNode } from 'react';
import { cn } from '../lib/utils';

interface MainProps {
  children: ReactNode;
  fixed?: boolean;
  className?: string;
}

export function Main({ children, fixed = false, className }: MainProps) {
  return (
    <main
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-4 p-4',
        fixed && 'overflow-hidden',
        className,
      )}
    >
      {children}
    </main>
  );
}
