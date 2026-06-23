'use client';

import { Check, Database, FileText, FlaskConical } from 'lucide-react';
import {
  Progress,
  formatProgressLabel,
  formatProgressNumber,
  cn,
} from '@proofhound/ui';
import { useI18n } from '../../i18n';
import {
  OPTIMIZATION_ORIGIN_LABEL_KEYS,
  OPTIMIZATION_STATUS_LABEL_KEYS,
  OPTIMIZATION_STATUS_TONE,
  type OptimizationGoal,
  type OptimizationOrigin,
  type OptimizationStatus,
  type OptimizationSummary,
} from './optimization-mappers';
import { optimizationTone } from './optimization-theme';

export function OptimizationStatusBadge({
  status,
  compact = false,
}: {
  status: OptimizationStatus;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const tone = OPTIMIZATION_STATUS_TONE[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium whitespace-nowrap',
        compact ? 'gap-1 px-1.5 py-0.5 text-[10.5px]' : 'gap-1.5 px-2 py-0.5 text-[11.5px]',
        tone.pill,
      )}
    >
      <span className={cn(compact ? 'size-1' : 'size-1.5', 'rounded-full', tone.dot, tone.pulse && 'animate-pulse')} />
      {t(OPTIMIZATION_STATUS_LABEL_KEYS[status])}
    </span>
  );
}

export function SelectionBox({
  checked,
  ariaLabel,
  disabled,
  onClick,
}: {
  checked: boolean;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-[3px] border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/50 bg-background',
      )}
      aria-label={ariaLabel}
      aria-pressed={checked}
    >
      {checked && <Check className="size-3" />}
    </button>
  );
}

const ORIGIN_ICON: Record<OptimizationOrigin, typeof FlaskConical> = {
  experiment: FlaskConical,
  prompt: FileText,
  dataset: Database,
};

const ORIGIN_TONE: Record<OptimizationOrigin, { box: string; text: string }> = {
  experiment: {
    box: 'border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]',
    text: 'text-foreground',
  },
  prompt: {
    box: 'border-[var(--status-running-bd)] bg-[var(--status-running-bg)] text-[var(--status-running-fg)]',
    text: 'text-foreground',
  },
  dataset: {
    box: 'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
    text: 'text-foreground',
  },
};

export function OriginBadge({ origin, originRef }: { origin: OptimizationOrigin; originRef: string }) {
  const { t } = useI18n();
  const Icon = ORIGIN_ICON[origin];
  const tone = ORIGIN_TONE[origin];
  const label = t(OPTIMIZATION_ORIGIN_LABEL_KEYS[origin]);

  return (
    <span className="flex min-w-0 items-center gap-2" title={label}>
      <span
        aria-label={label}
        className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md border', tone.box)}
      >
        <Icon className="size-3" />
      </span>
      <span className={cn('min-w-0 truncate font-mono text-[12px]', tone.text)}>{originRef}</span>
    </span>
  );
}

export function LoopProgressBar({
  current,
  total,
}: {
  status: OptimizationStatus;
  current: number;
  total: number;
  size?: 'sm' | 'md';
}) {
  const safeTotal = Math.max(1, total);
  const label = formatProgressLabel({ value: current, max: safeTotal });

  return <Progress value={current} max={safeTotal} label={label} />;
}

function ScopeBadge({ kind, label }: { kind: 'overall' | 'class'; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-1.5 font-mono text-[10px] leading-5 whitespace-nowrap',
        kind === 'overall' ? 'border-border bg-secondary text-muted-foreground' : optimizationTone.warning.pill,
      )}
    >
      {label}
    </span>
  );
}

export function GoalScopeRow({
  scope,
  classes,
  compact = false,
}: {
  scope: 'overall' | 'class';
  classes?: string[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'font-medium uppercase tracking-wide text-muted-foreground',
          compact ? 'text-[9.5px]' : 'text-[10.5px]',
        )}
      >
        {t('optimizations.live.scope')}
      </span>
      {scope === 'overall' ? (
        <ScopeBadge kind="overall" label={t('optimizations.live.scopeOverall')} />
      ) : (
        (classes ?? []).map((cls) => <ScopeBadge key={cls} kind="class" label={cls} />)
      )}
    </div>
  );
}

function formatGoalValue(value: number | undefined) {
  if (typeof value !== 'number') return '—';
  return value.toFixed(3);
}

export function GoalRow({ goal, compact = false }: { goal: OptimizationGoal; compact?: boolean }) {
  return (
    <li
      className={cn('grid items-center gap-1.5', compact ? 'grid-cols-[12px_1fr_auto]' : 'grid-cols-[14px_1fr_auto]')}
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full border',
          compact ? 'size-3' : 'size-3.5',
          goal.status === 'hit'
            ? cn(optimizationTone.positive.fill, 'border-transparent text-white')
            : goal.status === 'fail'
              ? 'border-dashed border-destructive bg-transparent'
              : 'border-dashed border-border bg-transparent',
        )}
        aria-hidden="true"
      >
        {goal.status === 'hit' && <Check className="size-2" />}
      </span>
      <span className={cn('min-w-0 truncate text-foreground', compact ? 'text-[11px]' : 'text-[11.5px]')}>
        {goal.metric}
        {goal.classLabel ? ` · ${goal.classLabel}` : ''}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums whitespace-nowrap text-muted-foreground',
          compact ? 'text-[10.5px]' : 'text-[11px]',
        )}
      >
        <b
          className={cn(
            'font-bold text-foreground',
            goal.status === 'hit' && optimizationTone.positive.text,
            goal.status === 'fail' && optimizationTone.danger.text,
          )}
        >
          {formatGoalValue(goal.current)}
        </b>
        <span className="mx-0.5 text-border">/</span>
        {goal.target.toFixed(2)}
      </span>
    </li>
  );
}

export function GoalList({
  goals,
  scope,
  classes,
  compact = false,
}: {
  goals: OptimizationGoal[];
  scope: 'overall' | 'class';
  classes?: string[];
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <GoalScopeRow scope={scope} classes={classes} compact={compact} />
      <ul className={cn('flex flex-col gap-1 border-t border-dashed pt-1.5', compact ? 'gap-1' : 'gap-1.5')}>
        {goals.map((goal, idx) => (
          <GoalRow key={`${goal.metric}-${goal.classLabel ?? 'overall'}-${idx}`} goal={goal} compact={compact} />
        ))}
      </ul>
    </div>
  );
}

export function SparkLine({
  values,
  totalRounds,
  target,
  baseline,
  hasBaseline = false,
  status,
}: {
  values: number[];
  totalRounds: number;
  target?: number;
  baseline?: number;
  // When true, values[0] is the source experiment baseline; values[1..N] are R1..N
  hasBaseline?: boolean;
  status: OptimizationStatus;
}) {
  if (values.length === 0) return null;
  const tone = OPTIMIZATION_STATUS_TONE[status];
  const W = 360;
  const H = 160;
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const yToPx = (v: number) => padT + (1 - Math.max(0, Math.min(1, v))) * innerH;
  // hasBaseline: baseline takes slot 0; R1..N take slots 1..N (total N+1 slots)
  // !hasBaseline: R1..N take slots 1..N (total N slots; X-axis endpoints are R1 and RN)
  const slotsTotal = hasBaseline ? totalRounds : Math.max(1, totalRounds - 1);
  const xToPx = (slot: number) => padL + (slot / slotsTotal) * innerW;
  // values[i] is in slot i (hasBaseline); slot i (no baseline, i=0 means R1)
  const slotForIndex = (i: number) => (hasBaseline ? i : i);

  const points = values.map((v, i) => ({ x: xToPx(slotForIndex(i)), y: yToPx(v) }));
  const linePath = 'M' + points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L');
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const areaPath = `${linePath} L${last.x.toFixed(2)},${H - padB} L${first.x.toFixed(2)},${H - padB} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  // X-axis ticks: B + R1..N when hasBaseline; otherwise R1..N
  type XTick = { slot: number; label: string };
  const xTicks: XTick[] = (() => {
    if (hasBaseline) {
      const all: XTick[] = [
        { slot: 0, label: 'B' },
        ...Array.from({ length: totalRounds }, (_, i) => ({ slot: i + 1, label: String(i + 1) })),
      ];
      if (all.length <= 11) return all;
      // For many rounds, only show first/last + 4 intermediate points
      const sample = [0, 1, ...Array.from({ length: 4 }, (_, i) => Math.round(((totalRounds - 1) * (i + 1)) / 4) + 1), totalRounds];
      const seen = new Set<number>();
      return all.filter((t) => sample.includes(t.slot) && (seen.has(t.slot) ? false : (seen.add(t.slot), true)));
    }
    return totalRounds <= 10
      ? Array.from({ length: totalRounds }, (_, i) => ({ slot: i, label: String(i + 1) }))
      : Array.from({ length: 6 }, (_, i) => {
          const round = Math.max(1, Math.round(1 + ((totalRounds - 1) * i) / 5));
          return { slot: round - 1, label: String(round) };
        });
  })();

  return (
    <svg
      className="block w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="metric trend by round"
      style={{ height: 160 }}
    >
      {yTicks.map((v) => (
        <g key={`y-${v}`}>
          <line
            x1={padL}
            x2={W - padR}
            y1={yToPx(v)}
            y2={yToPx(v)}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
            className="text-border opacity-60"
          />
          <text
            x={padL - 5}
            y={yToPx(v) + 3}
            textAnchor="end"
            fill="currentColor"
            className="font-mono text-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {v.toFixed(2)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick.slot}-${tick.label}`}>
          <line
            x1={xToPx(tick.slot)}
            x2={xToPx(tick.slot)}
            y1={padT}
            y2={H - padB}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
            className="text-border opacity-30"
          />
          <text
            x={xToPx(tick.slot)}
            y={H - padB + 13}
            textAnchor="middle"
            fill="currentColor"
            className="font-mono text-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {tick.label}
          </text>
        </g>
      ))}
      {typeof baseline === 'number' && (
        <line
          x1={padL}
          x2={W - padR}
          y1={yToPx(baseline)}
          y2={yToPx(baseline)}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
          className="text-muted-foreground opacity-50"
        />
      )}
      {typeof target === 'number' && (
        <line
          x1={padL}
          x2={W - padR}
          y1={yToPx(target)}
          y2={yToPx(target)}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          className={cn(optimizationTone.positive.text, 'opacity-80')}
        />
      )}
      <path d={areaPath} fill="currentColor" className={cn(tone.laneHeader, 'opacity-10')} />
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={tone.laneHeader}
      />
      <circle
        cx={last.x}
        cy={last.y}
        r={3.5}
        fill="var(--background)"
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        className={tone.laneHeader}
      />
      <line
        x1={padL}
        x2={padL}
        y1={padT}
        y2={H - padB}
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="text-border"
      />
      <line
        x1={padL}
        x2={W - padR}
        y1={H - padB}
        y2={H - padB}
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="text-border"
      />
    </svg>
  );
}

export function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function formatNumber(value: number) {
  return formatProgressNumber(value);
}

export function formatDateTime(value: string | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function hitCount(item: OptimizationSummary) {
  return item.goals.filter((g) => g.status === 'hit').length;
}

export function renderRichInline(template: string, values: Record<string, string | number>) {
  // very small subset: replace `<b>…</b>` with emphasised span; leave other text raw.
  const filled = formatTemplate(template, values);
  const parts: Array<{ text: string; bold?: boolean }> = [];
  const re = /<b>(.*?)<\/b>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(filled)) !== null) {
    if (match.index > cursor) parts.push({ text: filled.slice(cursor, match.index) });
    parts.push({ text: match[1] ?? '', bold: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < filled.length) parts.push({ text: filled.slice(cursor) });
  return parts;
}
