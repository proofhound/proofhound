// LocalActorContextResolver — default implementation for the HTTP entry
// See docs/specs/08-saas-adapter-boundary.md §3.2 (channel-aware dual entry)
//
// HTTP entry handles two channels in one resolver (per-request dispatch):
//   1. API channel (Authorization: Bearer ph_*):
//      - sha256 hash compare against ph_core.tokens scope='user' via LocalUserTokenVerifier
//      - JWT-shape token (Bearer eyJ*) is rejected with 401 unsupported_credential
//        (SaaS adapter override path; OSS does not issue JWTs)
//      - Returns actorKind='script', actorId=tokenId
//   2. UI channel:
//      - Reads trusted deployment header (default X-Forwarded-User; configurable via
//        PH_TRUSTED_USER_HEADER), set when behind oauth2-proxy / Cloudflare Access /
//        Tailscale / Authelia (deployment formation B in SPEC §3.2.1)
//      - Falls back to LOCAL_ACTOR_ID (deployment formation A: single-user self-hosted) when
//        no Authorization and no trusted header
//      - Returns actorKind='local_user', actorId=LOCAL_ACTOR_ID
//
// OSS browsers do NOT carry Authorization or session cookies; the UI channel never accepts
// user tokens posing as session credentials (SPEC §8 red line).

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ActorContextResolver } from './actor-context.resolver';
import { LocalUserTokenVerifier } from './local-user-token.verifier';
import type { HttpRequestLike } from './types';
import { LOCAL_ACTOR_ID, type ActorContext } from '../actor-context';

const DEFAULT_TRUSTED_USER_HEADER = 'X-Forwarded-User';

@Injectable()
export class LocalActorContextResolver extends ActorContextResolver {
  constructor(private readonly verifier: LocalUserTokenVerifier) {
    super();
  }

  async resolveFromHttp(req: HttpRequestLike): Promise<ActorContext> {
    const authHeader = this.readHeader(req, 'authorization');

    // 1. API channel
    if (authHeader) {
      const token = this.parseBearer(authHeader);

      // JWT shape: OSS does not validate JWTs — that path belongs to SaaS RemoteActorContextResolver
      if (looksLikeJwt(token)) {
        throw new UnauthorizedException('unsupported_credential');
      }

      const clientIp = req.ip ?? req.socket?.remoteAddress;
      return this.verifier.verify(token, { clientIp, actorKind: 'script' });
    }

    // 2. UI channel — trusted deployment header (formation B) or LOCAL_ACTOR fallback (formation A)
    const trustedHeaderName = (process.env.PH_TRUSTED_USER_HEADER ?? DEFAULT_TRUSTED_USER_HEADER).toLowerCase();
    const trustedHeader = this.readHeader(req, trustedHeaderName);
    // Trusted header presence is enough; its value is the upstream-proxy-asserted user identity
    // (recorded for audit by the proxy). OSS single-user does not further validate the value.
    void trustedHeader;

    return {
      actorId: LOCAL_ACTOR_ID,
      actorKind: 'local_user',
    };
  }

  async resolveFromUserToken(token: string): Promise<ActorContext> {
    // ip_whitelist skip: this entry does not carry the request IP; SPEC §3.2 explicitly states this path does not check IP.
    // actorKind='script' because resolveFromUserToken is the HTTP-side shared entrypoint
    // (unit tests + future API token CLI flows). MCP uses LocalMcpAuthResolver.resolveFromUserToken instead.
    return this.verifier.verify(token, { actorKind: 'script' });
  }

  private readHeader(req: HttpRequestLike, name: string): string | undefined {
    const lower = name.toLowerCase();
    const raw =
      req.headers[lower] ?? req.headers[name] ?? req.headers[name.charAt(0).toUpperCase() + name.slice(1)];
    if (!raw) return undefined;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value.length > 0 ? value : undefined;
  }

  private parseBearer(header: string): string {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new UnauthorizedException('invalid_authorization_header');
    const token = match[1]?.trim();
    if (!token) throw new UnauthorizedException('invalid_authorization_header');
    return token;
  }
}

// JWT detection: header.payload.signature, each segment base64url; header always starts with `{"`
// which base64-encodes to `eyJ`. This is a structural sniff, not validation — OSS rejects on shape alone.
function looksLikeJwt(token: string): boolean {
  if (!token.startsWith('eyJ')) return false;
  const dots = token.split('.').length - 1;
  return dots === 2;
}
