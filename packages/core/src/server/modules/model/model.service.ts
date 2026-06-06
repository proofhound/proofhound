import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { deriveEffectiveConcurrency, type RateLimiter, type UsageSnapshot } from '@proofhound/limiter';
import { testModelConnectivity, type ModelInvocationConfig } from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import type {
  CreateProjectModelDto,
  ListModelContextWindowsQueryDto,
  ModelActiveUsageDto,
  ModelCapabilitiesDto,
  ModelContextWindowResponseDto,
  ModelDeleteQueryDto,
  ModelImageCapability,
  ModelLimitDto,
  ModelPricingDto,
  ModelProbeStatus,
  ModelReferencesDto,
  ModelStatus,
  ProbeDraftProjectModelDto,
  ProbeQuickStartDraftModelDto,
  ProbeModelResponseDto,
  ProjectModelListItemDto,
  ProjectModelListResponseDto,
  QuickStartModelOptionsResponseDto,
  RevealApiKeyResponseDto,
  UpdateProjectModelDto,
  UpsertModelContextWindowDto,
} from '@proofhound/shared';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { LimiterKeyStrategy } from '../../common/contracts/limiter-key.strategy';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';
import { RuntimeLimitsProvider } from '../../common/contracts/runtime-limits.provider';
import { WorkflowAuthorizationHook } from '../../common/contracts/workflow-authorization.hook';
import { isUniqueViolation } from '../../common/errors/db-error';
import { CryptoService } from '../../../shared/crypto/crypto.service';
import { REDIS_LIMITER } from '../../../shared/redis/redis.constants';
import { applyRuntimeLimits } from '../../../shared/llm/runtime-limits';
import {
  ModelRepository,
  type ModelContextWindowRow,
  type ModelInsertRow,
  type ModelReferenceCounts,
  type ModelRow,
  type ModelRowWithCreator,
  type ProjectVisibleModelRow,
} from './model.repository';

type ActionSource = 'api' | 'mcp';
type ModelScope = 'local' | 'quick_start';
type AnyModelRow = ModelRowWithCreator;

const MODEL_USAGE_SNAPSHOT_TIMEOUT_MS = 1_000;

export interface ModelExportFile {
  fileName: string;
  contentType: string;
  byteLength: number;
  buffer: Buffer;
}

@Injectable()
export class ModelService {
  private readonly logger = createLogger('model.service', { service: 'server' });

  constructor(
    private readonly repo: ModelRepository,
    private readonly crypto: CryptoService,
    @Inject(REDIS_LIMITER) private readonly limiter: RateLimiter,
    private readonly accessControl: AccessControlService,
    private readonly limiterKeyStrategy: LimiterKeyStrategy,
    private readonly runtimeLimitsProvider: RuntimeLimitsProvider,
    private readonly workflowAuth: WorkflowAuthorizationHook,
    private readonly quotaPolicy: QuotaPolicyHook,
  ) {}

  // -------------------------------------------------------------------------
  // Local in-process model
  // -------------------------------------------------------------------------
  // orgId on the project-scoped read methods (SaaS-only; undefined in OSS) is sourced from the resolved
  // ProjectContext — the project's org is the rate-limit bucket (SPEC 08 §3.7). It is threaded into
  // toProjectModelListItem → fetchUsageSnapshot so the usage-snapshot READ key matches the worker's WRITE
  // key under a SaaS strategy; OSS leaves it undefined so the key stays `model:<id>`.
  async listProjectModels(
    projectId: string,
    actor: CurrentUserPayload,
    orgId?: string,
  ): Promise<ProjectModelListResponseDto> {
    await this.getAccessibleProject(projectId, actor);
    const rows = await this.repo.listProjectModels(projectId);
    const data = await Promise.all(rows.map((row) => this.toProjectModelListItem(row, orgId)));
    return { data, total: data.length };
  }

  // Quick-start option listing is not project-scoped (no @CurrentProject at the endpoint), so no org is
  // threaded — usage is read with undefined org (key stays project/model-scoped). OSS-identical.
  async listQuickStartModelOptions(_actor: CurrentUserPayload): Promise<QuickStartModelOptionsResponseDto> {
    const rows = await this.repo.listQuickStartGlobalModels();
    const data = await Promise.all(rows.map((row) => this.toProjectModelListItem(row)));
    return { data, total: data.length };
  }

  async getQuickStartModelOption(modelId: string, _actor: CurrentUserPayload): Promise<ProjectModelListItemDto> {
    const row = await this.repo.findModelById(modelId);
    if (!row) {
      throw new NotFoundException(`Model ${modelId} not found`);
    }
    return this.toProjectModelListItem(row);
  }

  async getProjectModelDetail(
    projectId: string,
    modelId: string,
    actor: CurrentUserPayload,
    orgId?: string,
  ): Promise<ProjectModelListItemDto> {
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findModelAccessibleToProject(projectId, modelId);
    if (!row) throw new NotFoundException(`Model ${modelId} not found`);
    return this.toProjectModelListItem(row, orgId);
  }

  // For sibling services that have already done project access checks (such as ExperimentService) to query model visibility directly,
  // without re-running actor authorization; if authorization is needed, go through getProjectModelDetail
  async findModelAccessibleToProject(projectId: string, modelId: string): Promise<ProjectVisibleModelRow | null> {
    return this.repo.findModelAccessibleToProject(projectId, modelId);
  }

  async createProjectModel(
    projectId: string,
    dto: CreateProjectModelDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
    orgId?: string,
  ): Promise<ProjectModelListItemDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    const modelId = randomUUID();
    const insert = this.buildInsertRow(projectId, modelId, dto, actor.sub);
    const created = await this.createModelOrThrowNameConflict(insert);

    return this.getProjectModelDetail(projectId, created.id, actor, orgId);
  }

  async probeDraftProjectModel(
    projectId: string,
    dto: ProbeDraftProjectModelDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
    orgId?: string,
  ): Promise<ProbeModelResponseDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    await this.assertProbeWorkflowStart({ projectId, orgId, source: 'local' }, actor);
    const modelId = randomUUID();
    const model: ModelInvocationConfig = {
      id: modelId,
      providerType: dto.providerType.trim(),
      providerModelId: dto.providerModelId.trim(),
      endpoint: dto.endpoint.trim(),
      apiKey: dto.apiKey,
      capabilities: dto.capabilities,
      rpmLimit: dto.rpm.limit,
      tpmLimit: dto.tpm.limit,
      concurrencyLimit: dto.concurrency.limit,
      autoConcurrency: dto.autoConcurrency,
      inputTokenPricePerMillion: String(dto.pricing.inputPerMillion),
      outputTokenPricePerMillion: String(dto.pricing.outputPerMillion),
      extraBody: dto.extraBody ?? {},
    };

    const result = await this.runConnectivityProbe(
      // orgId (SaaS-only; undefined in OSS) sourced from the resolved ProjectContext — the project's org
      // is the rate-limit bucket (SPEC 08 §3.7), not the actor's org.
      { projectId, orgId, source: 'local' },
      model,
      `probe-draft-${modelId}`,
    );
    const probedAt = new Date(result.checkedAt);
    const probeError = result.ok ? null : (result.errorMessage ?? result.errorClass ?? 'unknown');

    return {
      modelId,
      status: result.ok ? 'success' : 'failed',
      probedAt: probedAt.toISOString(),
      durationMs: result.durationMs,
      error: probeError,
    };
  }

  async probeQuickStartDraftModel(
    dto: ProbeQuickStartDraftModelDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<ProbeModelResponseDto> {
    void source;
    await this.assertProbeWorkflowStart(LOCAL_PROJECT_CONTEXT, actor);
    const modelId = randomUUID();
    const model: ModelInvocationConfig = {
      id: modelId,
      providerType: dto.providerType.trim(),
      providerModelId: dto.providerModelId.trim(),
      endpoint: dto.endpoint.trim(),
      apiKey: dto.apiKey,
      capabilities: dto.capabilities,
      rpmLimit: dto.rpm.limit,
      tpmLimit: dto.tpm.limit,
      concurrencyLimit: dto.concurrency.limit,
      autoConcurrency: dto.autoConcurrency,
      inputTokenPricePerMillion: String(dto.pricing.inputPerMillion),
      outputTokenPricePerMillion: String(dto.pricing.outputPerMillion),
      extraBody: dto.extraBody ?? {},
    };

    // Quick-start probe is not project-scoped (no @CurrentProject at the endpoint), so there is no project
    // org to source — the rate-limit bucket is LOCAL_PROJECT_CONTEXT with undefined org. OSS-identical.
    const result = await this.runConnectivityProbe(LOCAL_PROJECT_CONTEXT, model, `probe-quick-start-draft-${modelId}`);
    const probedAt = new Date(result.checkedAt);
    const probeError = result.ok ? null : (result.errorMessage ?? result.errorClass ?? 'unknown');

    return {
      modelId,
      status: result.ok ? 'success' : 'failed',
      probedAt: probedAt.toISOString(),
      durationMs: result.durationMs,
      error: probeError,
    };
  }

  async updateProjectModel(
    projectId: string,
    modelId: string,
    dto: UpdateProjectModelDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
    orgId?: string,
  ): Promise<ProjectModelListItemDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    const existing = await this.repo.findModelById(modelId);
    if (!existing) {
      throw new NotFoundException(`Model ${modelId} not found`);
    }
    const patch = this.buildUpdateRow(dto, existing);
    await this.updateModelOrThrowNameConflict(modelId, patch);

    return this.getProjectModelDetail(projectId, modelId, actor, orgId);
  }

  async deleteProjectModel(
    projectId: string,
    modelId: string,
    query: ModelDeleteQueryDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<void> {
    void query;
    void source;
    await this.getWritableProject(projectId, actor);
    const existing = await this.repo.findModelById(modelId);
    if (!existing) {
      throw new NotFoundException(`Model ${modelId} not found`);
    }
    await this.assertNotActivelyReferenced(modelId);
    await this.repo.softDeleteModel(modelId);
  }

  async duplicateProjectModel(
    projectId: string,
    sourceModelId: string,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
    orgId?: string,
  ): Promise<ProjectModelListItemDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    const sourceRow = await this.repo.findModelAccessibleToProject(projectId, sourceModelId);
    if (!sourceRow) throw new NotFoundException(`Model ${sourceModelId} not found`);

    const apiKeyPlain = this.crypto.decryptApiKey(sourceRow.apiKeyEncrypted);
    const modelId = randomUUID();
    const insert: ModelInsertRow = {
      id: modelId,
      projectId,
      name: `${sourceRow.name} 副本`,
      providerType: sourceRow.providerType,
      providerModelId: sourceRow.providerModelId,
      endpoint: sourceRow.endpoint,
      apiKeyEncrypted: this.crypto.encryptApiKey(apiKeyPlain),
      contextWindowTokens: sourceRow.contextWindowTokens,
      rpmLimit: sourceRow.rpmLimit,
      tpmLimit: sourceRow.tpmLimit,
      concurrencyLimit: sourceRow.concurrencyLimit,
      autoConcurrency: sourceRow.autoConcurrency,
      inputTokenPricePerMillion: sourceRow.inputTokenPricePerMillion,
      outputTokenPricePerMillion: sourceRow.outputTokenPricePerMillion,
      capabilities: sourceRow.capabilities,
      extraBody: sourceRow.extraBody,
      isActive: true,
      lastProbedAt: null,
      lastProbeError: null,
      createdBy: actor.sub,
    };
    const created = await this.createModelOrThrowNameConflict(insert);

    return this.getProjectModelDetail(projectId, created.id, actor, orgId);
  }

  async revealProjectApiKey(
    projectId: string,
    modelId: string,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<RevealApiKeyResponseDto> {
    void source;
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findModelAccessibleToProject(projectId, modelId);
    if (!row) throw new NotFoundException(`Model ${modelId} not found`);
    const apiKey = this.crypto.decryptApiKey(row.apiKeyEncrypted);
    return { modelId, apiKey };
  }

  async probeProjectModel(
    projectId: string,
    modelId: string,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
    orgId?: string,
  ): Promise<ProbeModelResponseDto> {
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findModelAccessibleToProject(projectId, modelId);
    if (!row) throw new NotFoundException(`Model ${modelId} not found`);
    await this.assertProbeWorkflowStart({ projectId, orgId, source: 'local' }, actor);
    // orgId (SaaS-only; undefined in OSS) sourced from the resolved ProjectContext — the project's org
    // is the rate-limit bucket (SPEC 08 §3.7), not the actor's org.
    return this.probeAndRecord({ projectId, orgId, source: 'local' }, row, actor.sub, source, 'local');
  }

  async probeQuickStartExistingModel(
    modelId: string,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<ProbeModelResponseDto> {
    const row = await this.repo.findModelById(modelId);
    if (!row) {
      throw new NotFoundException(`Model ${modelId} not found`);
    }
    await this.assertProbeWorkflowStart(LOCAL_PROJECT_CONTEXT, actor);
    // Quick-start probe is not project-scoped (no @CurrentProject at the endpoint), so there is no project
    // org to source — the rate-limit bucket is LOCAL_PROJECT_CONTEXT with undefined org. OSS-identical.
    return this.probeAndRecord(LOCAL_PROJECT_CONTEXT, row, actor.sub, source, 'quick_start');
  }

  async getProjectModelReferences(
    projectId: string,
    modelId: string,
    actor: CurrentUserPayload,
  ): Promise<ModelReferencesDto> {
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findModelAccessibleToProject(projectId, modelId);
    if (!row) throw new NotFoundException(`Model ${modelId} not found`);
    return this.toReferencesDto(await this.repo.getActiveReferenceCounts(modelId));
  }

  async exportProjectModelsCsv(projectId: string, actor: CurrentUserPayload, orgId?: string): Promise<ModelExportFile> {
    const { data } = await this.listProjectModels(projectId, actor, orgId);
    const content = this.toProjectCsv(data);
    const buffer = Buffer.from(content, 'utf8');
    return {
      buffer,
      byteLength: buffer.byteLength,
      contentType: 'text/csv; charset=utf-8',
      fileName: `models-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  // -------------------------------------------------------------------------
  // Model context dictionary (behavior preserved)
  // -------------------------------------------------------------------------
  async listContextWindows(
    query: ListModelContextWindowsQueryDto,
  ): Promise<{ data: ModelContextWindowResponseDto[]; total: number }> {
    const data = (await this.repo.findContextWindows(query)).map((row) => this.toContextWindowResponse(row));
    return { data, total: data.length };
  }

  async lookupContextWindow(providerModelId: string): Promise<ModelContextWindowResponseDto | null> {
    const row = await this.repo.findContextWindowByProviderModelId(providerModelId);
    return row ? this.toContextWindowResponse(row) : null;
  }

  async upsertContextWindow(
    dto: UpsertModelContextWindowDto,
    actorUserId: string,
    source: ActionSource = 'api',
  ): Promise<ModelContextWindowResponseDto> {
    void source;
    const row = await this.repo.upsertContextWindow(dto, actorUserId);
    return this.toContextWindowResponse(row);
  }

  // =========================================================================
  // Private helpers
  // =========================================================================
  private async getAccessibleProject(projectId: string, actor: CurrentUserPayload) {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) throw new NotFoundException(`Local workspace ${projectId} not found`);
    return project;
  }

  private async getWritableProject(projectId: string, actor: CurrentUserPayload) {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    return this.getAccessibleProject(projectId, actor);
  }

  private async assertProbeWorkflowStart(project: ProjectContext, actor: CurrentUserPayload): Promise<void> {
    await this.workflowAuth.assertCanStart(toActorContext(actor), project, 'probe');
  }

  private async assertNotActivelyReferenced(modelId: string): Promise<void> {
    const counts = await this.repo.getActiveReferenceCounts(modelId);
    const total = counts.experiments + counts.optimizations + counts.canaryReleases + counts.productionReleases;
    if (total > 0) {
      throw new ConflictException(`model_referenced_active:${total}`);
    }
  }

  private buildInsertRow(
    projectId: string,
    modelId: string,
    dto: CreateProjectModelDto,
    actorUserId: string,
  ): ModelInsertRow {
    return {
      id: modelId,
      projectId,
      name: dto.name.trim(),
      providerType: dto.providerType.trim(),
      providerModelId: dto.providerModelId.trim(),
      endpoint: dto.endpoint.trim(),
      apiKeyEncrypted: this.crypto.encryptApiKey(dto.apiKey),
      contextWindowTokens: dto.contextWindowTokens ?? null,
      rpmLimit: dto.rpm.limit,
      tpmLimit: dto.tpm.limit,
      concurrencyLimit: dto.concurrency.limit,
      autoConcurrency: dto.autoConcurrency,
      inputTokenPricePerMillion: String(dto.pricing.inputPerMillion),
      outputTokenPricePerMillion: String(dto.pricing.outputPerMillion),
      capabilities: dto.capabilities,
      extraBody: dto.extraBody ?? {},
      isActive: dto.status !== 'disabled',
      lastProbedAt: dto.initialProbe ? new Date(dto.initialProbe.probedAt) : null,
      lastProbeError: dto.initialProbe
        ? dto.initialProbe.status === 'success'
          ? null
          : (dto.initialProbe.error ?? 'unknown')
        : null,
      createdBy: actorUserId,
    };
  }

  private buildUpdateRow(dto: UpdateProjectModelDto, existing: ModelRow): Partial<ModelInsertRow> {
    const patch: Partial<ModelInsertRow> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.providerType !== undefined) patch.providerType = dto.providerType.trim();
    if (dto.providerModelId !== undefined) patch.providerModelId = dto.providerModelId.trim();
    if (dto.endpoint !== undefined) patch.endpoint = dto.endpoint.trim();
    if (dto.apiKey !== undefined) patch.apiKeyEncrypted = this.crypto.encryptApiKey(dto.apiKey);
    if (dto.contextWindowTokens !== undefined) patch.contextWindowTokens = dto.contextWindowTokens ?? null;
    if (dto.rpm?.limit !== undefined) patch.rpmLimit = dto.rpm.limit;
    if (dto.tpm?.limit !== undefined) patch.tpmLimit = dto.tpm.limit;
    if (dto.concurrency?.limit !== undefined) patch.concurrencyLimit = dto.concurrency.limit;
    if (dto.autoConcurrency !== undefined) patch.autoConcurrency = dto.autoConcurrency;
    if (dto.pricing?.inputPerMillion !== undefined)
      patch.inputTokenPricePerMillion = String(dto.pricing.inputPerMillion);
    if (dto.pricing?.outputPerMillion !== undefined)
      patch.outputTokenPricePerMillion = String(dto.pricing.outputPerMillion);
    if (dto.capabilities !== undefined) patch.capabilities = dto.capabilities;
    if (dto.extraBody !== undefined) patch.extraBody = dto.extraBody;
    if (dto.status !== undefined) patch.isActive = dto.status !== 'disabled';

    void existing;
    return patch;
  }

  private async createModelOrThrowNameConflict(insert: ModelInsertRow): Promise<ModelRow> {
    try {
      return await this.repo.createModel(insert);
    } catch (error) {
      if (isModelNameUniqueViolation(error)) {
        throw new ConflictException('model_name_taken');
      }
      throw error;
    }
  }

  private async updateModelOrThrowNameConflict(modelId: string, patch: Partial<ModelInsertRow>): Promise<ModelRow> {
    try {
      return await this.repo.updateModel(modelId, patch);
    } catch (error) {
      if (isModelNameUniqueViolation(error)) {
        throw new ConflictException('model_name_taken');
      }
      throw error;
    }
  }

  private async probeAndRecord(
    project: ProjectContext,
    row: AnyModelRow,
    actorUserId: string,
    source: ActionSource,
    scope: ModelScope,
  ): Promise<ProbeModelResponseDto> {
    void actorUserId;
    void source;
    void scope;
    const apiKey = this.crypto.decryptApiKey(row.apiKeyEncrypted);
    const model: ModelInvocationConfig = {
      id: row.id,
      providerType: row.providerType,
      providerModelId: row.providerModelId,
      endpoint: row.endpoint,
      apiKey,
      capabilities: this.toModelCapabilities(row.capabilities),
      rpmLimit: row.rpmLimit,
      tpmLimit: row.tpmLimit,
      concurrencyLimit: row.concurrencyLimit,
      autoConcurrency: row.autoConcurrency,
      inputTokenPricePerMillion: row.inputTokenPricePerMillion,
      outputTokenPricePerMillion: row.outputTokenPricePerMillion,
      extraBody: this.toExtraBody(row.extraBody),
    };

    const result = await this.runConnectivityProbe(project, model, `probe-${row.id}`);

    const probedAt = new Date(result.checkedAt);
    const probeError = result.ok ? null : (result.errorMessage ?? result.errorClass ?? 'unknown');
    await this.repo.updateProbeOutcome(row.id, probedAt, probeError);

    return {
      modelId: row.id,
      status: result.ok ? 'success' : 'failed',
      probedAt: probedAt.toISOString(),
      durationMs: result.durationMs,
      error: probeError,
    };
  }

  private async runConnectivityProbe(project: ProjectContext, model: ModelInvocationConfig, requestId: string) {
    const mergedLimits = await this.runtimeLimitsProvider.mergeLlmLimits({
      project,
      modelId: model.id,
      source: 'probe',
    });
    const effectiveModel = applyRuntimeLimits(model, mergedLimits);
    return this.quotaPolicy.withExecutionSlot({ project, source: 'probe', modelId: model.id, requestId }, () =>
      testModelConnectivity(
        {
          model: effectiveModel,
          limiterKey: this.limiterKeyStrategy.buildModelKey(project, model.id),
          requestId,
          timeoutMs: 30_000,
        },
        {
          limiter: this.limiter,
          logger: this.logger,
        },
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Mapping: DB row → DTO
  // -------------------------------------------------------------------------
  // orgId (SaaS-only; undefined in OSS) is the resolved project's org — the rate-limit bucket (SPEC 08
  // §3.7). It is carried into the usage-snapshot READ key so it matches the worker's WRITE key under a
  // SaaS strategy; OSS leaves it undefined so the key stays `model:<id>`.
  private async toProjectModelListItem(row: ProjectVisibleModelRow, orgId?: string): Promise<ProjectModelListItemDto> {
    const project: ProjectContext = row.projectId
      ? { projectId: row.projectId, source: 'local', orgId }
      : LOCAL_PROJECT_CONTEXT;
    const usage = await this.fetchUsageSnapshot(row.id, project);
    const refs = await this.repo.getTotalReferenceCounts(row.id);

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      providerType: row.providerType,
      providerModelId: row.providerModelId,
      endpoint: row.endpoint,
      contextWindowTokens: row.contextWindowTokens,
      credentialTail: this.crypto.getCredentialTail(this.crypto.decryptApiKey(row.apiKeyEncrypted)),
      status: this.deriveStatus(row.isActive),
      probeStatus: this.deriveProbeStatus(row.lastProbedAt, row.lastProbeError),
      lastProbedAt: row.lastProbedAt?.toISOString() ?? null,
      lastProbeError: row.lastProbeError ?? null,
      rpm: this.toModelLimit(row.rpmLimit, 'rpm', usage),
      tpm: this.toModelLimit(row.tpmLimit, 'tpm', usage),
      concurrency: this.toConcurrencyLimit(row, usage),
      autoConcurrency: row.autoConcurrency,
      pricing: this.toModelPricing(row),
      capabilities: this.toModelCapabilities(row.capabilities),
      extraBody: this.toExtraBody(row.extraBody),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName ?? null,
      references: this.sumReferences(refs),
    };
  }

  private async fetchUsageSnapshot(
    modelId: string,
    project: ProjectContext = LOCAL_PROJECT_CONTEXT,
  ): Promise<UsageSnapshot | null> {
    if (!this.limiter.getUsage) return null;
    try {
      // Query the same key the worker counts against (§3.7) so usage reflects real rate-limit state.
      const key = this.limiterKeyStrategy.buildModelKey(project, modelId);
      return await withTimeout(
        this.limiter.getUsage(key),
        MODEL_USAGE_SNAPSHOT_TIMEOUT_MS,
        `limiter_getUsage_timeout:${modelId}`,
      );
    } catch (error) {
      this.logger.warn({ msg: 'limiter_getUsage_failed', modelId, error: (error as Error).message });
      return null;
    }
  }

  private deriveStatus(isActive: boolean): ModelStatus {
    return isActive ? 'enabled' : 'disabled';
  }

  private deriveProbeStatus(lastProbedAt: Date | null, lastProbeError: string | null): ModelProbeStatus {
    if (!lastProbedAt) return 'pending';
    return lastProbeError ? 'failed' : 'success';
  }

  private toModelLimit(limit: number, kind: 'rpm' | 'tpm' | 'concurrency', usage: UsageSnapshot | null): ModelLimitDto {
    const current = usage
      ? kind === 'rpm'
        ? usage.rpmUsed
        : kind === 'tpm'
          ? usage.tpmUsed
          : usage.concurrencyInUse
      : 0;
    const ratio = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
    return { limit, usage: ratio, current };
  }

  // Concurrency display: surface the system-derived effective cap when autoConcurrency is on and the
  // model has accumulated autostate (latency EWMA). See docs/specs/21-models.md §6.1
  private toConcurrencyLimit(
    row: ProjectVisibleModelRow,
    usage: UsageSnapshot | null,
  ): ModelLimitDto & { effective?: number } {
    const base = this.toModelLimit(row.concurrencyLimit, 'concurrency', usage);
    if (!row.autoConcurrency || !usage || usage.latencyEwmaMs === undefined) return base;
    const effective = deriveEffectiveConcurrency({
      rpmLimit: row.rpmLimit,
      tpmLimit: row.tpmLimit,
      ceiling: row.concurrencyLimit,
      latencyEwmaMs: usage.latencyEwmaMs,
      tokensEwma: usage.tokensEwma ?? 1,
      backoffFactor: usage.backoffFactor ?? 1,
    });
    return { ...base, effective };
  }

  private toModelPricing(row: ModelRow): ModelPricingDto {
    return {
      inputPerMillion: Number(row.inputTokenPricePerMillion ?? 0),
      outputPerMillion: Number(row.outputTokenPricePerMillion ?? 0),
    };
  }

  private toModelCapabilities(raw: unknown): ModelCapabilitiesDto {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const image = (raw as Record<string, unknown>).image;
      if (typeof image === 'string' && ['none', 'url', 'base64', 'both'].includes(image)) {
        return { image: image as ModelImageCapability };
      }
    }
    return { image: 'none' };
  }

  private toExtraBody(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...(raw as Record<string, unknown>) };
    }
    return {};
  }

  private toActiveUsage(counts: ModelReferenceCounts): ModelActiveUsageDto {
    return {
      experiments: counts.experiments,
      optimizations: counts.optimizations,
      canaryReleases: counts.canaryReleases,
      productionReleases: counts.productionReleases,
    };
  }

  private toReferencesDto(counts: ModelReferenceCounts): ModelReferencesDto {
    return { ...this.toActiveUsage(counts), total: this.sumReferences(counts) };
  }

  private sumReferences(counts: ModelReferenceCounts): number {
    return counts.experiments + counts.optimizations + counts.canaryReleases + counts.productionReleases;
  }

  private toContextWindowResponse(row: ModelContextWindowRow): ModelContextWindowResponseDto {
    return {
      providerModelId: row.providerModelId,
      contextWindowTokens: row.contextWindowTokens,
      updatedBy: row.updatedBy ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------
  private toProjectCsv(rows: ProjectModelListItemDto[]): string {
    const header = [
      'id',
      'name',
      'providerType',
      'providerModelId',
      'endpoint',
      'status',
      'probeStatus',
      'rpmLimit',
      'tpmLimit',
      'concurrencyLimit',
      'autoConcurrency',
      'inputPerMillion',
      'outputPerMillion',
      'references',
      'lastProbedAt',
    ];
    const lines = rows.map((r) =>
      [
        r.id,
        r.name,
        r.providerType,
        r.providerModelId,
        r.endpoint,
        r.status,
        r.probeStatus,
        r.rpm.limit,
        r.tpm.limit,
        r.concurrency.limit,
        r.autoConcurrency,
        r.pricing.inputPerMillion,
        r.pricing.outputPerMillion,
        r.references,
        r.lastProbedAt ?? '',
      ]
        .map((v) => this.toCsvCell(v))
        .join(','),
    );
    return `\uFEFF${[header.join(','), ...lines].join('\n')}\n`;
  }

  private toCsvCell(value: unknown): string {
    const text =
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? (JSON.stringify(value) ?? '')
          : String(value);
    if (!/[",\n\r]/u.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isModelNameUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, /idx_models_project_name_active/);
}
