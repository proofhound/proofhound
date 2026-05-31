import type { ModelImageCapability, ModelPreset } from '@proofhound/shared';

export interface ModelQuickFillDraft {
  key: string;
  name: string;
  providerType: string;
  providerLabel: string;
  providerModelId: string;
  endpoint: string;
  contextWindowTokens: number;
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
  inputTokenPricePerMillion: number;
  outputTokenPricePerMillion: number;
  imageCapability: ModelImageCapability;
  extraBodyInput: string;
}

export function modelPresetToQuickFillDraft(preset: ModelPreset): ModelQuickFillDraft {
  return {
    key: preset.key,
    name: preset.name,
    providerType: preset.providerType,
    providerLabel: preset.providerLabel,
    providerModelId: preset.providerModelId,
    endpoint: preset.endpoint,
    contextWindowTokens: preset.contextWindowTokens,
    rpmLimit: preset.rpmLimit,
    tpmLimit: preset.tpmLimit,
    concurrencyLimit: preset.concurrencyLimit,
    inputTokenPricePerMillion: preset.inputTokenPricePerMillion,
    outputTokenPricePerMillion: preset.outputTokenPricePerMillion,
    imageCapability: preset.capabilities.image,
    extraBodyInput: formatExtraBodyInput(preset.extraBody),
  };
}

function formatExtraBodyInput(extraBody: Record<string, unknown> | undefined): string {
  return extraBody && Object.keys(extraBody).length > 0 ? JSON.stringify(extraBody, null, 2) : '';
}
