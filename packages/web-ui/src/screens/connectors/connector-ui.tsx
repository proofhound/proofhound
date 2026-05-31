'use client';

import { ArrowDownToLine, ArrowUpFromLine, type LucideIcon, MessagesSquare, Plug, Webhook } from 'lucide-react';
import { Badge, cn } from '@proofhound/ui';
import { useI18n } from '../../i18n';
import { CONNECTOR_LOCALE, type ConnectorDirection, type ConnectorHealthStatus, type ConnectorType } from './connector-types';

const TYPE_ICON: Record<ConnectorType, LucideIcon> = {
  redis: MessagesSquare,
  kafka: Plug,
  webhook: Webhook,
};

const DIRECTION_ICON: Record<ConnectorDirection, LucideIcon> = {
  input: ArrowDownToLine,
  output: ArrowUpFromLine,
};

const HEALTH_CLASS: Record<ConnectorHealthStatus, string> = {
  healthy: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  degraded: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  unhealthy: 'bg-destructive/15 text-destructive border-destructive/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

const DIRECTION_CLASS: Record<ConnectorDirection, string> = {
  input: 'bg-[var(--modality-text-bg)] text-[var(--modality-text-fg)] border-[var(--modality-text-bd)]',
  output: 'bg-[var(--modality-image-bg)] text-[var(--modality-image-fg)] border-[var(--modality-image-bd)]',
};

export function DirectionBadge({ direction, className }: { direction: ConnectorDirection; className?: string }) {
  const { t } = useI18n();
  const Icon = DIRECTION_ICON[direction];
  return (
    <Badge variant="outline" className={cn('gap-1 border', DIRECTION_CLASS[direction], className)}>
      <Icon className="h-3 w-3" />
      {t(CONNECTOR_LOCALE.direction[direction])}
    </Badge>
  );
}

export function ConnectorTypeBadge({ type, className }: { type: ConnectorType; className?: string }) {
  const { t } = useI18n();
  const Icon = TYPE_ICON[type];
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 whitespace-nowrap border-transparent bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground', className)}
    >
      <Icon className="size-3" />
      {t(CONNECTOR_LOCALE.type[type])}
    </Badge>
  );
}

export function HealthBadge({ status, className }: { status: ConnectorHealthStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className={cn('border', HEALTH_CLASS[status], className)}>
      {t(CONNECTOR_LOCALE.health[status])}
    </Badge>
  );
}
