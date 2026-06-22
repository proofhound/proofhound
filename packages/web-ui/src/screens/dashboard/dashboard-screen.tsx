'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useMemo, useState } from 'react';
import type {
  ExperimentListItemDto,
  OptimizationListItemDto,
  OptimizationStatusDto,
} from '@proofhound/shared';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ChevronDown,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Plug,
  Plus,
  RefreshCcw,
  Rocket,
} from 'lucide-react';
import { Main } from '@proofhound/ui/layout';
import { PlatformLoaderOverlay, Skeleton, cn } from '@proofhound/ui';
import { useConnectors } from '../../hooks';
import { useDatasets } from '../../hooks';
import { useExperiments } from '../../hooks';
import { useProjectModels } from '../../hooks';
import { useOptimizations } from '../../hooks';
import { usePrompts } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useReleaseLineList } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import type { ReleaseLineView } from '../../lib';
import { normalizeExperimentStatus, type ExperimentStatus } from '../experiments/experiment-view-model';

const DEFAULT_VISIBLE_FEED_ITEMS = 10;
const EMPTY_LIST: never[] = [];

type FeedTabKey = 'all' | 'todo' | 'experiments' | 'autoIterations' | 'releases';
type FeedKind = 'experiment' | 'auto_iteration' | 'release';
type FeedStatus = 'pending' | 'running' | 'success' | 'failed';
type FeedTone = 'pending' | 'running';
type FeedResourceKind = 'prompt' | 'dataset' | 'model' | 'connector';
type SummaryKey = 'prompts' | 'datasets' | 'models' | 'connectors' | 'releases';

type FeedResource = {
  kind: FeedResourceKind;
  href: string;
  label: string;
  detail?: string;
};

type FeedMetric = {
  label: string;
  value: string;
  highlight?: boolean;
};

type FeedItem = {
  id: string;
  kind: FeedKind;
  title: string;
  href: string;
  description?: string;
  resources?: FeedResource[];
  metrics?: FeedMetric[];
  progress?: {
    value: number;
    label: string;
  };
  status: FeedStatus;
  eventType?: string;
  occurredAt: string | null;
  tone?: FeedTone;
};

type SummaryItem = {
  key: SummaryKey;
  href: string;
  createHref: string;
  count: number;
  detail: string;
};

const FEED_TAB_KEYS: FeedTabKey[] = ['all', 'todo', 'experiments', 'autoIterations', 'releases'];

const FEED_TAB_LABEL_KEYS: Record<FeedTabKey, TranslationKey> = {
  all: 'projectOverview.tabs.all',
  todo: 'projectOverview.tabs.todo',
  experiments: 'projectOverview.tabs.experiments',
  autoIterations: 'projectOverview.tabs.autoIterations',
  releases: 'projectOverview.tabs.releases',
};

const FEED_KIND_ICONS: Record<FeedKind, LucideIcon> = {
  experiment: FlaskConical,
  auto_iteration: RefreshCcw,
  release: Rocket,
};

const RESOURCE_ICONS: Record<FeedResourceKind, LucideIcon> = {
  prompt: FileText,
  dataset: Database,
  model: Cpu,
  connector: Plug,
};

const SUMMARY_ICONS: Record<SummaryKey, LucideIcon> = {
  prompts: FileText,
  datasets: Database,
  models: Cpu,
  connectors: Plug,
  releases: Rocket,
};

const SUMMARY_LABEL_KEYS: Record<SummaryKey, TranslationKey> = {
  prompts: 'nav.prompts',
  datasets: 'nav.datasets',
  models: 'nav.models',
  connectors: 'nav.connectors',
  releases: 'nav.releases',
};

const EXPERIMENT_STATUS_KEYS: Record<ExperimentStatus, TranslationKey> = {
  running: 'experiments.status.running',
  success: 'experiments.status.success',
  failed: 'experiments.status.failed',
  stopped: 'experiments.status.stopped',
};

const OPTIMIZATION_STATUS_KEYS: Record<OptimizationStatusDto, TranslationKey> = {
  running: 'optimizations.status.running',
  success: 'optimizations.status.success',
  failed: 'optimizations.status.failed',
  stopped: 'optimizations.status.stopped',
  cancelled: 'optimizations.status.cancelled',
};

const METRIC_LABEL_KEYS: Record<string, TranslationKey> = {
  accuracy: 'projectOverview.metric.accuracy',
  precision: 'projectOverview.metric.precision',
  recall: 'projectOverview.metric.recall',
  f1: 'projectOverview.metric.f1',
  fpr: 'projectOverview.metric.fpr',
};

const STATUS_CONFIG: Record<
  FeedStatus,
  {
    labelKey: TranslationKey;
    className: string;
    dotClassName?: string;
  }
> = {
  pending: {
    labelKey: 'projectOverview.status.pending',
    className: 'status-pending',
  },
  running: {
    labelKey: 'projectOverview.status.running',
    className: 'status-canary',
    dotClassName: 'dot-canary',
  },
  success: {
    labelKey: 'projectOverview.status.success',
    className: 'status-running',
    dotClassName: 'dot-running',
  },
  failed: {
    labelKey: 'projectOverview.status.failed',
    className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
    dotClassName: 'bg-red-500',
  },
};

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((current, [key, value]) => current.replace(`{${key}}`, String(value)), template);
}

function timestamp(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortFeedItems(items: FeedItem[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const priorityDelta = getFeedPriority(left.item) - getFeedPriority(right.item);
      if (priorityDelta !== 0) return priorityDelta;

      const timeDelta = timestamp(right.item.occurredAt) - timestamp(left.item.occurredAt);
      if (timeDelta !== 0) return timeDelta;

      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function getFeedPriority(item: FeedItem) {
  if (item.status === 'pending') return 0;
  if (item.status === 'running') return 1;
  return 2;
}

function matchesFeedTab(tabKey: FeedTabKey, item: FeedItem) {
  switch (tabKey) {
    case 'all':
      return true;
    case 'todo':
      return item.status === 'pending' || item.status === 'running';
    case 'experiments':
      return item.kind === 'experiment';
    case 'autoIterations':
      return item.kind === 'auto_iteration';
    case 'releases':
      return item.kind === 'release';
    default:
      return true;
  }
}

function workFeedStatus(status: ExperimentStatus | OptimizationStatusDto): FeedStatus {
  if (status === 'running') return 'running';
  if (status === 'success') return 'success';
  return 'failed';
}

function workFeedTone(status: ExperimentStatus | OptimizationStatusDto): FeedTone | undefined {
  return status === 'running' ? 'running' : undefined;
}

function releaseFeedStatus(line: ReleaseLineView): FeedStatus {
  if (hasRunningCanary(line)) return 'running';
  if (line.status === 'stopped') return 'failed';
  return 'success';
}

function releaseFeedTone(line: ReleaseLineView): FeedTone | undefined {
  return hasRunningCanary(line) ? 'running' : undefined;
}

function hasRunningCanary(line: ReleaseLineView) {
  return line.canary?.status === 'running';
}

function progressPercent(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function formatMetricValue(value: number | null | undefined) {
  if (typeof value !== 'number') return null;
  return `${(value * 100).toFixed(value >= 0.995 ? 0 : 1)}%`;
}

function buildExperimentMetrics(experiment: ExperimentListItemDto, t: (key: TranslationKey) => string): FeedMetric[] {
  if (!experiment.metrics) return [];

  const metrics = [
    { label: t('projectOverview.metric.accuracy'), value: formatMetricValue(experiment.metrics.accuracy) },
    { label: t('projectOverview.metric.precision'), value: formatMetricValue(experiment.metrics.precision) },
    { label: t('projectOverview.metric.recall'), value: formatMetricValue(experiment.metrics.recall) },
    { label: t('projectOverview.metric.f1'), value: formatMetricValue(experiment.metrics.f1), highlight: true },
  ];

  return metrics.filter((metric): metric is FeedMetric => metric.value !== null).slice(0, 4);
}

function buildOptimizationMetrics(
  optimization: OptimizationListItemDto,
  t: (key: TranslationKey) => string,
): FeedMetric[] {
  const firstGoal = optimization.goals[0];
  if (!firstGoal) return [];

  const value = optimization.bestMetrics?.[firstGoal.metric];
  const formatted = formatMetricValue(value);
  if (!formatted) return [];

  return [
    {
      label: t(METRIC_LABEL_KEYS[firstGoal.metric] ?? 'projectOverview.metric.best'),
      value: formatted,
      highlight: true,
    },
  ];
}

function buildFeedItems({
  experiments,
  optimizations,
  releaseLines,
  t,
}: {
  experiments: ExperimentListItemDto[];
  optimizations: OptimizationListItemDto[];
  releaseLines: ReleaseLineView[];
  t: (key: TranslationKey) => string;
}) {
  const experimentItems: FeedItem[] = experiments.map((experiment) => {
    const percent = progressPercent(experiment.processedSamples, Math.max(experiment.totalSamples, 1));
    const experimentStatus = normalizeExperimentStatus(experiment.status);

    return {
      id: `experiment-${experiment.id}`,
      kind: 'experiment',
      title: experiment.name,
      href: `/experiments/${experiment.id}`,
      description: interpolate(t('projectOverview.feed.experimentDescription'), {
        prompt: experiment.promptName,
        version: experiment.promptVersionNumber,
        dataset: experiment.datasetName,
      }),
      resources: [
        {
          kind: 'prompt',
          href: `/prompts/${experiment.promptId}`,
          label: experiment.promptName,
          detail: `v${experiment.promptVersionNumber}`,
        },
        {
          kind: 'dataset',
          href: `/datasets/${experiment.datasetId}`,
          label: experiment.datasetName,
          detail: interpolate(t('projectOverview.resource.samples'), {
            count: formatNumber(experiment.datasetSamples),
          }),
        },
        {
          kind: 'model',
          href: `/models/${experiment.modelId}`,
          label: experiment.modelName,
          detail: experiment.modelVariant,
        },
      ],
      metrics: experimentStatus === 'running' ? undefined : buildExperimentMetrics(experiment, t),
      progress:
        experimentStatus === 'running'
          ? {
              value: percent,
              label: interpolate(t('projectOverview.feed.progress'), {
                percent,
                done: formatNumber(experiment.processedSamples),
                total: formatNumber(experiment.totalSamples),
              }),
            }
          : undefined,
      status: workFeedStatus(experimentStatus),
      eventType: t(EXPERIMENT_STATUS_KEYS[experimentStatus]),
      occurredAt: experiment.finishedAt ?? experiment.updatedAt,
      tone: workFeedTone(experimentStatus),
    };
  });

  const optimizationItems: FeedItem[] = optimizations.map((optimization) => {
    const percent = progressPercent(optimization.currentRound, Math.max(optimization.maxRounds, 1));

    return {
      id: `optimization-${optimization.id}`,
      kind: 'auto_iteration',
      title: optimization.name,
      href: `/optimizations/${optimization.id}`,
      description: optimization.description ?? optimization.summary?.reason ?? optimization.strategy,
      resources: [
        ...(optimization.promptId && optimization.promptName
          ? [
              {
                kind: 'prompt' as const,
                href: `/prompts/${optimization.promptId}`,
                label: optimization.promptName,
                detail: optimization.baseVersionNumber ? `v${optimization.baseVersionNumber}` : undefined,
              },
            ]
          : []),
        {
          kind: 'dataset',
          href: `/datasets/${optimization.datasetId}`,
          label: optimization.datasetName,
          detail: interpolate(t('projectOverview.resource.samples'), {
            count: formatNumber(optimization.datasetSamples),
          }),
        },
        {
          kind: 'model',
          href: `/models/${optimization.experimentModelId}`,
          label: optimization.experimentModelName,
          detail: optimization.strategy,
        },
      ],
      metrics: optimization.status === 'running' ? undefined : buildOptimizationMetrics(optimization, t),
      progress:
        optimization.status === 'running'
          ? {
              value: percent,
              label: interpolate(t('projectOverview.feed.roundProgress'), {
                current: optimization.currentRound,
                total: optimization.maxRounds,
              }),
            }
          : undefined,
      status: workFeedStatus(optimization.status),
      eventType: t(OPTIMIZATION_STATUS_KEYS[optimization.status]),
      occurredAt: optimization.finishedAt ?? optimization.updatedAt,
      tone: workFeedTone(optimization.status),
    };
  });

  const releaseItems: FeedItem[] = releaseLines.map((line) => {
    const isCanary = hasRunningCanary(line);

    return {
      id: `release-${line.id}`,
      kind: 'release',
      title: line.label,
      href: `/releases/${line.id}`,
      description: line.inputConnectorName
        ? interpolate(t('projectOverview.feed.releaseDescriptionWithConnector'), {
            prompt: line.promptName,
            connector: line.inputConnectorName,
          })
        : interpolate(t('projectOverview.feed.releaseDescription'), { prompt: line.promptName }),
      resources: [
        ...(line.promptId
          ? [
              {
                kind: 'prompt' as const,
                href: `/prompts/${line.promptId}`,
                label: line.promptName,
                detail: line.productionVersionLabel ?? line.canaryVersionLabel ?? undefined,
              },
            ]
          : []),
        ...(line.inputConnectorId && line.inputConnectorName
          ? [
              {
                kind: 'connector' as const,
                href: `/connectors/${line.inputConnectorId}`,
                label: line.inputConnectorName,
                detail: line.inputConnectorType ?? undefined,
              },
            ]
          : []),
      ],
      metrics: [
        {
          label: t('projectOverview.metric.versions'),
          value: formatNumber(line.versions.length),
          highlight: isCanary,
        },
        ...(line.outputConnectors.length > 0
          ? [
              {
                label: t('projectOverview.metric.outputs'),
                value: formatNumber(line.outputConnectors.length),
              },
            ]
          : []),
      ],
      status: releaseFeedStatus(line),
      eventType: t('projectOverview.event.release'),
      occurredAt: line.updatedAt ?? line.createdAt,
      tone: releaseFeedTone(line),
    };
  });

  return sortFeedItems([...experimentItems, ...optimizationItems, ...releaseItems]);
}

function FeedStatusBadge({ status }: { status: FeedStatus }) {
  const { t } = useI18n();
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium',
        config.className,
      )}
    >
      {config.dotClassName && <span className={cn('size-1 rounded-full', config.dotClassName)} />}
      {t(config.labelKey)}
    </span>
  );
}

function FeedResourceLink({ resource }: { resource: FeedResource }) {
  const { t } = useI18n();
  const Icon = RESOURCE_ICONS[resource.kind];

  return (
    <Link
      href={resource.href}
      className="overview-res-link inline-flex min-w-0 items-center gap-1"
      aria-label={t('projectOverview.openResource')}
      onClick={(event) => event.stopPropagation()}
    >
      <Icon className="size-2.5 shrink-0" />
      <span className="truncate">{resource.label}</span>
      {resource.detail && <span className="shrink-0 text-muted-foreground">· {resource.detail}</span>}
    </Link>
  );
}

function FeedResources({ resources }: { resources: FeedResource[] }) {
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2.5 font-mono text-xs">
      {resources.map((resource, index) => (
        <div key={`${resource.kind}-${resource.href}-${resource.label}`} className="flex min-w-0 items-center gap-2.5">
          {index > 0 && <span className="size-1 shrink-0 rounded-full bg-muted-foreground opacity-40" />}
          <FeedResourceLink resource={resource} />
        </div>
      ))}
    </div>
  );
}

function FeedMetrics({ metrics }: { metrics: FeedMetric[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-xs">
      {metrics.map((metric) => (
        <span key={`${metric.label}-${metric.value}`} className="text-muted-foreground">
          {metric.label}{' '}
          <span className={cn('font-medium text-foreground', metric.highlight && 'text-[var(--status-running-fg)]')}>
            {metric.value}
          </span>
        </span>
      ))}
    </div>
  );
}

function ActivityFeed({
  items,
  visibleLimit,
  onLoadMore,
}: {
  items: FeedItem[];
  visibleLimit: number;
  onLoadMore: () => void;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<FeedTabKey>('all');
  const renderedTabs = useMemo(
    () =>
      FEED_TAB_KEYS.map((key) => ({
        key,
        count: items.filter((item) => matchesFeedTab(key, item)).length,
      })),
    [items],
  );
  const filteredItems = useMemo(() => items.filter((item) => matchesFeedTab(activeTab, item)), [activeTab, items]);
  const visibleItems = filteredItems.slice(0, visibleLimit);
  const hasMoreItems = filteredItems.length > visibleItems.length;

  return (
    <section
      className="overview-activity-card flex flex-col overflow-hidden rounded-md border bg-card xl:h-[780px]"
      data-testid="dashboard-events"
    >
      <div className="flex items-center gap-1 overflow-x-auto border-b px-4 py-3">
        {renderedTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={activeTab === tab.key}
            className={cn('overview-tab-pill', activeTab === tab.key && 'active')}
            onClick={() => setActiveTab(tab.key)}
          >
            {t(FEED_TAB_LABEL_KEYS[tab.key])} <span className="cnt">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="overview-feed-list">
        <div className="divide-y">
          {visibleItems.map((item) => {
            const Icon = FEED_KIND_ICONS[item.kind];

            return (
              <div
                key={item.id}
                role="link"
                tabIndex={0}
                aria-label={item.title}
                data-testid="overview-feed-row"
                className={cn(
                  'overview-feed-row block px-5 py-4 focus-visible:outline-none',
                  item.tone === 'pending' && 'overview-row-pending pl-[calc(1.25rem+3px)]',
                  item.tone === 'running' && 'overview-row-running pl-[calc(1.25rem+3px)]',
                )}
                onClick={() => router.push(item.href)}
                onKeyDown={(event) => {
                  if (event.currentTarget !== event.target) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    router.push(item.href);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-medium">{item.title}</span>
                      <FeedStatusBadge status={item.status} />
                      {item.eventType && (
                        <span className="font-mono text-xs text-muted-foreground">{item.eventType}</span>
                      )}
                    </div>
                    {item.description && <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>}
                    {item.resources && item.resources.length > 0 && <FeedResources resources={item.resources} />}
                    {item.progress && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                        <div className="overview-progress h-1.5 w-44">
                          <i style={{ width: `${item.progress.value}%` }} />
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">{item.progress.label}</span>
                      </div>
                    )}
                    {item.metrics && item.metrics.length > 0 && <FeedMetrics metrics={item.metrics} />}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[12px] text-muted-foreground">
                      {formatDateTime(item.occurredAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {visibleItems.length === 0 && (
            <div className="flex flex-col items-center justify-center px-5 py-16 text-center text-muted-foreground">
              <AlertCircle className="mb-3 size-7" />
              <div className="text-sm">{t('projectOverview.feed.empty')}</div>
            </div>
          )}
          {hasMoreItems && (
            <div className="px-5 py-3.5 text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground transition hover:text-foreground disabled:cursor-default disabled:opacity-70 disabled:hover:text-muted-foreground"
                onClick={onLoadMore}
              >
                {t('projectOverview.feed.loadOlder')}
                <ChevronDown className="ml-1 inline size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryRow({ item }: { item: SummaryItem }) {
  const { t } = useI18n();
  const Icon = SUMMARY_ICONS[item.key];
  const label = t(SUMMARY_LABEL_KEYS[item.key]);
  const shouldHighlight = item.count === 0;

  return (
    <li className="flex items-center gap-3 px-5 py-3 transition hover:bg-muted/40">
      <Link
        href={item.href}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          shouldHighlight ? 'status-pending' : 'bg-muted text-primary',
        )}
        aria-label={label}
      >
        <Icon className="size-3.5" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href={item.href} className="truncate text-sm font-medium hover:text-primary">
            {label}
          </Link>
          <Link
            href={item.createHref}
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded border text-muted-foreground transition hover:bg-muted hover:text-foreground',
              shouldHighlight &&
                'status-pending hover:bg-[var(--status-pending-bg)] hover:text-[var(--status-pending-fg)]',
            )}
            aria-label={`${t('projectOverview.summary.create')} ${label}`}
          >
            <Plus className="size-3" />
          </Link>
        </div>
        {item.detail && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{item.detail}</div>
        )}
      </div>
      <Link
        href={item.href}
        className={cn('text-lg font-semibold tabular-nums', shouldHighlight && 'text-[var(--status-pending-fg)]')}
      >
        {formatNumber(item.count)}
      </Link>
    </li>
  );
}

function ResourceSummary({ items }: { items: SummaryItem[] }) {
  const { t } = useI18n();

  return (
    <section className="rounded-md border bg-card" data-testid="dashboard-asset-summary">
      <header className="border-b px-5 pb-3 pt-4">
        <h2 className="text-sm font-semibold">{t('projectOverview.summary.title')}</h2>
      </header>
      <ul className="divide-y">
        {items.map((item) => (
          <SummaryRow key={item.key} item={item} />
        ))}
      </ul>
    </section>
  );
}

function QuickActions() {
  const { t } = useI18n();
  const actions = [
    { href: '/prompts/new', labelKey: 'projectOverview.actions.newPrompt', icon: FileText },
    { href: '/experiments/new', labelKey: 'projectOverview.actions.newExperiment', icon: FlaskConical },
    { href: '/optimizations/new', labelKey: 'projectOverview.actions.newOptimization', icon: RefreshCcw },
    { href: '/releases/new', labelKey: 'projectOverview.actions.newRelease', icon: Rocket },
  ] satisfies Array<{ href: string; labelKey: TranslationKey; icon: LucideIcon }>;

  return (
    <section className="rounded-md border bg-card">
      <header className="border-b px-5 pb-3 pt-4">
        <h2 className="text-sm font-semibold">{t('projectOverview.actions.title')}</h2>
      </header>
      <div className="grid gap-2 p-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition hover:bg-muted/60"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                <Icon className="size-3.5" />
              </span>
              <span className="font-medium">{t(action.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export type DashboardScreenProps = {
  projectId: string;
};

export function DashboardScreen({ projectId }: DashboardScreenProps) {
  const { t } = useI18n();
  const [visibleLimit, setVisibleLimit] = useState(DEFAULT_VISIBLE_FEED_ITEMS);

  const promptsQuery = usePrompts(projectId);
  const datasetsQuery = useDatasets(projectId);
  const modelsQuery = useProjectModels(projectId, { autoRefresh: false });
  const connectorsQuery = useConnectors(projectId);
  const experimentsQuery = useExperiments(projectId, { sort: 'updated' });
  const optimizationsQuery = useOptimizations(projectId, { sort: 'updated' });
  const releaseLineQuery = useReleaseLineList(projectId);

  const prompts = promptsQuery.data?.data ?? EMPTY_LIST;
  const datasets = datasetsQuery.data?.data ?? EMPTY_LIST;
  const models = modelsQuery.data?.data ?? EMPTY_LIST;
  const connectors = connectorsQuery.data?.data ?? EMPTY_LIST;
  const releaseLines = releaseLineQuery.data;
  const experiments = experimentsQuery.data?.data ?? EMPTY_LIST;
  const optimizations = optimizationsQuery.data?.data ?? EMPTY_LIST;

  const hasAnyData =
    Boolean(promptsQuery.data) ||
    Boolean(datasetsQuery.data) ||
    Boolean(modelsQuery.data) ||
    Boolean(connectorsQuery.data) ||
    Boolean(experimentsQuery.data) ||
    Boolean(optimizationsQuery.data) ||
    releaseLines.length > 0;
  const isInitialLoading = useDelayedLoading(
    !hasAnyData &&
      (promptsQuery.isLoading ||
        datasetsQuery.isLoading ||
        modelsQuery.isLoading ||
        connectorsQuery.isLoading ||
        experimentsQuery.isLoading ||
        optimizationsQuery.isLoading ||
        releaseLineQuery.isLoading),
  );
  const hasError =
    promptsQuery.isError ||
    datasetsQuery.isError ||
    modelsQuery.isError ||
    connectorsQuery.isError ||
    experimentsQuery.isError ||
    optimizationsQuery.isError ||
    releaseLineQuery.isError;

  const summaryItems = useMemo<SummaryItem[]>(() => {
    const onlinePrompts = prompts.filter((prompt) => prompt.currentOnlineVersionNumber !== null).length;
    const canaryPrompts = prompts.filter((prompt) => prompt.currentCanaryVersionNumber !== null).length;
    const datasetSamples = datasets.reduce((total, dataset) => total + dataset.sampleCount, 0);
    const imageModels = models.filter((model) => model.capabilities.image !== 'none').length;
    const textModels = Math.max(models.length - imageModels, 0);
    const inputConnectors = connectors.filter((connector) => connector.direction === 'input').length;
    const outputConnectors = connectors.filter((connector) => connector.direction === 'output').length;
    const activeReleaseLines = releaseLines.filter((line) => line.status !== 'stopped').length;

    return [
      {
        key: 'prompts',
        href: '/prompts',
        createHref: '/prompts/new',
        count: promptsQuery.data?.total ?? prompts.length,
        detail: interpolate(t('projectOverview.summary.promptsDetail'), {
          online: onlinePrompts,
          canary: canaryPrompts,
        }),
      },
      {
        key: 'datasets',
        href: '/datasets',
        createHref: '/datasets/new',
        count: datasetsQuery.data?.total ?? datasets.length,
        detail: interpolate(t('projectOverview.summary.datasetsDetail'), { samples: formatNumber(datasetSamples) }),
      },
      {
        key: 'models',
        href: '/models',
        createHref: '/models/new',
        count: modelsQuery.data?.total ?? models.length,
        detail: interpolate(t('projectOverview.summary.modelsDetail'), { text: textModels, image: imageModels }),
      },
      {
        key: 'connectors',
        href: '/connectors',
        createHref: '/connectors/new',
        count: connectorsQuery.data?.total ?? connectors.length,
        detail: interpolate(t('projectOverview.summary.connectorsDetail'), {
          input: inputConnectors,
          output: outputConnectors,
        }),
      },
      {
        key: 'releases',
        href: '/releases',
        createHref: '/releases/new',
        count: releaseLines.length,
        detail: interpolate(t('projectOverview.summary.releasesDetail'), { active: activeReleaseLines }),
      },
    ];
  }, [
    connectors,
    connectorsQuery.data?.total,
    datasets,
    datasetsQuery.data?.total,
    models,
    modelsQuery.data?.total,
    prompts,
    promptsQuery.data?.total,
    releaseLines,
    t,
  ]);

  const feedItems = useMemo(
    () => buildFeedItems({ experiments, optimizations, releaseLines, t }),
    [experiments, optimizations, releaseLines, t],
  );

  return (
    <Main className="gap-0 p-0">
      <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8" data-testid="dashboard-page">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[26px] font-semibold tracking-tight">{t('nav.defaultProject')}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="font-mono text-[12px]">{projectId.slice(0, 8)}</span>
              <span className="size-1 rounded-full bg-current opacity-40" />
              <span>{t('projectOverview.singleWorkspace')}</span>
              <span className="size-1 rounded-full bg-current opacity-40" />
              <span>{t('dashboard.subtitle')}</span>
            </div>
          </div>
        </div>

        {hasError ? (
          <div className="mb-4 rounded-md border bg-card px-4 py-3 text-sm text-destructive">
            {t('dashboard.error.partial')}
          </div>
        ) : null}

        {isInitialLoading ? (
          <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Skeleton className="h-[680px]" />
            <div className="space-y-6">
              <Skeleton className="h-[280px]" />
              <Skeleton className="h-[240px]" />
            </div>
            <PlatformLoaderOverlay />
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <ActivityFeed
                items={feedItems}
                visibleLimit={visibleLimit}
                onLoadMore={() => setVisibleLimit((currentLimit) => currentLimit + DEFAULT_VISIBLE_FEED_ITEMS)}
              />
            </div>
            <aside className="space-y-6" data-testid="overview-side-rail">
              <ResourceSummary items={summaryItems} />
              <QuickActions />
            </aside>
          </div>
        )}
      </div>
    </Main>
  );
}
