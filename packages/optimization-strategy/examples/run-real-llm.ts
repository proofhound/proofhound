// Real LLM end-to-end smoke (manual run; not in CI)
//
// Trigger:
//   RUN_REAL_LLM=1 ANTHROPIC_API_KEY=sk-ant-xxx \
//     pnpm --filter @proofhound/optimization-strategy example:real-llm
//
// Behavior: hardcoded 10 binary classification samples + accuracy=0.5 baseline; runs 3 rounds (goal intentionally set high),
// using a real Anthropic model as the analysis LLM; ExperimentRunner uses a mock metric curve
// ([0.6, 0.75, 0.88]) instead of running real experiments, because this algorithm package is unaware of "experiment execution".
//
// Output: each round's error analysis summary + the generated new prompt + the final OptimizationResult JSON.

import { StubLimiter } from '@proofhound/limiter';
import type { LLMCallLogger } from '@proofhound/llm-client';
import { DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG } from '../src/error-pattern-analysis/config.schema';
import { runIterationLoop } from '../src/loop/run-iteration-loop';
import type {
  OptimizationConfig,
  ExperimentRunnerInput,
  ExperimentRunnerOutput,
  ExperimentSnapshot,
  LoopDependencies,
  RunResultRecord,
  SampleRecord,
} from '../src/loop/types';
import {
  InMemoryExperimentRunner,
  makeInMemoryPorts,
} from '../src/__tests__/helpers/in-memory-ports';
import type { ErrorPatternAnalysisConfig } from '../src/error-pattern-analysis/config.schema';

function main(): Promise<void> {
  if (process.env.RUN_REAL_LLM !== '1') {
    console.log('[run-real-llm] RUN_REAL_LLM!=1, skipping.');
    process.exit(0);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[run-real-llm] ANTHROPIC_API_KEY required.');
    process.exit(1);
  }

  const samples: SampleRecord[] = [
    { id: 's1', input: { text: '这个产品质量很好，强烈推荐！' }, expected: 'positive' },
    { id: 's2', input: { text: '太垃圾了，浪费钱。' }, expected: 'negative' },
    { id: 's3', input: { text: '还行吧，没什么特别的。' }, expected: 'negative' },
    { id: 's4', input: { text: '超出预期，非常满意。' }, expected: 'positive' },
    { id: 's5', input: { text: '一般般，不会再买。' }, expected: 'negative' },
    { id: 's6', input: { text: '完美！五星好评！' }, expected: 'positive' },
    { id: 's7', input: { text: '收到货就坏了，很失望。' }, expected: 'negative' },
    { id: 's8', input: { text: '物美价廉，回购了。' }, expected: 'positive' },
    { id: 's9', input: { text: '说明书写得乱七八糟。' }, expected: 'negative' },
    { id: 's10', input: { text: '解决了我的问题，谢谢！' }, expected: 'positive' },
  ];

  const initialRunResults: RunResultRecord[] = samples.map((s, i) => ({
    id: `rr_init_${i}`,
    sampleId: s.id,
    decisionOutput: 'positive',
    parsedOutput: { sentiment: 'positive' },
    isCorrect: s.expected === 'positive', // Model always guesses positive → accuracy=0.5
  }));

  const snapshot: ExperimentSnapshot = {
    projectId: 'demo_proj',
    projectType: 'classification',
    sourceExperimentId: 'demo_exp_source',
    dataset: { id: 'demo_ds', samples },
    taskModel: {
      id: 'demo_task_model',
      providerType: 'anthropic',
      providerModelId: 'claude-3-5-haiku-latest',
      endpoint: 'https://api.anthropic.com',
      apiKey,
      rpmLimit: 60,
      tpmLimit: 100_000,
      concurrencyLimit: 5,
      autoConcurrency: false,
      inputTokenPricePerMillion: 1,
      outputTokenPricePerMillion: 5,
    },
    judgmentRules: { ruleName: 'enum_match', config: { field: 'sentiment' } },
    basePromptVersion: {
      id: 'demo_pv_base',
      promptId: 'demo_p',
      versionNumber: 1,
      body: '请判断这段评论 {{text}} 的情感是 positive 还是 negative。',
      outputSchema: { type: 'object', properties: { sentiment: { enum: ['positive', 'negative'] } } },
      judgmentRules: { ruleName: 'enum_match', config: { field: 'sentiment' } },
      variables: [{ name: 'text', description: '用户评论文本' }],
    },
    lastRunResults: initialRunResults,
    lastMetrics: { overall: { accuracy: 0.5 } },
  };

  const config: OptimizationConfig<ErrorPatternAnalysisConfig> = {
    optimizationId: 'demo_ai',
    goals: [{ metric: 'accuracy', op: '>=', value: 0.99, scope: { kind: 'overall' } }],
    maxRounds: 3,
    fieldWhitelist: {
      promptVariables: ['text'],
      analysisOnlyFields: [],
      modifiableSections: ['任务说明', '示例区'],
    },
    optimizationHint: '请保持简短，目标是中文情感分析。',
    analysisModel: {
      id: 'demo_analysis_model',
      providerType: 'anthropic',
      providerModelId: 'claude-3-5-sonnet-latest',
      endpoint: 'https://api.anthropic.com',
      apiKey,
      rpmLimit: 60,
      tpmLimit: 100_000,
      concurrencyLimit: 5,
      autoConcurrency: false,
      inputTokenPricePerMillion: 3,
      outputTokenPricePerMillion: 15,
    },
    analysisLimiterKey: 'model:demo_analysis_model',
    taskModel: snapshot.taskModel,
    strategyKey: 'error_pattern_analysis',
    strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
  };

  // ExperimentRunner uses a preset curve — real experiment execution lives outside this algorithm package
  const curve = [0.6, 0.75, 0.88];
  const runner = new InMemoryExperimentRunner(
    curve.map((accuracy, i) => (input: ExperimentRunnerInput): ExperimentRunnerOutput => {
      console.log(`\n[round ${input.roundNumber}] running pseudo-experiment with version=${input.versionId} → mocked accuracy=${accuracy}`);
      const correctCount = Math.round(accuracy * samples.length);
      const runResults: RunResultRecord[] = samples.map((s, idx) => {
        const expected = String(s.expected);
        const decisionOutput: string = idx < correctCount ? expected : expected === 'positive' ? 'negative' : 'positive';
        return {
          id: `rr_${i + 1}_${idx}`,
          sampleId: s.id,
          decisionOutput,
          parsedOutput: {},
          isCorrect: idx < correctCount,
        };
      });
      return {
        experimentId: `demo_exp_${i + 1}`,
        metrics: { overall: { accuracy } },
        runResults,
      };
    }),
  );

  const ports = makeInMemoryPorts({ runner });
  const logger: LLMCallLogger = {
    info: (payload, msg) => console.log(`[llm:info] ${msg}`, JSON.stringify({ stepName: payload.stepName, durationMs: payload.durationMs, costEstimate: payload.costEstimate })),
    error: (payload, msg) => console.error(`[llm:error] ${msg}`, JSON.stringify(payload)),
  };
  // Do not pass llmAdapter → invokeLLM goes through the default adapter per providerType='anthropic'
  const deps: LoopDependencies = {
    limiter: new StubLimiter(),
    logger,
  };

  return runIterationLoop(config, snapshot, ports, deps).then((result) => {
    console.log('\n=== Final OptimizationResult ===');
    console.log(JSON.stringify(result, null, 2));
    for (const round of ports.roundRecorder.rounds) {
      console.log(`\n=== Round ${round.roundNumber} ===`);
      console.log(`accuracy=${round.metrics.overall.accuracy} isBest=${round.isBest}`);
      console.log('--- error analysis ---');
      console.log(round.errorAnalysis.slice(0, 500));
      console.log('--- change summary ---');
      console.log(round.changeSummary.slice(0, 500));
    }
  });
}

main().catch((err) => {
  console.error('[run-real-llm] fatal:', err);
  process.exit(1);
});
