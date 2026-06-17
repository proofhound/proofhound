import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  RequestTimeoutException,
} from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import {
  remainingWebhookAsyncCallTtlSeconds,
  WEBHOOK_ASYNC_CALL_TTL_SECONDS,
  renderPromptForSample,
  webhookAsyncCallKey,
  webhookAsyncCallReceiptSchema,
  type LlmJobPayload,
  type WebhookAsyncCallContext,
  type WebhookAsyncCallReceipt,
} from '@proofhound/orchestration-shared';
import {
  type CanaryReleaseFilterNodeDto,
  type CanaryReleaseVariableMappingItemDto,
  type PromptLanguageDto,
  type PromptOutputSchemaDto,
  type PromptVariableDto,
} from '@proofhound/shared';
import type Redis from 'ioredis';
import { ConnectorContextResolver } from '../../../server/common/contracts/connector-context.resolver';
import { WorkflowAuthorizationHook } from '../../../server/common/contracts/workflow-authorization.hook';
import { BullmqService } from '../../infrastructure/orchestration/bullmq.service';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';
import {
  WebhookRepository,
  type WebhookReleaseRuntimeLineRow,
  type WebhookReleaseRuntimeRow,
  type WebhookRunResultRow,
} from './webhook.repository';
import { parseBearerToken } from './webhook-token.util';

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

export interface ReceiveWebhookInput {
  webhookSlug: string;
  pathName: string;
  body: unknown;
  authorization: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface GetWebhookCallInput {
  webhookSlug: string;
  pathName: string;
  callId: string;
  authorization: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class WebhookService {
  private readonly logger = createLogger('webhook.service', { service: 'webhook-ingress' });

  constructor(
    @Inject(WebhookRepository) private readonly repo: WebhookRepository,
    @Inject(BullmqService) private readonly bullmq: BullmqService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly connectorResolver: ConnectorContextResolver,
    private readonly workflowAuth: WorkflowAuthorizationHook,
  ) {}

  async receive(input: ReceiveWebhookInput) {
    const { connector, webhookTokenId, projectContext, actorContext } =
      await this.connectorResolver.resolveFromWebhookToken(
        input.webhookSlug,
        input.pathName,
        parseBearerToken(input.authorization),
      );
    // Webhook ingress is an entry: authorize the workflow start before enqueuing (OSS no-op; SaaS RBAC).
    await this.workflowAuth.assertCanStart(actorContext, projectContext, 'llm');
    const releaseLine = await this.repo.findActiveReleaseForConnector(connector.id);
    if (!releaseLine) {
      throw new ConflictException('webhook_no_active_release');
    }

    const payload = assertRecord(input.body);
    const mode = connector.config['webhookMode'] === 'async' ? 'async' : 'sync';
    const lanes = selectWebhookLanes(releaseLine, payload);
    if (lanes.length === 0) return { status: 'filtered', filtered: true };

    let canonical: { lane: WebhookReleaseRuntimeRow; runResultId: string; externalId: string } | null = null;

    for (const item of lanes) {
      const { lane } = item;
      await this.repo.incrementReceived(lane.id);

      if (!matchesFilter(lane.filterRules, payload)) {
        await this.repo.incrementFiltered(lane.id);
        if (item.canonical) return { status: 'filtered', filtered: true };
        continue;
      }

      let mapped: { externalId: string; inputVariables: Record<string, unknown> };
      try {
        mapped = mapVariables(lane, payload);
      } catch (error) {
        await this.repo.incrementFiltered(lane.id);
        if (item.canonical) throw error;
        continue;
      }

      const runResultId = randomUUID();
      const asyncCall =
        item.canonical && mode === 'async'
          ? buildWebhookAsyncCallContext({
              callId: runResultId,
              runResultId,
              projectId: connector.projectId,
              connectorId: connector.id,
              releaseLineEventId: lane.id,
              externalId: mapped.externalId,
            })
          : undefined;
      if (asyncCall) await this.writePendingAsyncCall(asyncCall);

      const llmPayload = buildLlmPayload(
        lane,
        mapped.inputVariables,
        payload,
        mapped.externalId,
        runResultId,
        webhookTokenId,
        asyncCall,
        projectContext.orgId,
      );
      try {
        await this.bullmq.enqueueLlmJob(llmPayload, runResultId);
      } catch (error) {
        if (asyncCall) {
          await this.deleteAsyncCall(asyncCall.callId).catch((deleteError) => {
            this.logger.error(
              { callId: asyncCall.callId, error: (deleteError as Error).message },
              'webhook_async_call_pending_delete_failed',
            );
          });
        }
        throw error;
      }

      if (item.canonical) {
        canonical = { lane, runResultId, externalId: mapped.externalId };
      }
    }

    if (!canonical) return { status: 'filtered', filtered: true };
    this.logger.info(
      {
        projectId: connector.projectId,
        connectorId: connector.id,
        releaseLineEventId: canonical.lane.id,
        lane: canonical.lane.laneType,
        runResultId: canonical.runResultId,
        mode,
      },
      'webhook_release_llm_job_enqueued',
    );

    if (mode === 'async') {
      return {
        status: 'accepted',
        call_id: canonical.runResultId,
        run_result_id: canonical.runResultId,
        external_id: canonical.externalId,
        expires_in_seconds: WEBHOOK_ASYNC_CALL_TTL_SECONDS,
      };
    }

    const timeoutMs = resolveSyncTimeoutMs(connector.config);
    const result = await this.waitForRunResult(canonical.runResultId, timeoutMs);
    await this.repo.attachResultToRelease(canonical.lane.id, result);
    return formatResult(result, canonical.runResultId);
  }

  async getCallResult(input: GetWebhookCallInput) {
    const { connector } = await this.connectorResolver.resolveFromWebhookToken(
      input.webhookSlug,
      input.pathName,
      parseBearerToken(input.authorization),
    );
    const receipt = await this.readAsyncCall(input.callId);
    if (!receipt || receipt.projectId !== connector.projectId || receipt.connectorId !== connector.id) {
      return { status: 'expired', call_id: input.callId, expires_in_seconds: 0 };
    }
    const expiresInSeconds = await this.getAsyncCallExpiresInSeconds(input.callId, receipt);
    return formatAsyncCallReceipt(receipt, expiresInSeconds);
  }

  private async waitForRunResult(runResultId: string, timeoutMs: number): Promise<WebhookRunResultRow> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const result = await this.repo.findRunResult(runResultId);
      if (result) return result;
      await delay(POLL_INTERVAL_MS);
    }
    throw new RequestTimeoutException('webhook_sync_timeout_waiting_for_run_result');
  }

  private async writePendingAsyncCall(call: WebhookAsyncCallContext): Promise<void> {
    const receipt: WebhookAsyncCallReceipt = {
      ...call,
      status: 'pending',
      updatedAt: call.acceptedAt,
    };
    await this.redis.set(
      webhookAsyncCallKey(call.callId),
      JSON.stringify(receipt),
      'EX',
      WEBHOOK_ASYNC_CALL_TTL_SECONDS,
    );
  }

  private async deleteAsyncCall(callId: string): Promise<void> {
    await this.redis.del(webhookAsyncCallKey(callId));
  }

  private async readAsyncCall(callId: string): Promise<WebhookAsyncCallReceipt | null> {
    const raw = await this.redis.get(webhookAsyncCallKey(callId));
    if (!raw) return null;
    try {
      return webhookAsyncCallReceiptSchema.parse(JSON.parse(raw));
    } catch (error) {
      this.logger.error({ callId, error: (error as Error).message }, 'webhook_async_call_receipt_invalid');
      return null;
    }
  }

  private async getAsyncCallExpiresInSeconds(callId: string, receipt: WebhookAsyncCallReceipt): Promise<number> {
    const ttl = await this.redis.ttl(webhookAsyncCallKey(callId));
    if (ttl > 0) return ttl;
    return remainingWebhookAsyncCallTtlSeconds(receipt.expiresAt);
  }
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('webhook_payload_must_be_object');
  }
  return value as Record<string, unknown>;
}

function selectWebhookLanes(
  line: WebhookReleaseRuntimeLineRow,
  payload: Record<string, unknown>,
): Array<{ lane: WebhookReleaseRuntimeRow; canonical: boolean }> {
  const { production, canary } = line;
  if (!canary) return production ? [{ lane: production, canonical: true }] : [];

  const trafficRatio = canary.trafficRatio ?? 1;
  const trafficKey = String(readPath(payload, canary.externalIdField) ?? '');
  const canaryHit = passesTrafficRatio(canary.id, trafficKey, trafficRatio);
  if (!production) return canaryHit ? [{ lane: canary, canonical: true }] : [];

  if ((canary.trafficMode ?? 'split') === 'dual_run') {
    return canaryHit
      ? [
          { lane: production, canonical: true },
          { lane: canary, canonical: false },
        ]
      : [{ lane: production, canonical: true }];
  }
  return canaryHit ? [{ lane: canary, canonical: true }] : [{ lane: production, canonical: true }];
}

function mapVariables(
  release: WebhookReleaseRuntimeRow,
  payload: Record<string, unknown>,
): { externalId: string; inputVariables: Record<string, unknown> } {
  const mapping = normalizeVariableMapping(release.variableMapping);
  const inputVariables: Record<string, unknown> = {};
  const externalId: unknown = readPath(payload, release.externalIdField);

  for (const item of mapping) {
    if (item.target === 'id') continue;
    const value = readMappedValue(payload, item);
    if (item.required && value === undefined) {
      throw new BadRequestException(`webhook_missing_required_field:${item.source}`);
    }
    if (value !== undefined) inputVariables[item.target] = value;
  }

  if (externalId === undefined || externalId === null || String(externalId).trim().length === 0) {
    throw new BadRequestException('webhook_missing_external_id');
  }
  return { externalId: String(externalId), inputVariables };
}

function normalizeVariableMapping(value: unknown): CanaryReleaseVariableMappingItemDto[] {
  if (Array.isArray(value)) return value as CanaryReleaseVariableMappingItemDto[];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].length > 0)
    .map(([target, source]) => ({
      source,
      target,
      required: target === 'id',
    }));
}

function readMappedValue(payload: Record<string, unknown>, item: CanaryReleaseVariableMappingItemDto): unknown {
  const value = readPath(payload, item.source);
  if (value !== undefined) return value;
  return item.defaultValue;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

function matchesFilter(filterRules: unknown, payload: Record<string, unknown>): boolean {
  if (!filterRules) return true;
  return evaluateFilter(filterRules as CanaryReleaseFilterNodeDto, payload);
}

function evaluateFilter(node: CanaryReleaseFilterNodeDto, payload: Record<string, unknown>): boolean {
  if (node.type === 'and') return node.children.every((child) => evaluateFilter(child, payload));
  if (node.type === 'or') return node.children.some((child) => evaluateFilter(child, payload));
  if (node.type === 'not') return !evaluateFilter(node.child, payload);
  const actual = readPath(payload, node.field);
  switch (node.op) {
    case 'eq':
      return actual === node.value;
    case 'neq':
      return actual !== node.value;
    case 'gt':
      return Number(actual) > Number(node.value);
    case 'gte':
      return Number(actual) >= Number(node.value);
    case 'lt':
      return Number(actual) < Number(node.value);
    case 'lte':
      return Number(actual) <= Number(node.value);
    case 'in':
      return Array.isArray(node.value) && node.value.includes(actual);
    case 'contains':
      return String(actual ?? '').includes(String(node.value ?? ''));
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'startsWith':
      return String(actual ?? '').startsWith(String(node.value ?? ''));
    case 'endsWith':
      return String(actual ?? '').endsWith(String(node.value ?? ''));
    default:
      return true;
  }
}

function passesTrafficRatio(releaseLineEventId: string, trafficKey: string, trafficRatio: number): boolean {
  if (trafficRatio >= 1) return true;
  if (trafficRatio <= 0) return false;
  const hex = createHash('sha1').update(`${releaseLineEventId}:${trafficKey}:traffic`).digest('hex').slice(0, 8);
  const bucket = Number.parseInt(hex, 16) / 0xffffffff;
  return bucket < trafficRatio;
}

function buildWebhookAsyncCallContext(input: {
  callId: string;
  runResultId: string;
  projectId: string;
  connectorId: string;
  releaseLineEventId: string;
  externalId: string | null;
}): WebhookAsyncCallContext {
  const acceptedAt = new Date();
  const expiresAt = new Date(acceptedAt.getTime() + WEBHOOK_ASYNC_CALL_TTL_SECONDS * 1000);
  return {
    ...input,
    acceptedAt: acceptedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function buildLlmPayload(
  release: WebhookReleaseRuntimeRow,
  inputVariables: Record<string, unknown>,
  rawPayload: Record<string, unknown>,
  externalId: string,
  runResultId: string,
  webhookTokenId: string,
  webhookAsyncCall: WebhookAsyncCallContext | undefined,
  // SaaS-only org attribution: the ConnectorContextResolver already resolved the project's org for this webhook,
  // so thread it onto the release payload (OSS LocalConnectorContextResolver yields undefined → no behavior change).
  orgId: string | undefined,
): LlmJobPayload {
  const { renderedPrompt } = renderPromptForSample(
    {
      body: release.promptBody,
      variables: (Array.isArray(release.promptVariables) ? release.promptVariables : []) as PromptVariableDto[],
      outputSchema: (release.promptOutputSchema ?? { fields: [] }) as PromptOutputSchemaDto,
      promptLanguage: release.promptLanguage as PromptLanguageDto,
    },
    { data: inputVariables },
  );
  const expectedOutput = readExpectedOutput(release.promptJudgmentRules, { inputVariables, rawPayload });

  return {
    projectId: release.projectId,
    orgId,
    source: 'release',
    sourceId: release.id,
    promptVersionId: release.promptVersionId,
    promptId: release.promptId,
    modelId: release.modelId,
    runResultId,
    webhookTokenId,
    sampleId: null,
    externalId,
    renderedPrompt,
    inputVariables,
    inference: pickInference(release.runConfig),
    limits: pickLimits(release.runConfig),
    retry: pickRetry(release.runConfig),
    judgment:
      expectedOutput === undefined
        ? undefined
        : {
            outputSchema: release.promptOutputSchema ?? null,
            judgmentRules: release.promptJudgmentRules ?? null,
            expectedOutput,
          },
    webhookAsyncCall,
  };
}

function readExpectedOutput(
  judgmentRules: unknown,
  input: { inputVariables: Record<string, unknown>; rawPayload: Record<string, unknown> },
): unknown {
  const expectedField = readExpectedField(judgmentRules);
  const fromInputVariables = readPath(input.inputVariables, expectedField);
  if (fromInputVariables !== undefined) return fromInputVariables;
  return readPath(input.rawPayload, expectedField);
}

function readExpectedField(judgmentRules: unknown): string {
  if (!judgmentRules || typeof judgmentRules !== 'object' || Array.isArray(judgmentRules)) return 'expected_output';
  const record = judgmentRules as Record<string, unknown>;
  const direct = record['expected_field'] ?? record['expectedField'];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  const rules = record['rules'];
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
      const nested =
        (rule as Record<string, unknown>)['expected_field'] ?? (rule as Record<string, unknown>)['expectedField'];
      if (typeof nested === 'string' && nested.trim().length > 0) return nested.trim();
    }
  }
  return 'expected_output';
}

function pickInference(runConfig: Record<string, unknown>): LlmJobPayload['inference'] {
  const out: NonNullable<LlmJobPayload['inference']> = {};
  if (typeof runConfig['temperature'] === 'number') out.temperature = runConfig['temperature'];
  if (typeof runConfig['maxTokens'] === 'number') out.maxTokens = runConfig['maxTokens'];
  if (typeof runConfig['topP'] === 'number') out.topP = runConfig['topP'];
  if (typeof runConfig['apiVersion'] === 'string') out.apiVersion = runConfig['apiVersion'];
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickLimits(runConfig: Record<string, unknown>): LlmJobPayload['limits'] {
  const out: NonNullable<LlmJobPayload['limits']> = {};
  if (typeof runConfig['rpmLimit'] === 'number' && runConfig['rpmLimit'] > 0) {
    out.rpmLimit = runConfig['rpmLimit'];
  }
  if (typeof runConfig['tpmLimit'] === 'number' && runConfig['tpmLimit'] > 0) {
    out.tpmLimit = runConfig['tpmLimit'];
  }
  if (typeof runConfig['concurrency'] === 'number' && runConfig['concurrency'] > 0) {
    out.concurrency = runConfig['concurrency'];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickRetry(runConfig: Record<string, unknown>): LlmJobPayload['retry'] {
  if (typeof runConfig['retries'] === 'number' && runConfig['retries'] >= 0) {
    return { maxRetries: runConfig['retries'] };
  }
  return undefined;
}

function resolveSyncTimeoutMs(config: Record<string, unknown>): number {
  const seconds = Number(config['timeoutSeconds']);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_SYNC_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(seconds * 1000), 1_000), 300_000);
}

function formatResult(result: WebhookRunResultRow, callId: string) {
  // Gate the error/no-output branch on the INFERENCE outcome only (run_results.status), NOT on
  // isRunResultFailure: that helper folds in judgment failure (judge_error / parse_error), which is
  // correct for metrics/failure-rate accounting but wrong here — a synchronous caller wants the model
  // output whenever inference succeeded, even if the optional judge step errored. Judgment diagnostics
  // are surfaced in the success payload (judgment_status / is_correct) for visibility.
  if (result.status !== 'success') {
    return {
      status: 'error',
      run_status: result.status,
      call_id: callId,
      run_result_id: result.id,
      external_id: result.externalId,
      error_class: result.errorClass,
      error_message: result.errorMessage,
      latency_ms: toNumberOrNull(result.latencyMs),
    };
  }
  return {
    status: 'success',
    call_id: callId,
    run_result_id: result.id,
    external_id: result.externalId,
    result: result.parsedOutput ?? result.rawResponse ?? result.decisionOutput,
    raw_response: result.rawResponse,
    parsed_output: result.parsedOutput ?? null,
    decision_output: result.decisionOutput,
    judgment_status: result.judgmentStatus,
    is_correct: result.isCorrect,
    latency_ms: toNumberOrNull(result.latencyMs),
    input_tokens: toNumberOrNull(result.inputTokens),
    output_tokens: toNumberOrNull(result.outputTokens),
    cost_estimate: toNumberOrNull(result.costEstimate),
  };
}

function formatAsyncCallReceipt(receipt: WebhookAsyncCallReceipt, expiresInSeconds: number) {
  if (receipt.status === 'pending') {
    return {
      status: 'pending',
      call_id: receipt.callId,
      run_result_id: receipt.runResultId,
      external_id: receipt.externalId,
      expires_in_seconds: expiresInSeconds,
    };
  }

  if (receipt.status === 'error') {
    return {
      status: 'error',
      run_status: receipt.runStatus,
      call_id: receipt.callId,
      run_result_id: receipt.runResultId,
      external_id: receipt.externalId,
      error_class: receipt.errorClass,
      error_message: receipt.errorMessage,
      latency_ms: receipt.latencyMs,
      expires_in_seconds: expiresInSeconds,
    };
  }

  return {
    status: 'success',
    call_id: receipt.callId,
    run_result_id: receipt.runResultId,
    external_id: receipt.externalId,
    result: receipt.result,
    raw_response: receipt.rawResponse,
    parsed_output: receipt.parsedOutput,
    decision_output: receipt.decisionOutput,
    judgment_status: receipt.judgmentStatus,
    latency_ms: receipt.latencyMs,
    input_tokens: receipt.inputTokens,
    output_tokens: receipt.outputTokens,
    cost_estimate: receipt.costEstimate,
    expires_in_seconds: expiresInSeconds,
  };
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
