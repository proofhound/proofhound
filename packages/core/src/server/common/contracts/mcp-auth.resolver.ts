// McpAuthResolver — MCP channel adapter extension point
// See docs/specs/08-adapter-extension-points.md §3.3
//
// In OSS, the MCP entry and HTTP entry share the `ph_core.tokens where scope='user'` resource pool,
// but the two resolvers override independently. MUST NOT call ActorContextResolver.

import type { ActorContext } from '../actor-context';
import type { McpRequestMetadataLike } from './types';

export abstract class McpAuthResolver {
  abstract resolveFromMcp(metadata: McpRequestMetadataLike): Promise<ActorContext>;

  abstract resolveFromUserToken(token: string): Promise<ActorContext>;
}
