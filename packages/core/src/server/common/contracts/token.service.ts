// TokenService — adapter extension point (DI token) for user-token CRUD.
// See docs/specs/08-adapter-extension-points.md §3.5.
//
// Handles only `scope='user'` rows; `scope='webhook'` is managed by the connector resource (§3.4).
// Token → ActorContext validation (hash / expiry) lives in LocalUserTokenVerifier, not here.

import type {
  CreateUserTokenDto,
  CreateUserTokenResponseDto,
  DeleteUserTokenResponseDto,
  ListUserTokensResponseDto,
  RevealUserTokenResponseDto,
  UpdateUserTokenDto,
  UpdateUserTokenResponseDto,
} from '@proofhound/shared';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

export type ActionSource = 'api' | 'mcp';

export abstract class TokenService {
  abstract listUserTokens(actor: CurrentUserPayload): Promise<ListUserTokensResponseDto>;
  abstract createUserToken(
    dto: CreateUserTokenDto,
    actor: CurrentUserPayload,
    source?: ActionSource,
  ): Promise<CreateUserTokenResponseDto>;
  abstract updateUserToken(
    tokenId: string,
    dto: UpdateUserTokenDto,
    actor: CurrentUserPayload,
    source?: ActionSource,
  ): Promise<UpdateUserTokenResponseDto>;
  abstract revealUserToken(
    tokenId: string,
    actor: CurrentUserPayload,
    source?: ActionSource,
  ): Promise<RevealUserTokenResponseDto>;
  abstract deleteUserToken(
    tokenId: string,
    actor: CurrentUserPayload,
    source?: ActionSource,
  ): Promise<DeleteUserTokenResponseDto>;
}
