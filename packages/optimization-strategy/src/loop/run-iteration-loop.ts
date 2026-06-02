// Optimization main loop — see docs/specs/25-optimizations.md
import { analyzeFailures } from '../error-pattern-analysis/analyze';
import { generateNextVersion } from '../error-pattern-analysis/generate';
import type { ErrorPatternAnalysisConfig } from '../error-pattern-analysis/config.schema';
import { getOptimizationTipNames } from '../error-pattern-analysis/prompts';
import { isBetterThan } from './best';
import { allGoalsMet, evaluateGoals, readMetric } from './goals';
import {
  toInvokeLLMDependencies,
  type OptimizationConfig,
  type OptimizationGoal,
  type OptimizationReason,
  type OptimizationResult,
  type OptimizationStatus,
  type ExperimentSnapshot,
  type LoopDependencies,
  type LoopPorts,
  type MetricSnapshot,
  type PromptVersionRef,
  type RoundHistoryEntry,
  type RoundOutcome,
  type RunResultRecord,
} from './types';

function nowIso(deps: LoopDependencies): string {
  return new Date(deps.now?.() ?? Date.now()).toISOString();
}

// Count consecutive !isBest from the end of roundHistory backwards — used by the "toolbox rotation hint" trigger
// (SPEC 25 §11.3 "toolbox rotation hint"). Empty history / last round already best → return 0.
export function computeNoBestStreak(history: RoundHistoryEntry[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.isBest) break;
    streak++;
  }
  return streak;
}

// Build the hint when streak >= 2: take the union (deduped) of entry.appliedTips from the last 2 entries + toolbox constants.
// streak < 2 / empty history → undefined (do not render the section).
function buildToolboxSwitchHint(
  history: RoundHistoryEntry[],
  promptLanguage?: OptimizationConfig['promptLanguage'],
): { recentlyUsedTips: string[]; allTipNames: readonly string[] } | undefined {
  const streak = computeNoBestStreak(history);
  if (streak < 2) return undefined;
  const recentEntries = history.slice(-2);
  const usedSet = new Set<string>();
  for (const e of recentEntries) {
    for (const t of e.appliedTips) {
      const trimmed = t.trim();
      if (trimmed.length > 0) usedSet.add(trimmed);
    }
  }
  return { recentlyUsedTips: Array.from(usedSet), allTipNames: getOptimizationTipNames(promptLanguage) };
}

function normalizeErrorClass(err: unknown): { errorClass: string; errorMessage: string } {
  if (err instanceof Error) {
    return { errorClass: err.name || 'Error', errorMessage: err.message };
  }
  return { errorClass: 'UnknownError', errorMessage: String(err) };
}

interface FinalizeContext {
  status: OptimizationStatus;
  reason: OptimizationReason;
  bestVersion: PromptVersionRef;
  bestMetrics: MetricSnapshot;
  rounds: RoundOutcome[];
  errorClass?: string;
  errorMessage?: string;
}

interface PendingRegressionRetry {
  baseVersion: PromptVersionRef;
  baseRunResults: RunResultRecord[];
  baseMetrics: MetricSnapshot;
  regressedVersion: PromptVersionRef;
  regressedRunResults: RunResultRecord[];
  regressedMetrics: MetricSnapshot;
}

async function finalize(
  ctx: FinalizeContext,
  config: OptimizationConfig<ErrorPatternAnalysisConfig>,
  ports: LoopPorts,
): Promise<OptimizationResult> {
  const result: OptimizationResult = {
    status: ctx.status,
    reason: ctx.reason,
    bestVersionId: ctx.bestVersion.id,
    bestMetrics: ctx.bestMetrics,
    rounds: ctx.rounds,
    errorClass: ctx.errorClass,
    errorMessage: ctx.errorMessage,
  };
  await ports.roundRecorder.recordFinal(result, { optimizationId: config.optimizationId });
  return result;
}

export async function runIterationLoop(
  config: OptimizationConfig<ErrorPatternAnalysisConfig>,
  snapshot: ExperimentSnapshot,
  ports: LoopPorts,
  deps: LoopDependencies,
): Promise<OptimizationResult> {
  const invokeDeps = toInvokeLLMDependencies(deps);

  let bestVersion: PromptVersionRef = snapshot.basePromptVersion;
  let bestMetrics: MetricSnapshot = snapshot.lastMetrics;
  let bestRunResults: RunResultRecord[] = snapshot.lastRunResults;
  let pendingRegressionRetry: PendingRegressionRetry | null = null;
  const rounds: RoundOutcome[] = [];
  // Cross-round history (SPEC 25 §11.3) — accumulate one entry after each round's finalize; passed to the next round's analyze / generate
  const accumulatedHistory: RoundHistoryEntry[] = [];

  // Round 0: the source experiment is the baseline; finalize immediately if already at goal
  if (allGoalsMet(config.goals, bestMetrics)) {
    return finalize({ status: 'success', reason: 'goals_met', bestVersion, bestMetrics, rounds }, config, ports);
  }

  for (let roundNumber = 1; roundNumber <= config.maxRounds; roundNumber++) {
    // ① control check
    const signal = await ports.controlSignals.read(config.optimizationId);
    if (signal === 'cancel') {
      return finalize(
        { status: 'cancelled', reason: 'control_cancel', bestVersion, bestMetrics, rounds },
        config,
        ports,
      );
    }
    if (signal === 'stop') {
      return finalize({ status: 'stopped', reason: 'control_stop', bestVersion, bestMetrics, rounds }, config, ports);
    }

    const startedAt = nowIso(deps);

    try {
      const generationBaseVersion: PromptVersionRef = pendingRegressionRetry?.baseVersion ?? bestVersion;
      const generationBaseRunResults: RunResultRecord[] = pendingRegressionRetry?.baseRunResults ?? bestRunResults;
      const generationBaseMetrics: MetricSnapshot = pendingRegressionRetry?.baseMetrics ?? bestMetrics;
      const analysisVersion: PromptVersionRef = pendingRegressionRetry?.regressedVersion ?? generationBaseVersion;
      const currentRunResults: RunResultRecord[] =
        pendingRegressionRetry?.regressedRunResults ?? generationBaseRunResults;
      const currentMetrics: MetricSnapshot = pendingRegressionRetry?.regressedMetrics ?? generationBaseMetrics;

      // ② Pull previousRunResults from the DB — used for regression sample detection
      const previousRunResults =
        pendingRegressionRetry?.baseRunResults ??
        (await ports.previousRoundRunResultsReader.read({
          optimizationId: config.optimizationId,
          sourceExperimentId: snapshot.sourceExperimentId,
          currentRoundNumber: roundNumber,
        }));

      // The base for this round's generate — snapshot before step ⑦ updates bestVersion, for history recording.
      // If the previous round regressed against its parent version, this falls back to the parent prompt, but analyze still sees the regressed-round version and samples.
      const baseVersionForThisRound = generationBaseVersion;

      // ③ Error-sample analysis (confusion pairs + regression + multiple LLM calls + summary)
      const analysis = await analyzeFailures(
        {
          optimizationId: config.optimizationId,
          roundNumber,
          analysisModel: config.analysisModel,
          analysisLimiterKey: config.analysisLimiterKey,
          currentVersion: analysisVersion,
          previousVersion: pendingRegressionRetry?.baseVersion ?? null,
          samples: snapshot.dataset.samples,
          currentRunResults,
          previousRunResults,
          metrics: currentMetrics,
          goals: config.goals,
          fieldWhitelist: config.fieldWhitelist,
          strategyConfig: config.strategyConfig,
          roundHistory: accumulatedHistory,
          promptLanguage: config.promptLanguage,
        },
        invokeDeps,
      );

      // ④ Generate new version (inject the "toolbox rotation hint" section when !isBest for ≥ 2 consecutive rounds — SPEC 25 §11.3)
      const toolboxSwitchHint = buildToolboxSwitchHint(accumulatedHistory, config.promptLanguage);
      const draft = await generateNextVersion(
        {
          optimizationId: config.optimizationId,
          roundNumber,
          analysisModel: config.analysisModel,
          analysisLimiterKey: config.analysisLimiterKey,
          currentVersion: generationBaseVersion,
          analysis,
          metrics: currentMetrics,
          goals: config.goals,
          fieldWhitelist: config.fieldWhitelist,
          optimizationHint: config.optimizationHint,
          strategyConfig: config.strategyConfig,
          roundHistory: accumulatedHistory,
          toolboxSwitchHint,
          promptLanguage: config.promptLanguage,
        },
        invokeDeps,
      );

      // ⑤ Persist the new version (outputSchema / judgmentRules preserved as-is — SPEC 23 frozen four)
      const newVersion = await ports.promptVersionWriter.writePromptVersion({
        promptId: generationBaseVersion.promptId,
        parentVersionId: generationBaseVersion.id,
        body: draft.newPromptBody,
        outputSchema: generationBaseVersion.outputSchema,
        judgmentRules: generationBaseVersion.judgmentRules,
        optimizationId: config.optimizationId,
        changeSummary: draft.changeSummary,
      });

      // ⑥ Run experiment
      const run = await ports.experimentRunner.runExperiment({
        optimizationId: config.optimizationId,
        versionId: newVersion.id,
        datasetId: snapshot.dataset.id,
        taskModel: config.taskModel,
        judgmentRules: snapshot.judgmentRules,
        roundNumber,
      });

      // ⑦ Update best
      const isBest = isBetterThan(run.metrics, bestMetrics, config.goals);
      if (isBest) {
        bestVersion = newVersion;
        bestMetrics = run.metrics;
        bestRunResults = run.runResults;
      }
      pendingRegressionRetry = isBetterThan(generationBaseMetrics, run.metrics, config.goals)
        ? {
            baseVersion: generationBaseVersion,
            baseRunResults: generationBaseRunResults,
            baseMetrics: generationBaseMetrics,
            regressedVersion: newVersion,
            regressedRunResults: run.runResults,
            regressedMetrics: run.metrics,
          }
        : null;

      const goalProgress = evaluateGoals(config.goals, bestMetrics);
      const outcome: RoundOutcome = {
        roundNumber,
        generatedVersionId: newVersion.id,
        errorAnalysis: analysis.errorAnalysisText,
        changeSummary: draft.changeSummary,
        experimentId: run.experimentId,
        runResults: run.runResults,
        metrics: run.metrics,
        isBest,
        goalProgress,
        startedAt,
        finishedAt: nowIso(deps),
      };
      rounds.push(outcome);
      await ports.roundRecorder.recordRound(outcome, {
        optimizationId: config.optimizationId,
      });

      // Accumulate history (SPEC 25 §11.3) — passed through to next round's analyze / generate,
      // letting the LLM identify falsified directions / continue amplifying effective directions / switch toolbox techniques across rounds
      accumulatedHistory.push(
        buildHistoryEntryFromRound({
          roundNumber,
          metrics: run.metrics,
          changeSummary: draft.changeSummary,
          appliedChanges: draft.appliedChanges,
          appliedTips: draft.appliedTips,
          isBest,
          baseVersionId: baseVersionForThisRound.id,
          goals: config.goals,
          previousHistory: accumulatedHistory,
        }),
      );

      // ⑧ goal check
      if (goalProgress.every((p) => p.achieved)) {
        return finalize({ status: 'success', reason: 'goals_met', bestVersion, bestMetrics, rounds }, config, ports);
      }
    } catch (err) {
      const { errorClass, errorMessage } = normalizeErrorClass(err);
      return finalize(
        {
          status: 'failed',
          reason: 'fatal_error',
          bestVersion,
          bestMetrics,
          rounds,
          errorClass,
          errorMessage,
        },
        config,
        ports,
      );
    }
  }

  return finalize({ status: 'failed', reason: 'max_rounds', bestVersion, bestMetrics, rounds }, config, ports);
}

// Build the RoundHistoryEntry from this round's outcome — passed to the next round's LLM calls (SPEC 25 §11.3)
function buildHistoryEntryFromRound(input: {
  roundNumber: number;
  metrics: MetricSnapshot;
  changeSummary: string;
  appliedChanges: Array<{ changeId: string; patternIds: string[]; summary: string }> | undefined;
  appliedTips: string[] | undefined;
  isBest: boolean;
  baseVersionId: string;
  goals: OptimizationGoal[];
  previousHistory: RoundHistoryEntry[];
}): RoundHistoryEntry {
  const primaryGoal = input.goals[0];
  const currentPrimary = primaryGoal ? readMetric(input.metrics, primaryGoal) : null;
  const prevEntry = input.previousHistory[input.previousHistory.length - 1];
  const prevPrimary = prevEntry && primaryGoal ? readMetric(prevEntry.metrics, primaryGoal) : null;
  const deltaFromPrev = currentPrimary !== null && prevPrimary !== null ? currentPrimary - prevPrimary : null;
  return {
    roundIndex: input.roundNumber,
    metrics: input.metrics,
    deltaFromPrev,
    changeSummary: input.changeSummary,
    appliedChanges: (input.appliedChanges ?? []).map((c) => ({
      changeId: c.changeId,
      patternIds: c.patternIds,
      rationale: c.summary,
    })),
    appliedTips: input.appliedTips ?? [],
    isBest: input.isBest,
    generatedFromBaseVersionId: input.baseVersionId,
  };
}
