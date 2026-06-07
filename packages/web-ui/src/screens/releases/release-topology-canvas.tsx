'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { Cable, FlaskConical, Plus, RadioTower, Rocket, Save, Split, type LucideIcon } from 'lucide-react';
import type {
  CanaryReleaseListItemDto,
  ProjectModelListItemDto,
  ReleaseLineLaneTypeDto,
  UpdateReleaseLineRunConfigInputDto,
} from '@proofhound/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@proofhound/ui';
import { useDateTimeFormatter } from '../../hooks';
import { useI18n } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import type { ReleaseLineView } from '../../lib';
import { ReleasePill, formatPercent } from './release-line-ui';

type ReleaseTopologyTone = 'neutral' | 'production' | 'canary' | 'muted';

type ReleaseTopologyNodeData = {
  icon: 'upstream' | 'router' | 'production' | 'canary' | 'downstream' | 'addCanary';
  label: string;
  title: string;
  meta?: string;
  detail?: string;
  tone: ReleaseTopologyTone;
  mutedBorder?: boolean;
  badges?: string[];
  action?: 'addCanary';
} & Record<string, unknown>;

type ReleaseTopologyNode = Node<ReleaseTopologyNodeData, 'releaseTopology'>;
type ReleaseTopologyEdge = Edge;
type ReleaseTopologyNodeId = 'upstream' | 'input-route' | 'production' | 'canary' | 'output-route' | `output-${string}`;
type DateTimeOrDashFormatter = (value: string | null | undefined) => string;

interface InspectorRow {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}

interface InspectorBlock {
  title: string;
  body: string;
}

interface InspectorDetail {
  icon: ReleaseTopologyNodeData['icon'];
  label: string;
  title?: string;
  subtitle?: string;
  tone: ReleaseTopologyTone;
  rows: InspectorRow[];
  content?: ReactNode;
  runtimeEditor?: ReactNode;
  blocks?: InspectorBlock[];
  action?: ReactNode;
  hideSummary?: boolean;
}

const TONE_STYLES: Record<ReleaseTopologyTone, { bg: string; fg: string; bd: string; dot: string }> = {
  neutral: {
    bg: 'var(--card)',
    fg: 'var(--foreground)',
    bd: 'var(--border)',
    dot: 'var(--muted-foreground)',
  },
  production: {
    bg: 'color-mix(in srgb, var(--status-running-dot) 5%, var(--card))',
    fg: 'var(--status-running-fg)',
    bd: 'color-mix(in srgb, var(--status-running-dot) 35%, var(--border))',
    dot: 'var(--status-running-dot)',
  },
  canary: {
    bg: 'color-mix(in srgb, var(--status-canary-dot) 5%, var(--card))',
    fg: 'var(--status-canary-fg)',
    bd: 'color-mix(in srgb, var(--status-canary-dot) 35%, var(--border))',
    dot: 'var(--status-canary-dot)',
  },
  muted: {
    bg: 'color-mix(in srgb, var(--muted) 58%, var(--card))',
    fg: 'var(--muted-foreground)',
    bd: 'var(--border)',
    dot: 'var(--muted-foreground)',
  },
};

const EDGE_STYLES: Record<'neutral' | 'production' | 'canary' | 'muted', string> = {
  neutral: 'var(--muted-foreground)',
  production: 'var(--status-running-dot)',
  canary: 'var(--status-canary-dot)',
  muted: 'var(--border)',
};

const NODE_ICONS: Record<ReleaseTopologyNodeData['icon'], LucideIcon> = {
  upstream: RadioTower,
  router: Split,
  production: Rocket,
  canary: FlaskConical,
  downstream: Cable,
  addCanary: Plus,
};

function ReleaseTopologyNodeCard({ data, selected }: NodeProps<ReleaseTopologyNode>) {
  const token = TONE_STYLES[data.tone];
  const Icon = NODE_ICONS[data.icon];
  const borderColor = data.mutedBorder ? 'var(--border)' : token.bd;

  return (
    <div
      className={cn(
        'relative h-[116px] w-[236px] cursor-pointer rounded-lg border px-3 py-3 shadow-sm transition',
        data.tone === 'muted' && 'border-dashed opacity-80',
        data.action === 'addCanary' && 'hover:border-[var(--status-canary-bd)] hover:opacity-100',
        selected && 'ring-2 ring-primary/25',
      )}
      style={{ background: token.bg, borderColor }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border !bg-card !opacity-0"
        style={{ borderColor: token.bd }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border !bg-card !opacity-0"
        style={{ borderColor: token.bd }}
      />
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border"
          style={{ background: 'var(--background)', borderColor: token.bd, color: token.dot }}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-[11.5px] font-medium text-muted-foreground">{data.label}</span>
            {data.badges?.[0] ? (
              <ReleasePill
                tone={data.tone === 'production' ? 'production' : data.tone === 'canary' ? 'canary' : 'neutral'}
                className="max-w-[92px] shrink-0 truncate"
              >
                {data.badges[0]}
              </ReleasePill>
            ) : null}
          </div>
          <div className="mt-1 truncate font-mono text-[13px] font-semibold" title={data.title}>
            {data.title}
          </div>
          {data.meta ? (
            <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground" title={data.meta}>
              {data.meta}
            </div>
          ) : null}
          {data.detail ? (
            <div className="mt-1.5 truncate text-[11.5px] font-medium" style={{ color: token.fg }} title={data.detail}>
              {data.detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  releaseTopology: ReleaseTopologyNodeCard,
} satisfies NodeTypes;

function createEdge({
  id,
  source,
  target,
  label,
  tone = 'neutral',
  dashed = false,
  animated,
}: {
  id: string;
  source: string;
  target: string;
  label?: string;
  tone?: 'neutral' | 'production' | 'canary' | 'muted';
  dashed?: boolean;
  animated?: boolean;
}): ReleaseTopologyEdge {
  const color = EDGE_STYLES[tone];
  return {
    id,
    source,
    target,
    label,
    type: 'smoothstep',
    animated: animated ?? (tone === 'production' || tone === 'canary'),
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: {
      stroke: color,
      strokeWidth: tone === 'muted' ? 1.3 : 2,
      strokeDasharray: dashed ? '6 5' : undefined,
    },
    labelStyle: {
      fill: 'var(--muted-foreground)',
      fontSize: 11,
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: 'var(--card)',
      fillOpacity: 0.92,
    },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 6,
  };
}

function outputNodePosition(index: number, total: number) {
  const compact = total <= 2;
  const step = compact ? 126 : 108;
  const startY = 136 - ((total - 1) * step) / 2;
  return { x: 1240, y: startY + index * step };
}

function clampTrafficRatio(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function getTrafficState(line: ReleaseLineView) {
  const hasProduction = Boolean(line.production?.currentEvent);
  const canaryRatio = line.canary ? clampTrafficRatio(line.canary.trafficRatio) : 0;
  const productionRatio = hasProduction
    ? !line.canary || line.canary.trafficMode === 'dual_run'
      ? 1
      : Math.max(0, 1 - canaryRatio)
    : 0;

  return {
    productionRatio,
    canaryRatio,
    productionHasTraffic: productionRatio > 0,
    canaryHasTraffic: Boolean(line.canary) && canaryRatio > 0,
  };
}

function buildTopology(line: ReleaseLineView, labels: ReturnType<typeof useTopologyLabels>) {
  const traffic = getTrafficState(line);
  const canaryTraffic = line.canary ? formatPercent(traffic.canaryRatio, 0) : labels.noTraffic;
  const canAddCanary = !line.canary && line.production?.currentEvent?.status === 'running';
  const nodes: ReleaseTopologyNode[] = [
    {
      id: 'upstream',
      type: 'releaseTopology',
      position: { x: 0, y: 136 },
      data: {
        icon: 'upstream',
        label: labels.upstream,
        title: line.inputConnectorName ?? labels.unconfigured,
        tone: line.inputConnectorName ? 'neutral' : 'muted',
      },
    },
    {
      id: 'input-route',
      type: 'releaseTopology',
      position: { x: 310, y: 136 },
      data: {
        icon: 'router',
        label: labels.inputRoute,
        title: `${labels.productionTrafficLabel} ${labels.productionTraffic}`,
        meta: `${labels.canaryTrafficLabel} ${canaryTraffic}`,
        tone: 'neutral',
      },
    },
  ];
  const edges: ReleaseTopologyEdge[] = [
    createEdge({
      id: 'upstream-router',
      source: 'upstream',
      target: 'input-route',
      label: labels.ingress,
    }),
  ];

  if (line.production?.currentEvent) {
    nodes.push({
      id: 'production',
      type: 'releaseTopology',
      position: { x: 620, y: 62 },
      data: {
        icon: 'production',
        label: labels.productionNode,
        title: line.promptName,
        meta: line.productionVersionLabel ?? labels.unconfigured,
        detail: line.productionModelName ?? labels.noModel,
        tone: 'production',
        mutedBorder: !traffic.productionHasTraffic,
        badges: [labels.productionBadge],
      },
    });
    edges.push(
      createEdge({
        id: 'router-production',
        source: 'input-route',
        target: 'production',
        label: line.canary ? labels.productionTraffic : '100%',
        tone: 'production',
        animated: traffic.productionHasTraffic,
      }),
    );
  } else {
    nodes.push({
      id: 'production',
      type: 'releaseTopology',
      position: { x: 620, y: 62 },
      data: {
        icon: 'production',
        label: labels.productionNode,
        title: labels.noProduction,
        tone: 'muted',
        badges: [labels.productionBadge],
      },
    });
    edges.push(
      createEdge({
        id: 'router-production-empty',
        source: 'input-route',
        target: 'production',
        label: labels.noTraffic,
        tone: 'muted',
        dashed: true,
      }),
    );
  }

  if (line.canary) {
    nodes.push({
      id: 'canary',
      type: 'releaseTopology',
      position: { x: 620, y: 210 },
      data: {
        icon: 'canary',
        label: labels.canaryNode,
        title: line.promptName,
        meta: line.canaryVersionLabel ?? labels.unconfigured,
        detail: line.canaryModelName ?? labels.noModel,
        tone: 'canary',
        mutedBorder: !traffic.canaryHasTraffic,
        badges: [labels.canaryBadge],
      },
    });
    edges.push(
      createEdge({
        id: 'router-canary',
        source: 'input-route',
        target: 'canary',
        label: formatPercent(traffic.canaryRatio, 0),
        tone: 'canary',
        animated: traffic.canaryHasTraffic,
      }),
    );
  } else {
    nodes.push({
      id: 'canary',
      type: 'releaseTopology',
      position: { x: 620, y: 210 },
      data: {
        icon: canAddCanary ? 'addCanary' : 'canary',
        label: labels.canaryNode,
        title: canAddCanary ? labels.addCanary : labels.noCanary,
        meta: canAddCanary ? labels.noCanary : undefined,
        detail: canAddCanary ? labels.readyForCandidate : undefined,
        tone: 'muted',
        badges: [labels.canaryBadge],
        action: canAddCanary ? 'addCanary' : undefined,
      },
    });
    edges.push(
      createEdge({
        id: 'router-canary-empty',
        source: 'input-route',
        target: 'canary',
        label: labels.noTraffic,
        tone: 'muted',
        dashed: true,
      }),
    );
  }

  const productionOutputIds = new Set((line.production?.outputConnectors ?? []).map((connector) => connector.id));
  const canaryOutputIds = new Set((line.canary?.outputConnectors ?? []).map((connector) => connector.id));
  nodes.push({
    id: 'output-route',
    type: 'releaseTopology',
    position: { x: 930, y: 136 },
    data: {
      icon: 'router',
      label: labels.outputRoute,
      title: labels.outputRouteTitle,
      meta: labels.outputMapping,
      detail: line.canary?.outputMapping.length ? `${line.canary.outputMapping.length}` : labels.outputMappingEmpty,
      tone: 'neutral',
      badges: [labels.outputDirection],
    },
  });
  edges.push(
    createEdge({
      id: 'production-output-route',
      source: 'production',
      target: 'output-route',
      label: 'production',
      tone: line.production?.currentEvent ? 'production' : 'muted',
      animated: traffic.productionHasTraffic,
      dashed: !line.production?.currentEvent,
    }),
    createEdge({
      id: 'canary-output-route',
      source: 'canary',
      target: 'output-route',
      label: 'gray',
      tone: line.canary ? 'canary' : 'muted',
      animated: traffic.canaryHasTraffic,
      dashed: !line.canary,
    }),
  );
  const outputs =
    line.outputConnectors.length > 0
      ? line.outputConnectors
      : [{ id: 'empty-output', name: labels.noDownstream, type: 'output' }];

  outputs.forEach((connector, index) => {
    const id = `output-${connector.id}`;
    const isEmpty = connector.id === 'empty-output';
    const inProduction = productionOutputIds.has(connector.id);
    const inCanary = canaryOutputIds.has(connector.id);
    nodes.push({
      id,
      type: 'releaseTopology',
      position: outputNodePosition(index, outputs.length),
      data: {
        icon: 'downstream',
        label: labels.downstream,
        title: connector.name,
        meta: connector.type,
        detail: isEmpty
          ? labels.noDownstreamDetail
          : [inProduction ? 'production' : null, inCanary ? 'gray' : null].filter(Boolean).join(' + '),
        tone: isEmpty ? 'muted' : 'neutral',
        badges: [connector.type],
      },
    });

    if (isEmpty) {
      edges.push(
        createEdge({
          id: 'output-route-empty-output',
          source: 'output-route',
          target: id,
          tone: 'muted',
          dashed: true,
        }),
      );
      return;
    }

    edges.push(
      createEdge({
        id: `output-route-${id}`,
        source: 'output-route',
        target: id,
        label: [inProduction ? 'production' : null, inCanary ? 'gray' : null].filter(Boolean).join(' + ') || undefined,
        tone: inCanary ? 'canary' : inProduction ? 'production' : 'neutral',
        animated: (inProduction && traffic.productionHasTraffic) || (inCanary && traffic.canaryHasTraffic),
      }),
    );
  });

  return { nodes, edges };
}

function useTopologyLabels(line: ReleaseLineView) {
  const { t } = useI18n();
  const traffic = getTrafficState(line);
  const productionTraffic = formatPercent(traffic.productionRatio, 0);

  return {
    upstream: t('releases.detail.field.upstream'),
    downstream: t('releases.detail.field.downstream'),
    model: t('releases.detail.field.model'),
    externalId: t('releases.detail.field.externalId'),
    startedAt: t('releases.detail.field.startedAt'),
    status: t('releases.detail.field.status'),
    trafficRatio: t('releases.detail.field.trafficRatio'),
    updatedAt: t('releases.detail.field.updatedAt'),
    production: t('releases.detail.topology.node.production'),
    canary: t('releases.detail.topology.node.canary'),
    productionNode: t('releases.detail.topology.node.production'),
    canaryNode: t('releases.detail.topology.node.canary'),
    productionBadge: t('releases.detail.topology.badge.production'),
    canaryBadge: t('releases.detail.topology.badge.canary'),
    productionTrafficLabel: t('releases.detail.topology.traffic.production'),
    canaryTrafficLabel: t('releases.detail.topology.traffic.canary'),
    router: t('releases.detail.topology.router'),
    inputRoute: t('releases.detail.topology.inputRoute'),
    inputRouteMeta: t('releases.detail.topology.inputRouteMeta'),
    outputRoute: t('releases.detail.topology.outputRoute'),
    outputRouteTitle: t('releases.detail.topology.outputRouteTitle'),
    ingress: t('releases.detail.topology.ingress'),
    routeMeta: t('releases.detail.topology.routeMeta'),
    latestEvent: t('releases.detail.topology.latestEvent'),
    singleUpstream: t('releases.detail.topology.singleUpstream'),
    productionTraffic,
    noTraffic: t('releases.detail.topology.noTraffic'),
    noProduction: t('releases.detail.topology.noProduction'),
    noCanary: t('releases.detail.topology.noCanary'),
    addCanary: t('releases.detail.action.addCanary'),
    noDownstream: t('releases.detail.topology.noDownstream'),
    noDownstreamDetail: t('releases.detail.topology.noDownstreamDetail'),
    unconfigured: t('releases.detail.topology.unconfigured'),
    noModel: t('releases.detail.topology.noModel'),
    passThrough: t('releases.traffic.passThrough'),
    offline: t('releases.traffic.offline'),
    readyForCandidate: t('releases.detail.topology.readyForCandidate'),
    inspector: t('releases.detail.topology.inspector'),
    clickHint: t('releases.detail.topology.clickHint'),
    connectorId: t('releases.detail.topology.field.connectorId'),
    connectorName: t('releases.detail.topology.field.connectorName'),
    connectorType: t('releases.detail.topology.field.connectorType'),
    direction: t('releases.detail.topology.field.direction'),
    inputDirection: t('releases.detail.topology.direction.input'),
    outputDirection: t('releases.detail.topology.direction.output'),
    prompt: t('releases.detail.topology.field.prompt'),
    promptVersion: t('releases.detail.topology.field.promptVersion'),
    eventId: t('releases.detail.topology.field.eventId'),
    canaryId: t('releases.detail.topology.field.canaryId'),
    rpmLimit: t('releases.detail.topology.field.rpmLimit'),
    tpmLimit: t('releases.detail.topology.field.tpmLimit'),
    concurrency: t('releases.detail.topology.field.concurrency'),
    temperature: t('releases.detail.topology.field.temperature'),
    recordMode: t('releases.detail.topology.field.recordMode'),
    trafficMode: t('releases.detail.topology.field.trafficMode'),
    outputScope: t('releases.detail.topology.field.outputScope'),
    productionScope: t('releases.detail.topology.scope.production'),
    canaryScope: t('releases.detail.topology.scope.canary'),
    routeStatus: t('releases.detail.topology.field.routeStatus'),
    fieldMapping: t('releases.detail.topology.field.fieldMapping'),
    fieldMappingEmpty: t('releases.detail.config.mappingEmpty'),
    filterRules: t('releases.detail.topology.field.filterRules'),
    filterEmpty: t('releases.detail.topology.filterEmpty'),
    outputMapping: t('releases.detail.topology.field.outputMapping'),
    outputMappingEmpty: t('releases.detail.topology.outputMappingEmpty'),
    adjustTraffic: t('releases.detail.action.adjustTraffic'),
    trafficBox: t('releases.detail.topology.trafficBox'),
    noCanaryToAdjust: t('releases.detail.topology.noCanaryToAdjust'),
    trafficInvalid: t('releases.detail.trafficDialog.invalid'),
    trafficUpdateFailed: t('releases.detail.trafficDialog.updateFailed'),
    runConfigTitle: t('releases.detail.topology.runConfig.title'),
    runConfigInvalid: t('releases.detail.topology.runConfig.invalid'),
    runConfigUpdateFailed: t('releases.detail.topology.runConfig.updateFailed'),
    runConfigModelUnavailable: t('releases.detail.topology.runConfig.modelUnavailable'),
    modelLimit: (limit: string) => t('releases.detail.topology.runConfig.modelLimit').replace('{limit}', limit),
    unlimited: t('releases.detail.topology.runConfig.unlimited'),
    loading: t('common.loading'),
    trafficPercentInput: t('releases.detail.trafficDialog.percentInput'),
    trafficPercentAriaLabel: t('releases.detail.trafficDialog.percentAriaLabel'),
    save: t('common.save'),
    savePending: t('common.savePending'),
    canaryMode: (mode: string) =>
      mode === 'dual_run' ? t('releases.detail.topology.mode.dualRun') : t('releases.detail.topology.mode.split'),
  };
}

function toDisplayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function stringifyConfig(value: unknown, emptyLabel: string) {
  if (value === null || value === undefined) return emptyLabel;
  if (typeof value === 'string') return value.trim() || emptyLabel;
  if (Array.isArray(value) && value.length === 0) return emptyLabel;
  if (typeof value === 'object' && Object.keys(value).length === 0) return emptyLabel;
  return JSON.stringify(value, null, 2);
}

function getVariableMappingBody(line: ReleaseLineView, emptyLabel: string) {
  if (line.canary) {
    if (line.canary.variableMapping.length === 0) return emptyLabel;
    return line.canary.variableMapping
      .map((item) => {
        const required = item.required ? ' *' : '';
        const defaultValue = item.defaultValue === undefined ? '' : ` = ${stringifyConfig(item.defaultValue, '')}`;
        return `${item.source} -> ${item.target}${required}${defaultValue}`;
      })
      .join('\n');
  }

  const productionMapping = line.production?.currentEvent?.variableMapping ?? {};
  const entries = Object.entries(productionMapping);
  if (entries.length === 0) return emptyLabel;
  return entries.map(([target, source]) => `${source} -> ${target}${target === 'id' ? ' *' : ''}`).join('\n');
}

function getFilterRulesBody(line: ReleaseLineView, labels: ReturnType<typeof useTopologyLabels>) {
  const filterRules = line.canary?.filterRules ?? line.production?.currentEvent?.filterRules ?? null;
  return stringifyConfig(filterRules, labels.filterEmpty);
}

function getOutputMappingBody(line: ReleaseLineView, labels: ReturnType<typeof useTopologyLabels>) {
  const canaryMapping = line.canary?.outputMapping ?? [];
  if (canaryMapping.length > 0) {
    return canaryMapping.map((item) => `${item.source} -> ${item.target}`).join('\n');
  }
  return labels.outputMappingEmpty;
}

function trafficPercentFromText(value: string, max = 100): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

function trafficPercentFromRatio(value: number) {
  const percent = Math.round(value * 100);
  return String(Math.min(100, Math.max(0, percent)));
}

function getProductionTrafficPercent(canaryPercent: number) {
  return Math.max(0, 100 - canaryPercent);
}

function isAdjustableCanary(canary: CanaryReleaseListItemDto | null | undefined) {
  return canary?.status === 'pending' || canary?.status === 'running' || canary?.status === 'stopped';
}

function TrafficRatioControl({
  line,
  labels,
  onUpdateTrafficRatio,
  pending,
}: {
  line: ReleaseLineView;
  labels: ReturnType<typeof useTopologyLabels>;
  onUpdateTrafficRatio?: (canary: CanaryReleaseListItemDto, trafficRatio: number) => Promise<unknown>;
  pending: boolean;
}) {
  const canary = line.canary;
  const maxTrafficPercent = 100;
  const currentPercent = canary ? Math.round(canary.trafficRatio * 100) : 0;
  const [trafficPercent, setTrafficPercent] = useState(canary ? trafficPercentFromRatio(canary.trafficRatio) : '');
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [lockedAfterPromotion, setLockedAfterPromotion] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPercent, setSavedPercent] = useState(currentPercent);
  const parsedTrafficPercent = trafficPercentFromText(trafficPercent, maxTrafficPercent);
  const displayCanaryPercent = parsedTrafficPercent ?? currentPercent;
  const displayProductionPercent = getProductionTrafficPercent(displayCanaryPercent);
  const productionPercent = parsedTrafficPercent === null ? '' : String(displayProductionPercent);
  const canEditTraffic =
    Boolean(canary) && Boolean(onUpdateTrafficRatio) && isAdjustableCanary(canary) && !lockedAfterPromotion;
  const isSavingTraffic = pending || saving;
  const hasTrafficDraft = parsedTrafficPercent !== null && savedPercent !== parsedTrafficPercent;
  const canSaveTraffic = canEditTraffic && !isSavingTraffic && parsedTrafficPercent !== null && hasTrafficDraft;

  async function saveTrafficRatio() {
    if (isSavingTraffic) return;
    if (!canEditTraffic || !canary || !onUpdateTrafficRatio) return;
    if (parsedTrafficPercent === null) {
      setTrafficError(labels.trafficInvalid);
      return;
    }
    if (!hasTrafficDraft) return;
    setTrafficError(null);
    setSaving(true);
    try {
      await onUpdateTrafficRatio(canary, parsedTrafficPercent / 100);
      setSavedPercent(parsedTrafficPercent);
      if (canary.trafficMode === 'split' && parsedTrafficPercent >= 100) {
        setLockedAfterPromotion(true);
      }
    } catch (error) {
      setTrafficError(getApiErrorMessage(error) ?? labels.trafficUpdateFailed);
    } finally {
      setSaving(false);
    }
  }

  function setCanaryPercentText(value: string) {
    setTrafficPercent(value);
    setTrafficError(null);
  }

  function setProductionPercentText(value: string) {
    const parsed = trafficPercentFromText(value, 100);
    setTrafficPercent(parsed === null ? '' : String(100 - parsed));
    setTrafficError(null);
  }

  return (
    <section className="mt-4 rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-[12px] font-semibold">{labels.trafficBox}</div>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">{labels.productionTrafficLabel}</div>
            <label className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={productionPercent}
                onChange={(event) => setProductionPercentText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveTrafficRatio();
                }}
                disabled={!canEditTraffic || isSavingTraffic}
                aria-label={labels.productionTrafficLabel}
                className="h-8 font-mono text-xs"
              />
              <span className="font-mono text-xs text-muted-foreground">%</span>
            </label>
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">{labels.canaryTrafficLabel}</div>
            <label className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={trafficPercent}
                onChange={(event) => setCanaryPercentText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveTrafficRatio();
                }}
                disabled={!canEditTraffic || isSavingTraffic}
                aria-label={labels.canaryTrafficLabel}
                className="h-8 font-mono text-xs"
              />
              <span className="font-mono text-xs text-muted-foreground">%</span>
            </label>
          </div>
        </div>
        {canary ? (
          <>
            <input
              type="range"
              min={0}
              max={maxTrafficPercent}
              step={1}
              value={parsedTrafficPercent ?? currentPercent}
              aria-label={labels.trafficPercentAriaLabel}
              onChange={(event) => setCanaryPercentText(event.target.value)}
              disabled={!canEditTraffic || isSavingTraffic}
              className="w-full accent-primary disabled:opacity-50"
            />
            <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
              <span>{labels.productionTrafficLabel} 100%</span>
              <span>{labels.canaryTrafficLabel} 100%</span>
            </div>
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={saveTrafficRatio} disabled={!canSaveTraffic}>
                <Save className="size-3.5" />
                {isSavingTraffic ? labels.savePending : labels.save}
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            {labels.noCanaryToAdjust}
          </div>
        )}
        {trafficError ? <p className="text-[12px] text-destructive">{trafficError}</p> : null}
      </div>
    </section>
  );
}

type RunConfigDraft = {
  modelId: string;
  rpmLimit: string;
  tpmLimit: string;
  concurrency: string;
  temperature: string;
};

type RuntimeModelOption = {
  id: string;
  name: string;
  providerType: string | null;
  providerModelId: string | null;
  status: ProjectModelListItemDto['status'] | 'unknown';
  rpmLimit: number | null;
  tpmLimit: number | null;
};

function numberText(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function runConfigDraftFromRecord(config: object | null | undefined, modelId?: string | null): RunConfigDraft {
  const record = (config ?? {}) as Record<string, unknown>;
  return {
    modelId: modelId ?? '',
    rpmLimit: numberText(record.rpmLimit),
    tpmLimit: numberText(record.tpmLimit),
    concurrency: numberText(record.concurrency),
    temperature: numberText(record.temperature) || '0.3',
  };
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseTemperature(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : null;
}

function buildRunConfigUpdate(
  laneType: ReleaseLineLaneTypeDto,
  draft: RunConfigDraft,
): UpdateReleaseLineRunConfigInputDto | null {
  const rpmLimit = parsePositiveInteger(draft.rpmLimit);
  const tpmLimit = parsePositiveInteger(draft.tpmLimit);
  const concurrency = parsePositiveInteger(draft.concurrency);
  if (rpmLimit === null || tpmLimit === null || concurrency === null) return null;

  const temperature = parseTemperature(draft.temperature);
  if (temperature === null) return null;

  return {
    laneType,
    modelId: draft.modelId || undefined,
    runConfig: {
      rpmLimit,
      tpmLimit,
      concurrency,
      temperature,
    },
  };
}

function runConfigSignature(input: UpdateReleaseLineRunConfigInputDto | null) {
  return input ? JSON.stringify({ modelId: input.modelId ?? null, runConfig: input.runConfig }) : null;
}

function modelOptionFromProjectModel(model: ProjectModelListItemDto): RuntimeModelOption {
  return {
    id: model.id,
    name: model.name,
    providerType: model.providerType,
    providerModelId: model.providerModelId,
    status: model.status,
    rpmLimit: model.rpm.limit,
    tpmLimit: model.tpm.limit,
  };
}

function buildRuntimeModelOptions(
  models: ProjectModelListItemDto[],
  currentModelId: string | null | undefined,
  currentModelName: string | null | undefined,
) {
  const options = models
    .filter((model) => model.status !== 'disabled' || model.id === currentModelId)
    .map(modelOptionFromProjectModel);
  if (currentModelId && !options.some((model) => model.id === currentModelId)) {
    options.unshift({
      id: currentModelId,
      name: currentModelName ?? currentModelId,
      providerType: null,
      providerModelId: null,
      status: 'unknown',
      rpmLimit: null,
      tpmLimit: null,
    });
  }
  return options;
}

function formatModelLimitValue(value: number | null | undefined, labels: ReturnType<typeof useTopologyLabels>) {
  if (value === null || value === undefined) return '—';
  if (value === -1) return labels.unlimited;
  return String(value);
}

function modelOptionLabel(option: RuntimeModelOption) {
  return [option.name, option.providerModelId].filter(Boolean).join(' · ');
}

function RuntimeConfigEditor({
  laneType,
  config,
  currentModelId,
  currentModelName,
  models,
  modelsLoading,
  labels,
  canEdit,
  pending,
  onUpdateRunConfig,
}: {
  laneType: ReleaseLineLaneTypeDto;
  config: object | null | undefined;
  currentModelId?: string | null;
  currentModelName?: string | null;
  models: ProjectModelListItemDto[];
  modelsLoading: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
  canEdit: boolean;
  pending: boolean;
  onUpdateRunConfig?: (input: UpdateReleaseLineRunConfigInputDto) => Promise<unknown>;
}) {
  const modelOptions = useMemo(
    () => buildRuntimeModelOptions(models, currentModelId, currentModelName),
    [currentModelId, currentModelName, models],
  );
  const [draft, setDraft] = useState<RunConfigDraft>(() => runConfigDraftFromRecord(config, currentModelId));
  const [error, setError] = useState<string | null>(null);
  const initialSignature = runConfigSignature(
    buildRunConfigUpdate(laneType, runConfigDraftFromRecord(config, currentModelId)),
  );
  const [savedSignature, setSavedSignature] = useState(initialSignature);
  const nextUpdate = buildRunConfigUpdate(laneType, draft);
  const nextSignature = runConfigSignature(nextUpdate);
  const isChanged = nextSignature !== null && nextSignature !== savedSignature;
  const canSubmit = canEdit && Boolean(onUpdateRunConfig) && !pending && (isChanged || nextUpdate === null);
  const selectedModel = modelOptions.find((model) => model.id === draft.modelId) ?? null;
  const rpmModelLimit = selectedModel ? labels.modelLimit(formatModelLimitValue(selectedModel.rpmLimit, labels)) : '—';
  const tpmModelLimit = selectedModel ? labels.modelLimit(formatModelLimitValue(selectedModel.tpmLimit, labels)) : '—';

  function setField(field: keyof RunConfigDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function saveRunConfig() {
    if (!canEdit || !onUpdateRunConfig || pending) return;
    if (!nextUpdate) {
      setError(labels.runConfigInvalid);
      return;
    }
    if (nextSignature === savedSignature) return;
    setError(null);
    try {
      await onUpdateRunConfig(nextUpdate);
      setSavedSignature(nextSignature);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError) ?? labels.runConfigUpdateFailed);
    }
  }

  return (
    <section className="mt-4 rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-[12px] font-semibold">{labels.runConfigTitle}</div>
      <div className="space-y-3 p-3">
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-[11px] font-medium text-muted-foreground">{labels.model}</div>
          <Select
            value={draft.modelId}
            onValueChange={(value) => setField('modelId', value)}
            disabled={!canEdit || pending || modelOptions.length === 0}
          >
            <SelectTrigger className="mt-1 h-8 bg-background text-xs" aria-label={labels.model}>
              <SelectValue placeholder={modelsLoading ? labels.loading : labels.runConfigModelUnavailable} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {modelOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <RuntimeNumberField
            label={labels.rpmLimit}
            hint={rpmModelLimit}
            value={draft.rpmLimit}
            min={1}
            step={1}
            disabled={!canEdit || pending}
            onChange={(value) => setField('rpmLimit', value)}
            onCommit={saveRunConfig}
          />
          <RuntimeNumberField
            label={labels.tpmLimit}
            hint={tpmModelLimit}
            value={draft.tpmLimit}
            min={1}
            step={1}
            disabled={!canEdit || pending}
            onChange={(value) => setField('tpmLimit', value)}
            onCommit={saveRunConfig}
          />
          <RuntimeNumberField
            label={labels.concurrency}
            value={draft.concurrency}
            min={1}
            step={1}
            disabled={!canEdit || pending}
            onChange={(value) => setField('concurrency', value)}
            onCommit={saveRunConfig}
          />
          <RuntimeNumberField
            label={labels.temperature}
            value={draft.temperature}
            min={0}
            max={2}
            step={0.1}
            disabled={!canEdit || pending}
            onChange={(value) => setField('temperature', value)}
            onCommit={saveRunConfig}
          />
        </div>
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={saveRunConfig} disabled={!canSubmit}>
            <Save className="size-3.5" />
            {pending ? labels.savePending : labels.save}
          </Button>
        </div>
      </div>
    </section>
  );
}

function RuntimeNumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  min: number;
  max?: number;
  step: number;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <label className="rounded-md border bg-muted/40 px-3 py-2">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        {hint ? <span className="truncate text-right text-[10.5px] text-muted-foreground">{hint}</span> : null}
      </span>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit();
        }}
        disabled={disabled}
        aria-label={label}
        className="mt-1 h-8 font-mono text-xs"
      />
    </label>
  );
}

function getOutputConnector(line: ReleaseLineView, nodeId: ReleaseTopologyNodeId) {
  if (!nodeId.startsWith('output-')) return null;
  const connectorId = nodeId.slice('output-'.length);
  if (connectorId === 'empty-output') return { id: connectorId, name: null, type: 'output' };
  return line.outputConnectors.find((connector) => connector.id === connectorId) ?? null;
}

function getOutputScope(line: ReleaseLineView, connectorId: string, labels: ReturnType<typeof useTopologyLabels>) {
  const inProduction = (line.production?.outputConnectors ?? []).some((connector) => connector.id === connectorId);
  const inCanary = (line.canary?.outputConnectors ?? []).some((connector) => connector.id === connectorId);
  return (
    [inProduction ? labels.productionScope : null, inCanary ? labels.canaryScope : null].filter(Boolean).join(' + ') ||
    null
  );
}

function buildInspectorDetail({
  line,
  selectedNodeId,
  labels,
  formatDateTimeOrDash,
  onUpdateTrafficRatio,
  trafficRatioPending,
  onUpdateRunConfig,
  runConfigPending,
  models,
  modelsLoading,
  onAddCanary,
}: {
  line: ReleaseLineView;
  selectedNodeId: ReleaseTopologyNodeId;
  labels: ReturnType<typeof useTopologyLabels>;
  formatDateTimeOrDash: DateTimeOrDashFormatter;
  onUpdateTrafficRatio?: (canary: CanaryReleaseListItemDto, trafficRatio: number) => Promise<unknown>;
  trafficRatioPending: boolean;
  onUpdateRunConfig?: (input: UpdateReleaseLineRunConfigInputDto) => Promise<unknown>;
  runConfigPending: boolean;
  models: ProjectModelListItemDto[];
  modelsLoading: boolean;
  onAddCanary?: () => void;
}): InspectorDetail {
  if (selectedNodeId === 'upstream') {
    return {
      icon: 'upstream',
      label: labels.upstream,
      title: line.inputConnectorName ?? labels.unconfigured,
      tone: line.inputConnectorName ? 'neutral' : 'muted',
      rows: [
        { label: labels.connectorName, value: line.inputConnectorName },
        { label: labels.connectorId, value: line.inputConnectorId },
        { label: labels.connectorType, value: line.inputConnectorType ?? 'connector' },
        { label: labels.direction, value: labels.inputDirection, mono: false },
        { label: labels.prompt, value: line.promptName },
      ],
    };
  }

  if (selectedNodeId === 'input-route') {
    return {
      icon: 'router',
      label: labels.trafficBox,
      tone: 'neutral',
      rows: [],
      hideSummary: true,
      content: (
        <TrafficRatioControl
          key={`${line.canary?.id ?? 'no-canary'}:${line.canary?.trafficRatio ?? 0}`}
          line={line}
          labels={labels}
          onUpdateTrafficRatio={onUpdateTrafficRatio}
          pending={trafficRatioPending}
        />
      ),
      blocks: [
        {
          title: labels.fieldMapping,
          body: getVariableMappingBody(line, labels.fieldMappingEmpty),
        },
        {
          title: labels.filterRules,
          body: getFilterRulesBody(line, labels),
        },
      ],
    };
  }

  if (selectedNodeId === 'output-route') {
    return {
      icon: 'router',
      label: labels.outputRoute,
      title: labels.outputRouteTitle,
      subtitle: labels.outputMapping,
      tone: 'neutral',
      rows: [
        {
          label: labels.outputScope,
          value: line.outputConnectors.map((connector) => connector.name).join(', ') || null,
        },
        {
          label: labels.productionScope,
          value: line.production?.outputConnectors?.length ? String(line.production.outputConnectors.length) : '0',
        },
        {
          label: labels.canaryScope,
          value: line.canary?.outputConnectors.length ? String(line.canary.outputConnectors.length) : '0',
        },
      ],
      blocks: [
        {
          title: labels.outputMapping,
          body: getOutputMappingBody(line, labels),
        },
      ],
    };
  }

  if (selectedNodeId === 'production') {
    const event = line.production?.currentEvent ?? null;
    return {
      icon: 'production',
      label: labels.production,
      title: line.productionVersionLabel ?? labels.noProduction,
      subtitle: line.productionModelName ?? labels.noModel,
      tone: event ? 'production' : 'muted',
      rows: [
        { label: labels.prompt, value: line.promptName },
        { label: labels.promptVersion, value: line.productionVersionLabel },
        { label: labels.model, value: line.productionModelName },
        { label: labels.eventId, value: event?.id },
        { label: labels.status, value: event?.status ?? line.production?.aggregateStatus },
        { label: labels.externalId, value: event?.externalIdField },
        { label: labels.recordMode, value: event?.recordMode },
        { label: labels.startedAt, value: formatDateTimeOrDash(event?.startedAt) },
        { label: labels.updatedAt, value: formatDateTimeOrDash(event?.updatedAt) },
      ],
      runtimeEditor: event ? (
        <RuntimeConfigEditor
          key={`production:${event.id}:${event.updatedAt}`}
          laneType="production"
          config={event.runConfig}
          currentModelId={event.modelId}
          currentModelName={line.productionModelName}
          models={models}
          modelsLoading={modelsLoading}
          labels={labels}
          canEdit={event.status === 'running'}
          pending={runConfigPending}
          onUpdateRunConfig={onUpdateRunConfig}
        />
      ) : undefined,
    };
  }

  if (selectedNodeId === 'canary') {
    const canary = line.canary;
    const canAddCanary = !canary && line.production?.currentEvent?.status === 'running' && Boolean(onAddCanary);
    return {
      icon: canAddCanary ? 'addCanary' : 'canary',
      label: labels.canary,
      title: canAddCanary ? labels.addCanary : (line.canaryVersionLabel ?? labels.noCanary),
      subtitle: line.canaryModelName ?? labels.readyForCandidate,
      tone: canary ? 'canary' : 'muted',
      rows: [
        { label: labels.prompt, value: line.promptName },
        { label: labels.promptVersion, value: line.canaryVersionLabel },
        { label: labels.model, value: line.canaryModelName },
        { label: labels.canaryId, value: canary?.id },
        { label: labels.status, value: canary?.status },
        { label: labels.trafficRatio, value: canary ? formatPercent(canary.trafficRatio, 0) : labels.noTraffic },
        { label: labels.trafficMode, value: canary ? labels.canaryMode(canary.trafficMode) : null },
        { label: labels.externalId, value: canary?.externalIdField },
        { label: labels.recordMode, value: canary?.recordMode },
        { label: labels.startedAt, value: formatDateTimeOrDash(canary?.startedAt) },
        { label: labels.updatedAt, value: formatDateTimeOrDash(canary?.updatedAt) },
      ],
      runtimeEditor: canary ? (
        <RuntimeConfigEditor
          key={`canary:${canary.id}:${canary.updatedAt}`}
          laneType="canary"
          config={canary.runConfig}
          currentModelId={canary.modelId}
          currentModelName={canary.modelName}
          models={models}
          modelsLoading={modelsLoading}
          labels={labels}
          canEdit={isAdjustableCanary(canary)}
          pending={runConfigPending}
          onUpdateRunConfig={onUpdateRunConfig}
        />
      ) : undefined,
      action: canAddCanary ? (
        <Button type="button" onClick={onAddCanary}>
          <Plus className="size-4" />
          {labels.addCanary}
        </Button>
      ) : undefined,
    };
  }

  const connector = getOutputConnector(line, selectedNodeId);
  return {
    icon: 'downstream',
    label: labels.downstream,
    title: connector?.name ?? labels.noDownstream,
    subtitle: connector?.type ?? labels.noDownstreamDetail,
    tone: connector?.name ? 'neutral' : 'muted',
    rows: [
      { label: labels.connectorName, value: connector?.name ?? labels.noDownstream },
      { label: labels.connectorId, value: connector?.id === 'empty-output' ? null : connector?.id },
      { label: labels.connectorType, value: connector?.type },
      { label: labels.direction, value: labels.outputDirection, mono: false },
      { label: labels.outputScope, value: connector?.id ? getOutputScope(line, connector.id, labels) : null },
    ],
  };
}

function InspectorRowView({ row }: { row: InspectorRow }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2 text-[12px]">
      <span className="text-muted-foreground">{row.label}</span>
      <span className={cn('min-w-0 truncate', row.mono !== false && 'font-mono')} title={toDisplayValue(row.value)}>
        {toDisplayValue(row.value)}
      </span>
    </div>
  );
}

function TopologyInspector({
  detail,
  labels,
}: {
  detail: InspectorDetail;
  labels: ReturnType<typeof useTopologyLabels>;
}) {
  const token = TONE_STYLES[detail.tone];
  const Icon = NODE_ICONS[detail.icon];
  return (
    <aside className="flex min-h-[360px] flex-col bg-background/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{labels.inspector}</h3>
        <span className="text-[11.5px] text-muted-foreground">{labels.clickHint}</span>
      </div>
      {!detail.hideSummary ? (
        <div className="rounded-lg border bg-card p-3" style={{ borderColor: token.bd }}>
          <div className="flex items-start gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-md border"
              style={{ background: token.bg, borderColor: token.bd, color: token.dot }}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium text-muted-foreground">{detail.label}</div>
              {detail.title ? (
                <div className="mt-1 truncate font-mono text-[13px] font-semibold" title={detail.title}>
                  {detail.title}
                </div>
              ) : null}
              {detail.subtitle ? (
                <div className="mt-1 truncate text-[12px] text-muted-foreground" title={detail.subtitle}>
                  {detail.subtitle}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {detail.content}
      {detail.rows.length ? (
        <div className="mt-4 space-y-2 rounded-lg border bg-card p-3">
          {detail.rows.map((row) => (
            <InspectorRowView key={`${detail.label}:${row.label}`} row={row} />
          ))}
        </div>
      ) : null}
      {detail.runtimeEditor}
      {detail.blocks?.length ? (
        <div className="mt-4 space-y-3">
          {detail.blocks.map((block) => (
            <section key={`${detail.label}:${block.title}`} className="rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-[12px] font-semibold">{block.title}</div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-5 text-muted-foreground">
                {block.body}
              </pre>
            </section>
          ))}
        </div>
      ) : null}
      {detail.action ? <div className="mt-4 flex justify-end">{detail.action}</div> : null}
    </aside>
  );
}

export function ReleaseTopologyCanvas({
  line,
  models = [],
  modelsLoading = false,
  onUpdateTrafficRatio,
  onUpdateRunConfig,
  onAddCanary,
  trafficRatioPending = false,
  runConfigPending = false,
}: {
  line: ReleaseLineView;
  models?: ProjectModelListItemDto[];
  modelsLoading?: boolean;
  onUpdateTrafficRatio?: (canary: CanaryReleaseListItemDto, trafficRatio: number) => Promise<unknown>;
  onUpdateRunConfig?: (input: UpdateReleaseLineRunConfigInputDto) => Promise<unknown>;
  onAddCanary?: () => void;
  trafficRatioPending?: boolean;
  runConfigPending?: boolean;
}) {
  const labels = useTopologyLabels(line);
  const { formatDateTime } = useDateTimeFormatter();
  const formatDateTimeOrDash = useMemo<DateTimeOrDashFormatter>(
    () => (value) => (value ? formatDateTime(value, { fallback: '—' }) : '—'),
    [formatDateTime],
  );
  const topology = useMemo(() => buildTopology(line, labels), [labels, line]);
  const [rawSelectedNodeId, setSelectedNodeId] = useState<ReleaseTopologyNodeId>('input-route');
  const selectedNodeId = topology.nodes.some((node) => node.id === rawSelectedNodeId)
    ? rawSelectedNodeId
    : 'input-route';
  const nodes = useMemo(
    () =>
      topology.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [selectedNodeId, topology.nodes],
  );
  const detail = useMemo(
    () =>
      buildInspectorDetail({
        line,
        selectedNodeId,
        labels,
        formatDateTimeOrDash,
        onUpdateTrafficRatio,
        trafficRatioPending,
        onUpdateRunConfig,
        runConfigPending,
        models,
        modelsLoading,
        onAddCanary,
      }),
    [
      labels,
      formatDateTimeOrDash,
      line,
      onAddCanary,
      onUpdateRunConfig,
      onUpdateTrafficRatio,
      models,
      modelsLoading,
      runConfigPending,
      selectedNodeId,
      trafficRatioPending,
    ],
  );

  return (
    <div className="release-topology-canvas rounded-lg border bg-card" data-testid="release-topology-canvas">
      <div className="border-b px-4 py-3">
        <h2 className="text-[14px] font-semibold">{labels.routeMeta}</h2>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[500px] min-h-[380px] w-full border-b xl:border-b-0 xl:border-r">
          <ReactFlow
            nodes={nodes}
            edges={topology.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            onNodeClick={(_, node) => {
              if (node.data.action === 'addCanary' && onAddCanary) {
                onAddCanary();
                return;
              }
              setSelectedNodeId(node.id as ReleaseTopologyNodeId);
            }}
            fitView
            minZoom={0.55}
            maxZoom={1.15}
            defaultViewport={{ x: 0, y: 0, zoom: 0.82 }}
            fitViewOptions={{ padding: 0.16, minZoom: 0.55, maxZoom: 1.05 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border)" gap={24} size={1} />
            <Controls showInteractive={false} className="!rounded-md !border !border-border !bg-muted !shadow-sm" />
          </ReactFlow>
        </div>
        <TopologyInspector detail={detail} labels={labels} />
      </div>
    </div>
  );
}
