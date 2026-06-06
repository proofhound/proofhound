import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfiguredInstance, DBOS } from '@dbos-inc/dbos-sdk';
import {
  DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
  type ErrorPatternAnalysisConfig,
  errorPatternAnalysisConfigSchema,
  analyzeFailures,
  generateNextVersion,
  generateInitialVersion,
  FirstVersionParseError,
  allGoalsMet,
  computeNoBestStreak,
  decideRoundOutcome,
  getOptimizationTipNames,
  isBetterThan,
  readMetric,
} from '@proofhound/optimization-strategy';
import type {
  AnalyzeFailuresResult,
  AnalysisEvidenceBundle,
  OptimizationGoal,
  FieldWhitelist,
  MetricSnapshot,
  PromptVersionRef,
  RoundHistoryEntry,
  RunResultRecord,
  SampleRecord,
  SummarizeOutput,
} from '@proofhound/optimization-strategy';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import {
  type LLMCallLogger,
  type LLMMessage,
  type ModelImageCapability,
  type ModelInvocationConfig,
  type RateLimiterLike,
} from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import {
  DEFAULT_PROMPT_LANGUAGE,
  optimizationFieldWhitelistSchema,
  optimizationGoalSchema,
  experimentRunConfigSchema,
  type OptimizationFieldWhitelistDto,
  type OptimizationGoalDto,
  type ExperimentRunConfigDto,
  type PromptVariableDto,
  type PromptLanguageDto,
  type PromptOutputSchemaDto,
  type PromptJudgmentRulesDto,
  type ProjectContext,
  promptLanguageSchema,
  promptVariableSchema,
} from '@proofhound/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { LimiterKeyStrategy } from '../../common/contracts/limiter-key.strategy';
import { RuntimeLimitsProvider } from '../../common/contracts/runtime-limits.provider';
import { CryptoService } from '../../../shared/crypto/crypto.service';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { DrizzleRunResultWriter } from '../../infrastructure/llm/run-result-writer';
import { REDIS_LIMITER } from '../../../shared/redis/redis.constants';
import { applyRuntimeLimits } from '../../../shared/llm/runtime-limits';
import { ExperimentService } from '../experiment/experiment.service';
import { ExperimentWorkflowRegistrar } from '../experiment/experiment.workflow';
import { PromptRepository } from '../prompt/prompt.repository';
import {
  OptimizationRepository,
  type OptimizationAnalysisExperimentRow,
  type OptimizationRoundHistoryRow,
  type OptimizationRunResultRow,
  type OptimizationWorkflowContext,
  type OptimizationRoundStepKind,
  type OptimizationRoundStepStatus,
  type RoundStepUpsertInput,
} from './optimization.repository';

const { models, runResults, experiments } = schema;

// Namespace UUID (chosen randomly and pinned to stay stable across restarts) — distinct from ExperimentWorkflow to avoid hash collisions
const OPTIMIZATION_NS = '4a3f1b9e-5d7c-4f2a-9e1b-3c2d8e7a4f01';

const POLL_SLEEP_SCHEDULE_SEC = [3, 3, 5, 8, 10, 15];
const POLL_TIMEOUT_SEC = 60 * 60; // 1h default cap for a single round of child experiment; long-running runs can override in runConfig
const OPTIMIZATION_EXPERIMENT_NAME_MAX_LENGTH = 200;
const OPTIMIZATION_EXPERIMENT_NAME_SEPARATOR = ' · ';
const OPTIMIZATION_EXPERIMENT_NAME_FALLBACK = 'optimization';

type FinalizeKind = 'success' | 'failed' | 'stopped' | 'cancelled';
type ControlSignal = 'stop' | 'resume' | 'cancel' | null;
type ChildExperimentAction = 'stop' | 'cancel' | 'resume';
type WorkflowControlState = { status: string; controlState: ControlSignal } | null;
type BaselineExperimentStatus = 'running' | 'success' | 'failed' | 'stopped' | 'cancelled';

// System actor: used by workflow / service to represent "the system" when calling ExperimentService.controlExperiment.
// The OSS edition does not maintain user / audit tables; keep a stable actor id for log and business-field traceability.
export const SYSTEM_ACTOR_OPTIMIZATION: CurrentUserPayload = {
  sub: '00000000-0000-0000-0000-000000000000',
  email: 'system@proofhound.local',
  isSuperAdmin: true,
  isActive: true,
};

interface WorkflowConfigSnapshot {
  ok: boolean;
  reason?: string;
  // Context
  projectId: string;
  // orgId (SaaS-only; undefined in OSS) is seeded from the launching actor via runWorkflow, so the
  // analysis limiter key and child experiment launches can be org-scoped without re-querying.
  orgId?: string;
  optimizationName: string;
  promptId: string | null;
  baseVersionId: string | null;
  basePromptVersion: PromptVersionRef | null;
  datasetId: string;
  datasetSampleCount: number;
  startingMode: string;
  sourceExperimentId: string | null;
  promptLanguage: PromptLanguageDto;
  analysisModel: ModelInvocationConfig;
  analysisLimiterKey: string;
  taskModel: ModelInvocationConfig;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  strategy: string;
  strategyConfig: ErrorPatternAnalysisConfig;
  maxRounds: number;
  optimizationHint?: string;
  createdBy: string;
  // Snapshot
  nextRound: number;
  bestVersion: PromptVersionRef | null;
  bestMetrics: MetricSnapshot;
  // SPEC 25 §11 child experiment runConfig inheritance: optimizations.run_config is parsed against experimentRunConfigSchema
  // and written as-is as each round's child experiment runConfig; the field set matches experimentRunConfigSchema (no description).
  childRunConfig: ExperimentRunConfigDto;
  // SPEC 25 §7 resume granularity: when the child experiment for the round matching nextRound already exists and is not terminal (stopped/running),
  // we carry experimentId here so that runImpl skips startWorkflow and switches to the "continue child" path
  resumeChildExpId: string | null;
}

interface RoundOutcome {
  kind: 'continue' | 'goals_met' | 'fatal';
  metrics?: MetricSnapshot;
  isBest?: boolean;
  errorMessage?: string;
  analysisFailure?: boolean;
}

type PrepareOutcome =
  | { kind: 'launch'; experimentId: string }
  | { kind: 'fatal'; errorMessage: string; analysisFailure?: boolean };

interface PromptBaselinePrepareOutcome {
  kind: 'skip' | 'ready' | 'launch' | 'wait' | 'failed' | 'stopped' | 'cancelled';
  experimentId?: string;
  status?: BaselineExperimentStatus;
  errorMessage?: string;
}

interface PromptBaselineFinalizeOutcome {
  kind: 'ready' | 'failed' | 'stopped' | 'cancelled';
  errorMessage?: string;
}

interface RoundOptimizationContext {
  generationBaseVersion: PromptVersionRef;
  analysisVersion: PromptVersionRef;
  analysisExperiment: OptimizationAnalysisExperimentRow;
  previousExperiment: OptimizationAnalysisExperimentRow | null;
  previousVersion: PromptVersionRef | null;
  regressionRetry: boolean;
}

@Injectable()
export class OptimizationWorkflowRegistrar extends ConfiguredInstance {
  private readonly logger = createLogger('optimization.workflow', { service: 'server' });
  private readonly llmLogger: LLMCallLogger = createLogger('optimization.workflow.llm', {
    service: 'server',
  });

  readonly runWorkflow: (optimizationId: string, orgId?: string) => Promise<void>;
  private readonly loadConfigStep: (optimizationId: string, orgId?: string) => Promise<WorkflowConfigSnapshot>;
  private readonly markStartedStep: (optimizationId: string) => Promise<void>;
  // SPEC 25 §2.1: from_dataset_only start exclusive — sample from the dataset + call analysisModel to generate the first prompt version
  private readonly generateFirstVersionStep: (optimizationId: string, orgId?: string) => Promise<void>;
  private readonly preparePromptBaselineStep: (optimizationId: string) => Promise<PromptBaselinePrepareOutcome>;
  private readonly recordBaselineWorkflowIdStep: (experimentId: string, workflowId: string) => Promise<void>;
  private readonly markPromptBaselineFailedStep: (experimentId: string, failureReason: string) => Promise<void>;
  private readonly finalizePromptBaselineStep: (
    optimizationId: string,
    experimentId: string,
  ) => Promise<PromptBaselineFinalizeOutcome>;
  private readonly readStateStep: (optimizationId: string) => Promise<WorkflowControlState>;
  private readonly clearResumeStep: (optimizationId: string) => Promise<void>;
  private readonly prepareRoundStep: (optimizationId: string, roundNumber: number) => Promise<PrepareOutcome>;
  private readonly finalizeRoundStep: (
    optimizationId: string,
    roundNumber: number,
    experimentId: string,
  ) => Promise<RoundOutcome>;
  private readonly markChildLaunchFailedStep: (
    experimentId: string,
    message: string,
    optimizationId: string,
    roundNumber: number,
  ) => Promise<void>;
  private readonly finalizeStep: (
    optimizationId: string,
    kind: FinalizeKind,
    options: { reason?: string; analysisFailureReason?: string },
  ) => Promise<void>;
  // SPEC 25 §11.3: cross-round history aggregation — aggregated from the DB on the fly inside prepareRoundImpl, pure read, replay-safe
  private readonly loadRoundHistoryStep: (
    optimizationId: string,
    beforeRoundIndex: number,
  ) => Promise<OptimizationRoundHistoryRow[]>;
  // SPEC 25 §11.4.1: LLM result reuse — prepareRoundImpl looks up a success row before calling the LLM; on hit, the LLM call is skipped
  private readonly peekOptimizationRunResultStep: (
    optimizationId: string,
    roundNumber: number,
    source: 'optimization_analysis' | 'optimization_generate',
  ) => Promise<{ parsedOutput: unknown; rawResponse: string | null } | null>;
  // SPEC 25 §7: parent stop/cancel propagates to the child experiment; on parent resume, the same step also resumes the child experiment
  private readonly controlChildExperimentStep: (
    projectId: string,
    experimentId: string,
    action: ChildExperimentAction,
  ) => Promise<{ ok: boolean; reason?: string }>;
  // SPEC 25 §7 resume granularity: on resume, when entering the interrupted round, check the child experiment's current status to decide whether to resume / skip if already terminal
  private readonly queryChildExperimentStatusStep: (
    experimentId: string,
  ) => Promise<{ status: string; controlState: string | null } | null>;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    private readonly repo: OptimizationRepository,
    private readonly promptRepo: PromptRepository,
    private readonly experimentWorkflow: ExperimentWorkflowRegistrar,
    private readonly experimentService: ExperimentService,
    private readonly crypto: CryptoService,
    @Inject(REDIS_LIMITER) private readonly limiter: RateLimiter,
    private readonly runResultWriter: DrizzleRunResultWriter,
    private readonly limiterKeyStrategy: LimiterKeyStrategy,
    private readonly runtimeLimitsProvider: RuntimeLimitsProvider,
  ) {
    super('optimization-workflow');
    this.loadConfigStep = DBOS.registerStep(this.loadConfigImpl.bind(this), {
      name: 'optimization.loadConfig',
    });
    this.markStartedStep = DBOS.registerStep(this.markStartedImpl.bind(this), {
      name: 'optimization.markStarted',
    });
    this.generateFirstVersionStep = DBOS.registerStep(this.generateFirstVersionImpl.bind(this), {
      name: 'optimization.generateFirstVersion',
    });
    this.preparePromptBaselineStep = DBOS.registerStep(this.preparePromptBaselineImpl.bind(this), {
      name: 'optimization.preparePromptBaseline',
    });
    this.recordBaselineWorkflowIdStep = DBOS.registerStep(this.recordBaselineWorkflowIdImpl.bind(this), {
      name: 'optimization.recordBaselineWorkflowId',
    });
    this.markPromptBaselineFailedStep = DBOS.registerStep(this.markPromptBaselineFailedImpl.bind(this), {
      name: 'optimization.markPromptBaselineFailed',
    });
    this.finalizePromptBaselineStep = DBOS.registerStep(this.finalizePromptBaselineImpl.bind(this), {
      name: 'optimization.finalizePromptBaseline',
    });
    this.readStateStep = DBOS.registerStep(this.readStateImpl.bind(this), {
      name: 'optimization.readState',
    });
    this.clearResumeStep = DBOS.registerStep(this.clearResumeImpl.bind(this), {
      name: 'optimization.clearResume',
    });
    this.prepareRoundStep = DBOS.registerStep(this.prepareRoundImpl.bind(this), {
      name: 'optimization.prepareRound',
    });
    this.finalizeRoundStep = DBOS.registerStep(this.finalizeRoundImpl.bind(this), {
      name: 'optimization.finalizeRound',
    });
    this.markChildLaunchFailedStep = DBOS.registerStep(this.markChildLaunchFailedImpl.bind(this), {
      name: 'optimization.markChildLaunchFailed',
    });
    this.finalizeStep = DBOS.registerStep(this.finalizeImpl.bind(this), {
      name: 'optimization.finalize',
    });
    this.loadRoundHistoryStep = DBOS.registerStep(this.loadRoundHistoryImpl.bind(this), {
      name: 'optimization.loadRoundHistory',
    });
    this.peekOptimizationRunResultStep = DBOS.registerStep(this.peekOptimizationRunResultImpl.bind(this), {
      name: 'optimization.peekRunResult',
    });
    this.controlChildExperimentStep = DBOS.registerStep(this.controlChildExperimentImpl.bind(this), {
      name: 'optimization.controlChildExperiment',
    });
    this.queryChildExperimentStatusStep = DBOS.registerStep(this.queryChildExperimentStatusImpl.bind(this), {
      name: 'optimization.queryChildExperimentStatus',
    });

    this.runWorkflow = DBOS.registerWorkflow(this.runImpl.bind(this), {
      name: 'OptimizationWorkflow',
    });

    this.logger.info({}, 'optimization_workflow_registered');
  }

  private async runImpl(optimizationId: string, orgId?: string): Promise<void> {
    this.logger.debug({ optimizationId }, 'workflow_run_start');

    try {
      let snapshot: WorkflowConfigSnapshot;
      try {
        snapshot = await this.loadConfigStep(optimizationId, orgId);
      } catch (error) {
        await this.finalizeStep(optimizationId, 'failed', {
          reason: `load_config_failed: ${(error as Error).message}`,
        });
        return;
      }

      if (!snapshot.ok) {
        await this.finalizeStep(optimizationId, 'failed', { reason: snapshot.reason });
        return;
      }

      await this.markStartedStep(optimizationId);

      // SPEC 25 §2.1: from_dataset_only start; the first prompt version is generated by generateFirstVersionStep
      // (calls analysisModel to randomly sample from the dataset and induce prompt body / variables / outputSchema).
      // After the step succeeds, base_version_id is backfilled; reload loadConfig to get a snapshot carrying the new baseVersionId;
      // subsequent ensurePromptBaseline follows the same baseline-experiment path as from_prompt_version.
      if (snapshot.startingMode === 'from_dataset_only' && !snapshot.baseVersionId) {
        try {
          await this.generateFirstVersionStep(optimizationId, snapshot.orgId);
        } catch (error) {
          const reason = mapFirstVersionErrorReason(error);
          await this.finalizeStep(optimizationId, 'failed', { reason });
          return;
        }
        const reloaded = await this.loadConfigStep(optimizationId, orgId);
        if (!reloaded.ok) {
          await this.finalizeStep(optimizationId, 'failed', {
            reason: reloaded.reason ?? 'reload_after_first_version_failed',
          });
          return;
        }
        snapshot = reloaded;
      }

      const baseline = await this.ensurePromptBaseline(optimizationId, snapshot);
      if (baseline.kind === 'exit') return;
      if (baseline.kind === 'fatal') {
        await this.finalizeStep(optimizationId, 'failed', {
          reason: baseline.errorMessage,
        });
        return;
      }
      snapshot = baseline.snapshot;

      // Pre-loop goal check (from_experiment start may already be at goal; finalize immediately)
      if (snapshot.bestVersion && allGoalsMet(snapshot.goals, snapshot.bestMetrics)) {
        await this.finalizeStep(optimizationId, 'success', { reason: 'goals_met' });
        return;
      }

      for (let n = snapshot.nextRound; n <= snapshot.maxRounds; n++) {
        const state = await this.readStateStep(optimizationId);
        // service performs preemptive terminal-state writes (on stop/cancel, writes status=stopped/cancelled directly);
        // when the workflow observes status no longer running, it exits immediately — does not call finalize to overwrite,
        // does not start a child experiment, does not write round_steps.
        if (!state || state.status !== 'running') {
          this.logger.info(
            { optimizationId, status: state?.status ?? 'not_found' },
            'optimization_workflow_exit_preempted',
          );
          return;
        }
        if (state.controlState === 'cancel') {
          await this.finalizeStep(optimizationId, 'cancelled', { reason: 'control_cancel' });
          return;
        }
        if (state.controlState === 'stop') {
          await this.finalizeStep(optimizationId, 'stopped', { reason: 'control_stop' });
          return;
        }
        if (state.controlState === 'resume') {
          await this.clearResumeStep(optimizationId);
        }

        // SPEC 25 §7 resume granularity: whether this loop iteration enters the "continue interrupted child experiment" branch
        // True only when n == snapshot.nextRound; the next round (n+1) goes through normal prepare + startWorkflow
        const isResumeRound = n === snapshot.nextRound && snapshot.resumeChildExpId !== null;

        const prepare = await this.prepareRoundStep(optimizationId, n);
        if (prepare.kind === 'fatal') {
          await this.finalizeStep(optimizationId, 'failed', {
            reason: prepare.errorMessage ?? 'round_fatal_error',
            analysisFailureReason: prepare.analysisFailure ? prepare.errorMessage : undefined,
          });
          return;
        }

        if (isResumeRound) {
          // The child experiment already exists (prepare's ON CONFLICT DO NOTHING also guarantees no overwrite);
          // skip DBOS.startWorkflow (to avoid ambiguity from re-dispatching the same id),
          // if the child experiment is stopped → call service to resume it (new child workflow id)
          const childStatus = await this.queryChildExperimentStatusStep(prepare.experimentId);
          if (!childStatus) {
            this.logger.warn(
              { optimizationId, roundNumber: n, experimentId: prepare.experimentId },
              'optimization_resume_child_missing',
            );
            await this.finalizeStep(optimizationId, 'failed', {
              reason: 'resume_child_missing',
            });
            return;
          }
          if (childStatus.status === 'stopped') {
            await this.controlChildExperimentStep(snapshot.projectId, prepare.experimentId, 'resume');
            this.logger.info(
              { optimizationId, roundNumber: n, experimentId: prepare.experimentId },
              'optimization_child_resumed',
            );
          } else {
            this.logger.info(
              {
                optimizationId,
                roundNumber: n,
                experimentId: prepare.experimentId,
                childStatus: childStatus.status,
              },
              'optimization_resume_round_child_already_active',
            );
          }
        } else {
          // ---- Workflow-layer startup of child ExperimentWorkflow (SPEC 03 §3.2) ----
          // DBOS does not allow calling startWorkflow inside a step, so the launch must happen at the workflow layer.
          // startWorkflow with the same workflowId and same function is idempotent success (replay-safe);
          // only throws DBOSConflictingWorkflowError when the same id has a different function / class name — any catch indicates
          // a real launch failure: set the child experiment to failed; skip this round as continue (SPEC 25 §7); do not block the whole optimization.
          const expWorkflowId = `optimization:${optimizationId}:round:${n}:exp`;
          try {
            await DBOS.startWorkflow(this.experimentWorkflow.runWorkflow, {
              workflowID: expWorkflowId,
            })(prepare.experimentId, snapshot.orgId);
          } catch (error) {
            const message = (error as Error).message;
            this.logger.warn(
              { optimizationId, roundNumber: n, expWorkflowId, error: message },
              'child_experiment_launch_failed',
            );
            await this.markChildLaunchFailedStep(prepare.experimentId, message, optimizationId, n);
          }
        }

        const outcome = await this.finalizeRoundStep(optimizationId, n, prepare.experimentId);

        if (outcome.kind === 'fatal') {
          await this.finalizeStep(optimizationId, 'failed', {
            reason: outcome.errorMessage ?? 'round_fatal_error',
            analysisFailureReason: outcome.analysisFailure ? outcome.errorMessage : undefined,
          });
          return;
        }
        if (outcome.kind === 'goals_met') {
          await this.finalizeStep(optimizationId, 'success', { reason: 'goals_met' });
          return;
        }
      }

      await this.finalizeStep(optimizationId, 'failed', { reason: 'max_rounds' });
    } catch (error) {
      // Fallback: any uncaught step exception writes status=failed, to prevent the application table from being stuck in running
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ optimizationId, err: message }, 'workflow_unhandled_error');
      try {
        await this.finalizeStep(optimizationId, 'failed', {
          reason: `unhandled_workflow_error: ${message}`,
        });
      } catch (finalizeError) {
        this.logger.error(
          {
            optimizationId,
            err: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
          },
          'workflow_finalize_after_unhandled_failed',
        );
      }
      throw error;
    }
  }

  private async ensurePromptBaseline(
    optimizationId: string,
    snapshot: WorkflowConfigSnapshot,
  ): Promise<
    { kind: 'ready'; snapshot: WorkflowConfigSnapshot } | { kind: 'fatal'; errorMessage: string } | { kind: 'exit' }
  > {
    if (!isPromptBaselineBootstrapNeeded(snapshot.startingMode)) {
      return { kind: 'ready', snapshot };
    }

    const prepare = await this.preparePromptBaselineStep(optimizationId);
    if (prepare.kind === 'skip') {
      return { kind: 'ready', snapshot };
    }
    if (prepare.kind === 'failed') {
      return { kind: 'fatal', errorMessage: prepare.errorMessage ?? 'baseline_experiment_failed' };
    }
    if (prepare.kind === 'cancelled') {
      await this.finalizeStep(optimizationId, 'cancelled', {
        reason: prepare.errorMessage ?? 'baseline_experiment_cancelled',
      });
      return { kind: 'exit' };
    }
    if (prepare.kind === 'stopped') {
      const state = await this.readStateStep(optimizationId);
      if (state?.controlState === 'resume' && prepare.experimentId) {
        await this.controlChildExperimentStep(snapshot.projectId, prepare.experimentId, 'resume');
        await this.clearResumeStep(optimizationId);
      } else {
        await this.finalizeStep(optimizationId, 'stopped', {
          reason: prepare.errorMessage ?? 'baseline_experiment_stopped',
        });
        return { kind: 'exit' };
      }
    }

    if (prepare.kind === 'launch' && prepare.experimentId) {
      const expWorkflowId = `optimization:${optimizationId}:baseline:exp`;
      try {
        await DBOS.startWorkflow(this.experimentWorkflow.runWorkflow, {
          workflowID: expWorkflowId,
        })(prepare.experimentId, snapshot.orgId);
        await this.recordBaselineWorkflowIdStep(prepare.experimentId, expWorkflowId);
      } catch (error) {
        const message = (error as Error).message;
        this.logger.warn(
          { optimizationId, experimentId: prepare.experimentId, expWorkflowId, error: message },
          'prompt_baseline_experiment_launch_failed',
        );
        await this.markPromptBaselineFailedStep(prepare.experimentId, `launch_failed: ${message}`);
        return { kind: 'fatal', errorMessage: `baseline_launch_failed: ${message}` };
      }
    }

    const experimentId = prepare.experimentId ?? snapshot.sourceExperimentId;
    if (!experimentId) {
      return { kind: 'fatal', errorMessage: 'baseline_experiment_missing' };
    }

    const finalized = await this.finalizePromptBaselineStep(optimizationId, experimentId);
    if (finalized.kind === 'failed') {
      return { kind: 'fatal', errorMessage: finalized.errorMessage ?? 'baseline_experiment_failed' };
    }
    if (finalized.kind === 'stopped') {
      await this.finalizeStep(optimizationId, 'stopped', {
        reason: finalized.errorMessage ?? 'baseline_experiment_stopped',
      });
      return { kind: 'exit' };
    }
    if (finalized.kind === 'cancelled') {
      await this.finalizeStep(optimizationId, 'cancelled', {
        reason: finalized.errorMessage ?? 'baseline_experiment_cancelled',
      });
      return { kind: 'exit' };
    }

    const reloaded = await this.loadConfigStep(optimizationId);
    if (!reloaded.ok) {
      return { kind: 'fatal', errorMessage: reloaded.reason ?? 'baseline_snapshot_reload_failed' };
    }
    return { kind: 'ready', snapshot: reloaded };
  }

  // ---------- step impls ----------

  private async loadConfigImpl(optimizationId: string, orgId?: string): Promise<WorkflowConfigSnapshot> {
    const ctx = await this.repo.loadWorkflowContext(optimizationId);
    if (!ctx) {
      return invalidSnapshot('optimization_not_found');
    }
    if (!ctx.promptId) {
      // All starting modes have ensured promptId is persisted at createOptimization time (from_dataset_only auto-creates an empty prompt)
      return invalidSnapshot('prompt_id_missing_for_starting_mode');
    }
    const isDatasetOnly = ctx.startingMode === 'from_dataset_only';
    // SPEC 25 §2.1: from_dataset_only allows baseVersionId to be null; the workflow's
    // generateFirstVersionStep backfills it after generating the first version; other modes must already have baseVersionId.
    if (!isDatasetOnly && !ctx.baseVersionId) {
      return invalidSnapshot('base_version_id_required');
    }
    if (!isDatasetOnly && !['from_experiment', 'from_prompt_version'].includes(ctx.startingMode)) {
      return invalidSnapshot('starting_mode_unsupported_v1');
    }

    const goalsParsed = z.array(optimizationGoalSchema).safeParse(ctx.goals ?? []);
    if (!goalsParsed.success || goalsParsed.data.length === 0) {
      return invalidSnapshot('goals_invalid');
    }
    const fwParsed = optimizationFieldWhitelistSchema.safeParse(ctx.fieldWhitelist ?? {});
    if (!fwParsed.success) {
      return invalidSnapshot('field_whitelist_invalid');
    }

    let strategyConfig: ErrorPatternAnalysisConfig;
    try {
      strategyConfig = errorPatternAnalysisConfigSchema.parse(ctx.strategyConfig ?? {});
    } catch {
      strategyConfig = DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG;
    }

    const analysisModel = await this.loadModelInvocationConfig(ctx.analysisModelId);
    if (!analysisModel) return invalidSnapshot('analysis_model_unavailable');
    const taskModel = await this.loadModelInvocationConfig(ctx.experimentModelId);
    if (!taskModel) return invalidSnapshot('task_model_unavailable');

    const promptLanguage = parsePromptLanguage(ctx.promptLanguage);
    const variables = parseVariables(ctx.baseVersionVariables);
    // SPEC 25 §2.1: before the first version is generated in from_dataset_only, baseVersionId is null and basePromptVersion is also null;
    // after generateFirstVersionStep completes, loadConfigStep re-runs and ctx.baseVersionId is backfilled, so a normal ref is constructed here.
    const basePromptVersion: PromptVersionRef | null = ctx.baseVersionId
      ? {
          id: ctx.baseVersionId,
          promptId: ctx.promptId,
          versionNumber: ctx.baseVersionNumber ?? 0,
          body: ctx.baseVersionBody ?? '',
          outputSchema: ctx.baseVersionOutputSchema,
          promptLanguage: parsePromptLanguage(ctx.baseVersionPromptLanguage),
          judgmentRules:
            ctx.baseVersionJudgmentRules && typeof ctx.baseVersionJudgmentRules === 'object'
              ? {
                  ruleName: 'default',
                  config: ctx.baseVersionJudgmentRules,
                }
              : undefined,
          // Preserve the full PromptVariableDto (type/required/datasetField) — otherwise downstream parseVariables, due to missing fields against
          // promptVariableSchema, will safeParse each item and discard them, and the written new version ends up with variables=[],
          // causing the experiment renderer's buildInputVariables to get an empty object, leaving {{text}} unsubstituted as a literal.
          variables,
        }
      : null;

    // Completed rounds + current best
    // SPEC 25 §7: new rule for deriving nextRound
    //   - success/failed → treated as completed, advance to the next round
    //   - stopped/running → treated as "interrupted", do not advance the round index + carry resumeChildExpId
    //                       letting runImpl skip startWorkflow and switch to the continue-child branch
    const completedRounds = await this.repo.listRoundExperimentsForOptimization(optimizationId);
    let bestVersion: PromptVersionRef | null = ctx.bestVersionId ? null : basePromptVersion;
    let bestMetrics: MetricSnapshot = this.toMetricSnapshot(ctx.bestMetrics) ?? emptyMetrics();
    let nextRound = 1;
    let resumeChildExpId: string | null = null;
    const sortedRounds = completedRounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);
    for (const round of sortedRounds) {
      if (round.status === 'success' || round.status === 'failed') {
        nextRound = Math.max(nextRound, round.roundIndex + 1);
      } else if (round.status === 'stopped' || round.status === 'running') {
        // Interrupted round → re-run this round (prepare goes through LLM reuse + child experiment ON CONFLICT does not recreate); carry the child expId
        nextRound = round.roundIndex;
        resumeChildExpId = round.experimentId;
        break; // Later rounds (if any) should not have been persisted by design — defensive break
      }
      // Other statuses (cancelled / queued / future extensions) are treated as "does not affect nextRound"
    }
    if (ctx.bestVersionId) {
      const [bestVer] = await this.db
        .select({
          id: schema.promptVersions.id,
          promptId: schema.promptVersions.promptId,
          versionNumber: schema.promptVersions.versionNumber,
          body: schema.promptVersions.body,
          outputSchema: schema.promptVersions.outputSchema,
          promptLanguage: schema.promptVersions.promptLanguage,
          judgmentRules: schema.promptVersions.judgmentRules,
          variables: schema.promptVersions.variables,
        })
        .from(schema.promptVersions)
        .where(eq(schema.promptVersions.id, ctx.bestVersionId))
        .limit(1);
      if (bestVer) {
        bestVersion = {
          id: bestVer.id,
          promptId: bestVer.promptId,
          versionNumber: bestVer.versionNumber,
          body: bestVer.body ?? '',
          outputSchema: bestVer.outputSchema,
          promptLanguage: parsePromptLanguage(bestVer.promptLanguage),
          judgmentRules:
            bestVer.judgmentRules && typeof bestVer.judgmentRules === 'object'
              ? { ruleName: 'default', config: bestVer.judgmentRules }
              : undefined,
          variables: parseVariables(bestVer.variables),
        };
      }
    }
    if (!bestVersion) bestVersion = basePromptVersion;

    // baseline metrics: taken from the source experiment or the main table's best_metrics
    if (!ctx.bestMetrics && ctx.sourceExperimentId) {
      const [src] = await this.db
        .select({ metrics: experiments.metrics })
        .from(experiments)
        .where(eq(experiments.id, ctx.sourceExperimentId))
        .limit(1);
      const fromSrc = this.toMetricSnapshot(src?.metrics);
      if (fromSrc) bestMetrics = fromSrc;
    }

    const runConfig = (ctx.runConfig as Record<string, unknown> | null) ?? {};
    const optimizationHint = readOptimizationHintFromContext(ctx);

    const childRunConfig = parseChildRunConfigFromOptimization(runConfig);

    const fieldWhitelist: FieldWhitelist = toLoopFieldWhitelist(
      fwParsed.data,
      readExpectedField(ctx.baseVersionJudgmentRules),
    );

    return {
      ok: true,
      projectId: ctx.projectId,
      orgId,
      optimizationName: ctx.name,
      promptId: ctx.promptId,
      baseVersionId: ctx.baseVersionId,
      basePromptVersion,
      datasetId: ctx.datasetId,
      datasetSampleCount: ctx.datasetSampleCount,
      startingMode: ctx.startingMode,
      sourceExperimentId: ctx.sourceExperimentId,
      promptLanguage,
      analysisModel,
      analysisLimiterKey: this.limiterKeyStrategy.buildModelKey(
        { projectId: ctx.projectId, orgId, source: 'local' },
        analysisModel.id,
      ),
      taskModel,
      goals: goalsParsed.data.map(toLoopGoal),
      fieldWhitelist,
      strategy: ctx.strategy,
      strategyConfig,
      maxRounds: ctx.maxRounds,
      optimizationHint,
      createdBy: ctx.createdBy,
      nextRound,
      bestVersion,
      bestMetrics,
      childRunConfig,
      resumeChildExpId,
    };
  }

  private async markStartedImpl(optimizationId: string): Promise<void> {
    await this.repo.markStarted(optimizationId);
  }

  private async applySynchronousRuntimeLimits(
    project: ProjectContext,
    model: ModelInvocationConfig,
    source: 'optimization_analysis' | 'optimization_generate',
  ): Promise<ModelInvocationConfig> {
    const mergedLimits = await this.runtimeLimitsProvider.mergeLlmLimits({
      project,
      modelId: model.id,
      source,
    });
    return applyRuntimeLimits(model, mergedLimits);
  }

  // SPEC 25 §2.1: first version generation for the from_dataset_only start.
  // 1) randomly sample initialSamplingRounds × initialSamplesPerRound items from the dataset
  // 2) call analysisModel to have the LLM induce the first prompt body / variables / outputSchema
  // 3) write one frozen prompt_versions row with a deterministic versionId (replay-idempotent)
  // 4) backfill the versionId into optimizations.base_version_id
  // 5) reuse §12 round_steps record (round_index=0, step='generate_prompt')
  // On failure, throw an Error with a specific reason; runImpl catches it, maps to the finalize reason code, and finalizes the whole optimization as failed.
  private async generateFirstVersionImpl(optimizationId: string, orgId?: string): Promise<void> {
    const ctx = await this.repo.loadWorkflowContext(optimizationId);
    if (!ctx) {
      throw new Error('first_version_generation_failed_v1:context_missing');
    }
    if (ctx.startingMode !== 'from_dataset_only') {
      // Should not reach here; defensive check
      throw new Error('first_version_generation_failed_v1:wrong_starting_mode');
    }
    if (ctx.baseVersionId) {
      // Already generated (replay path) — fallback skip, to avoid calling the LLM again
      this.logger.info({ optimizationId }, 'optimization_first_version_already_generated_skip');
      return;
    }
    if (!ctx.promptId) {
      throw new Error('first_version_generation_failed_v1:prompt_id_missing');
    }

    const dbosWorkflowId = DBOS.workflowID ?? null;
    const versionId = deterministicUuid(`${optimizationId}:first-version`);
    const generateRunResultId = deterministicUuid(`${optimizationId}:first-generate`);

    await this.upsertStepSafe({
      optimizationId,
      roundIndex: 0,
      step: 'generate_prompt',
      status: 'running',
      startedAt: new Date(),
      dbosWorkflowId,
    });

    try {
      // Validate + parse config
      const fwParsed = optimizationFieldWhitelistSchema.safeParse(ctx.fieldWhitelist ?? {});
      if (!fwParsed.success) {
        throw new Error('first_version_generation_failed_v1:field_whitelist_invalid');
      }
      const goalsParsed = z.array(optimizationGoalSchema).safeParse(ctx.goals ?? []);
      if (!goalsParsed.success || goalsParsed.data.length === 0) {
        throw new Error('first_version_generation_failed_v1:goals_invalid');
      }
      let strategyConfig: ErrorPatternAnalysisConfig;
      try {
        strategyConfig = errorPatternAnalysisConfigSchema.parse(ctx.strategyConfig ?? {});
      } catch {
        strategyConfig = DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG;
      }
      const analysisModel = await this.loadModelInvocationConfig(ctx.analysisModelId);
      if (!analysisModel) {
        throw new Error('first_version_generation_failed_v1:analysis_model_unavailable');
      }
      const analysisLimiterKey = this.limiterKeyStrategy.buildModelKey(
        { projectId: ctx.projectId, orgId, source: 'local' },
        analysisModel.id,
      );
      const effectiveAnalysisModel = await this.applySynchronousRuntimeLimits(
        { projectId: ctx.projectId, ...(orgId ? { orgId } : {}), source: 'local' },
        analysisModel,
        'optimization_generate',
      );

      // Load and randomly sample
      const allSamples = await this.repo.loadDatasetSamples(ctx.datasetId);
      const sampleCount = strategyConfig.initialSamplingRounds * strategyConfig.initialSamplesPerRound;
      if (allSamples.length === 0) {
        throw new Error('first_version_dataset_empty_v1');
      }
      const samples =
        allSamples.length <= sampleCount
          ? allSamples
          : pickRandomSamples(allSamples, sampleCount, `${optimizationId}:first-version`);
      if (allSamples.length < sampleCount) {
        this.logger.warn(
          {
            optimizationId,
            requested: sampleCount,
            available: allSamples.length,
          },
          'optimization_first_version_dataset_undersized',
        );
      }

      const fieldWhitelist: FieldWhitelist = toLoopFieldWhitelist(
        fwParsed.data,
        readExpectedField(ctx.baseVersionJudgmentRules),
      );

      // Call LLM to generate the first version
      const promptLanguage = parsePromptLanguage(ctx.promptLanguage);
      const generated = await generateInitialVersion(
        {
          optimizationId,
          analysisModel: effectiveAnalysisModel,
          analysisLimiterKey,
          samples,
          goals: goalsParsed.data.map(toLoopGoal),
          fieldWhitelist,
          description: ctx.description,
          optimizationHint: readOptimizationHintFromContext(ctx),
          promptLanguage,
          strategyConfig,
          runResultMeta: {
            projectId: ctx.projectId,
            sourceId: optimizationId,
            promptVersionId: versionId,
            modelId: analysisModel.id,
            dbosWorkflowId,
            bullmqJobId: null,
            attempt: 0,
          },
          generateRunResultId,
        },
        {
          limiter: this.limiter as RateLimiterLike,
          logger: this.llmLogger,
          runResultWriter: this.runResultWriter,
        },
      );

      // Write the frozen prompt_versions row (deterministic id makes replay idempotent)
      await this.promptRepo.createOptimizationFrozenVersion({
        versionId,
        promptId: ctx.promptId,
        parentVersionId: null,
        body: generated.newPromptBody,
        variables: generated.variables,
        outputSchema: generated.outputSchema,
        judgmentRules: deriveJudgmentRulesFromOutputSchema(
          generated.outputSchema,
          readExpectedField(ctx.baseVersionJudgmentRules),
        ),
        promptLanguage,
        optimizationId,
        changeReason: 'optimization:first-version',
        createdBy: ctx.createdBy,
      });

      // Backfill base_version_id (with IS NULL guard)
      await this.repo.updateBaseVersionId(optimizationId, versionId);

      await this.upsertStepSafe({
        optimizationId,
        roundIndex: 0,
        step: 'generate_prompt',
        status: 'success',
        finishedAt: new Date(),
        runResultId: generateRunResultId,
        dbosWorkflowId,
      });
    } catch (error) {
      const { errorClass, errorMessage } = normalizeErrorForStep(error);
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: 0,
        step: 'generate_prompt',
        status: 'failed',
        finishedAt: new Date(),
        errorClass,
        errorMessage,
        dbosWorkflowId,
      });
      throw error;
    }
  }

  private async preparePromptBaselineImpl(optimizationId: string): Promise<PromptBaselinePrepareOutcome> {
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      return { kind: 'failed', errorMessage: snapshot.reason ?? 'snapshot_invalid' };
    }
    if (!isPromptBaselineBootstrapNeeded(snapshot.startingMode)) {
      return { kind: 'skip' };
    }
    if (!snapshot.baseVersionId || !snapshot.basePromptVersion) {
      return { kind: 'failed', errorMessage: 'base_version_missing' };
    }

    if (snapshot.sourceExperimentId) {
      const existing = await this.repo.findExperimentStatus(snapshot.sourceExperimentId);
      if (!existing) {
        return {
          kind: 'failed',
          errorMessage: `baseline_experiment_not_found:${snapshot.sourceExperimentId}`,
        };
      }
      const status = normalizeBaselineExperimentStatus(existing.status);
      if (status === 'success') {
        return { kind: 'ready', experimentId: existing.id, status };
      }
      if (status === 'failed' || status === 'stopped' || status === 'cancelled') {
        return {
          kind: status,
          experimentId: existing.id,
          status,
          errorMessage: `baseline_experiment_${status}`,
        };
      }
      return { kind: 'wait', experimentId: existing.id, status };
    }

    const experimentId = computeOptimizationBaselineExperimentId(optimizationId);
    await this.repo.freezePromptVersionIfNeeded(snapshot.baseVersionId);
    await this.repo.createPromptBaselineExperimentRow({
      id: experimentId,
      projectId: snapshot.projectId,
      name: await this.buildOptimizationExperimentNameForInsert({
        projectId: snapshot.projectId,
        experimentId,
        optimizationId,
        optimizationName: snapshot.optimizationName,
        round: 'baseline',
      }),
      promptVersionId: snapshot.baseVersionId,
      datasetId: snapshot.datasetId,
      modelId: snapshot.taskModel.id,
      runConfig: snapshot.childRunConfig,
      totalSamples: snapshot.datasetSampleCount,
      createdBy: snapshot.createdBy,
    });
    await this.repo.attachSourceExperimentIfEmpty(optimizationId, experimentId);

    const created = await this.repo.findExperimentStatus(experimentId);
    const status = normalizeBaselineExperimentStatus(created?.status ?? 'running');
    if (status === 'success') {
      return { kind: 'ready', experimentId, status };
    }
    if (status === 'failed' || status === 'stopped' || status === 'cancelled') {
      return {
        kind: status,
        experimentId,
        status,
        errorMessage: `baseline_experiment_${status}`,
      };
    }
    return { kind: 'launch', experimentId, status };
  }

  private async buildOptimizationExperimentNameForInsert(input: {
    projectId: string;
    experimentId: string;
    optimizationId: string;
    optimizationName: string;
    round: 'baseline' | number;
  }): Promise<string> {
    const primaryName = buildOptimizationExperimentName(input.optimizationName, input.round);
    const existing = await this.repo.findActiveExperimentByProjectAndName(input.projectId, primaryName);
    if (!existing || existing.id === input.experimentId) return primaryName;

    return buildOptimizationExperimentName(input.optimizationName, input.round, {
      collisionSalt: `${input.optimizationId}:${input.round}`,
    });
  }

  private async recordBaselineWorkflowIdImpl(experimentId: string, workflowId: string): Promise<void> {
    await this.repo.setExperimentDbosWorkflowId(experimentId, workflowId);
  }

  private async markPromptBaselineFailedImpl(experimentId: string, failureReason: string): Promise<void> {
    await this.repo.markChildExperimentFailed(experimentId, failureReason);
  }

  private async finalizePromptBaselineImpl(
    optimizationId: string,
    experimentId: string,
  ): Promise<PromptBaselineFinalizeOutcome> {
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      return { kind: 'failed', errorMessage: snapshot.reason ?? 'snapshot_invalid' };
    }

    const finalState = await this.waitForExperimentTerminal(experimentId, optimizationId, 0, snapshot.projectId);
    const status = normalizeBaselineExperimentStatus(finalState.status);
    if (status === 'success') {
      return { kind: 'ready' };
    }
    if (status === 'stopped' || status === 'cancelled') {
      return { kind: status, errorMessage: `baseline_experiment_${status}` };
    }
    return { kind: 'failed', errorMessage: 'baseline_experiment_failed' };
  }

  private async readStateImpl(optimizationId: string): Promise<WorkflowControlState> {
    const row = await this.repo.findStatusAndControl(optimizationId);
    if (!row) return null;
    const ctl = row.controlState;
    const normalized: ControlSignal = ctl === 'stop' || ctl === 'cancel' || ctl === 'resume' ? ctl : null;
    return { status: row.status, controlState: normalized };
  }

  private async clearResumeImpl(optimizationId: string): Promise<void> {
    await this.repo.clearResume(optimizationId);
  }

  // SPEC 25 §11.3 cross-round history aggregation step — pure read, wrappable as a DBOS step.
  // beforeRoundIndex locks "only see < N" completed rounds; best_version_id drift makes the history content move with the DB state at the time,
  // but it does not affect this round's idempotency (runResultId is locked by uuidv5; replay does not actually call the LLM again)
  private async loadRoundHistoryImpl(
    optimizationId: string,
    beforeRoundIndex: number,
  ): Promise<OptimizationRoundHistoryRow[]> {
    return this.repo.loadRoundHistory(optimizationId, beforeRoundIndex);
  }

  // Convert raw rows returned by the repository into the strategy package's RoundHistoryEntry[].
  // - metrics goes through toMetricSnapshot for normalization
  // - deltaFromPrev is computed by iterating against goals[0]'s primary metric (the first entry is null)
  // - changeSummary / appliedChanges are parsed from generateParsedOutput; for legacy data / parse failures use empty string / []
  //   (no throw, so history never blocks the main path)
  private buildRoundHistoryEntries(
    rows: OptimizationRoundHistoryRow[],
    goals: OptimizationGoal[],
  ): RoundHistoryEntry[] {
    const primaryGoal = goals[0];
    let prevPrimary: number | null = null;
    return rows.map((row) => {
      const metrics = this.toMetricSnapshot(row.metrics) ?? { overall: {} };
      const currentPrimary = primaryGoal ? readMetric(metrics, primaryGoal) : null;
      const deltaFromPrev = currentPrimary !== null && prevPrimary !== null ? currentPrimary - prevPrimary : null;
      prevPrimary = currentPrimary;

      const parsedGen = (row.generateParsedOutput ?? null) as {
        changeSummary?: unknown;
        appliedChanges?: Array<{
          changeId?: unknown;
          patternIds?: unknown;
          summary?: unknown;
        }>;
        appliedTips?: unknown;
      } | null;
      const changeSummary = typeof parsedGen?.changeSummary === 'string' ? parsedGen.changeSummary : '';
      const rawApplied = Array.isArray(parsedGen?.appliedChanges) ? parsedGen.appliedChanges : [];
      const appliedChanges = rawApplied
        .filter(
          (c): c is { changeId: string; patternIds?: unknown; summary?: unknown } =>
            Boolean(c) && typeof c.changeId === 'string',
        )
        .map((c) => ({
          changeId: c.changeId,
          patternIds: Array.isArray(c.patternIds)
            ? c.patternIds.filter((p): p is string => typeof p === 'string')
            : undefined,
          rationale: typeof c.summary === 'string' ? c.summary : undefined,
        }));
      // Basis for the "toolbox rotation hint" — de-aggregates the LLM's self-reported appliedTips (SPEC 25 §11.3 "toolbox rotation hint")
      const appliedTips = extractAppliedTipsFromGenerateParsedOutput(parsedGen);

      return {
        roundIndex: row.roundIndex,
        metrics,
        deltaFromPrev,
        changeSummary,
        appliedChanges,
        appliedTips,
        isBest: row.isBest,
        generatedFromBaseVersionId: row.parentVersionId ?? '',
      };
    });
  }

  private async resolveRoundOptimizationContext(
    optimizationId: string,
    roundNumber: number,
    snapshot: WorkflowConfigSnapshot,
  ): Promise<RoundOptimizationContext | { errorMessage: string }> {
    const regressionRetry = await this.resolveRegressionRetryContext(optimizationId, roundNumber, snapshot);
    if (regressionRetry) return regressionRetry;

    const generationBaseVersion = snapshot.bestVersion ?? snapshot.basePromptVersion;
    if (!generationBaseVersion) return { errorMessage: 'base_version_missing' };

    const analysisExperiment = await this.repo.findAnalysisExperimentForPromptVersion({
      optimizationId,
      sourceExperimentId: snapshot.sourceExperimentId,
      promptVersionId: generationBaseVersion.id,
    });
    if (!analysisExperiment) {
      return {
        errorMessage: `analysis_experiment_missing_for_prompt_version:${generationBaseVersion.id}`,
      };
    }
    const previousExperiment = await this.repo.findPreviousComparableExperiment({
      optimizationId,
      sourceExperimentId: snapshot.sourceExperimentId,
      currentRoundIndex: analysisExperiment.roundIndex,
    });
    const previousVersion = previousExperiment
      ? await this.loadPromptVersionRef(previousExperiment.promptVersionId)
      : null;

    return {
      generationBaseVersion,
      analysisVersion: generationBaseVersion,
      analysisExperiment,
      previousExperiment,
      previousVersion,
      regressionRetry: false,
    };
  }

  // SPEC 25 §5 / §11.5: if the just-completed previous round is worse than its parent prompt's corresponding experiment,
  // this round does not continue stacking changes on the bad prompt. Analyze attributes from the bad prompt + bad samples,
  // Generate falls back to the parent prompt for improvement.
  private async resolveRegressionRetryContext(
    optimizationId: string,
    roundNumber: number,
    snapshot: WorkflowConfigSnapshot,
  ): Promise<RoundOptimizationContext | null> {
    if (roundNumber <= 1) return null;

    const previousRound = await this.repo.findExperimentByRound(optimizationId, roundNumber - 1);
    if (!previousRound || previousRound.status !== 'success' || !previousRound.parentVersionId) {
      return null;
    }

    const regressedMetrics = this.toMetricSnapshot(previousRound.metrics);
    if (!regressedMetrics) return null;

    const baseExperiment = await this.repo.findAnalysisExperimentForPromptVersion({
      optimizationId,
      sourceExperimentId: snapshot.sourceExperimentId,
      promptVersionId: previousRound.parentVersionId,
    });
    if (!baseExperiment) return null;

    const baseMetrics = this.toMetricSnapshot(baseExperiment.metrics);
    if (!baseMetrics || !isBetterThan(baseMetrics, regressedMetrics, snapshot.goals)) {
      return null;
    }

    const baseVersion = await this.loadPromptVersionRef(previousRound.parentVersionId);
    const regressedVersion = await this.loadPromptVersionRef(previousRound.promptVersionId);
    if (!baseVersion || !regressedVersion) return null;

    this.logger.info(
      {
        optimizationId,
        roundNumber,
        regressedRound: previousRound.roundIndex,
        regressedVersionId: regressedVersion.id,
        generationBaseVersionId: baseVersion.id,
      },
      'optimization_round_regression_retry_context',
    );

    return {
      generationBaseVersion: baseVersion,
      analysisVersion: regressedVersion,
      analysisExperiment: {
        id: previousRound.id,
        roundIndex: previousRound.roundIndex,
        metrics: previousRound.metrics,
        promptVersionId: previousRound.promptVersionId,
      },
      previousExperiment: baseExperiment,
      previousVersion: baseVersion,
      regressionRetry: true,
    };
  }

  private async prepareRoundImpl(optimizationId: string, roundNumber: number): Promise<PrepareOutcome> {
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      return { kind: 'fatal', errorMessage: snapshot.reason ?? 'snapshot_invalid' };
    }

    // Load dataset samples + this round's optimization context (consumed by the strategy package)
    const samplesRaw = await this.repo.loadDatasetSamples(snapshot.datasetId);
    if (samplesRaw.length === 0) {
      return { kind: 'fatal', errorMessage: 'dataset_empty' };
    }

    const roundContext = await this.resolveRoundOptimizationContext(optimizationId, roundNumber, snapshot);
    if ('errorMessage' in roundContext) {
      return {
        kind: 'fatal',
        errorMessage: roundContext.errorMessage,
        analysisFailure: true,
      };
    }
    const {
      generationBaseVersion: baseVersionForRound,
      analysisVersion,
      analysisExperiment,
      previousExperiment,
      previousVersion,
    } = roundContext;

    // SPEC 25 §11.4.1: step status / reuse metadata inside prepareRoundImpl
    const dbosWorkflowIdForSteps = DBOS.workflowID ?? null;

    // Parse the expected field name from judgmentRules consistently with the experiment channel, so both channels read the same expected
    const samples: SampleRecord[] = buildSamplesForStrategy(samplesRaw, baseVersionForRound.judgmentRules?.config);

    const rawCurrent = await this.repo.loadRunResultsByExperiment(analysisExperiment.id);
    const rawPrevious = previousExperiment ? await this.repo.loadRunResultsByExperiment(previousExperiment.id) : null;
    const currentRunResults = mapRunResultsForStrategy(rawCurrent);
    const previousRunResults = rawPrevious ? mapRunResultsForStrategy(rawPrevious) : null;
    const analysisMetrics = this.toMetricSnapshot(analysisExperiment.metrics) ?? snapshot.bestMetrics;

    // SPEC 25 §11.3 cross-round history — injected into both LLM calls (analyze / generate) so the LLM avoids repeated ineffective changes across rounds.
    // First round (roundNumber=1) → empty array → the strategy package does not render the history section (backward compatible).
    const roundHistoryRows = await this.loadRoundHistoryStep(optimizationId, roundNumber);
    const roundHistory = this.buildRoundHistoryEntries(roundHistoryRows, snapshot.goals);

    // SPEC 25 §11.3 "toolbox rotation hint" — when !isBest for ≥ 2 consecutive rounds, build a hint and inject it into the generate user prompt.
    // streak < 2 → undefined; the strategy package skips this section.
    const noBestStreak = computeNoBestStreak(roundHistory);
    const toolboxSwitchHint = (() => {
      if (noBestStreak < 2) return undefined;
      const recentEntries = roundHistory.slice(-2);
      const usedSet = new Set<string>();
      for (const entry of recentEntries) {
        for (const tip of entry.appliedTips) {
          const trimmed = tip.trim();
          if (trimmed.length > 0) usedSet.add(trimmed);
        }
      }
      return {
        recentlyUsedTips: Array.from(usedSet),
        allTipNames: getOptimizationTipNames(snapshot.promptLanguage),
      };
    })();
    if (toolboxSwitchHint) {
      this.logger.info(
        {
          optimizationId,
          roundNumber,
          streak: noBestStreak,
          recentlyUsedTips: toolboxSwitchHint.recentlyUsedTips,
        },
        'optimization_toolbox_switch_triggered',
      );
    }

    // Deterministic UUID (uuidv5): on replay, the same id hits INSERT WHERE NOT EXISTS,
    // so duplicate rows are never written (SPEC 25 §11.2)
    const analysisRunResultId = deterministicUuid(`${optimizationId}:${roundNumber}:analysis`);
    const generateRunResultId = deterministicUuid(`${optimizationId}:${roundNumber}:generate`);
    const versionId = deterministicUuid(`${optimizationId}:${roundNumber}:version`);
    const experimentId = deterministicUuid(`${optimizationId}:${roundNumber}:experiment`);

    // Inside a step, fetch the current workflow id and thread it through logs and run_results.dbos_workflow_id (SPEC 05 §5.6)
    const dbosWorkflowId = DBOS.workflowID ?? null;
    const analysisRunResultMeta = {
      projectId: snapshot.projectId,
      sourceId: optimizationId,
      promptVersionId: analysisVersion.id,
      modelId: snapshot.analysisModel.id,
      dbosWorkflowId,
      bullmqJobId: null,
      attempt: 0,
    };
    const generateRunResultMeta = {
      projectId: snapshot.projectId,
      sourceId: optimizationId,
      promptVersionId: baseVersionForRound.id,
      modelId: snapshot.analysisModel.id,
      dbosWorkflowId,
      bullmqJobId: null,
      attempt: 0,
    };

    // SPEC 25 §11.4.1: reuse the already-success analysis run_result, skipping the LLM call to avoid duplicate token charges
    let analysisFull: AnalyzeFailuresResult;
    const existingAnalysis = await this.peekOptimizationRunResultStep(
      optimizationId,
      roundNumber,
      'optimization_analysis',
    );
    if (existingAnalysis) {
      analysisFull = reconstructAnalysisFromRunResult(existingAnalysis);
      this.logger.info(
        { optimizationId, roundNumber, source: 'optimization_analysis' },
        'optimization_reuse_run_result',
      );
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'error_analysis',
        status: 'success',
        finishedAt: new Date(),
        runResultId: analysisRunResultId,
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
    } else {
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'error_analysis',
        status: 'running',
        startedAt: new Date(),
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
      try {
        const analysisModel = await this.applySynchronousRuntimeLimits(
          {
            projectId: snapshot.projectId,
            ...(snapshot.orgId ? { orgId: snapshot.orgId } : {}),
            source: 'local',
          },
          snapshot.analysisModel,
          'optimization_analysis',
        );
        analysisFull = await analyzeFailures(
          {
            optimizationId,
            roundNumber,
            analysisModel,
            analysisLimiterKey: snapshot.analysisLimiterKey,
            currentVersion: analysisVersion,
            previousVersion,
            samples,
            currentRunResults,
            previousRunResults,
            metrics: analysisMetrics,
            goals: snapshot.goals,
            fieldWhitelist: snapshot.fieldWhitelist,
            strategyConfig: snapshot.strategyConfig,
            promptLanguage: snapshot.promptLanguage,
            roundHistory,
            runResultMeta: analysisRunResultMeta,
            analysisRunResultId,
          },
          {
            limiter: this.limiter as RateLimiterLike,
            logger: this.llmLogger,
            runResultWriter: this.runResultWriter,
          },
        );
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'error_analysis',
          status: 'success',
          finishedAt: new Date(),
          runResultId: analysisRunResultId,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
      } catch (error) {
        const message = error instanceof RateLimitExceededError ? 'rate_limited' : (error as Error).message;
        const { errorClass, errorMessage } = normalizeErrorForStep(error);
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'error_analysis',
          status: 'failed',
          finishedAt: new Date(),
          errorClass,
          errorMessage,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
        return {
          kind: 'fatal',
          errorMessage: `analysis_failed: ${message}`,
          analysisFailure: true,
        };
      }
    }

    // ---- Generate LLM (SPEC 25 §11.4.1: same reuse mechanism) ----
    let generated: {
      newPromptBody: string;
      changeSummary: string;
      newOutputSchema?: unknown;
      outputSchemaChangeReason?: string;
      // SPEC 25 §11: when the LLM repeatedly fails to keep the base placeholders already in use, generate auto-appends the missing placeholders at the end of newPromptBody
      // and marks autoPatched=true. Based on this, the workflow assembles a changeReason tag so the frontend chip alerts the user to tweak manually.
      autoPatched?: boolean;
      patchedVariables?: string[];
    };
    const existingGenerate = await this.peekOptimizationRunResultStep(
      optimizationId,
      roundNumber,
      'optimization_generate',
    );
    if (existingGenerate) {
      generated = reconstructGenerateFromRunResult(existingGenerate, baseVersionForRound.body);
      this.logger.info(
        { optimizationId, roundNumber, source: 'optimization_generate' },
        'optimization_reuse_run_result',
      );
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'generate_prompt',
        status: 'success',
        finishedAt: new Date(),
        runResultId: generateRunResultId,
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
    } else {
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'generate_prompt',
        status: 'running',
        startedAt: new Date(),
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
      try {
        const analysisModel = await this.applySynchronousRuntimeLimits(
          {
            projectId: snapshot.projectId,
            ...(snapshot.orgId ? { orgId: snapshot.orgId } : {}),
            source: 'local',
          },
          snapshot.analysisModel,
          'optimization_generate',
        );
        const draft = await generateNextVersion(
          {
            optimizationId,
            roundNumber,
            analysisModel,
            analysisLimiterKey: snapshot.analysisLimiterKey,
            currentVersion: baseVersionForRound,
            analysis: analysisFull,
            metrics: analysisMetrics,
            goals: snapshot.goals,
            fieldWhitelist: snapshot.fieldWhitelist,
            optimizationHint: snapshot.optimizationHint,
            strategyConfig: snapshot.strategyConfig,
            promptLanguage: snapshot.promptLanguage,
            roundHistory,
            toolboxSwitchHint,
            runResultMeta: generateRunResultMeta,
            generateRunResultId,
          },
          {
            limiter: this.limiter as RateLimiterLike,
            logger: this.llmLogger,
            runResultWriter: this.runResultWriter,
          },
        );
        generated = {
          newPromptBody: draft.newPromptBody,
          changeSummary: draft.changeSummary,
          newOutputSchema: draft.newOutputSchema,
          outputSchemaChangeReason: draft.outputSchemaChangeReason,
          autoPatched: draft.autoPatched,
          patchedVariables: draft.patchedVariables,
        };
        if (draft.autoPatched) {
          this.logger.warn(
            {
              optimizationId,
              roundNumber,
              patchedVariables: draft.patchedVariables,
              retries: draft.retries,
            },
            'optimization_generate_auto_patched_round',
          );
        } else if (draft.retries > 0) {
          this.logger.info(
            { optimizationId, roundNumber, retries: draft.retries },
            'optimization_generate_succeeded_after_retry',
          );
        }
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'generate_prompt',
          status: 'success',
          finishedAt: new Date(),
          runResultId: generateRunResultId,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
      } catch (error) {
        const message = error instanceof RateLimitExceededError ? 'rate_limited' : (error as Error).message;
        const { errorClass, errorMessage } = normalizeErrorForStep(error);
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'generate_prompt',
          status: 'failed',
          finishedAt: new Date(),
          errorClass,
          errorMessage,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
        return {
          kind: 'fatal',
          errorMessage: `generate_failed: ${message}`,
          analysisFailure: true,
        };
      }
    }

    // ---- Write the new version (idempotent: deterministic versionId + ON CONFLICT DO NOTHING) ----
    if (!snapshot.promptId) {
      return { kind: 'fatal', errorMessage: 'prompt_id_missing' };
    }
    const variables: PromptVariableDto[] = parseVariables(baseVersionForRound.variables);
    // The newOutputSchema provided by the LLM that passes safeValidateNewOutputSchema takes precedence; otherwise inherit the baseline schema.
    const outputSchemaForVersion = (generated.newOutputSchema ??
      baseVersionForRound.outputSchema ??
      null) as PromptOutputSchemaDto;
    const judgmentRulesForVersion = (
      baseVersionForRound.judgmentRules &&
      typeof baseVersionForRound.judgmentRules === 'object' &&
      'config' in baseVersionForRound.judgmentRules
        ? (baseVersionForRound.judgmentRules as { config: unknown }).config
        : null
    ) as PromptJudgmentRulesDto;

    const baseChangeReason = generated.outputSchemaChangeReason
      ? `${generated.changeSummary}\n\n[output schema 变更] ${generated.outputSchemaChangeReason}`
      : generated.changeSummary;
    // SPEC 25 §11: when autoPatched=true, append the patch tag at the end of changeReason; the frontend round card uses this to render the "system patch" chip
    const changeReason =
      generated.autoPatched && generated.patchedVariables && generated.patchedVariables.length > 0
        ? `${baseChangeReason}\n\n[系统自动补丁] 补回占位：${generated.patchedVariables.join(', ')}`
        : baseChangeReason;

    await this.promptRepo.createOptimizationFrozenVersion({
      versionId,
      promptId: snapshot.promptId,
      parentVersionId: baseVersionForRound.id,
      body: generated.newPromptBody,
      variables,
      outputSchema: outputSchemaForVersion,
      judgmentRules: judgmentRulesForVersion,
      promptLanguage: snapshot.promptLanguage,
      optimizationId,
      changeReason,
      createdBy: snapshot.createdBy,
    });

    // ---- Create the child experiment (idempotent: deterministic experimentId + ON CONFLICT DO NOTHING + partial unique) ----
    await this.repo.createChildExperimentRow({
      id: experimentId,
      projectId: snapshot.projectId,
      name: await this.buildOptimizationExperimentNameForInsert({
        projectId: snapshot.projectId,
        experimentId,
        optimizationId,
        optimizationName: snapshot.optimizationName,
        round: roundNumber,
      }),
      promptVersionId: versionId,
      datasetId: snapshot.datasetId,
      modelId: snapshot.taskModel.id,
      optimizationId,
      roundIndex: roundNumber,
      runConfig: snapshot.childRunConfig,
      totalSamples: samples.length,
      createdBy: snapshot.createdBy,
    });

    // The experiment step enters running: at this point the third dot of the detail-page stepper starts spinning;
    // the real terminal state is written by finalizeRoundImpl (after the child experiment completes).
    await this.upsertStepSafe({
      optimizationId,
      roundIndex: roundNumber,
      step: 'experiment',
      status: 'running',
      startedAt: new Date(),
      experimentId,
      dbosWorkflowId: dbosWorkflowIdForSteps,
    });

    // Starting the child ExperimentWorkflow + waiting + comparing metrics is now split between runImpl (workflow) layer
    // and finalizeRoundImpl (step): DBOS forbids calling startWorkflow inside a step.
    return { kind: 'launch', experimentId };
  }

  // Wrapped in try-catch: an upsertRoundStep failure must not block the workflow main path (round_steps table is just
  // a UX enhancement for the detail page; when data is missing, the frontend falls back and can still render). Failures are logged at warn.
  private async upsertStepSafe(input: RoundStepUpsertInput): Promise<void> {
    try {
      await this.repo.upsertRoundStep(input);
    } catch (err) {
      this.logger.warn(
        {
          optimizationId: input.optimizationId,
          roundIndex: input.roundIndex,
          step: input.step,
          status: input.status,
          err: (err as Error)?.message,
        },
        'optimization_round_step_upsert_failed',
      );
    }
  }

  private async finalizeRoundImpl(
    optimizationId: string,
    roundNumber: number,
    experimentId: string,
  ): Promise<RoundOutcome> {
    // Reload snapshot inside the step: sensitive fields like apiKey are not stored in the DBOS system tables, so we do not pass snapshot across steps
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      this.logger.warn(
        { optimizationId, roundNumber, reason: snapshot.reason },
        'optimization_finalize_round_snapshot_invalid',
      );
      return { kind: 'continue', metrics: undefined, isBest: false };
    }

    const versionId = deterministicUuid(`${optimizationId}:${roundNumber}:version`);

    // ---- Wait for the child experiment to finish (each round has its own poll, and polling is idempotent on replay) ----
    // SPEC 25 §7 dual path: inside poll, also read the parent control_state; on stop/cancel, propagate to stop the child experiment, then continue polling to terminal
    const finalState = await this.waitForExperimentTerminal(
      experimentId,
      optimizationId,
      roundNumber,
      snapshot.projectId,
    );
    const dbosWfId = DBOS.workflowID ?? null;
    if (finalState.status === 'cancelled' || finalState.status === 'stopped') {
      // The parent workflow observes control_state at the next step boundary; treat this round as continue/skip
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'experiment',
        status: 'skipped',
        finishedAt: new Date(),
        experimentId,
        dbosWorkflowId: dbosWfId,
      });
      return { kind: 'continue', metrics: undefined, isBest: false };
    }
    if (finalState.status === 'failed') {
      // A single-round failure that is not fatal — continue to the next round (do not block the whole optimization); fatal only on fatal errors in analysis/generate
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'experiment',
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: 'experiment_failed',
        experimentId,
        dbosWorkflowId: dbosWfId,
      });
      return { kind: 'continue', metrics: undefined, isBest: false };
    }

    const roundMetrics = this.toMetricSnapshot(finalState.metrics) ?? emptyMetrics();
    const decision = decideRoundOutcome({
      roundMetrics,
      bestMetrics: snapshot.bestMetrics,
      goals: snapshot.goals,
    });

    if (decision.isBest) {
      await this.repo.updateBest(optimizationId, versionId, roundMetrics.overall);
    }
    await this.repo.updateCurrentRound(optimizationId, roundNumber);
    await this.upsertStepSafe({
      optimizationId,
      roundIndex: roundNumber,
      step: 'experiment',
      status: 'success',
      finishedAt: new Date(),
      experimentId,
      dbosWorkflowId: dbosWfId,
    });

    if (decision.goalsMet) {
      return { kind: 'goals_met', metrics: roundMetrics, isBest: decision.isBest };
    }
    return { kind: 'continue', metrics: roundMetrics, isBest: decision.isBest };
  }

  private async markChildLaunchFailedImpl(
    experimentId: string,
    message: string,
    optimizationId: string,
    roundNumber: number,
  ): Promise<void> {
    await this.repo.markChildExperimentFailed(experimentId, `launch_failed: ${message}`);
    await this.upsertStepSafe({
      optimizationId,
      roundIndex: roundNumber,
      step: 'experiment',
      status: 'failed',
      finishedAt: new Date(),
      errorClass: 'LaunchFailed',
      errorMessage: `launch_failed: ${message.slice(0, 1000)}`,
      experimentId,
      dbosWorkflowId: DBOS.workflowID ?? null,
    });
  }

  private async finalizeImpl(
    optimizationId: string,
    kind: FinalizeKind,
    options: { reason?: string; analysisFailureReason?: string },
  ): Promise<void> {
    const updated = await this.repo.finalize(optimizationId, kind, {
      summary: options.reason ? { kind, reason: options.reason, finalizedAt: new Date().toISOString() } : undefined,
      analysisFailureReason: options.analysisFailureReason ?? null,
    });
    if (!updated) {
      // service has already done preemptive terminal-state write (stop/cancel directly writes status); the workflow's own finalize is intercepted by the guard.
      // Reaching here means the workflow has finished its own cleanup; no need to overwrite status again.
      this.logger.debug(
        { optimizationId, kind, reason: options.reason },
        'optimization_finalize_no_op_already_terminal',
      );
      return;
    }
    this.logger.info({ optimizationId, kind, reason: options.reason }, 'optimization_finalized');
  }

  // SPEC 25 §11.4.1: check whether the LLM result for this round is already success in DB; on hit, skip the LLM call
  // Strictly filter status='success'; non-success rows (rate_limited/timeout/error) are not reused — normal re-invocation
  private async peekOptimizationRunResultImpl(
    optimizationId: string,
    roundNumber: number,
    source: 'optimization_analysis' | 'optimization_generate',
  ): Promise<{ parsedOutput: unknown; rawResponse: string | null } | null> {
    const row = await this.repo.findExistingOptimizationRunResult(optimizationId, roundNumber, source, {
      statusFilter: 'success',
    });
    if (!row) return null;
    return { parsedOutput: row.parsedOutput, rawResponse: row.rawResponse };
  }

  // SPEC 25 §7 dual-path linkage: on parent stop/cancel, call the child experiment's controlExperiment; parent resume also goes through this step
  // Child experiment is already terminal (success/failed/cancelled/stopped) or the row does not exist → swallow Conflict/NotFound
  // Other errors throw so DBOS step retries (poll is the backstop guaranteeing eventual consistency)
  private async controlChildExperimentImpl(
    projectId: string,
    experimentId: string,
    action: ChildExperimentAction,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.experimentService.controlExperiment(
        projectId,
        experimentId,
        action,
        SYSTEM_ACTOR_OPTIMIZATION,
        'system',
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        this.logger.warn(
          { projectId, experimentId, action, err: (error as Error).message },
          'optimization_child_control_skipped',
        );
        return { ok: true, reason: 'already_terminal_or_invalid' };
      }
      throw error;
    }
  }

  // SPEC 25 §7 resume granularity: on resume, when entering the interrupted round, check the child experiment's current status to decide the action
  // Returning null means the experiments row does not exist (should be very rare; usually because it was hard-deleted externally)
  private async queryChildExperimentStatusImpl(
    experimentId: string,
  ): Promise<{ status: string; controlState: string | null } | null> {
    const rows = await this.db
      .select({ status: experiments.status, controlState: experiments.controlState })
      .from(experiments)
      .where(eq(experiments.id, experimentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { status: row.status, controlState: row.controlState };
  }

  // ---------- helpers ----------

  private async loadModelInvocationConfig(modelId: string): Promise<ModelInvocationConfig | null> {
    const [row] = await this.db.select().from(models).where(eq(models.id, modelId)).limit(1);
    if (!row || !row.isActive || row.deletedAt) return null;
    return {
      id: row.id,
      providerType: row.providerType,
      providerModelId: row.providerModelId,
      endpoint: row.endpoint,
      apiKey: this.crypto.decryptApiKey(row.apiKeyEncrypted),
      capabilities: toModelInvocationCapabilities(row.capabilities),
      rpmLimit: row.rpmLimit,
      tpmLimit: row.tpmLimit,
      concurrencyLimit: row.concurrencyLimit,
      autoConcurrency: row.autoConcurrency,
      inputTokenPricePerMillion: row.inputTokenPricePerMillion,
      outputTokenPricePerMillion: row.outputTokenPricePerMillion,
      extraBody: toExtraBody(row.extraBody),
    };
  }

  private async loadPromptVersionRef(versionId: string): Promise<PromptVersionRef | null> {
    const [row] = await this.db
      .select({
        id: schema.promptVersions.id,
        promptId: schema.promptVersions.promptId,
        versionNumber: schema.promptVersions.versionNumber,
        body: schema.promptVersions.body,
        outputSchema: schema.promptVersions.outputSchema,
        promptLanguage: schema.promptVersions.promptLanguage,
        judgmentRules: schema.promptVersions.judgmentRules,
        variables: schema.promptVersions.variables,
      })
      .from(schema.promptVersions)
      .where(eq(schema.promptVersions.id, versionId))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      promptId: row.promptId,
      versionNumber: row.versionNumber,
      body: row.body ?? '',
      outputSchema: row.outputSchema,
      promptLanguage: parsePromptLanguage(row.promptLanguage),
      judgmentRules:
        row.judgmentRules && typeof row.judgmentRules === 'object'
          ? { ruleName: 'default', config: row.judgmentRules }
          : undefined,
      variables: parseVariables(row.variables),
    };
  }

  private async waitForExperimentTerminal(
    experimentId: string,
    optimizationId: string,
    roundNumber: number,
    projectId: string,
  ): Promise<{ status: string; metrics: unknown }> {
    const start = Date.now();
    let pollIndex = 0;
    let parentControlLinked = false; // Prevent the same stop/cancel signal from repeatedly calling service (after controlState is set, service throws Conflict; while swallowed, the log noise is large)
    while (Date.now() - start < POLL_TIMEOUT_SEC * 1000) {
      const [exp] = await this.db
        .select({ status: experiments.status, metrics: experiments.metrics })
        .from(experiments)
        .where(eq(experiments.id, experimentId))
        .limit(1);
      if (!exp) {
        return { status: 'failed', metrics: null };
      }
      if (
        exp.status === 'success' ||
        exp.status === 'failed' ||
        exp.status === 'stopped' ||
        exp.status === 'cancelled'
      ) {
        return { status: exp.status, metrics: exp.metrics };
      }

      // SPEC 25 §7 dual-path linkage: inside poll, read parent status + control_state.
      //   - When the parent controlState is stop/cancel, propagate to the child experiment via controlExperiment (redundant backstop:
      //     service.tryLinkChildExperimentControl is called first; this covers the corner case where the service call failed).
      //   - When the parent status is no longer running (service preemptive terminal write) → end poll immediately and treat the child experiment as stopped
      //     (so finalizeRoundImpl goes through the continue branch; once the main loop top reads the parent status, it exits directly).
      const parent = await this.repo.findStatusAndControl(optimizationId);
      const parentControl = parent?.controlState ?? null;
      if (!parentControlLinked && (parentControl === 'stop' || parentControl === 'cancel')) {
        const action: ChildExperimentAction = parentControl;
        await this.controlChildExperimentStep(projectId, experimentId, action);
        parentControlLinked = true;
        this.logger.info(
          { optimizationId, roundNumber, experimentId, action, parentStatus: parent?.status },
          'optimization_child_control_linked_from_poll',
        );
      }
      if (parent && parent.status !== 'running') {
        this.logger.info(
          {
            optimizationId,
            roundNumber,
            experimentId,
            parentStatus: parent.status,
            expStatus: exp.status,
          },
          'optimization_round_wait_parent_terminal_exit',
        );
        return { status: 'stopped', metrics: exp.metrics };
      }

      const sleepSec = POLL_SLEEP_SCHEDULE_SEC[Math.min(pollIndex, POLL_SLEEP_SCHEDULE_SEC.length - 1)] ?? 10;
      pollIndex += 1;
      await DBOS.sleepSeconds(sleepSec);
      this.logger.debug(
        { optimizationId, roundNumber, experimentId, pollIndex, status: exp.status, parentControlLinked },
        'optimization_round_wait_tick',
      );
    }
    return { status: 'failed', metrics: null };
  }

  private toMetricSnapshot(value: unknown): MetricSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const overall: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v)) overall[k] = v;
      else if (k === 'per_class' && v && typeof v === 'object') {
        // handled below
      }
    }
    const perClassRaw = obj['per_class'];
    let perClass: Record<string, Record<string, number>> | undefined;
    if (perClassRaw && typeof perClassRaw === 'object') {
      perClass = {};
      for (const [cls, metrics] of Object.entries(perClassRaw as Record<string, unknown>)) {
        if (!metrics || typeof metrics !== 'object') continue;
        const inner: Record<string, number> = {};
        for (const [mk, mv] of Object.entries(metrics as Record<string, unknown>)) {
          if (typeof mv === 'number' && Number.isFinite(mv)) inner[mk] = mv;
        }
        perClass[cls] = inner;
      }
    }
    return { overall, perClass };
  }

  private extractAnalysisText(parsedOutput: unknown, rawResponse: string | null): string {
    if (parsedOutput && typeof parsedOutput === 'object') {
      const obj = parsedOutput as Record<string, unknown>;
      if (typeof obj['errorAnalysisText'] === 'string') return obj['errorAnalysisText'] as string;
      if (typeof obj['summary'] === 'string') return obj['summary'] as string;
    }
    if (typeof rawResponse === 'string' && rawResponse.length > 0) return rawResponse;
    return '';
  }

  private extractGeneratedDraft(
    parsedOutput: unknown,
    rawResponse: string | null,
    fallbackBody: string,
  ): { newPromptBody: string; changeSummary: string } {
    if (parsedOutput && typeof parsedOutput === 'object') {
      const obj = parsedOutput as Record<string, unknown>;
      const body = typeof obj['newPromptBody'] === 'string' ? (obj['newPromptBody'] as string) : null;
      const summary = typeof obj['changeSummary'] === 'string' ? (obj['changeSummary'] as string) : '';
      if (body) return { newPromptBody: body, changeSummary: summary };
    }
    if (typeof rawResponse === 'string' && rawResponse.length > 0) {
      return { newPromptBody: rawResponse, changeSummary: '' };
    }
    return { newPromptBody: fallbackBody, changeSummary: 'restored_from_failed_replay' };
  }
}

// ---------- module-level helpers ----------

function mapRunResultsForStrategy(rows: OptimizationRunResultRow[]): RunResultRecord[] {
  return rows.map((r) => ({
    id: r.id,
    sampleId: r.sampleId ?? '',
    parsedOutput: r.parsedOutput,
    decisionOutput: r.decisionOutput,
    isCorrect: r.isCorrect,
    errorMessage: r.errorMessage,
    rawResponse: r.rawResponse,
  }));
}

// SPEC 25 §11.4.1: reconstruct the strategy package analyzeFailures return shape from run_results.parsed_output,
// so that prepareRoundImpl can skip the actual call when the LLM already has a success result.
// Note: on the reuse path, batches/confusionPairs/regressionGroups are left empty — downstream generateNextVersion only reads
// errorAnalysisText, not these fields; the detail page also reads run_results.parsed_output directly and does not depend on workflow memory.
export function reconstructAnalysisFromRunResult(row: {
  parsedOutput: unknown;
  rawResponse: string | null;
}): AnalyzeFailuresResult {
  const parsed = isObject(row.parsedOutput) ? (row.parsedOutput as Record<string, unknown>) : null;
  const summaryText = readSummaryText(parsed, row.rawResponse);
  const errorPatterns =
    parsed && Array.isArray(parsed['errorPatterns'])
      ? (parsed['errorPatterns'] as SummarizeOutput['errorPatterns'])
      : [];
  const suggestedChanges =
    parsed && Array.isArray(parsed['suggestedChanges'])
      ? (parsed['suggestedChanges'] as SummarizeOutput['suggestedChanges'])
      : [];
  const conflicts =
    parsed && Array.isArray(parsed['conflicts'])
      ? (parsed['conflicts'] as NonNullable<SummarizeOutput['conflicts']>)
      : [];
  const summary: SummarizeOutput = {
    summary: summaryText,
    errorPatterns,
    suggestedChanges,
    conflicts,
    evidenceBundleVersion: 1,
    truncated: false,
    rawContent: row.rawResponse ?? '',
  };
  const fallbackBundle: AnalysisEvidenceBundle = {
    evidenceBundleVersion: 1,
    summary: summaryText,
    errorPatterns,
    suggestedChanges,
    conflicts,
    sourceStats: {
      batchCount: 0,
      totalConfusionFailures: 0,
      totalRegressionSamples: 0,
      truncated: false,
    },
  };
  const evidenceBundle =
    parsed && isObject(parsed['evidenceBundle'])
      ? ({ ...fallbackBundle, ...(parsed['evidenceBundle'] as Record<string, unknown>) } as AnalysisEvidenceBundle)
      : fallbackBundle;
  return {
    errorAnalysisText: summaryText,
    summary,
    evidenceBundle,
    batches: [],
    confusionPairs: [],
    regressionGroups: [],
    truncated: evidenceBundle.sourceStats?.truncated ?? false,
    totalConfusionFailures: evidenceBundle.sourceStats?.totalConfusionFailures ?? 0,
    totalRegressionSamples: evidenceBundle.sourceStats?.totalRegressionSamples ?? 0,
  };
}

// SPEC 25 §11.4.1: reconstruct generateNextVersion return fields from run_results.parsed_output.
// A success row's parsed_output is guaranteed to have newPromptBody; rawResponse is a fallback for extreme races.
// newOutputSchema / outputSchemaChangeReason are optional: present when the LLM provides one and it passes validation.
// autoPatched / patchedVariables are written into parsedOutput by the generate retry+patch path; the workflow also passes them through on reuse.
export function reconstructGenerateFromRunResult(
  row: { parsedOutput: unknown; rawResponse: string | null },
  fallbackBody: string,
): {
  newPromptBody: string;
  changeSummary: string;
  newOutputSchema?: unknown;
  outputSchemaChangeReason?: string;
  autoPatched?: boolean;
  patchedVariables?: string[];
} {
  if (isObject(row.parsedOutput)) {
    const obj = row.parsedOutput as Record<string, unknown>;
    const body = typeof obj['newPromptBody'] === 'string' ? (obj['newPromptBody'] as string) : null;
    const summary = typeof obj['changeSummary'] === 'string' ? (obj['changeSummary'] as string) : '';
    if (body) {
      const result: {
        newPromptBody: string;
        changeSummary: string;
        newOutputSchema?: unknown;
        outputSchemaChangeReason?: string;
        autoPatched?: boolean;
        patchedVariables?: string[];
      } = { newPromptBody: body, changeSummary: summary };
      if (isObject(obj['newOutputSchema'])) {
        result.newOutputSchema = obj['newOutputSchema'];
      }
      if (
        typeof obj['outputSchemaChangeReason'] === 'string' &&
        (obj['outputSchemaChangeReason'] as string).length > 0
      ) {
        result.outputSchemaChangeReason = obj['outputSchemaChangeReason'] as string;
      }
      if (typeof obj['autoPatched'] === 'boolean') {
        result.autoPatched = obj['autoPatched'] as boolean;
      }
      if (Array.isArray(obj['patchedVariables'])) {
        result.patchedVariables = (obj['patchedVariables'] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        );
      }
      return result;
    }
  }
  if (typeof row.rawResponse === 'string' && row.rawResponse.length > 0) {
    return { newPromptBody: row.rawResponse, changeSummary: '' };
  }
  return { newPromptBody: fallbackBody, changeSummary: 'restored_from_reuse' };
}

// Extract LLM-self-reported appliedTips from generate run_results.parsed_output; filter out invalid items.
// Used by buildRoundHistoryEntries to back out the "toolbox rotation hint" basis (SPEC 25 §11.3). Legacy data / parse failure → [].
export function extractAppliedTipsFromGenerateParsedOutput(parsedGen: unknown): string[] {
  if (!parsedGen || typeof parsedGen !== 'object') return [];
  const tips = (parsedGen as { appliedTips?: unknown }).appliedTips;
  if (!Array.isArray(tips)) return [];
  return tips.filter((t): t is string => typeof t === 'string' && t.length > 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSummaryText(parsed: Record<string, unknown> | null, rawResponse: string | null): string {
  if (parsed) {
    if (typeof parsed['summary'] === 'string') return parsed['summary'] as string;
    if (typeof parsed['errorAnalysisText'] === 'string') return parsed['errorAnalysisText'] as string;
  }
  if (typeof rawResponse === 'string' && rawResponse.length > 0) return rawResponse;
  return '';
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function readOptimizationHintFromContext(ctx: {
  optimizationHint?: string | null;
  runConfig?: unknown;
}): string | undefined {
  const direct = normalizeOptionalText(ctx.optimizationHint);
  if (direct) return direct;
  const runConfig =
    ctx.runConfig && typeof ctx.runConfig === 'object' ? (ctx.runConfig as Record<string, unknown>) : {};
  const legacy = typeof runConfig['optimizationHint'] === 'string' ? runConfig['optimizationHint'] : undefined;
  return normalizeOptionalText(legacy) ?? undefined;
}

// Normalize LLM call / parsing exceptions into round_steps.error_class + error_message.
// errorMessage length truncated to 1000 chars to prevent a giant stack from being stuffed into the DB.
function normalizeErrorForStep(err: unknown): { errorClass: string; errorMessage: string } {
  const errObj = err as { name?: string; message?: string } | undefined;
  const errorClass = typeof errObj?.name === 'string' && errObj.name.length > 0 ? errObj.name : 'Error';
  const rawMsg = typeof errObj?.message === 'string' ? errObj.message : String(err ?? 'unknown');
  return { errorClass, errorMessage: rawMsg.slice(0, 1000) };
}

// SPEC 25 §11 child experiment runConfig inheritance: optimizations.run_config is parsed against experimentRunConfigSchema;
// unknown fields (stopAfterNoImprovementRounds, etc.) are preserved by catchall; later, service
// parseRunConfig filters again with the same schema, ensuring child experiment runConfig only exposes the experimentRunConfigSchema field set.
export function parseChildRunConfigFromOptimization(value: unknown): ExperimentRunConfigDto {
  const parsed = experimentRunConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function invalidSnapshot(reason: string): WorkflowConfigSnapshot {
  return {
    ok: false,
    reason,
    projectId: '',
    optimizationName: '',
    promptId: null,
    baseVersionId: null,
    basePromptVersion: null,
    datasetId: '',
    datasetSampleCount: 0,
    startingMode: '',
    sourceExperimentId: null,
    promptLanguage: DEFAULT_PROMPT_LANGUAGE,
    analysisModel: emptyModel(),
    analysisLimiterKey: '',
    taskModel: emptyModel(),
    goals: [],
    fieldWhitelist: { promptVariables: [] },
    strategy: '',
    strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
    maxRounds: 0,
    optimizationHint: undefined,
    createdBy: '',
    nextRound: 1,
    bestVersion: null,
    bestMetrics: emptyMetrics(),
    childRunConfig: {},
    resumeChildExpId: null,
  };
}

function emptyMetrics(): MetricSnapshot {
  return { overall: {} };
}

function emptyModel(): ModelInvocationConfig {
  return {
    id: '',
    providerType: '',
    providerModelId: '',
    endpoint: '',
    apiKey: '',
    rpmLimit: 0,
    tpmLimit: 0,
    concurrencyLimit: 0,
    autoConcurrency: false,
    inputTokenPricePerMillion: 0,
    outputTokenPricePerMillion: 0,
    extraBody: {},
  };
}

function parsePromptLanguage(value: unknown): PromptLanguageDto {
  const parse = promptLanguageSchema.safeParse(value);
  return parse.success ? parse.data : DEFAULT_PROMPT_LANGUAGE;
}

function toModelInvocationCapabilities(raw: unknown): ModelInvocationConfig['capabilities'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const image = (raw as Record<string, unknown>).image;
    if (typeof image === 'string' && ['none', 'url', 'base64', 'both'].includes(image)) {
      return { image: image as ModelImageCapability };
    }
  }
  return { image: 'none' };
}

function toExtraBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function toLoopGoal(dto: OptimizationGoalDto): OptimizationGoal {
  const op = dto.comparator === 'gte' ? '>=' : dto.comparator === 'gt' ? '>' : '<=';
  const scope =
    dto.scope === 'overall' || !dto.scope
      ? ({ kind: 'overall' } as const)
      : ({ kind: 'class', label: dto.scope } as const);
  return {
    metric: dto.metric,
    op,
    value: dto.target,
    scope,
  };
}

export function toLoopFieldWhitelist(dto: OptimizationFieldWhitelistDto | null, expectedField: string): FieldWhitelist {
  if (!dto) return { promptVariables: [] };
  // DTO uses inputFields / metaFields; the strategy package uses promptVariables / analysisOnlyFields.
  // Semantic mapping: inputFields = variables that may appear in the prompt template; metaFields = metadata fields shown only to the analysis LLM.
  // SPEC 25 §9 expresses these two concepts as one; the DTO is the current minimal set; modifiableSections has no DTO field yet and is left empty.
  //
  // Safety constraint: the expected_field referenced by judgment rules (default expected_output) is the ground truth;
  // the business prompt MUST NOT inject it as a variable (it would leak the answer). If the UI / DTO puts it into inputFields (the frontend by default
  // dumps every dataset field), we strip it here and demote to analysisOnlyFields — eliminating leakage and
  // avoiding the over-reactive "defensive" response where the generate LLM sees this field name and strips every {{var}}.
  const inputFields = dto.inputFields.filter((f) => f !== expectedField);
  const analysisOnly = [...dto.metaFields, ...(dto.inputFields.includes(expectedField) ? [expectedField] : [])];
  return {
    promptVariables: inputFields,
    analysisOnlyFields: analysisOnly.length > 0 ? analysisOnly : undefined,
  };
}

export function parseVariables(raw: unknown): PromptVariableDto[] {
  if (!Array.isArray(raw)) return [];
  const list: PromptVariableDto[] = [];
  for (const item of raw) {
    const parse = promptVariableSchema.safeParse(item);
    if (parse.success) list.push(parse.data);
  }
  return list;
}

function deterministicUuid(seed: string): string {
  const hash = createHash('sha1').update(`${OPTIMIZATION_NS}:${seed}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isPromptBaselineBootstrapNeeded(startingMode: string): boolean {
  // SPEC 25 §2.1: from_dataset_only, after generateFirstVersionStep completes, follows the same baseline experiment flow as
  // from_prompt_version.
  return startingMode === 'from_prompt_version' || startingMode === 'from_dataset_only';
}

// SPEC 25 §2.1 maps a first-version-generation Error into a finalize reason code.
// FirstVersionParseError → first_version_parse_failed_v1
// The message already carries the `first_version_*_v1` prefix → take the prefix directly
// Others (network errors / LLM rate-limit exhaustion / panic) → first_version_generation_failed_v1
export function mapFirstVersionErrorReason(error: unknown): string {
  if (error instanceof FirstVersionParseError) return 'first_version_parse_failed_v1';
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.startsWith('first_version_dataset_empty_v1')) return 'first_version_dataset_empty_v1';
    if (msg.startsWith('first_version_parse_failed_v1')) return 'first_version_parse_failed_v1';
    if (msg.startsWith('first_version_generation_failed_v1')) {
      // Carries a sub-reason (e.g. :context_missing) → keep the prefix portion so the frontend mapping is more fine-grained
      return msg.split(':')[0] ?? 'first_version_generation_failed_v1';
    }
  }
  return 'first_version_generation_failed_v1';
}

// SPEC 25 §2.1: sampling for first-version generation — on replay, seed is pinned to `${optimizationId}:first-version`,
// guaranteeing the same batch of samples is drawn across replays; the LLM run_result is also written only once via a deterministic id.
export function pickRandomSamples<T>(items: T[], n: number, seed: string): T[] {
  if (items.length <= n) return items.slice();
  // seedable PRNG (xorshift32) — not crypto-strength, only requires replay consistency; state=0 self-locks, hence || 1
  let state = 0;
  for (const ch of seed) state = (state * 31 + ch.charCodeAt(0)) >>> 0;
  if (state === 0) state = 1;
  const rng = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
  const out = items.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (out.length - i));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out.slice(0, n);
}

export function computeOptimizationBaselineExperimentId(optimizationId: string): string {
  return deterministicUuid(`${optimizationId}:baseline:experiment`);
}

export function buildOptimizationExperimentName(
  optimizationName: string,
  round: 'baseline' | number,
  options: { collisionSalt?: string; maxLength?: number } = {},
): string {
  const maxLength = options.maxLength ?? OPTIMIZATION_EXPERIMENT_NAME_MAX_LENGTH;
  const trimmedName = optimizationName.trim() || OPTIMIZATION_EXPERIMENT_NAME_FALLBACK;
  const roundLabel = round === 'baseline' ? 'baseline' : `R${round}`;
  const collisionSuffix = options.collisionSalt
    ? `${OPTIMIZATION_EXPERIMENT_NAME_SEPARATOR}${shortHash(options.collisionSalt, 6)}`
    : '';
  const fixedSuffix = `${OPTIMIZATION_EXPERIMENT_NAME_SEPARATOR}${roundLabel}${collisionSuffix}`;
  const prefixMaxLength = Math.max(1, maxLength - fixedSuffix.length);
  const prefix = trimmedName.length <= prefixMaxLength ? trimmedName : trimmedName.slice(0, prefixMaxLength).trimEnd();
  return `${prefix || OPTIMIZATION_EXPERIMENT_NAME_FALLBACK}${fixedSuffix}`;
}

function shortHash(value: string, length: number): string {
  return createHash('sha1').update(value).digest('hex').slice(0, length);
}

function readJudgmentDecisionField(outputSchema: unknown): string | null {
  if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) return null;
  const fields = (outputSchema as Record<string, unknown>)['fields'];
  if (!Array.isArray(fields)) return null;
  for (const field of fields) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
    const record = field as Record<string, unknown>;
    if (record['isJudgment'] !== true && record['is_decision'] !== true && record['judgment'] !== true) continue;
    const key = record['key'] ?? record['name'];
    if (typeof key === 'string' && key.trim().length > 0) return key.trim();
  }
  return null;
}

export function deriveJudgmentRulesFromOutputSchema(
  outputSchema: PromptOutputSchemaDto,
  expectedField = 'expected_output',
): PromptJudgmentRulesDto {
  return {
    mode: 'exact_match',
    expected_field: expectedField,
    decision_field: readJudgmentDecisionField(outputSchema) ?? 'label',
  };
}

function normalizeBaselineExperimentStatus(status: string): BaselineExperimentStatus {
  if (status === 'success' || status === 'failed' || status === 'stopped' || status === 'cancelled') {
    return status;
  }
  return 'running';
}

// Behavior matches experiment.workflow.ts's same-name helper: reads the expected field name from judgmentRules JSONB,
// default 'expected_output'. The two channels keep their implementations separate to avoid cross-module coupling (SPEC 23/24's judgmentRules contract)
export function readExpectedField(rules: unknown): string {
  if (rules && typeof rules === 'object') {
    const record = rules as Record<string, unknown>;
    const f = record['expected_field'] ?? record['expectedField'];
    if (typeof f === 'string' && f.length > 0) return f;
    const rawRules = record['rules'];
    if (Array.isArray(rawRules)) {
      for (const rule of rawRules) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
        const nested =
          (rule as Record<string, unknown>)['expected_field'] ??
          (rule as Record<string, unknown>)['expectedField'] ??
          (rule as Record<string, unknown>)['value'];
        if (typeof nested === 'string' && nested.length > 0) return nested;
      }
    }
  }
  return 'expected_output';
}

// Project the dataset's raw samples into SampleRecord consumed by the strategy package; expected is pulled from data[expectedField];
// when absent, leave undefined; let the downstream confusion-pairs' asLabel decide whether to filter
export function buildSamplesForStrategy(
  samplesRaw: Array<{ id: string; data: Record<string, unknown> }>,
  judgmentRulesConfig: unknown,
): SampleRecord[] {
  const expectedField = readExpectedField(judgmentRulesConfig);
  return samplesRaw.map((s) => {
    const rawExpected = s.data[expectedField];
    return {
      id: s.id,
      input: s.data,
      expected: rawExpected == null ? undefined : rawExpected,
    };
  });
}

// Expose the stable id computation for e2e / mcp callers
export function computeOptimizationVersionId(optimizationId: string, roundNumber: number): string {
  return deterministicUuid(`${optimizationId}:${roundNumber}:version`);
}

export function computeOptimizationExperimentId(optimizationId: string, roundNumber: number): string {
  return deterministicUuid(`${optimizationId}:${roundNumber}:experiment`);
}

// These two variables come from the schema but are not directly imported; keep the corresponding types for later step usage
void runResults;
void asc;
void and;
