import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  ArchiveReleaseLineInputDto,
  DeleteReleaseLineInputDto,
  ReleaseLineDeletionImpactDto,
  ReleaseLineDto,
  ReleaseLineEventDto,
  ReleaseLineEventOperationDto,
  ReleaseLineEventStatusDto,
  ReleaseLineEventTerminalReasonDto,
  RestoreReleaseLineHistoryInputDto,
  StartReleaseLineInputDto,
  StopReleaseLineInputDto,
  UnarchiveReleaseLineInputDto,
  UpdateReleaseLineInputRouteInputDto,
  UpdateReleaseLineOutputRouteInputDto,
  UpdateReleaseLineRetentionInputDto,
  UpdateReleaseLineRunConfigInputDto,
  UpdateReleaseLineTrafficRatioInputDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { ObjectStorageProvider } from '../../common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { isUniqueViolation } from '../../common/errors/db-error';
import { UsageMeteringHook, safeRecordUsageEvent } from '../../common/contracts/usage-metering.hook';
import {
  ReleaseLineRepository,
  type ReleaseLineIdentity,
  type ReleaseLineMirrorSnapshot,
} from './release-line.repository';
import { ReleaseLineDeletionHook } from './release-line-deletion.hook';
import { assertReleasePromptVariableMapping } from './release-variable-mapping';

@Injectable()
export class ReleaseLineService {
  private readonly logger = createLogger('release-line.service', { service: 'server' });

  constructor(
    @Inject(ReleaseLineRepository)
    private readonly repo: ReleaseLineRepository,
    @Inject(AccessControlService)
    private readonly accessControl: AccessControlService,
    @Inject(ReleaseLineDeletionHook)
    private readonly deletionHook: ReleaseLineDeletionHook,
    @Inject(UsageMeteringHook)
    @Optional()
    private readonly usageMetering?: UsageMeteringHook,
    @Optional() private readonly objectStorage?: ObjectStorageProvider,
  ) {}

  async list(projectId: string, actor: CurrentUserPayload): Promise<{ data: ReleaseLineDto[]; total: number }> {
    await this.assertReadAccess(projectId, actor);
    const data = await this.repo.list(projectId);
    return { data, total: data.length };
  }

  async get(projectId: string, releaseLineId: string, actor: CurrentUserPayload): Promise<ReleaseLineDto> {
    await this.assertReadAccess(projectId, actor);
    const line = await this.repo.findById(projectId, releaseLineId);
    if (!line) throw new NotFoundException(`Release line ${releaseLineId} not found`);
    return line;
  }

  async listEvents(
    projectId: string,
    releaseLineId: string,
    actor: CurrentUserPayload,
  ): Promise<{ data: ReleaseLineEventDto[]; total: number }> {
    await this.assertReadAccess(projectId, actor);
    const line = await this.repo.findById(projectId, releaseLineId);
    if (!line) throw new NotFoundException(`Release line ${releaseLineId} not found`);
    const data = await this.repo.listEvents(projectId, releaseLineId);
    return { data, total: data.length };
  }

  async updateTrafficRatio(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineTrafficRatioInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    const updated = await this.repo.updateActiveCanaryTrafficRatio(
      projectId,
      releaseLineId,
      input.trafficRatio,
      actor.sub,
    );
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no adjustable canary lane`);
    this.logger.info({ releaseLineId, trafficRatio: input.trafficRatio }, 'release_line_traffic_ratio_updated');
    await this.recordLineMutationEvents(updated, actor.sub, 'traffic_ratio_updated');
    return updated;
  }

  async promoteCanary(projectId: string, releaseLineId: string, actor: CurrentUserPayload): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    const updated = await this.repo.promoteActiveCanary(projectId, releaseLineId, actor.sub);
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no promotable canary lane`);
    this.logger.info({ releaseLineId }, 'release_line_canary_promoted');
    await this.recordLineMutationEvents(updated, actor.sub, 'canary_promoted');
    return updated;
  }

  async stopLine(
    projectId: string,
    releaseLineId: string,
    input: StopReleaseLineInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    const updated = await this.repo.stopLine(projectId, releaseLineId, input.reason, actor.sub);
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no running lane to stop`);
    this.logger.info({ releaseLineId }, 'release_line_stopped');
    await this.recordLineMutationEvents(updated, actor.sub, 'line_stopped');
    return updated;
  }

  async startLine(
    projectId: string,
    releaseLineId: string,
    input: StartReleaseLineInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    try {
      const updated = await this.repo.startLine(projectId, releaseLineId, input.reason, actor.sub);
      if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no stopped lane to start`);
      this.logger.info({ releaseLineId }, 'release_line_started');
      await this.recordLineMutationEvents(updated, actor.sub, 'line_started');
      return updated;
    } catch (error) {
      if (isUniqueViolation(error, /uniq_running_production_event_per_(prompt|line)|uniq_active_canary_event_per_line/)) {
        throw new ConflictException('release_line_start_conflict');
      }
      throw error;
    }
  }

  async archiveLine(
    projectId: string,
    releaseLineId: string,
    input: ArchiveReleaseLineInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    const updated = await this.repo.archiveLine(projectId, releaseLineId, input.reason, actor.sub);
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} must be stopped before archive`);
    this.logger.info({ releaseLineId }, 'release_line_archived');
    await this.recordLineMutationEvents(updated, actor.sub, 'line_archived');
    return updated;
  }

  async unarchiveLine(
    projectId: string,
    releaseLineId: string,
    input: UnarchiveReleaseLineInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    try {
      const updated = await this.repo.unarchiveLine(projectId, releaseLineId, input.reason, actor.sub);
      if (!updated) throw new BadRequestException(`Release line ${releaseLineId} is not archived`);
      this.logger.info({ releaseLineId }, 'release_line_unarchived');
      await this.recordLineMutationEvents(updated, actor.sub, 'line_unarchived');
      return updated;
    } catch (error) {
      if (isUniqueViolation(error, /uniq_active_release_line_per_input_connector/)) {
        throw new ConflictException('release_line_unarchive_conflict');
      }
      throw error;
    }
  }

  async restoreHistoryToProduction(
    projectId: string,
    releaseLineId: string,
    input: RestoreReleaseLineHistoryInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    try {
      const updated = await this.repo.restoreHistoryToLane(
        projectId,
        releaseLineId,
        input.sourceEventId,
        'production',
        input.reason,
        actor.sub,
      );
      if (!updated) throw new BadRequestException(`Release line ${releaseLineId} cannot restore that history event`);
      this.logger.info(
        { releaseLineId, sourceEventId: input.sourceEventId },
        'release_line_history_restored_production',
      );
      await this.recordLineMutationEvents(updated, actor.sub, 'history_restored_to_production');
      return updated;
    } catch (error) {
      if (
        isUniqueViolation(error, /uniq_running_production_event_per_(prompt|line)|uniq_active_canary_event_per_line/)
      ) {
        throw new ConflictException('release_line_restore_conflict');
      }
      throw error;
    }
  }

  async restoreHistoryToCanary(
    projectId: string,
    releaseLineId: string,
    input: RestoreReleaseLineHistoryInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    try {
      const updated = await this.repo.restoreHistoryToLane(
        projectId,
        releaseLineId,
        input.sourceEventId,
        'canary',
        input.reason,
        actor.sub,
      );
      if (!updated) throw new BadRequestException(`Release line ${releaseLineId} cannot restore that history event`);
      this.logger.info({ releaseLineId, sourceEventId: input.sourceEventId }, 'release_line_history_restored_canary');
      await this.recordLineMutationEvents(updated, actor.sub, 'history_restored_to_canary');
      return updated;
    } catch (error) {
      if (
        isUniqueViolation(error, /uniq_running_production_event_per_(prompt|line)|uniq_active_canary_event_per_line/)
      ) {
        throw new ConflictException('release_line_restore_conflict');
      }
      throw error;
    }
  }

  async getDeletionImpact(
    projectId: string,
    releaseLineId: string,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDeletionImpactDto> {
    await this.assertReadAccess(projectId, actor);
    const impact = await this.deletionHook.prepareReleaseLineDeletion({ projectId, releaseLineId });
    if (!impact) throw new NotFoundException(`Release line ${releaseLineId} not found`);
    return impact;
  }

  async deleteLine(
    projectId: string,
    releaseLineId: string,
    input: DeleteReleaseLineInputDto,
    actor: CurrentUserPayload,
  ): Promise<void> {
    await this.assertWriteAccess(projectId, actor);
    const line = await this.repo.findById(projectId, releaseLineId);
    if (!line) throw new NotFoundException(`Release line ${releaseLineId} not found`);
    if (input.confirmationName !== line.name) throw new BadRequestException('release_line_delete_confirmation_mismatch');
    await this.deletionHook.prepareReleaseLineDeletion({ projectId, releaseLineId });
    // Force-stop any running lane first (its own transaction) so the runner stops dispatching before we
    // physically delete the line — a best-effort barrier against in-flight jobs racing the cascade.
    await this.repo.forceStopRunningLanesForDelete(projectId, releaseLineId);
    const result = await this.repo.hardDeleteLine(projectId, releaseLineId);
    if (result.deleted === 0) throw new NotFoundException(`Release line ${releaseLineId} not found`);
    await this.cleanupPayloadRefs(result.payloadRefs, { projectId, releaseLineId, operation: 'release_line.delete' });
    this.logger.info({ releaseLineId, reason: input.reason ?? null }, 'release_line_deleted');
    if (this.usageMetering) {
      await safeRecordUsageEvent(this.usageMetering, {
        idempotencyKey: `release_line:${releaseLineId}:deleted`,
        dimension: 'release',
        eventType: 'release_line.deleted',
        projectId,
        actorId: actor.sub,
        occurredAt: new Date(),
        source: 'server',
        payload: { releaseLineId, reason: input.reason ?? null },
      });
    }
  }

  async updateRunConfig(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineRunConfigInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    const updated = await this.repo.updateActiveLaneRunConfig(projectId, releaseLineId, input, actor.sub);
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no editable ${input.laneType} lane`);
    this.logger.info(
      {
        releaseLineId,
        laneType: input.laneType,
        modelId: input.modelId ?? null,
        runConfig: input.runConfig,
        recordMode: input.recordMode ?? null,
        recordCategories: input.recordCategories ?? null,
      },
      'release_line_run_config_updated',
    );
    await this.recordLineMutationEvents(updated, actor.sub, 'run_config_updated');
    return updated;
  }

  async updateOutputRoute(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineOutputRouteInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    await this.assertOutputConnectors(projectId, input.outputConnectorIds);
    this.assertOutputMappingConnectors(input.outputConnectorIds, input.outputMapping);
    const updated = await this.repo.updateActiveLaneOutputRoute(projectId, releaseLineId, input, actor.sub);
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no editable ${input.laneType} lane`);
    this.logger.info(
      {
        releaseLineId,
        laneType: input.laneType,
        outputConnectorIds: input.outputConnectorIds,
        outputMapping: input.outputMapping,
      },
      'release_line_output_route_updated',
    );
    await this.recordLineMutationEvents(updated, actor.sub, 'output_route_updated');
    return updated;
  }

  async updateInputRoute(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineInputRouteInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    const line = await this.repo.findById(projectId, releaseLineId);
    const lane = input.laneType === 'production' ? line?.currentProductionEvent : line?.activeCanaryEvent;
    if (lane && (lane.status === 'running' || lane.status === 'stopped')) {
      assertReleasePromptVariableMapping({
        variableMapping: input.variableMapping,
        promptVersionSnapshot: lane.promptVersionSnapshot,
        externalIdField: input.externalIdField,
      });
    }
    const updated = await this.repo.updateActiveLaneInputRoute(projectId, releaseLineId, input, actor.sub);
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no editable ${input.laneType} lane`);
    this.logger.info(
      {
        releaseLineId,
        laneType: input.laneType,
        externalIdField: input.externalIdField,
        variableMapping: input.variableMapping,
        filterRules: input.filterRules,
      },
      'release_line_input_route_updated',
    );
    await this.recordLineMutationEvents(updated, actor.sub, 'input_route_updated');
    return updated;
  }

  async updateRetention(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineRetentionInputDto,
    actor: CurrentUserPayload,
  ): Promise<ReleaseLineDto> {
    await this.assertWriteAccess(projectId, actor);
    const updated = await this.repo.updateCurrentProductionRetention(projectId, releaseLineId, input.retentionDays);
    if (!updated) throw new BadRequestException(`Release line ${releaseLineId} has no editable production lane`);
    this.logger.info({ releaseLineId, retentionDays: input.retentionDays }, 'release_line_retention_updated');
    return updated;
  }

  async assertNameAvailable(projectId: string, name: string, identity: ReleaseLineIdentity = {}): Promise<void> {
    const releaseName = normalizeReleaseLineName(name);
    if (!releaseName) throw new BadRequestException('release_name_required');

    const existingIdentity = await this.repo.findByIdentity(projectId, identity);
    if (existingIdentity) return;

    const owner = await this.repo.findByName(projectId, releaseName);
    if (owner) throw new ConflictException('release_name_taken');
  }

  async recordProductionEvent(input: LegacyProductionEventMirrorInput): Promise<ReleaseLineDto> {
    return this.recordProductionEventInternal(input, false);
  }

  async recordLegacyProductionEvent(input: LegacyProductionEventMirrorInput): Promise<ReleaseLineDto> {
    return this.recordProductionEventInternal(input, true);
  }

  private async recordProductionEventInternal(
    input: LegacyProductionEventMirrorInput,
    useLegacyIdentity: boolean,
  ): Promise<ReleaseLineDto> {
    return this.recordOrThrowNameConflict({
      projectId: input.projectId,
      lineName: releaseNameFromSubmitReason(input.submitReason, input.promptName),
      lineDescription: releaseDescriptionFromSubmitReason(input.submitReason),
      promptId: input.promptId,
      promptName: input.promptName,
      promptSnapshot: input.promptSnapshot,
      promptVersionId: input.promptVersionId,
      promptVersionNumber: input.promptVersionNumber,
      promptVersionSnapshot: input.promptVersionSnapshot,
      modelId: input.modelId,
      modelName: input.modelName,
      modelProvider: input.modelProvider,
      inputConnectorId: input.inputConnectorId,
      inputConnectorName: input.inputConnectorName,
      inputConnectorType: input.inputConnectorType,
      outputConnectorIds: input.outputConnectorIds,
      laneType: 'production',
      operation: productionOperationFromLegacy(input.eventType),
      status: releaseStatusFromLegacyProduction(input.status),
      terminalReason: input.stopReason,
      sourceEventId: input.sourceCanaryId,
      rollbackTargetEventId: input.rollbackTargetEventId,
      runConfig: input.runConfig,
      variableMapping: input.variableMapping,
      outputMapping: [],
      filterRules: input.filterRules,
      recordMode: input.recordMode,
      recordCategories: input.recordCategories,
      externalIdField: input.externalIdField,
      retentionDays: input.retentionDays,
      sourceExperimentId: input.sourceExperimentId,
      submitReason: input.submitReason,
      metrics: input.sourceMetricsSnapshot,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      legacySource: useLegacyIdentity ? 'production_release_event' : null,
      legacySourceId: useLegacyIdentity ? input.id : null,
    });
  }

  async recordCanaryEvent(
    input: LegacyCanaryEventMirrorInput,
    operation: ReleaseLineEventOperationDto,
    status?: ReleaseLineEventStatusDto,
    terminalReason?: ReleaseLineEventTerminalReasonDto | null,
  ): Promise<ReleaseLineDto> {
    return this.recordCanaryEventInternal(input, operation, status, terminalReason, false);
  }

  async recordLegacyCanaryEvent(
    input: LegacyCanaryEventMirrorInput,
    operation: ReleaseLineEventOperationDto,
    status?: ReleaseLineEventStatusDto,
    terminalReason?: ReleaseLineEventTerminalReasonDto | null,
  ): Promise<ReleaseLineDto> {
    return this.recordCanaryEventInternal(input, operation, status, terminalReason, true);
  }

  private async recordCanaryEventInternal(
    input: LegacyCanaryEventMirrorInput,
    operation: ReleaseLineEventOperationDto,
    status: ReleaseLineEventStatusDto | undefined,
    terminalReason: ReleaseLineEventTerminalReasonDto | null | undefined,
    useLegacyIdentity: boolean,
  ): Promise<ReleaseLineDto> {
    return this.recordOrThrowNameConflict({
      projectId: input.projectId,
      lineName: firstNonBlank(input.name, input.promptName, `release-${input.inputConnectorId.slice(0, 8)}`),
      lineDescription: input.description,
      promptId: input.promptId,
      promptName: input.promptName || input.name || input.promptId || 'unknown prompt',
      promptSnapshot: input.promptSnapshot ?? {
        id: input.promptId,
        name: input.promptName,
      },
      promptVersionId: input.promptVersionId,
      promptVersionNumber: versionNumberFromLabel(input.promptVersionLabel),
      promptVersionSnapshot: input.promptVersionSnapshot ?? {
        id: input.promptVersionId,
        promptId: input.promptId,
        versionNumber: versionNumberFromLabel(input.promptVersionLabel),
      },
      modelId: input.modelId,
      modelName: input.modelName,
      modelProvider: input.modelProvider,
      inputConnectorId: input.inputConnectorId,
      inputConnectorName: input.inputConnectorName,
      inputConnectorType: input.inputConnectorType,
      outputConnectorIds: input.outputConnectorIds,
      laneType: 'canary',
      operation,
      status: status ?? releaseStatusFromLegacyCanary(input.status),
      terminalReason: terminalReason ?? terminalReasonFromCanaryStatus(input.status),
      trafficMode: input.trafficMode,
      trafficRatio: input.trafficRatio,
      runConfig: input.runConfig,
      variableMapping: input.variableMapping,
      outputMapping: input.outputMapping,
      filterRules: input.filterRules,
      recordMode: input.recordMode,
      recordCategories: input.recordCategories,
      externalIdField: input.externalIdField,
      submitReason: input.description ?? input.name ?? '',
      metrics: input.metrics,
      totalReceived: input.totalReceived,
      totalProcessed: input.totalProcessed,
      totalFiltered: input.totalFiltered,
      totalCorrect: input.totalCorrect,
      totalErrors: input.totalErrors,
      controlState: input.controlState,
      controlStatePayload: input.controlStatePayload,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      legacySource: useLegacyIdentity && operation === 'create_canary' ? 'canary_release' : null,
      legacySourceId: useLegacyIdentity && operation === 'create_canary' ? input.id : null,
    });
  }

  private async assertReadAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const access = await this.repo.findProjectAccess(projectId);
    if (!access) throw new NotFoundException(`Project ${projectId} not found`);
  }

  private async assertWriteAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'release_manage');
    await this.assertReadAccess(projectId, actor);
  }

  private async assertOutputConnectors(projectId: string, outputConnectorIds: string[]): Promise<void> {
    if (outputConnectorIds.length === 0) return;
    const connectors = await this.repo.listConnectorsForProject(projectId, outputConnectorIds);
    const found = new Set(connectors.map((connector) => connector.id));
    for (const id of outputConnectorIds) {
      if (!found.has(id)) throw new NotFoundException(`Output connector ${id} not found in project`);
    }
    for (const connector of connectors) {
      if (connector.direction !== 'output') {
        throw new BadRequestException(`Connector ${connector.id} is not an output connector`);
      }
    }
  }

  private assertOutputMappingConnectors(outputConnectorIds: string[], outputMapping: unknown): void {
    if (!Array.isArray(outputMapping)) return;
    const selected = new Set(outputConnectorIds);
    for (const item of outputMapping) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const connectorId = (item as Record<string, unknown>)['connectorId'];
      if (typeof connectorId === 'string' && !selected.has(connectorId)) {
        throw new BadRequestException(`Output mapping connector ${connectorId} is not selected`);
      }
    }
  }

  private async recordOrThrowNameConflict(snapshot: ReleaseLineMirrorSnapshot): Promise<ReleaseLineDto> {
    if (snapshot.status === 'running' || snapshot.status === 'completed') {
      assertReleasePromptVariableMapping({
        variableMapping: snapshot.variableMapping,
        promptVersionSnapshot: snapshot.promptVersionSnapshot,
        externalIdField: snapshot.externalIdField,
      });
    }

    await this.assertNameAvailable(snapshot.projectId, snapshot.lineName, {
      promptId: snapshot.promptId,
      inputConnectorId: snapshot.inputConnectorId,
    });

    try {
      const line = await this.repo.record({
        ...snapshot,
        lineName: normalizeReleaseLineName(snapshot.lineName),
      });
      await this.recordLineMutationEvents(line, snapshot.createdBy, 'mirror_recorded');
      return line;
    } catch (error) {
      if (isReleaseLineNameUniqueViolation(error)) {
        throw new ConflictException('release_name_taken');
      }
      if (isReleaseVersionNumberUniqueViolation(error)) {
        throw new ConflictException('release_version_conflict');
      }
      throw error;
    }
  }

  private async recordLineMutationEvents(
    line: ReleaseLineDto,
    actorId: string | null | undefined,
    reason: string,
  ): Promise<void> {
    if (!this.usageMetering) return;

    const latestEvent = line.latestEvent ?? line.activeCanaryEvent ?? line.currentProductionEvent ?? null;
    const eventPayload = {
      releaseLineId: line.id,
      releaseLineName: line.name,
      status: line.status,
      reason,
      latestEventId: latestEvent?.id ?? null,
      latestEventLaneType: latestEvent?.laneType ?? null,
      latestEventOperation: latestEvent?.operation ?? null,
      latestEventStatus: latestEvent?.status ?? null,
      currentProductionEventId: line.currentProductionEventId,
      activeCanaryEventId: line.activeCanaryEventId,
      updatedAt: line.updatedAt,
    };

    if (isSameInstant(line.createdAt, line.updatedAt)) {
      await safeRecordUsageEvent(
        this.usageMetering,
        {
          idempotencyKey: `release_line:${line.id}:created`,
          dimension: 'release',
          eventType: 'release_line.created',
          projectId: line.projectId,
          actorId: actorId ?? undefined,
          occurredAt: new Date(line.createdAt),
          source: 'server',
          payload: eventPayload,
        },
        this.logger,
      );
    }

    await safeRecordUsageEvent(
      this.usageMetering,
      {
        idempotencyKey: `release_line:${line.id}:status_changed:${line.status}:${line.updatedAt}`,
        dimension: 'release',
        eventType: 'release_line.status_changed',
        projectId: line.projectId,
        actorId: actorId ?? undefined,
        occurredAt: new Date(line.updatedAt),
        source: 'server',
        payload: eventPayload,
      },
      this.logger,
    );

    if (!latestEvent) return;
    await safeRecordUsageEvent(
      this.usageMetering,
      {
        idempotencyKey: `release_event:${latestEvent.id}:created`,
        dimension: 'release',
        eventType: 'release_event.created',
        projectId: line.projectId,
        actorId: actorId ?? undefined,
        occurredAt: new Date(latestEvent.createdAt),
        source: 'server',
        payload: {
          ...eventPayload,
          releaseLineEventId: latestEvent.id,
          laneType: latestEvent.laneType,
          operation: latestEvent.operation,
          eventStatus: latestEvent.status,
          terminalReason: latestEvent.terminalReason,
          sourceEventId: latestEvent.sourceEventId,
          supersedesEventId: latestEvent.supersedesEventId,
          rollbackTargetEventId: latestEvent.rollbackTargetEventId,
          promptVersionId: latestEvent.promptVersionId,
          modelId: latestEvent.modelId,
          inputConnectorId: latestEvent.inputConnectorId,
          outputConnectorIds: latestEvent.outputConnectorIds,
        },
      },
      this.logger,
    );
  }

  private async cleanupPayloadRefs(refs: StoredObjectRef[], context: Record<string, unknown>): Promise<void> {
    if (refs.length === 0 || !this.objectStorage?.isEnabled()) return;
    try {
      await this.objectStorage.deleteObjects(refs);
    } catch (err) {
      this.logger.warn({ ...context, refs: refs.length, err }, 'object_storage_payload_cleanup_failed');
    }
  }
}

function isSameInstant(left: string, right: string): boolean {
  return new Date(left).getTime() === new Date(right).getTime();
}

export interface LegacyProductionEventMirrorInput {
  id: string;
  projectId: string;
  promptId: string;
  eventType: string;
  promptVersionId: string;
  promptVersionNumber: number | null;
  modelId: string;
  inputConnectorId: string | null;
  outputConnectorIds: string[];
  runConfig: unknown;
  variableMapping: unknown;
  filterRules: unknown | null;
  recordMode: ReleaseLineMirrorSnapshot['recordMode'];
  recordCategories: string[];
  externalIdField: string | null;
  retentionDays: number | null;
  status: string;
  createdBy: string;
  submitReason: string;
  sourceExperimentId: string | null;
  sourceCanaryId: string | null;
  sourceMetricsSnapshot: Record<string, unknown> | null;
  promptSnapshot: Record<string, unknown>;
  promptVersionSnapshot: Record<string, unknown>;
  rollbackTargetEventId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  stopReason: ReleaseLineEventTerminalReasonDto | null;
  createdAt: Date;
  updatedAt: Date;
  promptName: string;
  modelName: string | null;
  modelProvider: string | null;
  inputConnectorName: string | null;
  inputConnectorType: string | null;
}

export interface LegacyCanaryEventMirrorInput {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  promptVersionId: string;
  modelId: string;
  inputConnectorId: string;
  outputConnectorIds: string[];
  status: string;
  controlState: string | null;
  controlStatePayload: Record<string, unknown> | null;
  trafficRatio: number;
  trafficMode: 'split' | 'dual_run';
  runConfig: unknown;
  variableMapping: unknown;
  outputMapping: unknown;
  filterRules: unknown | null;
  recordMode: ReleaseLineMirrorSnapshot['recordMode'];
  recordCategories: string[];
  externalIdField: string;
  metrics: Record<string, unknown> | null;
  totalReceived: number;
  totalProcessed: number;
  totalFiltered: number;
  totalCorrect: number;
  totalErrors: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  promptId: string | null;
  promptName: string | null;
  promptVersionLabel: string | null;
  promptSnapshot?: Record<string, unknown>;
  promptVersionSnapshot?: Record<string, unknown>;
  modelName: string | null;
  modelProvider: string | null;
  inputConnectorName: string | null;
  inputConnectorType: string | null;
}

function releaseNameFromSubmitReason(submitReason: string, fallback: string) {
  return firstNonBlank(submitReason.split('\n')[0], fallback);
}

function releaseDescriptionFromSubmitReason(submitReason: string) {
  const [, ...rest] = submitReason.split('\n');
  const description = rest.join('\n').trim();
  return description || null;
}

function productionOperationFromLegacy(eventType: string): ReleaseLineEventOperationDto {
  if (eventType === 'from_experiment') return 'create_production_from_experiment';
  if (eventType === 'from_canary') return 'promote_canary';
  if (eventType === 'config_change') return 'config_changed';
  if (eventType === 'rollback') return 'rollback';
  if (eventType === 'force_stop') return 'force_stop';
  return 'create_production';
}

function releaseStatusFromLegacyProduction(status: string): ReleaseLineEventStatusDto {
  if (status === 'success') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'stopped') return 'stopped';
  return 'running';
}

function releaseStatusFromLegacyCanary(status: string): ReleaseLineEventStatusDto {
  if (status === 'stopped') return 'stopped';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'running';
}

function terminalReasonFromCanaryStatus(status: string): ReleaseLineEventTerminalReasonDto | null {
  if (status === 'completed') return 'promoted';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'error';
  return null;
}

function versionNumberFromLabel(label: string | null): number | null {
  if (!label) return null;
  const parsed = Number(label.replace(/^v/, ''));
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeReleaseLineName(value: string) {
  return value.trim();
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeReleaseLineName(value ?? '');
    if (normalized) return normalized;
  }
  return '';
}

function isReleaseLineNameUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, /uniq_release_lines_project_name/);
}

function isReleaseVersionNumberUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(
    error,
    /uniq_release_versions_line_production_number|uniq_release_versions_line_candidate_number/,
  );
}
