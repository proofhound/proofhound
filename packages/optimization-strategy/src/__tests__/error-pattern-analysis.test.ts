import { describe, expect, it, vi } from 'vitest';
import type { LLMCallLogger } from '@proofhound/llm-client';
import { analyzeFailures } from '../error-pattern-analysis/analyze';
import {
  DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
  errorPatternAnalysisConfigSchema,
} from '../error-pattern-analysis/config.schema';
import { generateNextVersion } from '../error-pattern-analysis/generate';
import { OPTIMIZATION_TIPS } from '../error-pattern-analysis/prompts';
import {
  InvalidAppliedChangeReferenceError,
  InvalidVariableUsageError,
  MalformedGenerationError,
  extractJsonObject,
  parseConfusionAnalysisOutput,
  parseGenerateOutput,
  validatePromptVariables,
} from '../error-pattern-analysis/parse';
import { extractVariableNames } from '../error-pattern-analysis/prompts';
import type {
  OptimizationGoal,
  FieldWhitelist,
  MetricSnapshot,
  PromptVersionRef,
  RunResultRecord,
  SampleRecord,
} from '../loop/types';
import {
  createFakeAdapter,
  makeAnalysisModel,
  makeInvokeLLMDependencies,
  RecordingRunResultWriter,
} from './helpers/fake-invoke-deps';

function recordingLimiter() {
  const acquiredKeys: string[] = [];
  return {
    acquiredKeys,
    limiter: {
      acquire: vi.fn(async (args: { key: string }) => {
        acquiredKeys.push(args.key);
      }),
      release: vi.fn(),
      reportOutcome: vi.fn(),
    },
  };
}

const currentVersion: PromptVersionRef = {
  id: 'pv_001',
  promptId: 'p_001',
  versionNumber: 1,
  body: '请把输入 {{text}} 分类为 A 或 B。',
  outputSchema: { type: 'object', properties: { decision: { enum: ['A', 'B'] } } },
  judgmentRules: { ruleName: 'enum_match', config: { field: 'decision' } },
  variables: [{ name: 'text' }],
};

const samples: SampleRecord[] = [
  { id: 's1', input: { text: 'foo', secret_id: 'x1' }, expected: 'A' },
  { id: 's2', input: { text: 'bar', secret_id: 'x2' }, expected: 'B' },
  { id: 's3', input: { text: 'baz', secret_id: 'x3' }, expected: 'A' },
  { id: 's4', input: { text: 'qux', secret_id: 'x4' }, expected: 'B' },
];

const currentRunResults: RunResultRecord[] = [
  { id: 'rr1', sampleId: 's1', decisionOutput: 'A', isCorrect: true },
  { id: 'rr2', sampleId: 's2', decisionOutput: 'A', isCorrect: false }, // B→A
  { id: 'rr3', sampleId: 's3', decisionOutput: 'B', isCorrect: false }, // A→B
  { id: 'rr4', sampleId: 's4', decisionOutput: 'A', isCorrect: false }, // B→A
];

const previousRunResults: RunResultRecord[] = [
  { id: 'prr1', sampleId: 's1', decisionOutput: 'A', isCorrect: true },
  { id: 'prr2', sampleId: 's2', decisionOutput: 'B', isCorrect: true }, // Previous round correct, this round wrong → regression
  { id: 'prr3', sampleId: 's3', decisionOutput: 'B', isCorrect: false },
  { id: 'prr4', sampleId: 's4', decisionOutput: 'A', isCorrect: false },
];

const metrics: MetricSnapshot = { overall: { accuracy: 0.25 } };
const goals: OptimizationGoal[] = [{ metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } }];
const fieldWhitelist: FieldWhitelist = {
  promptVariables: ['text'],
  analysisOnlyFields: ['secret_id'],
  modifiableSections: ['任务说明', '示例区'],
};

// Standard fake LLM response
const confusionResp = JSON.stringify({
  confusionPair: 'B→A',
  errorPatterns: [
    { label: 'B 被误判为 A', count: 2, reason: '模型偏向 A', exampleSampleIds: ['s2', 's4'] },
  ],
  suggestedChanges: [
    { section: '任务说明', change: '强化 B 的判定特征', rationale: '减少向 A 偏移' },
  ],
});

const regressionResp = JSON.stringify({
  errorPatterns: [
    { label: '回归到错', count: 1, reason: 'prompt 改动后丢失 B 边界', exampleSampleIds: ['s2'] },
  ],
  suggestedChanges: [
    { section: '示例区', change: '恢复 B 的边界示例', rationale: '避免回归' },
  ],
});

const summarizeResp = JSON.stringify({
  summary: '本轮失败集中在 B→A 混淆，且其中部分是回归样本。建议加强 B 的判定边界。',
  evidenceBundleVersion: 1,
  errorPatterns: [
    {
      patternId: 'summary:p1',
      label: 'B→A 混淆',
      count: 3,
      affectedCount: 3,
      reason: '模型偏向 A',
      exampleSampleIds: ['s2', 's4'],
      source: 'confusion',
      bucketKey: 'B→A',
    },
  ],
  suggestedChanges: [
    {
      changeId: 'summary:c1',
      section: '任务说明',
      change: '强化 B 的判定特征',
      rationale: '减少偏移',
      addressesPatternIds: ['summary:p1'],
      evidenceSampleIds: ['s2', 's4'],
      affectedCount: 3,
      priority: 'high',
    },
  ],
  conflicts: [],
});

const generateResp = JSON.stringify({
  newPromptBody: '请仔细判定输入 {{text}} 属于 A 还是 B。B 的特征：…',
  changeSummary: '增加 B 的特征描述',
  appliedTips: ['术语 / 类别明确化'],
  variablesUsed: ['text'],
});

function defaultAdapter(overrides?: {
  confusion?: string;
  regression?: string;
  summarize?: string;
  generate?: string | string[];
}) {
  const generate = overrides?.generate;
  return createFakeAdapter({
    confusion: { content: overrides?.confusion ?? confusionResp },
    regression: { content: overrides?.regression ?? regressionResp },
    summarize: { content: overrides?.summarize ?? summarizeResp },
    generate: Array.isArray(generate)
      ? generate.map((content) => ({ content }))
      : { content: generate ?? generateResp },
  });
}

describe('errorPatternAnalysisConfigSchema', () => {
  it('parses defaults', () => {
    const parsed = errorPatternAnalysisConfigSchema.parse({});
    expect(parsed).toEqual(DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG);
    expect(parsed.topConfusionPairs).toBe(5);
    expect(parsed.maxSamplesPerConfusionPair).toBe(8);
    expect(parsed.maxRegressionSamples).toBe(20);
  });
});

describe('OPTIMIZATION_TIPS', () => {
  it('contains 6+ techniques referenced by name', () => {
    expect(OPTIMIZATION_TIPS.length).toBeGreaterThan(500);
    // Must contain the core technique
    for (const tip of ['思维链', 'Few-shot', '术语', '输出约束', 'Chain-of-Verification']) {
      expect(OPTIMIZATION_TIPS).toContain(tip);
    }
  });
});

describe('parse helpers', () => {
  it('extracts JSON from fenced block', () => {
    const text = '前言\n```json\n{"a": 1}\n```\n尾文';
    expect(extractJsonObject(text)).toBe('{"a": 1}');
  });

  it('falls back to bare-brace JSON if no fence', () => {
    const text = '一段说明 { "a": 1 } 后文';
    expect(extractJsonObject(text)).toBe('{ "a": 1 }');
  });

  it('extractVariableNames finds {{var}} occurrences', () => {
    expect(extractVariableNames('请处理 {{text}} 和 {{label}}, 以及重复的 {{text}}').sort()).toEqual([
      'label',
      'text',
    ]);
  });

  it('validatePromptVariables flags disallowed vars', () => {
    const r = validatePromptVariables('用 {{text}} 和 {{secret_id}}', ['text'], ['text']);
    expect(r.ok).toBe(false);
    expect(r.disallowed).toEqual(['secret_id']);
  });

  it('validatePromptVariables ok when detected ⊆ allowed', () => {
    const r = validatePromptVariables('只用 {{text}}', ['text', 'label'], ['text']);
    expect(r.ok).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it('validatePromptVariables flags removed when required base var is dropped', () => {
    // base used {{text}}, new version rewrites the whole thing and loses the placeholder → must be rejected (otherwise the model cannot see the sample at inference)
    const r = validatePromptVariables('完全不引用变量', ['text', 'expected_output'], [], ['text']);
    expect(r.ok).toBe(false);
    expect(r.removed).toEqual(['text']);
    expect(r.disallowed).toEqual([]);
  });

  it('validatePromptVariables does not require non-base whitelist vars (e.g. expected_output)', () => {
    // Whitelist contains the ground truth field, but base never used it → new version must not be forced to include it
    const r = validatePromptVariables('只用 {{text}}', ['text', 'expected_output'], ['text'], ['text']);
    expect(r.ok).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it('parseConfusionAnalysisOutput tolerates malformed JSON', () => {
    const out = parseConfusionAnalysisOutput('没有 JSON 的纯文本', 'stop');
    expect(out.errorPatterns).toEqual([]);
    expect(out.suggestedChanges).toEqual([]);
  });

  it('parseConfusionAnalysisOutput backfills stable evidence ids for old format', () => {
    const out = parseConfusionAnalysisOutput(confusionResp, 'stop');
    expect(out.errorPatterns[0]).toMatchObject({
      patternId: expect.stringContaining('confusion:'),
      source: 'confusion',
      bucketKey: 'B→A',
      affectedCount: 2,
      exampleSampleIds: ['s2', 's4'],
    });
    expect(out.suggestedChanges[0]).toMatchObject({
      changeId: expect.stringContaining('confusion:'),
      affectedCount: undefined,
    });
  });

  it('parseGenerateOutput throws when newPromptBody is missing', () => {
    const out = '```json\n{"changeSummary":"x"}\n```';
    expect(() => parseGenerateOutput(out, 'stop')).toThrow(MalformedGenerationError);
  });

  it('parseGenerateOutput throws when JSON block is missing', () => {
    expect(() => parseGenerateOutput('纯文本', 'stop')).toThrow(MalformedGenerationError);
  });
});

describe('analyzeFailures', () => {
  function commonArgs() {
    return {
      optimizationId: 'ai_001',
      roundNumber: 2,
      analysisModel: makeAnalysisModel(),
      analysisLimiterKey: 'test:analysis-model',
      currentVersion,
      samples,
      currentRunResults,
      previousRunResults,
      metrics,
      goals,
      fieldWhitelist,
      strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
    };
  }

  it('calls LLM once per confusion pair + once per regression group + 1 summarize', async () => {
    const adapter = defaultAdapter();
    const limiter = recordingLimiter();
    const result = await analyzeFailures(commonArgs(), {
      ...makeInvokeLLMDependencies(adapter),
      limiter: limiter.limiter,
    });
    // confusion: 2 pairs (B→A count=2, A→B count=1)
    expect(adapter.callsFor('confusion')).toHaveLength(2);
    // regression: 1 group (predicted=A from s2)
    expect(adapter.callsFor('regression')).toHaveLength(1);
    // summarize: 1
    expect(adapter.callsFor('summarize')).toHaveLength(1);
    expect(result.batches).toHaveLength(3);
    expect(result.errorAnalysisText).toContain('B→A 混淆');
    expect(result.evidenceBundle).toMatchObject({
      evidenceBundleVersion: 1,
      sourceStats: {
        batchCount: 3,
        totalConfusionFailures: 3,
        totalRegressionSamples: 1,
      },
    });
    expect(limiter.acquiredKeys).toEqual([
      'test:analysis-model',
      'test:analysis-model',
      'test:analysis-model',
      'test:analysis-model',
    ]);
  });

  it('skips regression when previousRunResults is null', async () => {
    const adapter = defaultAdapter();
    const result = await analyzeFailures(
      { ...commonArgs(), previousRunResults: null },
      makeInvokeLLMDependencies(adapter),
    );
    expect(adapter.callsFor('regression')).toHaveLength(0);
    expect(result.regressionGroups).toEqual([]);
  });

  it('confusion user prompt contains projected sample fields (no leakage of metadata)', async () => {
    const adapter = defaultAdapter();
    await analyzeFailures(commonArgs(), makeInvokeLLMDependencies(adapter));
    const confusionCall = adapter.callsFor('confusion')[0]!;
    expect(confusionCall.userPrompt).toContain('text');
    expect(confusionCall.userPrompt).toContain('secret_id'); // analysisOnlyFields visible
    expect(confusionCall.systemPrompt).toContain('promptVariables');
    expect(confusionCall.systemPrompt).toContain('analysisOnlyFields');
  });

  it('confusion system prompt mandates JSON output + escape rules', async () => {
    const adapter = defaultAdapter();
    await analyzeFailures(commonArgs(), makeInvokeLLMDependencies(adapter));
    const call = adapter.callsFor('confusion')[0]!;
    expect(call.systemPrompt).toContain('JSON');
    expect(call.systemPrompt).toContain('转义');
  });

  it('summarize receives all batch payloads in user message', async () => {
    const adapter = defaultAdapter();
    await analyzeFailures(commonArgs(), makeInvokeLLMDependencies(adapter));
    const summarize = adapter.callsFor('summarize')[0]!;
    expect(summarize.userPrompt).toContain('confusion: B→A');
    expect(summarize.userPrompt).toContain('regression: predicted=A');
  });

  it('emits per-batch budget report (baseline / sampleBudget / fittedSampleCount)', async () => {
    const adapter = defaultAdapter();
    const result = await analyzeFailures(commonArgs(), makeInvokeLLMDependencies(adapter));
    for (const b of result.batches) {
      expect(b.budget).toBeDefined();
      expect(b.budget.baselineInputTokens).toBeGreaterThan(0);
      expect(b.budget.sampleBudgetTokens).toBeGreaterThanOrEqual(0);
      expect(b.budget.fittedSampleCount).toBeGreaterThan(0);
      expect(b.budget.fieldsTruncated).toBe(false); // Default budget 60k is sufficient
    }
  });

  it('drops samples when maxInputTokensPerBatch is tight', async () => {
    const adapter = defaultAdapter();
    const tightSamples: SampleRecord[] = Array.from({ length: 6 }, (_, i) => ({
      id: `bigs${i}`,
      input: { text: 'x'.repeat(2000), secret_id: `id${i}` },
      expected: 'B',
    }));
    const tightRuns: RunResultRecord[] = tightSamples.map((s, i) => ({
      id: `rr_${i}`,
      sampleId: s.id,
      decisionOutput: 'A',
      isCorrect: false,
    }));
    const result = await analyzeFailures(
      {
        ...commonArgs(),
        samples: tightSamples,
        currentRunResults: tightRuns,
        previousRunResults: null, // Isolate the confusion path
        strategyConfig: {
          ...DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
          maxInputTokensPerBatch: 2_500, // One sample is ~500 tokens; with baseline ~800-1000 → ≤ 3 entries
        },
      },
      makeInvokeLLMDependencies(adapter),
    );
    const confusionBatch = result.batches.find((b) => b.source === 'confusion')!;
    expect(confusionBatch.budget.originalSampleCount).toBeGreaterThan(confusionBatch.budget.fittedSampleCount);
    expect(confusionBatch.budget.droppedSampleCount).toBeGreaterThan(0);
    expect(confusionBatch.budget.fieldsTruncated).toBe(false);
  });

  it('triggers field truncation when a single sample exceeds the budget', async () => {
    const adapter = defaultAdapter();
    // One sample is ~10k tokens (40000 chars)
    const huge: SampleRecord = {
      id: 'huge1',
      input: { text: 'x'.repeat(40_000), secret_id: 'sx' },
      expected: 'B',
    };
    const result = await analyzeFailures(
      {
        ...commonArgs(),
        samples: [huge],
        currentRunResults: [{ id: 'rr_huge', sampleId: huge.id, decisionOutput: 'A', isCorrect: false }],
        previousRunResults: null,
        strategyConfig: {
          ...DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
          maxInputTokensPerBatch: 2_000, // Cannot fit a single one
        },
      },
      makeInvokeLLMDependencies(adapter),
    );
    const confusionBatch = result.batches.find((b) => b.source === 'confusion')!;
    expect(confusionBatch.budget.fittedSampleCount).toBe(1);
    expect(confusionBatch.budget.fieldsTruncated).toBe(true);
  });

  it('summarize truncates fields when batches exceed budget', async () => {
    // Prepare a long reason so the serialized batches are huge
    const longReason = 'r'.repeat(5_000);
    const giantConfusion = JSON.stringify({
      confusionPair: 'B→A',
      errorPatterns: [
        { label: 'pat', count: 10, reason: longReason, exampleSampleIds: ['s2'] },
      ],
      suggestedChanges: [{ section: '任务说明', change: 'x'.repeat(5000), rationale: 'y' }],
    });
    const adapter = createFakeAdapter({
      confusion: [{ content: giantConfusion }, { content: giantConfusion }],
      regression: { content: regressionResp },
      summarize: { content: summarizeResp },
      generate: { content: generateResp },
    });
    const result = await analyzeFailures(
      {
        ...commonArgs(),
        previousRunResults: null,
        strategyConfig: {
          ...DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
          maxInputTokensPerBatch: 4_000, // Smaller than the sum of 2 giant batches
        },
      },
      makeInvokeLLMDependencies(adapter),
    );
    expect(result.summarizeBudget?.fieldTruncationApplied).toBe(true);
  });

  it('returns truncated=true when any batch was truncated', async () => {
    const adapter = createFakeAdapter({
      confusion: [{ content: confusionResp }, { content: confusionResp, finishReason: 'length' }],
      regression: { content: regressionResp },
      summarize: { content: summarizeResp },
      generate: { content: generateResp },
    });
    const result = await analyzeFailures(commonArgs(), makeInvokeLLMDependencies(adapter));
    expect(result.truncated).toBe(true);
  });

  it('writes run_results with round_index = roundNumber when runResultMeta + analysisRunResultId supplied', async () => {
    // The detail page's listOptimizationLlmRunResults filters by isNotNull(round_index); a missing value drops the whole row.
    // This test confirms that during the summarize stage, invokeLLM calls writer.writeRunResult with roundIndex.
    const adapter = defaultAdapter();
    const writer = new RecordingRunResultWriter();
    await analyzeFailures(
      {
        ...commonArgs(),
        runResultMeta: {
          projectId: 'proj_001',
          sourceId: 'ai_001',
          promptVersionId: 'pv_001',
          modelId: 'model_analysis_001',
          dbosWorkflowId: 'wf_abc',
          bullmqJobId: null,
          attempt: 0,
        },
        analysisRunResultId: '99999999-9999-9999-9999-999999999999',
      },
      { ...makeInvokeLLMDependencies(adapter), runResultWriter: writer },
    );
    // Only the summarize stage writes to the table (confusion / regression do not), so it should be 1 record
    expect(writer.records).toHaveLength(1);
    const [rec] = writer.records;
    expect(rec).toMatchObject({
      id: '99999999-9999-9999-9999-999999999999',
      source: 'optimization_analysis',
      sourceId: 'ai_001',
      roundIndex: 2,
      status: 'success',
    });
  });

  it('handles empty currentRunResults gracefully (no LLM calls, summary fallback, emits analyze_skipped log)', async () => {
    const adapter = defaultAdapter();
    const infoCalls: Array<{ payload: Record<string, unknown>; msg: string }> = [];
    const spyLogger: LLMCallLogger = {
      info(payload, msg) {
        infoCalls.push({ payload: payload as Record<string, unknown>, msg });
      },
      error() {
        /* no-op */
      },
    };
    const result = await analyzeFailures(
      { ...commonArgs(), currentRunResults: [], previousRunResults: null },
      { ...makeInvokeLLMDependencies(adapter), logger: spyLogger },
    );
    expect(adapter.calls).toHaveLength(0);
    expect(result.errorAnalysisText).toContain('没有失败样本');
    const skipped = infoCalls.find((c) => c.msg === 'analyze_skipped');
    expect(skipped).toBeDefined();
    expect(skipped!.payload).toMatchObject({
      optimizationId: 'ai_001',
      roundNumber: 2,
      reason: 'no_batches',
      confusionPairsCount: 0,
      regressionGroupsCount: 0,
      currentFailureCount: 0,
      currentRunResultsCount: 0,
      previousRunResultsCount: 0,
      hasPreviousRound: false,
      samplesWithExpectedCount: 4,
    });
  });
});

describe('generateNextVersion', () => {
  function commonGenArgs(analysisOverride?: { errorAnalysisText?: string }) {
    return {
      optimizationId: 'ai_001',
      roundNumber: 2,
      analysisModel: makeAnalysisModel(),
      analysisLimiterKey: 'test:analysis-model',
      currentVersion,
      analysis: {
        errorAnalysisText: analysisOverride?.errorAnalysisText ?? '## 错误模式\n1. B→A',
        summary: {
          summary: '占位',
          errorPatterns: [
            {
              patternId: 'summary:p1',
              label: 'B→A 混淆',
              count: 3,
              affectedCount: 3,
              reason: '模型偏向 A',
              exampleSampleIds: ['s2', 's4'],
              source: 'confusion' as const,
              bucketKey: 'B→A',
            },
          ],
          suggestedChanges: [
            {
              changeId: 'summary:c1',
              section: '任务说明',
              change: '强化 B 的判定特征',
              rationale: '减少偏移',
              addressesPatternIds: ['summary:p1'],
              evidenceSampleIds: ['s2', 's4'],
              affectedCount: 3,
              priority: 'high' as const,
            },
          ],
          conflicts: [],
          evidenceBundleVersion: 1 as const,
          truncated: false,
          rawContent: '',
        },
        evidenceBundle: {
          evidenceBundleVersion: 1 as const,
          summary: '占位',
          errorPatterns: [
            {
              patternId: 'summary:p1',
              label: 'B→A 混淆',
              count: 3,
              affectedCount: 3,
              reason: '模型偏向 A',
              exampleSampleIds: ['s2', 's4'],
              source: 'confusion' as const,
              bucketKey: 'B→A',
            },
          ],
          suggestedChanges: [
            {
              changeId: 'summary:c1',
              section: '任务说明',
              change: '强化 B 的判定特征',
              rationale: '减少偏移',
              addressesPatternIds: ['summary:p1'],
              evidenceSampleIds: ['s2', 's4'],
              affectedCount: 3,
              priority: 'high' as const,
            },
          ],
          conflicts: [],
          sourceStats: {
            batchCount: 1,
            totalConfusionFailures: 3,
            totalRegressionSamples: 0,
            truncated: false,
          },
        },
        batches: [],
        confusionPairs: [],
        regressionGroups: [],
        truncated: false,
        totalConfusionFailures: 0,
        totalRegressionSamples: 0,
      },
      metrics,
      goals,
      fieldWhitelist,
      optimizationHint: '请保留原 prompt 的简洁风格',
      strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
    };
  }

  it('system prompt covers 9 required blocks', async () => {
    const adapter = defaultAdapter();
    const limiter = recordingLimiter();
    await generateNextVersion(commonGenArgs(), {
      ...makeInvokeLLMDependencies(adapter),
      limiter: limiter.limiter,
    });
    const call = adapter.callsFor('generate')[0]!;
    expect(limiter.acquiredKeys).toEqual(['test:analysis-model']);
    // Assert each of the 9 blocks (per spec)
    expect(call.systemPrompt).toContain('提示词改写工程师'); // 1. Role setup
    expect(call.systemPrompt).toContain('硬约束'); // Optimization constraints
    expect(call.systemPrompt).toContain('promptVariables'); // Variable whitelist
    expect(call.systemPrompt).toContain('analysisOnlyFields'); // Forbidden fields
    expect(call.systemPrompt).toContain('output schema'); // Schema is immutable
    expect(call.systemPrompt).toContain('judgment rules'); // Judgment is immutable
    expect(call.systemPrompt).toContain('逐字保留 base 已用占位'); // Hard constraint #1 — prevent v17-style collapse
    expect(call.systemPrompt).toContain('modifiableSections'); // Modifiable sections
    expect(call.systemPrompt).toContain('优化技巧'); // Optimization techniques
    expect(call.systemPrompt).toContain('JSON'); // JSON output
    expect(call.systemPrompt).toContain('转义'); // Escape constraints
    // User hints go into the user message
    expect(call.userPrompt).toContain('请保留原 prompt 的简洁风格');
    // The current prompt + goal comparison + scope-relevant metrics + error analysis are all in the user message
    expect(call.userPrompt).toContain(currentVersion.body);
    expect(call.userPrompt).toContain('优化目标 vs 当前实际');
    // "goal + current actual + gap" triple
    expect(call.userPrompt).toContain('目标 `>= 0.9`');
    expect(call.userPrompt).toContain('当前实际 `0.2500`');
    expect(call.userPrompt).toContain('差距 `-0.6500`');
    expect(call.userPrompt).toContain('❌ 未达成');
    // base placeholders already in use are explicitly listed (A: prevent missing {{text}} during a v17-style full rewrite)
    expect(call.userPrompt).toContain('必须保留的变量占位');
    expect(call.userPrompt).toContain('`{{text}}`');
    // Scope-relevant metrics
    expect(call.userPrompt).toContain('涉及范围的完整指标');
    expect(call.userPrompt).toContain('### 整体');
    expect(call.userPrompt).toContain('错误分析');
    expect(call.userPrompt).toContain('结构化错误证据包');
    expect(call.userPrompt).toContain('"changeId": "summary:c1"');
  });

  it('parses generate JSON and returns variableValidation ok', async () => {
    const adapter = defaultAdapter();
    const result = await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    expect(result.newPromptBody).toContain('{{text}}');
    expect(result.changeSummary).toContain('B 的特征');
    expect(result.appliedTips).toEqual(['术语 / 类别明确化']);
    expect(result.variableValidation.ok).toBe(true);
    expect(result.variableValidation.detected).toEqual(['text']);
  });

  it('writes generate run_results with round_index = roundNumber when runResultMeta + generateRunResultId supplied', async () => {
    const adapter = defaultAdapter();
    const writer = new RecordingRunResultWriter();
    await generateNextVersion(
      {
        ...commonGenArgs(),
        runResultMeta: {
          projectId: 'proj_001',
          sourceId: 'ai_001',
          promptVersionId: 'pv_001',
          modelId: 'model_analysis_001',
          dbosWorkflowId: 'wf_abc',
          bullmqJobId: null,
          attempt: 0,
        },
        generateRunResultId: '88888888-8888-8888-8888-888888888888',
      },
      { ...makeInvokeLLMDependencies(adapter), runResultWriter: writer },
    );
    expect(writer.records).toHaveLength(1);
    expect(writer.records[0]).toMatchObject({
      id: '88888888-8888-8888-8888-888888888888',
      source: 'optimization_generate',
      sourceId: 'ai_001',
      roundIndex: 2,
      status: 'success',
    });
  });

  it('auto-builds outputFormatInstruction from currentVersion.outputSchema enum labels', async () => {
    const adapter = defaultAdapter();
    const result = await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    // currentVersion.outputSchema is { decision: enum [A, B] }
    expect(result.outputFormatInstruction).toContain('## 输出格式');
    expect(result.outputFormatInstruction).toContain('"decision": <A | B>');
    expect(result.outputFormatInstruction).toContain('必须是以下之一：`A` / `B`');
  });

  it('composedFullPrompt = newPromptBody + outputFormatInstruction (separated by blank line)', async () => {
    const adapter = defaultAdapter();
    const result = await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    expect(result.composedFullPrompt.startsWith(result.newPromptBody.trimEnd())).toBe(true);
    expect(result.composedFullPrompt).toContain('\n\n## 输出格式');
    expect(result.composedFullPrompt).toContain('<A | B>');
  });

  it('returns empty outputFormatInstruction and unchanged composedFullPrompt when outputSchema missing', async () => {
    const adapter = defaultAdapter();
    const argsNoSchema = commonGenArgs();
    argsNoSchema.currentVersion = { ...currentVersion, outputSchema: undefined };
    const result = await generateNextVersion(argsNoSchema, makeInvokeLLMDependencies(adapter));
    expect(result.outputFormatInstruction).toBe('');
    expect(result.composedFullPrompt).toBe(result.newPromptBody);
  });

  it('bridges PromptOutputSchemaDto {fields:[...]} into 「## 输出格式」 section', async () => {
    // In the production DB, prompt_versions.output_schema is mostly persisted in the {fields:[{key,value,isJudgment}]} DTO shape.
    // After bridging, composedFullPrompt must contain the localized output-format section; the raw {"fields":[...]} must not be re-injected into the prompt.
    const adapter = defaultAdapter();
    const argsDto = commonGenArgs();
    argsDto.currentVersion = {
      ...currentVersion,
      outputSchema: {
        fields: [
          { key: 'decision', value: 'A 或 B', isJudgment: true },
          { key: 'reason', value: '判定依据', isJudgment: false },
        ],
      },
    };
    const result = await generateNextVersion(argsDto, makeInvokeLLMDependencies(adapter));
    expect(result.outputFormatInstruction).toContain('## 输出格式');
    expect(result.outputFormatInstruction).toContain('"decision": <string>');
    expect(result.outputFormatInstruction).toContain('"reason": <string>');
    expect(result.outputFormatInstruction).toContain('A 或 B');
    expect(result.outputFormatInstruction).not.toContain('isJudgment');
    expect(result.composedFullPrompt).toContain('## 输出格式');
    expect(result.composedFullPrompt).not.toContain('"fields":');
  });

  it('user prompt shows auto-composed output format section instead of raw schema', async () => {
    const adapter = defaultAdapter();
    await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    const call = adapter.callsFor('generate')[0]!;
    // The user prompt no longer JSON.stringifies outputSchema as-is to the LLM
    expect(call.userPrompt).toContain('运行时自动拼接的输出格式段');
    expect(call.userPrompt).toContain('<A | B>');
    expect(call.userPrompt).not.toContain('## 不可改动的 output schema');
  });

  it('system prompt forbids LLM from writing output format inside newPromptBody', async () => {
    const adapter = defaultAdapter();
    await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    const call = adapter.callsFor('generate')[0]!;
    expect(call.systemPrompt).toContain('不要在 newPromptBody 里写输出格式');
  });

  it('throws MalformedGenerationError when LLM output lacks JSON', async () => {
    const adapter = defaultAdapter({ generate: '纯文本，没有 JSON' });
    await expect(generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter))).rejects.toBeInstanceOf(
      MalformedGenerationError,
    );
  });

  it('rejects generate output that references unknown changeId', async () => {
    const badResp = JSON.stringify({
      newPromptBody: '请判定 {{text}} 属于 A 还是 B。',
      changeSummary: 'x',
      appliedTips: [],
      variablesUsed: ['text'],
      appliedChanges: [{ changeId: 'missing-change', patternIds: ['summary:p1'], summary: 'x' }],
    });
    const adapter = defaultAdapter({ generate: badResp });
    await expect(generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter))).rejects.toBeInstanceOf(
      InvalidAppliedChangeReferenceError,
    );
  });

  it('renders mixed-scope goals with observed values, gaps, and only relevant per-class slices', async () => {
    const adapter = defaultAdapter();
    const mixedGoals: OptimizationGoal[] = [
      { metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } },
      { metric: 'recall', op: '>=', value: 0.85, scope: { kind: 'class', label: 'positive' } },
      { metric: 'precision', op: '>=', value: 0.9, scope: { kind: 'class', label: 'negative' } },
      { metric: 'recall', op: '>=', value: 0.8, scope: { kind: 'class', label: 'negative' } },
    ];
    const mixedMetrics: MetricSnapshot = {
      overall: { accuracy: 0.72, precision: 0.7, recall: 0.74, f1: 0.72 },
      perClass: {
        positive: { precision: 0.8, recall: 0.65, f1: 0.72 },
        negative: { precision: 0.62, recall: 0.83, f1: 0.71 },
        neutral: { precision: 0.55, recall: 0.4, f1: 0.46 }, // User did not set a goal — must not appear
      },
    };
    await generateNextVersion(
      {
        ...commonGenArgs(),
        goals: mixedGoals,
        metrics: mixedMetrics,
      },
      makeInvokeLLMDependencies(adapter),
    );
    const call = adapter.callsFor('generate')[0]!;
    // Each goal on its own line + contains observed/gap/status
    expect(call.userPrompt).toContain('整体 的 `accuracy`：目标 `>= 0.9`');
    expect(call.userPrompt).toContain('当前实际 `0.7200`');
    expect(call.userPrompt).toContain('分类「positive」 的 `recall`：目标 `>= 0.85`');
    expect(call.userPrompt).toContain('当前实际 `0.6500`');
    expect(call.userPrompt).toContain('分类「negative」 的 `precision`：目标 `>= 0.9`');
    expect(call.userPrompt).toContain('当前实际 `0.6200`');
    // Scope-relevant metrics — only display overall + positive + negative; neutral must not appear
    expect(call.userPrompt).toContain('### 整体');
    expect(call.userPrompt).toContain('### 分类「positive」');
    expect(call.userPrompt).toContain('### 分类「negative」');
    expect(call.userPrompt).not.toContain('neutral');
    expect(call.userPrompt).not.toContain('0.46'); // neutral's f1 must not leak
  });

  it('marks already-achieved goals with ✅ in the goals-vs-actual table', async () => {
    const adapter = defaultAdapter();
    const goalsMostlyMet: OptimizationGoal[] = [
      { metric: 'accuracy', op: '>=', value: 0.6, scope: { kind: 'overall' } }, // 0.72 ≥ 0.6 ✅
      { metric: 'precision', op: '>=', value: 0.9, scope: { kind: 'overall' } }, // 0.7 ❌
    ];
    const m: MetricSnapshot = { overall: { accuracy: 0.72, precision: 0.7 } };
    await generateNextVersion(
      { ...commonGenArgs(), goals: goalsMostlyMet, metrics: m },
      makeInvokeLLMDependencies(adapter),
    );
    const call = adapter.callsFor('generate')[0]!;
    expect(call.userPrompt).toMatch(/`accuracy`.+✅ 已达成/);
    expect(call.userPrompt).toMatch(/`precision`.+❌ 未达成/);
  });

  it('handles "<=" op by reporting positive gap when observed is below target', async () => {
    const adapter = defaultAdapter();
    const goalsLE: OptimizationGoal[] = [
      { metric: 'false_positive_rate', op: '<=', value: 0.05, scope: { kind: 'overall' } },
    ];
    const m: MetricSnapshot = { overall: { false_positive_rate: 0.03 } }; // observed < target → achieved, gap=+0.02
    await generateNextVersion(
      { ...commonGenArgs(), goals: goalsLE, metrics: m },
      makeInvokeLLMDependencies(adapter),
    );
    const call = adapter.callsFor('generate')[0]!;
    expect(call.userPrompt).toContain('差距 `+0.0200`');
    expect(call.userPrompt).toContain('✅ 已达成');
  });

  it('truncates errorAnalysisText when it overflows generate budget', async () => {
    const adapter = defaultAdapter();
    const longAnalysis = '长摘要 '.repeat(20_000); // ~ tens of K tokens
    const result = await generateNextVersion(
      {
        ...commonGenArgs({ errorAnalysisText: longAnalysis }),
        strategyConfig: {
          ...DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
          maxInputTokensPerBatch: 3_000,
        },
      },
      makeInvokeLLMDependencies(adapter),
    );
    expect(result.budget.errorAnalysisTruncated).toBe(true);
    expect(result.budget.originalErrorAnalysisChars).toBe(longAnalysis.length);
    // Inside the generate user prompt, errorAnalysisText is truncated
    const call = adapter.callsFor('generate')[0]!;
    expect(call.userPrompt).toContain('…[truncated]');
  });

  it('truncates evidenceBundle by preserving high-priority high-impact suggestions first', async () => {
    const adapter = defaultAdapter();
    const args = commonGenArgs();
    args.analysis.evidenceBundle!.suggestedChanges = [
      args.analysis.evidenceBundle!.suggestedChanges[0]!,
      ...Array.from({ length: 20 }, (_, i) => ({
        changeId: `low:${i}`,
        section: '任务说明',
        change: `低优先级建议 ${i} ${'x'.repeat(1600)}`,
        rationale: '低优先级长文本',
        addressesPatternIds: ['summary:p1'],
        evidenceSampleIds: ['s2'],
        affectedCount: 1,
        priority: 'low' as const,
      })),
    ];
    const result = await generateNextVersion(
      {
        ...args,
        strategyConfig: {
          ...DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
          maxInputTokensPerBatch: 3_000,
        },
      },
      makeInvokeLLMDependencies(adapter),
    );
    const call = adapter.callsFor('generate')[0]!;
    expect(result.budget.evidenceBundleTruncated).toBe(true);
    expect(call.userPrompt).toContain('"changeId": "summary:c1"');
    expect(call.userPrompt).not.toContain('"changeId": "low:19"');
  });

  it('does NOT truncate errorAnalysisText when within budget', async () => {
    const adapter = defaultAdapter();
    const result = await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    expect(result.budget.errorAnalysisTruncated).toBe(false);
  });

  it('renders "（缺失）" when the goal metric is absent from current metrics', async () => {
    const adapter = defaultAdapter();
    const goalsMissing: OptimizationGoal[] = [
      { metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } },
    ];
    const m: MetricSnapshot = { overall: { f1: 0.5 } }; // accuracy is missing
    await generateNextVersion(
      { ...commonGenArgs(), goals: goalsMissing, metrics: m },
      makeInvokeLLMDependencies(adapter),
    );
    const call = adapter.callsFor('generate')[0]!;
    expect(call.userPrompt).toContain('当前实际 `（缺失）`');
    expect(call.userPrompt).toContain('差距 `?`');
    expect(call.userPrompt).toContain('❌ 未达成');
  });

  it('throws InvalidVariableUsageError when new prompt uses disallowed variables', async () => {
    const badResp = JSON.stringify({
      newPromptBody: '用 {{text}} 和 {{secret_id}} 一起判断',
      changeSummary: 'x',
      appliedTips: [],
      variablesUsed: ['text', 'secret_id'],
    });
    const adapter = defaultAdapter({ generate: badResp });
    await expect(generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter))).rejects.toBeInstanceOf(
      InvalidVariableUsageError,
    );
  });

  it('retries once and succeeds when first response drops a required base variable', async () => {
    // First-time placeholder lost → feedback to LLM → second call restores {{text}} → success, retries=1, autoPatched=false
    const droppingResp = JSON.stringify({
      newPromptBody: '请综合判断评论的整体情感倾向。无任何变量占位的整段重写。',
      changeSummary: 'x',
      appliedTips: [],
      variablesUsed: ['text'],
    });
    const recoveredResp = JSON.stringify({
      newPromptBody: '请仔细判定输入 {{text}} 属于 A 还是 B。B 的特征：…',
      changeSummary: '补回 {{text}} 占位并加强 B 的判定特征',
      appliedTips: ['术语 / 类别明确化'],
      variablesUsed: ['text'],
    });
    const adapter = defaultAdapter({ generate: [droppingResp, recoveredResp] });
    const result = await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    expect(result.retries).toBe(1);
    expect(result.autoPatched).toBe(false);
    expect(result.patchedVariables).toEqual([]);
    expect(result.newPromptBody).toContain('{{text}}');
    // On the second call, the last user message in messages must contain the retry feedback section (FakeLLMAdapter.userPrompt picks the first user message; retry feedback is the appended last one)
    const retryMessages = adapter.callsFor('generate')[1]!.messages!;
    const userMsgs = retryMessages.filter((m) => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1]!;
    const lastUserContent = typeof lastUser.content === 'string' ? lastUser.content : '';
    expect(lastUserContent).toContain('上一轮 newPromptBody 违反硬约束 #1');
    expect(lastUserContent).toContain('`{{text}}`');
  });

  it('auto-patches when LLM keeps dropping required variable across all retries', async () => {
    // 3 consecutive calls (initial + 2 retries) all miss the placeholder → fall back to the system patch; retries=2, autoPatched=true
    const droppingResp = JSON.stringify({
      newPromptBody: '请综合判断评论的整体情感倾向。无任何变量占位的整段重写。',
      changeSummary: 'x',
      appliedTips: [],
      variablesUsed: ['text'],
    });
    const adapter = defaultAdapter({ generate: [droppingResp, droppingResp, droppingResp] });
    const result = await generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter));
    expect(result.retries).toBe(2);
    expect(result.autoPatched).toBe(true);
    expect(result.patchedVariables).toEqual(['text']);
    expect(result.newPromptBody).toContain('{{text}}');
    expect(result.newPromptBody).toContain('系统自动补丁');
    expect(adapter.callsFor('generate')).toHaveLength(3);
  });

  it('throws InvalidVariableUsageError immediately on disallowed variable (no retry)', async () => {
    // LLM output contains a variable outside the whitelist → business-side field config error; retries cannot save it → fatal immediately
    const badResp = JSON.stringify({
      newPromptBody: '判断 {{secret_id}} 的情感。',
      changeSummary: 'x',
      appliedTips: [],
      variablesUsed: ['secret_id'],
    });
    const adapter = defaultAdapter({ generate: [badResp, badResp, badResp] });
    await expect(
      generateNextVersion(commonGenArgs(), makeInvokeLLMDependencies(adapter)),
    ).rejects.toMatchObject({
      name: 'InvalidVariableUsageError',
      disallowedVariables: ['secret_id'],
    });
    // Confirm only 1 call was made (disallowed does not go through retries)
    expect(adapter.callsFor('generate')).toHaveLength(1);
  });
});

describe('optimization run_results 持久化(SPEC 25 §11.2)', () => {
  const runResultMeta = {
    projectId: '00000000-0000-4000-8000-000000000001',
    sourceId: '00000000-0000-4000-8000-0000000000a1',
    promptVersionId: 'pv_001',
    modelId: 'model_analysis_001',
    dbosWorkflowId: 'wf-abc',
    bullmqJobId: null,
    attempt: 0,
  } as const;

  function analyzeArgsWithMeta() {
    return {
      optimizationId: runResultMeta.sourceId,
      roundNumber: 2,
      analysisModel: makeAnalysisModel(),
      analysisLimiterKey: 'test:analysis-model',
      currentVersion,
      samples,
      currentRunResults,
      previousRunResults,
      metrics,
      goals,
      fieldWhitelist,
      strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
      runResultMeta,
      analysisRunResultId: '11111111-2222-4333-8444-555555555555',
    };
  }

  it('analyzeFailures: 仅 summarize 写一行 optimization_analysis (confusion/regression 不写)', async () => {
    const adapter = defaultAdapter();
    const writer = new RecordingRunResultWriter();
    await analyzeFailures(analyzeArgsWithMeta(), makeInvokeLLMDependencies(adapter, writer));
    expect(writer.records).toHaveLength(1);
    expect(writer.records[0]).toMatchObject({
      id: '11111111-2222-4333-8444-555555555555',
      source: 'optimization_analysis',
      sourceId: runResultMeta.sourceId,
      projectId: runResultMeta.projectId,
      promptVersionId: runResultMeta.promptVersionId,
      modelId: runResultMeta.modelId,
      dbosWorkflowId: runResultMeta.dbosWorkflowId,
      status: 'success',
    });
    // parsed_output contains errorPatterns / suggestedChanges, fed to the frontend detail page (SPEC 25 §11.3)
    const parsed = writer.records[0]!.parsedOutput as Record<string, unknown> | null;
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveProperty('errorPatterns');
    expect(parsed).toHaveProperty('suggestedChanges');
    expect(parsed).toHaveProperty('evidenceBundle');
  });

  it('analyzeFailures: 不传 runResultMeta 时 writer 完全不被调用 (向后兼容)', async () => {
    const adapter = defaultAdapter();
    const writer = new RecordingRunResultWriter();
    const { runResultMeta: _m, analysisRunResultId: _id, ...argsNoMeta } = analyzeArgsWithMeta();
    await analyzeFailures(argsNoMeta, makeInvokeLLMDependencies(adapter, writer));
    expect(writer.records).toHaveLength(0);
  });

  it('generateNextVersion: 写一行 optimization_generate, parsed_output 含 newPromptBody', async () => {
    const adapter = defaultAdapter();
    const writer = new RecordingRunResultWriter();
    await generateNextVersion(
      {
        optimizationId: runResultMeta.sourceId,
        roundNumber: 2,
        analysisModel: makeAnalysisModel(),
        analysisLimiterKey: 'test:analysis-model',
        currentVersion,
        analysis: {
          errorAnalysisText: '## 错误模式\n1. B→A',
          summary: {
            summary: '占位',
            errorPatterns: [],
            suggestedChanges: [],
            conflicts: [],
            evidenceBundleVersion: 1,
            truncated: false,
            rawContent: '',
          },
          batches: [],
          confusionPairs: [],
          regressionGroups: [],
          truncated: false,
          totalConfusionFailures: 0,
          totalRegressionSamples: 0,
        },
        metrics,
        goals,
        fieldWhitelist,
        strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
        runResultMeta,
        generateRunResultId: '22222222-3333-4444-8555-666666666666',
      },
      makeInvokeLLMDependencies(adapter, writer),
    );
    expect(writer.records).toHaveLength(1);
    expect(writer.records[0]).toMatchObject({
      id: '22222222-3333-4444-8555-666666666666',
      source: 'optimization_generate',
      sourceId: runResultMeta.sourceId,
      status: 'success',
    });
    const parsed = writer.records[0]!.parsedOutput as Record<string, unknown> | null;
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveProperty('newPromptBody');
  });
});
