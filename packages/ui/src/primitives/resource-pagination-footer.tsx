import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { useUiStrings } from '../strings';

export function ResourcePaginationFooter({
  summary,
  pageIndex,
  pageCount,
  pageSize,
  pageSizeOptions,
  previousPageLabel,
  nextPageLabel,
  onPageChange,
  onPageSizeChange,
}: {
  summary?: ReactNode;
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  previousPageLabel: string;
  nextPageLabel: string;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const s = useUiStrings();
  const safePageCount = Math.max(1, pageCount);
  const safePageIndex = Math.min(pageIndex, safePageCount - 1);

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-xs text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
      {summary ? <div>{summary}</div> : <div />}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span>{s.itemsPerPage}</span>
          <select
            value={pageSize}
            aria-label={s.itemsPerPage}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={safePageIndex === 0}
            aria-label={previousPageLabel}
            onClick={() => onPageChange(Math.max(0, safePageIndex - 1))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="px-2 font-mono">
            {safePageIndex + 1} / {safePageCount}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={safePageIndex >= safePageCount - 1}
            aria-label={nextPageLabel}
            onClick={() => onPageChange(Math.min(safePageCount - 1, safePageIndex + 1))}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
