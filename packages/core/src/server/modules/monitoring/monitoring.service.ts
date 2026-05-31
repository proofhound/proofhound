import { BadRequestException, Injectable } from '@nestjs/common';
import {
  projectMonitoringFilterSchema,
  type ModelMonitoringRankingResponseDto,
  type ProjectMonitoringFilterDto,
  type ProjectMonitoringStatsDto,
  type ProjectMonitoringTimeseriesDto,
  type PromptMonitoringRankingResponseDto,
} from '@proofhound/shared';
import { z } from 'zod';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { MonitoringRepository } from './monitoring.repository';

@Injectable()
export class MonitoringService {
  constructor(
    private readonly repo: MonitoringRepository,
    private readonly accessControl: AccessControlService,
  ) {}

  async getStats(
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    actor: CurrentUserPayload,
  ): Promise<ProjectMonitoringStatsDto> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const normalized = this.normalizeFilter(filter);
    return this.repo.getStats(projectId, normalized);
  }

  async getTimeseries(
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    actor: CurrentUserPayload,
  ): Promise<ProjectMonitoringTimeseriesDto> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const normalized = this.normalizeFilter(filter);
    return this.repo.getTimeseries(projectId, normalized);
  }

  async getPromptRanking(
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    sortBy: PromptMonitoringRankingResponseDto['sortBy'],
    actor: CurrentUserPayload,
  ): Promise<PromptMonitoringRankingResponseDto> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const normalized = this.normalizeFilter(filter);
    return this.repo.getPromptRanking(projectId, normalized, sortBy);
  }

  async getModelRanking(
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    sortBy: ModelMonitoringRankingResponseDto['sortBy'],
    actor: CurrentUserPayload,
  ): Promise<ModelMonitoringRankingResponseDto> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const normalized = this.normalizeFilter(filter);
    return this.repo.getModelRanking(projectId, normalized, sortBy);
  }

  private normalizeFilter(filter: ProjectMonitoringFilterDto): ProjectMonitoringFilterDto {
    try {
      const normalized = projectMonitoringFilterSchema.parse(filter);
      const from = new Date(normalized.from);
      const to = new Date(normalized.to);
      if (to.getTime() <= from.getTime()) {
        throw new BadRequestException('monitoring_time_range_invalid');
      }
      return normalized;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof z.ZodError) {
        throw new BadRequestException(error.issues);
      }
      throw error;
    }
  }
}
