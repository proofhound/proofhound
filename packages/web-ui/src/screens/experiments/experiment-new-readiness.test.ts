import { describe, expect, it } from 'vitest';
import { isExperimentReadinessChecking } from './experiment-new-readiness';

const settledInput = {
  dependenciesLoading: false,
  promptDetailLoading: false,
  promptsCount: 1,
  promptVersionsCount: 1,
  datasetsCount: 1,
  compatibleModelsCount: 1,
  selectedPromptSummary: { id: 'prompt' },
  selectedPrompt: { id: 'version' },
  selectedDataset: { id: 'dataset' },
  selectedModel: { id: 'model' },
};

describe('isExperimentReadinessChecking', () => {
  it('stays pending while dependencies are loading', () => {
    expect(isExperimentReadinessChecking({ ...settledInput, dependenciesLoading: true })).toBe(true);
  });

  it('stays pending while default selections are being applied', () => {
    expect(isExperimentReadinessChecking({ ...settledInput, selectedPromptSummary: null })).toBe(true);
    expect(isExperimentReadinessChecking({ ...settledInput, selectedPrompt: null })).toBe(true);
    expect(isExperimentReadinessChecking({ ...settledInput, selectedDataset: null })).toBe(true);
    expect(isExperimentReadinessChecking({ ...settledInput, selectedModel: null })).toBe(true);
  });

  it('stays pending while the selected prompt version details load', () => {
    expect(isExperimentReadinessChecking({ ...settledInput, promptDetailLoading: true })).toBe(true);
  });

  it('settles once dependencies and default selections are ready', () => {
    expect(isExperimentReadinessChecking(settledInput)).toBe(false);
  });

  it('does not hide real empty-project blocking states after loading finishes', () => {
    expect(
      isExperimentReadinessChecking({
        ...settledInput,
        promptsCount: 0,
        promptVersionsCount: 0,
        datasetsCount: 0,
        compatibleModelsCount: 0,
        selectedPromptSummary: null,
        selectedPrompt: null,
        selectedDataset: null,
        selectedModel: null,
      }),
    ).toBe(false);
  });
});
