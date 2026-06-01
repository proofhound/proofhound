'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AnnotationReleaseVariantOptionDto, AnnotationTaskScopeDto } from '@proofhound/shared';
import { ClipboardCheck, Database, GitBranch, RadioTower } from 'lucide-react';
import { Main } from '@proofhound/ui/layout';
import {
  Button,
  Input,
  Label,
  DetailPageSkeleton,
  Segmented,
  cn,
} from '@proofhound/ui';
import { useAnnotationTaskOptions, useCreateAnnotationTask } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import { formatCount } from './annotation-ui';

function buildDefaultTaskName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `annotation-${yyyy}${mm}${dd}`;
}

export function AnnotationNewPage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const optionsQuery = useAnnotationTaskOptions(projectId);
  const createMutation = useCreateAnnotationTask(projectId);
  const requestedReleaseLineId = searchParams.get('line') ?? '';
  const requestedReleaseVariantId = searchParams.get('variant') ?? '';
  const releaseLines = useMemo(() => optionsQuery.data?.data ?? [], [optionsQuery.data]);
  const [explicitLineId, setExplicitLineId] = useState('');
  const [explicitVariantId, setExplicitVariantId] = useState('');
  const [scope, setScope] = useState<AnnotationTaskScopeDto>('canary');
  const [taskName, setTaskName] = useState(buildDefaultTaskName);
  const [sampleSizeDraft, setSampleSizeDraft] = useState<string | null>(null);

  const selectedLineId = useMemo(() => {
    if (explicitLineId && releaseLines.some((line) => line.id === explicitLineId)) return explicitLineId;
    const requested = releaseLines.find((line) => line.id === requestedReleaseLineId);
    const requestedByVariant = releaseLines.find((line) =>
      line.variants.some((variant) => variant.id === requestedReleaseVariantId),
    );
    return (requested ?? requestedByVariant ?? releaseLines[0])?.id ?? '';
  }, [explicitLineId, releaseLines, requestedReleaseLineId, requestedReleaseVariantId]);
  const selectedLine = useMemo(
    () => releaseLines.find((line) => line.id === selectedLineId) ?? null,
    [releaseLines, selectedLineId],
  );
  const selectedVariantId = useMemo(() => {
    if (!selectedLine) return '';
    if (explicitVariantId && selectedLine.variants.some((variant) => variant.id === explicitVariantId)) {
      return explicitVariantId;
    }
    if (requestedReleaseVariantId && selectedLine.variants.some((variant) => variant.id === requestedReleaseVariantId)) {
      return requestedReleaseVariantId;
    }
    return selectedLine.variants[0]?.id ?? '';
  }, [explicitVariantId, requestedReleaseVariantId, selectedLine]);
  const selectedVariant = useMemo(
    () => selectedLine?.variants.find((variant) => variant.id === selectedVariantId) ?? null,
    [selectedLine, selectedVariantId],
  );
  const maxSamples = selectedVariant ? getMaxSamples(selectedVariant, scope) : 0;
  const sampleSize = sampleSizeDraft ?? (maxSamples > 0 ? String(maxSamples) : '');
  const parsedSampleSize = Number(sampleSize);
  const normalizedSampleSize =
    Number.isFinite(parsedSampleSize) && parsedSampleSize > 0 ? Math.trunc(parsedSampleSize) : 0;
  const canCreate =
    Boolean(selectedLine && selectedVariant && taskName.trim()) &&
    Boolean(selectedVariant && selectedVariant.categoryOptions.length > 0) &&
    normalizedSampleSize >= 1 &&
    normalizedSampleSize <= maxSamples &&
    !createMutation.isPending;
  const submitHint =
    selectedVariant && selectedVariant.categoryOptions.length === 0
      ? t('annotations.new.categoryOptionsRequired')
      : canCreate
        ? t('annotations.new.submitReady')
        : t('annotations.new.submitDisabled');

  function submit() {
    if (!selectedLine || !selectedVariant || !canCreate) return;
    createMutation.mutate(
      {
        name: taskName.trim(),
        releaseLineId: selectedLine.id,
        releaseVariantId: selectedVariant.id,
        scope,
        sampleSize: normalizedSampleSize,
      },
      {
        onSuccess: (task) => {
          router.push(`/annotations/${encodeURIComponent(task.id)}`);
        },
      },
    );
  }

  const optionsLoading = useDelayedLoading(optionsQuery.isLoading && !optionsQuery.data);
  if (optionsLoading) {
    return (
      <Main fixed className="bg-muted/35">
        <div className="mx-auto w-full max-w-[1280px]" data-testid="annotation-new-page">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  return (
    <Main fixed className="gap-5 overflow-auto bg-muted/35 pb-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5" data-testid="annotation-new-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-tight">{t('annotations.new.title')}</h1>
            <p className="mt-1 max-w-3xl text-[12.5px] text-muted-foreground">{t('annotations.new.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/annotations">{t('common.cancel')}</Link>
            </Button>
            <Button data-testid="annotation-new-submit" onClick={submit} disabled={!canCreate}>
              <ClipboardCheck className="size-4" />
              {createMutation.isPending ? t('annotations.new.action.creating') : t('annotations.new.action.create')}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="rounded-lg border bg-card">
              <SectionHeader
                icon={<RadioTower className="size-3" />}
                title={t('annotations.new.section.release')}
                detail={t('annotations.new.section.releaseDetail')}
              />
              <div className="space-y-4 p-5">
                {releaseLines.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-muted/35 p-6 text-center text-sm text-muted-foreground">
                    {t('annotations.new.emptyRelease')}
                  </div>
                ) : (
                  <select
                    data-testid="annotation-new-release-line-select"
                    value={selectedLineId}
                    onChange={(event) => {
                      setExplicitLineId(event.target.value);
                      setExplicitVariantId('');
                      setSampleSizeDraft(null);
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {releaseLines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <SectionHeader
                icon={<GitBranch className="size-3" />}
                title={t('annotations.new.section.variant')}
                detail={t('annotations.new.section.variantDetail')}
              />
              <div className="p-5">
                {!selectedLine ? (
                  <div className="rounded-md border border-dashed bg-muted/35 p-6 text-center text-sm text-muted-foreground">
                    {t('annotations.new.selectReleaseFirst')}
                  </div>
                ) : selectedLine.variants.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-muted/35 p-6 text-center text-sm text-muted-foreground">
                    {t('annotations.new.emptyVariant')}
                  </div>
                ) : (
                  <div
                    className="grid grid-cols-1 gap-3 lg:grid-cols-2"
                    data-testid="annotation-new-release-variant-select"
                  >
                    {selectedLine.variants.map((variant) => (
                      <VariantOption
                        key={variant.id}
                        variant={variant}
                        selected={variant.id === selectedVariantId}
                        testId={`annotation-new-release-variant-option-${variant.id}`}
                        onSelect={() => {
                          setExplicitVariantId(variant.id);
                          setSampleSizeDraft(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <SectionHeader
                icon={<Database className="size-3" />}
                title={t('annotations.new.section.sample')}
                detail={t('annotations.new.section.sampleDetail')}
              />
              <div className="space-y-5 p-5">
                <div data-testid="annotation-new-scope">
                  <Segmented
                    value={scope}
                    onChange={(next) => {
                      setScope(next);
                      setSampleSizeDraft(null);
                    }}
                    ariaLabel={t('annotations.new.scope.label')}
                    options={[
                      { value: 'canary', label: t('annotations.scope.canary') },
                      { value: 'online', label: t('annotations.scope.online') },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[12.5px]">{t('annotations.new.field.name')}</Label>
                    <Input
                      data-testid="annotation-new-task-name"
                      value={taskName}
                      onChange={(event) => setTaskName(event.target.value)}
                      placeholder={t('annotations.new.field.namePlaceholder')}
                      className="font-mono text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[12.5px]">{t('annotations.new.field.sampleLimit')}</Label>
                    <Input
                      data-testid="annotation-new-sample-size"
                      type="number"
                      min={1}
                      max={Math.max(1, maxSamples)}
                      value={sampleSize}
                      onChange={(event) => setSampleSizeDraft(event.target.value)}
                      className="font-mono text-[13px]"
                    />
                    <p className="text-[11.5px] text-muted-foreground">
                      {t('annotations.new.maxSamples').replace('{count}', formatCount(maxSamples))}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
                  {t('annotations.new.expectedOutputOnly')}
                </div>
                {getApiErrorMessage(createMutation.error) ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                    {getApiErrorMessage(createMutation.error)}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <aside className="xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-[14px] font-semibold">{t('annotations.new.summary.title')}</h2>
              <div className="mt-4 space-y-3">
                <SummaryRow label={t('annotations.new.field.name')} value={taskName.trim() || '-'} />
                <SummaryRow label={t('annotations.new.summary.release')} value={selectedLine?.name ?? '-'} />
                <SummaryRow
                  label={t('annotations.new.summary.variant')}
                  value={selectedVariant ? formatVariant(selectedVariant) : '-'}
                />
                <SummaryRow
                  label={t('annotations.new.summary.scope')}
                  value={scope === 'canary' ? t('annotations.scope.canary') : t('annotations.scope.online')}
                />
                <SummaryRow
                  label={t('annotations.new.summary.samples')}
                  value={`${formatCount(normalizedSampleSize)} / ${formatCount(maxSamples)}`}
                />
                <SummaryRow label={t('annotations.new.summary.field')} value="expected_output" />
                <SummaryRow
                  label={t('annotations.new.summary.categories')}
                  value={selectedVariant ? formatCategoryOptions(selectedVariant.categoryOptions) : '-'}
                />
              </div>
              <div className="mt-4 rounded-md border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
                {submitHint}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Main>
  );
}

function SectionHeader({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
      <span className="inline-flex size-5 items-center justify-center rounded-full border border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]">
        {icon}
      </span>
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <span className="text-[12px] text-muted-foreground">{detail}</span>
    </div>
  );
}

function VariantOption({
  variant,
  selected,
  onSelect,
  testId,
}: {
  variant: AnnotationReleaseVariantOptionDto;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onSelect}
      className={cn(
        'min-w-0 rounded-md border bg-background p-3 text-left transition-colors hover:bg-accent',
        selected && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[12.5px] font-semibold">{formatVariant(variant)}</div>
          <div className="mt-1 truncate text-[11.5px] text-muted-foreground">{variant.id}</div>
        </div>
        <span className="rounded-full border px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
          {variant.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-muted-foreground">
        <span>
          {t('annotations.scope.canary')} {formatCount(variant.canaryCount)}
        </span>
        <span>
          {t('annotations.scope.online')} {formatCount(variant.onlineCount)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {variant.categoryOptions.length > 0 ? (
          <>
            {variant.categoryOptions.slice(0, 4).map((category) => (
              <span key={category} className="rounded-full border bg-muted/35 px-2 py-0.5 text-[10.5px]">
                {category}
              </span>
            ))}
            {variant.categoryOptions.length > 4 ? (
              <span className="rounded-full border bg-muted/35 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                +{variant.categoryOptions.length - 4}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-[11px] text-destructive">{t('annotations.new.noCategoryOptions')}</span>
        )}
      </div>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 text-[12px]">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 truncate font-mono text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function getMaxSamples(variant: AnnotationReleaseVariantOptionDto, scope: AnnotationTaskScopeDto) {
  return scope === 'online' ? variant.onlineCount : variant.canaryCount;
}

function formatVariant(variant: AnnotationReleaseVariantOptionDto) {
  return `${variant.label} · ${variant.promptVersionLabel ?? variant.promptVersionId.slice(0, 8)} · ${variant.modelName ?? variant.modelId.slice(0, 8)}`;
}

function formatCategoryOptions(options: string[]) {
  if (options.length === 0) return '-';
  const preview = options.slice(0, 3).join(' / ');
  return options.length > 3 ? `${preview} / +${options.length - 3}` : preview;
}
