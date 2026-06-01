import { PlatformLoaderOverlay } from './platform-loader';
import { Skeleton } from './skeleton';
import { cn } from '../lib/utils';

interface DetailPageSkeletonProps {
  className?: string;
  blocks?: number;
  showBack?: boolean;
  showAction?: boolean;
}

export function DetailPageSkeleton({
  className,
  blocks = 3,
  showBack = true,
  showAction = true,
}: DetailPageSkeletonProps) {
  return (
    <div className={cn('relative', className)} aria-busy="true">
      {showBack ? <Skeleton className="mb-4 h-5 w-24" /> : null}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-80" />
        </div>
        {showAction ? <Skeleton className="h-9 w-28" /> : null}
      </div>

      <div className="space-y-4">
        {Array.from({ length: blocks }).map((_, index) => (
          <Skeleton key={index} className="h-40 rounded-lg" />
        ))}
      </div>

      <PlatformLoaderOverlay />
    </div>
  );
}
