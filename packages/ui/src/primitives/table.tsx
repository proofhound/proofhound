'use client';

import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';

import { Skeleton } from './skeleton';
import { useUiStrings } from '../strings';
import { cn } from '../lib/utils';

export type ColumnWidth = 'narrow' | 'compact' | 'normal' | 'wide' | 'flex';

export interface TableColumn {
  key: string;
  width: ColumnWidth;
  sticky?: 'left' | 'right';
  /** Only consumed by `flex` columns; defaults to FLEX_MIN_PX_DEFAULT (180). */
  minPx?: number;
}

export const WIDTH_PRESETS_PX: Readonly<Record<Exclude<ColumnWidth, 'flex'>, number>> = {
  narrow: 48,
  compact: 120,
  normal: 180,
  wide: 280,
};

export const FLEX_MIN_PX_DEFAULT = 180;

export function resolveColumnPx(column: Pick<TableColumn, 'width' | 'minPx'>): number {
  if (column.width === 'flex') return column.minPx ?? FLEX_MIN_PX_DEFAULT;
  return WIDTH_PRESETS_PX[column.width];
}

export interface ResolvedColumn extends TableColumn {
  index: number;
  px: number;
  leftOffsetPx?: number;
  rightOffsetPx?: number;
}

export interface ColumnLayout {
  columns: ResolvedColumn[];
  columnsByKey: Record<string, ResolvedColumn>;
  /** Sum of all non-flex column px + each flex column's minPx — used for `<table style.minWidth>`. */
  minWidthPx: number;
}

export function computeColumnLayout(columns: TableColumn[]): ColumnLayout {
  const resolved: ResolvedColumn[] = columns.map((col, index) => ({
    ...col,
    index,
    px: resolveColumnPx(col),
  }));

  let leftAcc = 0;
  for (const col of resolved) {
    if (col.sticky === 'left') {
      col.leftOffsetPx = leftAcc;
      leftAcc += col.px;
    }
  }

  let rightAcc = 0;
  for (let i = resolved.length - 1; i >= 0; i -= 1) {
    const col = resolved[i]!;
    if (col.sticky === 'right') {
      col.rightOffsetPx = rightAcc;
      rightAcc += col.px;
    }
  }

  const minWidthPx = resolved.reduce((sum, col) => sum + col.px, 0);
  const columnsByKey: Record<string, ResolvedColumn> = {};
  for (const col of resolved) columnsByKey[col.key] = col;

  return { columns: resolved, columnsByKey, minWidthPx };
}

const TableContext = createContext<ColumnLayout | null>(null);

function useTableLayout(componentName: string): ColumnLayout {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error(`<${componentName}> must be rendered inside <Table>`);
  return ctx;
}

function useColumn(componentName: string, columnKey: string): ResolvedColumn {
  const layout = useTableLayout(componentName);
  const column = layout.columnsByKey[columnKey];
  if (!column) {
    throw new Error(
      `<${componentName}> references unknown column "${columnKey}"; available keys: ${Object.keys(layout.columnsByKey).join(', ')}`,
    );
  }
  return column;
}

export interface TableProps {
  columns: TableColumn[];
  layout?: 'fixed' | 'auto';
  className?: string;
  containerClassName?: string;
  containerTestId?: string;
  children: ReactNode;
}

export function Table({
  columns,
  layout = 'fixed',
  className,
  containerClassName,
  containerTestId,
  children,
}: TableProps) {
  const value = useMemo(() => computeColumnLayout(columns), [columns]);

  return (
    <div className={cn('relative overflow-x-auto', containerClassName)} data-testid={containerTestId}>
      <table
        className={cn('w-full border-collapse text-sm', className)}
        style={{ tableLayout: layout, minWidth: `${value.minWidthPx}px` }}
      >
        <colgroup>
          {value.columns.map((col) => (
            <col key={col.key} style={col.width === 'flex' ? undefined : { width: `${col.px}px` }} />
          ))}
        </colgroup>
        <TableContext.Provider value={value}>{children}</TableContext.Provider>
      </table>
    </div>
  );
}

export function TableHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <thead
      className={cn('bg-muted text-xs uppercase tracking-wide text-muted-foreground', className)}
    >
      {children}
    </thead>
  );
}

export function TableBody({ className, children }: { className?: string; children: ReactNode }) {
  return <tbody className={className}>{children}</tbody>;
}

export interface TableRowProps {
  className?: string;
  selected?: boolean;
  selectedTone?: 'primary' | 'canary';
  onClick?: () => void;
  children: ReactNode;
  'data-testid'?: string;
}

export function TableRow({
  className,
  selected,
  selectedTone = 'primary',
  onClick,
  children,
  ...rest
}: TableRowProps) {
  const tone = selectedTone === 'canary' ? 'var(--status-canary-dot)' : 'var(--primary)';
  const style: CSSProperties | undefined = selected ? { boxShadow: `inset 3px 0 0 ${tone}` } : undefined;

  return (
    <tr
      onClick={onClick}
      style={style}
      data-testid={rest['data-testid']}
      className={cn(
        'group border-b border-border/60 last:border-b-0 hover:bg-accent',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </tr>
  );
}

interface CellSharedProps {
  column: string;
  className?: string;
  children?: ReactNode;
  /** Single-line truncate (true / 1), or two-line clamp (2). */
  truncate?: boolean | 1 | 2;
}

function buildStickyStyle(col: ResolvedColumn): CSSProperties | undefined {
  if (col.sticky === 'left') return { left: `${col.leftOffsetPx ?? 0}px` };
  if (col.sticky === 'right') return { right: `${col.rightOffsetPx ?? 0}px` };
  return undefined;
}

function stickyClasses(col: ResolvedColumn, layer: 'head' | 'cell'): string {
  if (!col.sticky) return '';
  const z = layer === 'head' ? 'z-20' : 'z-10';
  // Sticky cells must use opaque background tokens (no `/N` alpha) so
  // non-sticky columns scrolling underneath are never visible through them.
  const bg = layer === 'head' ? 'bg-muted' : 'bg-card group-hover:bg-accent';
  const border = col.sticky === 'left' ? 'border-r border-border' : 'border-l border-border';
  return cn('sticky', col.sticky === 'left' ? 'left-0' : 'right-0', z, bg, border);
}

export function shouldStopCellClickPropagation(
  column: Pick<ResolvedColumn, 'key' | 'sticky'>,
  explicit?: boolean,
): boolean {
  if (explicit !== undefined) return explicit;
  return column.key === 'select' || column.key === 'actions';
}

function truncateInnerClasses(truncate?: boolean | 1 | 2): string | undefined {
  if (!truncate) return undefined;
  if (truncate === 2) return 'min-w-0 overflow-hidden line-clamp-2';
  return 'min-w-0 truncate';
}

export interface TableHeadProps extends CellSharedProps {
  scope?: 'col' | 'row';
}

export function TableHead({ column, className, children, truncate, scope = 'col' }: TableHeadProps) {
  const col = useColumn('TableHead', column);
  const inner = truncateInnerClasses(truncate);

  return (
    <th
      scope={scope}
      style={buildStickyStyle(col)}
      className={cn(
        'h-9 overflow-hidden px-3 text-left align-middle font-medium',
        stickyClasses(col, 'head'),
        className,
      )}
    >
      {inner ? <div className={inner}>{children}</div> : children}
    </th>
  );
}

export interface TableCellProps extends CellSharedProps {
  /** Stop click propagation so cell clicks don't bubble to <TableRow onClick>. Defaults to true for select / actions cells. */
  stopPropagation?: boolean;
}

export function TableCell({ column, className, children, truncate, stopPropagation }: TableCellProps) {
  const col = useColumn('TableCell', column);
  const inner = truncateInnerClasses(truncate);
  const shouldStopProp = shouldStopCellClickPropagation(col, stopPropagation);

  return (
    <td
      style={buildStickyStyle(col)}
      onClick={shouldStopProp ? (e) => e.stopPropagation() : undefined}
      className={cn(
        // overflow-hidden is mandatory under table-layout: fixed — without it,
        // any inline content (badges, mono-strings) that exceeds the column's
        // configured px will visually leak into adjacent columns even though
        // the column width itself is correct.
        'overflow-hidden px-3 py-2 align-middle text-foreground',
        stickyClasses(col, 'cell'),
        className,
      )}
    >
      {inner ? <div className={inner}>{children}</div> : children}
    </td>
  );
}

export interface TableEmptyProps {
  children?: ReactNode;
  className?: string;
}

export function TableEmpty({ children, className }: TableEmptyProps) {
  const layout = useTableLayout('TableEmpty');
  const s = useUiStrings();

  return (
    <tr>
      <td
        colSpan={layout.columns.length}
        className={cn('px-3 py-8 text-center text-sm text-muted-foreground', className)}
      >
        {children ?? s.tableEmpty}
      </td>
    </tr>
  );
}

export function TableSkeletonRows({ rows = 6 }: { rows?: number }) {
  const layout = useTableLayout('TableSkeletonRows');
  const colSpan = layout.columns.length;

  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <tr key={index} className="border-b border-border/60 last:border-b-0" aria-hidden="true">
          <td colSpan={colSpan} className="px-3 py-3">
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-full max-w-[220px]" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="hidden h-4 w-20 lg:block" />
              <Skeleton className="ml-auto h-6 w-12 shrink-0" />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
