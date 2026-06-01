import { resolve } from 'node:path';
import { createLogger } from '@proofhound/logger';
import { StubLimiter } from '@proofhound/limiter';
import { testModelConnectivity, type ModelInvocationConfig } from '@proofhound/llm-client';
import { z } from 'zod';

const envSchema = z.object({
  MODEL_PROBE_PROVIDER_TYPE: z.string().trim().min(1),
  MODEL_PROBE_MODEL_ID: z.string().trim().min(1),
  MODEL_PROBE_ENDPOINT: z.string().trim().url(),
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

async function main(): Promise<void> {
  loadEnvFile();

  const env = envSchema.parse(process.env);
  const logger = createLogger('worker.model-probe', {
    service: 'worker',
    level: process.env.LOG_LEVEL,
  });
  const model: ModelInvocationConfig = {
    id: '00000000-0000-0000-0000-000000000000',
    providerType: env.MODEL_PROBE_PROVIDER_TYPE,
    providerModelId: env.MODEL_PROBE_MODEL_ID,
    endpoint: env.MODEL_PROBE_ENDPOINT,
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
