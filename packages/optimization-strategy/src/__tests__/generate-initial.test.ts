// Unit tests for from_dataset_only first-version generation — see docs/specs/25-optimizations.md §2.1
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG } from '../error-pattern-analysis/config.schema';
import {
  FirstVersionParseError,
  generateInitialVersion,
} from '../error-pattern-analysis/generate-initial';
import type { OptimizationGoal, FieldWhitelist } from '../loop/types';
import {
  createFakeAdapter,
  makeAnalysisModel,
  makeInvokeLLMDependencies,
  RecordingRunResultWriter,
} from './helpers/fake-invoke-deps';

const goals: OptimizationGoal[] = [
  { metric: 'accuracy', op: '>=', value: 0.8, scope: { kind: 'overall' } },
];

const samples = [
  { id: 's1', data: { text: 'Great product', label: 'positive' } },
  { id: 's2', data: { text: 'Refund please', label: 'negative' } },
  { id: 's3', data: { text: 'Five stars', label: 'positive' } },
];

const fieldWhitelist: FieldWhitelist = {
  promptVariables: ['text'],
  analysisOnlyFields: ['label'],
};

const validResponse = JSON.stringify({
  newPromptBody: '把输入 {{text}} 分类为 positive 或 negative。',
  variables: [{ name: 'text', type: 'text', required: true }],
  outputSchema: { fields: [{ key: 'decision', isJudgment: true, value: '' }] },
  changeSummary: '基于 3 条样本归纳出二分类业务',
});

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

describe('generateInitialVersion (SPEC 25 §2.1)', () => {
  it('parses a valid LLM response into prompt body / variables / outputSchema', async () => {
    const adapter = createFakeAdapter({ generateInitial: { content: validResponse } });
    const writer = new RecordingRunResultWriter();
    const limiter = recordingLimiter();
    const deps = {
      ...makeInvokeLLMDependencies(adapter, writer),
      limiter: limiter.limiter,
    };

    const result = await generateInitialVersion(
      {
        optimizationId: 'a1111111-1111-4111-8111-111111111111',
        analysisModel: makeAnalysisModel(),
        analysisLimiterKey: 'test:analysis-model',
        samples,
        goals,
        fieldWhitelist,
        description: '客户反馈情感二分类',
        strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
      },
      deps,
    );

    expect(result.newPromptBody).toContain('{{text}}');
    expect(result.variables).toEqual([{ name: 'text', type: 'text', required: true }]);
    expect(result.outputSchema).toEqual({ fields: [{ key: 'decision', isJudgment: true, value: '' }] });
    expect(result.changeSummary).toContain('归纳');
    expect(limiter.acquiredKeys).toEqual(['test:analysis-model']);
  });

  it('writes a run_result row when runResultMeta + generateRunResultId provided', async () => {
    const adapter = createFakeAdapter({ generateInitial: { content: validResponse } });
    const writer = new RecordingRunResultWriter();
    const deps = makeInvokeLLMDependencies(adapter, writer);

    await generateInitialVersion(
      {
        optimizationId: 'a1111111-1111-4111-8111-111111111111',
        analysisModel: makeAnalysisModel(),
        analysisLimiterKey: 'test:analysis-model',
        samples,
        goals,
        fieldWhitelist,
        description: null,
        strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
        runResultMeta: {
          projectId: 'p1111111-1111-4111-8111-111111111111',
          sourceId: 'a1111111-1111-4111-8111-111111111111',
          promptVersionId: 'v1111111-1111-4111-8111-111111111111',
          modelId: 'm1111111-1111-4111-8111-111111111111',
        },
        generateRunResultId: 'r1111111-1111-4111-8111-111111111111',
      },
      deps,
    );

    expect(writer.records).toHaveLength(1);
    expect(writer.records[0]?.source).toBe('optimization_generate');
    expect(writer.records[0]?.roundIndex).toBe(0);
    expect(writer.records[0]?.id).toBe('r1111111-1111-4111-8111-111111111111');
  });

  it('tolerates raw newlines in newPromptBody string literal (Claude-style non-strict JSON)', async () => {
    // Real production error reproduction: when Claude opus 4.7 outputs a multi-line newPromptBody inside a ```json``` code block,
    // it uses real newlines instead of \n escapes, causing strict JSON.parse to fail. With safeParseJson's built-in jsonrepair fallback,
    // this path should parse the complete fields successfully.
    const brokenResponse = `\`\`\`json
{
  "newPromptBody": "你是中文情感分析专家。

## 任务
基于 {{text}} 判定情感倾向。

## 输出
positive 或 negative。",
  "variables": [{"name": "text", "type": "text", "required": true}],
  "outputSchema": {"fields": [{"key": "sentiment", "value": "positive | negative", "isJudgment": true}]},
  "changeSummary": "从样本归纳出中文二分类情感任务,使用 {{text}} 占位接入业务模型。"
}
\`\`\``;
    const adapter = createFakeAdapter({ generateInitial: { content: brokenResponse } });
    const deps = makeInvokeLLMDependencies(adapter);

    const result = await generateInitialVersion(
      {
        optimizationId: 'a1111111-1111-4111-8111-111111111111',
        analysisModel: makeAnalysisModel(),
        analysisLimiterKey: 'test:analysis-model',
        samples,
        goals,
        fieldWhitelist,
        description: '中文情感二分类',
        strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
      },
      deps,
    );

    expect(result.newPromptBody).toContain('{{text}}');
    expect(result.newPromptBody).toContain('## 任务');
    expect(result.outputSchema.fields).toHaveLength(1);
    expect(result.outputSchema.fields[0]?.isJudgment).toBe(true);
    expect(result.changeSummary).toContain('二分类');
  });

  it('throws FirstVersionParseError when JSON is missing', async () => {
    const adapter = createFakeAdapter({
      generateInitial: { content: 'this is not json at all' },
    });
    const deps = makeInvokeLLMDependencies(adapter);

    await expect(
      generateInitialVersion(
        {
          optimizationId: 'a1111111-1111-4111-8111-111111111111',
          analysisModel: makeAnalysisModel(),
          analysisLimiterKey: 'test:analysis-model',
          samples,
          goals,
          fieldWhitelist,
          description: null,
          strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(FirstVersionParseError);
  });

  it('throws FirstVersionParseError when newPromptBody uses disallowed variables', async () => {
    const adapter = createFakeAdapter({
      generateInitial: {
        content: JSON.stringify({
          newPromptBody: '把 {{label}} 当成 prompt 变量', // label is in analysisOnlyFields, not in promptVariables
          variables: [],
          outputSchema: { fields: [{ key: 'decision', isJudgment: true }] },
          changeSummary: 'x',
        }),
      },
    });
    const deps = makeInvokeLLMDependencies(adapter);

    await expect(
      generateInitialVersion(
        {
          optimizationId: 'a1111111-1111-4111-8111-111111111111',
          analysisModel: makeAnalysisModel(),
          analysisLimiterKey: 'test:analysis-model',
          samples,
          goals,
          fieldWhitelist,
          description: null,
          strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(FirstVersionParseError);
  });

  it('throws FirstVersionParseError when newPromptBody uses no placeholder despite non-empty whitelist', async () => {
    const adapter = createFakeAdapter({
      generateInitial: {
        content: JSON.stringify({
          newPromptBody: '请分类这段文本（占位符忘了）',
          variables: [],
          outputSchema: { fields: [{ key: 'decision', isJudgment: true }] },
          changeSummary: 'x',
        }),
      },
    });
    const deps = makeInvokeLLMDependencies(adapter);

    await expect(
      generateInitialVersion(
        {
          optimizationId: 'a1111111-1111-4111-8111-111111111111',
          analysisModel: makeAnalysisModel(),
          analysisLimiterKey: 'test:analysis-model',
          samples,
          goals,
          fieldWhitelist,
          description: null,
          strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(FirstVersionParseError);
  });

  it('throws FirstVersionParseError when outputSchema has no isJudgment field', async () => {
    const adapter = createFakeAdapter({
      generateInitial: {
        content: JSON.stringify({
          newPromptBody: '分类 {{text}}',
          variables: [],
          outputSchema: { fields: [{ key: 'note', isJudgment: false }] },
          changeSummary: 'x',
        }),
      },
    });
    const deps = makeInvokeLLMDependencies(adapter);

    await expect(
      generateInitialVersion(
        {
          optimizationId: 'a1111111-1111-4111-8111-111111111111',
          analysisModel: makeAnalysisModel(),
          analysisLimiterKey: 'test:analysis-model',
          samples,
          goals,
          fieldWhitelist,
          description: null,
          strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(FirstVersionParseError);
  });

  it('includes the user-provided description verbatim in the LLM user prompt', async () => {
    const adapter = createFakeAdapter({ generateInitial: { content: validResponse } });
    const deps = makeInvokeLLMDependencies(adapter);

    await generateInitialVersion(
      {
        optimizationId: 'a1111111-1111-4111-8111-111111111111',
        analysisModel: makeAnalysisModel(),
        analysisLimiterKey: 'test:analysis-model',
        samples,
        goals,
        fieldWhitelist,
        description: '客户反馈情感二分类(positive/negative)',
        strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
      },
      deps,
    );

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.userPrompt).toContain('客户反馈情感二分类(positive/negative)');
  });

  it('includes the user-provided prompt generation guidance in the LLM user prompt', async () => {
    const adapter = createFakeAdapter({ generateInitial: { content: validResponse } });
    const deps = makeInvokeLLMDependencies(adapter);

    await generateInitialVersion(
      {
        optimizationId: 'a1111111-1111-4111-8111-111111111111',
        analysisModel: makeAnalysisModel(),
        analysisLimiterKey: 'test:analysis-model',
        samples,
        goals,
        fieldWhitelist,
        description: null,
        optimizationHint: '保持首版提示词简洁，重点区分退款请求。',
        strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
      },
      deps,
    );

    expect(adapter.calls[0]?.userPrompt).toContain('用户给的提示词生成指引');
    expect(adapter.calls[0]?.userPrompt).toContain('保持首版提示词简洁，重点区分退款请求。');
  });

  it('falls back to a placeholder description when none provided', async () => {
    const adapter = createFakeAdapter({ generateInitial: { content: validResponse } });
    const deps = makeInvokeLLMDependencies(adapter);

    await generateInitialVersion(
      {
        optimizationId: 'a1111111-1111-4111-8111-111111111111',
        analysisModel: makeAnalysisModel(),
        analysisLimiterKey: 'test:analysis-model',
        samples,
        goals,
        fieldWhitelist,
        description: null,
        strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
      },
      deps,
    );

    expect(adapter.calls[0]?.userPrompt).toContain('用户未提供任务描述');
  });
});
