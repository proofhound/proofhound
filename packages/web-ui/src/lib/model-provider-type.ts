import { SUPPORTED_MODEL_PROVIDER_TYPES, type SupportedModelProviderType } from '@proofhound/shared';

const PROVIDER_TYPE_LABELS: Record<SupportedModelProviderType, string> = {
  openai: 'OpenAI',
  'azure-openai': 'Azure OpenAI',
  anthropic: 'Claude / Anthropic',
  deepseek: 'DeepSeek',
  kimi: 'KIMI / Moonshot',
  minimax: 'MiniMax',
  qwen: 'Qwen / DashScope',
  ernie: 'ERNIE / Qianfan',
};

export interface ProviderTypeOption {
  value: string;
  label: string;
}

export function getProviderTypeLabel(providerType: string): string {
  return (PROVIDER_TYPE_LABELS as Record<string, string>)[providerType] ?? providerType;
}

// If the current value is legacy data (such as an 'azure' alias / case differences / a retired adapter),
// prepend it as an extra option so the dropdown is not empty when editing existing models.
export function buildProviderTypeOptions(currentValue?: string): ProviderTypeOption[] {
  const baseOptions: ProviderTypeOption[] = SUPPORTED_MODEL_PROVIDER_TYPES.map((value) => ({
    value,
    label: PROVIDER_TYPE_LABELS[value],
  }));

  const normalized = currentValue?.trim() ?? '';
  if (normalized && !baseOptions.some((option) => option.value === normalized)) {
    baseOptions.unshift({ value: normalized, label: getProviderTypeLabel(normalized) });
  }
  return baseOptions;
}
