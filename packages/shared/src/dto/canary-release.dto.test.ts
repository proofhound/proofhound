import { describe, expect, it } from 'vitest';
import {
  CANARY_RELEASE_FILTER_MAX_DEPTH,
  canaryReleaseFilterRulesSchema,
  canaryReleaseStopConditionsSchema,
  canaryReleaseVariableMappingSchema,
  createCanaryReleaseInputSchema,
  updateCanaryTrafficRatioInputSchema,
  type CanaryReleaseFilterNodeDto,
} from './canary-release.dto';

const validVariableMapping = [
  { source: 'msg.id', target: 'id', required: true },
  { source: 'msg.text', target: 'content', required: true },
];

const validBaseInput = {
  promptVersionId: '11111111-1111-4111-8111-111111111111',
  modelId: '22222222-2222-4222-8222-222222222222',
  inputConnectorId: '33333333-3333-4333-8333-333333333333',
  trafficRatio: 0.1,
  runMode: 'fixed_duration' as const,
  variableMapping: validVariableMapping,
  stopConditions: { maxDurationSeconds: 86_400, maxSamples: null },
  externalIdField: 'msg.id',
  runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 1, temperature: 0.3 },
};

describe('createCanaryReleaseInputSchema', () => {
  it('parses a minimal valid payload', () => {
    const parsed = createCanaryReleaseInputSchema.parse(validBaseInput);
    expect(parsed.outputConnectorIds).toEqual([]);
    expect(parsed.outputMapping).toEqual([]);
    expect(parsed.filterRules).toBeNull();
    expect(parsed.storageCategories).toEqual([]);
    expect(parsed.targetDatasetId).toBeNull();
    expect(parsed.recordMode).toBe('all');
    expect(parsed.recordCategories).toEqual([]);
    expect(parsed.trafficMode).toBe('split');
    expect(parsed.name).toBeUndefined();
    expect(parsed.description).toBeUndefined();
  });

  it('accepts an explicit display name for standalone canaries', () => {
    const parsed = createCanaryReleaseInputSchema.parse({
      ...validBaseInput,
      name: 'release_test',
      description: 'standalone queue canary',
    });

    expect(parsed.name).toBe('release_test');
    expect(parsed.description).toBe('standalone queue canary');
  });

  it('accepts dual-run traffic mode', () => {
    const parsed = createCanaryReleaseInputSchema.parse({ ...validBaseInput, trafficMode: 'dual_run' });
    expect(parsed.trafficMode).toBe('dual_run');
  });

  it('rejects when variable_mapping lacks target=id', () => {
    expect(() =>
      createCanaryReleaseInputSchema.parse({
        ...validBaseInput,
        variableMapping: [{ source: 'msg.text', target: 'content', required: true }],
      }),
    ).toThrow(/target=.{1,3}id/);
  });

  it('rejects traffic_ratio out of (0, 1] range', () => {
    expect(() => createCanaryReleaseInputSchema.parse({ ...validBaseInput, trafficRatio: 0 })).toThrow();
    expect(() => createCanaryReleaseInputSchema.parse({ ...validBaseInput, trafficRatio: 1.5 })).toThrow();
  });
});

describe('canaryReleaseStopConditionsSchema', () => {
  it('rejects when both knobs are null', () => {
    expect(() =>
      canaryReleaseStopConditionsSchema.parse({
        maxDurationSeconds: null,
        maxSamples: null,
      }),
    ).toThrow();
  });

  it('accepts when any one knob is set', () => {
    expect(() =>
      canaryReleaseStopConditionsSchema.parse({
        maxDurationSeconds: null,
        maxSamples: 1000,
      }),
    ).not.toThrow();
  });
});

describe('canaryReleaseFilterRulesSchema', () => {
  function buildTree(depth: number): CanaryReleaseFilterNodeDto {
    if (depth <= 1) return { type: 'atom', field: 'x', op: 'eq', value: 1 };
    return { type: 'and', children: [buildTree(depth - 1)] };
  }

  it('accepts null', () => {
    expect(canaryReleaseFilterRulesSchema.parse(null)).toBeNull();
  });

  it('accepts depth = max', () => {
    const tree = buildTree(CANARY_RELEASE_FILTER_MAX_DEPTH);
    expect(() => canaryReleaseFilterRulesSchema.parse(tree)).not.toThrow();
  });

  it('rejects depth = max + 1', () => {
    const tree = buildTree(CANARY_RELEASE_FILTER_MAX_DEPTH + 1);
    expect(() => canaryReleaseFilterRulesSchema.parse(tree)).toThrow(/exceeds max/);
  });

  it('parses a hand-built AND/OR/NOT tree round-trip', () => {
    const tree: CanaryReleaseFilterNodeDto = {
      type: 'and',
      children: [
        { type: 'atom', field: 'source', op: 'in', value: ['ios', 'android'] },
        {
          type: 'or',
          children: [
            { type: 'atom', field: 'amount', op: 'gt', value: 5000 },
            { type: 'atom', field: 'age', op: 'lte', value: 24 },
          ],
        },
        {
          type: 'not',
          child: { type: 'atom', field: 'env', op: 'eq', value: 'test' },
        },
      ],
    };
    expect(canaryReleaseFilterRulesSchema.parse(tree)).toEqual(tree);
  });
});

describe('canaryReleaseVariableMappingSchema', () => {
  it('rejects empty array (no id row)', () => {
    expect(() => canaryReleaseVariableMappingSchema.parse([])).toThrow(/target=.{1,3}id/);
  });

  it('parses with id row present', () => {
    expect(() => canaryReleaseVariableMappingSchema.parse(validVariableMapping)).not.toThrow();
  });
});

describe('updateCanaryTrafficRatioInputSchema', () => {
  it('accepts canary traffic from 0% through 100%', () => {
    expect(updateCanaryTrafficRatioInputSchema.parse({ trafficRatio: 0 }).trafficRatio).toBe(0);
    expect(updateCanaryTrafficRatioInputSchema.parse({ trafficRatio: 0.01 }).trafficRatio).toBe(0.01);
    expect(updateCanaryTrafficRatioInputSchema.parse({ trafficRatio: 1 }).trafficRatio).toBe(1);
  });

  it('rejects traffic outside [0, 1]', () => {
    expect(() => updateCanaryTrafficRatioInputSchema.parse({ trafficRatio: -0.01 })).toThrow();
    expect(() => updateCanaryTrafficRatioInputSchema.parse({ trafficRatio: 1.1 })).toThrow();
  });
});
