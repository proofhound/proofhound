import { PlatformLoaderOverlay } from './platform-loader';
import { Skeleton } from './skeleton';
import { cn } from '../lib/utils';

interface ListRowsSkeletonProps {
  className?: string;
  rows?: number;
}

export function ListRowsSkeleton({ className, rows = 8 }: ListRowsSkeletonProps) {
  return (
    <div className={cn('divide-y', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 p-4">
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton className="h-4 w-full max-w-[240px]" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="hidden h-4 w-20 md:block" />
          <Skeleton className="ml-auto h-7 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface ListPageSkeletonProps {
  className?: string;
  rows?: number;
  showSubtitle?: boolean;
}

export function ListPageSkeleton({ className, rows = 8, showSubtitle = true }: ListPageSkeletonProps) {
  return (
    <div className={cn('relative', className)} aria-busy="true">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-44" />
          {showSubtitle ? <Skeleton className="h-3.5 w-72" /> : null}
        </div>
        <Skeleton className="h-9 w-28 self-start" />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-full sm:w-[320px]" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-20" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>

        <ListRowsSkeleton rows={rows} />

        <div className="flex items-center justify-between border-t p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-56" />
        </div>
      </section>

      <PlatformLoaderOverlay />
    </div>
  );
}
