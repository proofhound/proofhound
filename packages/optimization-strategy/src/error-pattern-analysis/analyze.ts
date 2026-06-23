// Error-sample analysis — confusion pairs + regression + multiple LLM calls + a second LLM summary
// Token budget: before each LLM call, use estimateMessagesTokens to estimate the baseline; degrade when exceeding maxInputTokensPerBatch
// (fitSamplesToBudget → field truncation → reduce batch count)
import {
  invokeLLM,
  type InvokeLLMDependencies,
  type LLMMessage,
  type ModelInvocationConfig,
  type RunResultContext,
} from '@proofhound/llm-client';
import type {
  OptimizationGoal,
  FieldWhitelist,
  MetricSnapshot,
  PromptVersionRef,
  RoundHistoryEntry,
  RunResultRecord,
  SampleRecord,
} from '../loop/types';
import type { ErrorPatternAnalysisConfig } from './config.schema';
import {
  buildConfusionPairs,
  buildRegressionGroups,
  type ConfusionPair,
  type RegressionGroup,
  type SampleView,
} from './confusion-pairs';
import {
  buildAnalyzeConfusionMessages,
  buildAnalyzeRegressionMessages,
  buildSummarizeMessages,
  fitRoundHistoryToBudget,
} from './prompts';
import {
  normalizeEvidenceBundle,
  parseConfusionAnalysisOutput,
  parseRegressionAnalysisOutput,
  parseSummarizeOutput,
  type AnalysisEvidenceBundle,
  type AnalysisPattern,
  type SuggestedChange,
  type SummarizeOutput,
} from './parse';
import {
  computeSampleBudget,
  estimateMessagesTokens,
  estimateTokens,
  fitSamplesToBudget,
  truncateAllStringFieldsInObject,
  truncateStringFields,
} from './token-budget';
import { DEFAULT_PROMPT_LANGUAGE, type PromptLanguageDto } from '@proofhound/shared';

// Per round of optimization, persist 1 analysis row + 1 generate row to ph_runs.run_results (SPEC 25 §11.2).
// The workflow provides a deterministic runResultId (uuidv5) and meta (projectId / sourceId=optimizationId /
// promptVersionId / modelId / dbosWorkflowId / attempt). The analysis row is only written at the final summarize step —
// intermediate confusion / regression batch calls are implementation details; they only go through application logs and do not write run_results.
export interface OptimizationRunResultMeta {
  projectId: string;
  orgId?: string | null;
  sourceId: string;
  promptVersionId: string;
  modelId: string;
  dbosWorkflowId?: string | null;
  bullmqJobId?: string | null;
  attempt?: number;
}

export interface AnalyzeFailuresArgs {
  optimizationId: string;
  roundNumber: number;
  analysisModel: ModelInvocationConfig;
  analysisLimiterKey: string;
  currentVersion: PromptVersionRef;
  previousVersion?: PromptVersionRef | null;
  samples: SampleRecord[];
  currentRunResults: RunResultRecord[];
  previousRunResults: RunResultRecord[] | null;
  metrics: MetricSnapshot;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  strategyConfig: ErrorPatternAnalysisConfig;
  promptLanguage?: PromptLanguageDto;
  // Cross-round history (SPEC 25 §11.3): for non-first rounds, the caller aggregates and passes it in; first round undefined / [] does not render the history section
  roundHistory?: RoundHistoryEntry[];
  // When provided, during the summarize stage invokeLLM auto-writes one ph_runs.run_results row (source='optimization_analysis').
  // When not provided, behavior is preserved (only logs, does not write the table), backward compatible with unit tests / offline scripts.
  runResultMeta?: OptimizationRunResultMeta;
  analysisRunResultId?: string;
}

// Degradation actions recorded — attached on a batch, easing diagnosis of which samples / batches were truncated
export interface BatchBudgetReport {
  baselineInputTokens: number;
  sampleBudgetTokens: number;
  estimatedSampleTokens: number;
  originalSampleCount: number;
  fittedSampleCount: number;
  droppedSampleCount: number;
  fieldsTruncated: boolean; // When even a single sample does not fit, kick in field truncation
}

export interface AnalyzeBatchRecord {
  source: 'confusion' | 'regression';
  title: string;
  llmTruncated: boolean;
  errorPatterns: AnalysisPattern[];
  suggestedChanges: SuggestedChange[];
  rawContent: string;
  budget: BatchBudgetReport;
}

export interface SummarizeBudgetReport {
  baselineInputTokens: number;
  estimatedBatchesTokens: number;
  fieldTruncationApplied: boolean; // Phase 1 degradation: truncate long fields within a batch
  droppedBatchCount: number; // Phase 2 degradation: number of batches dropped
}

export interface AnalyzeFailuresResult {
  errorAnalysisText: string;
  summary: SummarizeOutput;
  evidenceBundle?: AnalysisEvidenceBundle;
  batches: AnalyzeBatchRecord[];
  confusionPairs: ConfusionPair[];
  regressionGroups: RegressionGroup[];
  truncated: boolean;
  totalConfusionFailures: number;
  totalRegressionSamples: number;
  summarizeBudget?: SummarizeBudgetReport;
}

export async function analyzeFailures(
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeFailuresResult> {
  const promptLanguage = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  // Cross-round history token-budget degradation — shared one fitted history across all batches to avoid repeated estimates
  // History takes at most 40% of the batch input budget; the rest goes to error samples + evidence
  const historyCap = Math.floor(args.strategyConfig.maxInputTokensPerBatch * 0.4);
  const fittedHistoryResult = fitRoundHistoryToBudget(args.roundHistory, historyCap, args.goals, promptLanguage);
  const argsWithFittedHistory: AnalyzeFailuresArgs = {
    ...args,
    promptLanguage,
    roundHistory: fittedHistoryResult.fitted,
  };

  const confusionPairs = buildConfusionPairs({
    runResults: args.currentRunResults,
    samples: args.samples,
    whitelist: args.fieldWhitelist,
    topN: args.strategyConfig.topConfusionPairs,
    maxSamplesPerPair: args.strategyConfig.maxSamplesPerConfusionPair,
  });

  const regressionGroups = buildRegressionGroups({
    currentRunResults: args.currentRunResults,
    previousRunResults: args.previousRunResults,
    samples: args.samples,
    whitelist: args.fieldWhitelist,
    maxSamples: args.strategyConfig.maxRegressionSamples,
  });

  const totalConfusionFailures = confusionPairs.reduce((sum, p) => sum + p.count, 0);
  const totalRegressionSamples = regressionGroups.reduce((sum, g) => sum + g.count, 0);

  const batches: AnalyzeBatchRecord[] = [];
  let anyTruncated = false;

  for (const pair of confusionPairs) {
    const batch = await runConfusionBatch(pair, argsWithFittedHistory, deps);
    batches.push(batch);
    if (batch.llmTruncated) anyTruncated = true;
  }

  for (const group of regressionGroups) {
    const batch = await runRegressionBatch(group, argsWithFittedHistory, deps);
    batches.push(batch);
    if (batch.llmTruncated) anyTruncated = true;
  }

  const { summary, budget: summarizeBudget } = await runSummarize(argsWithFittedHistory, batches, deps, {
    totalConfusionFailures,
    totalRegressionSamples,
    truncated: anyTruncated,
  });
  if (summary.truncated) anyTruncated = true;
  const evidenceBundle = buildAnalysisEvidenceBundle(summary, batches, {
    totalConfusionFailures,
    totalRegressionSamples,
    truncated: anyTruncated,
  });

  return {
    errorAnalysisText: summary.summary,
    summary,
    evidenceBundle,
    batches,
    confusionPairs,
    regressionGroups,
    truncated: anyTruncated,
    totalConfusionFailures,
    totalRegressionSamples,
    summarizeBudget,
  };
}

// Field truncation threshold in the extreme case where "a single sample exceeds the budget" (chars, derived by 4 chars/token)
const PER_FIELD_TRUNCATE_CHARS = 2_000;

interface FitOutcome {
  fitted: SampleView[];
  dropped: SampleView[];
  baseline: number;
  fieldsTruncated: boolean;
  sampleBudget: number;
  estimatedSampleTokens: number;
}

// Common pipeline shared by the confusion + regression analysis paths:
// fitted samples → buildMessages → invokeLLM → parse → normalizeEvidenceBundle → AnalyzeBatchRecord
// Differences are injected via spec only (source / bucketKey / already-fitted samples / messages builder / parser /
// stepName / requestKey). The business behavior (LLM call count, message content, final fields) is unchanged.
interface AnalysisBatchSpec {
  source: 'confusion' | 'regression';
  bucketKey: string;
  fitResult: FitOutcome;
  originalSampleCount: number;
  affectedCountFallback: number;
  buildMessages: () => { system: string; user: string };
  parseOutput: (
    content: string,
    finishReason: string | null | undefined,
  ) => {
    errorPatterns: AnalysisPattern[];
    suggestedChanges: SuggestedChange[];
    truncated: boolean;
    rawContent: string;
  };
  stepName: 'error_pattern_analyze_confusion' | 'error_pattern_analyze_regression';
  requestKey: string;
}

async function runAnalysisBatch(
  spec: AnalysisBatchSpec,
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeBatchRecord> {
  const { system, user } = spec.buildMessages();
  const result = await invokeLLM(
    {
      model: args.analysisModel,
      limiterKey: args.analysisLimiterKey,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      params: {
        temperature: args.strategyConfig.temperature,
        maxTokens: args.strategyConfig.maxAnalysisOutputTokens,
      },
      context: {
        source: 'optimization_analysis',
        stepName: spec.stepName,
        requestId: `optimization:${args.optimizationId}:r${args.roundNumber}:${spec.source}:${spec.requestKey}`,
        promptVersionId: args.currentVersion.id,
        promptLanguage: args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE,
      },
    },
    deps,
  );
  const parsed = spec.parseOutput(result.content, result.finishReason);
  const { errorPatterns, suggestedChanges } = normalizeEvidenceBundle(
    { errorPatterns: parsed.errorPatterns, suggestedChanges: parsed.suggestedChanges },
    {
      source: spec.source,
      bucketKey: spec.bucketKey,
      affectedCountFallback: spec.affectedCountFallback,
    },
  );
  return {
    source: spec.source,
    title: `${spec.source}: ${spec.bucketKey}`,
    llmTruncated: parsed.truncated,
    errorPatterns,
    suggestedChanges,
    rawContent: parsed.rawContent,
    budget: {
      baselineInputTokens: spec.fitResult.baseline,
      sampleBudgetTokens: spec.fitResult.sampleBudget,
      estimatedSampleTokens: spec.fitResult.estimatedSampleTokens,
      originalSampleCount: spec.originalSampleCount,
      fittedSampleCount: spec.fitResult.fitted.length,
      droppedSampleCount: spec.fitResult.dropped.length,
      fieldsTruncated: spec.fitResult.fieldsTruncated,
    },
  };
}

async function runConfusionBatch(
  pair: ConfusionPair,
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeBatchRecord> {
  const fitResult = fitSamplesForConfusion(pair, args);
  const trimmedPair: ConfusionPair = { ...pair, samples: fitResult.fitted };
  return runAnalysisBatch(
    {
      source: 'confusion',
      bucketKey: `${pair.expected}→${pair.predicted}`,
      fitResult,
      originalSampleCount: pair.samples.length,
      affectedCountFallback: pair.count,
      buildMessages: () =>
        buildAnalyzeConfusionMessages({
          pair: trimmedPair,
          currentVersion: args.currentVersion,
          metrics: args.metrics,
          goals: args.goals,
          fieldWhitelist: args.fieldWhitelist,
          roundHistory: args.roundHistory,
          promptLanguage: args.promptLanguage,
        }),
      parseOutput: parseConfusionAnalysisOutput,
      stepName: 'error_pattern_analyze_confusion',
      requestKey: `${pair.expected}_to_${pair.predicted}`,
    },
    args,
    deps,
  );
}

function fitSamplesForConfusion(pair: ConfusionPair, args: AnalyzeFailuresArgs): FitOutcome {
  // 1) Probe: clear samples and construct one message to estimate the fixed overhead (including the fitted cross-round history)
  const probePair: ConfusionPair = { ...pair, samples: [] };
  const probe = buildAnalyzeConfusionMessages({
    pair: probePair,
    currentVersion: args.currentVersion,
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxAnalysisOutputTokens);
  const sampleBudget = computeSampleBudget(args.strategyConfig.maxInputTokensPerBatch, baseline.inputTokens);

  // 2) fit
  let { fitted, dropped, estimatedTokens } = fitSamplesToBudget(pair.samples, sampleBudget, 0);

  // 3) Nothing fits but samples do exist → force-fit 1 sample and brute-force-truncate its fields
  let fieldsTruncated = false;
  if (fitted.length === 0 && pair.samples.length > 0) {
    const head = pair.samples[0]!;
    const truncated = truncateStringFields(head, PER_FIELD_TRUNCATE_CHARS);
    fitted = [truncated];
    dropped = pair.samples.slice(1);
    estimatedTokens = estimateTokens(truncated);
    fieldsTruncated = true;
  }

  return {
    fitted,
    dropped,
    baseline: baseline.inputTokens,
    fieldsTruncated,
    sampleBudget,
    estimatedSampleTokens: estimatedTokens,
  };
}

async function runRegressionBatch(
  group: RegressionGroup,
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeBatchRecord> {
  const fitResult = fitSamplesForRegression(group, args);
  const trimmedGroup: RegressionGroup = { ...group, samples: fitResult.fitted };
  return runAnalysisBatch(
    {
      source: 'regression',
      bucketKey: `predicted=${group.predicted}`,
      fitResult,
      originalSampleCount: group.samples.length,
      affectedCountFallback: group.count,
      buildMessages: () =>
        buildAnalyzeRegressionMessages({
          group: trimmedGroup,
          currentVersion: args.currentVersion,
          previousVersion: args.previousVersion,
          metrics: args.metrics,
          goals: args.goals,
          fieldWhitelist: args.fieldWhitelist,
          roundHistory: args.roundHistory,
          promptLanguage: args.promptLanguage,
        }),
      parseOutput: parseRegressionAnalysisOutput,
      stepName: 'error_pattern_analyze_regression',
      requestKey: group.predicted,
    },
    args,
    deps,
  );
}

function fitSamplesForRegression(group: RegressionGroup, args: AnalyzeFailuresArgs): FitOutcome {
  const probeGroup: RegressionGroup = { ...group, samples: [] };
  const probe = buildAnalyzeRegressionMessages({
    group: probeGroup,
    currentVersion: args.currentVersion,
    previousVersion: args.previousVersion,
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxAnalysisOutputTokens);
  const sampleBudget = computeSampleBudget(args.strategyConfig.maxInputTokensPerBatch, baseline.inputTokens);

  let { fitted, dropped, estimatedTokens } = fitSamplesToBudget(group.samples, sampleBudget, 0);

  let fieldsTruncated = false;
  if (fitted.length === 0 && group.samples.length > 0) {
    const head = group.samples[0]!;
    const truncated = truncateStringFields(head, PER_FIELD_TRUNCATE_CHARS);
    fitted = [truncated];
    dropped = group.samples.slice(1);
    estimatedTokens = estimateTokens(truncated);
    fieldsTruncated = true;
  }

  return {
    fitted,
    dropped,
    baseline: baseline.inputTokens,
    fieldsTruncated,
    sampleBudget,
    estimatedSampleTokens: estimatedTokens,
  };
}

function buildAnalysisEvidenceBundle(
  summary: SummarizeOutput,
  batches: AnalyzeBatchRecord[],
  stats: {
    totalConfusionFailures: number;
    totalRegressionSamples: number;
    truncated: boolean;
  },
): AnalysisEvidenceBundle {
  return {
    evidenceBundleVersion: 1,
    summary: summary.summary,
    errorPatterns: summary.errorPatterns,
    suggestedChanges: summary.suggestedChanges,
    conflicts: summary.conflicts ?? [],
    sourceStats: {
      batchCount: batches.length,
      totalConfusionFailures: stats.totalConfusionFailures,
      totalRegressionSamples: stats.totalRegressionSamples,
      truncated: stats.truncated || summary.truncated,
    },
  };
}

// Summarize field-truncation character cap (controls long fields like reason / change / rationale within a batch)
const SUMMARIZE_FIELD_TRUNCATE_CHARS = 600;

async function runSummarize(
  args: AnalyzeFailuresArgs,
  batches: AnalyzeBatchRecord[],
  deps: InvokeLLMDependencies,
  stats: {
    totalConfusionFailures: number;
    totalRegressionSamples: number;
    truncated: boolean;
  },
): Promise<{ summary: SummarizeOutput; budget: SummarizeBudgetReport | undefined }> {
  if (batches.length === 0) {
    const summary: SummarizeOutput = {
      summary:
        '本轮没有失败样本可供分析（confusion + regression 均为空）。建议直接继续下一轮，或检查实验是否真的执行了。',
      errorPatterns: [],
      suggestedChanges: [],
      conflicts: [],
      evidenceBundleVersion: 1,
      truncated: false,
      rawContent: '',
    };
    deps.logger.info(
      {
        optimizationId: args.optimizationId,
        roundNumber: args.roundNumber,
        reason: 'no_batches',
        confusionPairsCount: 0,
        regressionGroupsCount: 0,
        currentFailureCount: args.currentRunResults.filter((r) => r.isCorrect === false).length,
        currentRunResultsCount: args.currentRunResults.length,
        previousRunResultsCount: args.previousRunResults?.length ?? 0,
        hasPreviousRound: args.previousRunResults != null,
        samplesWithExpectedCount: args.samples.filter((s) => s.expected != null).length,
      },
      'analyze_skipped',
    );
    return {
      summary,
      budget: undefined,
    };
  }

  // Probe: estimate the baseline with empty batches (including the fitted cross-round history)
  const probe = buildSummarizeMessages({
    goals: args.goals,
    metrics: args.metrics,
    collectedBatches: [],
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxSummarizeOutputTokens);
  const budget = computeSampleBudget(args.strategyConfig.maxInputTokensPerBatch, baseline.inputTokens);

  // Compute the token footprint of the original batches
  const rawCollected = batches.map((b) => ({
    source: b.source,
    title: b.title,
    payload: { errorPatterns: b.errorPatterns, suggestedChanges: b.suggestedChanges },
  }));
  let collected = rawCollected;
  let fieldTruncationApplied = false;
  let droppedBatchCount = 0;
  let currentTokens = estimateTokens(collected);

  // Phase 1: over budget → field truncation
  if (currentTokens > budget) {
    collected = rawCollected.map((b) => truncateAllStringFieldsInObject(b, SUMMARIZE_FIELD_TRUNCATE_CHARS));
    fieldTruncationApplied = true;
    currentTokens = estimateTokens(collected);
  }

  // Phase 2: still over budget → drop batches (confusion is preferred = placed first)
  if (currentTokens > budget) {
    const sortedConfusionFirst = [...collected].sort((a, b) =>
      a.source === 'confusion' && b.source !== 'confusion'
        ? -1
        : a.source !== 'confusion' && b.source === 'confusion'
          ? 1
          : 0,
    );
    const kept: typeof collected = [];
    let used = 0;
    for (const b of sortedConfusionFirst) {
      const t = estimateTokens(b);
      if (used + t > budget && kept.length >= 1) {
        droppedBatchCount++;
        continue;
      }
      kept.push(b);
      used += t;
    }
    collected = kept;
    currentTokens = used;
  }

  const { system, user } = buildSummarizeMessages({
    goals: args.goals,
    metrics: args.metrics,
    collectedBatches: collected,
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });

  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const result = await invokeLLM(
    {
      model: args.analysisModel,
      limiterKey: args.analysisLimiterKey,
      messages,
      params: {
        temperature: args.strategyConfig.temperature,
        maxTokens: args.strategyConfig.maxSummarizeOutputTokens,
      },
      context: {
        source: 'optimization_analysis',
        stepName: 'error_pattern_summarize',
        requestId: `optimization:${args.optimizationId}:r${args.roundNumber}:summarize`,
        promptVersionId: args.currentVersion.id,
      },
      runResult: buildRunResultForCall({
        meta: args.runResultMeta,
        runResultId: args.analysisRunResultId,
        source: 'optimization_analysis',
        roundIndex: args.roundNumber,
        messages,
        inputVariables: {
          optimizationId: args.optimizationId,
          roundNumber: args.roundNumber,
          stepName: 'error_pattern_summarize',
          promptLanguage: args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE,
        },
      }),
      // run_results.parsed_output feeds the detail-page errorPatterns / suggestedChanges (SPEC 25 §11.3);
      // finishReason is filled when externally re-parsed; here null ensures the key fields are at least available.
      parseResponse: (content) => {
        try {
          const parsed = parseSummarizeOutput(content, null);
          return {
            ...parsed,
            evidenceBundle: buildAnalysisEvidenceBundle(parsed, batches, stats),
          };
        } catch {
          return null;
        }
      },
    },
    deps,
  );

  return {
    summary: parseSummarizeOutput(result.content, result.finishReason),
    budget: {
      baselineInputTokens: baseline.inputTokens,
      estimatedBatchesTokens: currentTokens,
      fieldTruncationApplied,
      droppedBatchCount,
    },
  };
}

export type { ConfusionPair, RegressionGroup };

// Construct the RunResultContext when analyze / generate call invokeLLM.
// Only when the caller provides both meta and runResultId, return the context; otherwise return undefined
// (invokeLLM internally guards with `runResult && runResultWriter` to decide whether to write the table).
// roundIndex is required: the detail page's listOptimizationLlmRunResults filters by isNotNull(round_index);
// a missing value drops the whole row (causing errorPatterns / suggestedChanges / promptDiff to disappear entirely).
export function buildRunResultForCall(input: {
  meta: OptimizationRunResultMeta | undefined;
  runResultId: string | undefined;
  source: 'optimization_analysis' | 'optimization_generate';
  roundIndex: number;
  messages: LLMMessage[];
  inputVariables: Record<string, unknown>;
}): RunResultContext | undefined {
  if (!input.meta || !input.runResultId) return undefined;
  return {
    id: input.runResultId,
    projectId: input.meta.projectId,
    orgId: input.meta.orgId ?? null,
    source: input.source,
    sourceId: input.meta.sourceId,
    promptVersionId: input.meta.promptVersionId,
    modelId: input.meta.modelId,
    sampleId: null,
    externalId: null,
    renderedPrompt: { messages: input.messages },
    inputVariables: input.inputVariables,
    expectedOutput: null,
    dbosWorkflowId: input.meta.dbosWorkflowId ?? null,
    bullmqJobId: input.meta.bullmqJobId ?? null,
    attempt: input.meta.attempt ?? 0,
    roundIndex: input.roundIndex,
  };
}
