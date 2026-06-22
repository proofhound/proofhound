import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import {
  invokeLLM,
  parseJsonResponseWithMarkdownFallback,
  type LLMCallLogger,
  type LLMMessage,
  type ModelImageCapability,
  type ModelInvocationConfig,
  type RateLimiterLike,
} from '@proofhound/llm-client';
import { RateLimitExceededError } from '@proofhound/limiter';
import { createLogger } from '@proofhound/logger';
import {
  DEFAULT_PROMPT_LANGUAGE,
  promptOutputSchema,
  promptLanguageSchema,
  promptTryRunRequestSchema,
  promptVariableSchema,
  type PromptLanguageDto,
  type PromptTryRunResponseDto,
  type PromptVariableDto,
  type PromptOutputSchemaDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { LimiterKeyStrategy } from '../../common/contracts/limiter-key.strategy';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';
import { RuntimeLimitsProvider } from '../../common/contracts/runtime-limits.provider';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CryptoService } from '../../../shared/crypto/crypto.service';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { REDIS_LIMITER } from '../../../shared/redis/redis.constants';
import { applyRuntimeLimits } from '../../../shared/llm/runtime-limits';
import { renderPromptForSample } from '../experiment/experiment.renderer';
import { PromptRepository } from './prompt.repository';

@Injectable()
export class PromptTryRunService {
  private readonly llmLogger: LLMCallLogger = createLogger('prompt.try_run.llm', {
    service: 'api',
  });

  constructor(
    private readonly promptRepo: PromptRepository,
    private readonly crypto: CryptoService,
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_LIMITER) private readonly limiter: RateLimiterLike,
    private readonly accessControl: AccessControlService,
    private readonly limiterKeyStrategy: LimiterKeyStrategy,
    private readonly runtimeLimitsProvider: RuntimeLimitsProvider,
    private readonly quotaPolicy: QuotaPolicyHook,
  ) {}

  async tryRun(
    projectId: string,
    promptId: string,
    rawDto: unknown,
    actor: CurrentUserPayload,
    // orgId (SaaS-only; undefined in OSS) is sourced from the resolved ProjectContext — the project's org
    // is the rate-limit bucket (SPEC 08 §3.7), not the actor's org. OSS leaves it undefined so the
    // LocalLimiterKeyStrategy key stays `model:<id>`.
    orgId?: string,
  ): Promise<PromptTryRunResponseDto> {
    const parsed = promptTryRunRequestSchema.parse(rawDto);
    await this.assertAccessible(projectId, actor);

    const prompt = await this.promptRepo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const version = await this.promptRepo.findVersionInPrompt(promptId, parsed.promptVersionId);
    if (!version) {
      throw new NotFoundException(`Prompt version ${parsed.promptVersionId} not found`);
    }

    const model = await this.loadModelConfig(parsed.modelId);
    const project = { projectId, ...(orgId ? { orgId } : {}), source: 'local' as const };
    const mergedLimits = await this.runtimeLimitsProvider.mergeLlmLimits({
      project,
      modelId: model.id,
      source: 'prompt_try_run',
    });
    const effectiveModel = applyRuntimeLimits(model, mergedLimits);

    const variables = parseVariables(version.variables);
    const outputSchema = parseOutputSchema(version.outputSchema);
    const promptLanguage = parsePromptLanguage(version.promptLanguage);
    const { renderedPrompt } = renderPromptForSample(
      { body: version.body ?? '', variables, outputSchema, promptLanguage },
      { data: parsed.variables },
    );

    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof invokeLLM>>;
    try {
      result = await this.quotaPolicy.withExecutionSlot({ project, source: 'prompt_try_run', modelId: model.id }, () =>
        invokeLLM(
          {
            model: effectiveModel,
            limiterKey: this.limiterKeyStrategy.buildModelKey(project, model.id),
            messages: renderedPrompt.messages as LLMMessage[] | undefined,
            prompt: renderedPrompt.prompt,
            params: {
              temperature: parsed.temperature,
              maxTokens: parsed.maxTokens,
              responseFormat: renderedPrompt.responseFormat,
              imageRefs: renderedPrompt.imageRefs,
            },
            context: {
              promptId,
              promptVersionId: parsed.promptVersionId,
              attempt: 1,
            },
            timeoutMs: parsed.timeoutSeconds ? parsed.timeoutSeconds * 1000 : undefined,
            parseResponse: parseJsonResponseWithMarkdownFallback,
          },
          {
            limiter: this.limiter,
            logger: this.llmLogger,
          },
        ),
      );
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const errorClass = classifyError(error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        status: 'error',
        rawOutput: null,
        parsedOutput: null,
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        costEstimate: 0,
        errorClass,
        errorMessage,
      };
    }

    return {
      status: 'success',
      rawOutput: result.content,
      parsedOutput: result.parsed ?? parseJsonResponseWithMarkdownFallback(result.content),
      latencyMs: result.durationMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costEstimate: result.costEstimate,
      errorClass: null,
      errorMessage: null,
    };
  }

  private async assertAccessible(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    const access = await this.promptRepo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!access) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
  }

  private async loadModelConfig(modelId: string): Promise<ModelInvocationConfig> {
    const [row] = await this.db.select().from(schema.models).where(eq(schema.models.id, modelId)).limit(1);

    if (!row || !row.isActive || row.deletedAt) {
      throw new NotFoundException(`Model ${modelId} not available`);
    }

    return {
      id: row.id,
      providerType: row.providerType,
      providerModelId: row.providerModelId,
      endpoint: row.endpoint,
      apiKey: this.crypto.decryptApiKey(row.apiKeyEncrypted),
      capabilities: toModelInvocationCapabilities(row.capabilities),
      rpmLimit: row.rpmLimit,
      tpmLimit: row.tpmLimit,
      concurrencyLimit: row.concurrencyLimit,
      autoConcurrency: row.autoConcurrency,
      inputTokenPricePerMillion: row.inputTokenPricePerMillion,
      outputTokenPricePerMillion: row.outputTokenPricePerMillion,
      extraBody: toExtraBody(row.extraBody),
    };
  }
}

function parsePromptLanguage(value: string | null | undefined): PromptLanguageDto {
  const parsed = promptLanguageSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PROMPT_LANGUAGE;
}

function parseVariables(raw: unknown): PromptVariableDto[] {
  if (!Array.isArray(raw)) return [];
  const list: PromptVariableDto[] = [];
  for (const item of raw) {
    const parse = promptVariableSchema.safeParse(item);
    if (parse.success) list.push(parse.data);
  }
  return list;
}

function parseOutputSchema(raw: unknown): PromptOutputSchemaDto {
  const parse = promptOutputSchema.safeParse(raw);
  return parse.success ? parse.data : null;
}

function classifyError(error: unknown): string {
  if (error instanceof RateLimitExceededError) return 'rate_limit';
  if (error instanceof Error) {
    if (/timeout|abort/i.test(error.message)) return 'timeout';
    return error.name || 'internal';
  }
  return 'internal';
}

function toModelInvocationCapabilities(raw: unknown): ModelInvocationConfig['capabilities'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const image = (raw as Record<string, unknown>).image;
    if (typeof image === 'string' && ['none', 'url', 'base64', 'both'].includes(image)) {
      return { image: image as ModelImageCapability };
    }
  }
  return { image: 'none' };
}

function toExtraBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}
