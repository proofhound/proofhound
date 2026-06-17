'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatClassificationAnnotationValue, normalizeClassificationAnnotationValue } from '@proofhound/shared';
import type { AnnotationSampleDto, AnnotationSampleStatusDto } from '@proofhound/shared';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Save,
} from 'lucide-react';
import { AnnotationClaimDialog } from '../../components';
import { Main } from '@proofhound/ui/layout';
import {
  Button,
  Label,
  DetailPageSkeleton,
  Progress,
  formatProgressLabel,
  Segmented,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  cn,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import {
  useAnnotationSamples,
  useAnnotationTask,
  useDateTimeFormatter,
  useClaimAnnotationSamples,
  useReleaseAnnotationSample,
  useSubmitAnnotationSample,
} from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type TranslationKey } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
import { buildAnnotationTasks } from './annotation-task-model';
import {
  AnnotationMetricCard,
  AnnotationScopeBadge,
  AnnotationTaskStatusBadge,
  formatCount,
  formatDateTimeOrDash,
  formatPercent,
} from './annotation-ui';

type SampleFilter = 'all' | AnnotationSampleStatusDto;

const SAMPLE_COLUMNS: TableColumn[] = [
  { key: 'sample', width: 'flex', minPx: 220 },
  { key: 'status', width: 'compact' },
  { key: 'result', width: 'compact' },
  { key: 'judgment', width: 'compact' },
  { key: 'createdAt', width: 'compact' },
];

function normalizeStatusParam(value: string | null): SampleFilter {
  if (value === 'pending' || value === 'claimed' || value === 'submitted') return value;
  return 'all';
}

function getAnnotationStatus(annotation: AnnotationSampleDto): AnnotationSampleStatusDto {
  if (annotation.submittedAt) return 'submitted';
  if (!annotation.lockedBy) return 'pending';
  if (!annotation.lockHeartbeatAt) return 'claimed';
  const heartbeat = Date.parse(annotation.lockHeartbeatAt);
  if (!Number.isFinite(heartbeat)) return 'claimed';
  return Date.now() - heartbeat <= 5 * 60_000 ? 'claimed' : 'pending';
}

function statusKey(status: AnnotationSampleStatusDto): TranslationKey {
  switch (status) {
    case 'pending':
      return 'annotations.sample.status.pending';
    case 'claimed':
      return 'annotations.sample.status.claimed';
    case 'submitted':
      return 'annotations.sample.status.submitted';
  }
}

function compactValue(value: string | null | undefined, maxLength = 80) {
  if (!value) return '-';
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function getCategoryShortcutIndex(event: KeyboardEvent): number | null {
  if (/^[1-9]$/.test(event.key)) return Number(event.key) - 1;
  if (event.key === '0') return 9;
  return null;
}

function isSubmitShortcut(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' ||
    event.key === 'Return' ||
    event.key === 'NumpadEnter' ||
    event.code === 'Enter' ||
    event.code === 'NumpadEnter'
  );
}

export function AnnotationDetailPage({ projectId, annotationTaskId }: { projectId: string; annotationTaskId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const taskQuery = useAnnotationTask(projectId, annotationTaskId);
  const task = useMemo(
    () => (taskQuery.data ? (buildAnnotationTasks([taskQuery.data])[0] ?? null) : null),
    [taskQuery.data],
  );
  const [sampleFilter, setSampleFilter] = useState<SampleFilter>(() =>
    normalizeStatusParam(searchParams.get('status')),
  );
  const [claimOpen, setClaimOpen] = useState(false);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const query = useMemo(
    () => ({
      status: sampleFilter === 'all' ? undefined : sampleFilter,
      limit: 80,
      offset: 0,
    }),
    [sampleFilter],
  );
  const annotationsQuery = useAnnotationSamples(projectId, annotationTaskId, query);
  const annotationsLoading = useDelayedLoading(annotationsQuery.isLoading);
  const claimMutation = useClaimAnnotationSamples(projectId, annotationTaskId);
  const submitMutation = useSubmitAnnotationSample(projectId, annotationTaskId);
  const releaseMutation = useReleaseAnnotationSample(projectId, annotationTaskId);
  const annotations = useMemo(() => annotationsQuery.data?.data ?? [], [annotationsQuery.data]);
  const selectedAnnotation =
    annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? annotations[0] ?? null;

  function selectFilter(next: SampleFilter) {
    setSampleFilter(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    const queryString = params.toString();
    router.replace(
      queryString
        ? `/annotations/${encodeURIComponent(annotationTaskId)}?${queryString}`
        : `/annotations/${encodeURIComponent(annotationTaskId)}`,
      { scroll: false },
    );
  }

  function handleClaim(batchSize: number) {
    claimMutation.mutate(
      { batchSize },
      {
        onSuccess: (response) => {
          setClaimOpen(false);
          selectFilter('claimed');
          setSelectedAnnotationId(response.data[0]?.id ?? null);
        },
      },
    );
  }

  const detailLoading = useDelayedLoading(taskQuery.isLoading && !taskQuery.data);
  if (detailLoading) {
    return (
      <Main fixed className="bg-muted/35">
        <div className="mx-auto w-full max-w-[1760px]" data-testid="annotation-detail-page">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  if (!task) {
    return (
      <Main fixed className="bg-muted/35">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4" data-testid="annotation-detail-page">
          <div className="rounded-lg border bg-card p-10 text-center">
            <div className="text-[15px] font-semibold">{t('annotations.detail.notFound')}</div>
            <p className="mt-2 text-sm text-muted-foreground">{annotationTaskId}</p>
            <Button className="mt-5" asChild>
              <Link href="/annotations">
                <ArrowLeft className="size-4" />
                {t('annotations.action.back')}
              </Link>
            </Button>
          </div>
        </div>
      </Main>
    );
  }

  return (
    <Main fixed className="gap-5 overflow-auto bg-muted/35 pb-8">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-5" data-testid="annotation-detail-page">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold leading-tight">{task.name}</h1>
              <AnnotationTaskStatusBadge status={task.status} />
              <AnnotationScopeBadge scope={task.scope} />
            </div>
            <p className="mt-1 max-w-3xl text-[12.5px] text-muted-foreground">
              {task.promptName} · {task.releaseVersionLabel} · {task.promptVersionLabel ?? '-'} ·{' '}
              {task.modelName ?? '-'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/annotations">
                <ArrowLeft className="size-4" />
                {t('annotations.action.back')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/releases/${encodeURIComponent(task.releaseLineId)}?tab=quality`}>
                <ExternalLink className="size-4" />
                {t('annotations.action.openRelease')}
              </Link>
            </Button>
            <Button onClick={() => setClaimOpen(true)} disabled={task.open < 1}>
              <ListChecks className="size-4" />
              {t('annotations.action.claim')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <AnnotationMetricCard
            label={t('annotations.detail.metric.open')}
            value={formatCount(task.open)}
            detail={t('annotations.detail.metric.openHint')}
            tone="active"
          />
          <AnnotationMetricCard
            label={t('annotations.detail.metric.claimed')}
            value={formatCount(task.claimed)}
            detail={t('annotations.detail.metric.claimedHint')}
          />
          <AnnotationMetricCard
            label={t('annotations.detail.metric.submitted')}
            value={formatCount(task.submitted)}
            detail={`${formatCount(task.submitted)} / ${formatCount(task.total)}`}
            tone="success"
            testId="annotation-detail-metric-submitted"
          />
          <AnnotationMetricCard
            label={t('annotations.detail.metric.quality')}
            value={formatPercent(task.qualityScore, 1)}
            detail={t('annotations.detail.metric.qualityHint')}
          />
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-[11.5px] font-medium text-muted-foreground">
              {t('annotations.detail.metric.progress')}
            </div>
            <div className="mt-3">
              <Progress
                value={task.submitted}
                max={Math.max(1, task.total)}
                label={formatProgressLabel({
                  value: task.submitted,
                  max: Math.max(1, task.total),
                })}
              />
            </div>
          </div>
        </div>

        <div
          className={cn(
            'grid gap-4',
            queueCollapsed ? 'xl:grid-cols-[52px_minmax(0,1fr)]' : 'xl:grid-cols-[520px_minmax(0,1fr)]',
          )}
        >
          <section
            className={cn(
              'min-w-0 overflow-hidden rounded-lg border bg-card',
              queueCollapsed && 'min-h-12 xl:min-h-[520px]',
            )}
          >
            {queueCollapsed ? (
              <div className="flex h-full items-start justify-center p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('annotations.detail.queue.expand')}
                  onClick={() => setQueueCollapsed(false)}
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div>
                    <h2 className="text-[14px] font-semibold">{t('annotations.detail.queue')}</h2>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">{t('annotations.detail.queueHint')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      value={sampleFilter}
                      onChange={selectFilter}
                      ariaLabel={t('annotations.detail.filter.label')}
                      size="sm"
                      options={[
                        { value: 'all', label: t('annotations.detail.filter.all') },
                        { value: 'pending', label: t('annotations.sample.status.pending') },
                        { value: 'claimed', label: t('annotations.sample.status.claimed') },
                        { value: 'submitted', label: t('annotations.sample.status.submitted') },
                      ]}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('annotations.detail.queue.collapse')}
                      onClick={() => setQueueCollapsed(true)}
                    >
                      <PanelLeftClose className="size-4" />
                    </Button>
                  </div>
                </div>
                <Table columns={SAMPLE_COLUMNS}>
                  <TableHeader>
                    <TableRow>
                      <TableHead column="sample">{t('annotations.detail.samples.sample')}</TableHead>
                      <TableHead column="status">{t('annotations.detail.samples.status')}</TableHead>
                      <TableHead column="result">{t('annotations.detail.samples.result')}</TableHead>
                      <TableHead column="judgment">{t('annotations.detail.samples.judgment')}</TableHead>
                      <TableHead column="createdAt">{t('annotations.detail.samples.createdAt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {annotationsLoading ? (
                      <TableSkeletonRows />
                    ) : annotations.length === 0 ? (
                      <TableEmpty>{t('annotations.detail.empty')}</TableEmpty>
                    ) : (
                      annotations.map((annotation) => (
                        <TableRow
                          key={annotation.id}
                          selected={annotation.id === selectedAnnotation?.id}
                          selectedTone="canary"
                          onClick={() => setSelectedAnnotationId(annotation.id)}
                        >
                          <TableCell column="sample">
                            <div className="min-w-0">
                              <div className="truncate font-mono text-[12.5px]">
                                {annotation.externalId ?? annotation.runResultId.slice(0, 8)}
                              </div>
                              <div className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">
                                {annotation.outputPreview ?? annotation.inputPreview ?? '-'}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell column="status">
                            <SampleStatusBadge status={getAnnotationStatus(annotation)} />
                          </TableCell>
                          <TableCell column="result">
                            <ExpectedOutputPill value={annotation.annotatedExpectedOutput} />
                          </TableCell>
                          <TableCell column="judgment">
                            <JudgmentPill annotation={annotation} />
                          </TableCell>
                          <TableCell column="createdAt">
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {formatDateTimeOrDash(annotation.createdAt, formatDateTime)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </>
            )}
          </section>

          <AnnotationWorkspace
            annotation={selectedAnnotation}
            categoryOptions={task.raw.categoryOptions}
            submitPending={submitMutation.isPending}
            releasePending={releaseMutation.isPending}
            submitError={getApiErrorMessage(submitMutation.error)}
            releaseError={getApiErrorMessage(releaseMutation.error)}
            onSubmit={(payload) => {
              if (!selectedAnnotation) return;
              const selectedIndex = annotations.findIndex((annotation) => annotation.id === selectedAnnotation.id);
              const nextAnnotation =
                selectedIndex >= 0
                  ? [...annotations.slice(selectedIndex + 1), ...annotations.slice(0, selectedIndex)].find(
                      (annotation) => getAnnotationStatus(annotation) !== 'submitted',
                    )
                  : null;
              submitMutation.mutate(
                {
                  annotationId: selectedAnnotation.id,
                  expectedOutput: payload.expectedOutput.trim(),
                  notes: payload.notes.trim() ? payload.notes.trim() : null,
                },
                {
                  onSuccess: () => setSelectedAnnotationId(nextAnnotation?.id ?? null),
                },
              );
            }}
            onRelease={() => {
              if (!selectedAnnotation) return;
              releaseMutation.mutate(
                { annotationId: selectedAnnotation.id },
                {
                  onSuccess: () => setSelectedAnnotationId(null),
                },
              );
            }}
          />
        </div>
      </div>

      <AnnotationClaimDialog
        open={claimOpen}
        onOpenChange={setClaimOpen}
        inputId="annotation-detail-claim-size"
        maxClaimable={task.open}
        isPending={claimMutation.isPending}
        onSubmit={handleClaim}
        onCancel={() => setClaimOpen(false)}
      />
    </Main>
  );
}

function SampleStatusBadge({ status }: { status: AnnotationSampleStatusDto }) {
  const { t } = useI18n();
  const token =
    status === 'submitted'
      ? {
          bg: 'var(--status-running-bg)',
          fg: 'var(--status-running-fg)',
          bd: 'var(--status-running-bd)',
        }
      : status === 'claimed'
        ? {
            bg: 'var(--status-canary-bg)',
            fg: 'var(--status-canary-fg)',
            bd: 'var(--status-canary-bd)',
          }
        : {
            bg: 'var(--status-pending-bg)',
            fg: 'var(--status-pending-fg)',
            bd: 'var(--status-pending-bd)',
          };

  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ background: token.bg, color: token.fg, borderColor: token.bd }}
    >
      {t(statusKey(status))}
    </span>
  );
}

function ExpectedOutputPill({ value }: { value: string | null }) {
  const { t } = useI18n();
  if (!value) {
    return <span className="text-[12px] text-muted-foreground">{t('annotations.expectedOutput.pending')}</span>;
  }
  return (
    <span
      className="inline-flex max-w-[180px] rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium"
      style={{
        background: 'var(--status-running-bg)',
        color: 'var(--status-running-fg)',
        borderColor: 'var(--status-running-bd)',
      }}
      title={value}
    >
      <span className="truncate">{compactValue(value)}</span>
    </span>
  );
}

function getAnnotationJudgment(annotation: AnnotationSampleDto): 'correct' | 'incorrect' | null {
  if (annotation.isCorrect === true) return 'correct';
  if (annotation.isCorrect === false) return 'incorrect';
  if (!annotation.submittedAt || !annotation.annotatedExpectedOutput) return null;
  return annotation.decisionOutput === annotation.annotatedExpectedOutput ? 'correct' : 'incorrect';
}

function JudgmentPill({ annotation }: { annotation: AnnotationSampleDto }) {
  const { t } = useI18n();
  const judgment = getAnnotationJudgment(annotation);
  if (!judgment) {
    return <span className="text-[12px] text-muted-foreground">{t('annotations.judgment.pending')}</span>;
  }

  if (judgment === 'correct') {
    return (
      <span
        className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{
          background: 'var(--status-running-bg)',
          color: 'var(--status-running-fg)',
          borderColor: 'var(--status-running-bd)',
        }}
      >
        {t('annotations.judgment.correct')}
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
      {t('annotations.judgment.incorrect')}
    </span>
  );
}

function AnnotationWorkspace({
  annotation,
  categoryOptions,
  submitPending,
  releasePending,
  submitError,
  releaseError,
  onSubmit,
  onRelease,
}: {
  annotation: AnnotationSampleDto | null;
  categoryOptions: string[];
  submitPending: boolean;
  releasePending: boolean;
  submitError?: string | null;
  releaseError?: string | null;
  onSubmit: (payload: { expectedOutput: string; notes: string }) => void;
  onRelease: () => void;
}) {
  const { t } = useI18n();
  if (!annotation) {
    return (
      <section className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        {t('annotations.detail.workspace.empty')}
      </section>
    );
  }

  return (
    <AnnotationWorkspaceForm
      key={annotation.id}
      annotation={annotation}
      categoryOptions={categoryOptions}
      submitPending={submitPending}
      releasePending={releasePending}
      submitError={submitError}
      releaseError={releaseError}
      onSubmit={onSubmit}
      onRelease={onRelease}
    />
  );
}

function AnnotationWorkspaceForm({
  annotation,
  categoryOptions,
  submitPending,
  releasePending,
  submitError,
  releaseError,
  onSubmit,
  onRelease,
}: {
  annotation: AnnotationSampleDto;
  categoryOptions: string[];
  submitPending: boolean;
  releasePending: boolean;
  submitError?: string | null;
  releaseError?: string | null;
  onSubmit: (payload: { expectedOutput: string; notes: string }) => void;
  onRelease: () => void;
}) {
  const { t } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState(
    () =>
      normalizeClassificationAnnotationValue(
        annotation.annotatedExpectedOutput ?? annotation.expectedOutput ?? '',
        categoryOptions,
      ) ?? '',
  );
  const [notes, setNotes] = useState(() => annotation.notes ?? '');
  const sampleStatus = getAnnotationStatus(annotation);
  const canEdit = sampleStatus !== 'submitted' && !submitPending && !releasePending && categoryOptions.length > 0;
  const canSubmit = canEdit && selectedCategory.length > 0;
  const expectedOutput = formatClassificationAnnotationValue(selectedCategory);

  const selectCategory = useCallback(
    (category: string) => {
      if (!canEdit) return;
      setSelectedCategory(category);
    },
    [canEdit],
  );

  const submitCurrent = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({ expectedOutput, notes });
  }, [canSubmit, expectedOutput, notes, onSubmit]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || isTextEditingTarget(event.target)) {
        return;
      }

      const categoryIndex = getCategoryShortcutIndex(event);
      if (categoryIndex !== null && categoryIndex < categoryOptions.length) {
        event.preventDefault();
        const category = categoryOptions[categoryIndex];
        if (category) selectCategory(category);
        return;
      }

      if (isSubmitShortcut(event)) {
        event.preventDefault();
        submitCurrent();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [categoryOptions, selectCategory, submitCurrent]);

  return (
    <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <ReadableDataPanel title={t('annotations.workspace.inputVariables')} value={annotation.inputVariables} />
          <ReadableDataPanel
            title={t('annotations.workspace.modelOutput')}
            value={annotation.decisionOutput ?? annotation.parsedOutput ?? annotation.rawResponse}
          />
        </div>
        <CollapsibleReadablePanel title={t('annotations.workspace.fullPrompt')} value={annotation.renderedPrompt} />
        <ReadableEntryPanel
          title={t('annotations.workspace.runMeta')}
          entries={[
            { label: t('annotations.workspace.runResultId'), value: annotation.runResultId },
            { label: t('annotations.workspace.externalId'), value: annotation.externalId },
            {
              label: t('annotations.workspace.latency'),
              value: annotation.latencyMs ? `${annotation.latencyMs}ms` : null,
            },
            {
              label: t('annotations.workspace.tokens'),
              value: (annotation.inputTokens ?? 0) + (annotation.outputTokens ?? 0),
            },
          ]}
        />
      </div>

      <aside className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold">{t('annotations.form.title')}</h2>
            <SampleStatusBadge status={sampleStatus} />
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">{t('annotations.form.subtitle')}</p>
        </div>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>{t('annotations.form.expectedOutput')}</Label>
            {categoryOptions.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/35 px-3 py-5 text-center text-[12px] text-muted-foreground">
                {t('annotations.form.noCategoryOptions')}
              </div>
            ) : (
              <div className="grid gap-2" role="radiogroup" aria-label={t('annotations.form.expectedOutput')}>
                {categoryOptions.map((category, index) => {
                  const selected = selectedCategory === category;
                  const shortcut = index < 9 ? String(index + 1) : index === 9 ? '0' : undefined;
                  return (
                    <button
                      key={category}
                      type="button"
                      role="radio"
                      data-testid={`annotation-sample-category-${category}`}
                      aria-checked={selected}
                      aria-keyshortcuts={shortcut}
                      disabled={!canEdit}
                      onClick={() => selectCategory(category)}
                      className={cn(
                        'flex min-h-9 w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors',
                        canEdit && 'hover:bg-accent',
                        selected && 'border-primary bg-primary/5 text-primary',
                        !canEdit && 'cursor-not-allowed opacity-70',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex size-4 shrink-0 items-center justify-center rounded-full border',
                          selected ? 'border-primary' : 'border-muted-foreground/50',
                        )}
                      >
                        {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
                      </span>
                      <span className="min-w-0 break-words font-mono">{category}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {canEdit && selectedCategory.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">{t('annotations.form.expectedOutputRequired')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>{t('annotations.form.notes')}</Label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={5}
              className="min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
              placeholder={t('annotations.form.notesPlaceholder')}
            />
          </div>

          {submitError ? <FormError>{submitError}</FormError> : null}
          {releaseError ? <FormError>{releaseError}</FormError> : null}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onRelease}
              disabled={sampleStatus !== 'claimed' || submitPending || releasePending}
            >
              <RotateCcw className="size-4" />
              {releasePending ? t('annotations.form.releasing') : t('annotations.form.release')}
            </Button>
            <Button
              type="button"
              data-testid="annotation-save"
              onClick={submitCurrent}
              aria-keyshortcuts="Enter"
              disabled={!canSubmit}
            >
              <Save className="size-4" />
              {submitPending ? t('annotations.form.submitting') : t('annotations.form.submit')}
            </Button>
          </div>
        </div>
      </aside>
    </section>
  );
}

type ReadableEntry = {
  label: ReactNode;
  value: unknown;
};

function ReadableDataPanel({ title, value }: { title: ReactNode; value: unknown }) {
  const normalized = normalizeReadableValue(value);

  if (isRecord(normalized)) {
    return (
      <ReadableEntryPanel
        title={title}
        entries={Object.entries(normalized).map(([label, entryValue]) => ({
          label: formatReadableLabel(label),
          value: entryValue,
        }))}
      />
    );
  }

  return (
    <div className="min-w-0 rounded-lg border bg-card">
      <div className="border-b px-4 py-3 text-[13px] font-semibold">{title}</div>
      <div className="max-h-[360px] overflow-auto p-4">
        <ReadableValue value={normalized} />
      </div>
    </div>
  );
}

function ReadableEntryPanel({ title, entries }: { title: ReactNode; entries: ReadableEntry[] }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card">
      <div className="border-b px-4 py-3 text-[13px] font-semibold">{title}</div>
      <div className="max-h-[360px] overflow-auto p-4">
        {entries.length === 0 ? (
          <ReadableValue value={null} />
        ) : (
          <dl className="space-y-3">
            {entries.map((entry, index) => (
              <div key={index} className="min-w-0">
                <dt className="text-[11.5px] font-medium text-muted-foreground">{entry.label}</dt>
                <dd className="mt-1 text-[12.5px] leading-5">
                  <ReadableValue value={entry.value} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function CollapsibleReadablePanel({ title, value }: { title: ReactNode; value: unknown }) {
  return (
    <details className="group min-w-0 rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b px-4 py-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="max-h-[420px] overflow-auto p-4">
        <ReadableValue value={formatPromptText(value)} />
      </div>
    </details>
  );
}

function ReadableValue({ value }: { value: unknown }) {
  const text = formatReadableValue(value);
  if (text === '-') {
    return <span className="text-[12.5px] text-muted-foreground">-</span>;
  }
  return <span className="whitespace-pre-wrap break-words text-[12.5px] leading-5">{text}</span>;
}

function normalizeReadableValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatReadableLabel(label: string) {
  const withSpaces = label
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return withSpaces ? `${withSpaces.charAt(0).toUpperCase()}${withSpaces.slice(1)}` : label;
}

function formatReadableValue(value: unknown): string {
  const normalized = normalizeReadableValue(value);
  if (normalized === null || normalized === undefined || normalized === '') return '-';
  if (typeof normalized === 'string') return normalized;
  if (typeof normalized === 'number' || typeof normalized === 'boolean' || typeof normalized === 'bigint') {
    return String(normalized);
  }
  if (Array.isArray(normalized)) {
    if (normalized.length === 0) return '-';
    return normalized.map((item) => formatReadableValue(item)).join('\n\n');
  }
  if (isRecord(normalized)) {
    const entries = Object.entries(normalized);
    if (entries.length === 0) return '-';
    return entries
      .map(([label, entryValue]) => `${formatReadableLabel(label)}: ${formatReadableValue(entryValue)}`)
      .join('\n');
  }
  return String(normalized);
}

function formatPromptText(value: unknown): string {
  const normalized = normalizeReadableValue(value);
  if (normalized === null || normalized === undefined || normalized === '') return '-';
  if (typeof normalized === 'string') return normalized;
  if (Array.isArray(normalized)) return normalized.map(formatPromptMessage).join('\n\n');
  if (isRecord(normalized)) {
    const directPrompt = normalized['prompt'] ?? normalized['renderedPrompt'] ?? normalized['text'];
    if (typeof directPrompt === 'string') return directPrompt;
    const messages = normalized['messages'];
    if (Array.isArray(messages)) return messages.map(formatPromptMessage).join('\n\n');
  }
  return formatReadableValue(normalized);
}

function formatPromptMessage(message: unknown, index: number): string {
  const normalized = normalizeReadableValue(message);
  if (!isRecord(normalized)) return formatReadableValue(normalized);

  const role = typeof normalized['role'] === 'string' ? normalized['role'] : `Message ${index + 1}`;
  const content = normalized['content'] ?? normalized['text'] ?? normalized['message'] ?? normalized;
  return `${formatReadableLabel(role)}\n${formatReadableValue(content)}`;
}

function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
      {children}
    </div>
  );
}
