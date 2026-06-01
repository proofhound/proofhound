import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  ReleaseLineDto,
  ReleaseLineEventDto,
  ReleaseLineEventOperationDto,
  ReleaseLineEventStatusDto,
  ReleaseLineEventTerminalReasonDto,
  UpdateReleaseLineRunConfigInputDto,
  UpdateReleaseLineTrafficRatioInputDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { isUniqueViolation } from '../../common/errors/db-error';
import {
  ReleaseLineRepository,
  type ReleaseLineIdentity,
  type ReleaseLineMirrorSnapshot,
} from './release-line.repository';

@Injectable()
export class ReleaseLineService {
  private readonly logger = createLogger('release-line.service', { service: 'server' });

  constructor(
    private readonly repo: ReleaseLineRepository,
    private readonly accessControl: AccessControlService,
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
    return updated;
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
      { releaseLineId, laneType: input.laneType, modelId: input.modelId ?? null, runConfig: input.runConfig },
      'release_line_run_config_updated',
    );
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

  private async recordOrThrowNameConflict(snapshot: ReleaseLineMirrorSnapshot): Promise<ReleaseLineDto> {
    await this.assertNameAvailable(snapshot.projectId, snapshot.lineName, {
      promptId: snapshot.promptId,
      inputConnectorId: snapshot.inputConnectorId,
    });

    try {
      return await this.repo.record({
        ...snapshot,
        lineName: normalizeReleaseLineName(snapshot.lineName),
      });
    } catch (error) {
      if (isReleaseLineNameUniqueViolation(error)) {
        throw new ConflictException('release_name_taken');
      }
      throw error;
    }
  }
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
  recordMode: 'all' | 'correct_only';
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
  recordMode: 'all' | 'correct_only';
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
