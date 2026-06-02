import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG } from '../error-pattern-analysis/config.schema';
import { computeNoBestStreak, runIterationLoop } from '../loop/run-iteration-loop';
import type {
  OptimizationConfig,
  OptimizationGoal,
  ExperimentSnapshot,
  MetricSnapshot,
  RoundHistoryEntry,
} from '../loop/types';
import type { ErrorPatternAnalysisConfig } from '../error-pattern-analysis/config.schema';
import {
  createFakeAdapter,
  makeAnalysisModel,
  makeLoopDependencies,
  makeTaskModel,
} from './helpers/fake-invoke-deps';
import {
  InMemoryExperimentRunner,
  makeInMemoryPorts,
  runnerFromMetricCurve,
} from './helpers/in-memory-ports';

// Standard fake responses — one each for confusion / regression / summarize / generate
const CONFUSION_RESP = JSON.stringify({
  confusionPair: 'A→A',
  errorPatterns: [{ label: 'fake confusion', count: 1, reason: 'r', exampleSampleIds: ['sample_2'] }],
  suggestedChanges: [{ section: '任务说明', change: 'x', rationale: 'y' }],
});
const REGRESSION_RESP = JSON.stringify({
  errorPatterns: [{ label: 'fake regression', count: 1, reason: 'r', exampleSampleIds: ['sample_2'] }],
  suggestedChanges: [{ section: '示例区', change: 'x', rationale: 'y' }],
});
const SUMMARIZE_RESP = JSON.stringify({
  summary: '本轮汇总：fake summary',
  errorPatterns: [{ label: 'merged', count: 2, reason: 'r', exampleSampleIds: ['sample_2'] }],
  suggestedChanges: [{ section: '任务说明', change: 'x', rationale: 'y', priority: 'high' }],
});
const GENERATE_RESP = JSON.stringify({
  newPromptBody: '改进版：分类 {{text}} 为 A 或 B。',
  changeSummary: '加强 B 的特征说明',
  appliedTips: ['术语 / 类别明确化'],
  variablesUsed: ['text'],
});

function defaultAdapter() {
  return createFakeAdapter({
    confusion: { content: CONFUSION_RESP },
    regression: { content: REGRESSION_RESP },
    summarize: { content: SUMMARIZE_RESP },
    generate: { content: GENERATE_RESP },
  });
}

function makeSnapshot(initialMetrics: MetricSnapshot): ExperimentSnapshot {
  return {
    projectId: 'proj_001',
    projectType: 'classification',
    sourceExperimentId: 'exp_source',
    dataset: {
      id: 'ds_001',
      samples: [
        { id: 'sample_1', input: { text: 'foo' }, expected: 'A' },
        { id: 'sample_2', input: { text: 'bar' }, expected: 'A' }, // This one will fail (isCorrect=false in runResults)
      ],
    },
    taskModel: makeTaskModel(),
    judgmentRules: { ruleName: 'enum_match', config: { field: 'decision' } },
    basePromptVersion: {
      id: 'pv_base',
      promptId: 'p_001',
      versionNumber: 1,
      body: '请把输入 {{text}} 分类为 A 或 B。',
      outputSchema: { type: 'object', properties: { decision: { enum: ['A', 'B'] } } },
      judgmentRules: { ruleName: 'enum_match', config: { field: 'decision' } },
      variables: [{ name: 'text' }],
    },
    lastRunResults: [
      { id: 'rr_init_1', sampleId: 'sample_1', decisionOutput: 'A', isCorrect: true },
      { id: 'rr_init_2', sampleId: 'sample_2', decisionOutput: 'A', isCorrect: false },
    ],
    lastMetrics: initialMetrics,
  };
}

function makeConfig(
  goals: OptimizationGoal[],
  maxRounds: number,
  overrides: Partial<OptimizationConfig<ErrorPatternAnalysisConfig>> = {},
): OptimizationConfig<ErrorPatternAnalysisConfig> {
  return {
    optimizationId: 'ai_001',
    goals,
    maxRounds,
    analysisModel: makeAnalysisModel(),
    analysisLimiterKey: 'test:analysis-model',
    taskModel: makeTaskModel(),
    fieldWhitelist: { promptVariables: ['text'] },
    strategyKey: 'error_pattern_analysis',
    strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
    ...overrides,
  };
}

describe('runIterationLoop', () => {
  const accuracyGoal: OptimizationGoal = { metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } };

  it('Scenario 1: goals_met — succeeds when metric curve crosses target', async () => {
    const adapter = defaultAdapter();
    const runner = runnerFromMetricCurve([
      { overall: { accuracy: 0.7 } },
      { overall: { accuracy: 0.85 } },
      { overall: { accuracy: 0.92 } },
    ]);
    const ports = makeInMemoryPorts({ runner });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 5),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(result.status).toBe('success');
    expect(result.reason).toBe('goals_met');
    expect(result.rounds).toHaveLength(3);
    expect(result.bestMetrics.overall.accuracy).toBe(0.92);
    expect(ports.promptVersionWriter.writes).toHaveLength(3);
    expect(ports.promptVersionWriter.writes[0]?.parentVersionId).toBe('pv_base');
    expect(ports.promptVersionWriter.writes[0]?.outputSchema).toBeDefined();
  });

  it('Scenario 2: max_rounds — exhausted without meeting goal', async () => {
    const adapter = defaultAdapter();
    const runner = runnerFromMetricCurve([
      { overall: { accuracy: 0.65 } },
      { overall: { accuracy: 0.7 } },
    ]);
    const ports = makeInMemoryPorts({ runner });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 2),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('max_rounds');
    expect(result.rounds).toHaveLength(2);
  });

  it('Scenario 3: control=cancel aborts before round 2', async () => {
    const adapter = defaultAdapter();
    const runner = runnerFromMetricCurve([
      { overall: { accuracy: 0.6 } },
      { overall: { accuracy: 0.75 } },
    ]);
    const ports = makeInMemoryPorts({ runner, controlSignals: [null, 'cancel'] });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 5),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(result.status).toBe('cancelled');
    expect(result.rounds).toHaveLength(1);
  });

  it('Scenario 4: control=stop pauses after round 1', async () => {
    const adapter = defaultAdapter();
    const runner = runnerFromMetricCurve([{ overall: { accuracy: 0.6 } }]);
    const ports = makeInMemoryPorts({ runner, controlSignals: [null, 'stop'] });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 5),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(result.status).toBe('stopped');
    expect(result.rounds).toHaveLength(1);
  });

  it('Scenario 5: fatal_error when runner throws', async () => {
    const adapter = defaultAdapter();
    const runner = new InMemoryExperimentRunner([
      { experimentId: 'exp_1', metrics: { overall: { accuracy: 0.6 } }, runResults: [] },
      () => {
        throw new Error('runner crashed');
      },
    ]);
    const ports = makeInMemoryPorts({ runner });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 5),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('fatal_error');
    expect(result.errorMessage).toContain('runner crashed');
  });

  it('Scenario 6: goals already met at round 0 — no port called', async () => {
    const adapter = defaultAdapter();
    const runner = new InMemoryExperimentRunner([]);
    const ports = makeInMemoryPorts({ runner });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 5),
      makeSnapshot({ overall: { accuracy: 0.95 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(result.status).toBe('success');
    expect(result.rounds).toHaveLength(0);
    expect(runner.calls).toHaveLength(0);
    expect(adapter.calls).toHaveLength(0);
  });

  it('passes previousRunResults from port to analyzeFailures (triggers regression batch on round 2+)', async () => {
    const adapter = defaultAdapter();
    const runner = runnerFromMetricCurve([
      { overall: { accuracy: 0.65 } },
      { overall: { accuracy: 0.7 } },
    ]);
    // round 1 has no previous (returns null); round 2 provides previous (triggers regression batch)
    const ports = makeInMemoryPorts({
      runner,
      previousRunResults: [
        null,
        [
          { id: 'prr_2_1', sampleId: 'sample_1', decisionOutput: 'A', isCorrect: true },
          { id: 'prr_2_2', sampleId: 'sample_2', decisionOutput: 'A', isCorrect: true }, // In the previous round, sample_2 was correct (synthetic)
        ],
      ],
    });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 2),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(result.status).toBe('failed'); // max_rounds
    expect(ports.previousRoundRunResultsReader.calls).toHaveLength(2);
    expect(ports.previousRoundRunResultsReader.calls[0]?.currentRoundNumber).toBe(1);
    expect(ports.previousRoundRunResultsReader.calls[1]?.currentRoundNumber).toBe(2);
    // round 1 has no previous → no regression batch; round 2 has → 1 regression batch
    expect(adapter.callsFor('regression')).toHaveLength(1);
  });

  it('retries from the parent prompt and analyzes the regressed round when a round is worse than its base', async () => {
    const adapter = defaultAdapter();
    const runner = runnerFromMetricCurve(
      [
        { overall: { accuracy: 0.7 } },
        { overall: { accuracy: 0.6 } },
        { overall: { accuracy: 0.75 } },
      ],
      (round) => [
        {
          id: `rr_${round}_a`,
          sampleId: 'sample_1',
          decisionOutput: 'A',
          isCorrect: false,
        },
        {
          id: `rr_${round}_b`,
          sampleId: 'sample_2',
          decisionOutput: 'A',
          isCorrect: round !== 2,
        },
      ],
    );
    const ports = makeInMemoryPorts({ runner });
    const result = await runIterationLoop(
      makeConfig([accuracyGoal], 3),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );

    expect(result.reason).toBe('max_rounds');
    expect(ports.promptVersionWriter.writes.map((w) => w.parentVersionId)).toEqual([
      'pv_base',
      'pv_generated_1',
      'pv_generated_1',
    ]);
    expect(adapter.callsFor('regression')).toHaveLength(1);
    expect(adapter.callsFor('generate')[2]?.userPrompt).toContain('## 当前 prompt 模板（v2）');
  });

  it('records final result via recordFinal in every termination branch', async () => {
    const adapter = defaultAdapter();
    const runner = runnerFromMetricCurve([{ overall: { accuracy: 0.65 } }]);
    const ports = makeInMemoryPorts({ runner });
    await runIterationLoop(
      makeConfig([accuracyGoal], 1),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    expect(ports.roundRecorder.finalResult).not.toBeNull();
    expect(ports.roundRecorder.finalResult?.reason).toBe('max_rounds');
  });

  // SPEC 25 §11.3 "toolbox rotation hint" — when !isBest for ≥ 2 consecutive rounds, the generate user prompt injects a switch section
  it('injects toolbox switch hint into round-3 generate when prior 2 rounds were !isBest', async () => {
    const adapter = defaultAdapter();
    // Initial 0.5, goal ≥ 0.9, curve all 0.4 (lower than initial) → every round is !isBest
    const runner = runnerFromMetricCurve([
      { overall: { accuracy: 0.4 } },
      { overall: { accuracy: 0.4 } },
      { overall: { accuracy: 0.4 } },
    ]);
    const ports = makeInMemoryPorts({ runner });
    await runIterationLoop(
      makeConfig([accuracyGoal], 3),
      makeSnapshot({ overall: { accuracy: 0.5 } }),
      ports,
      makeLoopDependencies(adapter),
    );
    const generateCalls = adapter.callsFor('generate');
    expect(generateCalls).toHaveLength(3);
    // At round 1 / round 2 generate, history length is 0 / 1, streak < 2 → no injection
    expect(generateCalls[0]?.userPrompt).not.toContain('## 工具箱轮换提示');
    expect(generateCalls[1]?.userPrompt).not.toContain('## 工具箱轮换提示');
    // At round 3 generate, history = [r1 !isBest, r2 !isBest] → streak=2 → inject
    expect(generateCalls[2]?.userPrompt).toContain('## 工具箱轮换提示');
    // "Already tried" techniques come from GENERATE_RESP.appliedTips
    expect(generateCalls[2]?.userPrompt).toContain('术语 / 类别明确化');
  });
});

describe('computeNoBestStreak', () => {
  const makeEntry = (roundIndex: number, isBest: boolean): RoundHistoryEntry => ({
    roundIndex,
    metrics: { overall: { accuracy: 0.5 } },
    deltaFromPrev: null,
    changeSummary: '',
    appliedChanges: [],
    appliedTips: [],
    isBest,
    generatedFromBaseVersionId: '',
  });

  it('returns 0 for empty history', () => {
    expect(computeNoBestStreak([])).toBe(0);
  });

  it('returns 0 when the last entry is best', () => {
    expect(computeNoBestStreak([makeEntry(1, true)])).toBe(0);
    expect(computeNoBestStreak([makeEntry(1, false), makeEntry(2, true)])).toBe(0);
  });

  it('counts consecutive !isBest entries from the end', () => {
    expect(computeNoBestStreak([makeEntry(1, false)])).toBe(1);
    expect(
      computeNoBestStreak([makeEntry(1, true), makeEntry(2, false), makeEntry(3, false)]),
    ).toBe(2);
  });

  it('stops counting at the first best entry from the end', () => {
    // history: !best, !best, best, !best, !best → streak counts from end: 2
    expect(
      computeNoBestStreak([
        makeEntry(1, false),
        makeEntry(2, false),
        makeEntry(3, true),
        makeEntry(4, false),
        makeEntry(5, false),
      ]),
    ).toBe(2);
  });

  it('returns full length when all entries are !isBest', () => {
    expect(
      computeNoBestStreak([makeEntry(1, false), makeEntry(2, false), makeEntry(3, false)]),
    ).toBe(3);
  });
});
