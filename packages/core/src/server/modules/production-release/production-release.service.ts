// Production release compatibility service. The source of truth is release_lines / release_line_events.
// See docs/specs/27-releases.md
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProductionReleaseInputDto,
  ProductionReleaseEventDto,
  ProductionReleaseHistoryItemDto,
  ProductionReleaseListItemDto,
  StopProductionReleaseInputDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import {
  ProductionReleaseRepository,
  type ProductionReleaseEventRowWithJoins,
  type ProductionReleasePromptRow,
  type ProductionReleasePromptVersionRow,
} from './production-release.repository';
import { ReleaseLineService } from '../release-line/release-line.service';

@Injectable()
export class ProductionReleaseService {
  constructor(
    private readonly repo: ProductionReleaseRepository,
    private readonly accessControl: AccessControlService,
    private readonly releaseLineService?: ReleaseLineService,
  ) {}

  // -------------------------------------------------------------------------
  // List: one row per prompt; stopped releases still retain the latest event as an offline record
  // -------------------------------------------------------------------------
  async list(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<{ data: ProductionReleaseListItemDto[]; total: number }> {
    await this.assertReadAccess(projectId, actor);
    const aggregates = await this.repo.listAggregatedByProject(projectId);
    const data: ProductionReleaseListItemDto[] = aggregates.map((agg) => {
      const ev = agg.currentEvent;
      const isOnline = ev?.status === 'running';
      const onlineDurationMs =
        isOnline && ev.startedAt ? Math.max(0, Date.now() - new Date(ev.startedAt).getTime()) : null;
      return {
        promptId: agg.promptId,
        promptName: agg.promptName,
        promptVersionLabel: ev ? this.versionLabel(ev.promptVersionNumber) : null,
        aggregateStatus: isOnline ? 'online' : 'offline',
        currentEvent: ev ? this.toEventDto(ev) : null,
        currentEventCreatedAt: ev ? ev.createdAt.toISOString() : null,
        modelName: ev?.modelName ?? null,
        modelProvider: ev?.modelProvider ?? null,
        inputConnectorName: ev?.inputConnectorName ?? null,
        inputConnectorType: ev?.inputConnectorType ?? null,
        outputConnectors: agg.outputConnectors,
        lastEventType: (agg.lastEventType as ProductionReleaseEventDto['eventType']) ?? null,
        onlineDurationMs,
      };
    });
    return { data, total: data.length };
  }

  // -------------------------------------------------------------------------
  // Detail: single event
  // -------------------------------------------------------------------------
  async getDetail(projectId: string, eventId: string, actor: CurrentUserPayload): Promise<ProductionReleaseEventDto> {
    await this.assertReadAccess(projectId, actor);
    const row = await this.repo.findEventById(projectId, eventId);
    if (!row) throw new NotFoundException(`Production release event ${eventId} not found`);
    return this.toEventDto(row);
  }

  // -------------------------------------------------------------------------
  // Per-prompt timeline (newest first)
  // -------------------------------------------------------------------------
  async getHistory(
    projectId: string,
    promptId: string,
    actor: CurrentUserPayload,
  ): Promise<{ data: ProductionReleaseHistoryItemDto[]; total: number }> {
    await this.assertReadAccess(projectId, actor);
    const prompt = await this.repo.findPromptForProject(projectId, promptId);
    if (!prompt) throw new NotFoundException(`Prompt ${promptId} not found in project`);
    const rows = await this.repo.listEventsByPrompt(projectId, promptId);

    // Look up the target version number for a rollback event
    const rollbackTargetIds = rows.map((r) => r.rollbackTargetEventId).filter((id): id is string => !!id);
    const rollbackTargetMap = new Map<string, number | null>();
    if (rollbackTargetIds.length > 0) {
      const targets = await Promise.all(rollbackTargetIds.map((id) => this.repo.findEventById(projectId, id)));
      for (const t of targets) {
        if (t) rollbackTargetMap.set(t.id, t.promptVersionNumber);
      }
    }

    const data: ProductionReleaseHistoryItemDto[] = rows.map((r) => ({
      ...this.toEventDto(r),
      promptVersionLabel: this.versionLabel(r.promptVersionNumber),
      modelName: r.modelName,
      inputConnectorName: r.inputConnectorName,
      createdByName: r.createdByName,
      rollbackTargetVersionLabel: r.rollbackTargetEventId
        ? this.versionLabel(rollbackTargetMap.get(r.rollbackTargetEventId) ?? null)
        : null,
    }));
    return { data, total: data.length };
  }

  // -------------------------------------------------------------------------
  // Create a release: inside a transaction, "replace old running + INSERT new event(running)"
  // -------------------------------------------------------------------------
  async create(
    projectId: string,
    input: CreateProductionReleaseInputDto,
    actor: CurrentUserPayload,
  ): Promise<ProductionReleaseEventDto> {
    await this.assertWriteAccess(projectId, actor);

    // Validate associated resources
    const prompt = await this.repo.findPromptForProject(projectId, input.promptId);
    if (!prompt) throw new NotFoundException(`Prompt ${input.promptId} not found in project`);
    const version = await this.repo.findPromptVersionForPrompt(input.promptId, input.promptVersionId);
    if (!version) throw new NotFoundException(`Prompt version ${input.promptVersionId} not found`);
    const model = await this.repo.findModelById(input.modelId);
    if (!model) throw new NotFoundException(`Model ${input.modelId} not found`);
    const inputConnector = await this.repo.findConnectorForProject(projectId, input.inputConnectorId);
    if (!inputConnector) throw new NotFoundException(`Input connector ${input.inputConnectorId} not found in project`);
    if (inputConnector.direction !== 'input')
      throw new BadRequestException(`Connector ${input.inputConnectorId} is not an input connector`);

    if (input.outputConnectorIds.length > 0) {
      const outputs = await this.repo.listConnectorsForProject(projectId, input.outputConnectorIds);
      const found = new Set(outputs.map((c) => c.id));
      for (const id of input.outputConnectorIds) {
        if (!found.has(id)) throw new NotFoundException(`Output connector ${id} not found in project`);
      }
      for (const c of outputs) {
        if (c.direction !== 'output') throw new BadRequestException(`Connector ${c.id} is not an output connector`);
      }
    }

    // Input connector mutual exclusion (the partial unique index is the backstop; this is a friendly pre-check)
    const occupiedByConnector = await this.repo.findRunningByInputConnector(input.inputConnectorId);
    if (occupiedByConnector && occupiedByConnector.promptId !== input.promptId) {
      throw new ConflictException(
        `Input connector ${input.inputConnectorId} is occupied by release ${occupiedByConnector.id}`,
      );
    }
    await this.assertReleaseLineNameAvailable(projectId, input, prompt.name);

    // Source ID consistency
    this.assertSourceConsistency(input);

    if (!version.isFrozen) {
      await this.repo.freezePromptVersionIfNeeded(input.promptVersionId);
    }
    const snapshots = this.buildPromptSnapshots(prompt, version);

    if (!this.releaseLineService) {
      throw new ConflictException('Release line service is unavailable');
    }
    const now = new Date();
    const line = await this.releaseLineService.recordProductionEvent({
      id: randomUUID(),
      projectId,
      promptId: input.promptId,
      eventType: input.eventType,
      promptVersionId: input.promptVersionId,
      promptVersionNumber: version.versionNumber,
      modelId: input.modelId,
      inputConnectorId: input.inputConnectorId,
      outputConnectorIds: input.outputConnectorIds,
      runConfig: input.runConfig,
      variableMapping: input.variableMapping,
      filterRules: input.filterRules ?? null,
      recordMode: input.recordMode,
      externalIdField: input.externalIdField ?? null,
      retentionDays: input.retentionDays ?? null,
      status: 'running',
      createdBy: actor.sub,
      submitReason: input.submitReason,
      sourceExperimentId: input.sourceExperimentId ?? null,
      sourceCanaryId: input.sourceCanaryId ?? null,
      sourceMetricsSnapshot: input.sourceMetricsSnapshot ?? null,
      promptSnapshot: snapshots.promptSnapshot,
      promptVersionSnapshot: snapshots.promptVersionSnapshot,
      rollbackTargetEventId: input.rollbackTargetEventId ?? null,
      startedAt: now,
      finishedAt: null,
      stopReason: null,
      createdAt: now,
      updatedAt: now,
      promptName: prompt.name,
      modelName: model.name,
      modelProvider: model.providerType,
      inputConnectorName: inputConnector.name,
      inputConnectorType: inputConnector.type,
    });
    await this.repo.markPromptVersionProduction(input.promptId, input.promptVersionId, actor.sub);

    const eventId = line.currentProductionEvent?.id;
    if (!eventId) throw new Error('Production release event was not recorded');
    const enriched = await this.repo.findEventById(projectId, eventId);
    if (!enriched) throw new Error('Production release event disappeared after insert');
    return this.toEventDto(enriched);
  }

  // -------------------------------------------------------------------------
  // Force-stop: write a force_stop event + UPDATE the old running event → stopped(force_stopped)
  // -------------------------------------------------------------------------
  async stop(
    projectId: string,
    eventId: string,
    input: StopProductionReleaseInputDto,
    actor: CurrentUserPayload,
  ): Promise<ProductionReleaseEventDto> {
    await this.assertWriteAccess(projectId, actor);

    const current = await this.repo.findEventById(projectId, eventId);
    if (!current) throw new NotFoundException(`Production release event ${eventId} not found`);
    if (current.status !== 'running') {
      throw new BadRequestException(`Release ${eventId} is not running (status=${current.status})`);
    }

    if (!this.releaseLineService) {
      throw new ConflictException('Release line service is unavailable');
    }
    const now = new Date();
    const line = await this.releaseLineService.recordProductionEvent({
      id: randomUUID(),
      projectId,
      promptId: current.promptId,
      eventType: 'force_stop',
      promptVersionId: current.promptVersionId,
      promptVersionNumber: current.promptVersionNumber,
      modelId: current.modelId,
      inputConnectorId: current.inputConnectorId,
      outputConnectorIds: current.outputConnectorIds ?? [],
      runConfig: current.runConfig,
      variableMapping: current.variableMapping,
      filterRules: current.filterRules,
      recordMode: current.recordMode,
      externalIdField: current.externalIdField,
      retentionDays: current.retentionDays,
      status: 'stopped',
      createdBy: actor.sub,
      submitReason: input.reason,
      sourceExperimentId: current.sourceExperimentId,
      sourceCanaryId: current.sourceCanaryId,
      sourceMetricsSnapshot: current.sourceMetricsSnapshot,
      promptSnapshot: current.promptSnapshot,
      promptVersionSnapshot: current.promptVersionSnapshot,
      rollbackTargetEventId: null,
      startedAt: now,
      finishedAt: now,
      stopReason: 'force_stopped',
      createdAt: now,
      updatedAt: now,
      promptName: current.promptName ?? promptNameFromSnapshot(current.promptSnapshot, current.promptId),
      modelName: current.modelName,
      modelProvider: current.modelProvider,
      inputConnectorName: current.inputConnectorName,
      inputConnectorType: current.inputConnectorType,
    });
    await this.repo.clearPromptProductionVersion(current.promptId);

    const forceStopEventId = line.latestEvent?.id;
    if (!forceStopEventId) throw new Error('Production force stop event was not recorded');
    const enriched = await this.repo.findEventById(projectId, forceStopEventId);
    if (!enriched) throw new Error('Production force stop event disappeared after insert');
    return this.toEventDto(enriched);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private async assertReadAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const access = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!access) throw new NotFoundException(`Project ${projectId} not found`);
  }

  private async assertWriteAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'release_manage');
    return this.assertReadAccess(projectId, actor);
  }

  private assertSourceConsistency(input: CreateProductionReleaseInputDto): void {
    if (input.eventType === 'from_experiment' && !input.sourceExperimentId) {
      throw new BadRequestException('from_experiment requires sourceExperimentId');
    }
    if (input.eventType === 'from_canary' && !input.sourceCanaryId) {
      throw new BadRequestException('from_canary requires sourceCanaryId');
    }
    if (input.eventType === 'rollback' && !input.rollbackTargetEventId) {
      throw new BadRequestException('rollback requires rollbackTargetEventId');
    }
    if (input.eventType === 'force_stop') {
      throw new BadRequestException('force_stop should not be created via /production-releases POST');
    }
  }

  private versionLabel(versionNumber: number | null | undefined): string | null {
    if (versionNumber === null || versionNumber === undefined) return null;
    return `v${versionNumber}`;
  }

  private toEventDto(row: ProductionReleaseEventRowWithJoins): ProductionReleaseEventDto {
    return {
      id: row.id,
      projectId: row.projectId,
      promptId: row.promptId,
      eventType: row.eventType as ProductionReleaseEventDto['eventType'],
      promptVersionId: row.promptVersionId,
      modelId: row.modelId,
      inputConnectorId: row.inputConnectorId,
      outputConnectorIds: row.outputConnectorIds ?? [],
      runConfig: row.runConfig as ProductionReleaseEventDto['runConfig'],
      variableMapping: (row.variableMapping ?? {}) as ProductionReleaseEventDto['variableMapping'],
      filterRules: row.filterRules as ProductionReleaseEventDto['filterRules'],
      recordMode: row.recordMode as ProductionReleaseEventDto['recordMode'],
      externalIdField: row.externalIdField,
      retentionDays: row.retentionDays,
      status: row.status as ProductionReleaseEventDto['status'],
      createdBy: row.createdBy,
      submitReason: row.submitReason,
      sourceExperimentId: row.sourceExperimentId,
      sourceCanaryId: row.sourceCanaryId,
      sourceMetricsSnapshot: row.sourceMetricsSnapshot as Record<string, unknown> | null,
      promptSnapshot: (row.promptSnapshot ?? {}) as Record<string, unknown>,
      promptVersionSnapshot: (row.promptVersionSnapshot ?? {}) as Record<string, unknown>,
      rollbackTargetEventId: row.rollbackTargetEventId,
      controlState: row.controlState as ProductionReleaseEventDto['controlState'],
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      stopReason: row.stopReason as ProductionReleaseEventDto['stopReason'],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async assertReleaseLineNameAvailable(
    projectId: string,
    input: CreateProductionReleaseInputDto,
    fallbackName: string,
  ): Promise<void> {
    if (!this.releaseLineService) return;
    await this.releaseLineService.assertNameAvailable(
      projectId,
      releaseNameFromSubmitReason(input.submitReason, fallbackName),
      {
        promptId: input.promptId,
        inputConnectorId: input.inputConnectorId,
      },
    );
  }

  private buildPromptSnapshots(
    prompt: ProductionReleasePromptRow,
    version: ProductionReleasePromptVersionRow,
  ): {
    promptSnapshot: Record<string, unknown>;
    promptVersionSnapshot: Record<string, unknown>;
  } {
    return {
      promptSnapshot: {
        id: prompt.id,
        name: prompt.name,
        defaultDatasetId: prompt.defaultDatasetId,
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
}

function promptNameFromSnapshot(snapshot: unknown, fallback: string): string {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const name = (snapshot as Record<string, unknown>)['name'];
    if (typeof name === 'string' && name.trim()) return name;
  }
  return fallback;
}

function releaseNameFromSubmitReason(submitReason: string, fallback: string) {
  return submitReason.split('\n')[0]?.trim() || fallback.trim();
}
