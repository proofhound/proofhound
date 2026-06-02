export type DevModelFixture = {
  id: string;
  name: string;
  providerType: string;
  providerModelId: string;
  endpoint: string;
  contextWindowTokens: number | null;
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
  inputTokenPricePerMillion: string;
  outputTokenPricePerMillion: string;
  capabilities: {
    image: 'none' | 'url' | 'base64' | 'both';
  };
  extraBody: Record<string, unknown>;
  isActive: boolean;
};

export const DEV_MODELS: DevModelFixture[] = [
  {
    id: 'e656b649-b7d5-48da-bc88-a54f78754a6f',
    name: 'ERNIE 4.5 Turbo',
    providerType: 'ernie',
    providerModelId: 'ernie-4.5-turbo-20260402',
    endpoint: 'https://qianfan.baidubce.com/v2',
    contextWindowTokens: 128000,
    rpmLimit: 30,
    tpmLimit: 150000,
    concurrencyLimit: 20,
    inputTokenPricePerMillion: '0.110000',
    outputTokenPricePerMillion: '0.460000',
    capabilities: {
      image: 'none',
    },
    extraBody: {},
    isActive: true,
  },
  {
    id: '45be9255-88d5-4e32-b650-ba624f33c8f0',
    name: 'Claude Sonnet 4.6',
    providerType: 'anthropic',
    providerModelId: 'claude-sonnet-4-6',
    endpoint: 'http://147.182.200.106:3000/api',
    contextWindowTokens: 1000000,
    rpmLimit: 20,
    tpmLimit: 38000,
    concurrencyLimit: 10,
    inputTokenPricePerMillion: '3.000000',
    outputTokenPricePerMillion: '15.000000',
    capabilities: {
      image: 'both',
    },
    extraBody: {},
    isActive: true,
  },
  {
    id: '826d092f-0afa-4e01-b223-d608d1db519d',
    name: 'ERNIE 5.0',
    providerType: 'ernie',
    providerModelId: 'ernie-5.0',
    endpoint: 'https://qianfan.baidubce.com/v2',
    contextWindowTokens: 128000,
    rpmLimit: 30,
    tpmLimit: 150000,
    concurrencyLimit: 20,
    inputTokenPricePerMillion: '0.110000',
    outputTokenPricePerMillion: '0.460000',
    capabilities: {
      image: 'none',
    },
    extraBody: {},
    isActive: true,
  },
];
