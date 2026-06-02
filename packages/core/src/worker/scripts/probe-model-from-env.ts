import { resolve } from 'node:path';
import { createLogger } from '@proofhound/logger';
import { StubLimiter } from '@proofhound/limiter';
import { testModelConnectivity, type ModelInvocationConfig } from '@proofhound/llm-client';
import { z } from 'zod';

const PROBE_PROTOCOL_DEFAULTS = {
  openai: {
    providerModelId: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1',
  },
  anthropic: {
    providerModelId: 'claude-sonnet-4-6',
    endpoint: 'https://api.anthropic.com',
  },
} as const;

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const envSchema = z.object({
  MODEL_PROBE_PROVIDER_TYPE: optionalTrimmedString,
  MODEL_PROBE_MODEL_ID: optionalTrimmedString,
  MODEL_PROBE_ENDPOINT: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().url().optional()),
  MODEL_PROBE_API_KEY: z.string().trim().min(1),
  MODEL_PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MODEL_PROBE_IMAGE_CAPABILITY: z.enum(['none', 'url', 'base64', 'both']).default('none'),
  MODEL_PROBE_RPM_LIMIT: z.coerce.number().int().positive().default(60),
  MODEL_PROBE_TPM_LIMIT: z.coerce.number().int().positive().default(100_000),
  MODEL_PROBE_CONCURRENCY_LIMIT: z.coerce.number().int().positive().default(1),
  MODEL_PROBE_INPUT_PRICE_PER_MILLION: z.coerce.number().nonnegative().default(0),
  MODEL_PROBE_OUTPUT_PRICE_PER_MILLION: z.coerce.number().nonnegative().default(0),
});

function loadEnvFile(): void {
  for (const candidate of [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')]) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // Try the next conventional location.
    }
  }
}

function normalizeProviderType(providerType: string): string {
  return providerType.trim().toLowerCase().replace(/_/gu, '-');
}

function resolveProbeModelEnv(env: z.infer<typeof envSchema>): Pick<
  ModelInvocationConfig,
  'providerType' | 'providerModelId' | 'endpoint'
> {
  const providerType = normalizeProviderType(env.MODEL_PROBE_PROVIDER_TYPE ?? 'openai');
  const defaults = PROBE_PROTOCOL_DEFAULTS[providerType as keyof typeof PROBE_PROTOCOL_DEFAULTS];
  const providerModelId = env.MODEL_PROBE_MODEL_ID ?? defaults?.providerModelId;
  const endpoint = env.MODEL_PROBE_ENDPOINT ?? defaults?.endpoint;

  if (!providerModelId) {
    throw new Error(`MODEL_PROBE_MODEL_ID is required for provider type "${providerType}"`);
  }
  if (!endpoint) {
    throw new Error(`MODEL_PROBE_ENDPOINT is required for provider type "${providerType}"`);
  }

  return { providerType, providerModelId, endpoint };
}

async function main(): Promise<void> {
  loadEnvFile();

  const env = envSchema.parse(process.env);
  const resolvedModelEnv = resolveProbeModelEnv(env);
  const logger = createLogger('worker.model-probe', {
    service: 'worker',
    level: process.env.LOG_LEVEL,
  });
  const model: ModelInvocationConfig = {
    id: '00000000-0000-0000-0000-000000000000',
    providerType: resolvedModelEnv.providerType,
    providerModelId: resolvedModelEnv.providerModelId,
    endpoint: resolvedModelEnv.endpoint,
    apiKey: env.MODEL_PROBE_API_KEY,
    capabilities: { image: env.MODEL_PROBE_IMAGE_CAPABILITY },
    rpmLimit: env.MODEL_PROBE_RPM_LIMIT,
    tpmLimit: env.MODEL_PROBE_TPM_LIMIT,
    concurrencyLimit: env.MODEL_PROBE_CONCURRENCY_LIMIT,
    autoConcurrency: false,
    inputTokenPricePerMillion: env.MODEL_PROBE_INPUT_PRICE_PER_MILLION,
    outputTokenPricePerMillion: env.MODEL_PROBE_OUTPUT_PRICE_PER_MILLION,
  };

  const result = await testModelConnectivity(
    {
      model,
      requestId: `env-probe-${Date.now()}`,
      timeoutMs: env.MODEL_PROBE_TIMEOUT_MS,
    },
    {
      limiter: new StubLimiter(),
      logger,
    },
  );

  if (result.ok) {
    console.warn(
      JSON.stringify(
        {
          ok: true,
          providerType: result.providerType,
          providerModelId: result.providerModelId,
          endpoint: result.endpoint,
          durationMs: result.durationMs,
          responsePreview: result.responsePreview,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(
    JSON.stringify(
      {
        ok: false,
        providerType: result.providerType,
        providerModelId: result.providerModelId,
        endpoint: result.endpoint,
        durationMs: result.durationMs,
        errorClass: result.errorClass,
        errorMessage: result.errorMessage,
        httpStatus: result.httpStatus,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
