// Thin transport-agnostic shapes consumed by the resolver abstract classes.
// See docs/specs/08-adapter-extension-points.md §3.1-3.3
//
// Stays decoupled from concrete express / @modelcontextprotocol SDK types; both OSS and
// replacement resolver implementations must avoid importing third-party transport-layer types directly.

/**
 * Abstract HTTP request shape. express.Request satisfies this structure.
 */
export interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * Abstract MCP request metadata. OSS does not actually wire MCP transport yet,
 * so this type is a placeholder; the real SDK shape will be more refined when a replacement implementation lands,
 * and the implementation side chooses to extract token from headers / meta / authInfo.
 */
export interface McpRequestMetadataLike {
  /**
   * MCP protocol metadata field (compatible with the SDK's Meta / authInfo bag).
   * For example `{ token: 'ph_tok_xxx' }` or `{ headers: { authorization: 'Bearer ...' } }`.
   */
  headers?: Record<string, string | string[] | undefined>;
  meta?: Record<string, unknown>;
  /**
   * Some MCP transports allow attaching authInfo directly (e.g. middleware extraction result in streamable HTTP mode).
   */
  authInfo?: { token?: string } | undefined;
}

/**
 * Hint for ProjectContextResolver.resolve.
 * The OSS default implementation ignores all hints and always returns LOCAL_PROJECT_CONTEXT;
 * A replacement RemoteProjectContextResolver reads projectId / projectIdHeader / mcpMetadata.
 */
export interface ProjectContextHint {
  /** Already-resolved project id from an internal row or trusted runtime boundary. */
  projectId?: string;
  /** HTTP `X-Project-Id` header */
  projectIdHeader?: string;
  /** MCP metadata (same source as McpAuthResolver) */
  mcpMetadata?: McpRequestMetadataLike;
  /** Webhook entry: populated by ConnectorContextResolver */
  connectorId?: string;
}
