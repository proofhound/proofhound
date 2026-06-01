'use client';

import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { cn } from '@proofhound/ui';

export type PromptDiffLineKind = 'same' | 'added' | 'removed' | 'blank';

export interface PromptDiffRow {
  left: string;
  right: string;
  leftKind: PromptDiffLineKind;
  rightKind: PromptDiffLineKind;
}

export function buildPromptDiffRows(fromText: string, toText: string): PromptDiffRow[] {
  const leftLines = fromText.split('\n');
  const rightLines = toText.split('\n');
  const lcs = Array.from(
    { length: leftLines.length + 1 },
    () => Array(rightLines.length + 1).fill(0) as number[],
  );
  const getScore = (leftIndex: number, rightIndex: number) => lcs[leftIndex]?.[rightIndex] ?? 0;

  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lcs[leftIndex]![rightIndex] =
        leftLines[leftIndex] === rightLines[rightIndex]
          ? getScore(leftIndex + 1, rightIndex + 1) + 1
          : Math.max(getScore(leftIndex + 1, rightIndex), getScore(leftIndex, rightIndex + 1));
    }
  }

  const rows: PromptDiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (
      leftIndex < leftLines.length &&
      rightIndex < rightLines.length &&
      leftLines[leftIndex] === rightLines[rightIndex]
    ) {
      rows.push({
        left: leftLines[leftIndex] ?? '',
        right: rightLines[rightIndex] ?? '',
        leftKind: 'same',
        rightKind: 'same',
      });
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      rightIndex < rightLines.length &&
      (leftIndex >= leftLines.length ||
        getScore(leftIndex, rightIndex + 1) >= getScore(leftIndex + 1, rightIndex))
    ) {
      rows.push({
        left: '',
        right: rightLines[rightIndex] ?? '',
        leftKind: 'blank',
        rightKind: 'added',
      });
      rightIndex += 1;
    } else if (leftIndex < leftLines.length) {
      rows.push({
        left: leftLines[leftIndex] ?? '',
        right: '',
        leftKind: 'removed',
        rightKind: 'blank',
      });
      leftIndex += 1;
    }
  }

  return rows;
}

export function getDiffLineClasses(kind: PromptDiffLineKind) {
  if (kind === 'added') {
    return 'bg-[color-mix(in_srgb,var(--status-running-bg)_82%,transparent)] text-[var(--status-running-fg)]';
  }
  if (kind === 'removed') {
    return 'bg-destructive/10 text-destructive';
  }
  if (kind === 'blank') {
    return 'bg-muted/20 text-muted-foreground';
  }
  return 'text-foreground';
}

export interface DiffPromptPaneProps {
  label: string;
  rows: PromptDiffRow[];
  side: 'left' | 'right';
  paneRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  maxHeight?: number;
}

export function DiffPromptPane({ label, rows, side, paneRef, onScroll, maxHeight = 320 }: DiffPromptPaneProps) {
  return (
    <div className="rounded-md border bg-background" data-testid={`prompt-diff-pane-${side}`}>
      <div className="border-b bg-muted/35 px-3 py-2 font-mono text-[11px] text-muted-foreground">{label}</div>
      <div
        ref={paneRef}
        onScroll={onScroll}
        className="overflow-auto p-2 font-mono text-[11.5px] leading-5"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {rows.map((row, index) => {
          const value = side === 'left' ? row.left : row.right;
          const kind = side === 'left' ? row.leftKind : row.rightKind;

          return (
            <div
              key={`${side}-${index}-${kind}`}
              data-testid={
                kind === 'added'
                  ? 'prompt-diff-added-line'
                  : kind === 'removed'
                    ? 'prompt-diff-removed-line'
                    : undefined
              }
              className={cn(
                'grid grid-cols-[36px_minmax(0,1fr)] rounded px-2 py-0.5',
                getDiffLineClasses(kind),
              )}
            >
              <span className="select-none text-right text-[10px] opacity-60">{index + 1}</span>
              <span className="whitespace-pre-wrap break-words pl-2">{value || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface PromptDiffSplitViewProps {
  fromLabel: string;
  toLabel: string;
  fromText: string;
  toText: string;
  maxHeight?: number;
}

export function PromptDiffSplitView({
  fromLabel,
  toLabel,
  fromText,
  toText,
  maxHeight,
}: PromptDiffSplitViewProps) {
  const rows = useMemo(() => buildPromptDiffRows(fromText, toText), [fromText, toText]);
  const topPaneRef = useRef<HTMLDivElement | null>(null);
  const bottomPaneRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);

  const syncScroll = useCallback((source: 'top' | 'bottom') => {
    if (syncingScrollRef.current) return;

    const sourcePane = source === 'top' ? topPaneRef.current : bottomPaneRef.current;
    const targetPane = source === 'top' ? bottomPaneRef.current : topPaneRef.current;
    if (!sourcePane || !targetPane) return;

    syncingScrollRef.current = true;
    targetPane.scrollTop = sourcePane.scrollTop;
    targetPane.scrollLeft = sourcePane.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, []);

  return (
    <div className="grid gap-3">
      <DiffPromptPane
        label={fromLabel}
        rows={rows}
        side="left"
        paneRef={topPaneRef}
        onScroll={() => syncScroll('top')}
        maxHeight={maxHeight}
      />
      <DiffPromptPane
        label={toLabel}
        rows={rows}
        side="right"
        paneRef={bottomPaneRef}
        onScroll={() => syncScroll('bottom')}
        maxHeight={maxHeight}
      />
    </div>
  );
}
