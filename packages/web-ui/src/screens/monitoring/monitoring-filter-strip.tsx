'use client';

import { Clock, Cpu, FileText } from 'lucide-react';
import type { SourceBucket } from '@proofhound/shared';
import { MultiSelect, cn } from '@proofhound/ui';
import type { MultiSelectOption } from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../../i18n';
const SOURCES_ORDER: ReadonlyArray<SourceBucket> = ['prod', 'canary', 'iter', 'exp'];

const SOURCE_I18N: Record<SourceBucket, TranslationKey> = {
  prod: 'monitoring.source.prod',
  canary: 'monitoring.source.canary',
  iter: 'monitoring.source.iter',
  exp: 'monitoring.source.exp',
};

export function MonitoringFilterStrip({
  promptOptions,
  selectedPromptIds,
  onSelectedPromptIdsChange,
  modelOptions,
  selectedModelIds,
  onSelectedModelIdsChange,
  sources,
  onSourcesChange,
  granularityLabel,
}: {
  promptOptions: ReadonlyArray<MultiSelectOption>;
  selectedPromptIds: ReadonlyArray<string>;
  onSelectedPromptIdsChange: (next: string[]) => void;
  modelOptions: ReadonlyArray<MultiSelectOption>;
  selectedModelIds: ReadonlyArray<string>;
  onSelectedModelIdsChange: (next: string[]) => void;
  sources: ReadonlyArray<SourceBucket>;
  onSourcesChange: (next: SourceBucket[]) => void;
  granularityLabel: string;
}) {
  const { t } = useI18n();

  function toggleSource(bucket: SourceBucket) {
    if (sources.includes(bucket)) {
      onSourcesChange(sources.filter((source) => source !== bucket));
      return;
    }

    const next = [...sources, bucket];
    next.sort((a, b) => SOURCES_ORDER.indexOf(a) - SOURCES_ORDER.indexOf(b));
    onSourcesChange(next);
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[12px] font-medium text-muted-foreground">
            {t('monitoring.filter.prompts.label')}
          </span>
          <MultiSelect
            label={t('monitoring.filter.prompts.button')}
            options={promptOptions}
            value={selectedPromptIds}
            onChange={onSelectedPromptIdsChange}
            searchPlaceholder={t('monitoring.filter.prompts.search')}
            footnote={t('monitoring.filter.prompts.footnote')}
            iconAdornment={<FileText className="size-3.5 text-muted-foreground" />}
          />

          <span className="mx-2 h-5 w-px bg-border" aria-hidden />

          <span className="mr-1 text-[12px] font-medium text-muted-foreground">
            {t('monitoring.filter.models.label')}
          </span>
          <MultiSelect
            label={t('monitoring.filter.models.button')}
            options={modelOptions}
            value={selectedModelIds}
            onChange={onSelectedModelIdsChange}
            searchPlaceholder={t('monitoring.filter.models.search')}
            footnote={t('monitoring.filter.models.footnote')}
            iconAdornment={<Cpu className="size-3.5 text-muted-foreground" />}
          />

          <span className="mx-2 h-5 w-px bg-border" aria-hidden />

          <span className="mr-1 text-[12px] font-medium text-muted-foreground">
            {t('monitoring.filter.sources.label')}
          </span>
          {SOURCES_ORDER.map((source) => (
            <SourceChip
              key={source}
              source={source}
              active={sources.includes(source)}
              label={t(SOURCE_I18N[source])}
              onClick={() => toggleSource(source)}
            />
          ))}
        </div>

        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <Clock className="size-3.5" />
          {t('monitoring.filter.granularityHint').replace('{granularity}', granularityLabel)}
        </span>
      </div>
    </div>
  );
}

function SourceChip({
  source,
  active,
  label,
  onClick,
}: {
  source: SourceBucket;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium leading-[18px] transition-colors',
        active
          ? 'text-white'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      style={
        active
          ? {
              background: `var(--src-${source})`,
              borderColor: `var(--src-${source})`,
            }
          : undefined
      }
    >
      <span
        className="size-2 rounded-full"
        style={{ background: active ? 'white' : `var(--src-${source})` }}
        aria-hidden
      />
      {label}
    </button>
  );
}
