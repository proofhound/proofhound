import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { createUserTokenSchema, tokenIdParamSchema, updateUserTokenSchema } from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { TokenService } from './token.service';

@Controller('tokens')
@UseGuards(HttpActorGuard)
export class TokenController {
  constructor(private readonly service: TokenService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.listUserTokens(actor);
  }

  @Post()
  async create(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = createUserTokenSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.createUserToken(parse.data, actor);
  }

  @Patch(':tokenId')
  async update(@Param('tokenId') tokenId: string, @Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = updateUserTokenSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateUserToken(this.parseTokenId(tokenId), parse.data, actor);
  }

  @Get(':tokenId/plaintext')
  async reveal(@Param('tokenId') tokenId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.revealUserToken(this.parseTokenId(tokenId), actor);
  }

  @Delete(':tokenId')
  async delete(@Param('tokenId') tokenId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.deleteUserToken(this.parseTokenId(tokenId), actor);
  }

  private parseTokenId(tokenId: string): string {
    const parse = tokenIdParamSchema.safeParse(tokenId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
