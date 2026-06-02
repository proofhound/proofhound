// Optimization loop types — see docs/specs/25-optimizations.md
import type {
  InvokeLLMDependencies,
  LLMAdapter,
  LLMCallLogger,
  ModelInvocationConfig,
  RateLimiterLike,
} from '@proofhound/llm-client';
import type { PromptLanguageDto } from '@proofhound/shared';
import type { ProjectType } from '../types';

export type ComparisonOp = '>=' | '<=' | '>';

export interface OptimizationGoal {
  metric: string;
  op: ComparisonOp;
  value: number;
  scope: { kind: 'overall' } | { kind: 'class'; label: string };
}

export interface MetricSnapshot {
  overall: Record<string, number>;
  perClass?: Record<string, Record<string, number>>;
}

export interface JudgmentRuleSet {
  ruleName: string;
  config: unknown;
}

export interface PromptVariable {
  name: string;
  description?: string;
}

export interface PromptVersionRef {
  id: string;
  promptId: string;
  versionNumber: number;
  body: string;
  outputSchema?: unknown;
  promptLanguage?: PromptLanguageDto;
  judgmentRules?: JudgmentRuleSet;
  variables?: PromptVariable[];
}

export interface SampleRecord {
  id: string;
  input: Record<string, unknown>;
  expected?: unknown;
}

export interface RunResultRecord {
  id: string;
  sampleId: string;
  parsedOutput?: unknown;
  decisionOutput?: string | null;
  isCorrect?: boolean | null;
  errorMessage?: string | null;
  rawResponse?: string | null;
}

export interface ExperimentSnapshot {
  projectId: string;
  projectType: ProjectType;
  sourceExperimentId: string;
  dataset: { id: string; samples: SampleRecord[] };
  taskModel: ModelInvocationConfig;
  judgmentRules: JudgmentRuleSet;
  basePromptVersion: PromptVersionRef;
  lastRunResults: RunResultRecord[];
  lastMetrics: MetricSnapshot;
}

// Field whitelist — three use cases expressed separately
// - promptVariables: fields that can be embedded as {{var}} into the final prompt; the new version cannot introduce variables outside this list
// - analysisOnlyFields: read-only for the analysis LLM; forbidden in the final prompt
// - modifiableSections: prompt sections the generate stage is allowed to modify (title / task description / examples, etc.)
export interface FieldWhitelist {
  promptVariables: string[];
  analysisOnlyFields?: string[];
  modifiableSections?: string[];
}

export interface OptimizationConfig<TStrategyConfig = unknown> {
  optimizationId: string;
  goals: OptimizationGoal[];
  maxRounds: number;
  fieldWhitelist: FieldWhitelist;
  analysisModel: ModelInvocationConfig;
  analysisLimiterKey: string;
  taskModel: ModelInvocationConfig;
  strategyKey: 'error_pattern_analysis';
  strategyConfig: TStrategyConfig;
  // Extra user guidance at optimization creation (natural-language hint) — passed through to the generate user prompt
  optimizationHint?: string;
  promptLanguage?: PromptLanguageDto;
}

export interface GoalProgressEntry {
  goal: OptimizationGoal;
  achieved: boolean;
  observed: number | null;
}

export interface RoundOutcome {
  roundNumber: number;
  generatedVersionId: string;
  errorAnalysis: string;
  changeSummary: string;
  experimentId: string;
  runResults: RunResultRecord[];
  metrics: MetricSnapshot;
  isBest: boolean;
  goalProgress: GoalProgressEntry[];
  startedAt: string;
  finishedAt: string;
}

// Cross-round history snapshots — injected into non-first-round analyze / generate LLM calls,
// letting the LLM see directions already tried + their effect, avoiding repeated ineffective changes. See docs/specs/25-optimizations.md §11.3
export interface RoundHistoryAppliedChange {
  changeId: string;
  patternIds?: string[];
  rationale?: string;
}

export interface RoundHistoryEntry {
  roundIndex: number;
  metrics: MetricSnapshot;
  deltaFromPrev: number | null;
  changeSummary: string;
  appliedChanges: RoundHistoryAppliedChange[];
  // This round's generate LLM's self-reported "techniques drawn from" (corresponding to optimization-tips.md toolbox entries);
  // when !isBest for ≥ 2 consecutive rounds, used to inject the "toolbox rotation hint" section into the next round's generate user prompt.
  // Parse failure / legacy data → []. See docs/specs/25 §11.3 "toolbox rotation hint"
  appliedTips: string[];
  isBest: boolean;
  generatedFromBaseVersionId: string;
}

export type OptimizationStatus = 'success' | 'failed' | 'stopped' | 'cancelled';

export type OptimizationReason = 'goals_met' | 'max_rounds' | 'control_stop' | 'control_cancel' | 'fatal_error';

export interface OptimizationResult {
  status: OptimizationStatus;
  reason: OptimizationReason;
  bestVersionId: string;
  bestMetrics: MetricSnapshot;
  rounds: RoundOutcome[];
  errorClass?: string;
  errorMessage?: string;
}

export interface ExperimentRunnerInput {
  optimizationId: string;
  versionId: string;
  datasetId: string;
  taskModel: ModelInvocationConfig;
  judgmentRules: JudgmentRuleSet;
  roundNumber: number;
}

export interface ExperimentRunnerOutput {
  experimentId: string;
  runResults: RunResultRecord[];
  metrics: MetricSnapshot;
}

export interface ExperimentRunnerPort {
  runExperiment(input: ExperimentRunnerInput): Promise<ExperimentRunnerOutput>;
}

export interface PromptVersionWriteInput {
  promptId: string;
  parentVersionId: string;
  body: string;
  outputSchema?: unknown;
  judgmentRules?: JudgmentRuleSet;
  optimizationId: string;
  changeSummary: string;
}

export interface PromptVersionWriterPort {
  writePromptVersion(input: PromptVersionWriteInput): Promise<PromptVersionRef>;
}

export interface RoundRecorderPort {
  recordRound(round: RoundOutcome, ctx: { optimizationId: string }): Promise<void>;
  recordFinal(result: OptimizationResult, ctx: { optimizationId: string }): Promise<void>;
}

export type ControlSignal = 'stop' | 'resume' | 'cancel' | null;

export interface ControlSignalReader {
  read(optimizationId: string): Promise<ControlSignal>;
}

// Regression sample detection needs run results from the "previous round" experiment
// - Round 1: read({currentRoundNumber: 1}) should return the source experiment's last round run results
// - Round N≥2: returns the run results of the N-1 round optimization experiment
// Returning null means there is no comparable previous round (skip regression analysis at this point)
export interface PreviousRoundReadInput {
  optimizationId: string;
  sourceExperimentId: string;
  currentRoundNumber: number;
}
export interface PreviousRoundRunResultsReaderPort {
  read(input: PreviousRoundReadInput): Promise<RunResultRecord[] | null>;
}

export interface LoopPorts {
  experimentRunner: ExperimentRunnerPort;
  promptVersionWriter: PromptVersionWriterPort;
  roundRecorder: RoundRecorderPort;
  controlSignals: ControlSignalReader;
  previousRoundRunResultsReader: PreviousRoundRunResultsReaderPort;
}

export interface LoopDependencies {
  // LLM adapter injected into invokeLLM — when not provided, falls back to llm-client default (anthropic/openai/azure in prod)
  llmAdapter?: LLMAdapter;
  limiter: RateLimiterLike;
  logger: LLMCallLogger;
  now?: () => number;
}

// Internal helper: wrap LoopDependencies into dependencies usable by invokeLLM — shared by analyze/generate
export function toInvokeLLMDependencies(deps: LoopDependencies): InvokeLLMDependencies {
  return {
    limiter: deps.limiter,
    logger: deps.logger,
    adapters: deps.llmAdapter ? [deps.llmAdapter] : undefined,
    now: deps.now,
  };
}
