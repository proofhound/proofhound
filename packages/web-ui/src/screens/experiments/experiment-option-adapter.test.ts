import { describe, expect, it } from 'vitest';
import type {
  DatasetListItemDto,
  PromptDetailDto,
  PromptVersionDto,
  ProjectModelListItemDto,
} from '@proofhound/shared';
import {
  AVG_TOKENS_IN_PER_SAMPLE,
  AVG_TOKENS_OUT_PER_SAMPLE,
  estimateExperimentRun,
  formatContextWindow,
  formatDurationLabel,
  formatRateLimitNumber,
  formatTokenCount,
  getModelImageEncodings,
  hasImagePromptVariables,
  isExperimentRunParamsComplete,
  mapDatasetToOption,
  mapProjectModelToOption,
  mapPromptVersionToOption,
  normalizeTemperature,
  resolveExperimentDatasetId,
  validateDatasetVariableCoverage,
} from './experiment-option-adapter';

function makeDataset(overrides: Partial<DatasetListItemDto> = {}): DatasetListItemDto {
  return {
    id: 'd-1',
    projectId: 'p-1',
    name: 'risk-eval',
    description: 'baseline samples',
    sampleCount: 2480,
    fieldSchema: [
      { name: 'user_request', role: 'text', type: 'string' },
      { name: 'device', role: 'text', type: 'string' },
      { name: 'risk_level', role: 'expected_output', type: 'string' },
      { name: 'note', role: 'metadata', type: 'string' },
    ],
    categoryDistribution: { field: 'risk_level', total: 0, categories: [] },
    references: { experiments: 0, optimizations: 0 },
    hasImages: false,
    storagePrefix: null,
    createdBy: 'u-1',
    createdByDisplayName: 'Alice',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeModel(overrides: Partial<ProjectModelListItemDto> = {}): ProjectModelListItemDto {
  return {
    id: 'm-1',
    projectId: 'p-1',
    name: 'gpt-4o-mini',
    providerType: 'OpenAI',
    providerModelId: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1',
    contextWindowTokens: 128_000,
    credentialTail: '****',
    status: 'enabled',
    probeStatus: 'success',
    lastProbedAt: null,
    lastProbeError: null,
    rpm: { limit: 600, usage: 0, current: 0 },
    tpm: { limit: 250_000, usage: 0, current: 0 },
    concurrency: { limit: 20, usage: 0, current: 0 },
    autoConcurrency: true,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    capabilities: { image: 'none' },
    extraBody: {},
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    createdBy: 'u-1',
    createdByDisplayName: 'Alice',
    references: 0,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<PromptVersionDto> = {}): PromptVersionDto {
  return {
    id: 'v-1',
    promptId: 'p-1',
    versionNumber: 3,
    status: 'frozen',
    body: 'You are ...',
    variables: [
      { name: 'user_request', type: 'text', required: true },
      { name: 'device', type: 'text', required: false },
    ],
    outputSchema: {
      fields: [
        { key: 'risk_level', value: '"high" | "mid" | "low"', isJudgment: true },
        { key: 'reason', value: 'string', isJudgment: false },
      ],
    },
    judgmentRules: null,
    promptLanguage: 'zh-CN',
    parentVersionId: null,
    generatedByOptimizationId: null,
    changeReason: null,
    labels: [],
    isFrozen: true,
    createdBy: 'u-1',
    createdByDisplayName: 'Alice',
    createdAt: '2026-05-19T00:00:00.000Z',
    frozenAt: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function makePrompt(overrides: Partial<PromptDetailDto> = {}): PromptDetailDto {
  return {
    id: 'p-1',
    projectId: 'p-1',
    name: 'risk-judge',
    defaultDatasetId: 'd-1',
    defaultDatasetName: 'risk-eval',
    latestVersionNumber: 3,
    currentOnlineVersionNumber: 3,
    currentGrayVersionNumber: null,
    customLabels: [],
    latestVersionStatus: 'frozen',
    createdBy: 'u-1',
    createdByDisplayName: 'Alice',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    deletedAt: null,
    activeReferences: 0,
    versions: [makeVersion()],
    ...overrides,
  };
}

describe('mapDatasetToOption', () => {
  it('extracts expected field and input field count from fieldSchema', () => {
    const option = mapDatasetToOption(makeDataset());
    expect(option.expectedField).toBe('risk_level');
    expect(option.inputFieldCount).toBe(2);
    expect(option.sampleCount).toBe(2480);
    expect(option.allFieldsOk).toBe(true);
  });

  it('returns empty description when dto.description is null', () => {
    const option = mapDatasetToOption(makeDataset({ description: null }));
    expect(option.description).toBe('');
  });

  it('returns undefined expectedField when no expected_output role exists', () => {
    const option = mapDatasetToOption(
      makeDataset({
        fieldSchema: [
          { name: 'q', role: 'text', type: 'string' },
          { name: 'tag', role: 'metadata', type: 'string' },
        ],
      }),
    );
    expect(option.expectedField).toBeUndefined();
    expect(option.inputFieldCount).toBe(1);
  });

  it('handles multimodal (image) field as input', () => {
    const option = mapDatasetToOption(
      makeDataset({
        hasImages: true,
        fieldSchema: [
          { name: 'receipt', role: 'image', type: 'string' },
          { name: 'category', role: 'expected_output', type: 'string' },
        ],
      }),
    );
    expect(option.inputFieldCount).toBe(1);
    expect(option.expectedField).toBe('category');
  });
});

describe('mapProjectModelToOption', () => {
  it("maps image='none' to no image modality badge capability", () => {
    const option = mapProjectModelToOption(makeModel());
    expect(option.capabilities).toEqual([]);
    expect(option.imageCapability).toBe('none');
    expect(option.name).toBe('gpt-4o-mini');
    expect(option.provider).toBe('OpenAI');
    expect(option.contextWindow).toBe('128K');
    expect(option.rpm).toBe(600);
    expect(option.tpm).toBe('250K');
    expect(option.pricePer1Mt).toBe('0.15');
  });

  it.each([['url'], ['base64'], ['both']] as const)("keeps image='%s' as model image capability", (image) => {
    const option = mapProjectModelToOption(makeModel({ capabilities: { image } }));
    expect(option.imageCapability).toBe(image);
    expect(option.capabilities).not.toContain('vision');
  });

  it('formats unlimited rpm/tpm (limit=-1) as ∞', () => {
    const option = mapProjectModelToOption(
      makeModel({
        rpm: { limit: -1, usage: 0, current: 0 },
        tpm: { limit: -1, usage: 0, current: 0 },
      }),
    );
    expect(option.tpm).toBe('∞');
    // The rpm field type is number; entering -1 — the frontend UI does not display this number directly; pricePer1Mt and contextWindow are still correct
    expect(option.rpm).toBe(-1);
  });

  it('handles null contextWindowTokens', () => {
    const option = mapProjectModelToOption(makeModel({ contextWindowTokens: null }));
    expect(option.contextWindow).toBe('—');
  });
});

describe('mapPromptVersionToOption', () => {
  it('maps a frozen version with prompt preview and variables', () => {
    const prompt = makePrompt();
    const version = makeVersion();
    const option = mapPromptVersionToOption(prompt, version);
    expect(option.id).toBe('v-1');
    expect(option.name).toBe('risk-judge');
    expect(option.version).toBe('v3');
    expect(option.isLatest).toBe(true);
    expect(option.ownerHandle).toBe('@Alice');
    expect(option.status).toBe('frozen');
    expect(option.defaultDatasetId).toBe('d-1');
    expect(option.promptLanguage).toBe('zh-CN');
    expect(option.promptPreview).toContain('You are ...\n\n## 输出格式');
    expect(option.variables).toHaveLength(2);
    expect(option.variables[0]).toEqual({
      name: 'user_request',
      type: 'text',
      required: true,
      datasetField: null,
    });
  });

  it('marks isLatest=false when versionNumber differs from latest', () => {
    const prompt = makePrompt({ latestVersionNumber: 5 });
    const option = mapPromptVersionToOption(prompt, makeVersion({ versionNumber: 2, status: 'frozen' }));
    expect(option.isLatest).toBe(false);
    expect(option.version).toBe('v2');
    expect(option.status).toBe('frozen');
  });

  it('handles editable status', () => {
    const option = mapPromptVersionToOption(makePrompt(), makeVersion({ status: 'editable', isFrozen: false }));
    expect(option.status).toBe('editable');
  });

  it('renders prompt preview output instructions in the version prompt language', () => {
    const option = mapPromptVersionToOption(
      makePrompt(),
      makeVersion({
        body: 'Classify {{user_request}}',
        promptLanguage: 'en-US',
      }),
    );

    expect(option.promptPreview).toContain('Classify {{user_request}}\n\n## Output Format');
    expect(option.promptPreview).toContain('Output only a JSON object');
    expect(option.promptPreview).not.toContain('## 输出格式');
  });

  it('falls back to @unknown when createdByDisplayName is null', () => {
    const option = mapPromptVersionToOption(makePrompt(), makeVersion({ createdByDisplayName: null }));
    expect(option.ownerHandle).toBe('@unknown');
  });

  it('uses empty string for defaultDatasetId when prompt has none', () => {
    const option = mapPromptVersionToOption(makePrompt({ defaultDatasetId: null }), makeVersion());
    expect(option.defaultDatasetId).toBe('');
  });
});

describe('hasImagePromptVariables', () => {
  it('detects image modality prompt variables', () => {
    expect(hasImagePromptVariables([{ type: 'text' }, { type: 'image_url' }])).toBe(true);
    expect(hasImagePromptVariables([{ type: 'text' }, { type: 'number' }])).toBe(false);
  });
});

describe('validateDatasetVariableCoverage', () => {
  it('covers text, number, and image variables with compatible dataset field roles', () => {
    const result = validateDatasetVariableCoverage({
      variables: [
        { name: 'review', type: 'text' },
        { name: 'score', type: 'number' },
        { name: 'receipt', type: 'image' },
      ],
      fieldSchema: [
        { name: 'review', role: 'text', type: 'string' },
        { name: 'score', role: 'text', type: 'number' },
        { name: 'receipt', role: 'image_base64', type: 'string' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      coveredVariables: ['review', 'score', 'receipt'],
      missingVariables: [],
    });
  });

  it('reports variables missing by name or incompatible modality', () => {
    const result = validateDatasetVariableCoverage({
      variables: [
        { name: 'review', type: 'text' },
        { name: 'receipt', type: 'image_url' },
        { name: 'score', type: 'number' },
      ],
      fieldSchema: [
        { name: 'review', role: 'metadata', type: 'string' },
        { name: 'receipt', role: 'text', type: 'string' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.coveredVariables).toEqual([]);
    expect(result.missingVariables).toEqual(['review', 'receipt', 'score']);
  });

  it('uses datasetField mapping when a prompt variable points at a different field name', () => {
    const result = validateDatasetVariableCoverage({
      variables: [{ name: 'query', type: 'text', datasetField: 'user_input' }],
      fieldSchema: [{ name: 'user_input', role: 'text', type: 'string' }],
    });

    expect(result.ok).toBe(true);
    expect(result.coveredVariables).toEqual(['query']);
  });
});

describe('getModelImageEncodings', () => {
  it.each([
    ['none', []],
    ['url', ['url']],
    ['base64', ['base64']],
    ['both', ['url', 'base64']],
  ] as const)('maps image capability %s to encoding choices', (capability, expected) => {
    expect(getModelImageEncodings(capability)).toEqual(expected);
  });
});

describe('estimateExperimentRun', () => {
  it('returns dash placeholders for 0 samples', () => {
    const e = estimateExperimentRun({
      totalSamples: 0,
      concurrency: 24,
      rpmLimit: 600,
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
    });
    expect(e.totalSamples).toBe(0);
    expect(e.durationLabel).toBe('—');
    expect(e.tokensLabel).toBe('—');
    expect(e.costLabel).toBe('—');
  });

  it('computes tokens & cost from per-sample averages', () => {
    const e = estimateExperimentRun({
      totalSamples: 1000,
      concurrency: 10,
      rpmLimit: 600,
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
    });
    expect(e.tokensIn).toBe(1000 * AVG_TOKENS_IN_PER_SAMPLE);
    expect(e.tokensOut).toBe(1000 * AVG_TOKENS_OUT_PER_SAMPLE);
    // cost = (400_000 * 0.15 + 80_000 * 0.6) / 1_000_000 = 0.06 + 0.048 = 0.108
    expect(e.cost).toBeCloseTo(0.108, 5);
    expect(e.costLabel).toMatch(/^~ \$/);
    expect(e.durationLabel).toMatch(/^~/);
  });

  it('uses concurrency as throughput cap when rpm is unlimited', () => {
    const e = estimateExperimentRun({
      totalSamples: 600,
      concurrency: 10,
      rpmLimit: -1,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });
    expect(e.durationSeconds).toBeCloseTo(60, 5); // 600/10
  });

  it('uses rpm-derived throughput when it is below concurrency', () => {
    const e = estimateExperimentRun({
      totalSamples: 60,
      concurrency: 100,
      rpmLimit: 60, // 1 req/sec
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });
    expect(e.durationSeconds).toBeCloseTo(60, 5);
  });
});

describe('resolveExperimentDatasetId', () => {
  it('prefers an explicit dataset when it exists', () => {
    expect(
      resolveExperimentDatasetId({
        explicitDatasetId: 'd-2',
        promptDefaultDatasetId: 'd-1',
        datasetIds: ['d-1', 'd-2'],
      }),
    ).toBe('d-2');
  });

  it('uses the prompt default dataset before falling back to the first dataset', () => {
    expect(
      resolveExperimentDatasetId({
        explicitDatasetId: null,
        promptDefaultDatasetId: 'd-2',
        datasetIds: ['d-1', 'd-2'],
      }),
    ).toBe('d-2');
  });

  it('falls back to the first dataset when explicit/default ids are unavailable', () => {
    expect(
      resolveExperimentDatasetId({
        explicitDatasetId: 'missing',
        promptDefaultDatasetId: 'also-missing',
        datasetIds: ['d-1', 'd-2'],
      }),
    ).toBe('d-1');
    expect(resolveExperimentDatasetId({ datasetIds: [] })).toBeNull();
  });
});

describe('run parameter helpers', () => {
  it('normalizes temperature to the supported 0.0-2.0 range', () => {
    expect(normalizeTemperature(-1)).toBe(0);
    expect(normalizeTemperature(0.34)).toBe(0.3);
    expect(normalizeTemperature(0.36)).toBe(0.4);
    expect(normalizeTemperature(3)).toBe(2);
  });

  it('marks run params complete only when all required values are valid', () => {
    const complete = {
      concurrency: 16,
      rpm: '1000',
      tpm: '400000',
      temperature: 0,
      timeoutSeconds: '20',
      retries: '2',
      encoding: 'url' as const,
    };

    expect(isExperimentRunParamsComplete(complete)).toBe(true);
    expect(isExperimentRunParamsComplete({ ...complete, temperature: 2 })).toBe(true);
    expect(isExperimentRunParamsComplete({ ...complete, rpm: '' })).toBe(false);
    expect(isExperimentRunParamsComplete({ ...complete, temperature: 2.1 })).toBe(false);
    expect(isExperimentRunParamsComplete({ ...complete, retries: '-1' })).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('formatContextWindow handles K / M / null', () => {
    expect(formatContextWindow(null)).toBe('—');
    expect(formatContextWindow(0)).toBe('—');
    expect(formatContextWindow(128_000)).toBe('128K');
    expect(formatContextWindow(1_000_000)).toBe('1M');
    expect(formatContextWindow(1_500_000)).toBe('1.5M');
    expect(formatContextWindow(500)).toBe('500');
  });

  it('formatRateLimitNumber treats -1 as ∞', () => {
    expect(formatRateLimitNumber(-1)).toBe('∞');
    expect(formatRateLimitNumber(250_000)).toBe('250K');
    expect(formatRateLimitNumber(1_000_000)).toBe('1M');
  });

  it('formatTokenCount uses K / M', () => {
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(1_200)).toBe('1.2K');
    expect(formatTokenCount(1_040_000)).toBe('1.04M');
  });

  it('formatDurationLabel handles seconds / minutes / hours', () => {
    expect(formatDurationLabel(0)).toBe('—');
    expect(formatDurationLabel(45)).toBe('45 s');
    expect(formatDurationLabel(125)).toBe('2 m 5 s');
    expect(formatDurationLabel(120)).toBe('2 m');
    expect(formatDurationLabel(3700)).toBe('1 h 2 m');
    expect(formatDurationLabel(3600)).toBe('1 h');
  });
});
