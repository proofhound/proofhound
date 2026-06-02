/* eslint-disable no-console -- integration tests use console.log to print LLM I/O for manual observation */
// Real LLM integration test — 1-round optimization closed-loop smoke
//
// Trigger: enabled when MODEL_PROBE_API_KEY is present; otherwise skipped automatically.
// MODEL_PROBE_PROVIDER_TYPE defaults to openai; openai / anthropic derive endpoint + model defaults.
//
// Reuses the project's MODEL_PROBE_* series (same convention as apps/worker/src/scripts/probe-model-from-env.ts),
// so the same .env can run both model connectivity probes and this integration test.
//
// How to run:
//   pnpm --filter @proofhound/optimization-strategy test:integration
//
// This test simulates the "already-have-an-experiment" start:
// - 10 binary classification dataset rows (5 positive / 5 negative) — shape aligned with ph_assets.dataset_samples.data (jsonb)
// - Minimal first-version prompt "Judge the sentiment of {{review_text}}"
// - Previous round fake failed predictions: model always guesses positive → accuracy=0.5; confusion pair negative→positive=5
// - previousRunResults=null → skip regression analysis
// - maxRounds=1: 1 round (1 confusion + 1 summarize + 1 generate = 3 real LLM calls)
// - ExperimentRunner uses a mock to return metrics (this algorithm package is unaware of experiment execution)
//
// Assert + print: the path works + the new prompt contains variable placeholders + LLM I/O per stage is printed to the console for manual observation.
// Specifically prints the "generated pure body", "auto-assembled output format section", and "composed full prompt"
// to make it easy to manually verify: the generated body does not include the output format / JSON schema; the output format section is auto-assembled from outputSchema.
import { resolve } from 'node:path';
import { StubLimiter } from '@proofhound/limiter';
import type { LLMCallLogger, ModelInvocationConfig } from '@proofhound/llm-client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG } from '../error-pattern-analysis/config.schema';
import { runIterationLoop } from '../loop/run-iteration-loop';
import type {
  OptimizationConfig,
  ExperimentSnapshot,
  LoopDependencies,
  MetricSnapshot,
  RunResultRecord,
  SampleRecord,
} from '../loop/types';
import type { ErrorPatternAnalysisConfig } from '../error-pattern-analysis/config.schema';
import { buildOutputFormatInstruction, composeFullPrompt } from '@proofhound/shared';
import { InMemoryExperimentRunner, makeInMemoryPorts } from './helpers/in-memory-ports';

// ---------- env loading (compatible with cwd and monorepo root) ----------
function loadEnvFile(): void {
  for (const candidate of [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../../../.env'),
  ]) {
    try {
      // Node.js 21+ native API; project engines.node 24.x
      process.loadEnvFile(candidate);
      return;
    } catch {
      // Look up the next
    }
  }
}

loadEnvFile();

const PROBE_PROTOCOL_DEFAULTS = {
  openai: {
    providerModelId: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1',
  },
  anthropic: {
    providerModelId: 'claude-sonnet-4-6',
    endpoint: 'https://api.anthropic.com',
  },
} as const;

const REQUIRED = ['MODEL_PROBE_API_KEY'];

const hasEnv = REQUIRED.every((k) => {
  const v = process.env[k];
  return typeof v === 'string' && v.trim().length > 0;
});

const describeIf = hasEnv ? describe : describe.skip;

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function normalizeProviderType(providerType: string): string {
  return providerType.trim().toLowerCase().replace(/_/gu, '-');
}

function modelFromEnv(): ModelInvocationConfig {
  const providerType = normalizeProviderType(readOptionalEnv('MODEL_PROBE_PROVIDER_TYPE') ?? 'openai');
  const defaults = PROBE_PROTOCOL_DEFAULTS[providerType as keyof typeof PROBE_PROTOCOL_DEFAULTS];
  const providerModelId = readOptionalEnv('MODEL_PROBE_MODEL_ID') ?? defaults?.providerModelId;
  const endpoint = readOptionalEnv('MODEL_PROBE_ENDPOINT') ?? defaults?.endpoint;

  if (!providerModelId) throw new Error(`MODEL_PROBE_MODEL_ID is required for provider type "${providerType}"`);
  if (!endpoint) throw new Error(`MODEL_PROBE_ENDPOINT is required for provider type "${providerType}"`);

  return {
    id: 'model_integration_probe',
    providerType,
    providerModelId,
    endpoint,
    apiKey: process.env['MODEL_PROBE_API_KEY']!,
    rpmLimit: Number(process.env['MODEL_PROBE_RPM_LIMIT'] ?? 60),
    tpmLimit: Number(process.env['MODEL_PROBE_TPM_LIMIT'] ?? 100_000),
    concurrencyLimit: Number(process.env['MODEL_PROBE_CONCURRENCY_LIMIT'] ?? 1),
    inputTokenPricePerMillion: Number(process.env['MODEL_PROBE_INPUT_PRICE_PER_MILLION'] ?? 0),
    outputTokenPricePerMillion: Number(process.env['MODEL_PROBE_OUTPUT_PRICE_PER_MILLION'] ?? 0),
  };
}

// ---------- mock dataset (close to the real shape of ph_assets.dataset_samples) ----------
// The data jsonb field → our SampleRecord.input; expected is the V1 simplified version where the "expected value" is extracted from data by judgment_rules.field
const samples: SampleRecord[] = [
  { id: 's1', input: { review_text: '这个产品非常棒，强烈推荐！' }, expected: 'positive' },
  { id: 's2', input: { review_text: '完美，超出预期，非常满意' }, expected: 'positive' },
  { id: 's3', input: { review_text: '物美价廉，下次还会购买' }, expected: 'positive' },
  { id: 's4', input: { review_text: '解决了我的问题，谢谢' }, expected: 'positive' },
  { id: 's5', input: { review_text: '五星好评！服务也很好' }, expected: 'positive' },
  { id: 's6', input: { review_text: '太垃圾了，浪费钱' }, expected: 'negative' },
  { id: 's7', input: { review_text: '收到货就坏了，很失望' }, expected: 'negative' },
  { id: 's8', input: { review_text: '说明书写得乱七八糟' }, expected: 'negative' },
  { id: 's9', input: { review_text: '差评，不会再买了' }, expected: 'negative' },
  { id: 's10', input: { review_text: '客服态度很差，一星' }, expected: 'negative' },
];

// Previous round fake failure: model always guesses positive → 5 negatives are all wrong (confusion pair negative→positive=5)
const fakeBadRunResults: RunResultRecord[] = samples.map((s) => ({
  id: `rr_${s.id}`,
  sampleId: s.id,
  decisionOutput: 'positive',
  parsedOutput: { sentiment: 'positive' },
  isCorrect: s.expected === 'positive',
}));

const lastMetrics: MetricSnapshot = {
  overall: { accuracy: 0.5, precision: 0.5, recall: 1.0, f1: 0.6667 },
  perClass: {
    positive: { precision: 0.5, recall: 1.0, f1: 0.6667 },
    negative: { precision: 0, recall: 0, f1: 0 },
  },
};

function makeSnapshot(taskModel: ModelInvocationConfig): ExperimentSnapshot {
  return {
    projectId: 'integration_proj',
    projectType: 'classification',
    sourceExperimentId: 'integration_exp_source',
    dataset: { id: 'integration_ds', samples },
    taskModel,
    judgmentRules: { ruleName: 'enum_match', config: { field: 'sentiment' } },
    basePromptVersion: {
      id: 'integration_pv_base',
      promptId: 'integration_p',
      versionNumber: 1,
      body: '判断 {{review_text}} 的情感', // Minimal first version
      outputSchema: { type: 'object', properties: { sentiment: { enum: ['positive', 'negative'] } } },
      judgmentRules: { ruleName: 'enum_match', config: { field: 'sentiment' } },
      variables: [{ name: 'review_text', description: '用户评论原文' }],
    },
    lastRunResults: fakeBadRunResults,
    lastMetrics,
  };
}

function makeConfig(model: ModelInvocationConfig): OptimizationConfig<ErrorPatternAnalysisConfig> {
  return {
    optimizationId: 'integration_ai',
    goals: [
      // Overall accuracy goal set high — 1 round cannot reach it (ensures exit via max_rounds, not early success)
      { metric: 'accuracy', op: '>=', value: 0.95, scope: { kind: 'overall' } },
      // Also care about the negative class (current precision=0, recall=0, largest gap)
      { metric: 'recall', op: '>=', value: 0.9, scope: { kind: 'class', label: 'negative' } },
    ],
    maxRounds: 1,
    fieldWhitelist: {
      promptVariables: ['review_text'],
      analysisOnlyFields: [],
      modifiableSections: ['任务说明', '示例区', '判定边界'],
    },
    optimizationHint: '请聚焦在如何让模型识别 negative 情感的关键词',
    analysisModel: model,
    taskModel: model,
    strategyKey: 'error_pattern_analysis',
    strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
  };
}

function makeConsoleLogger(): LLMCallLogger {
  return {
    info: (payload, msg) => {
      // Care about stepName + durationMs; payload's promptCapped is auto-redacted by invokeLLM, safe
      const lite = {
        stepName: (payload as Record<string, unknown>).stepName,
        durationMs: (payload as Record<string, unknown>).durationMs,
        costEstimate: (payload as Record<string, unknown>).costEstimate,
        inputTokens: (payload as Record<string, unknown>).inputTokens,
        outputTokens: (payload as Record<string, unknown>).outputTokens,
      };
      console.log(`[llm:info] ${msg}`, JSON.stringify(lite));
    },
    error: (payload, msg) => {
      console.error(`[llm:error] ${msg}`, JSON.stringify(payload));
    },
  };
}

describeIf('runIterationLoop · real LLM integration', () => {
  it(
    'runs 1 round end-to-end (confusion + summarize + generate) and produces a valid improved prompt',
    async () => {
      const model = modelFromEnv();
      console.log(
        '\n=== Integration test starting ===',
        JSON.stringify({
          providerType: model.providerType,
          providerModelId: model.providerModelId,
          endpoint: model.endpoint,
        }),
      );

      const snapshot = makeSnapshot(model);
      const config = makeConfig(model);

      // ExperimentRunner uses a mock — does not actually call the LLM to run the experiment (this algorithm package is unaware of "experiment execution").
      // Make the round-1 experiment return slightly improved metrics, still not at goal (to trigger max_rounds end).
      const runner = new InMemoryExperimentRunner([
        {
          experimentId: 'integration_exp_r1',
          metrics: {
            overall: { accuracy: 0.7, precision: 0.7, recall: 0.7, f1: 0.7 },
            perClass: {
              positive: { precision: 0.7, recall: 0.8, f1: 0.75 },
              negative: { precision: 0.7, recall: 0.6, f1: 0.65 },
            },
          },
          runResults: samples.map((s, i) => ({
            id: `rr_r1_${s.id}`,
            sampleId: s.id,
            decisionOutput: i < 7 ? s.expected : (s.expected === 'positive' ? 'negative' : 'positive'),
            parsedOutput: {},
            isCorrect: i < 7,
          })) as RunResultRecord[],
        },
      ]);
      const ports = makeInMemoryPorts({ runner });
      const deps: LoopDependencies = {
        limiter: new StubLimiter(),
        logger: makeConsoleLogger(),
      };

      const startedAt = Date.now();
      const result = await runIterationLoop(config, snapshot, ports, deps);
      const elapsedMs = Date.now() - startedAt;
      console.log(`\n=== Iteration finished in ${elapsedMs}ms ===`);

      // ===== Assertions: path is correct =====
      expect(result.rounds).toHaveLength(1);
      // 1 round did not reach goal → exit via max_rounds
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('max_rounds');

      // promptVersionWriter wrote 1 new version; body contains variable placeholders
      expect(ports.promptVersionWriter.writes).toHaveLength(1);
      const write = ports.promptVersionWriter.writes[0]!;
      expect(write.body).toContain('{{review_text}}');
      expect(write.parentVersionId).toBe('integration_pv_base');
      expect(write.outputSchema).toBeDefined();
      expect(write.changeSummary.length).toBeGreaterThan(0);

      // previousRoundRunResultsReader is called 1 time + returns null → no regression batch
      expect(ports.previousRoundRunResultsReader.calls).toHaveLength(1);
      const round = result.rounds[0]!;
      expect(round.errorAnalysis.length).toBeGreaterThan(0);
      expect(round.changeSummary.length).toBeGreaterThan(0);

      // Final recordFinal lands
      expect(ports.roundRecorder.finalResult).not.toBeNull();
      expect(ports.roundRecorder.finalResult?.reason).toBe('max_rounds');

      // ===== Manual observation prints =====
      console.log('\n=== Original prompt ===');
      console.log(snapshot.basePromptVersion.body);

      console.log('\n=== Error analysis (summary) ===');
      console.log(round.errorAnalysis);

      console.log('\n=== Change summary ===');
      console.log(round.changeSummary);

      console.log('\n=== Generated new prompt (LLM-authored body, 应不含输出格式 / JSON schema) ===');
      console.log(write.body);

      // The output format section is auto-assembled from outputSchema — concatenated at the body tail when the business LLM is invoked
      const outputFormatInstruction = buildOutputFormatInstruction(
        snapshot.basePromptVersion.outputSchema,
      );
      console.log('\n=== Auto-built output format instruction (from outputSchema) ===');
      console.log(outputFormatInstruction);

      const composedFullPrompt = composeFullPrompt(
        write.body,
        snapshot.basePromptVersion.outputSchema,
      );
      console.log('\n=== Composed full prompt (body + output format → 发给业务 LLM 的样子) ===');
      console.log(composedFullPrompt);

      console.log('\n=== Round metrics (mocked by InMemoryExperimentRunner) ===');
      console.log(JSON.stringify(round.metrics, null, 2));

      console.log('\n=== Goal progress ===');
      for (const gp of round.goalProgress) {
        console.log(
          `- ${gp.goal.scope.kind === 'overall' ? '整体' : `分类「${gp.goal.scope.label}」`} ${gp.goal.metric} ${gp.goal.op} ${gp.goal.value} | observed=${gp.observed} | achieved=${gp.achieved}`,
        );
      }

      console.log('\n=== Final OptimizationResult (compact) ===');
      console.log(
        JSON.stringify(
          {
            status: result.status,
            reason: result.reason,
            bestVersionId: result.bestVersionId,
            bestMetrics: result.bestMetrics,
            roundCount: result.rounds.length,
            errorClass: result.errorClass,
            errorMessage: result.errorMessage,
          },
          null,
          2,
        ),
      );
    },
    // At most 3 real LLM calls — leave 2 minutes timeout
    120_000,
  );
});

if (!hasEnv) {
  console.log(
    '[real-llm.integration.test] skipped — set MODEL_PROBE_API_KEY to enable. ' +
      'See .env.example for the full list.',
  );
}
