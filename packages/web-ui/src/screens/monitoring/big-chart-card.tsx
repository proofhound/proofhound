'use client';

import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { SourceBucket } from '@proofhound/shared';
import { SourceLegend, SourceStackedBar, type SourceStackedBarDatum, type SourceStackedBarSource } from '../../components';
import { cn } from '@proofhound/ui';

export type DeltaTone = 'up' | 'down' | 'warn' | 'neutral';

export function BigChartCard({
  title,
  icon,
  iconBg,
  iconFg,
  total,
  unit,
  comparison,
  delta,
  subtitle,
  data,
  yTickFormatter,
  legendFormatter,
  bySource,
  sourceLabels,
  sourceKeys,
  sourceDistributionLabel,
  totalLabel,
  threshold,
}: {
  title: string;
  icon: ReactNode;
  iconBg: string;
  iconFg: string;
  total: string;
  unit?: string;
  comparison?: { value: string; unit?: string; label: string; tone?: DeltaTone } | null;
  delta?: { text: string; tone: DeltaTone } | null;
  subtitle?: string;
  data: ReadonlyArray<SourceStackedBarDatum>;
  yTickFormatter?: (v: number) => string;
  legendFormatter: (value: number) => string;
  bySource: Record<SourceBucket, number>;
  sourceLabels: Record<SourceBucket, string>;
  sourceKeys?: ReadonlyArray<SourceStackedBarSource>;
  sourceDistributionLabel: string;
  totalLabel: string;
  threshold?: { value: number; label: string } | null;
}) {
  return (
    <section
      className="flex flex-col rounded-lg border bg-card p-4 transition-shadow hover:shadow-md"
      aria-label={title}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
            <span
              className="inline-flex size-7 items-center justify-center rounded-md"
              style={{ background: iconBg, color: iconFg }}
            >
              {icon}
            </span>
            {title}
          </div>
          <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="text-[28px] font-bold leading-[1.1] text-foreground">
              {total}
              {unit && <span className="ml-0.5 text-[14px] font-medium text-muted-foreground">{unit}</span>}
            </div>
            {comparison && (
              <div className="pb-0.5" data-comparison-tone={comparison.tone ?? 'neutral'}>
                <div
                  className={cn(
                    'flex items-center gap-0.5 font-mono text-[13px] font-semibold leading-none',
                    comparisonToneClass(comparison.tone ?? 'neutral'),
                  )}
                >
                  <ComparisonIcon tone={comparison.tone ?? 'neutral'} />
                  {comparison.value}
                  {comparison.unit && <span className="ml-0.5 text-[10.5px] font-medium">{comparison.unit}</span>}
                </div>
                <div className="mt-0.5 text-[10.5px] leading-none text-muted-foreground">{comparison.label}</div>
              </div>
            )}
          </div>
          {(!comparison && delta) || subtitle ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-muted-foreground">
              {!comparison && delta && <DeltaPill {...delta} />}
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3.5">
        <SourceStackedBar
          data={data}
          yTickFormatter={yTickFormatter}
          sourceLabels={sourceLabels}
          sourceKeys={sourceKeys}
          totalLabel={totalLabel}
          threshold={threshold}
        />
      </div>

      <SourceLegend
        values={bySource}
        format={legendFormatter}
        labels={sourceLabels}
        sourceKeys={sourceKeys}
        ariaLabel={sourceDistributionLabel}
        className="mt-3"
      />
    </section>
  );
}

function DeltaPill({ text, tone }: { text: string; tone: DeltaTone }) {
  const palette: Record<DeltaTone, string> = {
    up: 'bg-[var(--trend-up-bg)] text-[var(--trend-up-fg)]',
    down: 'bg-[var(--trend-down-bg)] text-[var(--trend-down-fg)]',
    warn: 'bg-[var(--trend-up-bg)] text-[var(--trend-up-fg)]',
    neutral: 'bg-muted text-muted-foreground',
  };
  const Icon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        palette[tone],
      )}
    >
      {Icon && <Icon className="size-3" />}
      {text}
    </span>
  );
}

function comparisonToneClass(tone: DeltaTone) {
  const palette: Record<DeltaTone, string> = {
    up: 'text-[var(--trend-up-fg)]',
    down: 'text-[var(--trend-down-fg)]',
    warn: 'text-[var(--trend-up-fg)]',
    neutral: 'text-muted-foreground',
  };
  return palette[tone];
}

function ComparisonIcon({ tone }: { tone: DeltaTone }) {
  const Icon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : null;
  return Icon ? <Icon className="size-3" strokeWidth={2.4} /> : null;
}
