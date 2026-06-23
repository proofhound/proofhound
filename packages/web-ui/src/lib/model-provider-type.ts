import { SUPPORTED_MODEL_PROVIDER_TYPES, type SupportedModelProviderType } from '@proofhound/shared';

const PROVIDER_TYPE_LABELS: Partial<Record<SupportedModelProviderType, string>> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic Messages',
};

const LEGACY_PROVIDER_TYPE_LABELS: Record<string, string> = {
  'azure-openai': 'Azure OpenAI (legacy)',
  azure: 'Azure OpenAI (legacy)',
  deepseek: 'DeepSeek (OpenAI-compatible legacy)',
  kimi: 'KIMI / Moonshot (OpenAI-compatible legacy)',
  minimax: 'MiniMax (OpenAI-compatible legacy)',
  qwen: 'Qwen / DashScope (OpenAI-compatible legacy)',
  ernie: 'ERNIE / Qianfan (OpenAI-compatible legacy)',
};

const OPENAI_COMPATIBLE_LEGACY_PROVIDER_TYPES = new Set([
  'azure',
  'azure-openai',
  'deepseek',
  'kimi',
  'minimax',
  'qwen',
  'ernie',
]);

export interface ProviderTypeOption {
  value: string;
  label: string;
}

export function getProviderTypeLabel(providerType: string): string {
  const normalized = normalizeProviderTypeLabelKey(providerType);
  return (
    (PROVIDER_TYPE_LABELS as Record<string, string>)[normalized] ??
    LEGACY_PROVIDER_TYPE_LABELS[normalized] ??
    providerType
  );
}

export function getCanonicalProviderTypeValue(providerType: string): string {
  const normalized = normalizeProviderTypeLabelKey(providerType);
  if (OPENAI_COMPATIBLE_LEGACY_PROVIDER_TYPES.has(normalized)) return 'openai';
  if (normalized === 'claude') return 'anthropic';
  return normalized;
}

// If the current value is legacy data (such as a vendor alias / case differences / a retired adapter),
// prepend it as an extra option so the dropdown is not empty when editing existing models.
export function buildProviderTypeOptions(currentValue?: string): ProviderTypeOption[] {
  const baseOptions: ProviderTypeOption[] = SUPPORTED_MODEL_PROVIDER_TYPES.map((value) => ({
    value,
    label: PROVIDER_TYPE_LABELS[value] ?? value,
  }));

  const normalized = currentValue?.trim() ?? '';
  if (normalized && !baseOptions.some((option) => option.value === normalized)) {
    baseOptions.unshift({ value: normalized, label: getProviderTypeLabel(normalized) });
  }
  return baseOptions;
}

function normalizeProviderTypeLabelKey(providerType: string): string {
  return providerType.trim().toLowerCase().replace(/_/gu, '-');
}
