import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_OVERALL_QUALITY_DIMENSION,
  deriveExperimentDisplayStatus,
  derivePromptModalityKinds,
  getExperimentComparisonClassLabels,
  getExperimentComparisonMetricDomainMax,
  getExperimentComparisonMetricValue,
  hasImagePromptVariable,
  type ExperimentSummary,
} from './experiment-view-model';

describe('deriveExperimentDisplayStatus', () => {
  it('shows running experiments with stop control as stopping', () => {
    expect(deriveExperimentDisplayStatus('running', 'stop')).toBe('stopping');
    expect(deriveExperimentDisplayStatus('running', null)).toBe('running');
    expect(deriveExperimentDisplayStatus('success', 'stop')).toBe('success');
    expect(deriveExperimentDisplayStatus('cancelled', 'stop')).toBe('stopped');
  });
});

describe('derivePromptModalityKinds', () => {
  it('returns text → image → number order regardless of input order', () => {
    expect(derivePromptModalityKinds(['image', 'text', 'number'])).toEqual(['text', 'image', 'number']);
    expect(derivePromptModalityKinds(['number', 'image_url', 'text'])).toEqual(['text', 'image', 'number']);
  });

  it('collapses image / image_url / image_base64 to a single image kind', () => {
    expect(derivePromptModalityKinds(['image_url', 'image_base64', 'text'])).toEqual(['text', 'image']);
    expect(derivePromptModalityKinds(['image', 'image_url'])).toEqual(['image']);
  });

  it('ignores unknown variable types', () => {
    expect(derivePromptModalityKinds(['text', 'unknown_type', 'number'])).toEqual(['text', 'number']);
  });

  it('returns empty array for empty input', () => {
    expect(derivePromptModalityKinds([])).toEqual([]);
  });
});

describe('hasImagePromptVariable', () => {
  it('returns true for any image variant', () => {
    expect(hasImagePromptVariable(['image'])).toBe(true);
    expect(hasImagePromptVariable(['image_url'])).toBe(true);
    expect(hasImagePromptVariable(['image_base64'])).toBe(true);
    expect(hasImagePromptVariable(['text', 'image_url'])).toBe(true);
  });

  it('returns false when no image variant present', () => {
    expect(hasImagePromptVariable(['text', 'number'])).toBe(false);
    expect(hasImagePromptVariable([])).toBe(false);
  });
});

describe('experiment comparison metrics', () => {
  it('derives total token usage from input and output tokens', () => {
    const experiment = {
      inputTokens: 120,
      outputTokens: 45,
      failedSamples: 2,
    } as ExperimentSummary;

    expect(getExperimentComparisonMetricValue(experiment, 'totalTokens')).toBe(165);
    expect(getExperimentComparisonMetricValue(experiment, 'failedSamples')).toBe(2);
  });

  it('keeps quality metrics on a fixed 0-1 domain and scales engineering metrics from data', () => {
    const experiments = [
      { accuracy: 0.91, p95LatencyMs: 900, failedSamples: 0 } as ExperimentSummary,
      { accuracy: 0.83, p95LatencyMs: 1250, failedSamples: 3 } as ExperimentSummary,
    ];

    expect(getExperimentComparisonMetricDomainMax(experiments, 'accuracy')).toBe(1);
    expect(getExperimentComparisonMetricDomainMax(experiments, 'p95LatencyMs')).toBe(1250);
    expect(getExperimentComparisonMetricDomainMax(experiments, 'failedSamples')).toBe(3);
  });

  it('reads quality metric values from the selected per-class dimension', () => {
    const experiments = [
      {
        accuracy: 0.91,
        precision: 0.9,
        perClassMetrics: [
          { label: 'high', precision: 0.72, recall: 0.64, f1: 0.68, support: 20 },
          { label: 'low', precision: 0.88, recall: 0.91, f1: 0.89, support: 45 },
        ],
      } as ExperimentSummary,
      {
        accuracy: 0.83,
        perClassMetrics: [{ label: 'high', precision: 0.8, recall: null, f1: 0.76, support: 12 }],
      } as ExperimentSummary,
    ];

    expect(getExperimentComparisonClassLabels(experiments)).toEqual(['high', 'low']);
    expect(getExperimentComparisonMetricValue(experiments[0]!, 'precision', EXPERIMENT_OVERALL_QUALITY_DIMENSION)).toBe(
      0.9,
    );
    expect(getExperimentComparisonMetricValue(experiments[0]!, 'precision', 'high')).toBe(0.72);
    expect(getExperimentComparisonMetricValue(experiments[1]!, 'recall', 'high')).toBeUndefined();
    expect(getExperimentComparisonMetricValue(experiments[0]!, 'accuracy', 'high')).toBeUndefined();
    expect(getExperimentComparisonMetricDomainMax(experiments, 'precision', 'high')).toBe(1);
  });
});
