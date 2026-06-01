import { RateLimitExceededError } from '@proofhound/limiter';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  invokeLLM,
  normalizeLLMError,
  testModelConnectivity,
  type InvokeLLMArgs,
  type LLMAdapter,
} from './invoke';
import { LLMAdapterHttpError } from './providers/openai.adapter';

const model = {
  id: '11111111-1111-1111-1111-111111111111',
  providerType: 'fake',
  providerModelId: 'fake-model',
  endpoint: 'https://llm.example.test/v1',
  apiKey: 'secret',
  rpmLimit: 60,
  tpmLimit: 1000,
  concurrencyLimit: 2,
  autoConcurrency: false,
  inputTokenPricePerMillion: 2,
  outputTokenPricePerMillion: 4,
};

const runResult = {
  id: '22222222-2222-2222-2222-222222222222',
  projectId: '33333333-3333-3333-3333-333333333333',
  source: 'experiment' as const,
  sourceId: '44444444-4444-4444-4444-444444444444',
  promptVersionId: '55555555-5555-5555-5555-555555555555',
  modelId: model.id,
  renderedPrompt: { messages: [{ role: 'user', content: 'hello' }] },
  attempt: 1,
};

function baseArgs(): InvokeLLMArgs {
  return {
    model,
    limiterKey: `model:${model.id}`,
    messages: [{ role: 'user', content: 'hello' }],
    params: { maxTokens: 8, temperature: 0 },
    context: { requestId: 'req-1', dbosWorkflowId: 'wf-1', bullmqJobId: 'job-1', bullmqQueue: 'llm' },
    runResult,
  };
}

async function createImageDataUrl(width: number, height: number): Promise<string> {
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#336699',
    },
  })
    .jpeg({ quality: 92 })
    .toBuffer();

  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

describe('invokeLLM', () => {
  it('acquires limits, logs the full successful call before writing the run result, then releases', async () => {
    const order: string[] = [];
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        order.push('provider');
        return {
          content: '{"ok":true}',
          rawResponse: { id: 'resp-1' },
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    };
    const limiter = {
      acquire: vi.fn(async () => {
        order.push('acquire');
      }),
      release: vi.fn(async () => {
        order.push('release');
      }),
    };
    const logger = {
      info: vi.fn((_payload: Record<string, unknown>, message: string) => {
        order.push(message);
      }),
      error: vi.fn(),
    };
    const runResultWriter = {
      writeRunResult: vi.fn(async () => {
        order.push('write');
      }),
    };

    const result = await invokeLLM(baseArgs(), {
      limiter,
      logger,
      runResultWriter,
      adapters: [adapter],
      now: (() => {
        let current = 1000;
        return () => {
          current += 25;
          return current;
        };
      })(),
    });

    expect(order).toEqual([
      'acquire',
      'llm_call_request_sent',
      'provider',
      'llm_call_completed',
      'write',
      'release',
    ]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.costEstimate).toBe(0.00004);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        messages: baseArgs().messages,
        request: expect.objectContaining({
          method: 'POST',
          url: 'https://llm.example.test/v1',
          body: expect.objectContaining({
            model: 'fake-model',
            messages: baseArgs().messages,
            max_tokens: 8,
            temperature: 0,
          }),
        }),
        estimatedTokens: expect.any(Number),
        maxRetries: 0,
      }),
      'llm_call_request_sent',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        dbosWorkflowId: 'wf-1',
        bullmqJobId: 'job-1',
        bullmqQueue: 'llm',
        runResultId: runResult.id,
        messages: baseArgs().messages,
        response: expect.objectContaining({
          content: '{"ok":true}',
          raw: { id: 'resp-1' },
        }),
      }),
      'llm_call_completed',
    );
    expect(runResultWriter.writeRunResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: runResult.id,
        status: 'success',
        rawResponse: '{"ok":true}',
        inputTokens: 10,
        outputTokens: 5,
      }),
    );
  });

  it('passes roundIndex from RunResultContext through to writeRunResult (optimization path)', async () => {
    // Optimization LLM calls must pass roundIndex through to the run_results row; otherwise the detail page's
    // listOptimizationLlmRunResults isNotNull(round_index) filter drops the whole row.
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        return {
          content: '{"ok":true}',
          rawResponse: { id: 'resp-1' },
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    };
    const limiter = { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const writeRunResult = vi.fn(async () => undefined);
    const args = baseArgs();
    args.runResult = { ...runResult, source: 'optimization_analysis' as const, roundIndex: 3 };

    await invokeLLM(args, {
      limiter,
      logger,
      runResultWriter: { writeRunResult },
      adapters: [adapter],
    });

    expect(writeRunResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: runResult.id,
        source: 'optimization_analysis',
        roundIndex: 3,
      }),
    );
  });

  it('passes webhookTokenId from RunResultContext through to writeRunResult (webhook entry attribution)', async () => {
    // Webhook-triggered runs must persist webhook_token_id for per-consumer attribution (SPEC 08 §3.4 / §5);
    // HTTP / MCP / internal entries leave runResult.webhookTokenId undefined so the column stays NULL.
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        return {
          content: '{"ok":true}',
          rawResponse: { id: 'resp-1' },
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    };
    const limiter = { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const writeRunResult = vi.fn(async () => undefined);
    const args = baseArgs();
    args.runResult = { ...runResult, webhookTokenId: 'a1b2c3d4-e5f6-4789-a012-345678907777' };

    await invokeLLM(args, {
      limiter,
      logger,
      runResultWriter: { writeRunResult },
      adapters: [adapter],
    });

    expect(writeRunResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: runResult.id,
        webhookTokenId: 'a1b2c3d4-e5f6-4789-a012-345678907777',
      }),
    );
  });

  it('normalizes Anthropic Opus 4.7 sampling params before invoking the provider', async () => {
    const adapter: LLMAdapter = {
      providerType: 'anthropic',
      async invoke(args) {
        expect(args.params).not.toHaveProperty('temperature');
        expect(args.params).not.toHaveProperty('topP');
        expect(args.params.maxTokens).toBe(8);
        return {
          content: '{}',
          rawResponse: { id: 'resp-1' },
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const limiter = { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const args = baseArgs();

    await invokeLLM(
      {
        ...args,
        model: { ...args.model, providerType: 'anthropic', providerModelId: 'claude-opus-4-7' },
        params: { maxTokens: 8, temperature: 0, topP: 0.9 },
      },
      { limiter, logger, adapters: [adapter] },
    );
  });

  it('defaults roundIndex to null when RunResultContext omits it (non optimization sources)', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        return {
          content: '{}',
          rawResponse: { id: 'resp-1' },
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const limiter = { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const writeRunResult = vi.fn(async () => undefined);

    await invokeLLM(baseArgs(), {
      limiter,
      logger,
      runResultWriter: { writeRunResult },
      adapters: [adapter],
    });

    expect(writeRunResult).toHaveBeenCalledWith(
      expect.objectContaining({ roundIndex: null }),
    );
  });

  it('logs failed invocations and rethrows WITHOUT writing run_result (consumer writes final error on attempts exhausted)', async () => {
    const order: string[] = [];
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        order.push('provider');
        throw new Error('provider is down');
      },
    };
    const limiter = {
      acquire: vi.fn(async () => {
        order.push('acquire');
      }),
      release: vi.fn(async () => {
        order.push('release');
      }),
    };
    const logger = {
      info: vi.fn(),
      error: vi.fn(() => {
        order.push('log_failed');
      }),
    };
    const runResultWriter = {
      writeRunResult: vi.fn(async () => {
        order.push('write');
      }),
    };

    await expect(
      invokeLLM(baseArgs(), { limiter, logger, runResultWriter, adapters: [adapter] }),
    ).rejects.toThrow('provider is down');

    // Critical: on failure, only log; do NOT write a run_result; otherwise after BullMQ retries succeed, they cannot overwrite the first failed error row
    expect(order).toEqual(['acquire', 'provider', 'log_failed', 'release']);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorClass: 'Error',
        errorMessage: 'provider is down',
      }),
      'llm_call_failed',
    );
    expect(runResultWriter.writeRunResult).not.toHaveBeenCalled();
  });

  it('rethrows RateLimitExceededError without writing run_result or releasing slots', async () => {
    const providerInvoke = vi.fn();
    const adapter: LLMAdapter = {
      providerType: 'fake',
      invoke: providerInvoke,
    };
    const limiter = {
      acquire: vi.fn(async () => {
        throw new RateLimitExceededError('rpm', 1500);
      }),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const runResultWriter = { writeRunResult: vi.fn(async () => undefined) };

    await expect(
      invokeLLM(baseArgs(), { limiter, logger, runResultWriter, adapters: [adapter] }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    expect(providerInvoke).not.toHaveBeenCalled();
    expect(runResultWriter.writeRunResult).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    // Critical: when acquire throws, do NOT call release (otherwise the concurrency count goes negative)
    expect(limiter.release).not.toHaveBeenCalled();
  });

  it('resizes oversized OpenAI-style image data URLs before sending to the provider', async () => {
    const originalDataUrl = await createImageDataUrl(3200, 1800);
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke(args) {
        const imagePart = args.messages?.[0]?.content;
        expect(Array.isArray(imagePart)).toBe(true);
        const content = imagePart as Array<Record<string, unknown>>;
        const url = (content[1]?.['image_url'] as Record<string, unknown>)?.['url'];
        expect(typeof url).toBe('string');
        expect(url).not.toBe(originalDataUrl);

        const base64 = (url as string).replace(/^data:image\/jpeg;base64,/u, '');
        const metadata = await sharp(Buffer.from(base64, 'base64')).metadata();
        expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(2048);
        expect(args.params.imageRefs).toEqual([
          expect.objectContaining({
            kind: 'base64',
            mediaType: 'image/jpeg',
            resized: true,
            original: expect.objectContaining({
              mediaType: 'image/jpeg',
              width: 3200,
              height: 1800,
            }),
          }),
        ]);

        return {
          content: 'ok',
          rawResponse: {},
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 1 },
        };
      },
    };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await invokeLLM(
      {
        ...baseArgs(),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              { type: 'image_url', image_url: { url: originalDataUrl } },
            ],
          },
        ],
      },
      { limiter, logger, adapters: [adapter] },
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        image_refs: [
          expect.objectContaining({
            kind: 'base64',
            resized: true,
          }),
        ],
      }),
      'llm_call_completed',
    );
  });

  it('keeps remote image URLs untouched but records image refs', async () => {
    const imageUrl = 'https://cdn.example.test/large-image.jpg';
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke(args) {
        expect(args.messages).toEqual([
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ]);
        expect(args.params.imageRefs).toEqual([{ kind: 'url', url: imageUrl }]);

        return {
          content: 'ok',
          rawResponse: {},
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 1 },
        };
      },
    };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await invokeLLM(
      {
        ...baseArgs(),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      },
      { limiter, logger, adapters: [adapter] },
    );
  });

  it('resizes oversized Anthropic-style base64 image sources before sending to the provider', async () => {
    const dataUrl = await createImageDataUrl(2800, 1400);
    const originalBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/u, '');
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke(args) {
        const imagePart = args.messages?.[0]?.content;
        expect(Array.isArray(imagePart)).toBe(true);
        const content = imagePart as Array<Record<string, unknown>>;
        const source = content[0]?.['source'] as Record<string, unknown>;
        expect(source['media_type']).toBe('image/jpeg');
        expect(source['data']).not.toBe(originalBase64);

        const metadata = await sharp(Buffer.from(source['data'] as string, 'base64')).metadata();
        expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(2048);
        expect(args.params.imageRefs).toEqual([
          expect.objectContaining({
            kind: 'base64',
            resized: true,
            original: expect.objectContaining({ width: 2800, height: 1400 }),
          }),
        ]);

        return {
          content: 'ok',
          rawResponse: {},
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 1 },
        };
      },
    };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await invokeLLM(
      {
        ...baseArgs(),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: originalBase64,
                },
              },
              { type: 'text', text: 'describe' },
            ],
          },
        ],
      },
      { limiter, logger, adapters: [adapter] },
    );
  });
});

describe('testModelConnectivity', () => {
  it('keeps the bundled image probe asset small enough for dev TPM limits', () => {
    const assetPath = resolve(process.cwd(), 'src/assets/qwen-vl-demo.jpeg');
    expect(existsSync(assetPath)).toBe(true);
    const bytes = readFileSync(assetPath);
    const base64Length = bytes.toString('base64').length;

    expect(bytes.byteLength).toBeLessThanOrEqual(25_000);
    expect(Math.ceil(base64Length / 4)).toBeLessThanOrEqual(8_000);
  });

  it('uses the provider and returns a compact success result without writing a run result', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke(args) {
        expect(args.messages).toEqual([{ role: 'user', content: 'ping' }]);
        expect(args.params).not.toHaveProperty('temperature');
        expect(args.params.maxTokens).toBe(8);
        return {
          content: 'pong',
          rawResponse: {},
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };

    const result = await testModelConnectivity(
      { model, limiterKey: `model:${model.id}`, requestId: 'probe-1' },
      { limiter, logger, adapters: [adapter] },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        modelId: model.id,
        responsePreview: 'pong',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'probe-1',
        model: expect.objectContaining({
          id: model.id,
          providerModelId: model.providerModelId,
          providerType: model.providerType,
          endpoint: 'https://llm.example.test/v1',
          max_tokens: 8,
        }),
        messages: [{ role: 'user', content: 'ping' }],
        request: expect.objectContaining({
          method: 'POST',
          url: 'https://llm.example.test/v1',
          body: expect.objectContaining({
            model: model.providerModelId,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        }),
        probeType: 'text',
        estimatedTokens: expect.any(Number),
      }),
      'model_connectivity_probe_request_sent',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'probe-1',
        outcome: 'success',
        response: expect.objectContaining({
          content: 'pong',
          raw: {},
          finish_reason: 'stop',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      }),
      'model_connectivity_probe_response_received',
    );
    expect(logger.info).toHaveBeenCalledWith(expect.any(Object), 'model_connectivity_probe_completed');
  });

  it('logs probe request and failed response at info level', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        throw new Error('probe provider failed');
      },
    };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };

    const result = await testModelConnectivity(
      { model, limiterKey: `model:${model.id}`, requestId: 'probe-failed-1' },
      { limiter, logger, adapters: [adapter] },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        modelId: model.id,
        errorClass: 'Error',
        errorMessage: 'probe provider failed',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'probe-failed-1',
        probeType: 'text',
        messages: [{ role: 'user', content: 'ping' }],
        request: expect.objectContaining({
          method: 'POST',
          url: 'https://llm.example.test/v1',
        }),
      }),
      'model_connectivity_probe_request_sent',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'probe-failed-1',
        outcome: 'failure',
        response: expect.objectContaining({
          errorClass: 'Error',
          errorMessage: 'probe provider failed',
        }),
      }),
      'model_connectivity_probe_response_received',
    );
    expect(logger.error).toHaveBeenCalledWith(expect.any(Object), 'model_connectivity_probe_failed');
  });

  it('uses provider error.message as the probe error message when available', async () => {
    const providerBody = JSON.stringify({
      error: {
        message: 'Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
      request_id: '0e8246db-c66b-94c2-8ef9-01be29230c55',
    });
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        throw new LLMAdapterHttpError('openai request failed', 401, providerBody);
      },
    };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };

    const result = await testModelConnectivity(
      { model, limiterKey: `model:${model.id}`, requestId: 'probe-provider-error-1' },
      { limiter, logger, adapters: [adapter] },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        httpStatus: 401,
        providerErrorBody: providerBody,
        errorMessage: 'Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        httpStatus: 401,
        providerErrorBody: providerBody,
        errorMessage: 'Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error',
      }),
      'model_connectivity_probe_failed',
    );
  });

  it('uses an image probe payload for image-capable models', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke(args) {
        expect(args.messages).toEqual([
          {
            role: 'user',
            content: [
              { type: 'text', text: expect.stringContaining('image input') },
              {
                type: 'image_url',
                image_url: { url: expect.stringMatching(/^data:image\/jpeg;base64,/u) },
              },
            ],
          },
        ]);
        expect(args.params.imageRefs).toEqual([
          { kind: 'base64', mediaType: 'image/jpeg', sha256: expect.any(String) },
        ]);
        return {
          content: 'pong',
          rawResponse: {},
          finishReason: 'stop',
          usage: { inputTokens: 12, outputTokens: 1 },
        };
      },
    };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await testModelConnectivity(
      { model: { ...model, capabilities: { image: 'both' } }, limiterKey: `model:${model.id}`, requestId: 'probe-image-1' },
      { limiter, logger, adapters: [adapter] },
    );

    expect(result.ok).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        probeType: 'image_base64',
        image_refs: [{ kind: 'base64', mediaType: 'image/jpeg', sha256: expect.any(String) }],
      }),
      'model_connectivity_probe_completed',
    );
  });
});

describe('normalizeLLMError', () => {
  it('extracts the real provider error.message from an LLMAdapterHttpError providerErrorBody', () => {
    const providerBody = JSON.stringify({
      error: {
        message:
          'Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
      request_id: '259615f7-17ab-9ec3-8132-66d5e00f5903',
    });
    const result = normalizeLLMError(new LLMAdapterHttpError('openai request failed', 401, providerBody));
    expect(result).toEqual({
      errorClass: 'LLMAdapterHttpError',
      errorMessage:
        'Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error',
      httpStatus: 401,
      providerErrorBody: providerBody,
    });
  });

  it('falls back to the adapter message when providerErrorBody is unparseable', () => {
    const result = normalizeLLMError(new LLMAdapterHttpError('openai request failed', 500, 'not json'));
    expect(result.errorMessage).toBe('openai request failed');
    expect(result.httpStatus).toBe(500);
  });

  it('returns generic error fields for a plain Error', () => {
    const result = normalizeLLMError(new TypeError('boom'));
    expect(result).toEqual({ errorClass: 'TypeError', errorMessage: 'boom' });
  });
});

describe('invokeLLM — maxRetries 内部重试', () => {
  function successResult(content = 'ok') {
    return {
      content,
      rawResponse: { id: 'r' },
      finishReason: 'stop' as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  it('maxRetries=2 + 503 失败 2 次后第 3 次成功 → 调 provider 3 次', async () => {
    const invokeMock = vi
      .fn()
      .mockRejectedValueOnce(new LLMAdapterHttpError('upstream 503', 503, '{}'))
      .mockRejectedValueOnce(new LLMAdapterHttpError('upstream 503', 503, '{}'))
      .mockResolvedValueOnce(successResult());
    const adapter: LLMAdapter = { providerType: 'fake', invoke: invokeMock };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await invokeLLM(
      { ...baseArgs(), maxRetries: 2 },
      { limiter, logger, adapters: [adapter] },
    );

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(result.content).toBe('ok');
    expect(limiter.acquire).toHaveBeenCalledTimes(1);
    expect(limiter.release).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, httpStatus: 503 }),
      'llm_call_retrying',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, httpStatus: 503 }),
      'llm_call_retrying',
    );
  });

  it('401 不可重试 → 立即抛出，provider 只调 1 次', async () => {
    const invokeMock = vi
      .fn()
      .mockRejectedValueOnce(new LLMAdapterHttpError('unauthorized', 401, '{}'));
    const adapter: LLMAdapter = { providerType: 'fake', invoke: invokeMock };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(
      invokeLLM({ ...baseArgs(), maxRetries: 5 }, { limiter, logger, adapters: [adapter] }),
    ).rejects.toBeInstanceOf(LLMAdapterHttpError);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(limiter.release).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), 'llm_call_retrying');
  });

  it('maxRetries 用尽仍失败 → 透传最后一次错误', async () => {
    const invokeMock = vi
      .fn()
      .mockRejectedValue(new LLMAdapterHttpError('upstream 503', 503, '{}'));
    const adapter: LLMAdapter = { providerType: 'fake', invoke: invokeMock };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(
      invokeLLM({ ...baseArgs(), maxRetries: 1 }, { limiter, logger, adapters: [adapter] }),
    ).rejects.toBeInstanceOf(LLMAdapterHttpError);

    expect(invokeMock).toHaveBeenCalledTimes(2); // Initial + 1 retry
    expect(limiter.release).toHaveBeenCalledTimes(1);
  });

  it('maxRetries 缺省 → 行为与旧版一致（不重试）', async () => {
    const invokeMock = vi.fn().mockRejectedValue(new Error('boom'));
    const adapter: LLMAdapter = { providerType: 'fake', invoke: invokeMock };
    const limiter = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(invokeLLM(baseArgs(), { limiter, logger, adapters: [adapter] })).rejects.toThrow(
      'boom',
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe('invokeLLM — auto-concurrency feedback', () => {
  const autoModel = { ...model, autoConcurrency: true };
  function autoArgs(): InvokeLLMArgs {
    return { ...baseArgs(), model: autoModel };
  }
  type ReportArgs = { key: string; kind: 'success' | 'upstream_throttle'; latencyMs?: number; tokens?: number };
  function autoLimiter() {
    return {
      acquire: vi.fn(async () => ({ effectiveConcurrency: 5, backoffFactor: 1, latencyEwmaMs: 2000 })),
      release: vi.fn(async () => undefined),
      reportOutcome: vi.fn(async (_args: ReportArgs) => undefined),
    };
  }
  const logger = () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() });

  it('reports success with latency + tokens and passes autoConcurrency to acquire', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        return { content: 'ok', rawResponse: {}, finishReason: 'stop', usage: { inputTokens: 7, outputTokens: 3 } };
      },
    };
    const limiter = autoLimiter();

    await invokeLLM(autoArgs(), { limiter, logger: logger(), adapters: [adapter] });

    expect(limiter.acquire).toHaveBeenCalledWith(expect.objectContaining({ autoConcurrency: true }));
    expect(limiter.reportOutcome).toHaveBeenCalledTimes(1);
    expect(limiter.reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ key: `model:${autoModel.id}`, kind: 'success', tokens: 10 }),
    );
    expect(limiter.reportOutcome.mock.calls[0]![0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports upstream_throttle on provider HTTP 429 and still rethrows the original error', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        throw new LLMAdapterHttpError('rate limited', 429, '{"error":{"message":"slow down"}}');
      },
    };
    const limiter = autoLimiter();

    await expect(invokeLLM(autoArgs(), { limiter, logger: logger(), adapters: [adapter] })).rejects.toBeInstanceOf(
      LLMAdapterHttpError,
    );
    expect(limiter.reportOutcome).toHaveBeenCalledTimes(1);
    expect(limiter.reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ key: `model:${autoModel.id}`, kind: 'upstream_throttle' }),
    );
  });

  it('does not report when autoConcurrency is off', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        return { content: 'ok', rawResponse: {}, finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const limiter = autoLimiter();

    // baseArgs() uses the default model with autoConcurrency: false
    await invokeLLM(baseArgs(), { limiter, logger: logger(), adapters: [adapter] });

    expect(limiter.reportOutcome).not.toHaveBeenCalled();
  });

  it('does not report on a non-429 failure', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        throw new LLMAdapterHttpError('server error', 500, '{}');
      },
    };
    const limiter = autoLimiter();

    await expect(invokeLLM(autoArgs(), { limiter, logger: logger(), adapters: [adapter] })).rejects.toBeInstanceOf(
      LLMAdapterHttpError,
    );
    expect(limiter.reportOutcome).not.toHaveBeenCalled();
  });

  it('a throwing reportOutcome never fails the underlying call', async () => {
    const adapter: LLMAdapter = {
      providerType: 'fake',
      async invoke() {
        return { content: 'ok', rawResponse: {}, finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 2 } };
      },
    };
    const limiter = {
      acquire: vi.fn(async () => ({ effectiveConcurrency: 5, backoffFactor: 1, latencyEwmaMs: 2000 })),
      release: vi.fn(async () => undefined),
      reportOutcome: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };

    const result = await invokeLLM(autoArgs(), { limiter, logger: logger(), adapters: [adapter] });
    expect(result.content).toBe('ok');
  });
});
