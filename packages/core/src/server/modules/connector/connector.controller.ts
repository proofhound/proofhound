import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  bulkDeleteConnectorsRequestSchema,
  connectorDeleteQuerySchema,
  connectorIdParamSchema,
  connectorListQuerySchema,
  createConnectorSchema,
  createWebhookTokenSchema,
  peekConnectorRequestSchema,
  updateConnectorSchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { ConnectorService } from './connector.service';

@Controller('connectors')
@UseGuards(HttpActorGuard)
export class ConnectorController {
  constructor(private readonly service: ConnectorService) {}

  @Get()
  async list(
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parseQuery = connectorListQuerySchema.safeParse(rawQuery);
    if (!parseQuery.success) throw new BadRequestException(parseQuery.error.issues);
    return this.service.list(project.projectId, actor, parseQuery.data);
  }

  @Get(':connectorId')
  async detail(
    @Param('connectorId') connectorId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.getDetail(project.projectId, this.parseConnectorId(connectorId), actor);
  }

  @Get(':connectorId/references')
  async references(
    @Param('connectorId') connectorId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.getReferences(project.projectId, this.parseConnectorId(connectorId), actor);
  }

  @Post()
  async create(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createConnectorSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.create(project.projectId, parse.data, actor);
  }

  @Patch(':connectorId')
  async update(
    @Param('connectorId') connectorId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateConnectorSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.update(project.projectId, this.parseConnectorId(connectorId), parse.data, actor);
  }

  @Delete(':connectorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('connectorId') connectorId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = connectorDeleteQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    await this.service.delete(project.projectId, this.parseConnectorId(connectorId), parse.data, actor);
  }

  @Post('bulk-delete')
  async bulkDelete(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = bulkDeleteConnectorsRequestSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.bulkDelete(project.projectId, parse.data, actor);
  }

  @Post(':connectorId/probe')
  async probe(
    @Param('connectorId') connectorId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.probe(project.projectId, this.parseConnectorId(connectorId), actor);
  }

  @Post(':connectorId/peek')
  async peek(
    @Param('connectorId') connectorId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = peekConnectorRequestSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.peek(project.projectId, this.parseConnectorId(connectorId), parse.data, actor);
  }

  // -------------------------------------------------------------------------
  // per-connector webhook tokens
  // See docs/specs/26-connectors.md / docs/specs/06-database-schema.md §3.2
  // -------------------------------------------------------------------------

  @Get(':connectorId/webhook-tokens')
  async listWebhookTokens(
    @Param('connectorId') connectorId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.listWebhookTokens(project.projectId, this.parseConnectorId(connectorId), actor);
  }

  @Post(':connectorId/webhook-tokens')
  async createWebhookToken(
    @Param('connectorId') connectorId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createWebhookTokenSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.createWebhookToken(project.projectId, this.parseConnectorId(connectorId), parse.data, actor);
  }

  @Delete(':connectorId/webhook-tokens/:tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeWebhookToken(
    @Param('connectorId') connectorId: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parsedTokenId = z.string().uuid().safeParse(tokenId);
    if (!parsedTokenId.success) throw new BadRequestException(parsedTokenId.error.issues);
    await this.service.revokeWebhookToken(
      project.projectId,
      this.parseConnectorId(connectorId),
      parsedTokenId.data,
      actor,
    );
  }

  @Get(':connectorId/webhook-tokens/:tokenId/plaintext')
  async revealWebhookToken(
    @Param('connectorId') connectorId: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parsedTokenId = z.string().uuid().safeParse(tokenId);
    if (!parsedTokenId.success) throw new BadRequestException(parsedTokenId.error.issues);
    return this.service.revealWebhookToken(
      project.projectId,
      this.parseConnectorId(connectorId),
      parsedTokenId.data,
      actor,
    );
  }

  private parseConnectorId(connectorId: string): string {
    const parse = connectorIdParamSchema.safeParse(connectorId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
