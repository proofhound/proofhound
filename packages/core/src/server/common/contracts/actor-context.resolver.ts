// ActorContextResolver — HTTP-entry adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.2
//
// HTTP controllers complete user-token validation via HttpActorGuard → resolveFromHttp;
// the same token pool is validated independently by McpAuthResolver, but this resolver MUST NOT call McpAuthResolver
// (SPEC §8 red line: the three entry resolvers never call each other).
//
// `resolveFromUserToken` is the shared entrypoint for HTTP paths and unit tests; it must not be reused directly by the MCP entry.

import type { ActorContext } from '../actor-context';
import type { HttpRequestLike } from './types';

export abstract class ActorContextResolver {
  abstract resolveFromHttp(req: HttpRequestLike): Promise<ActorContext>;

  abstract resolveFromUserToken(token: string): Promise<ActorContext>;
}
