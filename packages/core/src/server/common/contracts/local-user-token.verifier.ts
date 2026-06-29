// LocalUserTokenVerifier
// Shared bottom layer: sha256 hash → look up `ph_core.tokens where scope='user'` → expiry / IP check → async touch last_used_at.
//
// Design trade-off: this is an infra-layer helper, not a resolver.
// LocalActorContextResolver (HTTP) and LocalMcpAuthResolver (MCP) each hold their own verifier instance;
// the two resolvers do not reference each other (SPEC §8 red line).
//
// IP whitelist boundary: the verifier exposes a `verify(token, { clientIp? })` interface;
// IP validation only takes effect when the caller provides clientIp.
// - The HTTP resolver parses it from req.ip / socket.remoteAddress and passes it in;
// - MCP / direct `resolveFromUserToken(token)` paths do not pass it, meaning IP validation is skipped.
//   This matches SPEC §3.2 "ip_whitelist is checked in resolveFromHttp; resolveFromUserToken does not check it".
//
// Last-used touch: fire-and-forget; errors are swallowed with a warning and never block the response.
//
// See docs/specs/08-adapter-extension-points.md §3.2 / §3.3 / §3.5

import { createHash } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createLogger } from '@proofhound/logger';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import type { ActorContext, ActorKind } from '../actor-context';

const { tokens } = schema;

export interface VerifyUserTokenOptions {
  /**
   * Client IP of the current request (provided only on the HTTP path).
   * When provided and the token has an ip_whitelist that does not match, throws `ip_not_allowed`.
   * When not provided, IP validation is skipped (resolveFromUserToken / MCP paths).
   */
  clientIp?: string;
  /**
   * Channel that the caller is verifying for. The verifier itself does not have
   * channel semantics — the resolver decides whether this token verification
   * produces a 'script' (HTTP API) or 'system_mcp' (MCP channel) actor.
   * Must be one of the channels that consume the user-token pool.
   */
  actorKind: Extract<ActorKind, 'script' | 'system_mcp'>;
}

interface UserTokenRowMinimal {
  id: string;
  ipWhitelist: unknown;
  expiresAt: Date | null;
}

@Injectable()
export class LocalUserTokenVerifier {
  private readonly logger = createLogger('auth.user-token-verifier', { service: 'api' });

  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async verify(token: string, options: VerifyUserTokenOptions): Promise<ActorContext> {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('invalid_user_token');
    }
    const tokenHash = this.hashToken(token);
    const rows = await this.db
      .select({
        id: tokens.id,
        ipWhitelist: tokens.ipWhitelist,
        expiresAt: tokens.expiresAt,
      })
      .from(tokens)
      .where(and(eq(tokens.tokenHash, tokenHash), eq(tokens.scope, 'user'), isNull(tokens.revokedAt)))
      .limit(1);

    const row: UserTokenRowMinimal | undefined = rows[0];
    if (!row) throw new UnauthorizedException('invalid_user_token');

    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('expired_user_token');
    }

    if (options.clientIp && Array.isArray(row.ipWhitelist) && row.ipWhitelist.length > 0) {
      const allow = (row.ipWhitelist as string[]).includes(options.clientIp);
      if (!allow) throw new UnauthorizedException('ip_not_allowed');
    }

    // Fire-and-forget touch last_used_at
    this.touchLastUsed(row.id);

    return {
      actorId: row.id,
      actorKind: options.actorKind,
    };
  }

  private hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  private touchLastUsed(tokenId: string): void {
    this.db
      .update(tokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(tokens.id, tokenId))
      .then(() => undefined)
      .catch((err: unknown) => {
        this.logger.warn({ tokenId, err }, 'user_token_last_used_touch_failed');
      });
  }
}
