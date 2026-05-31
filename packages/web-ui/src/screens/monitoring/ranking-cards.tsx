'use client';

import { Boxes, FileText } from 'lucide-react';
import type { ModelMonitoringRankingResponseDto, PromptMonitoringRankingResponseDto } from '@proofhound/shared';
import {
  Segmented,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@proofhound/ui';
import type { TableColumn as UiTableColumn } from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../../i18n';
type PromptSortBy = PromptMonitoringRankingResponseDto['sortBy'];
type ModelSortBy = ModelMonitoringRankingResponseDto['sortBy'];

const PROMPT_SORT_LABELS: ReadonlyArray<{ value: PromptSortBy; key: TranslationKey }> = [
  { value: 'requests', key: 'monitoring.ranking.sortBy.requests' },
  { value: 'cost', key: 'monitoring.ranking.sortBy.cost' },
  { value: 'failureRate', key: 'monitoring.ranking.sortBy.failureRate' },
];

const MODEL_SORT_LABELS: ReadonlyArray<{ value: ModelSortBy; key: TranslationKey }> = [
  { value: 'requests', key: 'monitoring.ranking.sortBy.requests' },
  { value: 'tokens', key: 'monitoring.ranking.sortBy.tokens' },
  { value: 'cost', key: 'monitoring.ranking.sortBy.cost' },
];

const PROMPT_COLUMNS: UiTableColumn[] = [
  { key: 'rank', width: 'narrow' },
  { key: 'prompt', width: 'flex', minPx: 240 },
  { key: 'requests', width: 'normal' },
  { key: 'share', width: 'compact' },
  { key: 'cost', width: 'compact' },
  { key: 'quality', width: 'compact' },
];

const MODEL_COLUMNS: UiTableColumn[] = [
  { key: 'rank', width: 'narrow' },
  { key: 'model', width: 'flex', minPx: 240 },
  { key: 'requests', width: 'normal' },
  { key: 'tokens', width: 'compact' },
  { key: 'cost', width: 'compact' },
  { key: 'capacity', width: 'normal' },
];

export function PromptRankingCard({
  data,
  sortBy,
  onSortByChange,
  loading,
  totalPrompts,
  formatRequests,
  formatCost,
}: {
  data: PromptMonitoringRankingResponseDto['items'];
  sortBy: PromptSortBy;
  onSortByChange: (sortBy: PromptSortBy) => void;
  loading: boolean;
  totalPrompts: number;
  formatRequests: (value: number) => string;
  formatCost: (value: number) => string;
}) {
  const { t } = useI18n();
  const topShare = Math.max(0.0001, ...data.map((item) => item.shareRatio));

  return (
    <section className="rounded-lg border bg-card" aria-label={t('monitoring.ranking.prompts.title')}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <FileText className="size-4 text-muted-foreground" />
        <span className="text-[13.5px] font-semibold">{t('monitoring.ranking.prompts.title')}</span>
        <span className="text-[11.5px] text-muted-foreground">
          {t('monitoring.ranking.prompts.suffix').replace('{count}', String(totalPrompts))}
        </span>
        <div className="ml-auto">
          <Segmented
            ariaLabel={t('monitoring.ranking.prompts.title')}
            value={sortBy}
            options={PROMPT_SORT_LABELS.map((option) => ({ value: option.value, label: t(option.key) }))}
            onChange={onSortByChange}
            size="sm"
          />
        </div>
      </div>

      <Table columns={PROMPT_COLUMNS} className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead column="rank">{t('monitoring.ranking.column.rank')}</TableHead>
            <TableHead column="prompt">{t('monitoring.ranking.prompts.column.prompt')}</TableHead>
            <TableHead column="requests" className="text-right">
              {t('monitoring.ranking.models.column.requests')}
            </TableHead>
            <TableHead column="share" className="text-right">
              {t('monitoring.ranking.column.share')}
            </TableHead>
            <TableHead column="cost" className="text-right">
              {t('monitoring.ranking.models.column.cost')}
            </TableHead>
            <TableHead column="quality" className="text-right">
              {t('monitoring.ranking.column.failureRate')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && data.length === 0 ? (
            <TableEmpty>{t('common.loading')}</TableEmpty>
          ) : data.length === 0 ? (
            <TableEmpty>{t('monitoring.empty.title')}</TableEmpty>
          ) : (
            data.map((item, index) => (
              <TableRow key={item.promptId}>
                <TableCell column="rank">
                  <RankPill rank={index + 1} />
                </TableCell>
                <TableCell column="prompt" truncate={2}>
                  <div className="flex min-w-0 items-center gap-2">
                    <PromptLogo name={item.promptName} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold leading-tight">{item.promptName}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {item.latestVersionNumber
                          ? `v${item.latestVersionNumber}`
                          : t('monitoring.ranking.prompts.noVersion')}
                        {' / '}
                        {t('monitoring.ranking.prompts.versionCount').replace('{count}', String(item.versionCount))}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell column="requests" className="text-right">
                  <div className="flex items-center justify-end gap-2 font-mono tabular-nums">
                    <span>{formatRequests(item.requestCount)}</span>
                    <BarMini ratio={item.shareRatio / topShare} />
                  </div>
                </TableCell>
                <TableCell column="share" className="text-right font-mono text-[12px]">
                  {(item.shareRatio * 100).toFixed(1)}%
                </TableCell>
                <TableCell column="cost" className="text-right font-mono text-[12px]">
                  {formatCost(item.costEstimate)}
                </TableCell>
                <TableCell column="quality" className="text-right">
                  <FailureRatePill rate={item.failureRate} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}

export function ProjectModelRankingCard({
  data,
  sortBy,
  onSortByChange,
  loading,
  formatRequests,
  formatTokens,
  formatCost,
}: {
  data: ModelMonitoringRankingResponseDto['items'];
  sortBy: ModelSortBy;
  onSortByChange: (sortBy: ModelSortBy) => void;
  loading: boolean;
  formatRequests: (value: number) => string;
  formatTokens: (value: number) => string;
  formatCost: (value: number) => string;
}) {
  const { t } = useI18n();
  const topRequests = Math.max(0.0001, ...data.map((item) => item.requestCount));

  return (
    <section className="rounded-lg border bg-card" aria-label={t('monitoring.ranking.models.title')}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Boxes className="size-4 text-muted-foreground" />
        <span className="text-[13.5px] font-semibold">{t('monitoring.ranking.models.title')}</span>
        <span className="text-[11.5px] text-muted-foreground">{t('monitoring.ranking.models.suffix')}</span>
        <div className="ml-auto">
          <Segmented
            ariaLabel={t('monitoring.ranking.models.title')}
            value={sortBy}
            options={MODEL_SORT_LABELS.map((option) => ({ value: option.value, label: t(option.key) }))}
            onChange={onSortByChange}
            size="sm"
          />
        </div>
      </div>

      <Table columns={MODEL_COLUMNS} className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead column="rank">{t('monitoring.ranking.column.rank')}</TableHead>
            <TableHead column="model">{t('monitoring.ranking.models.column.model')}</TableHead>
            <TableHead column="requests" className="text-right">
              {t('monitoring.ranking.models.column.requests')}
            </TableHead>
            <TableHead column="tokens" className="text-right">
              {t('monitoring.ranking.models.column.tokens')}
            </TableHead>
            <TableHead column="cost" className="text-right">
              {t('monitoring.ranking.models.column.cost')}
            </TableHead>
            <TableHead column="capacity">{t('monitoring.ranking.models.column.capacity')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && data.length === 0 ? (
            <TableEmpty>{t('common.loading')}</TableEmpty>
          ) : data.length === 0 ? (
            <TableEmpty>{t('monitoring.empty.title')}</TableEmpty>
          ) : (
            data.map((item, index) => (
              <TableRow key={item.modelId}>
                <TableCell column="rank">
                  <RankPill rank={index + 1} />
                </TableCell>
                <TableCell column="model" truncate={2}>
                  <div className="text-[13px] font-semibold leading-tight">{item.modelName}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {item.providerType} / {item.providerModelId}
                  </div>
                </TableCell>
                <TableCell column="requests" className="text-right">
                  <div className="flex items-center justify-end gap-2 font-mono tabular-nums">
                    <span>{formatRequests(item.requestCount)}</span>
                    <BarMini ratio={item.requestCount / topRequests} />
                  </div>
                </TableCell>
                <TableCell column="tokens" className="text-right font-mono text-[12px]">
                  {formatTokens(item.totalTokens)}
                </TableCell>
                <TableCell column="cost" className="text-right font-mono text-[12px]">
                  {formatCost(item.costEstimate)}
                </TableCell>
                <TableCell column="capacity">
                  <CapacityBar
                    ratio={item.capacityUsedRatio}
                    unlimitedLabel={t('monitoring.ranking.models.unlimited')}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="border-t px-4 py-2.5 text-[11.5px] text-muted-foreground">
        {t('monitoring.ranking.models.capacityHint')}
      </div>
    </section>
  );
}

function RankPill({ rank }: { rank: number }) {
  const tone =
    rank === 1
      ? 'bg-[var(--src-prod-soft)] text-[var(--src-prod-fg)]'
      : rank === 2
        ? 'bg-[var(--src-canary-soft)] text-[var(--src-canary-fg)]'
        : rank === 3
          ? 'bg-[var(--src-iter-soft)] text-[var(--src-iter-fg)]'
          : 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex size-[22px] items-center justify-center rounded-md font-mono text-[11px] font-semibold',
        tone,
      )}
    >
      {rank}
    </span>
  );
}

function PromptLogo({ name }: { name: string }) {
  const initials = (name.match(/[A-Z]/g)?.slice(0, 2).join('') ?? name.slice(0, 2)).toUpperCase();
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10.5px] font-semibold text-muted-foreground">
      {initials || '-'}
    </span>
  );
}

function BarMini({ ratio }: { ratio: number }) {
  const width = Math.min(1, Math.max(0, ratio));
  return (
    <span className="inline-flex h-1.5 w-[120px] max-w-[120px] overflow-hidden rounded-full bg-muted">
      <span className="h-full rounded-full bg-primary" style={{ width: `${width * 100}%` }} aria-hidden />
    </span>
  );
}

function FailureRatePill({ rate }: { rate: number }) {
  const tone =
    rate >= 0.05 ? 'bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]' : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold', tone)}>
      {(rate * 100).toFixed(1)}%
    </span>
  );
}

function CapacityBar({ ratio, unlimitedLabel }: { ratio: number | null; unlimitedLabel: string }) {
  if (ratio === null) {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {unlimitedLabel}
      </span>
    );
  }
  const width = Math.min(1, Math.max(0, ratio));
  const tone =
    ratio >= 0.9
      ? { bar: 'bg-[var(--destructive)]', text: 'text-[var(--destructive)]' }
      : ratio >= 0.8
        ? { bar: 'bg-[var(--status-pending-dot)]', text: 'text-[var(--status-pending-fg)]' }
        : { bar: 'bg-primary', text: 'text-muted-foreground' };
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-1.5 w-[120px] max-w-[120px] overflow-hidden rounded-full bg-muted">
        <span className={cn('h-full rounded-full', tone.bar)} style={{ width: `${width * 100}%` }} aria-hidden />
      </span>
      <span className={cn('font-mono text-[11.5px]', tone.text)}>{(ratio * 100).toFixed(0)}%</span>
    </div>
  );
}
