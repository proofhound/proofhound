import type {
  ConnectorDetailDto,
  ConnectorDirection,
  ConnectorHealthStatus,
  ConnectorListItemDto,
  ConnectorReferencesSummaryDto,
  ConnectorType,
} from '@proofhound/shared';
import type { TranslationKey } from '../../i18n';

export type ConnectorListItem = ConnectorListItemDto;
export type ConnectorDetail = ConnectorDetailDto;
export type { ConnectorDirection, ConnectorHealthStatus, ConnectorType };

export interface ConnectorKindOption {
  value: ConnectorType;
  labelKey: TranslationKey;
}

export const CONNECTOR_TYPE_OPTIONS: ConnectorKindOption[] = [
  { value: 'redis', labelKey: 'connectors.type.redis' },
  { value: 'kafka', labelKey: 'connectors.type.kafka' },
  { value: 'webhook', labelKey: 'connectors.type.webhook' },
];

export const CONNECTOR_DIRECTION_OPTIONS: Array<{ value: ConnectorDirection; labelKey: TranslationKey }> = [
  { value: 'input', labelKey: 'connectors.direction.input' },
  { value: 'output', labelKey: 'connectors.direction.output' },
];

export type ConnectorFilter =
  | { kind: 'all' }
  | { kind: 'direction'; value: ConnectorDirection }
  | { kind: 'type'; value: ConnectorType }
  | { kind: 'health'; value: ConnectorHealthStatus };

export function getReferenceTotal(refs: ConnectorReferencesSummaryDto | undefined): number {
  if (!refs) return 0;
  return (refs.canaryReleases ?? 0) + (refs.productionReleases ?? 0);
}

export function connectorMatchesFilter(item: ConnectorListItem, filter: ConnectorFilter): boolean {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'direction') return item.direction === filter.value;
  if (filter.kind === 'type') return item.type === filter.value;
  if (filter.kind === 'health') return item.healthStatus === filter.value;
  return true;
}

export function getConnectorSearchText(item: ConnectorListItem): string {
  return [item.name, item.description ?? '', item.webhookPath ?? '', item.configSummary]
    .join(' ')
    .toLowerCase();
}

export interface ConnectorKindLocale {
  direction: Record<ConnectorDirection, TranslationKey>;
  type: Record<ConnectorType, TranslationKey>;
  health: Record<ConnectorHealthStatus, TranslationKey>;
}

export const CONNECTOR_LOCALE: ConnectorKindLocale = {
  direction: {
    input: 'connectors.direction.input',
    output: 'connectors.direction.output',
  },
  type: {
    redis: 'connectors.type.redis',
    kafka: 'connectors.type.kafka',
    webhook: 'connectors.type.webhook',
  },
  health: {
    healthy: 'connectors.health.healthy',
    degraded: 'connectors.health.degraded',
    unhealthy: 'connectors.health.unhealthy',
    unknown: 'connectors.health.unknown',
  },
};
