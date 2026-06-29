// LocalMcpAuthResolver — default implementation for the MCP channel
// See docs/specs/08-adapter-extension-points.md §3.3 and docs/specs/09-mcp-server.md.
//
// The MCP server transport (channels/mcp/mcp.transport.ts) calls resolveFromMcp(metadata) on every
// request before dispatching a tool. This resolver:
//   - resolveFromMcp(metadata): extracts the user token from metadata.authInfo.token /
//     headers.authorization (`Bearer ph_*`) / meta.token; if found, runs the verifier; otherwise 401.
//   - resolveFromUserToken(token): verifier check directly (same as the HTTP path, skipping IP check).
//
// A replacement implementation overrides this resolver (e.g. per-org MCP token / JWT) without touching the transport.

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
    // The Streamable-HTTP transport passes req.headers, so the `Bearer ph_*` header is the live path;
    // authInfo / meta.token are accepted too for SDK shapes that pre-extract the credential.
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
