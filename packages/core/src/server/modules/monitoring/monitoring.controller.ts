import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  modelMonitoringRankingSortBy,
  projectMonitoringFilterSchema,
  promptMonitoringRankingSortBy,
  type ModelMonitoringRankingResponseDto,
  type ProjectMonitoringFilterDto,
  type PromptMonitoringRankingResponseDto,
} from '@proofhound/shared';
import { z } from 'zod';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { MonitoringService } from './monitoring.service';

@Controller('monitoring')
@UseGuards(HttpActorGuard)
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('stats')
  async getStats(@Query() rawQuery: Record<string, unknown>, @CurrentUser() actor: CurrentUserPayload) {
    return this.monitoring.getStats(resolveProjectContext(actor).projectId, parseFilter(rawQuery), actor);
  }

  @Get('timeseries')
  async getTimeseries(@Query() rawQuery: Record<string, unknown>, @CurrentUser() actor: CurrentUserPayload) {
    return this.monitoring.getTimeseries(resolveProjectContext(actor).projectId, parseFilter(rawQuery), actor);
  }

  @Get('prompts/ranking')
  async getPromptRanking(@Query() rawQuery: Record<string, unknown>, @CurrentUser() actor: CurrentUserPayload) {
    return this.monitoring.getPromptRanking(
      resolveProjectContext(actor).projectId,
      parseFilter(rawQuery),
      parsePromptSortBy(rawQuery),
      actor,
    );
  }

  @Get('models/ranking')
  async getModelRanking(@Query() rawQuery: Record<string, unknown>, @CurrentUser() actor: CurrentUserPayload) {
    return this.monitoring.getModelRanking(
      resolveProjectContext(actor).projectId,
      parseFilter(rawQuery),
      parseModelSortBy(rawQuery),
      actor,
    );
  }
}

function parseFilter(rawQuery: Record<string, unknown>): ProjectMonitoringFilterDto {
  const parse = projectMonitoringFilterSchema.safeParse({
    from: readQueryString(rawQuery, 'from'),
    to: readQueryString(rawQuery, 'to'),
    granularity: readQueryString(rawQuery, 'granularity') ?? 'auto',
    modelIds: readCsvQuery(rawQuery, 'modelIds'),
    promptIds: readCsvQuery(rawQuery, 'promptIds'),
    promptVersionIds: readCsvQuery(rawQuery, 'promptVersionIds'),
    sourceIds: readCsvQuery(rawQuery, 'sourceIds'),
    sources: readCsvQuery(rawQuery, 'sources'),
  });

  if (!parse.success) throw new BadRequestException(parse.error.issues);
  return parse.data;
}

function parsePromptSortBy(rawQuery: Record<string, unknown>): PromptMonitoringRankingResponseDto['sortBy'] {
  const parse = z.enum(promptMonitoringRankingSortBy).default('requests').safeParse(readQueryString(rawQuery, 'sortBy'));
  if (!parse.success) throw new BadRequestException(parse.error.issues);
  return parse.data;
}

function parseModelSortBy(rawQuery: Record<string, unknown>): ModelMonitoringRankingResponseDto['sortBy'] {
  const parse = z.enum(modelMonitoringRankingSortBy).default('requests').safeParse(readQueryString(rawQuery, 'sortBy'));
  if (!parse.success) throw new BadRequestException(parse.error.issues);
  return parse.data;
}

function readQueryString(rawQuery: Record<string, unknown>, key: string): string | undefined {
  const value = rawQuery[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function readCsvQuery(rawQuery: Record<string, unknown>, key: string): string[] | undefined {
  const value = rawQuery[key];
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const parsed = values.flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}
