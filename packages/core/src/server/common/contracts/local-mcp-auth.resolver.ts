// LocalMcpAuthResolver — default implementation for the MCP channel
// See docs/specs/08-saas-adapter-boundary.md §3.3
//
// resolveFromMcp() is still in the "transport TODO" phase:
// OSS apps/server/src/channels/mcp/ only contains tool definition aggregation; **no real MCP server is mounted**
// (mcp.controller.ts is an empty controller without a transport adapter; historically getMcpActor read the actor field directly
// from McpToolContext). Until the MCP transport adapter lands, this resolver provides:
//   - resolveFromMcp(metadata): try to extract token from metadata.authInfo.token / headers.authorization / meta.token;
//     if found, run the verifier; otherwise throw 401.
//   - resolveFromUserToken(token): verifier check directly (same behavior as HTTP path, skipping IP check).
//
// This keeps SaaS adapters overridable as usual without blocking the HTTP mainline.

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { McpAuthResolver } from './mcp-auth.resolver';
import { LocalUserTokenVerifier } from './local-user-token.verifier';
import type { ActorContext } from '../actor-context';
import type { McpRequestMetadataLike } from './types';

@Injectable()
export class LocalMcpAuthResolver extends McpAuthResolver {
  constructor(private readonly verifier: LocalUserTokenVerifier) {
    super();
  }

  async resolveFromMcp(metadata: McpRequestMetadataLike): Promise<ActorContext> {
    const token = this.extractToken(metadata);
    if (!token) throw new UnauthorizedException('missing_user_token');
    return this.verifier.verify(token, { actorKind: 'system_mcp' });
  }

  async resolveFromUserToken(token: string): Promise<ActorContext> {
    return this.verifier.verify(token, { actorKind: 'system_mcp' });
  }

  private extractToken(metadata: McpRequestMetadataLike): string | null {
    // TODO(mcp-transport): once the MCP SDK is actually wired up, this statement should switch to reading the SDK-provided authInfo.token;
    // the current implementation is a fallback union of common SDK shapes (authInfo / headers / meta) and will be tightened when the SDK lands.
    if (metadata.authInfo?.token) return metadata.authInfo.token;

    const headers = metadata.headers ?? {};
    const auth = headers['authorization'] ?? headers['Authorization'];
    if (auth) {
      const header = Array.isArray(auth) ? auth[0] : auth;
      if (header) {
        const match = /^Bearer\s+(.+)$/i.exec(header);
        if (match?.[1]) return match[1].trim();
      }
    }

    const metaToken = metadata.meta?.['token'];
    if (typeof metaToken === 'string' && metaToken.length > 0) return metaToken;

    return null;
  }
}
