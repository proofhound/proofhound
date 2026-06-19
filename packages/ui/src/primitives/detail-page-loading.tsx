import { DetailPageSkeleton } from './detail-page-skeleton';
import { cn } from '../lib/utils';
import { Main } from '../layout/main';

interface DetailPageLoadingProps {
  /** Override the inner container width/padding to match a specific detail screen. */
  className?: string;
}

/**
 * Full-page loading placeholder for detail routes: the same `<Main>` shell + skeleton the
 * detail screens render while their data resolves. Use it as the fallback for a `useMounted`
 * hydration gate so the server render and the client's first paint emit an identical frame.
 */
export function DetailPageLoading({ className }: DetailPageLoadingProps) {
  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className={cn('mx-auto w-full max-w-[1280px] px-6 py-12', className)}>
        <DetailPageSkeleton />
      </div>
    </Main>
  );
}
