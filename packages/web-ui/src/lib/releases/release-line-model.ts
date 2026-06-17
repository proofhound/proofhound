import type {
  CanaryReleaseListItemDto,
  CanaryReleaseStatusDto,
  ProductionReleaseEventDto,
  ProductionReleaseEventTypeDto,
  ProductionReleaseListItemDto,
  ReleaseLineDto,
  ReleaseLineEventDto,
} from '@proofhound/shared';

export type ReleaseLineStatus = 'running' | 'stopped' | 'archived';

export type ReleaseLineFilter = ReleaseLineStatus | 'all';

export type ReleaseLineLatestEvent =
  | ProductionReleaseEventTypeDto
  | 'create_canary'
  | 'ratio_change'
  | 'canary_terminal'
  | ReleaseLineEventDto['operation']
  | null;

export interface ReleaseLineView {
  id: string;
  label: string;
  promptId: string | null;
  promptName: string;
  inputConnectorId: string | null;
  inputConnectorName: string | null;
  inputConnectorType: string | null;
  inputConnectorSnapshot: unknown;
  outputConnectors: Array<{ id: string; name: string; type: string }>;
  status: ReleaseLineStatus;
  production: ProductionReleaseListItemDto | null;
  productionOutputMapping: unknown;
  canary: CanaryReleaseListItemDto | null;
  canaryOutputMapping: unknown;
  canaryPromptVersionSnapshot: unknown;
  canaryHistory: CanaryReleaseListItemDto[];
  versions: ReleaseLineDto['versions'];
  productionVersionLabel: string | null;
  productionModelName: string | null;
  canaryVersionLabel: string | null;
  canaryModelName: string | null;
  trafficRatio: number | null;
  latestEvent: ReleaseLineLatestEvent;
  createdAt: string | null;
  updatedAt: string | null;
  totalReceived: number;
  totalProcessed: number;
  totalErrors: number;
  annotationSubmitted: number;
  annotationTotal: number;
}

export interface ReleaseLineSummary {
  total: number;
  running: number;
  production: number;
  productionCanary: number;
  canary: number;
  stopped: number;
  archived: number;
  totalProcessed: number;
  totalErrors: number;
  failureRate: number | null;
  annotationOpen: number;
}

const ACTIVE_CANARY_STATUSES = new Set<CanaryReleaseStatusDto>(['running', 'stopped']);

function normalizeOutputMapping(value: unknown): Array<{ source: string; target: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { source: string; target: string } => {
      return (
        Boolean(item) &&
        typeof item === 'object' &&
        'source' in item &&
        'target' in item &&
        typeof item.source === 'string' &&
        typeof item.target === 'string'
      );
    })
    .map((item) => ({ source: item.source, target: item.target }));
}

function normalizeOutputMappingSnapshot(value: unknown): unknown {
  if (!Array.isArray(value)) return [];
  const connectorRoutes = value
    .filter((item): item is { connectorId: string; outputMapping: unknown } => {
      return (
        Boolean(item) &&
        typeof item === 'object' &&
        'connectorId' in item &&
        'outputMapping' in item &&
        typeof item.connectorId === 'string'
      );
    })
    .map((item) => ({ connectorId: item.connectorId, outputMapping: normalizeOutputMapping(item.outputMapping) }));
  return connectorRoutes.length ? connectorRoutes : normalizeOutputMapping(value);
}

const CANARY_STATUS_RANK: Record<CanaryReleaseStatusDto, number> = {
  running: 0,
  pending: 1,
  stopped: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};

function timeValue(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function latestDate(values: Array<string | null | undefined>) {
  const best = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => timeValue(right) - timeValue(left))[0];
  return best ?? null;
}

function earliestDate(values: Array<string | null | undefined>) {
  const best = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => timeValue(left) - timeValue(right))[0];
  return best ?? null;
}

function connectorKey(inputConnectorId: string | null | undefined) {
  return inputConnectorId ?? 'no-input-connector';
}

export function getReleaseLineId(promptId: string | null, inputConnectorId: string | null) {
  return `${promptId ?? 'unknown-prompt'}--${connectorKey(inputConnectorId)}`;
}

function getReleaseLineLabel(id: string) {
  return `line_${id
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toLowerCase()}`;
}

function chooseCurrentCanary(canaries: CanaryReleaseListItemDto[]) {
  return (
    [...canaries].sort((left, right) => {
      const rankDelta = CANARY_STATUS_RANK[left.status] - CANARY_STATUS_RANK[right.status];
      if (rankDelta !== 0) return rankDelta;
      return timeValue(right.updatedAt) - timeValue(left.updatedAt);
    })[0] ?? null
  );
}

function chooseActiveCanary(canaries: CanaryReleaseListItemDto[]) {
  return chooseCurrentCanary(canaries.filter(isActiveCanary));
}

function sortCanaryHistory(canaries: CanaryReleaseListItemDto[]) {
  return [...canaries].sort((left, right) => timeValue(left.createdAt) - timeValue(right.createdAt));
}

function isActiveCanary(canary: CanaryReleaseListItemDto | null) {
  return canary ? ACTIVE_CANARY_STATUSES.has(canary.status) : false;
}

function getProductionConnector(production: ProductionReleaseListItemDto) {
  return production.currentEvent?.inputConnectorId ?? null;
}

function getProductionOutputConnectors(production: ProductionReleaseListItemDto | null) {
  return production?.outputConnectors ?? [];
}

function getLineOutputConnectors(
  production: ProductionReleaseListItemDto | null,
  canary: CanaryReleaseListItemDto | null,
) {
  const map = new Map<string, { id: string; name: string; type: string }>();
  for (const connector of getProductionOutputConnectors(production)) {
    map.set(connector.id, connector);
  }
  for (const connector of canary?.outputConnectors ?? []) {
    map.set(connector.id, connector);
  }
  return [...map.values()];
}

function getLineLatestEvent(
  production: ProductionReleaseListItemDto | null,
  canary: CanaryReleaseListItemDto | null,
): ReleaseLineLatestEvent {
  const productionTime = timeValue(production?.currentEvent?.updatedAt ?? production?.currentEventCreatedAt);
  const canaryTime = timeValue(canary?.updatedAt);
  if (canary && canaryTime >= productionTime) {
    if (canary.status === 'running' && canary.trafficRatio > 0) return 'ratio_change';
    if (ACTIVE_CANARY_STATUSES.has(canary.status)) return 'create_canary';
    return 'canary_terminal';
  }
  return production?.lastEventType ?? null;
}

function getPromptName(production: ProductionReleaseListItemDto | null, canary: CanaryReleaseListItemDto | null) {
  return production?.promptName ?? canary?.promptName ?? canary?.name ?? '—';
}

function getInputConnectorName(
  production: ProductionReleaseListItemDto | null,
  canary: CanaryReleaseListItemDto | null,
) {
  return production?.inputConnectorName ?? canary?.inputConnectorName ?? null;
}

function getInputConnectorType(
  production: ProductionReleaseListItemDto | null,
  canary: CanaryReleaseListItemDto | null,
) {
  return production?.inputConnectorType ?? canary?.inputConnectorType ?? null;
}

function buildLineStatus(
  production: ProductionReleaseListItemDto | null,
  canary: CanaryReleaseListItemDto | null,
): ReleaseLineStatus {
  const hasProduction = production?.aggregateStatus === 'online' && Boolean(production.currentEvent);
  const hasRunningCanary = canary?.status === 'running';
  if (hasProduction || hasRunningCanary) return 'running';
  return 'stopped';
}

interface ReleaseLineBucket {
  production: ProductionReleaseListItemDto | null;
  canaries: CanaryReleaseListItemDto[];
}

function ensureBucket(map: Map<string, ReleaseLineBucket>, id: string) {
  const current = map.get(id);
  if (current) return current;
  const next: ReleaseLineBucket = { production: null, canaries: [] };
  map.set(id, next);
  return next;
}

export function buildReleaseLines(
  productionItems: ProductionReleaseListItemDto[],
  canaryItems: CanaryReleaseListItemDto[],
): ReleaseLineView[] {
  const buckets = new Map<string, ReleaseLineBucket>();

  for (const production of productionItems) {
    if (!production.currentEvent) continue;
    const inputConnectorId = getProductionConnector(production);
    const id = getReleaseLineId(production.promptId, inputConnectorId);
    const bucket = ensureBucket(buckets, id);
    bucket.production = production;
  }

  for (const canary of canaryItems) {
    const promptId = canary.promptId ?? canary.id;
    const id = getReleaseLineId(promptId, canary.inputConnectorId);
    const bucket = ensureBucket(buckets, id);
    bucket.canaries.push(canary);
  }

  return [...buckets.entries()]
    .map(([id, bucket]) => {
      const canary = chooseActiveCanary(bucket.canaries);
      const latestCanary = chooseCurrentCanary(bucket.canaries);
      const canaryHistory = sortCanaryHistory(bucket.canaries);
      const production = bucket.production;
      const promptId = production?.promptId ?? canary?.promptId ?? latestCanary?.promptId ?? null;
      const inputConnectorId =
        production?.currentEvent?.inputConnectorId ??
        canary?.inputConnectorId ??
        latestCanary?.inputConnectorId ??
        null;
      const status = buildLineStatus(production, canary);
      const outputConnectors = getLineOutputConnectors(production, canary);
      const updatedAt = latestDate([
        production?.currentEvent?.updatedAt,
        production?.currentEventCreatedAt,
        canary?.updatedAt,
        latestCanary?.updatedAt,
      ]);
      const createdAt = earliestDate([
        production?.currentEvent?.createdAt,
        production?.currentEventCreatedAt,
        canary?.createdAt,
        latestCanary?.createdAt,
      ]);

      return {
        id,
        label: getReleaseLineLabel(id),
        promptId,
        promptName: getPromptName(production, canary ?? latestCanary),
        inputConnectorId,
        inputConnectorName: getInputConnectorName(production, canary ?? latestCanary),
        inputConnectorType: getInputConnectorType(production, canary ?? latestCanary),
        inputConnectorSnapshot: null,
        outputConnectors,
        status,
        production,
        productionOutputMapping: [],
        canary,
        canaryOutputMapping: canary?.outputMapping ?? [],
        canaryPromptVersionSnapshot: null,
        canaryHistory,
        versions: [],
        productionVersionLabel: production?.promptVersionLabel ?? null,
        productionModelName: production?.modelName ?? null,
        canaryVersionLabel: canary?.promptVersionLabel ?? null,
        canaryModelName: canary?.modelName ?? null,
        trafficRatio: canary ? canary.trafficRatio : null,
        latestEvent: getLineLatestEvent(production, canary ?? latestCanary),
        createdAt,
        updatedAt,
        totalReceived: canary?.totalReceived ?? 0,
        totalProcessed: canary?.totalProcessed ?? 0,
        totalErrors: canary?.totalErrors ?? 0,
        annotationSubmitted: canary?.annotationProgress.submitted ?? 0,
        annotationTotal: canary?.annotationProgress.total ?? 0,
      } satisfies ReleaseLineView;
    })
    .sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt));
}

export function mapReleaseLineDtos(items: ReleaseLineDto[]): ReleaseLineView[] {
  return items
    .map((line) => {
      const production = mapProductionLine(line);
      const canary = mapCanaryLine(line);
      const canaryHistory = canary ? [canary] : [];
      return {
        id: line.id,
        label: line.name,
        promptId: line.promptId,
        promptName: line.promptName,
        inputConnectorId: line.inputConnectorId,
        inputConnectorName: line.inputConnectorName,
        inputConnectorType: line.inputConnectorType,
        inputConnectorSnapshot: line.inputConnectorSnapshot,
        outputConnectors: line.outputConnectors,
        status: mapCanonicalLineStatus(line),
        production,
        productionOutputMapping: normalizeOutputMappingSnapshot(line.currentProductionEvent?.outputMapping),
        canary,
        canaryOutputMapping: normalizeOutputMappingSnapshot(line.activeCanaryEvent?.outputMapping),
        canaryPromptVersionSnapshot: line.activeCanaryEvent?.promptVersionSnapshot ?? null,
        canaryHistory,
        versions: line.versions,
        productionVersionLabel: line.currentProductionEvent?.promptVersionLabel ?? null,
        productionModelName: line.currentProductionEvent?.modelName ?? null,
        canaryVersionLabel: line.activeCanaryEvent?.promptVersionLabel ?? null,
        canaryModelName: line.activeCanaryEvent?.modelName ?? null,
        trafficRatio: line.activeCanaryEvent?.trafficRatio ?? null,
        latestEvent: line.latestEvent ? mapCanonicalLatestEvent(line.latestEvent) : null,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
        totalReceived:
          (line.currentProductionEvent?.totalReceived ?? 0) + (line.activeCanaryEvent?.totalReceived ?? 0),
        totalProcessed:
          (line.currentProductionEvent?.totalProcessed ?? 0) + (line.activeCanaryEvent?.totalProcessed ?? 0),
        totalErrors: (line.currentProductionEvent?.totalErrors ?? 0) + (line.activeCanaryEvent?.totalErrors ?? 0),
        annotationSubmitted: 0,
        annotationTotal: 0,
      } satisfies ReleaseLineView;
    })
    .sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt));
}

export function getReleaseResultSourceIds(line: ReleaseLineView): string[] {
  const ids = [line.production?.currentEvent?.id, line.canary?.id].filter((value): value is string => Boolean(value));
  return [...new Set(ids)];
}

export function getReleaseStopConfirmationName(line: ReleaseLineView | null): string {
  const lineName = line?.label.trim();
  if (lineName) return lineName;

  const reason = line?.production?.currentEvent?.submitReason.split('\n')[0]?.trim();
  return reason ? stripLegacyCanaryPromotionPrefix(reason) : '';
}

function stripLegacyCanaryPromotionPrefix(value: string): string {
  return value.replace(/^灰度候选\s*100%\s*接管[：:]\s*/u, '').trim();
}

function mapCanonicalLineStatus(line: ReleaseLineDto): ReleaseLineStatus {
  return line.status;
}

function mapCanonicalLatestEvent(event: ReleaseLineEventDto): ReleaseLineLatestEvent {
  if (event.operation === 'create_canary') return 'create_canary';
  if (event.operation === 'traffic_updated') return 'ratio_change';
  if (event.operation === 'cancel_canary' || event.status === 'cancelled' || event.status === 'failed') {
    return 'canary_terminal';
  }
  if (event.operation === 'create_production_from_experiment') return 'from_experiment';
  if (event.operation === 'create_production') return 'from_prompt';
  if (event.operation === 'promote_canary') return 'from_canary';
  if (event.operation === 'config_changed') return 'config_change';
  if (event.operation === 'force_stop') return 'force_stop';
  if (event.operation === 'rollback') return 'rollback';
  return event.operation;
}

function mapProductionLine(line: ReleaseLineDto): ProductionReleaseListItemDto | null {
  const event = line.currentProductionEvent;
  if (!event) return null;
  return {
    promptId: line.promptId ?? event.promptId ?? line.id,
    promptName: line.promptName,
    promptVersionLabel: event.promptVersionLabel,
    aggregateStatus: event.status === 'running' ? 'online' : 'offline',
    currentEvent: mapProductionEvent(event),
    currentEventCreatedAt: event.createdAt,
    modelName: event.modelName,
    modelProvider: event.modelProvider,
    inputConnectorName: event.inputConnectorName,
    inputConnectorType: event.inputConnectorType,
    outputConnectors: event.outputConnectors,
    lastEventType: mapProductionEventType(event),
    onlineDurationMs: null,
  };
}

function mapProductionEvent(event: ReleaseLineEventDto): ProductionReleaseEventDto {
  return {
    id: event.id,
    projectId: event.projectId,
    promptId: event.promptId ?? event.releaseLineId,
    eventType: mapProductionEventType(event),
    promptVersionId: event.promptVersionId ?? event.id,
    modelId: event.modelId ?? event.id,
    inputConnectorId: event.inputConnectorId,
    outputConnectorIds: event.outputConnectorIds,
    runConfig: event.runConfig as ProductionReleaseEventDto['runConfig'],
    variableMapping: normalizeProductionVariableMapping(event.variableMapping),
    filterRules: event.filterRules as ProductionReleaseEventDto['filterRules'],
    recordMode: event.recordMode,
    recordCategories: event.recordCategories,
    externalIdField: event.externalIdField,
    retentionDays: event.retentionDays,
    status: mapProductionStatus(event.status),
    createdBy: event.createdBy,
    submitReason: event.submitReason,
    sourceExperimentId: event.sourceExperimentId,
    sourceCanaryId: event.sourceEventId,
    sourceMetricsSnapshot: event.metrics,
    promptSnapshot: event.promptSnapshot,
    promptVersionSnapshot: event.promptVersionSnapshot,
    rollbackTargetEventId: event.rollbackTargetEventId,
    controlState: null,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    stopReason:
      event.terminalReason === 'replaced' ||
      event.terminalReason === 'rolled_back' ||
      event.terminalReason === 'force_stopped' ||
      event.terminalReason === 'error'
        ? event.terminalReason
        : null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function mapProductionStatus(status: ReleaseLineEventDto['status']): ProductionReleaseEventDto['status'] {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'archived') return 'stopped';
  return status;
}

function mapProductionEventType(event: ReleaseLineEventDto): ProductionReleaseEventTypeDto {
  if (event.operation === 'create_production_from_experiment') return 'from_experiment';
  if (event.operation === 'promote_canary') return 'from_canary';
  if (event.operation === 'config_changed') return 'config_change';
  if (event.operation === 'rollback' || event.operation === 'restore_to_production') return 'rollback';
  if (event.operation === 'force_stop') return 'force_stop';
  return 'from_prompt';
}

function normalizeProductionVariableMapping(value: unknown): ProductionReleaseEventDto['variableMapping'] {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as ProductionReleaseEventDto['variableMapping'];
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(
    value
      .filter((item): item is { source: string; target: string } => {
        return Boolean(item) && typeof item === 'object' && 'source' in item && 'target' in item;
      })
      .map((item) => [item.target, item.source]),
  );
}

function mapCanaryLine(line: ReleaseLineDto): CanaryReleaseListItemDto | null {
  const event = line.activeCanaryEvent;
  if (!event) return null;
  return {
    id: event.id,
    projectId: event.projectId,
    releaseLineId: line.id,
    name: line.name,
    description: line.description,
    promptVersionId: event.promptVersionId ?? event.id,
    modelId: event.modelId ?? event.id,
    inputConnectorId: event.inputConnectorId ?? line.inputConnectorId ?? event.id,
    outputConnectorIds: event.outputConnectorIds,
    status: event.status === 'archived' ? 'cancelled' : event.status,
    controlState: null,
    controlStatePayload: null,
    trafficRatio: event.trafficRatio ?? 0,
    trafficMode: event.trafficMode ?? 'split',
    runMode: 'manual',
    stopConditions: null,
    recordMode: event.recordMode,
    recordCategories: event.recordCategories,
    filterRules: event.filterRules as CanaryReleaseListItemDto['filterRules'],
    variableMapping: normalizeCanaryVariableMapping(event.variableMapping),
    outputMapping: normalizeOutputMapping(event.outputMapping),
    externalIdField: event.externalIdField ?? 'id',
    annotationSchema: [],
    storageCategories: event.recordCategories,
    targetDatasetId: null,
    runConfig: event.runConfig as CanaryReleaseListItemDto['runConfig'],
    totalReceived: event.totalReceived,
    totalProcessed: event.totalProcessed,
    totalFiltered: event.totalFiltered,
    totalCorrect: event.totalCorrect,
    totalErrors: event.totalErrors,
    metrics: event.metrics,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    createdBy: event.createdBy,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    promptId: event.promptId,
    promptName: event.promptName,
    promptVersionLabel: event.promptVersionLabel,
    modelName: event.modelName,
    modelProvider: event.modelProvider,
    inputConnectorName: event.inputConnectorName,
    inputConnectorType: event.inputConnectorType,
    outputConnectors: event.outputConnectors,
    targetDatasetName: null,
    createdByName: null,
    annotationTaskId: null,
    releaseVersionId: event.releaseVersionId,
    releaseVersionLabel: event.releaseVersionLabel,
    annotationProgress: { total: 0, claimed: 0, submitted: 0 },
    quality: null,
  };
}

function normalizeCanaryVariableMapping(value: unknown): CanaryReleaseListItemDto['variableMapping'] {
  if (Array.isArray(value)) return value as CanaryReleaseListItemDto['variableMapping'];
  if (!value || typeof value !== 'object') return [{ source: 'id', target: 'id', required: true }];
  return Object.entries(value as Record<string, unknown>).map(([target, source]) => ({
    source: typeof source === 'string' ? source : target,
    target,
    required: target === 'id',
  }));
}

export function summarizeReleaseLines(lines: ReleaseLineView[]): ReleaseLineSummary {
  const summary: ReleaseLineSummary = {
    total: lines.length,
    running: 0,
    production: 0,
    productionCanary: 0,
    canary: 0,
    stopped: 0,
    archived: 0,
    totalProcessed: 0,
    totalErrors: 0,
    failureRate: null,
    annotationOpen: 0,
  };

  for (const line of lines) {
    const hasProduction = Boolean(line.production?.currentEvent);
    const hasRunningCanary = line.canary?.status === 'running';
    if (line.status === 'running') summary.running += 1;
    if (hasProduction && hasRunningCanary) summary.productionCanary += 1;
    else if (hasProduction) summary.production += 1;
    else if (hasRunningCanary) summary.canary += 1;
    if (line.status === 'stopped') summary.stopped += 1;
    if (line.status === 'archived') summary.archived += 1;
    summary.totalProcessed += line.totalProcessed;
    summary.totalErrors += line.totalErrors;
    summary.annotationOpen += Math.max(0, line.annotationTotal - line.annotationSubmitted);
  }

  summary.failureRate = summary.totalProcessed > 0 ? summary.totalErrors / summary.totalProcessed : null;
  return summary;
}

export function filterReleaseLines(lines: ReleaseLineView[], filter: ReleaseLineFilter, search: string) {
  const needle = search.trim().toLowerCase();
  return lines.filter((line) => {
    if (filter !== 'all' && line.status !== filter) return false;
    if (!needle) return true;
    return [
      line.label,
      line.promptName,
      line.productionVersionLabel,
      line.productionModelName,
      line.canaryVersionLabel,
      line.canaryModelName,
      line.inputConnectorName,
      line.inputConnectorType,
      ...line.outputConnectors.map((connector) => connector.name),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}
