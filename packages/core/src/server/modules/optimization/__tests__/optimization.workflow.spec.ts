import { describe, expect, it } from 'vitest';
import { FirstVersionParseError } from '@proofhound/optimization-strategy';
import {
  buildOptimizationExperimentName,
  buildSamplesForStrategy,
  computeOptimizationBaselineExperimentId,
  deriveJudgmentRulesFromOutputSchema,
  extractAppliedTipsFromGenerateParsedOutput,
  isPromptBaselineBootstrapNeeded,
  mapFirstVersionErrorReason,
  parseChildRunConfigFromOptimization,
  parseVariables,
  pickRandomSamples,
  readExpectedField,
  reconstructAnalysisFromRunResult,
  reconstructGenerateFromRunResult,
  toLoopFieldWhitelist,
} from '../optimization.workflow';

describe('prompt baseline bootstrap helpers', () => {
  it('bootstraps a baseline experiment for from_prompt_version and from_dataset_only (SPEC 25 §2.1)', () => {
    expect(isPromptBaselineBootstrapNeeded('from_prompt_version')).toBe(true);
    expect(isPromptBaselineBootstrapNeeded('from_experiment')).toBe(false);
    // from_dataset_only: after generateFirstVersionStep writes the first version, it follows the same baseline-experiment path as from_prompt_version
    expect(isPromptBaselineBootstrapNeeded('from_dataset_only')).toBe(true);
  });

  it('computes a stable deterministic baseline experiment id', () => {
    const optimizationId = 'a1111111-1111-4111-8111-111111111111';
    const first = computeOptimizationBaselineExperimentId(optimizationId);
    const second = computeOptimizationBaselineExperimentId(optimizationId);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(computeOptimizationBaselineExperimentId('b2222222-2222-4222-8222-222222222222'));
  });
});

describe('buildOptimizationExperimentName', () => {
  it('uses readable persisted names for optimization baseline and rounds', () => {
    expect(buildOptimizationExperimentName('客服意图优化', 'baseline')).toBe('客服意图优化 · baseline');
    expect(buildOptimizationExperimentName('客服意图优化', 1)).toBe('客服意图优化 · R1');
  });

  it('does not localize baseline and trims the optimization name segment', () => {
    expect(buildOptimizationExperimentName('  risk classifier  ', 'baseline')).toBe('risk classifier · baseline');
  });

  it('keeps the round suffix when truncating long optimization names', () => {
    const name = buildOptimizationExperimentName('x'.repeat(40), 12, { maxLength: 32 });
    expect(name).toHaveLength(32);
    expect(name.endsWith(' · R12')).toBe(true);
  });

  it('adds a deterministic short suffix for collision fallback names', () => {
    const first = buildOptimizationExperimentName('客服意图优化', 1, { collisionSalt: 'opt-a:1' });
    const second = buildOptimizationExperimentName('客服意图优化', 1, { collisionSalt: 'opt-a:1' });
    expect(first).toBe(second);
    expect(first).toMatch(/^客服意图优化 · R1 · [0-9a-f]{6}$/);
  });
});

describe('readExpectedField', () => {
  it('returns expected_output by default when rules is null/undefined/non-object', () => {
    expect(readExpectedField(null)).toBe('expected_output');
    expect(readExpectedField(undefined)).toBe('expected_output');
    expect(readExpectedField('not-an-object')).toBe('expected_output');
    expect(readExpectedField(123)).toBe('expected_output');
  });

  it('returns expected_output when rules object has no field key', () => {
    expect(readExpectedField({})).toBe('expected_output');
    expect(readExpectedField({ ruleName: 'enum_match' })).toBe('expected_output');
  });

  it('reads snake_case expected_field', () => {
    expect(readExpectedField({ expected_field: 'label' })).toBe('label');
  });

  it('reads camelCase expectedField', () => {
    expect(readExpectedField({ expectedField: 'gold' })).toBe('gold');
  });

  it('prefers snake_case when both are present', () => {
    expect(readExpectedField({ expected_field: 'a', expectedField: 'b' })).toBe('a');
  });

  it('falls back to default when field value is empty string or non-string', () => {
    expect(readExpectedField({ expected_field: '' })).toBe('expected_output');
    expect(readExpectedField({ expectedField: 42 })).toBe('expected_output');
  });

  it('reads prompt-editor rules array value as expected field', () => {
    expect(
      readExpectedField({
        rules: [{ field: 'sentiment', operator: 'exact_match', value: 'gold_label' }],
      }),
    ).toBe('gold_label');
  });
});

describe('deriveJudgmentRulesFromOutputSchema', () => {
  it('uses the generated isJudgment field as decision_field for first versions', () => {
    expect(
      deriveJudgmentRulesFromOutputSchema({
        fields: [{ key: 'sentiment', value: 'positive | negative', isJudgment: true }],
      }),
    ).toEqual({
      mode: 'exact_match',
      expected_field: 'expected_output',
      decision_field: 'sentiment',
    });
  });

  it('preserves a custom expected field when deriving first-version rules', () => {
    expect(
      deriveJudgmentRulesFromOutputSchema(
        {
          fields: [{ key: 'category', value: 'A | B', isJudgment: true }],
        },
        'gold_category',
      ),
    ).toMatchObject({
      expected_field: 'gold_category',
      decision_field: 'category',
    });
  });
});

describe('buildSamplesForStrategy', () => {
  const samplesRaw = [
    { id: 's1', data: { text: 'hello', expected_output: 'positive' } },
    { id: 's2', data: { text: 'bad', expected_output: 'negative' } },
    { id: 's3', data: { text: 'no-label' } },
  ];

  it('reads expected from default expected_output field when judgmentRulesConfig is empty', () => {
    const samples = buildSamplesForStrategy(samplesRaw, null);
    expect(samples).toHaveLength(3);
    expect(samples[0]).toEqual({ id: 's1', input: samplesRaw[0]?.data, expected: 'positive' });
    expect(samples[1]).toEqual({ id: 's2', input: samplesRaw[1]?.data, expected: 'negative' });
    expect(samples[2]).toEqual({ id: 's3', input: samplesRaw[2]?.data, expected: undefined });
  });

  it('reads expected from custom field declared in judgmentRules.expected_field', () => {
    const custom = [
      { id: 'a', data: { label: 'A' } },
      { id: 'b', data: { label: 'B' } },
    ];
    const samples = buildSamplesForStrategy(custom, { expected_field: 'label' });
    expect(samples[0]?.expected).toBe('A');
    expect(samples[1]?.expected).toBe('B');
  });

  it('preserves non-string scalars (number/boolean) without stringifying', () => {
    const numeric = [
      { id: 'n1', data: { expected_output: 1 } },
      { id: 'n2', data: { expected_output: false } },
    ];
    const samples = buildSamplesForStrategy(numeric, null);
    expect(samples[0]?.expected).toBe(1);
    expect(samples[1]?.expected).toBe(false);
  });

  it('leaves expected undefined when raw value is null or missing', () => {
    const partial = [
      { id: 'x', data: { expected_output: null } },
      { id: 'y', data: { text: 'no-key' } },
    ];
    const samples = buildSamplesForStrategy(partial, null);
    expect(samples[0]?.expected).toBeUndefined();
    expect(samples[1]?.expected).toBeUndefined();
  });

  it('does not lose expected when judgmentRules wraps config (regression for workflow:452 bug)', () => {
    // Regression case for the root cause fix: previously the mapping hardcoded expected to undefined,
    // causing the strategy package's confusion-pairs to be skipped entirely → analyze_skipped reason=no_batches
    const samples = buildSamplesForStrategy(samplesRaw, { expected_field: 'expected_output' });
    const withExpected = samples.filter((s) => s.expected != null);
    expect(withExpected).toHaveLength(2);
    expect(withExpected.map((s) => s.expected)).toEqual(['positive', 'negative']);
  });
});

// SPEC 25 §11.4.1: reconstruct the analyzeFailures / generateNextVersion return shape from run_results.parsed_output,
// so prepareRoundImpl can skip the actual call when the LLM has already succeeded
describe('reconstructAnalysisFromRunResult', () => {
  it('reads errorAnalysisText from parsedOutput.summary', () => {
    const result = reconstructAnalysisFromRunResult({
      parsedOutput: {
        summary: 'B 类常被误判成 A 类,主要在 negation 场景',
        errorPatterns: [{ label: 'B→A', count: 5, reason: 'negation', exampleSampleIds: [] }],
        suggestedChanges: [{ section: 'instructions', change: 'add negation handling', rationale: 'r' }],
      },
      rawResponse: '<raw>',
    });
    expect(result.errorAnalysisText).toBe('B 类常被误判成 A 类,主要在 negation 场景');
    expect(result.summary.errorPatterns).toHaveLength(1);
    expect(result.summary.suggestedChanges).toHaveLength(1);
    expect(result.batches).toEqual([]);
    expect(result.confusionPairs).toEqual([]);
    expect(result.regressionGroups).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('falls back to errorAnalysisText key when summary missing', () => {
    const result = reconstructAnalysisFromRunResult({
      parsedOutput: { errorAnalysisText: 'fallback text' },
      rawResponse: null,
    });
    expect(result.errorAnalysisText).toBe('fallback text');
  });

  it('falls back to rawResponse when parsedOutput is empty/null', () => {
    const result = reconstructAnalysisFromRunResult({
      parsedOutput: null,
      rawResponse: 'raw analysis text',
    });
    expect(result.errorAnalysisText).toBe('raw analysis text');
  });

  it('returns empty errorAnalysisText when both parsed and raw are missing', () => {
    const result = reconstructAnalysisFromRunResult({ parsedOutput: null, rawResponse: null });
    expect(result.errorAnalysisText).toBe('');
    expect(result.summary.summary).toBe('');
  });
});

describe('reconstructGenerateFromRunResult', () => {
  const fallbackBody = '原始 prompt body';

  it('reads newPromptBody + changeSummary from parsedOutput', () => {
    const result = reconstructGenerateFromRunResult(
      {
        parsedOutput: { newPromptBody: '新版 prompt body', changeSummary: '加了 negation 处理' },
        rawResponse: null,
      },
      fallbackBody,
    );
    expect(result.newPromptBody).toBe('新版 prompt body');
    expect(result.changeSummary).toBe('加了 negation 处理');
  });

  it('returns empty changeSummary if parsedOutput.newPromptBody present but changeSummary missing', () => {
    const result = reconstructGenerateFromRunResult(
      { parsedOutput: { newPromptBody: 'body only' }, rawResponse: null },
      fallbackBody,
    );
    expect(result.newPromptBody).toBe('body only');
    expect(result.changeSummary).toBe('');
  });

  it('falls back to rawResponse with empty changeSummary when no newPromptBody', () => {
    const result = reconstructGenerateFromRunResult(
      { parsedOutput: null, rawResponse: '<raw fallback>' },
      fallbackBody,
    );
    expect(result.newPromptBody).toBe('<raw fallback>');
    expect(result.changeSummary).toBe('');
  });

  it('falls back to fallbackBody with restored_from_reuse summary when all sources missing', () => {
    const result = reconstructGenerateFromRunResult({ parsedOutput: null, rawResponse: null }, fallbackBody);
    expect(result.newPromptBody).toBe(fallbackBody);
    expect(result.changeSummary).toBe('restored_from_reuse');
  });

  it('preserves autoPatched + patchedVariables when present in parsedOutput', () => {
    const result = reconstructGenerateFromRunResult(
      {
        parsedOutput: {
          newPromptBody: '判断 {{text}} 的情感。\n\n---\n（系统自动补丁：以下输入变量被系统补回...）\n- text：{{text}}',
          changeSummary: '加强 B 的判定特征',
          autoPatched: true,
          patchedVariables: ['text'],
        },
        rawResponse: null,
      },
      fallbackBody,
    );
    expect(result.autoPatched).toBe(true);
    expect(result.patchedVariables).toEqual(['text']);
  });

  it('omits autoPatched / patchedVariables when absent in parsedOutput (normal success path)', () => {
    const result = reconstructGenerateFromRunResult(
      {
        parsedOutput: { newPromptBody: '判断 {{text}} 的情感。', changeSummary: 'x' },
        rawResponse: null,
      },
      fallbackBody,
    );
    expect(result.autoPatched).toBeUndefined();
    expect(result.patchedVariables).toBeUndefined();
  });
});

// SPEC 25 §11.3 "toolbox rotation prompt" — buildRoundHistoryEntries de-aggregates via this helper
// generate run_results.parsed_output.appliedTips → RoundHistoryEntry.appliedTips
describe('extractAppliedTipsFromGenerateParsedOutput', () => {
  it('returns empty array when parsedGen is null / undefined', () => {
    expect(extractAppliedTipsFromGenerateParsedOutput(null)).toEqual([]);
    expect(extractAppliedTipsFromGenerateParsedOutput(undefined)).toEqual([]);
  });

  it('returns empty array when parsedGen is not an object', () => {
    expect(extractAppliedTipsFromGenerateParsedOutput('string-not-object')).toEqual([]);
    expect(extractAppliedTipsFromGenerateParsedOutput(123)).toEqual([]);
  });

  it('returns empty array when appliedTips field missing', () => {
    expect(extractAppliedTipsFromGenerateParsedOutput({ newPromptBody: 'x' })).toEqual([]);
  });

  it('returns empty array when appliedTips is not an array', () => {
    expect(extractAppliedTipsFromGenerateParsedOutput({ appliedTips: 'CoT' })).toEqual([]);
    expect(extractAppliedTipsFromGenerateParsedOutput({ appliedTips: null })).toEqual([]);
  });

  it('returns string tips and filters out empty / non-string entries', () => {
    const tips = extractAppliedTipsFromGenerateParsedOutput({
      appliedTips: ['思维链', 'Few-shot 示例', '', 42, null, '术语 / 类别明确化'],
    });
    expect(tips).toEqual(['思维链', 'Few-shot 示例', '术语 / 类别明确化']);
  });

  it('handles legacy parsedGen shape with mixed fields (preserves order)', () => {
    const tips = extractAppliedTipsFromGenerateParsedOutput({
      newPromptBody: 'body',
      changeSummary: 'changed B handling',
      appliedTips: ['输出约束硬性化', '错误避免举例'],
      appliedChanges: [{ changeId: 'c1' }],
    });
    expect(tips).toEqual(['输出约束硬性化', '错误避免举例']);
  });
});

describe('parseVariables (optimization v16/v17 字面占位回归)', () => {
  // Regression: optimization 4dfe660a actually produced a v16 prompt body containing {{text}}, but variables were persisted as [],
  // so the experiment renderer's buildInputVariables could not find text → the literal {{text}} was sent to the LLM.
  // Root cause: basePromptVersion.variables was stripped to { name, description },
  // and the downstream parseVariables (validating against the full promptVariableSchema) discarded the entry → variables=[] in DB.
  it('preserves full PromptVariableDto fields (type / required / datasetField) on round-trip', () => {
    const raw: unknown[] = [{ name: 'text', type: 'text', required: true, datasetField: 'text' }];
    const parsed = parseVariables(raw);
    expect(parsed).toEqual([{ name: 'text', type: 'text', required: true, datasetField: 'text' }]);
  });

  it('drops entries missing required fields (this is exactly how the v16 bug arose)', () => {
    // The old workflow stripped variables to { name, description } and fed them back → the entry is silently discarded here,
    // ultimately persisting variables=[]; the renderer cannot find text, so {{text}} remains literal when sent to the business model.
    const stripped: unknown[] = [{ name: 'text', description: undefined }];
    expect(parseVariables(stripped)).toEqual([]);
  });

  it('passes the documented createOptimizationFrozenVersion contract: variables round-tripped through workflow have full DTO', () => {
    // Simulate :424 → :438 (basePromptVersion.variables) → :818 (parseVariables again) → :833
    // (createOptimizationFrozenVersion arguments)
    const ctxBaseVersionVariables: unknown[] = [{ name: 'text', type: 'text', required: true, datasetField: 'text' }];
    const fromCtx = parseVariables(ctxBaseVersionVariables);
    // When the workflow does not strip fields, basePromptVersion.variables reuses fromCtx directly
    const basePromptVersionVariables = fromCtx;
    // parseVariables is run again inside the downstream round — must still be a complete DTO
    const variablesForFrozenWrite = parseVariables(basePromptVersionVariables);
    expect(variablesForFrozenWrite).toEqual([{ name: 'text', type: 'text', required: true, datasetField: 'text' }]);
  });
});

// SPEC 25 §11 child experiment runConfig inheritance: loadConfigImpl projects optimizations.run_config
// through this helper into experimentRunConfigSchema, used as the runConfig argument passed by prepareRoundImpl to createChildExperimentRow.
// Before the fix, prepareRoundImpl hardcoded {}, so the optimization child experiment detail page displayed "-" for runConfig.
describe('parseChildRunConfigFromOptimization (子实验 runConfig 继承)', () => {
  it('passes through the full 7-field optimization runConfig', () => {
    const input = {
      temperature: 0.3,
      concurrency: 8,
      rpmLimit: 30,
      tpmLimit: 150_000,
      sampleTimeoutSeconds: 20,
      retries: 2,
      imageEncoding: 'url' as const,
    };
    expect(parseChildRunConfigFromOptimization(input)).toEqual(input);
  });

  it('keeps legacy 4-field configs intact (timeout/retries/imageEncoding remain undefined)', () => {
    const legacy = { temperature: 0, concurrency: 10, rpmLimit: 30, tpmLimit: 150_000 };
    const out = parseChildRunConfigFromOptimization(legacy);
    expect(out).toEqual(legacy);
    expect(out.sampleTimeoutSeconds).toBeUndefined();
    expect(out.retries).toBeUndefined();
    expect(out.imageEncoding).toBeUndefined();
  });

  it('keeps known fields strongly typed; tolerates optimization-only extras via catchall (filtered by downstream parseRunConfig)', () => {
    // experimentRunConfigSchema uses .catchall(z.unknown()), so unknown fields are passed through into jsonb.
    // The child experiment service.parseRunConfig uses the same schema to re-parse; the frontend ExperimentRunConfigDto type
    // does not see these catchall fields, so the UI is not polluted in practice.
    const noise = {
      temperature: 0.2,
      optimizationHint: 'be terse',
      stopAfterNoImprovementRounds: 3,
    };
    const out = parseChildRunConfigFromOptimization(noise);
    expect(out.temperature).toBe(0.2);
    expect((out as Record<string, unknown>).optimizationHint).toBe('be terse');
  });

  it('falls back to empty object when a typed field violates its constraint (e.g. temperature > 2)', () => {
    const bad = { temperature: 99, concurrency: 8 };
    expect(parseChildRunConfigFromOptimization(bad)).toEqual({});
  });

  it('returns empty object when value is null / undefined / non-object', () => {
    expect(parseChildRunConfigFromOptimization(null)).toEqual({});
    expect(parseChildRunConfigFromOptimization(undefined)).toEqual({});
    expect(parseChildRunConfigFromOptimization('garbage')).toEqual({});
  });
});

describe('toLoopFieldWhitelist (ground-truth 字段保护)', () => {
  it('returns empty promptVariables when dto is null', () => {
    expect(toLoopFieldWhitelist(null, 'expected_output')).toEqual({ promptVariables: [] });
  });

  it('keeps inputFields intact when expected_field is not present', () => {
    const out = toLoopFieldWhitelist(
      { inputFields: ['text', 'subject'], metaFields: ['sample_id'] },
      'expected_output',
    );
    expect(out.promptVariables).toEqual(['text', 'subject']);
    expect(out.analysisOnlyFields).toEqual(['sample_id']);
  });

  it('strips expected_field out of promptVariables and moves it to analysisOnlyFields', () => {
    // Regression: the UI was stuffing all dataset fields into inputFields, including the ground truth field. The original implementation directly
    // fed it to the generate LLM as an available variable. Seeing the answer field name, the LLM over-reacted "defensively" and removed every {{var}}
    // → the business model could not see the sample at inference time → the entire batch collapsed onto the same label
    const out = toLoopFieldWhitelist({ inputFields: ['text', 'expected_output'], metaFields: [] }, 'expected_output');
    expect(out.promptVariables).toEqual(['text']);
    expect(out.analysisOnlyFields).toEqual(['expected_output']);
  });

  it('honors custom expected_field from judgment rules', () => {
    const out = toLoopFieldWhitelist({ inputFields: ['text', 'gold_label'], metaFields: ['source'] }, 'gold_label');
    expect(out.promptVariables).toEqual(['text']);
    expect(out.analysisOnlyFields).toEqual(['source', 'gold_label']);
  });
});

describe('mapFirstVersionErrorReason (SPEC 25 §2.1 first-version failure codes)', () => {
  it('maps FirstVersionParseError to first_version_parse_failed_v1', () => {
    expect(mapFirstVersionErrorReason(new FirstVersionParseError('bad json', '{not json'))).toBe(
      'first_version_parse_failed_v1',
    );
  });

  it('maps first_version_dataset_empty_v1 messages by prefix', () => {
    expect(mapFirstVersionErrorReason(new Error('first_version_dataset_empty_v1'))).toBe(
      'first_version_dataset_empty_v1',
    );
  });

  it('maps first_version_generation_failed_v1 prefix (including sub-reason variant)', () => {
    expect(mapFirstVersionErrorReason(new Error('first_version_generation_failed_v1'))).toBe(
      'first_version_generation_failed_v1',
    );
    expect(mapFirstVersionErrorReason(new Error('first_version_generation_failed_v1:context_missing'))).toBe(
      'first_version_generation_failed_v1',
    );
  });

  it('falls back to first_version_generation_failed_v1 for unknown errors', () => {
    expect(mapFirstVersionErrorReason(new Error('connection refused'))).toBe('first_version_generation_failed_v1');
    expect(mapFirstVersionErrorReason('arbitrary string')).toBe('first_version_generation_failed_v1');
  });
});

describe('pickRandomSamples (SPEC 25 §2.1 first-version sampling)', () => {
  it('returns all when count >= items.length', () => {
    const items = ['a', 'b', 'c'];
    expect(pickRandomSamples(items, 5, 'seed')).toEqual(['a', 'b', 'c']);
    expect(pickRandomSamples(items, 3, 'seed')).toEqual(items);
  });

  it('returns the requested count when items > n', () => {
    const items = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const picked = pickRandomSamples(items, 10, 'seed-1');
    expect(picked).toHaveLength(10);
    // Each sampled item is from the original set and is unique
    const uniq = new Set(picked);
    expect(uniq.size).toBe(10);
    for (const v of picked) {
      expect(items).toContain(v);
    }
  });

  it('is deterministic on same seed (replay-safe)', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const a = pickRandomSamples(items, 20, 'optimization-xyz:first-version');
    const b = pickRandomSamples(items, 20, 'optimization-xyz:first-version');
    expect(a).toEqual(b);
  });

  it('produces different output for different seeds', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const a = pickRandomSamples(items, 20, 'seed-a');
    const b = pickRandomSamples(items, 20, 'seed-b');
    // With extremely small probability two seeds could produce identical sequences; adjust if flaky
    expect(a).not.toEqual(b);
  });
});
