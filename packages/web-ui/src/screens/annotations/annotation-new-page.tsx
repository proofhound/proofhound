'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from '../../components/navigation/link';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '../../hooks/use-router';
import type { AnnotationReleaseLineOptionDto, AnnotationReleaseVersionOptionDto } from '@proofhound/shared';
import { Check, ChevronDown, ClipboardCheck, Database, GitBranch, Search } from 'lucide-react';
import { Main } from '@proofhound/ui/layout';
import {
  Button,
  Input,
  Label,
  DetailPageSkeleton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  cn,
} from '@proofhound/ui';
import { useAnnotationTaskOptions, useCreateAnnotationTask } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import { formatCount } from './annotation-ui';

type TFunction = ReturnType<typeof useI18n>['t'];
type SamplingMode = 'random' | 'per_category';

function buildDefaultTaskName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `annotation-${yyyy}${mm}${dd}`;
}

export function AnnotationNewPage({ projectId, initialName }: { projectId: string; initialName?: string | null }) {
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const optionsQuery = useAnnotationTaskOptions(projectId);
  const createMutation = useCreateAnnotationTask(projectId);
  const requestedReleaseLineId = searchParams.get('line') ?? '';
  const requestedReleaseVersionId = searchParams.get('version') ?? '';
  const releaseLines = useMemo(() => optionsQuery.data?.data ?? [], [optionsQuery.data]);
  const [explicitLineId, setExplicitLineId] = useState('');
  const [explicitVersionId, setExplicitVersionId] = useState('');
  const [samplingMode, setSamplingMode] = useState<SamplingMode>('random');
  const [taskName, setTaskName] = useState(() => initialName?.trim() || buildDefaultTaskName());
  const [sampleSizeDraft, setSampleSizeDraft] = useState<string | null>(null);
  const [categorySampleDrafts, setCategorySampleDrafts] = useState<Record<string, string>>({});

  const selectedLineId = useMemo(() => {
    if (explicitLineId && releaseLines.some((line) => line.id === explicitLineId)) return explicitLineId;
    const requested = releaseLines.find((line) => line.id === requestedReleaseLineId);
    const requestedByVersion = releaseLines.find((line) =>
      line.versions.some((version) => version.id === requestedReleaseVersionId),
    );
    return (requested ?? requestedByVersion ?? releaseLines[0])?.id ?? '';
  }, [explicitLineId, releaseLines, requestedReleaseLineId, requestedReleaseVersionId]);
  const selectedLine = useMemo(
    () => releaseLines.find((line) => line.id === selectedLineId) ?? null,
    [releaseLines, selectedLineId],
  );
  const selectedVersionId = useMemo(() => {
    if (!selectedLine) return '';
    if (explicitVersionId && selectedLine.versions.some((version) => version.id === explicitVersionId)) {
      return explicitVersionId;
    }
    if (
      requestedReleaseVersionId &&
      selectedLine.versions.some((version) => version.id === requestedReleaseVersionId)
    ) {
      return requestedReleaseVersionId;
    }
    return selectedLine.versions[0]?.id ?? '';
  }, [explicitVersionId, requestedReleaseVersionId, selectedLine]);
  const selectedVersion = useMemo(
    () => selectedLine?.versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedLine, selectedVersionId],
  );
  const maxSamples = selectedVersion ? getVersionRunResultCount(selectedVersion) : 0;
  const sampleSize = sampleSizeDraft ?? (maxSamples > 0 ? String(maxSamples) : '');
  const parsedSampleSize = Number(sampleSize);
  const randomSampleSize = Number.isFinite(parsedSampleSize) && parsedSampleSize > 0 ? Math.trunc(parsedSampleSize) : 0;
  const categorySampleCounts = useMemo(
    () =>
      (selectedVersion?.categoryCounts ?? []).map((item) => {
        const parsed = Number(categorySampleDrafts[item.category] ?? '');
        return {
          category: item.category,
          availableCount: item.count,
          sampleSize: Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0,
        };
      }),
    [categorySampleDrafts, selectedVersion],
  );
  const categorySampleTotal = categorySampleCounts.reduce((sum, item) => sum + item.sampleSize, 0);
  const categorySampleExceeded = categorySampleCounts.some((item) => item.sampleSize > item.availableCount);
  const normalizedSampleSize = samplingMode === 'per_category' ? categorySampleTotal : randomSampleSize;
  const canCreate =
    Boolean(selectedLine && selectedVersion && taskName.trim()) &&
    Boolean(selectedVersion && selectedVersion.categoryOptions.length > 0) &&
    normalizedSampleSize >= 1 &&
    normalizedSampleSize <= maxSamples &&
    !categorySampleExceeded &&
    !createMutation.isPending;
  const submitHint =
    selectedVersion && selectedVersion.categoryOptions.length === 0
      ? t('annotations.new.categoryOptionsRequired')
      : samplingMode === 'per_category' && categorySampleExceeded
        ? t('annotations.new.categorySampleExceeded')
        : canCreate
          ? t('annotations.new.submitReady')
          : t('annotations.new.submitDisabled');

  function submit() {
    if (!selectedLine || !selectedVersion || !canCreate) return;
    createMutation.mutate(
      {
        name: taskName.trim(),
        releaseLineId: selectedLine.id,
        releaseVersionId: selectedVersion.id,
        releaseVersionScope: 'exact',
        scope: 'all',
        samplingMode,
        sampleSize: normalizedSampleSize,
        categorySampleCounts:
          samplingMode === 'per_category'
            ? categorySampleCounts
                .filter((item) => item.sampleSize > 0)
                .map((item) => ({ category: item.category, sampleSize: item.sampleSize }))
            : undefined,
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
                step="1"
                icon={<ClipboardCheck className="size-3" />}
                title={t('annotations.new.section.name')}
                detail={t('annotations.new.section.nameDetail')}
              />
              <div className="p-5">
                <div className="max-w-xl space-y-1.5">
                  <Label className="text-[12.5px]">{t('annotations.new.field.name')}</Label>
                  <Input
                    data-testid="annotation-new-task-name"
                    value={taskName}
                    onChange={(event) => setTaskName(event.target.value)}
                    placeholder={t('annotations.new.field.namePlaceholder')}
                    className="font-mono text-[13px]"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <SectionHeader
                step="2"
                icon={<GitBranch className="size-3" />}
                title={t('annotations.new.section.release')}
                detail={t('annotations.new.section.releaseDetail')}
              />
              <div className="space-y-4 p-5">
                {releaseLines.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-muted/35 p-6 text-center text-sm text-muted-foreground">
                    {t('annotations.new.emptyRelease')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[12.5px]">{t('annotations.new.summary.release')}</Label>
                      <ReleaseLineSelect
                        lines={releaseLines}
                        selectedLine={selectedLine}
                        onSelect={(lineId) => {
                          setExplicitLineId(lineId);
                          setExplicitVersionId('');
                          setSampleSizeDraft(null);
                          setCategorySampleDrafts({});
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12.5px]">{t('annotations.new.summary.version')}</Label>
                      {!selectedLine ? (
                        <div className="rounded-md border border-dashed bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
                          {t('annotations.new.selectReleaseFirst')}
                        </div>
                      ) : selectedLine.versions.length === 0 ? (
                        <div className="rounded-md border border-dashed bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
                          {t('annotations.new.emptyVersion')}
                        </div>
                      ) : (
                        <ReleaseVersionSelect
                          line={selectedLine}
                          selectedVersion={selectedVersion}
                          onSelect={(versionId) => {
                            setExplicitVersionId(versionId);
                            setSampleSizeDraft(null);
                            setCategorySampleDrafts({});
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border bg-card">
              <SectionHeader
                step="3"
                icon={<Database className="size-3" />}
                title={t('annotations.new.section.sample')}
                detail={t('annotations.new.section.sampleDetail')}
              />
              <div className="space-y-5 p-5">
                <div data-testid="annotation-new-sampling-mode">
                  <Segmented
                    value={samplingMode}
                    onChange={(next) => {
                      setSamplingMode(next);
                      setSampleSizeDraft(null);
                    }}
                    ariaLabel={t('annotations.new.samplingMode.label')}
                    options={[
                      { value: 'random', label: t('annotations.new.samplingMode.random') },
                      { value: 'per_category', label: t('annotations.new.samplingMode.perCategory') },
                    ]}
                  />
                </div>
                {samplingMode === 'random' ? (
                  <div className="max-w-sm space-y-1.5">
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
                ) : (
                  <CategorySampleEditor
                    counts={selectedVersion?.categoryCounts ?? []}
                    drafts={categorySampleDrafts}
                    onChange={(category, value) => {
                      setCategorySampleDrafts((current) => ({ ...current, [category]: value }));
                    }}
                    total={categorySampleTotal}
                    maxSamples={maxSamples}
                  />
                )}
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
                  label={t('annotations.new.summary.version')}
                  value={selectedVersion ? formatVersion(selectedVersion) : '-'}
                />
                <SummaryRow
                  label={t('annotations.new.summary.samplingMode')}
                  value={
                    samplingMode === 'per_category'
                      ? t('annotations.new.samplingMode.perCategory')
                      : t('annotations.new.samplingMode.random')
                  }
                />
                <SummaryRow
                  label={t('annotations.new.summary.samples')}
                  value={`${formatCount(normalizedSampleSize)} / ${formatCount(maxSamples)}`}
                />
                <SummaryRow
                  label={t('annotations.new.summary.categories')}
                  value={selectedVersion ? formatCategoryOptions(selectedVersion.categoryOptions) : '-'}
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

function SectionHeader({
  step,
  icon,
  title,
  detail,
}: {
  step: string;
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary font-mono text-[11px] font-semibold text-primary-foreground">
        {step}
      </span>
      <span className="inline-flex size-5 items-center justify-center rounded-full border border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]">
        {icon}
      </span>
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <span className="text-[12px] text-muted-foreground">{detail}</span>
    </div>
  );
}

function ReleaseLineSelect({
  lines,
  selectedLine,
  onSelect,
}: {
  lines: AnnotationReleaseLineOptionDto[];
  selectedLine: AnnotationReleaseLineOptionDto | null;
  onSelect: (lineId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filteredLines = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return lines;
    return lines.filter((line) =>
      searchIncludes(q, [
        line.id,
        line.name,
        line.status,
        line.promptName,
        line.inputConnectorName,
        ...line.versions.flatMap((version) => [
          version.id,
          version.label,
          formatPromptVersion(version),
          formatModel(version),
          version.modelProvider,
          String(getVersionRunResultCount(version)),
        ]),
      ]),
    );
  }, [lines, query]);

  function select(lineId: string) {
    onSelect(lineId);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-testid="annotation-new-release-line-select"
          className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">
              {selectedLine?.name ?? t('annotations.new.selectReleaseFirst')}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[11px] font-normal text-muted-foreground">
              {selectedLine ? formatReleaseLineMeta(selectedLine, t) : t('annotations.new.releaseSearchPlaceholder')}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[calc(100vw-2rem)] p-0 sm:w-[640px]">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('annotations.new.releaseSearchPlaceholder')}
          testId="annotation-new-release-line-search"
        />
        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {filteredLines.length === 0 ? (
            <EmptyDropdownResult />
          ) : (
            filteredLines.map((line) => {
              const selected = line.id === selectedLine?.id;
              return (
                <button
                  key={line.id}
                  type="button"
                  data-testid={`annotation-new-release-line-option-${line.id}`}
                  onClick={() => select(line.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent',
                    selected && 'bg-primary/5',
                  )}
                >
                  <SelectionCheck selected={selected} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{line.name}</span>
                    <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">
                      <FieldLabel label={t('annotations.new.dropdown.prompt')} value={line.promptName || '-'} />
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                      <span>{formatReleaseLineMeta(line, t)}</span>
                      {line.inputConnectorName ? <span>{line.inputConnectorName}</span> : null}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReleaseVersionSelect({
  line,
  selectedVersion,
  onSelect,
}: {
  line: AnnotationReleaseLineOptionDto;
  selectedVersion: AnnotationReleaseVersionOptionDto | null;
  onSelect: (versionId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filteredVersions = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return line.versions;
    return line.versions.filter((version) =>
      searchIncludes(q, [
        version.id,
        version.label,
        line.promptName,
        formatPromptVersion(version),
        version.promptVersionId,
        formatModel(version),
        version.modelProvider,
        String(getVersionRunResultCount(version)),
        ...version.categoryOptions,
      ]),
    );
  }, [line, query]);

  function select(versionId: string) {
    onSelect(versionId);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-testid="annotation-new-release-version-select"
          className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] font-semibold">
              {selectedVersion?.label ?? t('annotations.new.emptyVersion')}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
              {selectedVersion
                ? formatVersionMeta(line, selectedVersion, t)
                : t('annotations.new.versionSearchPlaceholder')}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[calc(100vw-2rem)] p-0 sm:w-[720px]">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('annotations.new.versionSearchPlaceholder')}
          testId="annotation-new-release-version-search"
        />
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {filteredVersions.length === 0 ? (
            <EmptyDropdownResult />
          ) : (
            filteredVersions.map((version) => {
              const selected = version.id === selectedVersion?.id;
              return (
                <button
                  key={version.id}
                  type="button"
                  data-testid={`annotation-new-release-version-option-${version.id}`}
                  onClick={() => select(version.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent',
                    selected && 'bg-primary/5',
                  )}
                >
                  <SelectionCheck selected={selected} />
                  <span className="min-w-0 flex-1">
                    <span className="block min-w-0 truncate font-mono text-[13px] font-semibold">{version.label}</span>
                    <span className="mt-1 grid gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground sm:grid-cols-3">
                      <span className="min-w-0 truncate">
                        <FieldLabel
                          label={t('annotations.new.dropdown.prompt')}
                          value={`${line.promptName} - ${formatPromptVersion(version)}`}
                        />
                      </span>
                      <span className="min-w-0 truncate">
                        <FieldLabel label={t('annotations.new.dropdown.model')} value={formatModel(version)} />
                      </span>
                      <span className="min-w-0 truncate">
                        <FieldLabel
                          label={t('annotations.new.dropdown.runResultsLabel')}
                          value={formatCount(getVersionRunResultCount(version))}
                        />
                      </span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder={placeholder}
        data-testid={testId}
        className="h-8 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </div>
  );
}

function SelectionCheck({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/35 bg-background',
      )}
      aria-hidden="true"
    >
      <Check className={cn('size-3', selected ? 'opacity-100' : 'opacity-0')} />
    </span>
  );
}

function EmptyDropdownResult() {
  const { t } = useI18n();
  return (
    <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">{t('annotations.new.noMatches')}</div>
  );
}

function CategorySampleEditor({
  counts,
  drafts,
  onChange,
  total,
  maxSamples,
}: {
  counts: AnnotationReleaseVersionOptionDto['categoryCounts'];
  drafts: Record<string, string>;
  onChange: (category: string, value: string) => void;
  total: number;
  maxSamples: number;
}) {
  const { t } = useI18n();
  if (counts.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/35 px-3 py-6 text-center text-[12px] text-muted-foreground">
        {t('annotations.new.noCategoryOptions')}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-2">
      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-[minmax(0,1fr)_112px_128px] gap-3 border-b bg-muted/35 px-3 py-2 text-[11px] font-medium text-muted-foreground">
          <span>{t('annotations.new.categorySample.category')}</span>
          <span>{t('annotations.new.categorySample.available')}</span>
          <span>{t('annotations.new.categorySample.count')}</span>
        </div>
        {counts.map((item) => {
          const value = drafts[item.category] ?? '';
          const parsed = Number(value);
          const exceeded = Number.isFinite(parsed) && parsed > item.count;
          return (
            <div
              key={item.category}
              className="grid grid-cols-[minmax(0,1fr)_112px_128px] items-center gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0 truncate text-[12.5px] font-medium" title={item.category}>
                {item.category}
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">{formatCount(item.count)}</span>
              <Input
                data-testid={`annotation-new-category-sample-${toTestIdPart(item.category)}`}
                type="number"
                min={0}
                max={Math.max(0, item.count)}
                value={value}
                onChange={(event) => onChange(item.category, event.target.value)}
                className={cn(
                  'h-8 font-mono text-[12px]',
                  exceeded && 'border-destructive focus-visible:ring-destructive',
                )}
              />
            </div>
          );
        })}
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        {t('annotations.new.categorySample.total')
          .replace('{count}', formatCount(total))
          .replace('{max}', formatCount(maxSamples))}
      </p>
    </div>
  );
}

function FieldLabel({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="mx-1 text-muted-foreground/60">-</span>
      <span className="text-foreground">{value}</span>
    </>
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function searchIncludes(query: string, parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function getVersionRunResultCount(version: AnnotationReleaseVersionOptionDto) {
  return version.runResultCount ?? version.canaryCount + version.onlineCount;
}

function getReleaseLineRunResultCount(line: AnnotationReleaseLineOptionDto) {
  return line.versions.reduce((sum, version) => sum + getVersionRunResultCount(version), 0);
}

function formatReleaseLineMeta(line: AnnotationReleaseLineOptionDto, t: TFunction) {
  return [
    t('annotations.new.dropdown.versionCount').replace('{count}', formatCount(line.versions.length)),
    formatRunResultCount(getReleaseLineRunResultCount(line), t),
  ].join(' · ');
}

function formatVersionMeta(
  line: AnnotationReleaseLineOptionDto,
  version: AnnotationReleaseVersionOptionDto,
  t: TFunction,
) {
  return [
    `${line.promptName} - ${formatPromptVersion(version)}`,
    formatModel(version),
    formatRunResultCount(getVersionRunResultCount(version), t),
  ].join(' - ');
}

function formatRunResultCount(count: number, t: TFunction) {
  return t('annotations.new.dropdown.runResults').replace('{count}', formatCount(count));
}

function formatPromptVersion(version: AnnotationReleaseVersionOptionDto) {
  return version.promptVersionLabel ?? `v${version.promptVersionNumber ?? version.promptVersionId.slice(0, 8)}`;
}

function formatModel(version: AnnotationReleaseVersionOptionDto) {
  return version.modelName ?? version.modelId.slice(0, 8);
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

function formatVersion(version: AnnotationReleaseVersionOptionDto) {
  return `${version.label} · ${formatPromptVersion(version)} · ${formatModel(version)}`;
}

function formatCategoryOptions(options: string[]) {
  if (options.length === 0) return '-';
  const preview = options.slice(0, 3).join(' / ');
  return options.length > 3 ? `${preview} / +${options.length - 3}` : preview;
}

function toTestIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
