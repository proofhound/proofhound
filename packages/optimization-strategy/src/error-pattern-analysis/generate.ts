// New-version generation — 9-block system prompt + variable whitelist validation + token budget
import {
  invokeLLM,
  type InvokeLLMDependencies,
  type InvokeLLMResult,
  type LLMMessage,
  type ModelInvocationConfig,
} from '@proofhound/llm-client';
import type { OptimizationGoal, FieldWhitelist, MetricSnapshot, PromptVersionRef, RoundHistoryEntry } from '../loop/types';
import { buildRunResultForCall, type AnalyzeFailuresResult, type OptimizationRunResultMeta } from './analyze';
import type { ErrorPatternAnalysisConfig } from './config.schema';
import {
  InvalidVariableUsageError,
  InvalidAppliedChangeReferenceError,
  parseGenerateOutput,
  safeValidateNewOutputSchema,
  validatePromptVariables,
  type AnalysisEvidenceBundle,
  type GenerateOutput,
  type VariableValidationResult,
} from './parse';
import {
  DEFAULT_PROMPT_LANGUAGE,
  buildOutputFormatInstruction,
  composeFullPrompt,
  outputSchemaToJsonSchema,
  type PromptLanguageDto,
} from '@proofhound/shared';
import { buildGenerateMessages, extractVariableNames, fitRoundHistoryToBudget } from './prompts';
import { computeSampleBudget, estimateMessagesTokens, truncateLongText } from './token-budget';

export interface GenerateNextVersionArgs {
  optimizationId: string;
  roundNumber: number;
  analysisModel: ModelInvocationConfig;
  analysisLimiterKey: string;
  currentVersion: PromptVersionRef;
  analysis: AnalyzeFailuresResult;
  metrics: MetricSnapshot;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  optimizationHint?: string;
  strategyConfig: ErrorPatternAnalysisConfig;
  promptLanguage?: PromptLanguageDto;
  // Cross-round history (SPEC 25 §11.3): for non-first rounds, the caller aggregates and passes it in; first round undefined / [] does not render the history section
  roundHistory?: RoundHistoryEntry[];
  // Input to the toolbox-rotation-hint section (SPEC 25 §11.3 "toolbox rotation hint")
  // The caller constructs it when streak >= 2 (!isBest for ≥ 2 consecutive rounds); when undefined, the section is not rendered.
  // Passed through both probe + actual buildGenerateMessages, so token-budget estimation stays consistent with the actual user prompt.
  toolboxSwitchHint?: { recentlyUsedTips: string[]; allTipNames: readonly string[] };
  // When provided, invokeLLM auto-writes one ph_runs.run_results row (source='optimization_generate').
  // When not provided, behavior is preserved (only logs, does not write the table).
  runResultMeta?: OptimizationRunResultMeta;
  generateRunResultId?: string;
}

export interface GenerateBudgetReport {
  baselineInputTokens: number;
  errorAnalysisBudgetTokens: number;
  errorAnalysisTruncated: boolean;
  originalErrorAnalysisChars: number;
  evidenceBundleBudgetTokens: number;
  evidenceBundleTruncated: boolean;
  originalEvidenceBundleTokens: number;
  // Cross-round history budget observation fields (SPEC 25 §11.3)
  roundHistoryEntryCount: number;
  roundHistoryFittedLevel: 0 | 1 | 2 | 3;
  roundHistoryBudgetTokens: number;
  roundHistoryTruncated: boolean;
}

export interface GenerateNextVersionResult extends GenerateOutput {
  variableValidation: {
    ok: boolean;
    disallowed: string[];
    missing: string[];
    detected: string[];
  };
  budget: GenerateBudgetReport;
  // outputSchema actually used for this round's new version: when the LLM provides one and validation passes, use the new one; otherwise fall back to the old schema.
  // Also serves as the basis for assembling outputFormatInstruction / composedFullPrompt.
  effectiveOutputSchema: unknown;
  // The output-format section auto-assembled from effectiveOutputSchema (empty string when no schema).
  // newPromptBody intentionally does not contain the output format — when the business LLM is invoked, this section is concatenated to the body tail to keep the output contract stable.
  outputFormatInstruction: string;
  // Concatenation of newPromptBody + outputFormatInstruction — the full prompt actually sent to the business model.
  composedFullPrompt: string;
  // Number of generate calls actually invoked minus 1: 0 = first-call success; >=1 = retried N times (possibly with autoPatched=true)
  retries: number;
  // Whether the system patch fallback was triggered (after retries exhausted and placeholders still missing → the system auto-appends the missing placeholders at the end of newPromptBody)
  autoPatched: boolean;
  // Names of placeholders patched by the system (empty array when autoPatched=false)
  patchedVariables: string[];
}

// LLM retry cap — at most 1 first call + N retries; when retries are exhausted and placeholders are still missing → fall back to the system auto-patch
const MAX_VARIABLE_RETRY_ATTEMPTS = 2;

// Append the system patch section: at the end of the new body, structured hint, ensuring missing placeholders are restored in ASCII {{var}} form.
// This section is separated by blank lines + ---; the UI can clip the tail to prompt the user to manually tweak placeholder embedding.
function autoPatchPromptBody(
  body: string,
  missingVariables: string[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  const lines = missingVariables.map((v) => `- ${v}：{{${v}}}`).join('\n');
  if (language === 'en-US') {
    return `${body}\n\n---\n(System auto-patch: these input variables were restored; please review and place them naturally.)\n${lines}`;
  }
  return `${body}\n\n---\n（系统自动补丁：以下输入变量被系统补回，请人工核查并调整使用位置）\n${lines}`;
}

// Build the user message that feeds back to the LLM on retry: explicitly tell it which placeholders were missed last round + that ASCII double-curly syntax must be used to restore them
function buildVariableRetryFeedback(
  removedVariables: string[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  const occList = removedVariables.map((v) => `- \`{{${v}}}\``).join('\n');
  if (language === 'en-US') {
    return [
      '## Previous newPromptBody violated hard constraint #1 (must preserve base placeholders)',
      'Your newPromptBody is missing these placeholders. They were used by the base prompt and are still whitelisted:',
      occList,
      '',
      'Return the complete JSON again with these requirements:',
      '- newPromptBody must include every placeholder above exactly with ASCII double braces, e.g. `{{var}}`.',
      '- Do not use `{var}`, `<var>`, `[var]`, full-width braces, or any other syntax variant.',
      '- Keep the other fields aligned with your intended change.',
    ].join('\n');
  }
  return [
    '## 上一轮 newPromptBody 违反硬约束 #1（必须保留 base 已用占位）',
    `你的 newPromptBody 中缺少以下占位（base 已用 ∩ 白名单内 → 必须逐字保留）：`,
    occList,
    '',
    '请重新输出完整 JSON，要求：',
    '- **newPromptBody 中必须以 ASCII 双花括号语法 `{{var}}` 原样包含上述全部占位**（位置可调整）',
    '- 禁止用 `{var}` / `<var>` / `[var]` / 全角 `｛｛var｝｝` 等任何变体语法',
    '- 其他字段（changeSummary / appliedChanges / appliedTips / variablesUsed / newOutputSchema）按你的原意保留',
  ].join('\n');
}

export async function generateNextVersion(
  args: GenerateNextVersionArgs,
  deps: InvokeLLMDependencies,
): Promise<GenerateNextVersionResult> {
  const promptLanguage = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const evidenceBundle = args.analysis.evidenceBundle ?? legacyEvidenceBundle(args.analysis);

  // 0) Cross-round history token-budget degradation — shared fitted history across probe + actual call
  // History takes at most 40% of the batch input budget; the rest goes to error samples / evidence
  const historyCap = Math.floor(args.strategyConfig.maxInputTokensPerBatch * 0.4);
  const fittedHistoryResult = fitRoundHistoryToBudget(args.roundHistory, historyCap, args.goals, promptLanguage);
  const fittedHistory = fittedHistoryResult.fitted;

  // 1) Probe: clear the evidence package and construct one message to estimate the baseline (including the fitted cross-round history + toolbox rotation hint)
  const probe = buildGenerateMessages({
    currentVersion: args.currentVersion,
    errorAnalysisText: '',
    analysisEvidenceBundle: {
      evidenceBundleVersion: 1,
      summary: '',
      errorPatterns: [],
      suggestedChanges: [],
      conflicts: [],
      sourceStats: {
        batchCount: 0,
        totalConfusionFailures: 0,
        totalRegressionSamples: 0,
        truncated: false,
      },
    },
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    optimizationHint: args.optimizationHint,
    roundHistory: fittedHistory,
    toolboxSwitchHint: args.toolboxSwitchHint,
    promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxGenerationOutputTokens);
  const errorAnalysisBudgetTokens = computeSampleBudget(
    args.strategyConfig.maxInputTokensPerBatch,
    baseline.inputTokens,
  );

  // 2) The structured evidence package is trimmed by weight; the legacy summary text is also retained as fallback
  const fittedEvidence = fitEvidenceBundleToBudget(evidenceBundle, errorAnalysisBudgetTokens);

  const maxErrorAnalysisChars = errorAnalysisBudgetTokens * 4;
  const originalText = args.analysis.errorAnalysisText;
  const fittedText = truncateLongText(originalText, maxErrorAnalysisChars);
  const errorAnalysisTruncated = fittedText !== originalText;

  // 3) Construct the final messages using the fitted evidence package
  const { system, user } = buildGenerateMessages({
    currentVersion: args.currentVersion,
    errorAnalysisText: fittedText,
    analysisEvidenceBundle: fittedEvidence.bundle,
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    optimizationHint: args.optimizationHint,
    roundHistory: fittedHistory,
    toolboxSwitchHint: args.toolboxSwitchHint,
    promptLanguage,
  });

  // base body's already-used ∩ whitelist = placeholders that the new version must retain
  // (losing them prevents the model from inferring the input; the output immediately collapses to the prior, see docs/specs/25 §11 optimization oscillation)
  const allowedSet = new Set(args.fieldWhitelist.promptVariables);
  const requiredVariables = extractVariableNames(args.currentVersion.body).filter((v) => allowedSet.has(v));

  // Loop structure — one first call + at most N retries + system patch fallback. Intermediate calls do not write to ph_runs.run_results;
  // outside the loop, manually write one row from the finally-adopted InvokeLLMResult + parsed (including autoPatched/patchedVariables).
  let messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let finalInvokeResult: InvokeLLMResult | null = null;
  let parsed: GenerateOutput | null = null;
  let validation: VariableValidationResult | null = null;
  let retries = 0;
  let autoPatched = false;
  let patchedVariables: string[] = [];

  for (let attempt = 0; attempt <= MAX_VARIABLE_RETRY_ATTEMPTS; attempt++) {
    const result = await invokeLLM(
      {
        model: args.analysisModel,
        limiterKey: args.analysisLimiterKey,
        messages,
        params: {
          temperature: args.strategyConfig.temperature,
          maxTokens: args.strategyConfig.maxGenerationOutputTokens,
        },
        context: {
          source: 'optimization_generate',
          stepName: 'error_pattern_generate',
          requestId: `optimization:${args.optimizationId}:r${args.roundNumber}:generate${attempt > 0 ? `:retry${attempt}` : ''}`,
          promptVersionId: args.currentVersion.id,
          promptLanguage,
        },
        // Intermediate calls do not write run_result — write the finally-adopted one manually outside the loop (including autoPatched / patchedVariables)
        parseResponse: (content) => {
          try {
            return parseGenerateOutput(content, null);
          } catch {
            return null;
          }
        },
      },
      deps,
    );

    finalInvokeResult = result;
    const attemptParsed = parseGenerateOutput(result.content, result.finishReason);
    validateAppliedChanges(attemptParsed, fittedEvidence.bundle);
    const attemptValidation = validatePromptVariables(
      attemptParsed.newPromptBody,
      args.fieldWhitelist.promptVariables,
      attemptParsed.variablesUsed,
      requiredVariables,
    );

    // disallowed is unrecoverable (LLM used a variable outside the whitelist → business-side field config error; retries cannot save it) → fatal immediately
    if (attemptValidation.disallowed.length > 0) {
      throw new InvalidVariableUsageError(
        attemptValidation.disallowed,
        attemptValidation.missing,
        attemptValidation.removed,
      );
    }

    // Validation passes → done
    if (attemptValidation.ok) {
      parsed = attemptParsed;
      validation = attemptValidation;
      retries = attempt;
      break;
    }

    // Only removed errors: if retries remain, feed back to the LLM; otherwise fall back to the system auto-patch
    if (attempt === MAX_VARIABLE_RETRY_ATTEMPTS) {
      const removedToPatch = [...attemptValidation.removed];
      const patchedBody = autoPatchPromptBody(attemptParsed.newPromptBody, removedToPatch, promptLanguage);
      const reValidation = validatePromptVariables(
        patchedBody,
        args.fieldWhitelist.promptVariables,
        attemptParsed.variablesUsed,
        requiredVariables,
      );
      if (!reValidation.ok) {
        // The fallback sentence already concatenates the literal {{var}}; theoretically unreachable, but throw to be safe
        throw new InvalidVariableUsageError(reValidation.disallowed, reValidation.missing, reValidation.removed);
      }
      parsed = { ...attemptParsed, newPromptBody: patchedBody };
      validation = reValidation;
      autoPatched = true;
      patchedVariables = removedToPatch;
      retries = attempt;
      deps.logger.info(
        {
          optimizationId: args.optimizationId,
          roundNumber: args.roundNumber,
          patchedVariables,
          retries,
          promptVersionId: args.currentVersion.id,
          level: 'warn',
        },
        'optimization_generate_auto_patched',
      );
      break;
    }

    // Feed back the failure reason and prepare for the next iteration
    const removedSnapshot = [...attemptValidation.removed];
    deps.logger.info(
      {
        optimizationId: args.optimizationId,
        roundNumber: args.roundNumber,
        attempt,
        removedVariables: removedSnapshot,
        promptVersionId: args.currentVersion.id,
      },
      'optimization_generate_retry',
    );
    messages = [
      ...messages,
      { role: 'assistant', content: result.content },
      { role: 'user', content: buildVariableRetryFeedback(removedSnapshot, promptLanguage) },
    ];
  }

  if (!parsed || !validation || !finalInvokeResult) {
    // unreachable — the loop must hit break or throw
    throw new Error('generate_loop_invariant_violated');
  }

  // Manually write run_result (merge autoPatched / patchedVariables / retries into parsedOutput,
  // for the detail-page service to read and populate into the round DTO)
  const runResultCtx = buildRunResultForCall({
    meta: args.runResultMeta,
    runResultId: args.generateRunResultId,
    source: 'optimization_generate',
    roundIndex: args.roundNumber,
    messages,
    inputVariables: {
      optimizationId: args.optimizationId,
      roundNumber: args.roundNumber,
      stepName: 'error_pattern_generate',
      retries,
      autoPatched,
      promptLanguage,
    },
  });
  if (runResultCtx && deps.runResultWriter) {
    await deps.runResultWriter.writeRunResult({
      ...runResultCtx,
      roundIndex: runResultCtx.roundIndex ?? null,
      rawResponse: finalInvokeResult.content,
      parsedOutput: { ...parsed, autoPatched, patchedVariables, retries },
      decisionOutput: null,
      isCorrect: null,
      judgmentStatus: null,
      status: 'success',
      errorClass: null,
      errorMessage: null,
      latencyMs: finalInvokeResult.durationMs,
      inputTokens: finalInvokeResult.usage.inputTokens,
      outputTokens: finalInvokeResult.usage.outputTokens,
      costEstimate: finalInvokeResult.costEstimate,
    });
  }

  // Validate the LLM-output newOutputSchema: only adopt when it passes whitelist constraints (adds fields / keeps type);
  // validation failure → warn and degrade to inheriting the old schema (do not throw, to avoid blocking the round).
  let effectiveOutputSchema: unknown = args.currentVersion.outputSchema;
  if (parsed.newOutputSchema !== undefined) {
    const schemaCheck = safeValidateNewOutputSchema(parsed.newOutputSchema, args.currentVersion.outputSchema);
    if (schemaCheck.ok) {
      effectiveOutputSchema = parsed.newOutputSchema;
    } else {
      deps.logger.info(
        {
          optimizationId: args.optimizationId,
          roundNumber: args.roundNumber,
          promptVersionId: args.currentVersion.id,
          level: 'warn',
          errors: schemaCheck.errors,
          rejectedSchema: parsed.newOutputSchema,
        },
        'optimization_generate_new_output_schema_rejected',
      );
      delete parsed.newOutputSchema;
      delete parsed.outputSchemaChangeReason;
    }
  }

  // Bridge to a standard JSON Schema before generating the output-format section; consistent with the experiment.renderer real-dispatch assembly path.
  // The persisted effectiveOutputSchema retains the original shape (DTO or LLM-direct JSON Schema); the workflow writes it into the new version.
  const effectiveJsonSchema = outputSchemaToJsonSchema(effectiveOutputSchema);
  const outputFormatInstruction = buildOutputFormatInstruction(effectiveJsonSchema, { language: promptLanguage });
  const composedFullPrompt = composeFullPrompt(parsed.newPromptBody, effectiveJsonSchema, { language: promptLanguage });

  return {
    ...parsed,
    variableValidation: validation,
    budget: {
      baselineInputTokens: baseline.inputTokens,
      errorAnalysisBudgetTokens,
      errorAnalysisTruncated,
      originalErrorAnalysisChars: originalText.length,
      evidenceBundleBudgetTokens: errorAnalysisBudgetTokens,
      evidenceBundleTruncated: fittedEvidence.truncated,
      originalEvidenceBundleTokens: fittedEvidence.originalTokens,
      roundHistoryEntryCount: fittedHistoryResult.entryCount,
      roundHistoryFittedLevel: fittedHistoryResult.level,
      roundHistoryBudgetTokens: fittedHistoryResult.budgetTokens,
      roundHistoryTruncated: fittedHistoryResult.truncated,
    },
    effectiveOutputSchema,
    outputFormatInstruction,
    composedFullPrompt,
    retries,
    autoPatched,
    patchedVariables,
  };
}

function validateAppliedChanges(parsed: GenerateOutput, evidenceBundle: AnalysisEvidenceBundle): void {
  const applied = parsed.appliedChanges ?? [];
  if (applied.length === 0) return;
  const valid = new Set(
    evidenceBundle.suggestedChanges
      .map((c) => c.changeId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const invalid = applied.map((c) => c.changeId).filter((changeId) => changeId && !valid.has(changeId));
  if (invalid.length > 0) {
    throw new InvalidAppliedChangeReferenceError(invalid);
  }
}

function priorityRank(priority: string | undefined): number {
  return priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
}

function sortEvidenceBundle(bundle: AnalysisEvidenceBundle): AnalysisEvidenceBundle {
  return {
    ...bundle,
    errorPatterns: [...bundle.errorPatterns].sort(
      (a, b) => (b.affectedCount ?? b.count ?? 0) - (a.affectedCount ?? a.count ?? 0),
    ),
    suggestedChanges: [...bundle.suggestedChanges].sort((a, b) => {
      const byPriority = priorityRank(b.priority) - priorityRank(a.priority);
      if (byPriority !== 0) return byPriority;
      return (b.affectedCount ?? 0) - (a.affectedCount ?? 0);
    }),
    conflicts: [...(bundle.conflicts ?? [])],
  };
}

function fitEvidenceBundleToBudget(
  bundle: AnalysisEvidenceBundle,
  budgetTokens: number,
): { bundle: AnalysisEvidenceBundle; truncated: boolean; originalTokens: number } {
  const originalTokens = estimateMessagesTokens('', JSON.stringify(bundle), 0).inputTokens;
  if (originalTokens <= budgetTokens) {
    return { bundle, truncated: false, originalTokens };
  }

  let fitted: AnalysisEvidenceBundle = sortEvidenceBundle({
    ...bundle,
    summary: truncateLongText(bundle.summary, 1200),
    conflicts: (bundle.conflicts ?? []).slice(0, 5),
  });

  let truncated = fitted.summary !== bundle.summary || fitted.conflicts.length !== (bundle.conflicts ?? []).length;

  while (
    estimateMessagesTokens('', JSON.stringify(fitted), 0).inputTokens > budgetTokens &&
    (fitted.suggestedChanges.length > 1 || fitted.errorPatterns.length > 1)
  ) {
    truncated = true;
    if (fitted.suggestedChanges.length >= fitted.errorPatterns.length && fitted.suggestedChanges.length > 1) {
      fitted = { ...fitted, suggestedChanges: fitted.suggestedChanges.slice(0, -1) };
    } else if (fitted.errorPatterns.length > 1) {
      const keptPatterns = fitted.errorPatterns.slice(0, -1);
      const keptIds = new Set(
        keptPatterns.map((p) => p.patternId).filter((id): id is string => typeof id === 'string'),
      );
      fitted = {
        ...fitted,
        errorPatterns: keptPatterns,
        suggestedChanges: fitted.suggestedChanges.filter(
          (c) =>
            !c.addressesPatternIds ||
            c.addressesPatternIds.length === 0 ||
            c.addressesPatternIds.some((id) => keptIds.has(id)),
        ),
      };
    }
  }

  if (estimateMessagesTokens('', JSON.stringify(fitted), 0).inputTokens > budgetTokens) {
    truncated = true;
    fitted = {
      ...fitted,
      summary: truncateLongText(fitted.summary, 400),
      conflicts: [],
    };
  }

  return { bundle: fitted, truncated, originalTokens };
}

function legacyEvidenceBundle(analysis: AnalyzeFailuresResult): AnalysisEvidenceBundle {
  return {
    evidenceBundleVersion: 1,
    summary: analysis.summary.summary || analysis.errorAnalysisText,
    errorPatterns: analysis.summary.errorPatterns ?? [],
    suggestedChanges: analysis.summary.suggestedChanges ?? [],
    conflicts: analysis.summary.conflicts ?? [],
    sourceStats: {
      batchCount: analysis.batches.length,
      totalConfusionFailures: analysis.totalConfusionFailures,
      totalRegressionSamples: analysis.totalRegressionSamples,
      truncated: analysis.truncated,
    },
  };
}
