import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorKind } from '../actor-context';

export interface CurrentUserPayload {
  sub: string; // self-hosted local actor id (UUID)
  actorId?: string;
  actorKind?: ActorKind;
  projectId?: string;
  email: string;
  isSuperAdmin: boolean;
  isActive: boolean;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
  const request = ctx.switchToHttp().getRequest<Request & { user: CurrentUserPayload }>();
  return request.user;
});
