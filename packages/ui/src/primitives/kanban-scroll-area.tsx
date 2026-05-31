import { type ComponentProps } from 'react';
import { cn } from '../lib/utils';

type KanbanScrollAreaProps = ComponentProps<'div'>;

export function KanbanScrollArea({ className, ...props }: KanbanScrollAreaProps) {
  return (
    <div
      className={cn(
        'max-h-[min(720px,calc(100vh-16rem))] overflow-auto overscroll-contain p-4',
        className,
      )}
      {...props}
    />
  );
}
