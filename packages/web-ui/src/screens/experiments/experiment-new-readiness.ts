export interface ExperimentReadinessCheckingInput {
  dependenciesLoading: boolean;
  promptDetailLoading: boolean;
  promptsCount: number;
  promptVersionsCount: number;
  datasetsCount: number;
  compatibleModelsCount: number;
  selectedPromptSummary: unknown;
  selectedPrompt: unknown;
  selectedDataset: unknown;
  selectedModel: unknown;
}

export function isExperimentReadinessChecking(input: ExperimentReadinessCheckingInput): boolean {
  if (input.dependenciesLoading) return true;
  if (input.promptsCount > 0 && !input.selectedPromptSummary) return true;
  if (input.selectedPromptSummary && input.promptDetailLoading) return true;
  if (input.promptVersionsCount > 0 && !input.selectedPrompt) return true;
  if (input.datasetsCount > 0 && !input.selectedDataset) return true;
  if (input.compatibleModelsCount > 0 && !input.selectedModel) return true;
  return false;
}
