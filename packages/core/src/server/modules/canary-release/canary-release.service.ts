// Canary release compatibility service. The source of truth is release_lines / release_line_events.
// See docs/specs/27-releases.md and docs/specs/03-orchestration.md §3.3
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  CanaryAnnotationDto,
  CanaryReleaseDto,
  CanaryReleaseListItemDto,
  ClaimCanaryAnnotationsInputDto,
  CreateCanaryReleaseInputDto,
  ReleaseCanaryAnnotationInputDto,
  SubmitCanaryAnnotationInputDto,
  UpdateCanaryTrafficRatioInputDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { WorkflowAuthorizationHook } from '../../common/contracts/workflow-authorization.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ReleaseLineService } from '../release-line/release-line.service';
import { assertReleasePromptVariableMapping } from '../release-line/release-variable-mapping';
import {
  CanaryReleaseRepository,
  type AnnotationRow,
  type CanaryParentProductionRow,
  type CanaryReleaseRowWithJoins,
  type CanaryUsageTotals,
} from './canary-release.repository';

type ResolvedCanaryCreateValues = {
  name: string | null;
  description: string | null;
  outputConnectorIds: string[];
  trafficMode: CreateCanaryReleaseInputDto['trafficMode'];
  filterRules: CreateCanaryReleaseInputDto['filterRules'];
  variableMapping: CreateCanaryReleaseInputDto['variableMapping'];
  externalIdField: string;
};

@Injectable()
export class CanaryReleaseService {
  private readonly logger = createLogger('canary-release.service', { service: 'server' });

  constructor(
    @Inject(CanaryReleaseRepository)
    private readonly repo: CanaryReleaseRepository,
    @Inject(ReleaseLineService)
    private readonly releaseLineService: ReleaseLineService,
    @Inject(AccessControlService)
    private readonly accessControl: AccessControlService,
    @Inject(WorkflowAuthorizationHook)
    private readonly workflowAuth: WorkflowAuthorizationHook,
  ) {}

  async list(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<{ data: CanaryReleaseListItemDto[]; total: number }> {
    await this.assertReadAccess(projectId, actor);
    const rows = await this.repo.listByProject(projectId);
    if (rows.length === 0) return { data: [], total: 0 };

    const outputIds = new Set<string>();
    for (const row of rows) for (const id of row.outputConnectorIds ?? []) outputIds.add(id);
    const outputMap = await this.loadOutputConnectorMap(projectId, Array.from(outputIds));
    const usageMap = await this.repo.aggregateUsageByCanaryIds(rows.map((row) => row.id));

    const data: CanaryReleaseListItemDto[] = [];
    for (const row of rows) {
      const progress = await this.repo.getAnnotationProgress(row.id);
      const base = this.toDto(row, outputMap, usageMap.get(row.id));
      data.push({
        ...base,
        annotationProgress: {
          total: progress.total,
          claimed: progress.claimed,
          submitted: progress.submitted,
        },
        quality: buildAnnotationQuality(progress),
      });
    }
    return { data, total: data.length };
  }

  async getDetail(projectId: string, canaryId: string, actor: CurrentUserPayload): Promise<CanaryReleaseDto> {
    await this.assertReadAccess(projectId, actor);
    const row = await this.repo.findByIdWithJoins(projectId, canaryId);
    if (!row) throw new NotFoundException(`Canary release ${canaryId} not found`);
    const [outputMap, usageMap] = await Promise.all([
      this.loadOutputConnectorMap(projectId, row.outputConnectorIds ?? []),
      this.repo.aggregateUsageByCanaryIds([row.id]),
    ]);
    return this.toDto(row, outputMap, usageMap.get(row.id));
  }

  async create(
    projectId: string,
    input: CreateCanaryReleaseInputDto,
    actor: CurrentUserPayload,
    orgId?: string,
  ): Promise<CanaryReleaseDto> {
    await this.assertWriteAccess(projectId, actor);

    const version = await this.repo.findPromptVersionForProject(projectId, input.promptVersionId);
    if (!version) throw new NotFoundException(`Prompt version ${input.promptVersionId} not found`);
    const model = await this.repo.findModelById(input.modelId);
    if (!model) throw new NotFoundException(`Model ${input.modelId} not found`);
    const inputConnector = await this.repo.findConnectorForProject(projectId, input.inputConnectorId);
    if (!inputConnector) throw new NotFoundException(`Input connector ${input.inputConnectorId} not found`);
    if (inputConnector.direction !== 'input') {
      throw new BadRequestException(`Connector ${input.inputConnectorId} is not an input connector`);
    }

    const parentProduction = await this.repo.findRunningProductionByInputConnector(projectId, input.inputConnectorId);
    const createValues = this.resolveCreateValuesForParentProduction(input, version, parentProduction);
    const lineName =
      createValues.name ?? version.promptName ?? inputConnector.name ?? `release-${input.inputConnectorId.slice(0, 8)}`;
    if (!parentProduction) {
      await this.releaseLineService.assertNameAvailable(projectId, lineName, {
        promptId: version.promptId,
        inputConnectorId: input.inputConnectorId,
      });
    }

    if (createValues.outputConnectorIds.length > 0) {
      const outs = await this.repo.listConnectorsForProject(projectId, createValues.outputConnectorIds);
      const found = new Set(outs.map((connector) => connector.id));
      for (const id of createValues.outputConnectorIds) {
        if (!found.has(id)) throw new NotFoundException(`Output connector ${id} not found in project`);
      }
      for (const connector of outs) {
        if (connector.direction !== 'output') {
          throw new BadRequestException(`Connector ${connector.id} is not an output connector`);
        }
      }
    }

    if (input.targetDatasetId) {
      const ds = await this.repo.findDatasetForProject(projectId, input.targetDatasetId);
      if (!ds) throw new NotFoundException(`Dataset ${input.targetDatasetId} not found`);
    }

    const snapshots = buildPromptSnapshots(version);
    assertReleasePromptVariableMapping({
      variableMapping: createValues.variableMapping,
      promptVersionSnapshot: snapshots.promptVersionSnapshot,
      externalIdField: createValues.externalIdField,
    });

    await this.assertReleaseWorkflowStart(projectId, actor, orgId);

    const now = new Date();
    const line = await this.releaseLineService.recordCanaryEvent(
      {
        id: randomUUID(),
        projectId,
        name: lineName,
        description: createValues.description,
        promptVersionId: input.promptVersionId,
        modelId: input.modelId,
        inputConnectorId: input.inputConnectorId,
        outputConnectorIds: createValues.outputConnectorIds,
        status: 'running',
        controlState: null,
        controlStatePayload: null,
        trafficRatio: input.trafficRatio,
        trafficMode: createValues.trafficMode,
        runConfig: withCanaryStopConditions(input.runConfig, input.stopConditions),
        variableMapping: createValues.variableMapping,
        outputMapping: input.outputMapping,
        filterRules: createValues.filterRules,
        recordMode: input.recordMode,
        recordCategories: input.recordCategories.length > 0 ? input.recordCategories : input.storageCategories,
        externalIdField: createValues.externalIdField,
        metrics: null,
        totalReceived: 0,
        totalProcessed: 0,
        totalFiltered: 0,
        totalCorrect: 0,
        totalErrors: 0,
        startedAt: now,
        finishedAt: null,
        createdBy: actor.sub,
        createdAt: now,
        updatedAt: now,
        promptId: version.promptId,
        promptName: version.promptName,
        promptVersionLabel: `v${version.versionNumber}`,
        promptSnapshot: snapshots.promptSnapshot,
        promptVersionSnapshot: snapshots.promptVersionSnapshot,
        modelName: model.name,
        modelProvider: model.providerType,
        inputConnectorName: inputConnector.name,
        inputConnectorType: inputConnector.type,
      },
      'create_canary',
      'running',
    );
    const eventId = line.activeCanaryEvent?.id;
    if (!eventId) throw new Error('Canary release event was not recorded');
    await this.repo.markPromptVersionCanary(version.promptId, input.promptVersionId, actor.sub);
    return this.getDetail(projectId, eventId, actor);
  }

  async start(
    projectId: string,
    canaryId: string,
    actor: CurrentUserPayload,
    orgId?: string,
  ): Promise<CanaryReleaseDto> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    if (current.status === 'running') return this.getDetail(projectId, current.id, actor);
    if (current.status !== 'stopped') {
      throw new ConflictException(`Canary ${canaryId} cannot start from status ${current.status}`);
    }
    await this.assertReleaseWorkflowStart(projectId, actor, orgId);
    const eventId = await this.recordCanaryOperation(current, 'resume_lane', 'running', null, actor);
    return this.getDetail(projectId, eventId, actor);
  }

  async stop(projectId: string, canaryId: string, actor: CurrentUserPayload): Promise<CanaryReleaseDto> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    if (current.status !== 'running') {
      throw new BadRequestException(`Canary ${canaryId} cannot stop from status ${current.status}`);
    }
    const eventId = await this.recordCanaryOperation(current, 'stop_lane', 'stopped', null, actor);
    return this.getDetail(projectId, eventId, actor);
  }

  async resume(
    projectId: string,
    canaryId: string,
    actor: CurrentUserPayload,
    orgId?: string,
  ): Promise<CanaryReleaseDto> {
    return this.start(projectId, canaryId, actor, orgId);
  }

  async cancel(projectId: string, canaryId: string, actor: CurrentUserPayload): Promise<CanaryReleaseDto> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    if (current.status !== 'running' && current.status !== 'stopped') {
      throw new BadRequestException(`Canary ${canaryId} cannot cancel from status ${current.status}`);
    }
    const eventId = await this.recordCanaryOperation(current, 'cancel_canary', 'cancelled', 'cancelled', actor);
    return this.getDetail(projectId, eventId, actor);
  }

  async updateTrafficRatio(
    projectId: string,
    canaryId: string,
    input: UpdateCanaryTrafficRatioInputDto,
    actor: CurrentUserPayload,
  ): Promise<CanaryReleaseDto> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    if (current.status !== 'running' && current.status !== 'stopped') {
      throw new BadRequestException(`Canary ${canaryId} cannot update traffic ratio from status ${current.status}`);
    }

    const previousTrafficRatio = Number(current.trafficRatio);
    const updated = await this.releaseLineService.updateTrafficRatio(
      projectId,
      current.releaseLineId,
      { trafficRatio: input.trafficRatio },
      actor,
    );
    const activeCanaryId = updated.activeCanaryEvent?.id ?? current.id;
    this.logger.info(
      { canaryId, releaseLineId: current.releaseLineId, previousTrafficRatio, trafficRatio: input.trafficRatio },
      'canary_release_traffic_ratio_updated',
    );
    return this.getDetail(projectId, activeCanaryId, actor);
  }

  async softDelete(
    projectId: string,
    canaryId: string,
    _options: { force: boolean; reason?: string },
    actor: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.repo.findByIdWithJoins(projectId, canaryId);
    if (!current) throw new NotFoundException(`Canary release ${canaryId} not found`);
    if (current.status === 'running' || current.status === 'stopped') {
      await this.recordCanaryOperation(current, 'cancel_canary', 'cancelled', 'cancelled', actor);
    }
    return { ok: true };
  }

  async listAnnotations(
    projectId: string,
    canaryId: string,
    filter: { status?: 'pending' | 'claimed' | 'submitted'; limit: number; offset: number },
    actor: CurrentUserPayload,
  ): Promise<{ data: CanaryAnnotationDto[]; total: number }> {
    await this.assertReadAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    const [rows, total] = await Promise.all([
      this.repo.listAnnotations(current.id, filter),
      this.repo.countAnnotations(current.id, { status: filter.status }),
    ]);
    return { data: rows.map((row) => this.toAnnotationDto(row, current.id)), total };
  }

  async claimAnnotations(
    projectId: string,
    canaryId: string,
    input: ClaimCanaryAnnotationsInputDto,
    actor: CurrentUserPayload,
  ): Promise<{ data: CanaryAnnotationDto[]; claimedCount: number }> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    const claimed = await this.repo.claimAnnotations(current.id, actor.sub, input.batchSize);
    return {
      data: claimed.map((row) => this.toAnnotationDto(row, current.id)),
      claimedCount: claimed.length,
    };
  }

  async submitAnnotation(
    projectId: string,
    canaryId: string,
    input: SubmitCanaryAnnotationInputDto,
    actor: CurrentUserPayload,
  ): Promise<CanaryAnnotationDto> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    const updated = await this.repo.submitAnnotation(input.annotationId, actor.sub, {
      isCorrect: input.isCorrect,
      notes: input.notes,
      fields: input.fields,
    });
    if (!updated)
      throw new NotFoundException(`Annotation ${input.annotationId} not owned by actor or already submitted`);
    return this.toAnnotationDto(updated, current.id);
  }

  async releaseAnnotation(
    projectId: string,
    canaryId: string,
    input: ReleaseCanaryAnnotationInputDto,
    actor: CurrentUserPayload,
  ): Promise<CanaryAnnotationDto> {
    await this.assertWriteAccess(projectId, actor);
    const current = await this.getCanaryRow(projectId, canaryId);
    const updated = await this.repo.releaseAnnotation(input.annotationId, actor.sub);
    if (!updated) throw new NotFoundException(`Annotation ${input.annotationId} not owned by actor`);
    return this.toAnnotationDto(updated, current.id);
  }

  private async assertReadAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const access = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!access) throw new NotFoundException(`Project ${projectId} not found`);
  }

  private async assertWriteAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'release_manage');
    return this.assertReadAccess(projectId, actor);
  }

  private async assertReleaseWorkflowStart(
    projectId: string,
    actor: CurrentUserPayload,
    orgId?: string,
  ): Promise<void> {
    await this.workflowAuth.assertCanStart(
      toActorContext(actor),
      { projectId, ...(orgId ? { orgId } : {}), source: 'local' },
      'release',
    );
  }

  private async getCanaryRow(projectId: string, canaryId: string): Promise<CanaryReleaseRowWithJoins> {
    const current = await this.repo.findByIdWithJoins(projectId, canaryId);
    if (!current) throw new NotFoundException(`Canary release ${canaryId} not found`);
    return current;
  }

  private async loadOutputConnectorMap(
    projectId: string,
    ids: string[],
  ): Promise<Map<string, { id: string; name: string; type: string }>> {
    const map = new Map<string, { id: string; name: string; type: string }>();
    if (ids.length === 0) return map;
    const rows = await this.repo.listConnectorsForProject(projectId, ids);
    for (const row of rows) map.set(row.id, { id: row.id, name: row.name, type: row.type });
    return map;
  }

  private resolveCreateValuesForParentProduction(
    input: CreateCanaryReleaseInputDto,
    version: { id: string; promptId: string; versionNumber?: number | null; variables: unknown },
    parentProduction: CanaryParentProductionRow | null,
  ): ResolvedCanaryCreateValues {
    const trafficMode = input.trafficMode ?? 'split';
    if (!parentProduction) {
      return {
        name: normalizeOptionalText(input.name),
        description: normalizeOptionalText(input.description),
        outputConnectorIds: input.outputConnectorIds,
        trafficMode,
        filterRules: input.filterRules,
        variableMapping: input.variableMapping,
        externalIdField: input.externalIdField,
      };
    }

    if (parentProduction.promptId !== version.promptId) {
      throw new BadRequestException('Canary candidate must use a version from the production release prompt');
    }
    if (parentProduction.promptVersionId === version.id) {
      throw new BadRequestException('Canary candidate must use a different prompt version from production');
    }

    const inheritedOutputIds = parentProduction.outputConnectorIds ?? [];
    const outputConnectorIds =
      trafficMode === 'dual_run' ? mergeConnectorIds(inheritedOutputIds, input.outputConnectorIds) : inheritedOutputIds;
    const externalIdField = parentProduction.externalIdField ?? input.externalIdField;
    if (!externalIdField) throw new BadRequestException('Parent production release does not define externalIdField');

    return {
      name: null,
      description: null,
      outputConnectorIds,
      trafficMode,
      filterRules: parentProduction.filterRules as CreateCanaryReleaseInputDto['filterRules'],
      variableMapping: productionVariableMappingToCanary(
        parentProduction.variableMapping,
        externalIdField,
        version.variables,
      ),
      externalIdField,
    };
  }

  private async recordCanaryOperation(
    row: CanaryReleaseRowWithJoins,
    operation: Parameters<ReleaseLineService['recordCanaryEvent']>[1],
    status: Parameters<ReleaseLineService['recordCanaryEvent']>[2],
    terminalReason: Parameters<ReleaseLineService['recordCanaryEvent']>[3],
    actor: CurrentUserPayload,
  ): Promise<string> {
    const now = new Date();
    const line = await this.releaseLineService.recordCanaryEvent(
      {
        id: randomUUID(),
        projectId: row.projectId,
        name: row.name ?? '',
        description: row.description,
        promptVersionId: row.promptVersionId,
        modelId: row.modelId,
        inputConnectorId: row.inputConnectorId,
        outputConnectorIds: row.outputConnectorIds ?? [],
        status: status ?? row.status,
        controlState: null,
        controlStatePayload: null,
        trafficRatio: Number(row.trafficRatio),
        trafficMode: (row.trafficMode ?? 'split') as 'split' | 'dual_run',
        runConfig: row.runConfig,
        variableMapping: row.variableMapping,
        outputMapping: row.outputMapping,
        filterRules: row.filterRules,
        recordMode: row.recordMode as Parameters<ReleaseLineService['recordCanaryEvent']>[0]['recordMode'],
        recordCategories: row.recordCategories ?? row.storageCategories ?? [],
        externalIdField: row.externalIdField,
        metrics: (row.metrics ?? null) as Record<string, unknown> | null,
        totalReceived: row.totalReceived,
        totalProcessed: row.totalProcessed,
        totalFiltered: row.totalFiltered,
        totalCorrect: row.totalCorrect,
        totalErrors: row.totalErrors,
        startedAt: status === 'running' ? now : row.startedAt,
        finishedAt: status === 'running' ? null : now,
        createdBy: actor.sub,
        createdAt: now,
        updatedAt: now,
        promptId: row.promptId,
        promptName: row.promptName,
        promptVersionLabel: row.promptVersionNumber !== null ? `v${row.promptVersionNumber}` : null,
        promptSnapshot: row.promptSnapshot,
        promptVersionSnapshot: row.promptVersionSnapshot,
        modelName: row.modelName,
        modelProvider: row.modelProvider,
        inputConnectorName: row.inputConnectorName,
        inputConnectorType: row.inputConnectorType,
      },
      operation,
      status,
      terminalReason,
    );
    const eventId = line.activeCanaryEvent?.id ?? line.latestEvent?.id;
    if (!eventId) throw new Error(`Canary operation ${operation} did not produce an event`);
    return eventId;
  }

  private toDto(
    row: CanaryReleaseRowWithJoins,
    outputMap: Map<string, { id: string; name: string; type: string }>,
    usage?: CanaryUsageTotals,
  ): CanaryReleaseDto {
    const outputConnectors = (row.outputConnectorIds ?? [])
      .map((id) => outputMap.get(id))
      .filter((connector): connector is { id: string; name: string; type: string } => Boolean(connector));
    return {
      id: row.id,
      projectId: row.projectId,
      releaseLineId: row.releaseLineId,
      name: row.name,
      description: row.description,
      promptVersionId: row.promptVersionId,
      modelId: row.modelId,
      inputConnectorId: row.inputConnectorId,
      outputConnectorIds: row.outputConnectorIds ?? [],
      status: row.status as CanaryReleaseDto['status'],
      controlState: row.controlState as CanaryReleaseDto['controlState'],
      controlStatePayload: row.controlStatePayload as Record<string, unknown> | null,
      trafficRatio: parseFloat(String(row.trafficRatio)),
      trafficMode: (row.trafficMode ?? 'split') as CanaryReleaseDto['trafficMode'],
      runMode: row.runMode as CanaryReleaseDto['runMode'],
      stopConditions: row.stopConditions as CanaryReleaseDto['stopConditions'],
      recordMode: row.recordMode as CanaryReleaseDto['recordMode'],
      recordCategories: row.recordCategories ?? [],
      filterRules: row.filterRules as CanaryReleaseDto['filterRules'],
      variableMapping: normalizeCanaryVariableMapping(row.variableMapping),
      outputMapping: (Array.isArray(row.outputMapping) ? row.outputMapping : []) as CanaryReleaseDto['outputMapping'],
      externalIdField: row.externalIdField,
      annotationSchema: row.annotationSchema as CanaryReleaseDto['annotationSchema'],
      storageCategories: row.storageCategories ?? [],
      targetDatasetId: row.targetDatasetId,
      runConfig: row.runConfig as CanaryReleaseDto['runConfig'],
      totalReceived: row.totalReceived,
      totalProcessed: row.totalProcessed,
      totalFiltered: row.totalFiltered,
      totalCorrect: row.totalCorrect,
      totalErrors: row.totalErrors,
      metrics: mergeCanaryUsageMetrics(row.metrics, usage),
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      promptId: row.promptId,
      promptName: row.promptName,
      promptVersionLabel: row.promptVersionNumber !== null ? `v${row.promptVersionNumber}` : null,
      modelName: row.modelName,
      modelProvider: row.modelProvider,
      inputConnectorName: row.inputConnectorName,
      inputConnectorType: row.inputConnectorType,
      outputConnectors,
      targetDatasetName: row.targetDatasetName,
      createdByName: row.createdByName,
      annotationTaskId: row.annotationTaskId,
      releaseVersionId: row.releaseVersionId,
      releaseVersionLabel: row.releaseVersionLabel,
    };
  }

  private toAnnotationDto(row: AnnotationRow, canaryId: string): CanaryAnnotationDto {
    return {
      id: row.id,
      canaryId,
      taskId: row.taskId ?? '',
      runResultId: row.runResultId,
      externalId: row.externalId ?? null,
      inputPreview: previewValue(row.inputVariables),
      outputPreview: previewOutput(row),
      inputVariables: isRecord(row.inputVariables) ? row.inputVariables : null,
      renderedPrompt: row.renderedPrompt ?? null,
      decisionOutput: row.decisionOutput ?? null,
      rawResponse: row.rawResponse ?? null,
      parsedOutput: row.parsedOutput ?? null,
      latencyMs: toNumberOrNull(row.latencyMs),
      inputTokens: toNumberOrNull(row.inputTokens),
      outputTokens: toNumberOrNull(row.outputTokens),
      isCorrect: row.isCorrect,
      fields: (row.fields ?? {}) as Record<string, unknown>,
      notes: row.notes,
      lockedBy: row.lockedBy,
      lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
      lockHeartbeatAt: row.lockHeartbeatAt ? row.lockHeartbeatAt.toISOString() : null,
      submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
      submittedBy: row.submittedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function buildPromptSnapshots(version: {
  id: string;
  promptId: string;
  promptName: string | null;
  promptDefaultDatasetId: string | null;
  versionNumber: number;
  body: string | null;
  variables: unknown;
  outputSchema: unknown;
  judgmentRules: unknown;
  promptLanguage: string;
  createdBy: string;
  createdAt: Date;
  frozenAt: Date | null;
}) {
  return {
    promptSnapshot: {
      id: version.promptId,
      name: version.promptName,
      defaultDatasetId: version.promptDefaultDatasetId,
    },
    promptVersionSnapshot: {
      id: version.id,
      promptId: version.promptId,
      versionNumber: version.versionNumber,
      body: version.body ?? '',
      variables: version.variables ?? [],
      outputSchema: version.outputSchema ?? null,
      judgmentRules: version.judgmentRules ?? null,
      promptLanguage: version.promptLanguage,
      createdBy: version.createdBy,
      createdAt: version.createdAt.toISOString(),
      frozenAt: version.frozenAt?.toISOString() ?? null,
    },
  };
}

function withCanaryStopConditions(
  runConfig: CreateCanaryReleaseInputDto['runConfig'],
  stopConditions: CreateCanaryReleaseInputDto['stopConditions'],
): CreateCanaryReleaseInputDto['runConfig'] {
  const next = { ...runConfig };
  const effectiveStopConditions = stopConditions ?? runConfig.stopConditions ?? null;
  if (effectiveStopConditions) {
    next.stopConditions = effectiveStopConditions;
  } else {
    delete next.stopConditions;
  }
  return next;
}

function mergeCanaryUsageMetrics(
  metrics: unknown,
  usage: CanaryUsageTotals | undefined,
): Record<string, unknown> | null {
  const base = isRecord(metrics) ? { ...metrics } : {};
  if (!usage) return Object.keys(base).length > 0 ? base : null;
  const totalTokens = usage.inputTokens + usage.outputTokens;
  return {
    ...base,
    runCount: usage.runCount,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens,
    costEstimate: usage.costEstimate,
    totalCost: usage.costEstimate,
  };
}

function buildAnnotationQuality(progress: { correct: number; wrong: number }): CanaryReleaseListItemDto['quality'] {
  const judged = progress.correct + progress.wrong;
  if (judged <= 0) return null;
  const score = progress.correct / judged;
  return { precision: score, recall: score, f1: score };
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function mergeConnectorIds(requiredIds: string[], selectedIds: string[]): string[] {
  return Array.from(new Set([...requiredIds, ...selectedIds].filter(Boolean)));
}

function productionVariableMappingToCanary(
  value: unknown,
  externalIdField: string,
  promptVariables: unknown,
): CreateCanaryReleaseInputDto['variableMapping'] {
  const requiredTargets = getRequiredPromptVariableTargets(promptVariables);
  const mapping: CreateCanaryReleaseInputDto['variableMapping'] = [];
  if (isRecord(value)) {
    for (const [target, source] of Object.entries(value)) {
      if (typeof source !== 'string' || !source || !target) continue;
      mapping.push({ source, target, required: target === 'id' || requiredTargets.has(target) });
    }
  }
  if (!mapping.some((item) => item.target === 'id')) {
    mapping.push({ source: externalIdField, target: 'id', required: true });
  }
  return mapping;
}

function normalizeCanaryVariableMapping(value: unknown): CanaryReleaseDto['variableMapping'] {
  if (Array.isArray(value)) return value as CanaryReleaseDto['variableMapping'];
  if (!isRecord(value)) return [{ source: 'id', target: 'id', required: true }];
  return Object.entries(value).map(([target, source]) => ({
    source: typeof source === 'string' ? source : target,
    target,
    required: target === 'id',
  }));
}

function getRequiredPromptVariableTargets(value: unknown): Set<string> {
  const required = new Set<string>();
  if (!Array.isArray(value)) return required;
  for (const item of value) {
    if (!isRecord(item) || item['required'] !== true || typeof item['name'] !== 'string') continue;
    required.add(item['name']);
  }
  return required;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function previewValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 500);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function previewOutput(row: AnnotationRow): string | null {
  return row.decisionOutput ?? previewValue(row.parsedOutput) ?? previewValue(row.rawResponse);
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
