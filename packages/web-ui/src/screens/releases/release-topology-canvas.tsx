'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import {
  Cable,
  Check,
  ChevronDown,
  GitCompareArrows,
  Plus,
  RadioTower,
  Rocket,
  Save,
  Search,
  Split,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  CanaryReleaseFilterNodeDto,
  CanaryReleaseListItemDto,
  ConnectorListItemDto,
  PromptOutputSchemaDto,
  ProjectModelListItemDto,
  ReleaseLineRecordModeDto,
  ReleaseLineLaneTypeDto,
  CanaryReleaseStopConditionsDto,
  UpdateReleaseLineInputRouteInputDto,
  UpdateReleaseLineOutputRouteInputDto,
  UpdateReleaseLineRunConfigInputDto,
} from '@proofhound/shared';
import { canaryReleaseFilterRulesSchema, deriveClassificationOptionsFromPromptOutputSchema } from '@proofhound/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@proofhound/ui';
import { useDateTimeFormatter } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import type { ReleaseLineView } from '../../lib';
import {
  FieldMappingTable,
  FilterRulesBuilder,
  canaryInputRouteMappingFromRecord,
  collectFilterRuleFields,
  extractInputFieldOptionsFromSnapshot,
  extractPromptVariablesFromSnapshot,
  inputRouteMappingRecord,
  mergeInputFieldOptions,
  type InputRouteFieldOption,
} from './release-input-route-editor';
import { ReleasePill, formatPercent } from './release-line-ui';

type ReleaseTopologyTone = 'neutral' | 'production' | 'canary' | 'muted';

type ReleaseTopologyNodeData = {
  icon: 'upstream' | 'router' | 'production' | 'canary' | 'canarySplit' | 'canaryDualRun' | 'downstream' | 'addCanary';
  label: string;
  title: string;
  meta?: string;
  detail?: string;
  tone: ReleaseTopologyTone;
  mutedBorder?: boolean;
  badges?: string[];
  action?: 'addCanary';
  compact?: boolean;
} & Record<string, unknown>;

type ReleaseTopologyNode = Node<ReleaseTopologyNodeData, 'releaseTopology'>;
type ReleaseTopologyEdge = Edge<Record<string, unknown>, 'releaseTopology'>;
type ReleaseTopologyNodeId = 'upstream' | 'input-route' | 'production' | 'canary' | 'output-route' | `output-${string}`;
type DateTimeOrDashFormatter = (value: string | null | undefined) => string;
type CanaryLaneAction = 'promote' | 'stop';
type OutputMappingItem = { source: string; target: string };
type OutputSourceOption = { value: string; label: string; description: string };
type OutputSourceGroupKey = 'upstream' | 'model' | 'meta' | 'legacy';
type OutputSourceGroup = {
  key: OutputSourceGroupKey;
  label: string;
  badge?: string;
  options: OutputSourceOption[];
};
type OutputConnectorRouteDraft = { connectorId: string; outputMapping: OutputMappingItem[] };
type OutputRouteLaneDraft = {
  key: ReleaseLineLaneTypeDto;
  title: string;
  tone: ReleaseTopologyTone;
  canEdit: boolean;
  connectorIds: string[];
  outputMapping: unknown;
  outputSourceGroups: OutputSourceGroup[];
};

const EMPTY_RECORD: Record<string, unknown> = {};

interface InspectorRow {
  label: string;
  value?: string | null | undefined;
  valueNode?: ReactNode;
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
  headerAction?: ReactNode;
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
  canary: Split,
  canarySplit: Split,
  canaryDualRun: GitCompareArrows,
  downstream: Cable,
  addCanary: Plus,
};

function canaryTopologyIcon(canary: Pick<CanaryReleaseListItemDto, 'trafficMode'> | null | undefined) {
  return canary?.trafficMode === 'dual_run' ? 'canaryDualRun' : 'canarySplit';
}

type EdgeBadgeItem = {
  icon: LucideIcon;
  tone: ReleaseTopologyTone;
};

function EdgeLaneBadge({ label, items, text }: { label: string; items: EdgeBadgeItem[]; text?: string }) {
  return (
    <TooltipProvider delayDuration={140}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="flex h-6 items-center gap-1 rounded-md border bg-card px-1.5 font-mono text-[10.5px] font-semibold text-muted-foreground shadow-sm"
            aria-label={label}
            title={label}
          >
            {items.map(({ icon: Icon, tone }, index) => (
              <Icon
                key={`${tone}-${index}`}
                className="size-3.5"
                style={{ color: TONE_STYLES[tone].dot }}
                aria-hidden="true"
              />
            ))}
            {text ? <span className="leading-none">{text}</span> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EdgeTextBadge({ label, title = label }: { label: string; title?: string }) {
  return (
    <span
      className="flex h-5 items-center rounded-md border bg-card px-1.5 font-mono text-[10.5px] font-semibold leading-none text-muted-foreground shadow-sm"
      aria-label={title}
      title={title}
    >
      {label}
    </span>
  );
}

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
      {data.compact ? (
        <div className="flex h-full items-center justify-center gap-2.5">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-md border"
            style={{ background: 'var(--background)', borderColor: token.bd, color: token.dot }}
          >
            <Icon className="size-4" />
          </span>
          <span className="truncate text-[13px] font-semibold">{data.label}</span>
        </div>
      ) : (
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
              <div
                className="mt-1.5 truncate text-[11.5px] font-medium"
                style={{ color: token.fg }}
                title={data.detail}
              >
                {data.detail}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  releaseTopology: ReleaseTopologyNodeCard,
} satisfies NodeTypes;

function ReleaseTopologyEdgePath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  label,
  interactionWidth,
}: EdgeProps<ReleaseTopologyEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              pointerEvents: 'all',
              zIndex: 20,
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = {
  releaseTopology: ReleaseTopologyEdgePath,
} satisfies EdgeTypes;

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
  label?: ReactNode;
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
    type: 'releaseTopology',
    animated: animated ?? (tone === 'production' || tone === 'canary'),
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: {
      stroke: color,
      strokeWidth: tone === 'muted' ? 1.3 : 2,
      strokeDasharray: dashed ? '6 5' : undefined,
    },
  };
}

function outputNodePosition(index: number, total: number) {
  const compact = total <= 2;
  const step = compact ? 126 : 108;
  const startY = 136 - ((total - 1) * step) / 2;
  return { x: 1420, y: startY + index * step };
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

function getOutputScopeLabel({
  inProduction,
  inCanary,
  labels,
}: {
  inProduction: boolean;
  inCanary: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
}) {
  return [inProduction ? labels.productionLane : null, inCanary ? labels.canaryLane : null].filter(Boolean).join(' + ');
}

function buildTopology(line: ReleaseLineView, labels: ReturnType<typeof useTopologyLabels>) {
  const traffic = getTrafficState(line);
  const canAnimateTraffic = line.status === 'running';
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
        title: labels.inputRoute,
        tone: 'neutral',
        compact: true,
      },
    },
  ];
  const edges: ReleaseTopologyEdge[] = [
    createEdge({
      id: 'upstream-router',
      source: 'upstream',
      target: 'input-route',
    }),
  ];

  if (line.production?.currentEvent) {
    nodes.push({
      id: 'production',
      type: 'releaseTopology',
      position: { x: 680, y: 62 },
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
        label: (
          <EdgeTextBadge
            label={line.canary ? labels.productionTraffic : '100%'}
            title={`${labels.productionTrafficLabel} ${line.canary ? labels.productionTraffic : '100%'}`}
          />
        ),
        tone: 'production',
        animated: canAnimateTraffic && traffic.productionHasTraffic,
      }),
    );
  } else {
    nodes.push({
      id: 'production',
      type: 'releaseTopology',
      position: { x: 680, y: 62 },
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
        label: (
          <EdgeTextBadge label={labels.noTraffic} title={`${labels.productionTrafficLabel} ${labels.noTraffic}`} />
        ),
        tone: 'muted',
        dashed: true,
      }),
    );
  }

  if (line.canary) {
    nodes.push({
      id: 'canary',
      type: 'releaseTopology',
      position: { x: 680, y: 210 },
      data: {
        icon: canaryTopologyIcon(line.canary),
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
        label: (
          <EdgeTextBadge
            label={formatPercent(traffic.canaryRatio, 0)}
            title={`${labels.canaryTrafficLabel} ${formatPercent(traffic.canaryRatio, 0)}`}
          />
        ),
        tone: 'canary',
        animated: canAnimateTraffic && traffic.canaryHasTraffic,
      }),
    );
  } else {
    nodes.push({
      id: 'canary',
      type: 'releaseTopology',
      position: { x: 680, y: 210 },
      data: {
        icon: canAddCanary ? 'addCanary' : 'canarySplit',
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
        label: <EdgeTextBadge label={labels.noTraffic} title={`${labels.canaryTrafficLabel} ${labels.noTraffic}`} />,
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
    position: { x: 990, y: 136 },
    data: {
      icon: 'router',
      label: labels.outputRoute,
      title: labels.outputRoute,
      tone: 'neutral',
      compact: true,
    },
  });
  edges.push(
    createEdge({
      id: 'production-output-route',
      source: 'production',
      target: 'output-route',
      tone: line.production?.currentEvent ? 'production' : 'muted',
      animated: canAnimateTraffic && traffic.productionHasTraffic,
      dashed: !line.production?.currentEvent,
    }),
    createEdge({
      id: 'canary-output-route',
      source: 'canary',
      target: 'output-route',
      tone: line.canary ? 'canary' : 'muted',
      animated: canAnimateTraffic && traffic.canaryHasTraffic,
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
    const outputScope = getOutputScopeLabel({ inProduction, inCanary, labels });
    const CanaryScopeIcon = line.canary?.trafficMode === 'dual_run' ? GitCompareArrows : Split;
    const outputScopeItems: EdgeBadgeItem[] = [
      ...(inProduction ? [{ icon: Rocket, tone: 'production' as const }] : []),
      ...(inCanary ? [{ icon: CanaryScopeIcon, tone: 'canary' as const }] : []),
    ];
    nodes.push({
      id,
      type: 'releaseTopology',
      position: outputNodePosition(index, outputs.length),
      data: {
        icon: 'downstream',
        label: labels.downstream,
        title: connector.name,
        meta: connector.type,
        detail: isEmpty ? labels.noDownstreamDetail : outputScope,
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
        label: outputScope ? <EdgeLaneBadge label={outputScope} items={outputScopeItems} /> : undefined,
        tone: 'neutral',
        animated:
          canAnimateTraffic &&
          ((inProduction && traffic.productionHasTraffic) || (inCanary && traffic.canaryHasTraffic)),
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
    createdAt: t('common.createdAt'),
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
    productionLane: t('releases.detail.topology.lane.production'),
    canaryLane: t('releases.detail.topology.lane.canary'),
    router: t('releases.detail.topology.router'),
    inputRoute: t('releases.detail.topology.inputRoute'),
    inputRouteMeta: t('releases.detail.topology.inputRouteMeta'),
    outputRoute: t('releases.detail.topology.outputRoute'),
    outputRouteTitle: t('releases.detail.topology.outputRouteTitle'),
    inputRouteSaveFailed: t('releases.detail.topology.inputRoute.saveFailed'),
    inputRouteInvalid: t('releases.detail.topology.inputRoute.invalid'),
    inputRouteNoLane: t('releases.detail.topology.inputRoute.noLane'),
    inputRouteEditFilter: t('releases.detail.topology.inputRoute.editFilter'),
    inputRouteHideFilter: t('releases.detail.topology.inputRoute.hideFilter'),
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
    termination: t('releases.detail.topology.field.termination'),
    trafficMode: t('releases.detail.topology.field.trafficMode'),
    outputScope: t('releases.detail.topology.field.outputScope'),
    productionScope: t('releases.detail.topology.scope.production'),
    canaryScope: t('releases.detail.topology.scope.canary'),
    fieldMapping: t('releases.detail.topology.field.fieldMapping'),
    filterRules: t('releases.detail.topology.field.filterRules'),
    filterEmpty: t('releases.detail.topology.filterEmpty'),
    inputFields: t('releases.detail.topology.field.inputFields'),
    inputFieldsEmpty: t('releases.detail.topology.inputFields.empty'),
    outputMapping: t('releases.detail.topology.field.outputMapping'),
    outputMappingEmpty: t('releases.detail.topology.outputMappingEmpty'),
    outputRouteSaveFailed: t('releases.detail.topology.outputRoute.saveFailed'),
    outputRouteNoLane: t('releases.detail.topology.outputRoute.noLane'),
    outputRouteNoConnector: t('releases.detail.topology.outputRoute.noConnector'),
    outputRouteEdit: t('releases.detail.topology.outputRoute.edit'),
    outputRouteDialogTitle: t('releases.detail.topology.outputRoute.dialogTitle'),
    outputRouteDialogDescription: t('releases.detail.topology.outputRoute.dialogDescription'),
    outputRouteNewConnector: t('releases.detail.topology.outputRoute.newConnector'),
    outputRouteConnectorFilter: t('releases.detail.topology.outputRoute.connectorFilter'),
    outputRouteConnectorSelect: t('releases.detail.topology.outputRoute.connectorSelect'),
    outputRouteNoAddableConnector: t('releases.detail.topology.outputRoute.noAddableConnector'),
    outputRouteAvailableConnectors: t('releases.detail.topology.outputRoute.availableConnectors'),
    outputRouteSelectedConnectors: t('releases.detail.topology.outputRoute.selectedConnectors'),
    outputRouteNoSelectedConnector: t('releases.detail.topology.outputRoute.noSelectedConnector'),
    outputRouteAddConnector: t('releases.detail.topology.outputRoute.addConnector'),
    outputRouteRemoveConnector: t('releases.detail.topology.outputRoute.removeConnector'),
    outputRoutePassThrough: t('releases.detail.topology.outputRoute.passThrough'),
    outputRouteConnectorHelp: t('releases.detail.topology.outputRoute.connectorHelp'),
    outputRouteMappingHelp: t('releases.detail.topology.outputRoute.mappingHelp'),
    outputRouteSource: t('releases.detail.topology.outputRoute.source'),
    outputRouteTarget: t('releases.detail.topology.outputRoute.target'),
    outputRouteSourceDecisionOutput: t('releases.detail.topology.outputRoute.sourceDecisionOutput'),
    outputRouteSourceParsedOutput: t('releases.detail.topology.outputRoute.sourceParsedOutput'),
    outputRouteSourceRawResponse: t('releases.detail.topology.outputRoute.sourceRawResponse'),
    outputRouteSourceRunResultId: t('releases.detail.topology.outputRoute.sourceRunResultId'),
    outputRouteSourceModelOutput: t('releases.detail.topology.outputRoute.sourceModelOutput'),
    outputRouteSourceLegacy: t('releases.detail.topology.outputRoute.sourceLegacy'),
    outputRouteProductionConnectors: t('releases.detail.topology.outputRoute.productionConnectors'),
    outputRouteCanaryConnectors: t('releases.detail.topology.outputRoute.canaryConnectors'),
    outputRouteProductionMapping: t('releases.detail.topology.outputRoute.productionMapping'),
    outputRouteCanaryMapping: t('releases.detail.topology.outputRoute.canaryMapping'),
    outputRouteSummaryConnectors: t('releases.detail.topology.outputRoute.summaryConnectors'),
    outputRouteSummaryMapping: t('releases.detail.topology.outputRoute.summaryMapping'),
    outputRouteSave: t('releases.detail.topology.outputRoute.saveRoute'),
    outputRouteSourceSearch: t('releases.detail.topology.outputRoute.sourceSearch'),
    outputRouteSourceEmpty: t('releases.detail.topology.outputRoute.sourceEmpty'),
    outputRouteSourcePlaceholder: t('releases.detail.topology.outputRoute.sourcePlaceholder'),
    outputRouteSourceGroupUpstream: t('releases.detail.topology.outputRoute.sourceGroup.upstream'),
    outputRouteSourceGroupModel: t('releases.detail.topology.outputRoute.sourceGroup.model'),
    outputRouteSourceGroupMeta: t('releases.detail.topology.outputRoute.sourceGroup.meta'),
    outputRouteNewBadge: t('releases.detail.topology.outputRoute.newBadge'),
    outputRouteConnectorPickerTitle: t('releases.detail.topology.outputRoute.connectorPickerTitle'),
    outputRouteNoMoreConnectors: t('releases.detail.topology.outputRoute.noMoreConnectors'),
    outputRouteLaneReadonly: t('releases.detail.topology.outputRoute.laneReadonly'),
    outputRouteConnectorCount: (count: number) =>
      formatTemplate(t('releases.detail.topology.outputRoute.connectorCount'), { count }),
    outputRouteFooterSummary: (production: number, canary: number, mappings: number) =>
      formatTemplate(t('releases.detail.topology.outputRoute.footerSummary'), { production, canary, mappings }),
    addMapping: t('releases.detail.topology.outputRoute.addMapping'),
    removeMapping: t('releases.detail.topology.outputRoute.removeMapping'),
    adjustTraffic: t('releases.detail.action.adjustTraffic'),
    trafficBox: t('releases.detail.topology.trafficBox'),
    noCanaryToAdjust: t('releases.detail.topology.noCanaryToAdjust'),
    trafficInvalid: t('releases.detail.trafficDialog.invalid'),
    trafficUpdateFailed: t('releases.detail.trafficDialog.updateFailed'),
    laneIdentityTitle: t('releases.detail.topology.identity.title'),
    runConfigTitle: t('releases.detail.topology.runConfig.title'),
    runConfigInvalid: t('releases.detail.topology.runConfig.invalid'),
    runConfigUpdateFailed: t('releases.detail.topology.runConfig.updateFailed'),
    runConfigModelUnavailable: t('releases.detail.topology.runConfig.modelUnavailable'),
    modelLimit: (limit: string) => t('releases.detail.topology.runConfig.modelLimit').replace('{limit}', limit),
    unlimited: t('releases.detail.topology.runConfig.unlimited'),
    terminationManual: t('canaryReleases.new.field.termination.manual'),
    terminationByCount: t('canaryReleases.new.field.termination.byCount'),
    terminationByTime: t('canaryReleases.new.field.termination.byTime'),
    recordModeTitle: t('releases.detail.topology.recordMode.title'),
    recordCategories: t('releases.detail.topology.recordCategories'),
    recordCategoriesEmpty: t('releases.detail.topology.recordCategories.empty'),
    recordCategoriesSelected: (count: number) =>
      formatTemplate(t('releases.detail.topology.recordCategories.selected'), { count }),
    recordCategoriesSelectAll: t('releases.detail.topology.recordCategories.selectAll'),
    recordCategoriesClear: t('releases.detail.topology.recordCategories.clear'),
    canaryActionFailed: t('releases.detail.topology.canaryActionFailed'),
    promoteCanary: t('releases.detail.action.promoteCanary'),
    stopCanary: t('releases.detail.action.stopCanary'),
    replaceCanary: t('releases.detail.action.replaceCanary'),
    loading: t('common.loading'),
    trafficPercentInput: t('releases.detail.trafficDialog.percentInput'),
    trafficPercentAriaLabel: t('releases.detail.trafficDialog.percentAriaLabel'),
    cancel: t('common.cancel'),
    save: t('common.save'),
    savePending: t('common.savePending'),
    canaryMode: (mode: string) =>
      mode === 'dual_run' ? t('releases.detail.topology.mode.dualRun') : t('releases.detail.topology.mode.split'),
    filterOp: (op: string) => t(`canaryReleases.new.filter.op.${op}` as TranslationKey),
  };
}

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function toDisplayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function positiveIntegerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function formatCanaryStopConditions(config: unknown, labels: ReturnType<typeof useTopologyLabels>) {
  const stopConditions = readCanaryStopConditions(readRecord(config)?.['stopConditions']);
  if (!stopConditions) return labels.terminationManual;

  const parts = [];
  if (stopConditions.maxSamples !== null) parts.push(`${labels.terminationByCount} · ${stopConditions.maxSamples}`);
  if (stopConditions.maxDurationSeconds !== null) {
    parts.push(`${labels.terminationByTime} · ${stopConditions.maxDurationSeconds}s`);
  }

  return parts.length > 0 ? parts.join(' / ') : labels.terminationManual;
}

function readCanaryStopConditions(value: unknown): CanaryReleaseStopConditionsDto | null {
  const record = readRecord(value);
  if (!record) return null;

  const maxSamples = positiveIntegerValue(record['maxSamples']);
  const maxDurationSeconds = positiveIntegerValue(record['maxDurationSeconds']);
  if (maxSamples === null && maxDurationSeconds === null) return null;

  return { maxDurationSeconds, maxSamples };
}

function normalizeOutputMapping(value: unknown): OutputMappingItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is OutputMappingItem => {
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

function normalizeConnectorOutputRoutes(value: unknown, connectorIds: string[]): OutputConnectorRouteDraft[] {
  const selectedIds = new Set(connectorIds);
  const routes = new Map<string, OutputMappingItem[]>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const connectorId = record['connectorId'];
      if (typeof connectorId !== 'string' || !selectedIds.has(connectorId)) continue;
      routes.set(connectorId, normalizeOutputMapping(record['outputMapping']));
    }
  }

  if (routes.size > 0) {
    return connectorIds.map((connectorId) => ({
      connectorId,
      outputMapping: routes.get(connectorId) ?? [],
    }));
  }

  const legacyMapping = normalizeOutputMapping(value);
  return connectorIds.map((connectorId) => ({ connectorId, outputMapping: legacyMapping }));
}

function countOutputMappingRows(value: unknown) {
  if (!Array.isArray(value)) return 0;
  const connectorRouteCount = value.reduce((total, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return total;
    const record = item as Record<string, unknown>;
    if (typeof record['connectorId'] !== 'string') return total;
    return total + normalizeOutputMapping(record['outputMapping']).length;
  }, 0);
  return connectorRouteCount > 0 ? connectorRouteCount : normalizeOutputMapping(value).length;
}

function serializeOutputRoutes(value: OutputConnectorRouteDraft[]) {
  return JSON.stringify(
    value
      .map((route) => ({
        connectorId: route.connectorId,
        outputMapping: cleanOutputMapping(route.outputMapping),
      }))
      .sort((left, right) => left.connectorId.localeCompare(right.connectorId)),
  );
}

function cleanOutputMapping(value: unknown) {
  return normalizeOutputMapping(value)
    .map((item) => ({ source: item.source.trim(), target: item.target.trim() }))
    .filter((item) => item.source.length > 0 && item.target.length > 0);
}

function cleanOutputRoutes(value: OutputConnectorRouteDraft[]) {
  return value.map((route) => ({
    connectorId: route.connectorId,
    outputMapping: cleanOutputMapping(route.outputMapping),
  }));
}

function getOutputSourceGroups(
  snapshot: unknown,
  upstreamFields: InputRouteFieldOption[],
  labels: ReturnType<typeof useTopologyLabels>,
): OutputSourceGroup[] {
  const upstreamOptions = dedupeOutputSourceOptions(
    upstreamFields.map((field) => ({
      value: field.key,
      label: field.key,
      description: field.description || field.type,
    })),
  );
  const modelOptions: OutputSourceOption[] = [
    {
      value: 'decision_output',
      label: labels.outputRouteSourceDecisionOutput,
      description: 'decision_output',
    },
    {
      value: 'parsed_output',
      label: labels.outputRouteSourceParsedOutput,
      description: 'parsed_output',
    },
    {
      value: 'raw_response',
      label: labels.outputRouteSourceRawResponse,
      description: 'raw_response',
    },
  ];
  const metaOptions: OutputSourceOption[] = [
    {
      value: 'status',
      label: labels.status,
      description: 'status',
    },
    {
      value: 'external_id',
      label: labels.externalId,
      description: 'external_id',
    },
    {
      value: 'run_result_id',
      label: labels.outputRouteSourceRunResultId,
      description: 'run_result_id',
    },
    {
      value: 'metrics.latency_ms',
      label: labels.outputRouteSourceModelOutput,
      description: 'metrics.latency_ms',
    },
  ];

  const outputSchema = readRecord(readRecord(snapshot)?.['outputSchema']);
  const fields = Array.isArray(outputSchema?.['fields']) ? outputSchema['fields'] : [];
  const schemaOptions = fields
    .map((field): OutputSourceOption | null => {
      const record = readRecord(field);
      const key = typeof record?.['key'] === 'string' ? record['key'].trim() : '';
      if (!key) return null;
      const value = typeof record?.['value'] === 'string' ? record['value'].trim() : '';
      return {
        value: key,
        label: key,
        description: value || labels.outputRouteSourceModelOutput,
      };
    })
    .filter((option): option is OutputSourceOption => option !== null);

  const groups: OutputSourceGroup[] = [
    {
      key: 'upstream',
      label: labels.outputRouteSourceGroupUpstream,
      badge: labels.outputRouteNewBadge,
      options: upstreamOptions,
    },
    {
      key: 'model',
      label: labels.outputRouteSourceGroupModel,
      options: dedupeOutputSourceOptions([...schemaOptions, ...modelOptions]),
    },
    {
      key: 'meta',
      label: labels.outputRouteSourceGroupMeta,
      options: metaOptions,
    },
  ];
  return groups.filter((group) => group.options.length > 0);
}

function dedupeOutputSourceOptions(options: OutputSourceOption[]) {
  return Array.from(new Map(options.map((option) => [option.value, option])).values());
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getOutputRouteConnectorItems(connectorIds: string[], connectors: ConnectorListItemDto[]) {
  const connectorById = new Map(connectors.map((connector) => [connector.id, connector]));
  return connectorIds.map((connectorId) => ({
    id: connectorId,
    name: connectorById.get(connectorId)?.name ?? connectorId,
  }));
}

function OutputRouteConnectorList({
  connectorIds,
  connectors,
  emptyLabel,
}: {
  connectorIds: string[];
  connectors: ConnectorListItemDto[];
  emptyLabel: string;
}) {
  const items = getOutputRouteConnectorItems(connectorIds, connectors);
  if (items.length === 0) return <span className="text-muted-foreground">{emptyLabel}</span>;
  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div key={`${item.id}:${index}`} className="truncate" title={item.name}>
          {item.name}
        </div>
      ))}
    </div>
  );
}

function getOutputRouteMappingSummary(outputMapping: unknown, labels: ReturnType<typeof useTopologyLabels>) {
  const count = countOutputMappingRows(outputMapping);
  return count > 0 ? String(count) : labels.outputRoutePassThrough;
}

function OutputRouteSummaryCards({
  line,
  outputConnectors,
  labels,
}: {
  line: ReleaseLineView;
  outputConnectors: ConnectorListItemDto[];
  labels: ReturnType<typeof useTopologyLabels>;
}) {
  const productionEvent = line.production?.currentEvent ?? null;
  const productionConnectorIds = productionEvent?.outputConnectorIds ?? [];
  const canaryConnectorIds = line.canary?.outputConnectorIds ?? [];

  return (
    <div className="grid gap-3">
      <OutputRouteSummaryCard
        title={labels.production}
        tone={productionEvent ? 'production' : 'muted'}
        rows={[
          {
            label: labels.outputRouteSummaryConnectors,
            valueNode: (
              <OutputRouteConnectorList
                connectorIds={productionConnectorIds}
                connectors={outputConnectors}
                emptyLabel={labels.noDownstream}
              />
            ),
          },
          {
            label: labels.outputRouteSummaryMapping,
            value: getOutputRouteMappingSummary(line.productionOutputMapping, labels),
          },
        ]}
      />
      <OutputRouteSummaryCard
        title={labels.canary}
        tone={line.canary ? 'canary' : 'muted'}
        rows={[
          {
            label: labels.outputRouteSummaryConnectors,
            valueNode: line.canary ? (
              <OutputRouteConnectorList
                connectorIds={canaryConnectorIds}
                connectors={outputConnectors}
                emptyLabel={labels.noDownstream}
              />
            ) : (
              <span className="text-muted-foreground">{labels.noCanary}</span>
            ),
          },
          {
            label: labels.outputRouteSummaryMapping,
            value: line.canary ? getOutputRouteMappingSummary(line.canaryOutputMapping, labels) : labels.noCanary,
          },
        ]}
      />
    </div>
  );
}

function OutputRouteSummaryCard({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: ReleaseTopologyTone;
  rows: InspectorRow[];
}) {
  const token = TONE_STYLES[tone];
  return (
    <section className="rounded-lg border bg-card p-3" style={{ borderColor: token.bd }}>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: token.dot }} />
        <span className="text-[12px] font-semibold">{title}</span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <InspectorRowView key={`${title}:${row.label}`} row={{ ...row, mono: false }} />
        ))}
      </div>
    </section>
  );
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

type InputRouteLaneDraft = {
  laneType: ReleaseLineLaneTypeDto;
  title: string;
  tone: ReleaseTopologyTone;
  canEdit: boolean;
  eventId: string;
  updatedAt: string | null;
  variableMapping: unknown;
  filterRules: unknown;
  externalIdField: string | null;
  promptVersionSnapshot: unknown;
  inputConnectorSnapshot: unknown;
};

function normalizeInputRouteFilterRules(value: unknown): CanaryReleaseFilterNodeDto | null {
  const parsed = canaryReleaseFilterRulesSchema.safeParse(value ?? null);
  return parsed.success ? parsed.data : null;
}

function cleanInputRouteMappingRecord(mapping: Record<string, string>, externalIdField: string) {
  const result: Record<string, string> = {};
  for (const [target, source] of Object.entries(mapping)) {
    const cleanTarget = target.trim();
    const cleanSource = source.trim();
    if (!cleanTarget || !cleanSource || cleanTarget === 'id') continue;
    result[cleanTarget] = cleanSource;
  }
  if (externalIdField.trim()) result.id = externalIdField.trim();
  return result;
}

function buildInputRouteUpdate(
  laneType: ReleaseLineLaneTypeDto,
  mapping: Record<string, string>,
  filterRules: CanaryReleaseFilterNodeDto | null,
  externalIdField: string,
  promptVariables: ReturnType<typeof extractPromptVariablesFromSnapshot>,
): UpdateReleaseLineInputRouteInputDto | null {
  const normalizedExternalIdField = externalIdField.trim();
  if (!normalizedExternalIdField) return null;
  if (!canaryReleaseFilterRulesSchema.safeParse(filterRules).success) return null;
  if (promptVariables.some((variable) => !mapping[variable.name]?.trim())) return null;
  if (laneType === 'production') {
    return {
      laneType,
      variableMapping: cleanInputRouteMappingRecord(mapping, normalizedExternalIdField),
      filterRules,
      externalIdField: normalizedExternalIdField,
    };
  }
  return {
    laneType,
    variableMapping: canaryInputRouteMappingFromRecord(mapping, promptVariables, normalizedExternalIdField),
    filterRules,
    externalIdField: normalizedExternalIdField,
  };
}

function inputRouteSignature(input: UpdateReleaseLineInputRouteInputDto | null) {
  return input ? JSON.stringify(input) : null;
}

function getInputRouteLane(
  line: ReleaseLineView,
  labels: ReturnType<typeof useTopologyLabels>,
  laneType: ReleaseLineLaneTypeDto,
): InputRouteLaneDraft | null {
  if (laneType === 'canary') {
    const canary = line.canary;
    if (!canary) return null;
    return {
      laneType: 'canary',
      title: labels.canary,
      tone: 'canary',
      canEdit: isAdjustableCanary(canary),
      eventId: canary.id,
      updatedAt: canary.updatedAt,
      variableMapping: canary.variableMapping,
      filterRules: canary.filterRules,
      externalIdField: canary.externalIdField,
      promptVersionSnapshot: line.canaryPromptVersionSnapshot,
      inputConnectorSnapshot: line.inputConnectorSnapshot,
    };
  }

  const event = line.production?.currentEvent ?? null;
  if (!event) return null;
  return {
    laneType: 'production',
    title: labels.production,
    tone: 'production',
    canEdit: event.status === 'running',
    eventId: event.id,
    updatedAt: event.updatedAt,
    variableMapping: event.variableMapping,
    filterRules: event.filterRules,
    externalIdField: event.externalIdField,
    promptVersionSnapshot: event.promptVersionSnapshot,
    inputConnectorSnapshot: line.inputConnectorSnapshot,
  };
}

function formatFilterValue(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function summarizeFilterRules(
  value: CanaryReleaseFilterNodeDto | null,
  labels: ReturnType<typeof useTopologyLabels>,
  depth = 0,
): string {
  if (!value) return labels.filterEmpty;
  if (value.type === 'atom') {
    const op = labels.filterOp(value.op);
    if (value.op === 'exists') return `${value.field} ${op}`;
    const displayValue = formatFilterValue(value.value);
    return displayValue ? `${value.field} ${op} ${displayValue}` : `${value.field} ${op}`;
  }
  if (value.type === 'not') {
    return `NOT (${summarizeFilterRules(value.child, labels, depth + 1)})`;
  }
  const joiner = value.type.toUpperCase();
  const summary = value.children.map((child) => summarizeFilterRules(child, labels, depth + 1)).join(` ${joiner} `);
  return depth > 0 && value.children.length > 1 ? `(${summary})` : summary;
}

function SimpleFilterRulesView({
  value,
  labels,
}: {
  value: CanaryReleaseFilterNodeDto | null;
  labels: ReturnType<typeof useTopologyLabels>;
}) {
  return (
    <div className="rounded-md border bg-muted/35 px-3 py-2 font-mono text-[11.5px] leading-5 text-muted-foreground">
      {summarizeFilterRules(value, labels)}
    </div>
  );
}

function collectLaneInputRouteKeys(lane: InputRouteLaneDraft | null): string[] {
  if (!lane) return [];
  return [
    lane.externalIdField ?? '',
    ...Object.values(inputRouteMappingRecord(lane.variableMapping)),
    ...collectFilterRuleFields(normalizeInputRouteFilterRules(lane.filterRules)),
  ];
}

function getLineInputFieldOptions(line: ReleaseLineView, labels: ReturnType<typeof useTopologyLabels>) {
  return mergeInputFieldOptions(extractInputFieldOptionsFromSnapshot(line.inputConnectorSnapshot), [
    ...collectLaneInputRouteKeys(getInputRouteLane(line, labels, 'production')),
    ...collectLaneInputRouteKeys(getInputRouteLane(line, labels, 'canary')),
  ]);
}

function UpstreamInputFields({
  line,
  labels,
}: {
  line: ReleaseLineView;
  labels: ReturnType<typeof useTopologyLabels>;
}) {
  const fields = getLineInputFieldOptions(line, labels);
  return (
    <section className="mt-4 rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-[12px] font-semibold">{labels.inputFields}</div>
      {fields.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-muted-foreground">{labels.inputFieldsEmpty}</div>
      ) : (
        <div className="max-h-56 overflow-auto p-2">
          <div className="space-y-1.5">
            {fields.map((field) => (
              <div key={field.key} className="rounded-md border bg-background px-2 py-1.5">
                <div className="break-all font-mono text-[11.5px] font-semibold">{field.key}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
                  <span>{field.type}</span>
                  {field.description ? <span className="break-words">{field.description}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function InputRouteLaneEditor({
  lane,
  labels,
  pending,
  onUpdateInputRoute,
}: {
  lane: InputRouteLaneDraft;
  labels: ReturnType<typeof useTopologyLabels>;
  pending: boolean;
  onUpdateInputRoute?: (input: UpdateReleaseLineInputRouteInputDto) => Promise<unknown>;
}) {
  const initialMapping = inputRouteMappingRecord(lane.variableMapping);
  const initialExternalIdField = lane.externalIdField ?? initialMapping.id ?? '';
  const initialFilterRules = normalizeInputRouteFilterRules(lane.filterRules);
  const [mapping, setMapping] = useState<Record<string, string>>(initialMapping);
  const [externalIdField, setExternalIdField] = useState(initialExternalIdField);
  const [filterRules, setFilterRules] = useState<CanaryReleaseFilterNodeDto | null>(initialFilterRules);
  const [savedSignature, setSavedSignature] = useState(() => {
    const promptVariables = extractPromptVariablesFromSnapshot(lane.promptVersionSnapshot, initialMapping);
    return inputRouteSignature(
      buildInputRouteUpdate(lane.laneType, initialMapping, initialFilterRules, initialExternalIdField, promptVariables),
    );
  });
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = TONE_STYLES[lane.tone];
  const promptVariables = useMemo(
    () => extractPromptVariablesFromSnapshot(lane.promptVersionSnapshot, mapping),
    [lane.promptVersionSnapshot, mapping],
  );
  const fieldOptions = useMemo(
    () =>
      mergeInputFieldOptions(extractInputFieldOptionsFromSnapshot(lane.inputConnectorSnapshot), [
        externalIdField,
        ...Object.values(mapping),
        ...collectFilterRuleFields(filterRules),
      ]),
    [externalIdField, filterRules, lane.inputConnectorSnapshot, mapping],
  );
  const nextUpdate = buildInputRouteUpdate(lane.laneType, mapping, filterRules, externalIdField, promptVariables);
  const nextSignature = inputRouteSignature(nextUpdate);
  const hasDraft = nextSignature !== savedSignature;
  const canEdit = lane.canEdit && Boolean(onUpdateInputRoute);
  const showSave = canEdit && hasDraft;
  const canSave = showSave && !pending;

  function setMappingField(target: string, source: string) {
    setMapping((current) => ({ ...current, [target]: source }));
    setError(null);
  }

  function setMappingTarget(target: string, nextTarget: string) {
    setMapping((current) => ({
      ...current,
      [target]: current[nextTarget] ?? '',
      [nextTarget]: current[target] ?? '',
    }));
    setError(null);
  }

  async function saveInputRoute() {
    if (!canEdit || pending || !onUpdateInputRoute) return;
    if (!nextUpdate || !nextSignature) {
      setError(labels.inputRouteInvalid);
      return;
    }
    if (nextSignature === savedSignature) return;
    setError(null);
    try {
      await onUpdateInputRoute(nextUpdate);
      setSavedSignature(nextSignature);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError) ?? labels.inputRouteSaveFailed);
    }
  }

  return (
    <section className="mt-4 rounded-lg border bg-card" style={{ borderColor: token.bd }}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: token.dot }} />
          <span className="text-[12px] font-semibold">{lane.title}</span>
        </div>
        {showSave ? (
          <Button
            type="button"
            size="sm"
            onClick={saveInputRoute}
            disabled={!canSave}
            className="h-7 px-2 text-[11.5px]"
          >
            <Save className="size-3.5" />
            {pending ? labels.savePending : labels.save}
          </Button>
        ) : null}
      </div>
      <div className="space-y-4 p-3">
        <div>
          <div className="mb-2 text-[11px] font-medium text-muted-foreground">{labels.fieldMapping}</div>
          <FieldMappingTable
            compact
            fields={fieldOptions}
            promptVariables={promptVariables}
            externalIdField={externalIdField}
            mapping={mapping}
            readOnly={!canEdit || pending}
            testIdPrefix={`release-${lane.laneType}-input-route`}
            onExternalIdFieldChange={(value) => {
              setExternalIdField(value);
              setError(null);
            }}
            onMappingChange={setMappingField}
            onMappingTargetChange={setMappingTarget}
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">{labels.filterRules}</span>
            {canEdit && !pending ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11.5px]"
                onClick={() => setFilterEditorOpen((current) => !current)}
              >
                {filterEditorOpen ? labels.inputRouteHideFilter : labels.inputRouteEditFilter}
              </Button>
            ) : null}
          </div>
          {canEdit && !pending && filterEditorOpen ? (
            <FilterRulesBuilder
              compact
              value={filterRules}
              fields={fieldOptions}
              onChange={(next) => {
                setFilterRules(next);
                setError(null);
              }}
            />
          ) : (
            <SimpleFilterRulesView value={filterRules} labels={labels} />
          )}
        </div>
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}

function IconTooltipButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  variant = 'outline',
  className,
  testId,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'ghost';
  className?: string;
  testId?: string;
}) {
  return (
    <TooltipProvider delayDuration={140}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={variant}
            className={cn('size-8', className)}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            data-testid={testId}
          >
            <Icon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CanaryLaneActions({
  canary,
  labels,
  pending,
  onAddCanary,
  onStopCanary,
  onPromoteCanary,
}: {
  canary?: CanaryReleaseListItemDto | null;
  labels: ReturnType<typeof useTopologyLabels>;
  pending: boolean;
  onAddCanary?: () => void;
  onStopCanary?: (canary: CanaryReleaseListItemDto) => Promise<unknown>;
  onPromoteCanary?: (canary: CanaryReleaseListItemDto) => Promise<unknown>;
}) {
  const [activeAction, setActiveAction] = useState<CanaryLaneAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPromote = canary?.status === 'running' && Boolean(onPromoteCanary);
  const canStop = canary?.status === 'running' && Boolean(onStopCanary);
  const canAddCanary = Boolean(onAddCanary);
  const busy = pending || activeAction !== null;
  const addCanaryLabel = canary ? labels.replaceCanary : labels.addCanary;

  async function runAction(
    action: CanaryLaneAction,
    handler: ((canary: CanaryReleaseListItemDto) => Promise<unknown>) | undefined,
  ) {
    if (!handler || !canary || busy) return;
    setError(null);
    setActiveAction(action);
    try {
      await handler(canary);
    } catch (caught) {
      setError(getApiErrorMessage(caught) ?? labels.canaryActionFailed);
    } finally {
      setActiveAction(null);
    }
  }

  if (!canPromote && !canStop && !canAddCanary) return null;

  return (
    <div className="flex min-w-0 flex-col items-end gap-1" data-testid="release-topology-canary-actions">
      <div className="flex flex-wrap justify-end gap-1.5">
        {canPromote ? (
          <IconTooltipButton
            label={labels.promoteCanary}
            icon={Rocket}
            onClick={() => void runAction('promote', onPromoteCanary)}
            disabled={busy}
            variant="default"
            testId="release-topology-promote-canary"
          />
        ) : null}
        {canAddCanary ? (
          <IconTooltipButton
            label={addCanaryLabel}
            icon={Plus}
            onClick={() => onAddCanary?.()}
            disabled={busy}
            variant="outline"
            testId="release-topology-add-canary"
          />
        ) : null}
        {canStop ? (
          <IconTooltipButton
            label={labels.stopCanary}
            icon={Square}
            onClick={() => void runAction('stop', onStopCanary)}
            disabled={busy}
            variant="outline"
            className="text-destructive hover:text-destructive"
          />
        ) : null}
      </div>
      {error ? <p className="max-w-full truncate text-[11.5px] text-destructive">{error}</p> : null}
    </div>
  );
}

function OutputRouteControl({
  line,
  outputConnectors,
  outputConnectorsLoading,
  labels,
  pending,
  onUpdateOutputRoute,
}: {
  line: ReleaseLineView;
  outputConnectors: ConnectorListItemDto[];
  outputConnectorsLoading: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
  pending: boolean;
  onUpdateOutputRoute?: (input: UpdateReleaseLineOutputRouteInputDto) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const upstreamFields = useMemo(
    () => extractInputFieldOptionsFromSnapshot(line.inputConnectorSnapshot),
    [line.inputConnectorSnapshot],
  );
  const laneDrafts: Array<OutputRouteLaneDraft | null> = [
    line.production?.currentEvent
      ? {
          key: 'production' as const,
          title: labels.production,
          tone: 'production' as const,
          canEdit: line.production.currentEvent.status === 'running',
          connectorIds: line.production.currentEvent.outputConnectorIds,
          outputMapping: line.productionOutputMapping,
          outputSourceGroups: getOutputSourceGroups(
            line.production.currentEvent.promptVersionSnapshot,
            upstreamFields,
            labels,
          ),
        }
      : null,
    line.canary
      ? {
          key: 'canary' as const,
          title: labels.canary,
          tone: 'canary' as const,
          canEdit: isAdjustableCanary(line.canary),
          connectorIds: line.canary.outputConnectorIds,
          outputMapping: line.canaryOutputMapping,
          outputSourceGroups: getOutputSourceGroups(line.canaryPromptVersionSnapshot, upstreamFields, labels),
        }
      : null,
  ];
  const lanes = laneDrafts.filter((lane): lane is OutputRouteLaneDraft => lane !== null);

  if (lanes.length === 0) {
    return (
      <section className="mt-4 rounded-lg border bg-card p-3 text-[12px] text-muted-foreground">
        {labels.outputRouteNoLane}
      </section>
    );
  }

  return (
    <div className="mt-4">
      <Button type="button" className="w-full justify-center" onClick={() => setOpen(true)}>
        <Split className="size-4" />
        {labels.outputRouteEdit}
      </Button>
      {open ? (
        <OutputRouteDialog
          open={open}
          onOpenChange={setOpen}
          lanes={lanes}
          outputConnectors={outputConnectors}
          outputConnectorsLoading={outputConnectorsLoading}
          labels={labels}
          pending={pending}
          lineLabel={line.label}
          onUpdateOutputRoute={onUpdateOutputRoute}
        />
      ) : null}
    </div>
  );
}

function OutputRouteDialog({
  open,
  onOpenChange,
  lanes,
  outputConnectors,
  outputConnectorsLoading,
  labels,
  pending,
  lineLabel,
  onUpdateOutputRoute,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lanes: OutputRouteLaneDraft[];
  outputConnectors: ConnectorListItemDto[];
  outputConnectorsLoading: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
  pending: boolean;
  lineLabel: string;
  onUpdateOutputRoute?: (input: UpdateReleaseLineOutputRouteInputDto) => Promise<unknown>;
}) {
  const [drafts, setDrafts] = useState<Partial<Record<ReleaseLineLaneTypeDto, OutputConnectorRouteDraft[]>>>(() =>
    Object.fromEntries(
      lanes.map((lane) => [lane.key, normalizeConnectorOutputRoutes(lane.outputMapping, lane.connectorIds)]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectorById = useMemo(
    () => new Map(outputConnectors.map((connector) => [connector.id, connector])),
    [outputConnectors],
  );
  const laneEntries = lanes.map((lane) => {
    const routes = drafts[lane.key] ?? [];
    const initialRoutes = normalizeConnectorOutputRoutes(lane.outputMapping, lane.connectorIds);
    const cleanRoutes = cleanOutputRoutes(routes);
    const hasDraft = serializeOutputRoutes(cleanRoutes) !== serializeOutputRoutes(initialRoutes);
    return { lane, routes, cleanRoutes, hasDraft };
  });
  const busy = pending || saving;
  const changedEntries = laneEntries.filter((entry) => entry.hasDraft && entry.lane.canEdit);
  const hasReadonlyDraft = laneEntries.some((entry) => entry.hasDraft && !entry.lane.canEdit);
  const canSave = Boolean(onUpdateOutputRoute) && !busy && changedEntries.length > 0 && !hasReadonlyDraft;
  const productionConnectorCount = drafts.production?.length ?? 0;
  const canaryConnectorCount = drafts.canary?.length ?? 0;
  const mappingCount = laneEntries.reduce(
    (total, entry) => total + entry.cleanRoutes.reduce((sum, route) => sum + route.outputMapping.length, 0),
    0,
  );

  function updateLaneRoutes(
    laneType: ReleaseLineLaneTypeDto,
    updater: (routes: OutputConnectorRouteDraft[]) => OutputConnectorRouteDraft[],
  ) {
    setDrafts((current) => ({ ...current, [laneType]: updater(current[laneType] ?? []) }));
    setError(null);
  }

  async function saveOutputRoutes() {
    const update = onUpdateOutputRoute;
    if (!canSave || !update) return;
    setSaving(true);
    setError(null);
    try {
      for (const entry of changedEntries) {
        await update({
          laneType: entry.lane.key,
          outputConnectorIds: entry.cleanRoutes.map((route) => route.connectorId),
          outputMapping: entry.cleanRoutes,
        });
      }
      onOpenChange(false);
    } catch (caught) {
      setError(getApiErrorMessage(caught) ?? labels.outputRouteSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[920px] gap-0 overflow-hidden rounded-[14px] p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-[16px]">{labels.outputRouteDialogTitle}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {labels.outputRouteTitle} · <span className="font-mono">{lineLabel}</span> ·{' '}
            {labels.outputRouteDialogDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(88vh-136px)] overflow-y-auto">
          <div className={cn('grid grid-cols-1', lanes.length > 1 && 'lg:grid-cols-2')}>
            {laneEntries.map((entry, index) => (
              <OutputRouteLaneEditor
                key={entry.lane.key}
                lane={entry.lane}
                routes={entry.routes}
                canEdit={entry.lane.canEdit && Boolean(onUpdateOutputRoute)}
                connectorById={connectorById}
                outputConnectors={outputConnectors}
                outputConnectorsLoading={outputConnectorsLoading}
                labels={labels}
                busy={busy}
                className={index > 0 ? 'lg:border-l' : undefined}
                onRoutesChange={(updater) => updateLaneRoutes(entry.lane.key, updater)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t bg-muted/40 px-5 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 text-[12px] text-muted-foreground">
            {labels.outputRouteFooterSummary(productionConnectorCount, canaryConnectorCount, mappingCount)}
          </div>
          {error ? <div className="text-[12px] text-destructive">{error}</div> : null}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {labels.cancel}
            </Button>
            <Button type="button" onClick={saveOutputRoutes} disabled={!canSave}>
              <Save className="size-4" />
              {busy ? labels.savePending : labels.outputRouteSave}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OutputRouteLaneEditor({
  lane,
  routes,
  canEdit,
  connectorById,
  outputConnectors,
  outputConnectorsLoading,
  labels,
  busy,
  className,
  onRoutesChange,
}: {
  lane: OutputRouteLaneDraft;
  routes: OutputConnectorRouteDraft[];
  canEdit: boolean;
  connectorById: Map<string, ConnectorListItemDto>;
  outputConnectors: ConnectorListItemDto[];
  outputConnectorsLoading: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
  busy: boolean;
  className?: string;
  onRoutesChange: (updater: (routes: OutputConnectorRouteDraft[]) => OutputConnectorRouteDraft[]) => void;
}) {
  const token = TONE_STYLES[lane.tone];
  const selectedConnectorIds = new Set(routes.map((route) => route.connectorId));
  const addableConnectors = outputConnectors.filter((connector) => {
    if (selectedConnectorIds.has(connector.id)) return false;
    return true;
  });

  function addConnector(connectorId: string) {
    onRoutesChange((current) =>
      current.some((route) => route.connectorId === connectorId)
        ? current
        : [...current, { connectorId, outputMapping: [{ source: '', target: '' }] }],
    );
  }

  function removeConnector(connectorId: string) {
    onRoutesChange((current) => current.filter((route) => route.connectorId !== connectorId));
  }

  function addMapping(connectorId: string) {
    onRoutesChange((current) =>
      current.map((route) =>
        route.connectorId === connectorId
          ? { ...route, outputMapping: [...route.outputMapping, { source: '', target: '' }] }
          : route,
      ),
    );
  }

  function setMappingField(connectorId: string, index: number, field: keyof OutputMappingItem, value: string) {
    onRoutesChange((current) =>
      current.map((route) =>
        route.connectorId === connectorId
          ? {
              ...route,
              outputMapping: route.outputMapping.map((item, itemIndex) =>
                itemIndex === index ? { ...item, [field]: value } : item,
              ),
            }
          : route,
      ),
    );
  }

  function removeMapping(connectorId: string, index: number) {
    onRoutesChange((current) =>
      current.map((route) =>
        route.connectorId === connectorId
          ? { ...route, outputMapping: route.outputMapping.filter((_item, itemIndex) => itemIndex !== index) }
          : route,
      ),
    );
  }

  return (
    <section className={cn('min-w-0 px-5 py-4', className)}>
      <div className="mb-2 flex items-baseline gap-2 border-b-2 pb-3" style={{ borderColor: token.dot }}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: token.dot }} />
          <span className="truncate text-[15px] font-semibold">{lane.title}</span>
          <span className="font-mono text-[11.5px] text-muted-foreground">{lane.key}</span>
        </div>
        <span className="ml-auto whitespace-nowrap text-[11.5px] text-muted-foreground">
          {labels.outputRouteConnectorCount(routes.length)}
        </span>
      </div>
      {!canEdit ? (
        <div className="mb-2 text-[11.5px] text-muted-foreground">{labels.outputRouteLaneReadonly}</div>
      ) : null}
      <div className="divide-y divide-dashed">
        {routes.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-8 text-center text-[12px] text-muted-foreground">
            {labels.outputRouteNoSelectedConnector}
          </div>
        ) : (
          routes.map((route) => {
            const connector = connectorById.get(route.connectorId);
            const connectorName = connector?.name ?? route.connectorId;
            const connectorMeta = connector
              ? `${connector.type} · ${connector.configSummary || connector.healthStatus}`
              : route.connectorId;
            return (
              <div key={route.connectorId} className="group py-3 first:pt-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[13.5px] font-semibold" title={connectorName}>
                      {connectorName}
                    </div>
                    <div
                      className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground"
                      title={connectorMeta}
                    >
                      {connectorMeta}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
                    title={labels.outputRouteRemoveConnector}
                    aria-label={labels.outputRouteRemoveConnector}
                    disabled={!canEdit || busy}
                    onClick={() => removeConnector(route.connectorId)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 space-y-0">
                  {route.outputMapping.length === 0 ? (
                    <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
                      {labels.outputRoutePassThrough}
                    </div>
                  ) : (
                    route.outputMapping.map((item, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[minmax(0,1.18fr)_16px_minmax(0,0.82fr)_24px] items-center gap-1 border-t border-dashed py-1 first:border-t-0"
                      >
                        <OutputSourcePicker
                          value={item.source}
                          sourceGroups={lane.outputSourceGroups}
                          labels={labels}
                          disabled={!canEdit || busy}
                          onChange={(value) => setMappingField(route.connectorId, index, 'source', value)}
                        />
                        <span className="text-center text-[12px] text-muted-foreground">→</span>
                        <input
                          value={item.target}
                          onChange={(event) => setMappingField(route.connectorId, index, 'target', event.target.value)}
                          placeholder={labels.outputRouteTarget}
                          disabled={!canEdit || busy}
                          className="h-8 min-w-0 border-0 border-b border-dashed bg-transparent px-1 font-mono text-[12.5px] outline-none transition-colors placeholder:font-sans placeholder:italic placeholder:text-muted-foreground hover:border-muted-foreground focus:border-primary focus:border-solid disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                          title={labels.removeMapping}
                          aria-label={labels.removeMapping}
                          disabled={!canEdit || busy}
                          onClick={() => removeMapping(route.connectorId, index)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canEdit || busy}
                  onClick={() => addMapping(route.connectorId)}
                >
                  <Plus className="size-3" />
                  {labels.addMapping}
                </button>
              </div>
            );
          })
        )}
      </div>
      <OutputConnectorAddPopover
        addableConnectors={addableConnectors}
        disabled={!canEdit || busy}
        loading={outputConnectorsLoading}
        labels={labels}
        onAdd={addConnector}
      />
    </section>
  );
}

function OutputConnectorAddPopover({
  addableConnectors,
  disabled,
  loading,
  labels,
  onAdd,
}: {
  addableConnectors: ConnectorListItemDto[];
  disabled: boolean;
  loading: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
  onAdd: (connectorId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || loading}
          className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-dashed bg-transparent text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-ring hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="size-3.5" />
          {loading ? labels.loading : labels.outputRouteAddConnector}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={6}
        className="w-[300px] p-1"
        onWheelCapture={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
      >
        <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
          {labels.outputRouteConnectorPickerTitle}
        </div>
        {addableConnectors.length === 0 ? (
          <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">
            {labels.outputRouteNoMoreConnectors}
          </div>
        ) : (
          <div
            className="max-h-[280px] overflow-auto overscroll-contain"
            onWheelCapture={(event) => event.stopPropagation()}
            onTouchMoveCapture={(event) => event.stopPropagation()}
          >
            {addableConnectors.map((connector) => (
              <button
                key={connector.id}
                type="button"
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                onClick={() => {
                  onAdd(connector.id);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{connector.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function OutputSourcePicker({
  value,
  sourceGroups,
  labels,
  disabled,
  onChange,
}: {
  value: string;
  sourceGroups: OutputSourceGroup[];
  labels: ReturnType<typeof useTopologyLabels>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = sourceGroupsForValue(value, sourceGroups, labels);
  const visibleGroups = filterOutputSourceGroups(groups, query);
  const groupKey = outputSourceGroupKeyForValue(value, groups);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 font-mono text-[12.5px] transition-colors hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60',
            !value && 'font-sans italic text-muted-foreground',
            groupKey === 'upstream' && 'text-[var(--status-running-fg)]',
          )}
        >
          {groupKey ? (
            <span className={cn('size-1.5 shrink-0 rounded-[2px]', outputSourceGroupDotClass(groupKey))} />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-left">{value || labels.outputRouteSourcePlaceholder}</span>
          <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground opacity-0', open && 'opacity-100')} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[300px] p-0"
        onWheelCapture={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.outputRouteSourceSearch}
            className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          className="max-h-[300px] overflow-auto overscroll-contain p-1"
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMoveCapture={(event) => event.stopPropagation()}
        >
          {visibleGroups.length === 0 ? (
            <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">
              {labels.outputRouteSourceEmpty}
            </div>
          ) : (
            visibleGroups.map((group, groupIndex) => (
              <div key={group.key} className={cn(groupIndex > 0 && 'border-t pt-1')}>
                <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
                  <span className={cn('size-1.5 rounded-[2px]', outputSourceGroupDotClass(group.key))} />
                  <span>{group.label}</span>
                  {group.badge ? (
                    <span className="ml-auto rounded border border-[var(--status-running-bd)] bg-[var(--status-running-bg)] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-[var(--status-running-fg)]">
                      {group.badge}
                    </span>
                  ) : null}
                </div>
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[12.5px] transition-colors hover:bg-muted',
                      option.value === value && 'bg-primary/5',
                    )}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mt-0.5 size-3 shrink-0 text-primary opacity-0',
                        option.value === value && 'opacity-100',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.value}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function sourceGroupsForValue(
  value: string,
  sourceGroups: OutputSourceGroup[],
  labels: ReturnType<typeof useTopologyLabels>,
): OutputSourceGroup[] {
  if (!value || sourceGroups.some((group) => group.options.some((option) => option.value === value))) {
    return sourceGroups;
  }
  return [
    {
      key: 'legacy',
      label: labels.outputRouteSourceLegacy,
      options: [{ value, label: value, description: labels.outputRouteSourceLegacy }],
    },
    ...sourceGroups,
  ];
}

function filterOutputSourceGroups(sourceGroups: OutputSourceGroup[], query: string): OutputSourceGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return sourceGroups;
  return sourceGroups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) =>
        [option.value, option.label, option.description].join(' ').toLowerCase().includes(normalized),
      ),
    }))
    .filter((group) => group.options.length > 0);
}

function outputSourceGroupKeyForValue(value: string, sourceGroups: OutputSourceGroup[]): OutputSourceGroupKey | null {
  if (!value) return null;
  return sourceGroups.find((group) => group.options.some((option) => option.value === value))?.key ?? null;
}

function outputSourceGroupDotClass(groupKey: OutputSourceGroupKey) {
  switch (groupKey) {
    case 'upstream':
      return 'bg-[var(--status-running-dot)]';
    case 'model':
      return 'bg-primary';
    case 'meta':
      return 'bg-[var(--status-canary-dot)]';
    case 'legacy':
      return 'bg-muted-foreground';
  }
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
  const isDualRun = canary?.trafficMode === 'dual_run';
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
        {isDualRun ? (
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
        ) : (
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
        )}
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
              {isDualRun ? (
                <>
                  <span>0%</span>
                  <span>{labels.canaryTrafficLabel} 100%</span>
                </>
              ) : (
                <>
                  <span>{labels.productionTrafficLabel} 100%</span>
                  <span>{labels.canaryTrafficLabel} 100%</span>
                </>
              )}
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
  stopConditions?: CanaryReleaseStopConditionsDto | null;
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
    stopConditions: readCanaryStopConditions(record.stopConditions),
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
  recordMode?: ReleaseLineRecordModeDto,
  recordCategories?: string[],
): UpdateReleaseLineRunConfigInputDto | null {
  const rpmLimit = parsePositiveInteger(draft.rpmLimit);
  const tpmLimit = parsePositiveInteger(draft.tpmLimit);
  const concurrency = parsePositiveInteger(draft.concurrency);
  if (rpmLimit === null || tpmLimit === null || concurrency === null) return null;

  const temperature = parseTemperature(draft.temperature);
  if (temperature === null) return null;

  const baseRunConfig = {
    rpmLimit,
    tpmLimit,
    concurrency,
    temperature,
  };

  if (laneType === 'canary') {
    return {
      laneType,
      modelId: draft.modelId || undefined,
      recordMode,
      recordCategories,
      runConfig: {
        ...baseRunConfig,
        ...(draft.stopConditions ? { stopConditions: draft.stopConditions } : {}),
      },
    };
  }

  return {
    laneType,
    modelId: draft.modelId || undefined,
    recordMode,
    recordCategories,
    runConfig: baseRunConfig,
  };
}

function runConfigSignature(input: UpdateReleaseLineRunConfigInputDto | null) {
  return input
    ? JSON.stringify({
        modelId: input.modelId ?? null,
        recordMode: input.recordMode ?? null,
        recordCategories: input.recordCategories ?? null,
        runConfig: input.runConfig,
      })
    : null;
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
  recordMode,
  models,
  modelsLoading,
  labels,
  canEdit,
  pending,
  onUpdateRunConfig,
  hideModel = false,
  className,
}: {
  laneType: ReleaseLineLaneTypeDto;
  config: object | null | undefined;
  currentModelId?: string | null;
  currentModelName?: string | null;
  recordMode?: ReleaseLineRecordModeDto;
  models: ProjectModelListItemDto[];
  modelsLoading: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
  canEdit: boolean;
  pending: boolean;
  onUpdateRunConfig?: (input: UpdateReleaseLineRunConfigInputDto) => Promise<unknown>;
  hideModel?: boolean;
  className?: string;
}) {
  const modelOptions = useMemo(
    () => buildRuntimeModelOptions(models, currentModelId, currentModelName),
    [currentModelId, currentModelName, models],
  );
  const [draft, setDraft] = useState<RunConfigDraft>(() => runConfigDraftFromRecord(config, currentModelId));
  const [error, setError] = useState<string | null>(null);
  const initialSignature = runConfigSignature(
    buildRunConfigUpdate(laneType, runConfigDraftFromRecord(config, currentModelId), recordMode),
  );
  const [savedSignature, setSavedSignature] = useState(initialSignature);
  const nextUpdate = buildRunConfigUpdate(laneType, draft, recordMode);
  const nextSignature = runConfigSignature(nextUpdate);
  const hasDraftChange = nextSignature !== savedSignature;
  const showSave = canEdit && Boolean(onUpdateRunConfig) && hasDraftChange;
  const canSubmit = showSave && !pending;
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
    <section className={cn('rounded-lg border bg-card', className)}>
      <div className="flex min-h-10 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-[12px] font-semibold">{labels.runConfigTitle}</div>
        {showSave ? (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11.5px]"
            onClick={saveRunConfig}
            disabled={!canSubmit}
          >
            <Save className="size-3.5" />
            {pending ? labels.savePending : labels.save}
          </Button>
        ) : null}
      </div>
      <div className="space-y-3 p-3">
        {hideModel ? null : (
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
        )}
        <div className="grid grid-cols-2 gap-2">
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

function resourceDetailHref(resource: 'model' | 'prompt', id: string | null | undefined, versionId?: string | null) {
  if (!id) return null;
  const encodedId = encodeURIComponent(id);
  if (resource === 'model') return `/models/${encodedId}/edit`;
  const query = versionId ? `?version=${encodeURIComponent(versionId)}` : '';
  return `/prompts/${encodedId}${query}`;
}

function LinkedInspectorValue({ href, value }: { href?: string | null; value?: string | null }) {
  const display = toDisplayValue(value);
  if (!href || !value) {
    return (
      <span className="block truncate" title={display}>
        {display}
      </span>
    );
  }
  return (
    <Link href={href} className="block truncate text-primary underline-offset-2 hover:underline" title={display}>
      {display}
    </Link>
  );
}

function editableRecordMode(mode: ReleaseLineRecordModeDto): ReleaseLineRecordModeDto {
  return mode === 'correct_only' ? 'selected_categories' : mode;
}

function normalizeRecordCategories(categories: string[], options: string[]) {
  const allowed = new Set(options);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const category of categories) {
    const trimmed = category.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (allowed.size > 0 && !allowed.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function recordSettingsSignature(mode: ReleaseLineRecordModeDto, categories: string[]) {
  return JSON.stringify({
    mode: editableRecordMode(mode),
    categories: editableRecordMode(mode) === 'selected_categories' ? [...categories].sort() : [],
  });
}

function recordCategoriesDraftFromState(
  mode: ReleaseLineRecordModeDto,
  categories: string[],
  options: string[],
): string[] {
  if (options.length === 0) return [];
  const normalized = normalizeRecordCategories(categories, options);
  return editableRecordMode(mode) === 'selected_categories' && normalized.length > 0 ? normalized : options;
}

function recordModeFromDraftCategories(categories: string[], options: string[]): ReleaseLineRecordModeDto {
  if (options.length === 0 || categories.length === options.length) return 'all';
  return 'selected_categories';
}

function recordCategoryOptionsFromSnapshot(snapshot: Record<string, unknown>, savedCategories: string[]) {
  const outputSchema = snapshot['outputSchema'] ?? null;
  const derived = deriveClassificationOptionsFromPromptOutputSchema(outputSchema as PromptOutputSchemaDto);
  return Array.from(new Set([...derived, ...savedCategories].map((category) => category.trim()).filter(Boolean)));
}

function RecordCategorySelector({
  value,
  options,
  disabled,
  labels,
  onChange,
}: {
  value: string[];
  options: string[];
  disabled: boolean;
  labels: ReturnType<typeof useTopologyLabels>;
  onChange: (next: string[]) => void;
}) {
  const allSelected = options.length > 0 && options.every((option) => value.includes(option));

  if (options.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        {labels.recordCategoriesEmpty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground">{labels.recordCategoriesSelected(value.length)}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11.5px]"
          disabled={disabled}
          onClick={() => onChange(allSelected ? [] : options)}
        >
          {allSelected ? labels.recordCategoriesClear : labels.recordCategoriesSelectAll}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-md border bg-muted/30 p-2">
        {options.map((option) => {
          const selected = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(selected ? value.filter((item) => item !== option) : [...value, option])}
              className={cn(
                'inline-flex h-7 min-w-0 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted',
              )}
            >
              {selected ? <Check className="size-3" strokeWidth={3} /> : null}
              <span className="max-w-[140px] truncate">{option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecordModeMetadataCard({
  laneType,
  config,
  modelId,
  recordMode,
  recordCategories,
  promptVersionSnapshot,
  createdAt,
  updatedAt,
  labels,
  formatDateTimeOrDash,
  canEdit,
  pending,
  onUpdateRunConfig,
}: {
  laneType: ReleaseLineLaneTypeDto;
  config: object | null | undefined;
  modelId?: string | null;
  recordMode: ReleaseLineRecordModeDto;
  recordCategories: string[];
  promptVersionSnapshot: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  labels: ReturnType<typeof useTopologyLabels>;
  formatDateTimeOrDash: DateTimeOrDashFormatter;
  canEdit: boolean;
  pending: boolean;
  onUpdateRunConfig?: (input: UpdateReleaseLineRunConfigInputDto) => Promise<unknown>;
}) {
  const recordCategoryOptions = useMemo(
    () => recordCategoryOptionsFromSnapshot(promptVersionSnapshot, recordCategories),
    [promptVersionSnapshot, recordCategories],
  );
  const initialCategories = recordCategoriesDraftFromState(recordMode, recordCategories, recordCategoryOptions);
  const [draftRecordCategories, setDraftRecordCategories] = useState<string[]>(initialCategories);
  const initialMode = recordModeFromDraftCategories(initialCategories, recordCategoryOptions);
  const initialRecordCategories = initialMode === 'selected_categories' ? initialCategories : [];
  const [savedSignature, setSavedSignature] = useState(recordSettingsSignature(initialMode, initialRecordCategories));
  const [error, setError] = useState<string | null>(null);
  const normalizedDraftCategories = normalizeRecordCategories(draftRecordCategories, recordCategoryOptions);
  const draftRecordMode = recordModeFromDraftCategories(normalizedDraftCategories, recordCategoryOptions);
  const draftRecordCategoriesForSave = draftRecordMode === 'selected_categories' ? normalizedDraftCategories : [];
  const nextUpdate = buildRunConfigUpdate(
    laneType,
    runConfigDraftFromRecord(config, modelId),
    draftRecordMode,
    draftRecordCategoriesForSave,
  );
  const nextSignature = recordSettingsSignature(draftRecordMode, draftRecordCategoriesForSave);
  const hasRecordModeDraft = nextSignature !== savedSignature;
  const showSave = canEdit && Boolean(onUpdateRunConfig) && hasRecordModeDraft;
  const canSubmit = showSave && !pending;

  async function saveRecordMode() {
    if (!canEdit || !onUpdateRunConfig || pending || !hasRecordModeDraft) return;
    if (!nextUpdate) {
      setError(labels.runConfigInvalid);
      return;
    }
    setError(null);
    try {
      await onUpdateRunConfig(nextUpdate);
      setSavedSignature(nextSignature);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError) ?? labels.runConfigUpdateFailed);
    }
  }

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex min-h-10 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-[12px] font-semibold">{labels.recordModeTitle}</div>
        {showSave ? (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11.5px]"
            onClick={saveRecordMode}
            disabled={!canSubmit}
          >
            <Save className="size-3.5" />
            {pending ? labels.savePending : labels.save}
          </Button>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2 text-[12px]">
          <span className="pt-1.5 text-muted-foreground">{labels.recordCategories}</span>
          <RecordCategorySelector
            value={normalizedDraftCategories}
            options={recordCategoryOptions}
            disabled={!canEdit || pending}
            labels={labels}
            onChange={(next) => {
              setDraftRecordCategories(next);
              setError(null);
            }}
          />
        </div>
        <InspectorRowView row={{ label: labels.createdAt, value: formatDateTimeOrDash(createdAt) }} />
        <InspectorRowView row={{ label: labels.updatedAt, value: formatDateTimeOrDash(updatedAt) }} />
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}

function formatPromptNameWithVersion(promptName: string | null | undefined, versionLabel: string | null | undefined) {
  return [promptName, versionLabel].filter((part): part is string => Boolean(part)).join(' - ');
}

function ReleaseLaneDetailCards({
  tone,
  labels,
  identityRows,
  runtimeEditor,
  metadataCard,
  routeEditor,
}: {
  tone: ReleaseTopologyTone;
  labels: ReturnType<typeof useTopologyLabels>;
  identityRows: InspectorRow[];
  runtimeEditor?: ReactNode;
  metadataCard: ReactNode;
  routeEditor?: ReactNode;
}) {
  return (
    <>
      <div className="mt-4 space-y-3">
        <InspectorRowsCard rows={identityRows} tone={tone} title={labels.laneIdentityTitle} />
        {runtimeEditor}
        {metadataCard}
      </div>
      {routeEditor}
    </>
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
  onUpdateOutputRoute,
  outputRoutePending,
  onUpdateInputRoute,
  inputRoutePending,
  models,
  modelsLoading,
  outputConnectors,
  outputConnectorsLoading,
  onAddCanary,
  onStopCanary,
  onPromoteCanary,
  canaryActionPending,
}: {
  line: ReleaseLineView;
  selectedNodeId: ReleaseTopologyNodeId;
  labels: ReturnType<typeof useTopologyLabels>;
  formatDateTimeOrDash: DateTimeOrDashFormatter;
  onUpdateTrafficRatio?: (canary: CanaryReleaseListItemDto, trafficRatio: number) => Promise<unknown>;
  trafficRatioPending: boolean;
  onUpdateRunConfig?: (input: UpdateReleaseLineRunConfigInputDto) => Promise<unknown>;
  runConfigPending: boolean;
  onUpdateOutputRoute?: (input: UpdateReleaseLineOutputRouteInputDto) => Promise<unknown>;
  outputRoutePending: boolean;
  onUpdateInputRoute?: (input: UpdateReleaseLineInputRouteInputDto) => Promise<unknown>;
  inputRoutePending: boolean;
  models: ProjectModelListItemDto[];
  modelsLoading: boolean;
  outputConnectors: ConnectorListItemDto[];
  outputConnectorsLoading: boolean;
  onAddCanary?: () => void;
  onStopCanary?: (canary: CanaryReleaseListItemDto) => Promise<unknown>;
  onPromoteCanary?: (canary: CanaryReleaseListItemDto) => Promise<unknown>;
  canaryActionPending: boolean;
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
      content: <UpstreamInputFields line={line} labels={labels} />,
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
        <>
          <TrafficRatioControl
            key={`${line.canary?.id ?? 'no-canary'}:${line.canary?.trafficRatio ?? 0}`}
            line={line}
            labels={labels}
            onUpdateTrafficRatio={onUpdateTrafficRatio}
            pending={trafficRatioPending}
          />
        </>
      ),
    };
  }

  if (selectedNodeId === 'output-route') {
    return {
      icon: 'router',
      label: labels.outputRoute,
      tone: 'neutral',
      rows: [],
      hideSummary: true,
      content: (
        <>
          <OutputRouteSummaryCards line={line} outputConnectors={outputConnectors} labels={labels} />
          <OutputRouteControl
            key={`${line.production?.currentEvent?.id ?? 'no-production'}:${line.canary?.id ?? 'no-canary'}`}
            line={line}
            outputConnectors={outputConnectors}
            outputConnectorsLoading={outputConnectorsLoading}
            labels={labels}
            pending={outputRoutePending}
            onUpdateOutputRoute={onUpdateOutputRoute}
          />
        </>
      ),
    };
  }

  if (selectedNodeId === 'production') {
    const event = line.production?.currentEvent ?? null;
    const inputRouteLane = getInputRouteLane(line, labels, 'production');
    const productionCanEditConfig = event?.status === 'running';
    const routeEditor = inputRouteLane ? (
      <InputRouteLaneEditor
        key={`input-route:${inputRouteLane.laneType}:${inputRouteLane.eventId}:${inputRouteLane.updatedAt ?? ''}`}
        lane={inputRouteLane}
        labels={labels}
        pending={inputRoutePending}
        onUpdateInputRoute={onUpdateInputRoute}
      />
    ) : undefined;
    return {
      icon: 'production',
      label: labels.production,
      title: line.productionVersionLabel ?? labels.noProduction,
      subtitle: line.productionModelName ?? labels.noModel,
      tone: event ? 'production' : 'muted',
      rows: [],
      hideSummary: true,
      content: event ? (
        <ReleaseLaneDetailCards
          tone="production"
          labels={labels}
          identityRows={[
            {
              label: labels.model,
              valueNode: (
                <LinkedInspectorValue
                  href={resourceDetailHref('model', event.modelId)}
                  value={line.productionModelName}
                />
              ),
              mono: false,
            },
            {
              label: labels.prompt,
              valueNode: (
                <LinkedInspectorValue
                  href={resourceDetailHref('prompt', event.promptId ?? line.promptId, event.promptVersionId)}
                  value={formatPromptNameWithVersion(line.promptName, line.productionVersionLabel)}
                />
              ),
              mono: false,
            },
          ]}
          runtimeEditor={
            <RuntimeConfigEditor
              key={`production:${event.id}:${event.updatedAt}`}
              laneType="production"
              config={event.runConfig}
              currentModelId={event.modelId}
              currentModelName={line.productionModelName}
              recordMode={event.recordMode}
              models={models}
              modelsLoading={modelsLoading}
              labels={labels}
              canEdit={productionCanEditConfig}
              pending={runConfigPending}
              onUpdateRunConfig={onUpdateRunConfig}
              hideModel
            />
          }
          metadataCard={
            <RecordModeMetadataCard
              key={`production-meta:${event.id}:${event.recordMode}:${event.recordCategories.join('|')}:${event.updatedAt}`}
              laneType="production"
              config={event.runConfig}
              modelId={event.modelId}
              recordMode={event.recordMode}
              recordCategories={event.recordCategories}
              promptVersionSnapshot={event.promptVersionSnapshot}
              createdAt={event.createdAt}
              updatedAt={event.updatedAt}
              labels={labels}
              formatDateTimeOrDash={formatDateTimeOrDash}
              canEdit={productionCanEditConfig}
              pending={runConfigPending}
              onUpdateRunConfig={onUpdateRunConfig}
            />
          }
          routeEditor={routeEditor}
        />
      ) : (
        <InspectorRowsCard className="mt-4" rows={[{ label: labels.status, value: labels.noProduction }]} />
      ),
    };
  }

  if (selectedNodeId === 'canary') {
    const canary = line.canary;
    const canCreateOrReplaceCanary = line.production?.currentEvent?.status === 'running' && Boolean(onAddCanary);
    const canShowAddCanarySlot = !canary && canCreateOrReplaceCanary;
    const canaryCanEditConfig = isAdjustableCanary(canary);
    const inputRouteLane = getInputRouteLane(line, labels, 'canary');
    const routeEditor = inputRouteLane ? (
      <InputRouteLaneEditor
        key={`input-route:${inputRouteLane.laneType}:${inputRouteLane.eventId}:${inputRouteLane.updatedAt ?? ''}`}
        lane={inputRouteLane}
        labels={labels}
        pending={inputRoutePending}
        onUpdateInputRoute={onUpdateInputRoute}
      />
    ) : undefined;
    return {
      icon: canShowAddCanarySlot ? 'addCanary' : canaryTopologyIcon(canary),
      label: labels.canary,
      title: canShowAddCanarySlot ? labels.addCanary : (line.canaryVersionLabel ?? labels.noCanary),
      subtitle: line.canaryModelName ?? labels.readyForCandidate,
      tone: canary ? 'canary' : 'muted',
      rows: [],
      hideSummary: true,
      content: canary ? (
        <ReleaseLaneDetailCards
          tone="canary"
          labels={labels}
          identityRows={[
            {
              label: labels.model,
              valueNode: (
                <LinkedInspectorValue href={resourceDetailHref('model', canary.modelId)} value={line.canaryModelName} />
              ),
              mono: false,
            },
            {
              label: labels.prompt,
              valueNode: (
                <LinkedInspectorValue
                  href={resourceDetailHref('prompt', canary.promptId ?? line.promptId, canary.promptVersionId)}
                  value={formatPromptNameWithVersion(line.promptName, line.canaryVersionLabel)}
                />
              ),
              mono: false,
            },
            {
              label: labels.termination,
              value: formatCanaryStopConditions(canary.runConfig, labels),
              mono: false,
            },
          ]}
          runtimeEditor={
            <RuntimeConfigEditor
              key={`canary:${canary.id}:${canary.updatedAt}`}
              laneType="canary"
              config={canary.runConfig}
              currentModelId={canary.modelId}
              currentModelName={canary.modelName}
              recordMode={canary.recordMode}
              models={models}
              modelsLoading={modelsLoading}
              labels={labels}
              canEdit={canaryCanEditConfig}
              pending={runConfigPending}
              onUpdateRunConfig={onUpdateRunConfig}
              hideModel
            />
          }
          metadataCard={
            <RecordModeMetadataCard
              key={`canary-meta:${canary.id}:${canary.recordMode}:${canary.recordCategories.join('|')}:${canary.updatedAt}`}
              laneType="canary"
              config={canary.runConfig}
              modelId={canary.modelId}
              recordMode={canary.recordMode}
              recordCategories={canary.recordCategories}
              promptVersionSnapshot={readRecord(line.canaryPromptVersionSnapshot) ?? EMPTY_RECORD}
              createdAt={canary.createdAt}
              updatedAt={canary.updatedAt}
              labels={labels}
              formatDateTimeOrDash={formatDateTimeOrDash}
              canEdit={canaryCanEditConfig}
              pending={runConfigPending}
              onUpdateRunConfig={onUpdateRunConfig}
            />
          }
          routeEditor={routeEditor}
        />
      ) : (
        <InspectorRowsCard className="mt-4" rows={[{ label: labels.status, value: labels.noCanary }]} />
      ),
      headerAction:
        canary || canCreateOrReplaceCanary ? (
          <CanaryLaneActions
            canary={canary}
            labels={labels}
            pending={canaryActionPending || trafficRatioPending}
            onAddCanary={canCreateOrReplaceCanary ? onAddCanary : undefined}
            onStopCanary={onStopCanary}
            onPromoteCanary={onPromoteCanary}
          />
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
      {row.valueNode ? (
        <span className={cn('min-w-0', row.mono !== false && 'font-mono')}>{row.valueNode}</span>
      ) : (
        <span className={cn('min-w-0 truncate', row.mono !== false && 'font-mono')} title={toDisplayValue(row.value)}>
          {toDisplayValue(row.value)}
        </span>
      )}
    </div>
  );
}

function InspectorRowsCard({
  rows,
  tone,
  title,
  action,
  className,
}: {
  rows: InspectorRow[];
  tone?: ReleaseTopologyTone;
  title?: string;
  action?: ReactNode;
  className?: string;
}) {
  const token = tone ? TONE_STYLES[tone] : null;
  return (
    <div className={cn('rounded-lg border bg-card', className)} style={token ? { borderColor: token.bd } : undefined}>
      {title || action ? (
        <div className="flex min-h-10 items-center justify-between gap-2 border-b px-3 py-2">
          {title ? <div className="text-[12px] font-semibold">{title}</div> : <span />}
          {action}
        </div>
      ) : null}
      <div className="space-y-2 p-3">
        {rows.map((row, index) => (
          <InspectorRowView key={`${row.label}:${index}`} row={row} />
        ))}
      </div>
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
    <aside className="flex h-[500px] min-h-[360px] max-h-[calc(100vh-180px)] flex-col overflow-hidden bg-background/60 p-4">
      <div className="mb-3 flex min-h-7 shrink-0 items-start justify-between gap-3">
        <h3 className="shrink-0 text-[14px] font-semibold">{labels.inspector}</h3>
        {detail.headerAction}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
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
        {detail.rows.length ? <InspectorRowsCard rows={detail.rows} className="mt-4" /> : null}
        {detail.content}
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
      </div>
    </aside>
  );
}

export function ReleaseTopologyCanvas({
  line,
  models = [],
  modelsLoading = false,
  outputConnectors = [],
  outputConnectorsLoading = false,
  onUpdateTrafficRatio,
  onUpdateRunConfig,
  onUpdateOutputRoute,
  onUpdateInputRoute,
  onAddCanary,
  onStopCanary,
  onPromoteCanary,
  trafficRatioPending = false,
  runConfigPending = false,
  outputRoutePending = false,
  inputRoutePending = false,
  canaryActionPending = false,
}: {
  line: ReleaseLineView;
  models?: ProjectModelListItemDto[];
  modelsLoading?: boolean;
  outputConnectors?: ConnectorListItemDto[];
  outputConnectorsLoading?: boolean;
  onUpdateTrafficRatio?: (canary: CanaryReleaseListItemDto, trafficRatio: number) => Promise<unknown>;
  onUpdateRunConfig?: (input: UpdateReleaseLineRunConfigInputDto) => Promise<unknown>;
  onUpdateOutputRoute?: (input: UpdateReleaseLineOutputRouteInputDto) => Promise<unknown>;
  onUpdateInputRoute?: (input: UpdateReleaseLineInputRouteInputDto) => Promise<unknown>;
  onAddCanary?: () => void;
  onStopCanary?: (canary: CanaryReleaseListItemDto) => Promise<unknown>;
  onPromoteCanary?: (canary: CanaryReleaseListItemDto) => Promise<unknown>;
  trafficRatioPending?: boolean;
  runConfigPending?: boolean;
  outputRoutePending?: boolean;
  inputRoutePending?: boolean;
  canaryActionPending?: boolean;
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
        onUpdateOutputRoute,
        outputRoutePending,
        onUpdateInputRoute,
        inputRoutePending,
        models,
        modelsLoading,
        outputConnectors,
        outputConnectorsLoading,
        onAddCanary,
        onStopCanary,
        onPromoteCanary,
        canaryActionPending,
      }),
    [
      canaryActionPending,
      labels,
      formatDateTimeOrDash,
      line,
      onAddCanary,
      onPromoteCanary,
      onStopCanary,
      onUpdateRunConfig,
      onUpdateTrafficRatio,
      models,
      modelsLoading,
      runConfigPending,
      onUpdateOutputRoute,
      onUpdateInputRoute,
      outputConnectors,
      outputConnectorsLoading,
      outputRoutePending,
      inputRoutePending,
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
            edgeTypes={edgeTypes}
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
