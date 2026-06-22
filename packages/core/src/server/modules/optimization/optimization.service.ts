import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  optimizationControlActionSchema,
  optimizationDevMockTimelineSchema,
  optimizationFieldWhitelistSchema,
  optimizationGoalSchema,
  optimizationRunConfigSchema,
  optimizationSummarySchema,
  DEFAULT_PROMPT_LANGUAGE,
  type OptimizationBestMetricsDto,
  type OptimizationSummaryDto,
  type OptimizationControlActionDto,
  type OptimizationDetailDto,
  type OptimizationDetailExperimentConfigDto,
  type OptimizationDetailGoalProgressDto,
  type OptimizationDetailGoalScopeDto,
  type OptimizationDetailGoalsLineDto,
  type OptimizationDetailIterationConfigDto,
  type OptimizationDetailIterationRoundDto,
  type OptimizationDetailMetricComparisonDto,
  type OptimizationDetailRoundGoalChipDto,
  type OptimizationDetailTrendSeriesDto,
  type OptimizationDetailTrendSeriesKeyDto,
  type OptimizationDevMockTimelineDto,
  type OptimizationFieldWhitelistDto,
  type OptimizationGoalDto,
  type OptimizationListItemDto,
  type OptimizationListQueryDto,
  type OptimizationListResponseDto,
  type OptimizationRunConfigDto,
  type OptimizationStartingModeDto,
  type OptimizationStatusDto,
  type CreateOptimizationDto,
  type PromptLanguageDto,
  composeFullPrompt,
  outputSchemaToJsonSchema,
  promptLanguageSchema,
} from '@proofhound/shared';
import { createLogger } from '@proofhound/logger';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { WorkflowAuthorizationHook } from '../../common/contracts/workflow-authorization.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { isUniqueViolation } from '../../common/errors/db-error';
import { aggregateExperimentMetrics } from '../experiment/experiment.aggregator';
import { ExperimentRepository } from '../experiment/experiment.repository';
import { ExperimentService } from '../experiment/experiment.service';
import { PromptRepository } from '../prompt/prompt.repository';
import { RunResultService } from '../run-result/run-result.service';
import { OptimizationLauncher } from './optimization.launcher';
import { SYSTEM_ACTOR_OPTIMIZATION } from './optimization.workflow';
import {
  OptimizationRepository,
  type OptimizationProjectAccessRow,
  type OptimizationRoundExperimentRow,
  type OptimizationRoundLlmRow,
  type OptimizationRoundStepKind,
  type OptimizationRoundStepRow,
  type OptimizationRow,
} from './optimization.repository';

// Logger used internally by the detail-page aggregation helper; a separate binding makes it zero-cost in production after debug is disabled,
// from the same source as this.logger in the class (both are pino instances).
const detailHelperLogger = createLogger('optimization.service.detail', { service: 'server' });

type AuditSource = 'api' | 'mcp' | 'system';
type BestMetricMap = NonNullable<OptimizationBestMetricsDto>;

interface EffectiveBestCandidate {
  metrics: BestMetricMap;
  promptVersionId: string | null;
  promptVersionNumber: number | null;
  generatedAtRoundLabel: string;
  generatedAtRoundIndex: number | null;
  experimentId: string | null;
  experimentName: string | null;
  isBaseline: boolean;
}

interface PromptBodyEntry {
  body: string | null;
  versionNumber: number;
  outputSchema: unknown;
  promptLanguage?: string | null;
}

@Injectable()
export class OptimizationService {
  private readonly logger = createLogger('optimization.service', { service: 'server' });

  constructor(
    private readonly repo: OptimizationRepository,
    private readonly launcher: OptimizationLauncher,
    private readonly experimentRepo: ExperimentRepository,
    private readonly experimentService: ExperimentService,
    private readonly runResults: RunResultService,
    private readonly promptRepo: PromptRepository,
    private readonly accessControl: AccessControlService,
    private readonly workflowAuth: WorkflowAuthorizationHook,
  ) {}

  async listOptimizations(
    projectId: string,
    actor: CurrentUserPayload,
    query: OptimizationListQueryDto = {},
  ): Promise<OptimizationListResponseDto> {
    await this.getAccessibleProject(projectId, actor);

    const allRows = await this.repo.listOptimizations(projectId);
    // On demand, load round experiments + round_steps per optimization:
    // - experiments populate trend (LiveCard sparkline)
    // - round_steps allow the list to show the latest round and update time even during analysis/generation/child-experiment startup
    const allItems: OptimizationListItemDto[] = [];
    for (const row of allRows) {
      const [rounds, roundSteps] = await Promise.all([
        this.repo.listRoundExperimentsForOptimization(row.id),
        this.repo.listRoundStepsForOptimization(row.id),
      ]);
      const liveRounds = await this.withLiveRoundMetrics(rounds);
      const liveProjection = deriveLiveProjection(row, liveRounds, roundSteps);
      const { values: trend, hasBaseline } = this.deriveListTrend(row, liveRounds);
      allItems.push(
        this.toListItem(row, {
          trend,
          trendHasBaseline: hasBaseline,
          currentRound: liveProjection.currentRound,
          updatedAt: liveProjection.updatedAt,
        }),
      );
    }
    const filtered = this.filterItems(allItems, query);
    const data = this.sortItems(filtered, query.sort);

    return { data, total: data.length };
  }

  async getOptimization(
    projectId: string,
    optimizationId: string,
    actor: CurrentUserPayload,
  ): Promise<OptimizationDetailDto> {
    await this.getAccessibleProject(projectId, actor);

    const row = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!row) {
      throw new NotFoundException(`Optimization ${optimizationId} not found`);
    }
    // Fetch concurrently: experiments + LLM run_results + round_steps, then merge and feed into toDetail.
    const [rounds, llmRows, roundSteps] = await Promise.all([
      this.repo.listRoundExperimentsForOptimization(optimizationId),
      this.repo.listOptimizationLlmRunResults(optimizationId),
      this.repo.listRoundStepsForOptimization(optimizationId),
    ]);
    // For running rounds, add a layer of live aggregate between batch aggregation steps (mirroring ExperimentService.withLiveMetrics),
    // so that the detail page's 5-second refresh of the progress bar / quality metrics advances with run_results in real time, rather than being stuck on the last batch-written snapshot.
    const liveRounds = await this.withLiveRoundMetrics(rounds);
    const versionIds = collectPromptVersionIds(row, liveRounds, llmRows);
    const promptBodyMap = await this.repo.loadPromptVersionsByIds(versionIds);
    return this.toDetail(row, { rounds: liveRounds, llmRows, roundSteps, promptBodyMap });
  }

  // Isomorphic to ExperimentService.withLiveMetrics: only triggered for running rounds; aggregates from ph_runs.run_results in real time
  // to override processedSamples / failedSamples / metrics, so deriveTrendSeries / deriveRoundDetails /
  // buildExperimentResult / goalChips all move along. Empty aggregate (no terminal row yet in run_results) → keep the snapshot,
  // to avoid regressing progress to 0/null. Terminal rounds are untouched and continue to read the snapshot, to avoid a GROUP BY on every GET.
  private async withLiveRoundMetrics(
    rounds: OptimizationRoundExperimentRow[],
  ): Promise<OptimizationRoundExperimentRow[]> {
    if (rounds.length === 0) return rounds;
    return Promise.all(
      rounds.map(async (round) => {
        if (round.status !== 'running' || !round.experimentId) return round;
        const [aggRows, latency] = await Promise.all([
          this.runResults.aggregateExperiment(round.experimentId),
          this.runResults.aggregateExperimentLatency(round.experimentId),
        ]);
        const live = aggregateExperimentMetrics(aggRows, latency);
        // Empty aggregate (no terminal row yet in run_results) → keep the experiments snapshot to avoid regressing progress to 0/null
        if (live.totalCount === 0) return round;
        return {
          ...round,
          processedSamples: live.totalCount,
          failedSamples: live.failedCount,
          metrics: live.metrics,
        };
      }),
    );
  }

  async createOptimization(
    projectId: string,
    body: CreateOptimizationDto,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
    // orgId (SaaS-only; undefined in OSS) is sourced from the resolved ProjectContext — the project's org is the
    // rate-limit bucket (SPEC 08 §3.7). Threaded into launcher.launch → runWorkflow → snapshot.orgId so the worker
    // composes an org-scoped limiter key; child-experiment launches inside the workflow inherit it from the snapshot.
    orgId?: string,
  ): Promise<OptimizationListItemDto> {
    await this.getWritableProject(projectId, actor);
    const existing = await this.repo.findOptimizationByProjectAndName(projectId, body.name);
    if (existing) {
      throw new ConflictException('optimization_name_taken');
    }

    let resolvedPromptId = body.promptId ?? null;
    let resolvedBaseVersionId = body.baseVersionId ?? null;
    const requestedPromptLanguage = body.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
    const dataset = await this.repo.findDatasetForOptimization(projectId, body.datasetId);
    if (!dataset) {
      throw new BadRequestException('dataset_not_found_or_archived');
    }
    let workflowStartAuthorized = false;
    const assertWorkflowStart = async () => {
      if (workflowStartAuthorized) return;
      await this.workflowAuth.assertCanStart(toActorContext(actor), { projectId, orgId, source: 'local' }, 'optimization');
      workflowStartAuthorized = true;
    };

    if (
      body.startingMode === 'from_experiment' &&
      body.sourceExperimentId &&
      (!resolvedPromptId || !resolvedBaseVersionId)
    ) {
      const sourceExperiment = await this.experimentRepo.findExperimentById(projectId, body.sourceExperimentId);
      if (!sourceExperiment) {
        throw new BadRequestException(`Source experiment ${body.sourceExperimentId} not found`);
      }
      resolvedBaseVersionId ??= sourceExperiment.promptVersionId;
      resolvedPromptId ??= sourceExperiment.promptId;
    }

    // SPEC 25 §2: the baseline version for the from_prompt_version start is auto-selected by the system
    //   Prefer prompts.current_online_version_id; otherwise take the latest version number of this prompt.
    if (body.startingMode === 'from_prompt_version' && resolvedPromptId && !resolvedBaseVersionId) {
      resolvedBaseVersionId = await this.repo.findActiveVersionIdForPrompt(resolvedPromptId);
      if (!resolvedBaseVersionId) {
        throw new BadRequestException(`Prompt ${resolvedPromptId} has no usable version for optimization`);
      }
    }

    // SPEC 25 §2.1: for from_dataset_only start, auto-create an empty prompt as the carrier entity;
    // baseVersionId stays null until workflow.generateFirstVersionStep backfills it.
    if (body.startingMode === 'from_dataset_only' && !resolvedPromptId) {
      if (!body.analysisModelId) {
        throw new BadRequestException('analysis_model_required_for_dataset_only_starting_mode');
      }
      if (resolvedBaseVersionId) {
        throw new BadRequestException('base_version_must_be_unset_for_dataset_only_starting_mode');
      }
      await assertWorkflowStart();
      resolvedPromptId = await this.createPlaceholderPromptWithRetry({
        projectId,
        datasetName: dataset.name,
        optimizationName: body.name,
        datasetId: body.datasetId,
        promptLanguage: requestedPromptLanguage,
        createdBy: actor.sub,
      });
    }

    const resolvedPromptLanguage = await this.resolvePromptLanguage(body.promptLanguage, resolvedBaseVersionId);
    if (resolvedBaseVersionId) {
      const promptVersion = await this.repo.findUsablePromptVersion(projectId, resolvedBaseVersionId);
      if (!promptVersion || promptVersion.promptDeletedAt) {
        throw new BadRequestException('prompt_version_not_found');
      }
      if (promptVersion.promptStatus === 'archived') {
        throw new BadRequestException('prompt_archived');
      }
    }

    await assertWorkflowStart();

    const insertedId = await this.insertOptimizationOrThrowNameConflict({
      projectId,
      name: body.name,
      description: body.description ?? null,
      optimizationHint: normalizeOptimizationHint(body.optimizationHint),
      strategy: body.strategy,
      strategyConfig: body.strategyConfig ?? {},
      startingMode: body.startingMode,
      sourceExperimentId: body.sourceExperimentId ?? null,
      promptId: resolvedPromptId,
      baseVersionId: resolvedBaseVersionId,
      datasetId: body.datasetId,
      experimentModelId: body.experimentModelId,
      analysisModelId: body.analysisModelId,
      promptLanguage: resolvedPromptLanguage,
      status: 'running',
      goals: body.goals,
      fieldWhitelist: body.fieldWhitelist ?? null,
      runConfig: body.runConfig ?? {},
      maxRounds: body.loopLimits.maxRounds,
      createdBy: actor.sub,
    });

    let workflowId: string | null = null;
    try {
      workflowId = await this.launcher.launch(insertedId, orgId);
    } catch (error) {
      const reason = `launch_failed: ${(error as Error).message}`;
      const now = new Date();
      await this.repo.updateOptimization(projectId, insertedId, {
        status: 'failed',
        controlState: null,
        finishedAt: now,
        summary: { kind: 'failed', reason, finalizedAt: now.toISOString() },
      });
      throw error;
    }

    const inserted = await this.repo.findOptimizationById(projectId, insertedId);
    if (!inserted) {
      throw new NotFoundException(`Optimization ${insertedId} not found after insert`);
    }

    return this.toListItem(inserted);
  }

  private async resolvePromptLanguage(
    requested: PromptLanguageDto | undefined,
    baseVersionId: string | null,
  ): Promise<PromptLanguageDto> {
    if (requested) return requested;
    if (!baseVersionId) return DEFAULT_PROMPT_LANGUAGE;
    const stored = await this.repo.findPromptVersionLanguage(baseVersionId);
    const parsed = promptLanguageSchema.safeParse(stored);
    return parsed.success ? parsed.data : DEFAULT_PROMPT_LANGUAGE;
  }

  private async insertOptimizationOrThrowNameConflict(
    input: Parameters<OptimizationRepository['insertOptimization']>[0],
  ): Promise<string> {
    try {
      return await this.repo.insertOptimization(input);
    } catch (error) {
      if (isOptimizationNameUniqueViolation(error)) {
        throw new ConflictException('optimization_name_taken');
      }
      throw error;
    }
  }

  // SPEC 25 §2.1: in from_dataset_only mode, create an empty prompt to carry the first version.
  // Naming rule `<localized-prefix>-${datasetName}-${ISO time down to the minute}`; on prompts_project_name_unique collision,
  // retry once with an 8-char hash suffix appended; a second collision → throw prompt_name_collision_v1.
  private async createPlaceholderPromptWithRetry(input: {
    projectId: string;
    datasetName: string;
    optimizationName: string;
    datasetId: string;
    promptLanguage: PromptLanguageDto;
    createdBy: string;
  }): Promise<string> {
    const baseName = buildOptimizationPromptName(input.datasetName, new Date(), input.promptLanguage);
    try {
      return await this.promptRepo.createPlaceholderPromptForOptimization({
        projectId: input.projectId,
        name: baseName,
        defaultDatasetId: input.datasetId,
        createdBy: input.createdBy,
      });
    } catch (err) {
      if (!isPromptNameUniqueViolation(err)) throw err;
      const suffix = `-${shortHash(`${input.optimizationName}|${Date.now()}`)}`;
      try {
        return await this.promptRepo.createPlaceholderPromptForOptimization({
          projectId: input.projectId,
          name: `${baseName}${suffix}`,
          defaultDatasetId: input.datasetId,
          createdBy: input.createdBy,
        });
      } catch (err2) {
        if (isPromptNameUniqueViolation(err2)) {
          throw new ConflictException('prompt_name_collision_v1');
        }
        throw err2;
      }
    }
  }

  async controlOptimization(
    projectId: string,
    optimizationId: string,
    action: OptimizationControlActionDto,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
    // orgId (SaaS-only; undefined in OSS) sourced from the resolved ProjectContext — the project's org is the
    // rate-limit bucket (SPEC 08 §3.7). Threaded into launcher.resume on the resume path.
    orgId?: string,
  ): Promise<OptimizationListItemDto> {
    await this.getWritableProject(projectId, actor);
    const parsedAction = optimizationControlActionSchema.parse(action);

    const current = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!current) {
      throw new NotFoundException(`Optimization ${optimizationId} not found`);
    }

    const patch = this.getControlPatch(parsedAction, current);
    await this.repo.updateOptimization(projectId, optimizationId, patch);

    // SPEC 25 §7 dual-path linkage: on stop/cancel, immediately call controlExperiment on the child; do not block the parent control write to DB
    // resume is not linked here — child experiment resume is handled by the workflow in the isResumeRound branch via controlChildExperimentStep
    if (parsedAction === 'stop' || parsedAction === 'cancel') {
      await this.tryLinkChildExperimentControl(optimizationId, parsedAction);
    }

    if (parsedAction === 'resume') {
      await this.workflowAuth.assertCanStart(toActorContext(actor), { projectId, orgId, source: 'local' }, 'optimization');
      await this.launcher.resume(optimizationId, orgId);
    }

    const updated = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!updated) {
      throw new NotFoundException(`Optimization ${optimizationId} not found after update`);
    }

    return this.toListItem(updated);
  }

  // SPEC 25 §7: stop/cancel on the parent optimization immediately propagates to the active child experiment. Best-effort:
  //   - no active child experiment (already terminal / not yet created) → no-op
  //   - service throws Conflict / NotFound → warn and swallow (the workflow poll is the backstop)
  //   - other errors → warn and swallow (do not throw, to avoid blocking the parent control_state write)
  private async tryLinkChildExperimentControl(optimizationId: string, action: 'stop' | 'cancel'): Promise<void> {
    const activeChild = await this.repo.findActiveChildExperiment(optimizationId);
    if (!activeChild) return;
    try {
      await this.experimentService.controlExperiment(
        activeChild.projectId,
        activeChild.id,
        action,
        SYSTEM_ACTOR_OPTIMIZATION,
        'system',
      );
      this.logger.info(
        {
          optimizationId,
          childExperimentId: activeChild.id,
          roundIndex: activeChild.roundIndex,
          action,
        },
        'optimization_child_control_linked_from_service',
      );
    } catch (error) {
      const level: 'skipped' | 'failed' =
        error instanceof ConflictException || error instanceof NotFoundException ? 'skipped' : 'failed';
      this.logger.warn(
        {
          optimizationId,
          childExperimentId: activeChild.id,
          action,
          err: (error as Error).message,
        },
        `optimization_child_control_${level}`,
      );
    }
  }

  async deleteOptimization(
    projectId: string,
    optimizationId: string,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<void> {
    void source;
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!row) {
      throw new NotFoundException(`Optimization ${optimizationId} not found`);
    }

    await this.repo.hardDeleteOptimization(projectId, optimizationId);
  }

  // ----------------------------- helpers -----------------------------

  private async getAccessibleProject(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<OptimizationProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  private async getWritableProject(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<OptimizationProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    return this.getAccessibleProject(projectId, actor);
  }

  private getControlPatch(action: OptimizationControlActionDto, row: OptimizationRow) {
    const status = row.status as OptimizationStatusDto;
    const now = new Date();

    if (action === 'stop') {
      if (status !== 'running') {
        throw new ConflictException('optimization_stop_invalid_status');
      }
      // Preemptive terminal-state write: set status='stopped' + control_state='stop' + finished_at in one shot.
      // The workflow will call finalize once the current LLM step finishes, but repo.finalize has a status='running' guard,
      // so the second write is skipped — avoiding overwriting the terminal state already written by service, and avoiding finished_at drift.
      // control_state is preserved; on the next round the workflow reads status as terminal and exits directly.
      return {
        status: 'stopped' as const,
        controlState: 'stop' as const,
        finishedAt: now,
        updatedAt: now,
      };
    }

    if (action === 'resume') {
      if (status !== 'stopped') {
        throw new ConflictException('optimization_resume_invalid_status');
      }
      return {
        status: 'running' as const,
        controlState: 'resume' as const,
        startedAt: row.startedAt ?? now,
        finishedAt: null,
        updatedAt: now,
      };
    }

    if (status === 'success' || status === 'cancelled') {
      throw new ConflictException('optimization_cancel_invalid_status');
    }
    // cancel is preemptive in the same way (regardless of whether the original status was running or stopped/failed).
    return {
      status: 'cancelled' as const,
      controlState: 'cancel' as const,
      finishedAt: now,
      updatedAt: now,
    };
  }

  private toListItem(
    row: OptimizationRow,
    options: {
      trend?: number[] | null;
      trendHasBaseline?: boolean;
      currentRound?: number;
      updatedAt?: Date;
    } = {},
  ): OptimizationListItemDto {
    return {
      trend: options.trend ?? null,
      trendHasBaseline: options.trendHasBaseline ?? false,
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      strategy: row.strategy,
      startingMode: row.startingMode as OptimizationStartingModeDto,
      status: row.status as OptimizationStatusDto,
      controlState: row.controlState as OptimizationListItemDto['controlState'],

      sourceExperimentId: row.sourceExperimentId,
      sourceExperimentName: row.sourceExperimentName,
      promptId: row.promptId,
      promptName: row.promptName,
      baseVersionId: row.baseVersionId,
      baseVersionNumber: row.baseVersionNumber,
      datasetId: row.datasetId,
      datasetName: row.datasetName,
      datasetSamples: row.datasetSamples,
      experimentModelId: row.experimentModelId,
      experimentModelName: row.experimentModelName,
      analysisModelId: row.analysisModelId,
      analysisModelName: row.analysisModelName,
      promptLanguage: this.parsePromptLanguage(row.promptLanguage),

      goals: this.parseGoals(row.goals),
      fieldWhitelist: this.parseFieldWhitelist(row.fieldWhitelist),
      runConfig: this.parseRunConfig(row.runConfig),
      maxRounds: row.maxRounds,
      currentRound: options.currentRound ?? row.currentRound,
      bestVersionId: row.bestVersionId,
      bestVersionNumber: row.bestVersionNumber,
      bestMetrics: this.parseBestMetrics(row.bestMetrics),
      summary: this.parseSummary(row.summary),
      analysisFailureReason: this.parseAnalysisFailureReason(row.analysisFailureReason),

      dbosWorkflowId: row.dbosWorkflowId,
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName,
      createdByUsername: row.createdByUsername,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: (options.updatedAt ?? row.updatedAt).toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private toDetail(
    row: OptimizationRow,
    aggregation: {
      rounds: OptimizationRoundExperimentRow[];
      llmRows: OptimizationRoundLlmRow[];
      roundSteps?: OptimizationRoundStepRow[];
      promptBodyMap?: Map<string, PromptBodyEntry>;
    } = { rounds: [], llmRows: [], roundSteps: [] },
  ): OptimizationDetailDto {
    const roundSteps = aggregation.roundSteps ?? [];
    const hasSourceMetrics =
      row.sourceExperimentMetrics &&
      typeof row.sourceExperimentMetrics === 'object' &&
      Object.keys(row.sourceExperimentMetrics as Record<string, unknown>).length > 0;
    // Real data sources: experiments ∪ round_steps ∪ source experiment metrics (baseline). If any is non-empty, take the real-aggregate path.
    // The presence of round_steps means that as soon as prepareRoundImpl starts (error_analysis=running),
    // the round is visible on the detail page without waiting for the child experiment to be created;
    // when baseline metrics exist, even round 0 takes the real-aggregate path so the metrics trend card immediately shows the baseline first point.
    const realRounds = aggregation.rounds.length > 0 || roundSteps.length > 0 || hasSourceMetrics;
    this.logger.debug(
      {
        optimizationId: row.id,
        status: row.status,
        roundsLen: aggregation.rounds.length,
        llmRowsLen: aggregation.llmRows.length,
        roundStepsLen: roundSteps.length,
        llmRowsBySource: aggregation.llmRows.reduce<Record<string, number>>((acc, r) => {
          acc[r.source] = (acc[r.source] ?? 0) + 1;
          return acc;
        }, {}),
        realRounds,
      },
      'optimization_detail_aggregate_start',
    );
    const liveProjection = deriveLiveProjection(row, aggregation.rounds, roundSteps);
    const listTrend = this.deriveListTrend(row, aggregation.rounds);
    const base = this.toListItem(row, {
      trend: listTrend.values,
      trendHasBaseline: listTrend.hasBaseline,
      currentRound: liveProjection.currentRound,
      updatedAt: liveProjection.updatedAt,
    });
    const ownerHandle = row.createdByUsername ? `@${row.createdByUsername}` : (row.createdByDisplayName ?? '—');
    const startedAt = row.startedAt;
    const finishedAt = row.finishedAt;
    const elapsedMs = startedAt ? Math.max(0, (finishedAt ?? new Date()).getTime() - startedAt.getTime()) : null;
    const goalScope = this.deriveGoalScope(base.goals);
    const goalsLines = this.deriveGoalsLines(base.goals);
    const experimentConfig = this.deriveExperimentConfig(row, base.runConfig);
    const iterationConfig = this.deriveIterationConfig(row, base.runConfig);
    const sourceMetrics =
      row.sourceExperimentMetrics && typeof row.sourceExperimentMetrics === 'object'
        ? (row.sourceExperimentMetrics as Record<string, unknown>)
        : null;
    const derivedBaseline = this.deriveBaseline(row, sourceMetrics, aggregation.promptBodyMap ?? new Map());
    const derivedBestRoundLabel = row.bestVersionNumber ? `v${row.bestVersionNumber}` : null;

    if (realRounds) {
      // Real aggregate
      const trend = this.deriveTrendSeries(base.goals, aggregation.rounds, sourceMetrics, base.startingMode);
      const rounds = this.deriveRoundDetails(
        aggregation.rounds,
        aggregation.llmRows,
        roundSteps,
        aggregation.promptBodyMap ?? new Map(),
        row.baseVersionId,
        base.goals,
        sourceMetrics,
        base.startingMode,
      );
      const effectiveBest = this.deriveEffectiveBest(
        row,
        aggregation.rounds,
        base.goals,
        base.bestMetrics,
        sourceMetrics,
        base.startingMode,
      );
      const goalProgress = this.deriveGoalProgress(base.goals, effectiveBest?.metrics ?? null);
      const bestVersion = this.deriveBestVersion(row, effectiveBest);
      const bestRoundLabel = bestVersion ? bestVersion.generatedAtRoundLabel : derivedBestRoundLabel;
      const baseline = derivedBaseline;

      return {
        ...base,
        optimizationHint: normalizeOptimizationHint(row.optimizationHint),
        ownerHandle,
        elapsedMs,
        experimentConfig,
        iterationConfig,
        goalScope,
        goalsLines,
        controlStrip: null,
        trend,
        trendBaselineRef: null,
        bestRoundLabel,
        rounds,
        baseline,
        goalProgress,
        bestVersion,
      };
    }

    // No real data → fall back to the dev mock (dev seed for demo / e2e)
    const mock = this.extractDevMockTimeline(base.runConfig);
    this.logger.debug(
      {
        optimizationId: row.id,
        reason: 'no_real_rounds',
        hasDevMock: !!mock,
        mockRoundsLen: mock?.rounds?.length ?? 0,
      },
      'optimization_detail_using_dev_mock',
    );
    const baseline =
      derivedBaseline && mock?.baselineMetrics
        ? { ...derivedBaseline, metrics: mock.baselineMetrics }
        : derivedBaseline;

    return {
      ...base,
      optimizationHint: normalizeOptimizationHint(row.optimizationHint),
      ownerHandle,
      elapsedMs,
      experimentConfig,
      iterationConfig,
      goalScope,
      goalsLines,
      controlStrip: mock?.controlStrip ?? null,
      trend: mock?.trend ?? [],
      trendBaselineRef: mock?.trendBaselineRef ?? null,
      bestRoundLabel: mock?.bestRoundLabel ?? derivedBestRoundLabel,
      rounds: mock?.rounds ?? [],
      baseline,
      goalProgress: mock?.goalProgress ?? [],
      bestVersion: mock?.bestVersion ?? null,
    };
  }

  private deriveListTrend(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
  ): { values: number[] | null; hasBaseline: boolean } {
    const goals = this.parseGoals(row.goals);
    const primary = goals[0]?.metric;
    if (!primary) return { values: null, hasBaseline: false };
    const baselineMetrics =
      row.sourceExperimentMetrics && typeof row.sourceExperimentMetrics === 'object'
        ? (row.sourceExperimentMetrics as Record<string, unknown>)
        : null;
    const sortedRounds = rounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);
    if (row.startingMode === 'from_dataset_only') {
      const baselineRound = sortedRounds.find((r) => r.roundIndex === 0);
      const baselineValue = extractMetric(baselineRound?.metrics ?? baselineMetrics, primary);
      const roundValues = sortedRounds
        .filter((r) => r.roundIndex > 0)
        .map((r) => extractMetric(r.metrics, primary))
        .filter((v): v is number => v !== null);
      const values: number[] = baselineValue !== null ? [baselineValue, ...roundValues] : roundValues;
      return { values: values.length > 0 ? values : null, hasBaseline: baselineValue !== null };
    }
    const baselineValue = baselineMetrics ? extractMetric(baselineMetrics, primary) : null;
    const hasBaseline = baselineValue !== null;
    const roundValues = sortedRounds
      .map((r) => extractMetric(r.metrics, primary))
      .filter((v): v is number => v !== null);
    const values: number[] = hasBaseline ? [baselineValue, ...roundValues] : roundValues;
    return { values: values.length > 0 ? values : null, hasBaseline };
  }

  private deriveTrendSeries(
    goals: OptimizationGoalDto[],
    rounds: OptimizationRoundExperimentRow[],
    baselineMetrics: Record<string, unknown> | null = null,
    startingMode?: OptimizationStartingModeDto | string,
  ): OptimizationDetailTrendSeriesDto[] {
    const sorted = rounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);
    const keyCandidates: Array<{ key: OptimizationDetailTrendSeriesKeyDto; metric: string }> = [
      { key: 'accuracy', metric: 'accuracy' },
      { key: 'recall', metric: 'recall' },
      { key: 'fpr', metric: 'fpr' },
    ];
    const series: OptimizationDetailTrendSeriesDto[] = [];
    for (const { key, metric } of keyCandidates) {
      const datasetBaselineRound =
        startingMode === 'from_dataset_only' ? sorted.find((r) => r.roundIndex === 0) : undefined;
      const baselineValue =
        startingMode === 'from_dataset_only'
          ? extractMetric(datasetBaselineRound?.metrics ?? baselineMetrics, metric)
          : baselineMetrics
            ? extractMetric(baselineMetrics, metric)
            : null;
      const optimizationRounds = startingMode === 'from_dataset_only' ? sorted.filter((r) => r.roundIndex > 0) : sorted;
      const roundValues = optimizationRounds
        .map((r) => extractMetric(r.metrics, metric))
        .filter((v): v is number => v !== null);
      const hasBaseline = baselineValue !== null;
      const values: number[] = hasBaseline ? [baselineValue, ...roundValues] : roundValues;
      if (values.length === 0) continue;
      const matchingGoal = goals.find((g) => g.metric === metric);
      // bestRoundIndex still points to the best index within the round set (excluding baseline) to preserve prop semantics
      let bestRoundIndex: number | undefined;
      if (roundValues.length > 0) {
        let bestIdx = 0;
        for (let i = 1; i < roundValues.length; i++) {
          if (
            matchingGoal?.comparator === 'lte'
              ? roundValues[i]! < roundValues[bestIdx]!
              : roundValues[i]! > roundValues[bestIdx]!
          ) {
            bestIdx = i;
          }
        }
        bestRoundIndex = bestIdx;
      }
      series.push({
        key,
        labelKey: `optimizations.metrics.${key}`,
        betterIsLower: matchingGoal?.comparator === 'lte',
        values,
        target: matchingGoal?.target,
        bestRoundIndex,
        hasBaseline,
      });
    }
    return series;
  }

  private deriveRoundDetails(
    rounds: OptimizationRoundExperimentRow[],
    llmRows: OptimizationRoundLlmRow[],
    roundSteps: OptimizationRoundStepRow[],
    promptBodyMap: Map<string, PromptBodyEntry>,
    baseVersionId: string | null,
    goals: OptimizationGoalDto[],
    baselineMetrics: Record<string, unknown> | null,
    startingMode: OptimizationStartingModeDto | string,
  ): OptimizationDetailIterationRoundDto[] {
    const llmByRound = new Map<number, OptimizationRoundLlmRow[]>();
    for (const llm of llmRows) {
      const arr = llmByRound.get(llm.roundIndex) ?? [];
      arr.push(llm);
      llmByRound.set(llm.roundIndex, arr);
    }
    // Index the experiments rows by roundIndex; when missing (analysis/generation stage), use stepsByRound to render the card separately
    const experimentByRound = new Map<number, OptimizationRoundExperimentRow>();
    for (const r of rounds) experimentByRound.set(r.roundIndex, r);
    const stepsByRound = new Map<number, OptimizationRoundStepRow[]>();
    for (const s of roundSteps) {
      const arr = stepsByRound.get(s.roundIndex) ?? [];
      arr.push(s);
      stepsByRound.set(s.roundIndex, arr);
    }
    // Merge the roundIndex set → sort and generate cards one by one
    const allIndexes = new Set<number>([...rounds.map((r) => r.roundIndex), ...roundSteps.map((s) => s.roundIndex)]);
    const sortedIndexes = Array.from(allIndexes).sort((a, b) => a - b);
    // Also maintain a sortedExperiments list (containing only rounds that actually have an experiment row), used solely as the historical-data fallback.
    // Prefer the new data: prompt_versions.parent_version_id / generate run_result.prompt_version_id,
    // so the diff aligns with "from which prompt was the current version actually generated".
    const sortedExperiments = rounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);

    return sortedIndexes.map((idx): OptimizationDetailIterationRoundDto => {
      const experiment = experimentByRound.get(idx) ?? null;
      const isDatasetBaseline = startingMode === 'from_dataset_only' && idx === 0;
      const stepsForRound = stepsByRound.get(idx) ?? [];
      const stepDtos = mapStepRowsToDtos(stepsForRound);
      // status derivation: when steps data is present, derive from steps (the experiment row is not visible during the analysis / generation stage);
      // otherwise fall back to experiment.status.
      const status = isDatasetBaseline
        ? deriveDatasetBaselineStatus(stepDtos, experiment?.status)
        : deriveRoundStatusFromSteps(stepDtos, experiment?.status);
      const llms = llmByRound.get(idx) ?? [];
      const analysis = llms.find((r) => r.source === 'optimization_analysis');
      const generate = llms.find((r) => r.source === 'optimization_generate');
      this.logger.debug(
        {
          roundIndex: idx,
          status,
          hasAnalysis: !!analysis,
          hasGenerate: !!generate,
          hasExperiment: !!experiment,
          llmRowsForRoundLen: llms.length,
          stepsForRoundLen: stepDtos.length,
          analysisStatus: analysis?.status,
          generateStatus: generate?.status,
        },
        'optimization_detail_round_derive',
      );
      const analysisText = analysis ? extractAnalysisSummary(analysis, idx) : undefined;
      const generateText = isDatasetBaseline ? extractGenerateSummary(generate, idx) : undefined;
      const errorPatterns = isDatasetBaseline ? undefined : extractErrorPatterns(analysis, idx);
      const improvementSuggestions = isDatasetBaseline ? undefined : extractImprovementSuggestions(analysis, idx);
      const prevVersionId = isDatasetBaseline
        ? null
        : resolvePromptDiffBaseVersionId(experiment, generate, sortedExperiments, baseVersionId);
      const promptDiff = experiment
        ? buildPromptDiff(experiment, generate, prevVersionId, promptBodyMap)
        : buildPromptDiffWithoutExperiment(generate, idx, prevVersionId, promptBodyMap);
      const experimentResult = experiment ? buildExperimentResult(experiment, baselineMetrics) : undefined;
      const goalChips = this.buildRoundGoalChips(goals, experiment);
      const { autoPatched, patchedVariables } = extractAutoPatchInfo(generate);
      return {
        index: idx,
        status,
        isBaseline: isDatasetBaseline || experiment?.isBaseline === true ? true : undefined,
        kindLabel: isDatasetBaseline ? 'dataset baseline' : `Round ${idx}`,
        startedAt: experiment?.startedAt?.toISOString(),
        metrics: experiment ? extractRoundMetricCells(experiment.metrics) : [],
        promptVersionId: experiment?.promptVersionId ?? null,
        experimentId: experiment?.experimentId ?? null,
        summaryFallback: generateText ?? analysisText,
        errorPatterns,
        improvementSuggestions,
        promptDiff,
        experimentResult,
        steps: stepDtos,
        goalChips,
        autoPatched,
        patchedVariables,
      };
    });
  }

  private deriveGoalProgress(
    goals: OptimizationGoalDto[],
    bestMetrics: OptimizationBestMetricsDto,
  ): OptimizationDetailGoalProgressDto[] {
    return goals.map((goal) => {
      const current = typeof bestMetrics?.[goal.metric] === 'number' ? (bestMetrics[goal.metric] as number) : null;
      const achieved: OptimizationDetailGoalProgressDto['achieved'] =
        current === null
          ? 'miss'
          : goal.comparator === 'gte'
            ? current >= goal.target
              ? 'hit'
              : 'miss'
            : goal.comparator === 'gt'
              ? current > goal.target
                ? 'hit'
                : 'miss'
              : current <= goal.target
                ? 'hit'
                : 'miss';
      const comparatorText = goal.comparator === 'gte' ? '≥' : goal.comparator === 'gt' ? '>' : '≤';
      const percent =
        current === null ? 0 : Math.min(100, Math.max(0, Math.round((current / Math.max(0.0001, goal.target)) * 100)));
      return {
        label: this.formatMetricLabel(goal.metric),
        targetText: `${comparatorText} ${goal.target}`,
        currentText: current === null ? '—' : current.toFixed(3),
        achieved,
        percent,
      };
    });
  }

  // The "goal vs current round" chip list shown at the top-right of each round card header.
  // overall scope reads metrics[goal.metric]; class scope reads from metrics.perClass by label.
  private buildRoundGoalChips(
    goals: OptimizationGoalDto[],
    experiment: OptimizationRoundExperimentRow | null,
  ): OptimizationDetailRoundGoalChipDto[] {
    if (!experiment) return goals.map((g) => this.makeRoundGoalChip(g, null));
    const metricsObj =
      experiment.metrics && typeof experiment.metrics === 'object'
        ? (experiment.metrics as Record<string, unknown>)
        : null;
    if (!metricsObj) return goals.map((g) => this.makeRoundGoalChip(g, null));
    return goals.map((g) => {
      let current: number | null = null;
      if (g.scope === 'overall') {
        current = typeof metricsObj[g.metric] === 'number' ? (metricsObj[g.metric] as number) : null;
      } else {
        const perClass = Array.isArray(metricsObj['perClass']) ? metricsObj['perClass'] : [];
        const entry = perClass.find(
          (x): x is Record<string, unknown> =>
            !!x && typeof x === 'object' && (x as Record<string, unknown>)['label'] === g.scope,
        );
        current = entry && typeof entry[g.metric] === 'number' ? (entry[g.metric] as number) : null;
      }
      return this.makeRoundGoalChip(g, current);
    });
  }

  private makeRoundGoalChip(goal: OptimizationGoalDto, current: number | null): OptimizationDetailRoundGoalChipDto {
    const comparator = goal.comparator === 'gte' ? '≥' : goal.comparator === 'gt' ? '>' : '≤';
    const achieved: OptimizationDetailRoundGoalChipDto['achieved'] =
      current === null
        ? 'miss'
        : goal.comparator === 'gte'
          ? current >= goal.target
            ? 'hit'
            : 'miss'
          : goal.comparator === 'gt'
            ? current > goal.target
              ? 'hit'
              : 'miss'
            : current <= goal.target
              ? 'hit'
              : 'miss';
    const metricLabel = this.formatMetricLabel(goal.metric);
    const label = goal.scope === 'overall' ? metricLabel : `${goal.scope} ${metricLabel}`;
    return {
      label,
      targetText: `${comparator} ${goal.target}`,
      currentText: current === null ? '—' : current.toFixed(3),
      achieved,
    };
  }

  private deriveEffectiveBest(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
    goals: OptimizationGoalDto[],
    bestMetrics: OptimizationBestMetricsDto,
    sourceMetrics: Record<string, unknown> | null,
    startingMode: OptimizationStartingModeDto | string,
  ): EffectiveBestCandidate | null {
    const persistedBest = this.derivePersistedBestCandidate(row, rounds, bestMetrics);
    const baselineBest = this.deriveBaselineBestCandidate(row, rounds, sourceMetrics, startingMode);
    if (!baselineBest) return persistedBest;
    if (!persistedBest) return baselineBest;
    return this.isBetterBestMetrics(baselineBest.metrics, persistedBest.metrics, goals) ? baselineBest : persistedBest;
  }

  private derivePersistedBestCandidate(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
    bestMetrics: OptimizationBestMetricsDto,
  ): EffectiveBestCandidate | null {
    if (!row.bestVersionId || !bestMetrics) return null;
    const bestRound = rounds.find((r) => r.promptVersionId === row.bestVersionId);
    return {
      metrics: bestMetrics,
      promptVersionId: row.bestVersionId,
      promptVersionNumber: row.bestVersionNumber,
      generatedAtRoundLabel: row.bestVersionNumber ? `v${row.bestVersionNumber}` : '—',
      generatedAtRoundIndex: bestRound?.roundIndex ?? null,
      experimentId: bestRound?.experimentId ?? null,
      experimentName: bestRound?.experimentName ?? null,
      isBaseline: false,
    };
  }

  private deriveBaselineBestCandidate(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
    sourceMetrics: Record<string, unknown> | null,
    startingMode: OptimizationStartingModeDto | string,
  ): EffectiveBestCandidate | null {
    const baselineRound = rounds.find(
      (r) => r.isBaseline === true || (startingMode === 'from_dataset_only' && r.roundIndex === 0),
    );
    const metrics = this.parseBestMetrics(baselineRound?.metrics ?? sourceMetrics);
    if (!metrics) return null;
    return {
      metrics,
      promptVersionId: baselineRound?.promptVersionId ?? row.sourceExperimentPromptVersionId ?? row.baseVersionId,
      promptVersionNumber:
        baselineRound?.promptVersionNumber ?? row.sourceExperimentPromptVersionNumber ?? row.baseVersionNumber,
      generatedAtRoundLabel: 'baseline',
      generatedAtRoundIndex: 0,
      experimentId: baselineRound?.experimentId ?? row.sourceExperimentId,
      experimentName: baselineRound?.experimentName ?? row.sourceExperimentName,
      isBaseline: true,
    };
  }

  private isBetterBestMetrics(candidate: BestMetricMap, current: BestMetricMap, goals: OptimizationGoalDto[]): boolean {
    if (goals.length === 0) return false;
    const candidateUnmet = this.unmetGoalCount(candidate, goals);
    const currentUnmet = this.unmetGoalCount(current, goals);
    if (candidateUnmet !== currentUnmet) return candidateUnmet < currentUnmet;
    return this.directionalGoalScore(candidate, goals) > this.directionalGoalScore(current, goals);
  }

  private unmetGoalCount(metrics: BestMetricMap, goals: OptimizationGoalDto[]): number {
    let count = 0;
    for (const goal of goals) {
      const value = this.readBestMetric(metrics, goal);
      const hit =
        value !== null &&
        (goal.comparator === 'gte'
          ? value >= goal.target
          : goal.comparator === 'gt'
            ? value > goal.target
            : value <= goal.target);
      if (!hit) count += 1;
    }
    return count;
  }

  private directionalGoalScore(metrics: BestMetricMap, goals: OptimizationGoalDto[]): number {
    let score = 0;
    for (const goal of goals) {
      const value = this.readBestMetric(metrics, goal);
      score += value === null ? Number.NEGATIVE_INFINITY : goal.comparator === 'lte' ? -value : value;
    }
    return score;
  }

  private readBestMetric(metrics: BestMetricMap, goal: OptimizationGoalDto): number | null {
    const value = metrics[goal.metric];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private deriveBestVersion(
    row: OptimizationRow,
    best: EffectiveBestCandidate | null,
  ): OptimizationDetailDto['bestVersion'] {
    if (!best) return null;
    const metricCells = Object.entries(best.metrics).map(([k, v]) => ({ label: this.formatMetricLabel(k), value: v }));
    return {
      promptRef: row.promptName ?? '—',
      promptVersion: best.promptVersionNumber ? `v${best.promptVersionNumber}` : '—',
      generatedAtRoundLabel: best.generatedAtRoundLabel,
      generatedAtRoundIndex: best.generatedAtRoundIndex,
      metrics: metricCells,
      experimentRef: best.experimentName ?? '—',
      promptVersionId: best.promptVersionId,
      experimentId: best.experimentId,
    };
  }

  private extractDevMockTimeline(runConfig: OptimizationRunConfigDto): OptimizationDevMockTimelineDto | null {
    const raw = (runConfig as Record<string, unknown>)['devMockTimeline'];
    if (raw === undefined || raw === null) return null;
    const parsed = optimizationDevMockTimelineSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private deriveGoalScope(goals: OptimizationGoalDto[]): OptimizationDetailGoalScopeDto {
    const classes = Array.from(new Set(goals.map((g) => g.scope).filter((scope) => scope && scope !== 'overall')));
    if (classes.length === 0) return { kind: 'overall' };
    return { kind: 'class', classes };
  }

  private deriveGoalsLines(goals: OptimizationGoalDto[]): OptimizationDetailGoalsLineDto[] {
    return goals.map((goal) => {
      const tone: OptimizationDetailGoalsLineDto['tone'] = goal.scope === 'overall' ? 'overall' : 'class';
      const label =
        goal.scope === 'overall'
          ? this.formatMetricLabel(goal.metric)
          : `${this.formatMetricLabel(goal.metric)} · ${goal.scope}`;
      const comparatorText = goal.comparator === 'gte' ? '≥' : goal.comparator === 'gt' ? '>' : '≤';
      const targetText = `${comparatorText} ${goal.target}`;
      return { label, targetText, tone };
    });
  }

  private formatMetricLabel(metric: string): string {
    if (!metric) return metric;
    if (metric === 'fpr') return 'FPR';
    if (metric === 'f1') return 'F1';
    return metric.charAt(0).toUpperCase() + metric.slice(1);
  }

  private deriveExperimentConfig(
    row: OptimizationRow,
    runConfig: OptimizationRunConfigDto,
  ): OptimizationDetailExperimentConfigDto | null {
    if (!row.datasetName || !row.experimentModelName) return null;
    const promptVersion = row.baseVersionNumber ? `v${row.baseVersionNumber}` : '—';
    const baselineExperiment = row.sourceExperimentName ?? '—';
    return {
      datasetName: row.datasetName,
      promptName: row.promptName ?? '—',
      promptVersion,
      modelName: row.experimentModelName,
      baselineExperiment,
      temperature: typeof runConfig.temperature === 'number' ? runConfig.temperature : 0,
      concurrency: typeof runConfig.concurrency === 'number' ? runConfig.concurrency : 0,
      rpm: typeof runConfig.rpmLimit === 'number' ? runConfig.rpmLimit : 0,
      tpm: typeof runConfig.tpmLimit === 'number' ? runConfig.tpmLimit : 0,
    };
  }

  private deriveIterationConfig(
    row: OptimizationRow,
    runConfig: OptimizationRunConfigDto,
  ): OptimizationDetailIterationConfigDto | null {
    if (!row.analysisModelName) return null;
    const noImprovement = (runConfig as Record<string, unknown>)['stopAfterNoImprovementRounds'];
    const regressionRaw = (runConfig as Record<string, unknown>)['regressionThreshold'];
    return {
      analysisModel: row.analysisModelName,
      strategy: row.strategy,
      maxRounds: row.maxRounds,
      noImprovementStop: typeof noImprovement === 'number' ? noImprovement : 0,
      regressionThreshold: typeof regressionRaw === 'number' ? regressionRaw : 0,
    };
  }

  private deriveBaseline(
    row: OptimizationRow,
    sourceMetrics: Record<string, unknown> | null,
    promptBodyMap: Map<string, PromptBodyEntry>,
  ): OptimizationDetailDto['baseline'] {
    if (!row.sourceExperimentName) return null;
    const promptVersionId = row.baseVersionId ?? row.sourceExperimentPromptVersionId;
    const promptVersion = row.baseVersionNumber ?? row.sourceExperimentPromptVersionNumber;
    const prompt = promptVersionId ? promptBodyMap.get(promptVersionId) : undefined;
    const promptPreview = prompt
      ? composeFullPrompt(prompt.body ?? '', outputSchemaToJsonSchema(prompt.outputSchema), {
          language: this.parsePromptLanguage(prompt.promptLanguage),
        })
      : null;
    const baselineExperiment = buildBaselineExperimentRow(row);
    return {
      promptVersion: promptVersion ? `v${promptVersion}` : '—',
      baselineExperiment: row.sourceExperimentName,
      metrics: extractRoundMetricCells(sourceMetrics),
      promptPreview,
      ...(baselineExperiment ? { experimentResult: buildExperimentResult(baselineExperiment, null) } : {}),
    };
  }

  private parseGoals(value: unknown): OptimizationGoalDto[] {
    const parse = optimizationGoalSchema.array().safeParse(value ?? []);
    if (!parse.success) {
      const legacy = this.parseLegacyGoals(value);
      if (legacy) return legacy;
      throw new BadRequestException('optimization_goals_invalid');
    }
    return parse.data;
  }

  private parseLegacyGoals(value: unknown): OptimizationGoalDto[] | null {
    const entries = Array.isArray(value) ? value : [value];
    const goals = entries.map((entry) => this.parseLegacyGoal(entry));
    return goals.every((goal): goal is OptimizationGoalDto => goal !== null) ? goals : null;
  }

  private parseLegacyGoal(value: unknown): OptimizationGoalDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const legacy = value as Record<string, unknown>;
    const metric = legacy['primary_metric'] ?? legacy['metric'];
    const target = legacy['target'] ?? legacy['value'];
    const comparator = legacy['comparator'] ?? legacy['op'] ?? 'gte';
    const scope = legacy['scope'] ?? 'overall';
    const parse = optimizationGoalSchema.safeParse({ metric, comparator, target, scope });
    return parse.success ? parse.data : null;
  }

  private parseFieldWhitelist(value: unknown): OptimizationFieldWhitelistDto | null {
    if (value === null || value === undefined) return null;
    const parse = optimizationFieldWhitelistSchema.safeParse(value);
    return parse.success ? parse.data : null;
  }

  private parseRunConfig(value: unknown): OptimizationRunConfigDto {
    const parse = optimizationRunConfigSchema.safeParse(value ?? {});
    return parse.success ? parse.data : {};
  }

  private parsePromptLanguage(value: unknown): PromptLanguageDto {
    const parse = promptLanguageSchema.safeParse(value);
    return parse.success ? parse.data : DEFAULT_PROMPT_LANGUAGE;
  }

  private parseBestMetrics(value: unknown): OptimizationBestMetricsDto {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    const result: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'number' && Number.isFinite(entry)) result[key] = entry;
    }
    return result;
  }

  private parseSummary(value: unknown): OptimizationSummaryDto | null {
    if (value === null || value === undefined) return null;
    const parse = optimizationSummarySchema.safeParse(value);
    if (!parse.success) return null;
    // reason may contain upstream API payload; truncate to 500 chars to prevent leakage
    const reason = parse.data.reason.length > 500 ? `${parse.data.reason.slice(0, 500)}…` : parse.data.reason;
    return { ...parse.data, reason };
  }

  private parseAnalysisFailureReason(value: string | null): string | null {
    if (!value) return null;
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  private filterItems(items: OptimizationListItemDto[], query: OptimizationListQueryDto) {
    const search = query.search?.trim().toLowerCase();
    return items.filter((item) => {
      if (query.status && item.status !== query.status) return false;
      if (!search) return true;
      return [
        item.name,
        item.description ?? '',
        item.datasetName,
        item.experimentModelName,
        item.analysisModelName,
        item.sourceExperimentName ?? '',
        item.promptName ?? '',
        item.createdByDisplayName ?? '',
        item.createdByUsername ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }

  private sortItems(items: OptimizationListItemDto[], sort: OptimizationListQueryDto['sort']) {
    return [...items].sort((a, b) => {
      if (sort === 'bestMetric') {
        const av = this.bestMetricScalar(a.bestMetrics);
        const bv = this.bestMetricScalar(b.bestMetrics);
        return bv - av;
      }
      if (sort === 'round') {
        return b.currentRound / Math.max(1, b.maxRounds) - a.currentRound / Math.max(1, a.maxRounds);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  private bestMetricScalar(metrics: OptimizationBestMetricsDto): number {
    if (!metrics) return -1;
    const values = Object.values(metrics).filter((value) => Number.isFinite(value));
    return values.length === 0 ? -1 : Math.max(...values);
  }
}

// ---------------- module helpers ----------------

function deriveLiveProjection(
  row: OptimizationRow,
  rounds: OptimizationRoundExperimentRow[],
  roundSteps: OptimizationRoundStepRow[],
): { currentRound: number; updatedAt: Date } {
  let currentRound = row.currentRound;
  let updatedAt = row.updatedAt;
  const baselineRoundIndexes = new Set<number>();
  const progressRoundIndexes: number[] = [];

  for (const round of rounds) {
    if (isBaselineProgressRound(round)) {
      baselineRoundIndexes.add(round.roundIndex);
    } else if (isProgressRoundIndex(round.roundIndex)) {
      progressRoundIndexes.push(round.roundIndex);
    }
    updatedAt = latestDate(updatedAt, round.updatedAt, round.finishedAt, round.startedAt);
  }
  for (const step of roundSteps) {
    if (!isProgressRoundIndex(step.roundIndex)) {
      baselineRoundIndexes.add(step.roundIndex);
    } else {
      progressRoundIndexes.push(step.roundIndex);
    }
    updatedAt = latestDate(updatedAt, step.updatedAt, step.finishedAt, step.startedAt, step.createdAt);
  }

  if (baselineRoundIndexes.size > 0 && progressRoundIndexes.length === 0) {
    currentRound = 0;
  } else if (baselineRoundIndexes.has(currentRound) && !progressRoundIndexes.some((index) => index >= currentRound)) {
    currentRound = progressRoundIndexes.length > 0 ? Math.max(...progressRoundIndexes) : 0;
  }
  for (const roundIndex of progressRoundIndexes) {
    currentRound = Math.max(currentRound, roundIndex);
  }

  return {
    currentRound: Math.min(Math.max(0, row.maxRounds), Math.max(0, currentRound)),
    updatedAt,
  };
}

function isBaselineProgressRound(round: OptimizationRoundExperimentRow): boolean {
  return round.isBaseline === true || round.roundIndex <= 0;
}

function isProgressRoundIndex(roundIndex: number): boolean {
  return roundIndex > 0;
}

function latestDate(current: Date, ...candidates: Array<Date | null | undefined>): Date {
  let latest = current;
  for (const candidate of candidates) {
    if (candidate && candidate.getTime() > latest.getTime()) latest = candidate;
  }
  return latest;
}

// Map ph_runs.optimization_round_steps rows to DTO, sorted in a fixed order
// (error_analysis → generate_prompt → experiment); the frontend stepper indexes by this order.
const STEP_ORDER: OptimizationRoundStepKind[] = ['error_analysis', 'generate_prompt', 'experiment'];

function mapStepRowsToDtos(
  rows: OptimizationRoundStepRow[],
): NonNullable<OptimizationDetailIterationRoundDto['steps']> {
  const byKind = new Map<OptimizationRoundStepKind, OptimizationRoundStepRow>();
  for (const r of rows) byKind.set(r.step, r);
  const out: NonNullable<OptimizationDetailIterationRoundDto['steps']> = [];
  for (const kind of STEP_ORDER) {
    const row = byKind.get(kind);
    if (!row) continue;
    out.push({
      step: row.step,
      status: row.status,
      errorClass: row.errorClass,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      runResultId: row.runResultId,
      experimentId: row.experimentId,
    });
  }
  return out;
}

// Derive the round card's overall status from steps:
//   - any step running → running (highest priority, because this round is still in flight)
//   - any step failed  → failed
//   - all success      → success
//   - all skipped      → paused
//   - none of the above (only pending) → fall back to experiment.status
function deriveRoundStatusFromSteps(
  steps: NonNullable<OptimizationDetailIterationRoundDto['steps']>,
  experimentStatus: string | undefined,
): OptimizationDetailIterationRoundDto['status'] {
  if (steps.length === 0) {
    // When there is no round_steps data, fall back to the original logic: based on the status of the experiments row
    if (experimentStatus === 'success') return 'success';
    if (experimentStatus === 'failed') return 'failed';
    if (experimentStatus === 'stopped') return 'paused';
    return 'running';
  }
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.length > 0 && steps.every((s) => s.status === 'success')) return 'success';
  if (steps.length > 0 && steps.every((s) => s.status === 'skipped')) return 'paused';
  return 'running';
}

function deriveDatasetBaselineStatus(
  steps: NonNullable<OptimizationDetailIterationRoundDto['steps']>,
  experimentStatus: string | undefined,
): OptimizationDetailIterationRoundDto['status'] {
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (!experimentStatus) return 'running';
  if (experimentStatus === 'success') return 'success';
  if (experimentStatus === 'failed') return 'failed';
  if (experimentStatus === 'stopped') return 'paused';
  return 'running';
}

function parsePromptLanguageValue(value: unknown): PromptLanguageDto {
  const parse = promptLanguageSchema.safeParse(value);
  return parse.success ? parse.data : DEFAULT_PROMPT_LANGUAGE;
}

// If the experiment row is not yet created (analysis/generation stage), still try to reconstruct promptDiff from the generate run_result.
// If promptVersionNumber is unavailable, fall back to a round-N label.
function buildPromptDiffWithoutExperiment(
  generate: OptimizationRoundLlmRow | undefined,
  roundIndex: number,
  prevVersionId: string | null,
  promptBodyMap: Map<string, PromptBodyEntry>,
): OptimizationDetailIterationRoundDto['promptDiff'] {
  if (!generate) {
    detailHelperLogger.debug(
      {
        roundIndex,
        status: 'no_generate',
        hasGenerate: false,
        hasNewBody: false,
        hasPrev: !!prevVersionId,
        path: 'without_experiment',
      },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const newBody = extractGeneratedPromptBody(generate);
  if (!newBody) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_new_body', path: 'without_experiment', generateRowStatus: generate.status },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const prev = prevVersionId ? promptBodyMap.get(prevVersionId) : undefined;
  const current = generate.promptVersionId ? promptBodyMap.get(generate.promptVersionId) : undefined;
  const effectiveNewSchema = extractGeneratedOutputSchema(
    generate,
    current?.outputSchema ?? prev?.outputSchema ?? null,
  );
  // Bridge to standard JSON Schema before handing it to composeFullPrompt, ensuring the diff aligns with the path actually sent to the business LLM.
  const fromText = composeFullPrompt(prev?.body ?? '', outputSchemaToJsonSchema(prev?.outputSchema), {
    language: parsePromptLanguageValue(prev?.promptLanguage),
  });
  const toText = composeFullPrompt(newBody, outputSchemaToJsonSchema(effectiveNewSchema), {
    language: parsePromptLanguageValue(current?.promptLanguage ?? prev?.promptLanguage),
  });
  const fromLabel = prev?.versionNumber ? `v${prev.versionNumber}` : 'baseline';
  return {
    from: fromLabel,
    to: `Round ${roundIndex}`,
    fromText,
    toText,
    lines: [],
  };
}

function extractMetric(metrics: unknown, key: string): number | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const v = (metrics as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function extractAnalysisSummary(row: OptimizationRoundLlmRow, roundIndex: number): string | undefined {
  const parsedOutputKeys =
    row.parsedOutput && typeof row.parsedOutput === 'object'
      ? Object.keys(row.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  const rawLen = typeof row.rawResponse === 'string' ? row.rawResponse.length : 0;
  if (row.parsedOutput && typeof row.parsedOutput === 'object') {
    const obj = row.parsedOutput as Record<string, unknown>;
    if (typeof obj['summary'] === 'string') {
      detailHelperLogger.debug(
        { roundIndex, resolvedFrom: 'summary', parsedOutputKeys, rawLen, status: row.status },
        'optimization_detail_analysis_summary_resolve',
      );
      return obj['summary'] as string;
    }
    if (typeof obj['errorAnalysisText'] === 'string') {
      detailHelperLogger.debug(
        { roundIndex, resolvedFrom: 'errorAnalysisText', parsedOutputKeys, rawLen, status: row.status },
        'optimization_detail_analysis_summary_resolve',
      );
      return obj['errorAnalysisText'] as string;
    }
  }
  if (typeof row.rawResponse === 'string' && row.rawResponse.length > 0) {
    detailHelperLogger.debug(
      { roundIndex, resolvedFrom: 'raw', parsedOutputKeys, rawLen, status: row.status },
      'optimization_detail_analysis_summary_resolve',
    );
    return row.rawResponse.slice(0, 400);
  }
  detailHelperLogger.debug(
    { roundIndex, resolvedFrom: 'none', parsedOutputKeys, rawLen, status: row.status },
    'optimization_detail_analysis_summary_resolve',
  );
  return undefined;
}

function extractRoundMetricCells(metrics: unknown): OptimizationDetailIterationRoundDto['metrics'] {
  if (!metrics || typeof metrics !== 'object') return [];
  const out: OptimizationDetailIterationRoundDto['metrics'] = [];
  for (const [k, v] of Object.entries(metrics as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push({ label: k, value: v });
    }
  }
  return out;
}

export function collectPromptVersionIds(
  row: OptimizationRow,
  rounds: OptimizationRoundExperimentRow[],
  llmRows: OptimizationRoundLlmRow[] = [],
): string[] {
  const ids: string[] = [];
  if (row.baseVersionId) ids.push(row.baseVersionId);
  if (row.sourceExperimentPromptVersionId) ids.push(row.sourceExperimentPromptVersionId);
  for (const round of rounds) {
    if (round.promptVersionId) ids.push(round.promptVersionId);
    if (round.parentVersionId) ids.push(round.parentVersionId);
  }
  for (const llm of llmRows) {
    if (llm.promptVersionId) ids.push(llm.promptVersionId);
  }
  return Array.from(new Set(ids));
}

function resolvePromptDiffBaseVersionId(
  experiment: OptimizationRoundExperimentRow | null,
  generate: OptimizationRoundLlmRow | undefined,
  sortedExperiments: OptimizationRoundExperimentRow[],
  baseVersionId: string | null,
): string | null {
  if (experiment?.parentVersionId) return experiment.parentVersionId;
  if (generate?.promptVersionId) return generate.promptVersionId;

  // Legacy fallback: when parent_version_id / generate prompt_version_id are missing,
  // fall back to the historical "previous experiment prompt" semantics.
  const prevExperimentIdx = sortedExperiments.findIndex((r) => r.roundIndex === experiment?.roundIndex);
  const prevExperiment = prevExperimentIdx > 0 ? (sortedExperiments[prevExperimentIdx - 1] ?? null) : null;
  return prevExperiment?.promptVersionId ?? baseVersionId;
}

function extractErrorPatterns(
  analysis: OptimizationRoundLlmRow | undefined,
  roundIndex: number,
): OptimizationDetailIterationRoundDto['errorPatterns'] {
  if (!analysis) {
    detailHelperLogger.debug({ roundIndex, status: 'no_analysis' }, 'optimization_detail_error_patterns_resolve');
    return undefined;
  }
  const parsedOutputKeys =
    analysis.parsedOutput && typeof analysis.parsedOutput === 'object'
      ? Object.keys(analysis.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  if (!analysis.parsedOutput || typeof analysis.parsedOutput !== 'object') {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_parsed_output', parsedOutputKeys, analysisRowStatus: analysis.status },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  const obj = analysis.parsedOutput as Record<string, unknown>;
  const raw = obj['errorPatterns'];
  if (!Array.isArray(raw)) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_array', parsedOutputKeys },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  if (raw.length === 0) {
    detailHelperLogger.debug(
      { roundIndex, status: 'empty_array', parsedOutputKeys, rawLen: 0 },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  const parsed: Array<{ label: string; count: number; reason: string }> = [];
  let filteredCount = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      filteredCount += 1;
      continue;
    }
    const i = item as Record<string, unknown>;
    const label = typeof i['label'] === 'string' ? (i['label'] as string) : null;
    if (!label) {
      filteredCount += 1;
      continue;
    }
    const count = typeof i['count'] === 'number' && Number.isFinite(i['count']) ? (i['count'] as number) : 0;
    const reason = typeof i['reason'] === 'string' ? (i['reason'] as string) : '';
    parsed.push({ label, count, reason });
  }
  if (parsed.length === 0) {
    detailHelperLogger.debug(
      { roundIndex, status: 'all_filtered', parsedOutputKeys, rawLen: raw.length, filteredCount },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  detailHelperLogger.debug(
    {
      roundIndex,
      status: 'ok',
      parsedOutputKeys,
      rawLen: raw.length,
      keptCount: parsed.length,
      filteredCount,
    },
    'optimization_detail_error_patterns_resolve',
  );
  const total = parsed.reduce((acc, p) => acc + p.count, 0);
  return parsed.map((p) => ({
    percent: total > 0 ? Math.round((p.count / total) * 100) : 0,
    title: p.label,
    detail: p.reason,
    count: { hit: p.count, total },
  }));
}

function extractImprovementSuggestions(
  analysis: OptimizationRoundLlmRow | undefined,
  roundIndex: number,
): OptimizationDetailIterationRoundDto['improvementSuggestions'] {
  if (!analysis) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_analysis' },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  const parsedOutputKeys =
    analysis.parsedOutput && typeof analysis.parsedOutput === 'object'
      ? Object.keys(analysis.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  if (!analysis.parsedOutput || typeof analysis.parsedOutput !== 'object') {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_parsed_output', parsedOutputKeys, analysisRowStatus: analysis.status },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  const obj = analysis.parsedOutput as Record<string, unknown>;
  const raw = obj['suggestedChanges'];
  if (!Array.isArray(raw)) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_array', parsedOutputKeys },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  if (raw.length === 0) {
    detailHelperLogger.debug(
      { roundIndex, status: 'empty_array', parsedOutputKeys },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  const out: NonNullable<OptimizationDetailIterationRoundDto['improvementSuggestions']> = [];
  let missingSection = 0;
  let missingChange = 0;
  let nonObject = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      nonObject += 1;
      continue;
    }
    const i = item as Record<string, unknown>;
    const section = typeof i['section'] === 'string' ? (i['section'] as string) : null;
    const change = typeof i['change'] === 'string' ? (i['change'] as string) : null;
    if (!section) missingSection += 1;
    if (!change) missingChange += 1;
    if (!section || !change) continue;
    const rationale = typeof i['rationale'] === 'string' ? (i['rationale'] as string) : '';
    const rawPriority = i['priority'];
    const priority =
      rawPriority === 'high' || rawPriority === 'medium' || rawPriority === 'low' ? rawPriority : undefined;
    out.push({
      section,
      title: change,
      detail: rationale || undefined,
      priority,
    });
  }
  if (out.length === 0) {
    detailHelperLogger.debug(
      {
        roundIndex,
        status: 'all_filtered',
        parsedOutputKeys,
        rawLen: raw.length,
        missingSection,
        missingChange,
        nonObject,
      },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  detailHelperLogger.debug(
    {
      roundIndex,
      status: 'ok',
      parsedOutputKeys,
      rawLen: raw.length,
      keptCount: out.length,
      missingSection,
      missingChange,
      nonObject,
    },
    'optimization_detail_improvement_suggestions_resolve',
  );
  return out;
}

function buildPromptDiff(
  round: OptimizationRoundExperimentRow,
  generate: OptimizationRoundLlmRow | undefined,
  prevVersionId: string | null,
  promptBodyMap: Map<string, PromptBodyEntry>,
): OptimizationDetailIterationRoundDto['promptDiff'] {
  const roundIndex = round.roundIndex;
  if (!generate) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_generate', hasGenerate: false, hasNewBody: false, hasPrev: !!prevVersionId },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const generateParsedKeys =
    generate.parsedOutput && typeof generate.parsedOutput === 'object'
      ? Object.keys(generate.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  const newBody = extractGeneratedPromptBody(generate);
  if (!newBody) {
    detailHelperLogger.debug(
      {
        roundIndex,
        status: 'no_new_body',
        hasGenerate: true,
        hasNewBody: false,
        hasPrev: !!prevVersionId,
        generateRowStatus: generate.status,
        generateParsedKeys,
      },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const prev = prevVersionId ? promptBodyMap.get(prevVersionId) : undefined;
  const current = round.promptVersionId ? promptBodyMap.get(round.promptVersionId) : undefined;
  const effectiveNewSchema = extractGeneratedOutputSchema(
    generate,
    current?.outputSchema ?? prev?.outputSchema ?? null,
  );
  // Bridge to standard JSON Schema before handing it to composeFullPrompt, ensuring the diff aligns with the path actually sent to the business LLM.
  const fromText = composeFullPrompt(prev?.body ?? '', outputSchemaToJsonSchema(prev?.outputSchema), {
    language: parsePromptLanguageValue(prev?.promptLanguage),
  });
  const toText = composeFullPrompt(newBody, outputSchemaToJsonSchema(effectiveNewSchema), {
    language: parsePromptLanguageValue(current?.promptLanguage ?? prev?.promptLanguage),
  });
  const toLabel = round.promptVersionNumber ? `v${round.promptVersionNumber}` : `Round ${round.roundIndex}`;
  const fromLabel = prev?.versionNumber ? `v${prev.versionNumber}` : 'baseline';
  detailHelperLogger.debug(
    {
      roundIndex,
      status: prev ? 'ok' : 'no_prev_version',
      hasGenerate: true,
      hasNewBody: true,
      hasPrev: !!prev,
      generateRowStatus: generate.status,
      generateParsedKeys,
      prevVersionId,
      newBodyLen: newBody.length,
      fromTextLen: fromText.length,
      schemaChanged: effectiveNewSchema !== (prev?.outputSchema ?? null),
    },
    'optimization_detail_prompt_diff_resolve',
  );
  return {
    from: fromLabel,
    to: toLabel,
    fromText,
    toText,
    lines: [],
  };
}

function extractGeneratedPromptBody(generate: OptimizationRoundLlmRow | undefined): string | null {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') return null;
  const obj = generate.parsedOutput as Record<string, unknown>;
  const body = obj['newPromptBody'];
  if (typeof body === 'string' && body.length > 0) return body;
  return null;
}

function extractGenerateSummary(generate: OptimizationRoundLlmRow | undefined, roundIndex: number): string | undefined {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') {
    detailHelperLogger.debug(
      { roundIndex, status: generate ? 'no_parsed_output' : 'no_generate' },
      'optimization_detail_generate_summary_resolve',
    );
    return undefined;
  }
  const obj = generate.parsedOutput as Record<string, unknown>;
  const summary = obj['changeSummary'];
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return summary.trim().slice(0, 400);
  }
  return undefined;
}

// SPEC 25 §11: when generate retries are exhausted and placeholders are still missing, parsedOutput records autoPatched=true + a patchedVariables array.
// The frontend round card renders a "system patch" chip based on this, alerting the user to manually tweak the placeholder embedding. autoPatched=false / missing field → undefined,
// keeping the DTO field optional so legacy rounds are not polluted.
function extractAutoPatchInfo(generate: OptimizationRoundLlmRow | undefined): {
  autoPatched?: boolean;
  patchedVariables?: string[];
} {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') {
    return {};
  }
  const obj = generate.parsedOutput as Record<string, unknown>;
  if (obj['autoPatched'] !== true) return {};
  const vars = Array.isArray(obj['patchedVariables'])
    ? (obj['patchedVariables'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return { autoPatched: true, patchedVariables: vars };
}

// Extract the outputSchema actually in effect for this round from the generate run_result:
// prefer parsedOutput.newOutputSchema (written when the LLM provided one and it passed validation); otherwise fall back (baseline / previous version schema).
// safeValidateNewOutputSchema has already validated this on write; here we only check the "object shape" without re-validating,
// to avoid having historical rounds' display behavior affected by new validation rules.
function extractGeneratedOutputSchema(
  generate: OptimizationRoundLlmRow | undefined,
  fallbackOldSchema: unknown,
): unknown {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') {
    return fallbackOldSchema;
  }
  const obj = generate.parsedOutput as Record<string, unknown>;
  const candidate = obj['newOutputSchema'];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate;
  }
  return fallbackOldSchema;
}

function buildBaselineExperimentRow(row: OptimizationRow): OptimizationRoundExperimentRow | null {
  if (!row.sourceExperimentId || !row.sourceExperimentName || !row.sourceExperimentStatus) return null;
  return {
    experimentId: row.sourceExperimentId,
    experimentName: row.sourceExperimentName,
    roundIndex: 0,
    isBaseline: true,
    promptVersionId: row.sourceExperimentPromptVersionId ?? row.baseVersionId ?? '',
    promptVersionNumber: row.sourceExperimentPromptVersionNumber ?? row.baseVersionNumber,
    parentVersionId: null,
    status: row.sourceExperimentStatus,
    metrics: row.sourceExperimentMetrics,
    failureReason: row.sourceExperimentFailureReason,
    startedAt: row.sourceExperimentStartedAt,
    finishedAt: row.sourceExperimentFinishedAt,
    totalSamples: Math.max(0, row.sourceExperimentTotalSamples ?? row.datasetSamples),
    processedSamples: Math.max(0, row.sourceExperimentProcessedSamples ?? 0),
    failedSamples: Math.max(0, row.sourceExperimentFailedSamples ?? 0),
  };
}

function buildExperimentResult(
  round: OptimizationRoundExperimentRow,
  baselineMetrics: Record<string, unknown> | null,
): OptimizationDetailIterationRoundDto['experimentResult'] {
  if (!round.experimentId) return undefined;
  const status: NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['experimentStatus'] =
    round.status === 'success' ? 'success' : round.status === 'failed' ? 'failed' : 'running';
  const samplesDone = Math.max(0, round.processedSamples);
  const samplesTotal = Math.max(samplesDone, round.totalSamples);
  const metricsObj =
    round.metrics && typeof round.metrics === 'object' ? (round.metrics as Record<string, unknown>) : null;
  const accuracy = metricsObj && typeof metricsObj['accuracy'] === 'number' ? (metricsObj['accuracy'] as number) : null;
  const correct = accuracy !== null ? Math.round(accuracy * samplesDone) : 0;
  const wrong = Math.max(0, samplesDone - correct);
  const elapsed = formatElapsed(round.startedAt, round.finishedAt);
  const inputTokens =
    metricsObj && typeof metricsObj['inputTokens'] === 'number' ? (metricsObj['inputTokens'] as number) : null;
  const outputTokens =
    metricsObj && typeof metricsObj['outputTokens'] === 'number' ? (metricsObj['outputTokens'] as number) : null;
  const costEstimate =
    metricsObj && typeof metricsObj['costEstimate'] === 'number' ? (metricsObj['costEstimate'] as number) : null;
  const tokenSummary =
    inputTokens !== null && outputTokens !== null
      ? `${formatThousands(inputTokens)} → ${formatThousands(outputTokens)} tok`
      : '—';
  const costLabel = costEstimate !== null ? `$${costEstimate.toFixed(4)}` : '—';
  const vsLabel = 'baseline';
  const overallRow = buildOverallRow(metricsObj, baselineMetrics, vsLabel);
  const classRows = buildClassRows(metricsObj, baselineMetrics, vsLabel);
  return {
    experimentRef: round.experimentName || `Round ${round.roundIndex}`,
    experimentStatus: status,
    samplesDone,
    samplesTotal,
    correct,
    wrong,
    elapsed,
    tokenSummary,
    costLabel,
    overallRow,
    classRows,
    vsPrevLabel: vsLabel,
  };
}

function buildOverallRow(
  metricsObj: Record<string, unknown> | null,
  baselineMetricsObj: Record<string, unknown> | null,
  vsLabel: string,
): NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['overallRow'] {
  if (!metricsObj) return null;
  const accuracy = typeof metricsObj['accuracy'] === 'number' ? (metricsObj['accuracy'] as number) : null;
  const precision = typeof metricsObj['precision'] === 'number' ? (metricsObj['precision'] as number) : null;
  const recall = typeof metricsObj['recall'] === 'number' ? (metricsObj['recall'] as number) : null;
  if (accuracy === null && precision === null && recall === null) return null;
  const baselineAccuracy =
    baselineMetricsObj && typeof baselineMetricsObj['accuracy'] === 'number'
      ? (baselineMetricsObj['accuracy'] as number)
      : null;
  const baselinePrecision =
    baselineMetricsObj && typeof baselineMetricsObj['precision'] === 'number'
      ? (baselineMetricsObj['precision'] as number)
      : null;
  const baselineRecall =
    baselineMetricsObj && typeof baselineMetricsObj['recall'] === 'number'
      ? (baselineMetricsObj['recall'] as number)
      : null;
  const accuracyComparison = buildMetricComparison(accuracy, baselineAccuracy, vsLabel);
  const precisionComparison = buildMetricComparison(precision, baselinePrecision, vsLabel);
  const recallComparison = buildMetricComparison(recall, baselineRecall, vsLabel);
  const vsDelta = accuracyComparison?.value ?? null;
  const vsTone: 'ok' | 'bad' | 'neutral' = accuracyComparison?.tone ?? 'neutral';
  const deltas = compactMetricComparisons({
    accuracy: accuracyComparison,
    precision: precisionComparison,
    recall: recallComparison,
  });
  return {
    accuracy: accuracy ?? 0,
    precision: precision ?? 0,
    recall: recall ?? 0,
    vsLabel,
    vsDelta,
    vsTone,
    ...(deltas ? { deltas } : {}),
  };
}

function buildClassRows(
  metricsObj: Record<string, unknown> | null,
  baselineMetricsObj: Record<string, unknown> | null,
  vsLabel: string,
): NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['classRows'] {
  if (!metricsObj) return [];
  const perClass = metricsObj['perClass'];
  if (!Array.isArray(perClass)) return [];
  const baselinePerClass =
    baselineMetricsObj && Array.isArray(baselineMetricsObj['perClass']) ? baselineMetricsObj['perClass'] : null;
  const baselineByLabel = new Map<string, { precision: number | null; recall: number | null }>();
  if (baselinePerClass) {
    for (const item of baselinePerClass) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const label = typeof it['label'] === 'string' ? (it['label'] as string) : null;
      if (!label) continue;
      baselineByLabel.set(label, {
        precision: typeof it['precision'] === 'number' ? (it['precision'] as number) : null,
        recall: typeof it['recall'] === 'number' ? (it['recall'] as number) : null,
      });
    }
  }
  const out: NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['classRows'] = [];
  for (const item of perClass) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const label = typeof it['label'] === 'string' ? (it['label'] as string) : null;
    if (!label) continue;
    const accuracy = typeof it['accuracy'] === 'number' ? (it['accuracy'] as number) : null;
    const precision = typeof it['precision'] === 'number' ? (it['precision'] as number) : 0;
    const recall = typeof it['recall'] === 'number' ? (it['recall'] as number) : 0;
    const f1 = typeof it['f1'] === 'number' ? (it['f1'] as number) : null;
    const fpr = typeof it['fpr'] === 'number' ? (it['fpr'] as number) : null;
    const baselineEntry = baselineByLabel.get(label);
    const baselinePrecision = baselineEntry?.precision ?? null;
    const baselineRecall = baselineEntry?.recall ?? null;
    const precisionComparison = buildMetricComparison(precision, baselinePrecision, vsLabel);
    const recallComparison = buildMetricComparison(recall, baselineRecall, vsLabel);
    const vsDelta = precisionComparison?.value ?? null;
    const vsTone: 'ok' | 'bad' | 'neutral' = precisionComparison?.tone ?? 'neutral';
    const deltas = compactMetricComparisons({
      precision: precisionComparison,
      recall: recallComparison,
    });
    out.push({
      label,
      ...(accuracy !== null ? { accuracy } : {}),
      precision,
      recall,
      ...(f1 !== null ? { f1 } : {}),
      ...(fpr !== null ? { fpr } : {}),
      vsLabel,
      vsDelta,
      vsTone,
      ...(deltas ? { deltas } : {}),
    });
  }
  return out;
}

function buildMetricComparison(
  current: number | null,
  baseline: number | null,
  vsLabel: string,
  betterIsLower = false,
): OptimizationDetailMetricComparisonDto | undefined {
  if (current === null || baseline === null) return undefined;
  const value = current - baseline;
  const adjusted = betterIsLower ? -value : value;
  const tone: OptimizationDetailMetricComparisonDto['tone'] =
    adjusted > 0.001 ? 'ok' : adjusted < -0.001 ? 'bad' : 'neutral';
  return { value, vsLabel, tone, ...(betterIsLower ? { betterIsLower } : {}) };
}

function compactMetricComparisons(
  comparisons: Partial<Record<'accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto | undefined>>,
): Partial<Record<'accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto>> | undefined {
  const entries = Object.entries(comparisons).filter(
    (entry): entry is ['accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto] =>
      entry[1] !== undefined,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Partial<
    Record<'accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto>
  >;
}

function formatElapsed(startedAt: Date | null, finishedAt: Date | null): string {
  if (!startedAt) return '—';
  const end = finishedAt ?? new Date();
  const ms = Math.max(0, end.getTime() - startedAt.getTime());
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m${remSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`;
}

function formatThousands(n: number): string {
  return n.toLocaleString('en-US');
}

function normalizeOptimizationHint(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// SPEC 25 §2.1: naming rule for the prompt auto-created in from_dataset_only.
// `<localized-prefix>-${datasetName}-${YYYY-MM-DDTHH:MM}`; the localized prefix (e.g. the Chinese for "Optimization") is hardcoded inside this function
function buildOptimizationPromptName(datasetName: string, now: Date, promptLanguage: PromptLanguageDto): string {
  // toISOString outputs `YYYY-MM-DDTHH:MM:SS.sssZ`; truncate at the minute
  const iso = now.toISOString().slice(0, 16);
  if (promptLanguage === 'en-US') return `Optimization-${datasetName}-${iso}`;
  return `优化-${datasetName}-${iso}`;
}

// Suffix retry with an 8-char hash on prompts_project_name_unique collision — only possible under heavy concurrent creation in the same second
// for a secondary collision; 8-char base36 hash gives 36^8 ≈ 2.8e12 of space, which is sufficient.
function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).padStart(8, '0').slice(0, 8);
}

// pg unique_violation error detection: Drizzle / pg packages expose code='23505' and the message contains the constraint name.
function isPromptNameUniqueViolation(err: unknown): boolean {
  return isUniqueViolation(err, /idx_prompts_project_name_active|prompts_project_name_unique/);
}

function isOptimizationNameUniqueViolation(err: unknown): boolean {
  return isUniqueViolation(err, /idx_optimization_project_name_active/);
}
