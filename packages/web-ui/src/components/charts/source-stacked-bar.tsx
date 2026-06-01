'use client';

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { cn } from '@proofhound/ui';

export type SourceStackedBarSource = 'prod' | 'canary' | 'iter' | 'exp';

export interface SourceStackedBarDatum {
  x: string;
  prod: number;
  canary: number;
  iter: number;
  exp: number;
}

const SOURCE_KEYS: ReadonlyArray<SourceStackedBarSource> = ['prod', 'canary', 'iter', 'exp'];
const SOURCE_LABELS: Record<SourceStackedBarSource, string> = {
  prod: '正式',
  canary: '灰度',
  iter: '优化',
  exp: '实验',
};

// Generic component for the design's "6 stacked bar charts". All colors come from --src-* tokens; threshold lines can be overlaid.
export function SourceStackedBar({
  data,
  height = 180,
  yTickFormatter,
  sourceLabels = SOURCE_LABELS,
  sourceKeys = SOURCE_KEYS,
  totalLabel = '合计',
  threshold,
  className,
}: {
  data: ReadonlyArray<SourceStackedBarDatum>;
  height?: number;
  yTickFormatter?: (value: number) => string;
  sourceLabels?: Record<SourceStackedBarSource, string>;
  sourceKeys?: ReadonlyArray<SourceStackedBarSource>;
  totalLabel?: string;
  threshold?: { value: number; label: string } | null;
  className?: string;
}) {
  const xTickInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <div className={cn('min-w-0 w-full', className)} style={{ height }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={1}
        minHeight={1}
        initialDimension={{ width: 640, height }}
      >
        <BarChart data={[...data]} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="2 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="x"
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fill: 'var(--muted-foreground)',
            }}
            interval={xTickInterval}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 10,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fill: 'var(--muted-foreground)',
            }}
            tickFormatter={yTickFormatter}
            width={42}
          />
          <Tooltip
            cursor={{ fill: 'color-mix(in srgb, var(--muted) 60%, transparent)' }}
            content={(props) => (
              <ChartTooltip
                {...props}
                yFormatter={yTickFormatter}
                sourceLabels={sourceLabels}
                sourceKeys={sourceKeys}
                totalLabel={totalLabel}
              />
            )}
          />
          {threshold && (
            <ReferenceLine
              y={threshold.value}
              stroke="var(--destructive)"
              strokeDasharray="4 3"
              strokeWidth={1.2}
              label={{
                value: threshold.label,
                position: 'insideTopRight',
                fontSize: 9.5,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fill: 'var(--destructive)',
              }}
            />
          )}
          {sourceKeys.map((key, idx) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="src"
              fill={`var(--src-${key})`}
              radius={idx === sourceKeys.length - 1 ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  yFormatter,
  sourceLabels,
  sourceKeys,
  totalLabel,
}: TooltipContentProps & {
  yFormatter?: (v: number) => string;
  sourceLabels: Record<SourceStackedBarSource, string>;
  sourceKeys: ReadonlyArray<SourceStackedBarSource>;
  totalLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const visiblePayload = payload.filter((p) => sourceKeys.includes(String(p.dataKey ?? '') as SourceStackedBarSource));
  const total = visiblePayload.reduce((acc: number, p) => acc + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-md border bg-popover px-2.5 py-2 text-[12px] shadow-md">
      <div className="mb-1 font-mono text-[10.5px] text-muted-foreground">{label}</div>
      <div className="space-y-0.5">
        {visiblePayload.map((p) => {
          const key = String(p.dataKey ?? '') as SourceStackedBarSource;
          const labelText = sourceLabels[key] ?? key;
          const value = Number(p.value ?? 0);
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="size-2 rounded-sm" style={{ background: `var(--src-${key})` }} aria-hidden />
              <span className="text-muted-foreground">{labelText}</span>
              <span className="ml-auto font-mono">{yFormatter ? yFormatter(value) : value}</span>
            </div>
          );
        })}
        <div className="border-t mt-1 pt-1 flex items-center gap-2 font-medium">
          <span className="text-muted-foreground">{totalLabel}</span>
          <span className="ml-auto font-mono">{yFormatter ? yFormatter(total) : total}</span>
        </div>
      </div>
    </div>
  );
}
