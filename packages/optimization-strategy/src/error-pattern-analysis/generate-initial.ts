// First-version prompt generation for from_dataset_only start mode — see docs/specs/25-optimizations.md §2.1
// Single LLM call, with no error evidence / no history rounds / no variable preservation constraint (base does not exist);
// induces the first prompt purely from dataset sampling + goals + fieldWhitelist + description.
import {
  invokeLLM,
  type InvokeLLMDependencies,
  type LLMMessage,
  type ModelInvocationConfig,
  type RunResultContext,
} from '@proofhound/llm-client';
import {
  DEFAULT_PROMPT_LANGUAGE,
  type PromptLanguageDto,
  type PromptOutputSchemaDto,
  type PromptVariableDto,
} from '@proofhound/shared';
import type { OptimizationGoal, FieldWhitelist } from '../loop/types';
import { type OptimizationRunResultMeta, buildRunResultForCall } from './analyze';
import type { ErrorPatternAnalysisConfig } from './config.schema';
import { extractJsonObject, isTruncated, safeParseJson } from './parse';
import { extractVariableNames } from './prompts';
import { getSystemPrompts } from './prompts/loader';

// When the LLM output cannot be parsed / does not conform to the contract, this error expresses it uniformly; the workflow maps it to
// the failure reason `first_version_parse_failed_v1` (see SPEC 25 §2.1 failure-reason code table).
export class FirstVersionParseError extends Error {
  readonly rawContent: string;
  constructor(message: string, rawContent: string) {
    super(message);
    this.name = 'FirstVersionParseError';
    this.rawContent = rawContent;
  }
}

export interface GenerateInitialVersionArgs {
  optimizationId: string;
  analysisModel: ModelInvocationConfig;
  analysisLimiterKey: string;
  // Samples already randomly drawn from the dataset — the caller is responsible for sampling size = initialSamplingRounds × initialSamplesPerRound
  samples: Array<{ id: string; data: Record<string, unknown> }>;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  description: string | null;
  optimizationHint?: string;
  promptLanguage?: PromptLanguageDto;
  strategyConfig: ErrorPatternAnalysisConfig;
  // When provided, invokeLLM auto-writes one ph_runs.run_results row (source='optimization_generate', round_index=0)
  runResultMeta?: OptimizationRunResultMeta;
  generateRunResultId?: string;
}

export interface GenerateInitialVersionResult {
  newPromptBody: string;
  variables: PromptVariableDto[];
  outputSchema: PromptOutputSchemaDto;
  changeSummary: string;
  truncated: boolean;
  rawContent: string;
}

function formatGoals(goals: OptimizationGoal[], language: PromptLanguageDto): string {
  if (goals.length === 0) return language === 'en-US' ? '(no optimization goals declared)' : '（未声明优化目标）';
  return goals
    .map((g) => {
      const scope =
        language === 'en-US'
          ? g.scope.kind === 'overall'
            ? 'overall'
            : `class "${g.scope.label}"`
          : g.scope.kind === 'overall'
            ? '整体'
            : `分类「${g.scope.label}」`;
      return language === 'en-US'
        ? `- \`${g.metric}\` for ${scope}: target \`${g.op} ${g.value}\``
        : `- ${scope} 的 \`${g.metric}\`：目标 \`${g.op} ${g.value}\``;
    })
    .join('\n');
}

function formatFieldWhitelist(fw: FieldWhitelist, language: PromptLanguageDto): string {
  const lines: string[] = [];
  lines.push(
    language === 'en-US'
      ? '### promptVariables (may be used as {{var}} placeholders in the prompt)'
      : '### promptVariables（可作为 {{var}} 进入 prompt）',
  );
  lines.push(
    fw.promptVariables.length === 0
      ? language === 'en-US'
        ? '(empty)'
        : '（空）'
      : fw.promptVariables.map((v) => `- \`${v}\``).join('\n'),
  );
  if (fw.analysisOnlyFields && fw.analysisOnlyFields.length > 0) {
    lines.push('');
    lines.push(
      language === 'en-US'
        ? '### analysisOnlyFields (analysis-only; forbidden in newPromptBody)'
        : '### analysisOnlyFields（仅分析可见，禁止出现在 newPromptBody）',
    );
    lines.push(fw.analysisOnlyFields.map((v) => `- \`${v}\``).join('\n'));
  }
  if (fw.modifiableSections && fw.modifiableSections.length > 0) {
    lines.push('');
    lines.push(
      language === 'en-US'
        ? '### modifiableSections (suggested prompt sections)'
        : '### modifiableSections（建议覆盖的 prompt 段）',
    );
    lines.push(fw.modifiableSections.map((v) => `- ${v}`).join('\n'));
  }
  return lines.join('\n');
}

function formatSamples(
  samples: Array<{ id: string; data: Record<string, unknown> }>,
  language: PromptLanguageDto,
): string {
  if (samples.length === 0) return language === 'en-US' ? '(no samples)' : '（无样本）';
  return samples
    .map((s, i) =>
      language === 'en-US'
        ? `### Sample ${i + 1} (id: \`${s.id}\`)\n\`\`\`json\n${JSON.stringify(s.data, null, 2)}\n\`\`\``
        : `### 样本 ${i + 1}（id: \`${s.id}\`）\n\`\`\`json\n${JSON.stringify(s.data, null, 2)}\n\`\`\``,
    )
    .join('\n\n');
}

function buildUserPrompt(args: GenerateInitialVersionArgs): string {
  const language = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const description =
    args.description && args.description.trim().length > 0
      ? args.description.trim()
      : language === 'en-US'
        ? 'The user did not provide a task description. Infer the task from the samples.'
        : '用户未提供任务描述，请根据样本自行推断业务。';
  if (language === 'en-US') {
    return [
      '## Task Description',
      description,
      '',
      '## User Generation Guidance',
      args.optimizationHint && args.optimizationHint.trim().length > 0 ? args.optimizationHint.trim() : '(none)',
      '',
      '## Optimization Goals',
      formatGoals(args.goals, language),
      '',
      '## Field Whitelist',
      formatFieldWhitelist(args.fieldWhitelist, language),
      '',
      '## Dataset Samples',
      formatSamples(args.samples, language),
    ].join('\n');
  }
  return [
    '## 任务描述',
    description,
    '',
    '## 用户给的提示词生成指引',
    args.optimizationHint && args.optimizationHint.trim().length > 0 ? args.optimizationHint.trim() : '（无）',
    '',
    '## 优化目标',
    formatGoals(args.goals, language),
    '',
    '## 字段白名单',
    formatFieldWhitelist(args.fieldWhitelist, language),
    '',
    '## 数据集采样',
    formatSamples(args.samples, language),
  ].join('\n');
}

function asVariableType(value: unknown): PromptVariableDto['type'] {
  if (value === 'image' || value === 'image_url' || value === 'image_base64' || value === 'number') {
    return value;
  }
  return 'text';
}

function parseVariables(value: unknown, allowed: Set<string>): PromptVariableDto[] {
  if (!Array.isArray(value)) return [];
  const out: PromptVariableDto[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!rawName || !allowed.has(rawName) || seen.has(rawName)) continue;
    seen.add(rawName);
    const entry: PromptVariableDto = {
      name: rawName,
      type: asVariableType(obj.type),
      required: typeof obj.required === 'boolean' ? obj.required : true,
    };
    if (typeof obj.description === 'string' && obj.description.trim().length > 0) {
      entry.description = obj.description.trim().slice(0, 500);
    }
    if (typeof obj.datasetField === 'string' && obj.datasetField.trim().length > 0) {
      entry.datasetField = obj.datasetField.trim().slice(0, 160);
    }
    out.push(entry);
  }
  return out;
}

function parseOutputSchema(value: unknown): PromptOutputSchemaDto {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.fields)) return { fields: [] };
  const fields = obj.fields
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .slice(0, 50)
    .map((f) => {
      const key = typeof f.key === 'string' ? f.key.trim().slice(0, 160) : '';
      const rawValue = typeof f.value === 'string' ? f.value.slice(0, 2000) : '';
      const isJudgment = typeof f.isJudgment === 'boolean' ? f.isJudgment : false;
      return { key, value: rawValue, isJudgment };
    })
    .filter((f) => f.key.length > 0);
  return { fields };
}

function parseInitialGenerateOutput(
  content: string,
  finishReason: string | null | undefined,
  allowedVariables: string[],
): GenerateInitialVersionResult {
  const truncated = isTruncated(finishReason);
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    throw new FirstVersionParseError('first-version generate: missing JSON block', content);
  }
  const parsed = safeParseJson(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    throw new FirstVersionParseError('first-version generate: JSON parse failed', content);
  }
  const obj = parsed as Record<string, unknown>;
  const body = typeof obj.newPromptBody === 'string' ? obj.newPromptBody.trim() : '';
  if (!body) {
    throw new FirstVersionParseError('first-version generate: newPromptBody is empty or missing', content);
  }
  const allowedSet = new Set(allowedVariables);
  // Validate that placeholder variables referenced in the body are all within the whitelist — base has no "already used" concept, so no removed check is needed
  const usedInBody = extractVariableNames(body);
  const disallowed = usedInBody.filter((v) => !allowedSet.has(v));
  if (disallowed.length > 0) {
    throw new FirstVersionParseError(
      `first-version generate: prompt uses disallowed variables ${JSON.stringify(disallowed)}`,
      content,
    );
  }
  // When the whitelist is non-empty, force newPromptBody to use at least one placeholder (otherwise the business model cannot see samples at runtime)
  if (allowedVariables.length > 0 && usedInBody.length === 0) {
    throw new FirstVersionParseError(
      'first-version generate: prompt must use at least one promptVariable placeholder',
      content,
    );
  }
  const outputSchema = parseOutputSchema(obj.outputSchema);
  if (!outputSchema || outputSchema.fields.length === 0) {
    throw new FirstVersionParseError(
      'first-version generate: outputSchema.fields must contain at least one field',
      content,
    );
  }
  if (!outputSchema.fields.some((f) => f.isJudgment)) {
    throw new FirstVersionParseError(
      'first-version generate: outputSchema must include at least one isJudgment field',
      content,
    );
  }
  return {
    newPromptBody: body,
    variables: parseVariables(obj.variables, allowedSet),
    outputSchema,
    changeSummary: typeof obj.changeSummary === 'string' ? obj.changeSummary : '',
    truncated,
    rawContent: content,
  };
}

export async function generateInitialVersion(
  args: GenerateInitialVersionArgs,
  deps: InvokeLLMDependencies,
): Promise<GenerateInitialVersionResult> {
  const promptLanguage = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const messages: LLMMessage[] = [
    { role: 'system', content: getSystemPrompts(promptLanguage).generateInitial },
    { role: 'user', content: buildUserPrompt(args) },
  ];

  const runResultCtx: RunResultContext | undefined = buildRunResultForCall({
    meta: args.runResultMeta,
    runResultId: args.generateRunResultId,
    source: 'optimization_generate',
    roundIndex: 0,
    messages,
    inputVariables: {
      optimizationId: args.optimizationId,
      stepName: 'first_version_generate',
      sampleCount: args.samples.length,
      promptLanguage,
    },
  });

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
        stepName: 'first_version_generate',
        requestId: `optimization:${args.optimizationId}:first-version:generate`,
        promptLanguage,
      },
      runResult: runResultCtx,
      // Parse failure → let invokeLLM get null parsed and still write run_result(success); the function below will rethrow
      parseResponse: (content) => {
        try {
          return parseInitialGenerateOutput(content, null, args.fieldWhitelist.promptVariables);
        } catch {
          return null;
        }
      },
    },
    deps,
  );

  // Re-parse (parseResponse above swallowed the exception; call again here to get the concrete error and throw)
  return parseInitialGenerateOutput(result.content, result.finishReason, args.fieldWhitelist.promptVariables);
}
