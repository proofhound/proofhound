'use client';

import type { ReactNode } from 'react';
import { GitCompareArrows, Rocket, Split, type LucideIcon } from 'lucide-react';
import type { ProductionReleaseEventTypeDto, ReleaseLineEventOperationDto } from '@proofhound/shared';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@proofhound/ui';
import { formatDateTime } from '../../lib';
import type { ReleaseLineLatestEvent, ReleaseLineStatus, ReleaseLineView } from '../../lib';
import { useI18n, type TranslationKey } from '../../i18n';

const STATUS_TOKENS: Record<ReleaseLineStatus, { bg: string; fg: string; bd: string; dot: string; pulse: boolean }> = {
  running: {
    bg: 'var(--status-running-bg)',
    fg: 'var(--status-running-fg)',
    bd: 'var(--status-running-bd)',
    dot: 'var(--status-running-dot)',
    pulse: true,
  },
  stopped: {
    bg: 'var(--status-archived-bg)',
    fg: 'var(--status-archived-fg)',
    bd: 'var(--status-archived-bd)',
    dot: 'var(--status-archived-dot)',
    pulse: false,
  },
  archived: {
    bg: 'var(--status-archived-bg)',
    fg: 'var(--status-archived-fg)',
    bd: 'var(--status-archived-bd)',
    dot: 'var(--status-archived-dot)',
    pulse: false,
  },
};

const CONNECTOR_TOKENS: Record<string, { bg: string; fg: string; bd: string }> = {
  kafka: {
    bg: 'var(--status-pending-bg)',
    fg: 'var(--status-pending-fg)',
    bd: 'var(--status-pending-bd)',
  },
  webhook: {
    bg: 'var(--status-canary-bg)',
    fg: 'var(--status-canary-fg)',
    bd: 'var(--status-canary-bd)',
  },
  redis: {
    bg: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
    fg: 'var(--destructive)',
    bd: 'color-mix(in srgb, var(--destructive) 25%, transparent)',
  },
};

const PRODUCTION_EVENT_KEYS: Record<ProductionReleaseEventTypeDto, TranslationKey> = {
  from_prompt: 'productionReleases.eventType.from_prompt',
  from_experiment: 'productionReleases.eventType.from_experiment',
  from_canary: 'productionReleases.eventType.from_canary',
  config_change: 'productionReleases.eventType.config_change',
  rollback: 'productionReleases.eventType.rollback',
  force_stop: 'productionReleases.eventType.force_stop',
};

const RELEASE_LINE_OPERATION_KEYS: Record<ReleaseLineEventOperationDto, TranslationKey> = {
  create_production: 'releases.event.operation.createProduction',
  create_production_from_experiment: 'releases.event.operation.createProductionFromExperiment',
  create_canary: 'releases.event.createCanary',
  traffic_updated: 'releases.event.ratioChange',
  mode_updated: 'releases.event.operation.modeUpdated',
  config_changed: 'productionReleases.eventType.config_change',
  stop_lane: 'releases.event.operation.stopLane',
  resume_lane: 'releases.event.operation.resumeLane',
  cancel_canary: 'releases.event.operation.cancelCanary',
  promote_canary: 'productionReleases.eventType.from_canary',
  rollback: 'productionReleases.eventType.rollback',
  restore_to_production: 'releases.event.operation.restoreToProduction',
  restore_to_canary: 'releases.event.operation.restoreToCanary',
  force_stop: 'productionReleases.eventType.force_stop',
  archive_line: 'releases.event.operation.archiveLine',
  unarchive_line: 'releases.event.operation.unarchiveLine',
};

function statusLabelKey(status: ReleaseLineStatus): TranslationKey {
  switch (status) {
    case 'running':
      return 'releases.status.running';
    case 'stopped':
      return 'releases.status.stopped';
    case 'archived':
      return 'releases.status.archived';
  }
}

function eventLabelKey(event: ReleaseLineLatestEvent): TranslationKey | null {
  if (!event) return null;
  if (event === 'create_canary') return 'releases.event.createCanary';
  if (event === 'ratio_change') return 'releases.event.ratioChange';
  if (event === 'canary_terminal') return 'releases.event.canaryTerminal';
  if (hasKey(RELEASE_LINE_OPERATION_KEYS, event)) return RELEASE_LINE_OPERATION_KEYS[event];
  if (hasKey(PRODUCTION_EVENT_KEYS, event)) return PRODUCTION_EVENT_KEYS[event];
  return null;
}

function hasKey<T extends string>(map: Record<T, TranslationKey>, key: string): key is T {
  return Object.prototype.hasOwnProperty.call(map, key);
}

export function ReleaseLineStatusBadge({ status, className }: { status: ReleaseLineStatus; className?: string }) {
  const { t } = useI18n();
  const tok = STATUS_TOKENS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-[18px]',
        className,
      )}
      style={{ background: tok.bg, color: tok.fg, borderColor: tok.bd }}
    >
      <i
        className={cn('inline-block size-1.5 rounded-full', tok.pulse && 'animate-pulse')}
        style={{ background: tok.dot }}
      />
      {t(statusLabelKey(status))}
    </span>
  );
}

export function ReleaseEventPill({ event }: { event: ReleaseLineLatestEvent }) {
  const { t } = useI18n();
  const labelKey = eventLabelKey(event);
  if (!labelKey) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold leading-4"
      style={{
        background: 'var(--src-canary-soft)',
        color: 'var(--src-canary-fg)',
        borderColor: 'color-mix(in srgb, var(--src-canary) 30%, transparent)',
      }}
    >
      {t(labelKey)}
    </span>
  );
}

export function ConnectorTypeBadge({ type }: { type: string | null | undefined }) {
  const token = CONNECTOR_TOKENS[type ?? ''] ?? {
    bg: 'var(--status-archived-bg)',
    fg: 'var(--status-archived-fg)',
    bd: 'var(--status-archived-bd)',
  };
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4"
      style={{ background: token.bg, color: token.fg, borderColor: token.bd }}
    >
      {type || 'connector'}
    </span>
  );
}

export function ReleasePill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'production' | 'canary';
  className?: string;
}) {
  const style =
    tone === 'production'
      ? {
          background: 'var(--status-running-bg)',
          color: 'var(--status-running-fg)',
          borderColor: 'var(--status-running-bd)',
        }
      : tone === 'canary'
        ? {
            background: 'var(--status-canary-bg)',
            color: 'var(--status-canary-fg)',
            borderColor: 'var(--status-canary-bd)',
          }
        : undefined;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

export function ReleaseMetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'neutral' | 'production' | 'canary';
}) {
  const style =
    tone === 'production'
      ? {
          background: 'color-mix(in srgb, var(--status-running-dot) 4%, var(--card))',
          borderColor: 'color-mix(in srgb, var(--status-running-dot) 30%, var(--border))',
        }
      : tone === 'canary'
        ? {
            background: 'color-mix(in srgb, var(--status-canary-dot) 4%, var(--card))',
            borderColor: 'color-mix(in srgb, var(--status-canary-dot) 30%, var(--border))',
          }
        : undefined;

  return (
    <div className="rounded-lg border bg-card px-4 py-3" style={style}>
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[26px] font-semibold leading-none tabular-nums">{value}</div>
      {detail ? <div className="mt-1.5 text-[11.5px] text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

type TrafficLaneTone = 'production' | 'canary' | 'muted';

const TRAFFIC_LANE_TOKENS: Record<
  TrafficLaneTone,
  { fg: string; bd: string; iconBg: string }
> = {
  production: {
    fg: 'var(--status-running-fg)',
    bd: 'color-mix(in srgb, var(--status-running-dot) 22%, var(--border))',
    iconBg: 'color-mix(in srgb, var(--status-running-dot) 12%, var(--card))',
  },
  canary: {
    fg: 'var(--status-canary-fg)',
    bd: 'color-mix(in srgb, var(--status-canary-dot) 28%, var(--border))',
    iconBg: 'color-mix(in srgb, var(--status-canary-dot) 14%, var(--card))',
  },
  muted: {
    fg: 'var(--muted-foreground)',
    bd: 'var(--border)',
    iconBg: 'var(--card)',
  },
};

function clampTrafficPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function TrafficAllocationRow({
  icon: Icon,
  label,
  percent,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  percent: number;
  tone: TrafficLaneTone;
}) {
  const value = clampTrafficPercent(percent);
  const tokens = TRAFFIC_LANE_TOKENS[tone];
  return (
    <div className="inline-flex h-5 w-fit items-center gap-1.5" aria-label={`${label} ${value}%`}>
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-md border"
              style={{ background: tokens.iconBg, color: tokens.fg, borderColor: tokens.bd }}
              title={label}
              aria-label={label}
            >
              <Icon className="size-3" aria-hidden="true" strokeWidth={2.2} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span className="shrink-0 tabular-nums" style={{ color: tokens.fg }}>
        {value}%
      </span>
    </div>
  );
}

export function ReleaseTrafficBar({ line }: { line: ReleaseLineView }) {
  const { t } = useI18n();
  const ratio = Math.max(0, Math.min(1, line.trafficRatio ?? 0));
  const canaryPercent = Math.round(ratio * 100);
  const prodPercent = Math.max(0, 100 - canaryPercent);

  if (line.status !== 'running') {
    return (
      <div className="flex h-7 items-center justify-center rounded-md border bg-muted font-mono text-[11px] font-semibold text-muted-foreground">
        {t('releases.traffic.offline')}
      </div>
    );
  }

  const hasRunningProduction = line.production?.currentEvent?.status === 'running';
  const hasRunningCanary = line.canary?.status === 'running';

  if (!hasRunningProduction && !hasRunningCanary) {
    return (
      <div className="flex h-7 items-center justify-center rounded-md border bg-muted font-mono text-[11px] font-semibold text-muted-foreground">
        {t('releases.traffic.offline')}
      </div>
    );
  }

  if (hasRunningProduction && !hasRunningCanary) {
    return (
      <div className="inline-flex font-mono text-[10.5px] font-semibold leading-none">
        <TrafficAllocationRow
          icon={Rocket}
          label={t('releases.traffic.productionLane')}
          percent={100}
          tone="production"
        />
      </div>
    );
  }

  const isDualRun = line.canary?.trafficMode === 'dual_run';
  const productionPercent = hasRunningProduction ? (isDualRun ? 100 : prodPercent) : Math.max(0, 100 - canaryPercent);
  const CanaryIcon = isDualRun ? GitCompareArrows : Split;
  const canaryLabel = t(isDualRun ? 'releases.traffic.canaryDualRun' : 'releases.traffic.canarySplit');

  return (
    <div className="inline-flex flex-col items-start gap-1 font-mono text-[10.5px] font-semibold leading-none">
      {hasRunningProduction ? (
        <TrafficAllocationRow
          icon={Rocket}
          label={t('releases.traffic.productionLane')}
          percent={productionPercent}
          tone="production"
        />
      ) : (
        <TrafficAllocationRow
          icon={Split}
          label={t('releases.traffic.passThrough')}
          percent={Math.max(0, 100 - canaryPercent)}
          tone="muted"
        />
      )}
      <TrafficAllocationRow
        icon={CanaryIcon}
        label={canaryLabel}
        percent={canaryPercent}
        tone="canary"
      />
    </div>
  );
}

export function formatCount(value: number) {
  return new Intl.NumberFormat('en-US', { notation: value >= 100000 ? 'compact' : 'standard' }).format(value);
}

export function formatPercent(value: number | null, fractionDigits = 2) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDateTimeOrDash(value: string | null | undefined) {
  return value ? formatDateTime(value) : '—';
}
