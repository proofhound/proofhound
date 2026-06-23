import {
  MODEL_DEFAULT_CONCURRENCY_LIMIT,
  MODEL_UNLIMITED_RATE_LIMIT,
  type ModelImageCapability,
  type SupportedModelProviderType,
} from './dto/model.dto';

export type ModelPresetGroup = 'openai' | 'claude' | 'deepseek' | 'kimi' | 'minimax' | 'qwen' | 'ernie';

export interface ModelPreset {
  key: string;
  group: ModelPresetGroup;
  name: string;
  providerType: SupportedModelProviderType;
  providerLabel: string;
  providerModelId: string;
  endpoint: string;
  contextWindowTokens: number;
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
  inputTokenPricePerMillion: number;
  outputTokenPricePerMillion: number;
  capabilities: {
    image: ModelImageCapability;
  };
  extraBody?: Record<string, unknown>;
  featured?: boolean;
}

export const MODEL_PRESET_GROUPS: Array<{ key: ModelPresetGroup; label: string }> = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'claude', label: 'Claude' },
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'kimi', label: 'KIMI' },
  { key: 'minimax', label: 'MiniMax' },
  { key: 'qwen', label: 'Qwen' },
  { key: 'ernie', label: 'ERNIE' },
];

const UNPUBLISHED_RATE_LIMITS = {
  rpmLimit: MODEL_UNLIMITED_RATE_LIMIT,
  tpmLimit: MODEL_UNLIMITED_RATE_LIMIT,
};

const openAiTier1Limits = {
  rpmLimit: 500,
  tpmLimit: 500_000,
};

const anthropicOpusTier1Limits = {
  rpmLimit: 50,
  tpmLimit: 580_000,
};

const anthropicSonnetTier1Limits = {
  rpmLimit: 50,
  tpmLimit: 38_000,
};

const anthropicHaikuTier1Limits = {
  rpmLimit: 50,
  tpmLimit: 60_000,
};

const textPreset = {
  ...UNPUBLISHED_RATE_LIMITS,
  concurrencyLimit: MODEL_DEFAULT_CONCURRENCY_LIMIT,
  inputTokenPricePerMillion: 0,
  outputTokenPricePerMillion: 0,
  capabilities: { image: 'none' as const },
};

const visionPreset = {
  ...textPreset,
  capabilities: { image: 'both' as const },
};

export const MODEL_PRESETS: ModelPreset[] = [
  {
    ...visionPreset,
    key: 'openai:gpt-5.5',
    group: 'openai',
    name: 'OpenAI GPT-5.5',
    providerType: 'openai',
    providerLabel: 'OpenAI',
    providerModelId: 'gpt-5.5',
    endpoint: 'https://api.openai.com/v1',
    contextWindowTokens: 1_000_000,
    ...openAiTier1Limits,
    inputTokenPricePerMillion: 5,
    outputTokenPricePerMillion: 30,
    featured: true,
  },
  {
    ...visionPreset,
    key: 'openai:gpt-5.4',
    group: 'openai',
    name: 'OpenAI GPT-5.4',
    providerType: 'openai',
    providerLabel: 'OpenAI',
    providerModelId: 'gpt-5.4',
    endpoint: 'https://api.openai.com/v1',
    contextWindowTokens: 1_000_000,
    ...openAiTier1Limits,
    inputTokenPricePerMillion: 2.5,
    outputTokenPricePerMillion: 15,
  },
  {
    ...visionPreset,
    key: 'openai:gpt-5.4-mini',
    group: 'openai',
    name: 'OpenAI GPT-5.4 Mini',
    providerType: 'openai',
    providerLabel: 'OpenAI',
    providerModelId: 'gpt-5.4-mini',
    endpoint: 'https://api.openai.com/v1',
    contextWindowTokens: 400_000,
    ...openAiTier1Limits,
    inputTokenPricePerMillion: 0.75,
    outputTokenPricePerMillion: 4.5,
  },
  {
    ...visionPreset,
    key: 'claude:opus-4.7',
    group: 'claude',
    name: 'Claude Opus 4.7',
    providerType: 'anthropic',
    providerLabel: 'Claude / Anthropic',
    providerModelId: 'claude-opus-4-7',
    endpoint: 'https://api.anthropic.com',
    contextWindowTokens: 1_000_000,
    ...anthropicOpusTier1Limits,
    inputTokenPricePerMillion: 5,
    outputTokenPricePerMillion: 25,
    featured: true,
  },
  {
    ...visionPreset,
    key: 'claude:sonnet-4.6',
    group: 'claude',
    name: 'Claude Sonnet 4.6',
    providerType: 'anthropic',
    providerLabel: 'Claude / Anthropic',
    providerModelId: 'claude-sonnet-4-6',
    endpoint: 'https://api.anthropic.com',
    contextWindowTokens: 1_000_000,
    ...anthropicSonnetTier1Limits,
    inputTokenPricePerMillion: 3,
    outputTokenPricePerMillion: 15,
  },
  {
    ...visionPreset,
    key: 'claude:haiku-4.5',
    group: 'claude',
    name: 'Claude Haiku 4.5',
    providerType: 'anthropic',
    providerLabel: 'Claude / Anthropic',
    providerModelId: 'claude-haiku-4-5-20251001',
    endpoint: 'https://api.anthropic.com',
    contextWindowTokens: 200_000,
    ...anthropicHaikuTier1Limits,
    inputTokenPricePerMillion: 1,
    outputTokenPricePerMillion: 5,
  },
  {
    ...textPreset,
    key: 'deepseek:v4-pro',
    group: 'deepseek',
    name: 'DeepSeek V4 Pro',
    providerType: 'openai',
    providerLabel: 'DeepSeek',
    providerModelId: 'deepseek-v4-pro',
    endpoint: 'https://api.deepseek.com/chat/completions',
    contextWindowTokens: 1_000_000,
    inputTokenPricePerMillion: 0.435,
    outputTokenPricePerMillion: 0.87,
    featured: true,
  },
  {
    ...textPreset,
    key: 'deepseek:v4-flash',
    group: 'deepseek',
    name: 'DeepSeek V4 Flash',
    providerType: 'openai',
    providerLabel: 'DeepSeek',
    providerModelId: 'deepseek-v4-flash',
    endpoint: 'https://api.deepseek.com/chat/completions',
    contextWindowTokens: 1_000_000,
    inputTokenPricePerMillion: 0.14,
    outputTokenPricePerMillion: 0.28,
  },
  {
    ...visionPreset,
    key: 'kimi:k2.6',
    group: 'kimi',
    name: 'KIMI K2.6',
    providerType: 'openai',
    providerLabel: 'KIMI / Moonshot',
    providerModelId: 'kimi-k2.6',
    endpoint: 'https://api.moonshot.ai/v1',
    contextWindowTokens: 256_000,
    inputTokenPricePerMillion: 0.95,
    outputTokenPricePerMillion: 4,
    featured: true,
  },
  {
    ...visionPreset,
    key: 'kimi:k2.5',
    group: 'kimi',
    name: 'KIMI K2.5',
    providerType: 'openai',
    providerLabel: 'KIMI / Moonshot',
    providerModelId: 'kimi-k2.5',
    endpoint: 'https://api.moonshot.ai/v1',
    contextWindowTokens: 256_000,
    inputTokenPricePerMillion: 0.6,
    outputTokenPricePerMillion: 3,
  },
  {
    ...textPreset,
    key: 'minimax:m2.7',
    group: 'minimax',
    name: 'MiniMax M2.7',
    providerType: 'openai',
    providerLabel: 'MiniMax',
    providerModelId: 'MiniMax-M2.7',
    endpoint: 'https://api.minimaxi.com/v1',
    contextWindowTokens: 204_800,
    rpmLimit: 500,
    tpmLimit: 20_000_000,
    inputTokenPricePerMillion: 0.3,
    outputTokenPricePerMillion: 1.2,
    featured: true,
  },
  {
    ...textPreset,
    key: 'minimax:m2.7-highspeed',
    group: 'minimax',
    name: 'MiniMax M2.7 Highspeed',
    providerType: 'openai',
    providerLabel: 'MiniMax',
    providerModelId: 'MiniMax-M2.7-highspeed',
    endpoint: 'https://api.minimaxi.com/v1',
    contextWindowTokens: 204_800,
    rpmLimit: 500,
    tpmLimit: 20_000_000,
    inputTokenPricePerMillion: 0.6,
    outputTokenPricePerMillion: 2.4,
  },
  {
    ...visionPreset,
    key: 'qwen:qwen3.6-max-preview',
    group: 'qwen',
    name: 'Qwen 3.6 Max Preview',
    providerType: 'openai',
    providerLabel: 'Qwen / DashScope',
    providerModelId: 'qwen3.6-max-preview',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextWindowTokens: 256_000,
    rpmLimit: 600,
    tpmLimit: 1_000_000,
    inputTokenPricePerMillion: 1.29,
    outputTokenPricePerMillion: 7.76,
    featured: true,
  },
  {
    ...visionPreset,
    key: 'qwen:qwen3.6-plus',
    group: 'qwen',
    name: 'Qwen 3.6 Plus',
    providerType: 'openai',
    providerLabel: 'Qwen / DashScope',
    providerModelId: 'qwen3.6-plus',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextWindowTokens: 1_000_000,
    rpmLimit: 30_000,
    tpmLimit: 5_000_000,
    inputTokenPricePerMillion: 0.29,
    outputTokenPricePerMillion: 1.72,
  },
  {
    ...visionPreset,
    key: 'qwen:qwen3.6-flash',
    group: 'qwen',
    name: 'Qwen 3.6 Flash',
    providerType: 'openai',
    providerLabel: 'Qwen / DashScope',
    providerModelId: 'qwen3.6-flash',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextWindowTokens: 1_000_000,
    rpmLimit: 30_000,
    tpmLimit: 10_000_000,
    inputTokenPricePerMillion: 0.17,
    outputTokenPricePerMillion: 1.03,
  },
  {
    ...textPreset,
    key: 'ernie:4.5-turbo-20260402',
    group: 'ernie',
    name: 'ERNIE 4.5 Turbo',
    providerType: 'openai',
    providerLabel: 'ERNIE / Qianfan',
    providerModelId: 'ernie-4.5-turbo-20260402',
    endpoint: 'https://qianfan.baidubce.com/v2',
    contextWindowTokens: 128_000,
    rpmLimit: 60,
    tpmLimit: 150_000,
    inputTokenPricePerMillion: 0.11,
    outputTokenPricePerMillion: 0.46,
    featured: true,
  },
  {
    ...visionPreset,
    key: 'ernie:4.5-turbo-vl',
    group: 'ernie',
    name: 'ERNIE 4.5 Turbo VL',
    providerType: 'openai',
    providerLabel: 'ERNIE / Qianfan',
    providerModelId: 'ernie-4.5-turbo-vl',
    endpoint: 'https://qianfan.baidubce.com/v2',
    contextWindowTokens: 128_000,
    rpmLimit: 1_000,
    tpmLimit: 200_000,
    inputTokenPricePerMillion: 0.43,
    outputTokenPricePerMillion: 1.29,
  },
];
