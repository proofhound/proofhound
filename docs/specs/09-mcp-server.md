# 09 · MCP server

This document specifies the MCP (Model Context Protocol) server entry channel: how the open-source
self-hosted edition serves its tool surface to MCP clients (Claude Desktop, IDE agents, etc.), the
transport it mounts, how it authenticates with the user token, and how it dispatches to the existing
tool definitions and Services.

> The MCP channel is one of the three parallel entry channels (HTTP API / MCP / Webhook). It reuses
> the **user token** pool (`ph_core.tokens` `scope='user'`, `ph_` prefix) — the same token a user
> copies into an external script for the HTTP API also authenticates MCP — but it is resolved by its
> own resolver (`McpAuthResolver`, [08 §3.3](08-adapter-extension-points.md)), never by the HTTP entry's
> `ActorContextResolver`. See [02 §3](02-tech-stack.md) "MCP tools and REST entry points converge on
> the same set of Services" and hard-constraint #16 (every frontend-invocable Service method exposes
> a corresponding MCP tool).

## 1. Why this SPEC exists

The tool **definitions** already exist (`packages/core/src/server/channels/mcp/*.tools.ts`, one
`createXxxTools(service)` aggregator per domain, satisfying constraint #16). What has not existed is
the **server + transport** that exposes them over the MCP protocol: there was no MCP SDK dependency
and `mcp.controller.ts` was an empty, unregistered `@Controller('mcp')`. Standing up a real MCP
server is a new externally-visible entry channel, so it is specified here before implementation
(hard-constraint #1).

## 2. Transport

| Item | Choice | Reason |
| ---- | ------ | ------ |
| Protocol | MCP via `@modelcontextprotocol/sdk` | the official TypeScript SDK; OSS does not hand-roll the wire format |
| Transport | **Streamable HTTP** | modern MCP HTTP transport (SSE is legacy); fits a self-hosted web server reachable over HTTP |
| Endpoint | `POST/GET/DELETE /mcp` on the core server | the same NestJS app that serves the HTTP API; one origin |
| Session | **stateless** (one transport + server instance per request) | a single-workspace OSS needs no session store; keeps the surface minimal and avoids a login/session subsystem (consistent with [08 §3.2.1](08-adapter-extension-points.md) formation reasoning) |

Not adopted:

| Approach | Reason |
| -------- | ------ |
| stdio transport | requires the server to run as a client-spawned subprocess; wrong shape for a long-running self-hosted web service |
| stateful sessions (session id + event store) | a single workspace gains nothing; adds server-side session lifecycle and storage |

The `@Controller('mcp')` is **not** placed under `@UseGuards(HttpActorGuard)` — MCP authentication is
the transport's responsibility via `McpAuthResolver`, not the HTTP actor guard. The two entries share
the user-token pool but never share a resolver ([08 §6](08-adapter-extension-points.md) red line).

## 3. Authentication

- The MCP client sends the user token as an HTTP header: `Authorization: Bearer ph_*` (the same
  `ph_`-prefixed user token used by the HTTP API; see [06 §3.2](06-database-schema.md) and
  [34 §settings](34-settings.md) "global MCP token").
- The transport adapter passes the request headers as `McpRequestMetadataLike.headers` to
  `McpAuthResolver.resolveFromMcp(metadata)` ([08 §3.3](08-adapter-extension-points.md)). The OSS default
  `LocalMcpAuthResolver` sha256-hashes the token (including the `ph_` prefix), looks it up in
  `ph_core.tokens where scope='user' AND revoked_at IS NULL`, validates `expires_at`, touches
  `last_used_at`, and returns `{ actorKind: 'system_mcp', actorId: tokenId }`.
- `McpDispatchContextFactory.build(metadata)` then resolves the `ProjectContext` via
  `ProjectContextResolver` and assembles the `McpToolContext` injected into every tool handler.
- OSS issues no JWTs; the MCP entry never introduces a JWT/JWKS library — that path is an override's
  exclusive concern ([08 §6](08-adapter-extension-points.md)).

Error mapping (resolver throws `UnauthorizedException`):

| Condition | Code | HTTP |
| --------- | ---- | ---- |
| No token in metadata | `missing_user_token` | 401 |
| Token not found / hash mismatch | `invalid_user_token` | 401 |
| Token expired | `expired_user_token` | 401 |

## 4. Tool registration & dispatch

- The server collects all tool definitions from `channels/mcp/index.ts` (the 14 `createXxxTools`
  aggregators), each yielding `McpToolDefinition { name, description, inputSchema, handler(input, ctx) }`.
- The SDK server answers `tools/list` from the registered names/descriptions/`inputSchema`, and
  `tools/call` by looking up the tool by name and invoking `handler(args, ctx)` where `ctx` is the
  `McpToolContext` carrying the resolver-validated actor + project.
- Before the SDK dispatches a request, `McpDispatchContextFactory` validates the actor + project and calls
  `AccessControlService.assertCan(actor, project, 'mcp_tool')` ([08 §3.6](08-adapter-extension-points.md)).
  This channel-level gate lets an override allow / deny MCP usage independently of the HTTP API. Each `handler`
  then delegates to the corresponding Service method, whose normal business authorization still runs
  (`project_read`, `project_write`, `release_manage`, `user_token_manage`, etc.). The MCP channel grants
  no admin bypass to the project layer — `system_mcp` flows through access-control's system-kind handling,
  not super-admin.
- A handler that throws maps to a JSON-RPC error in the `tools/call` response.

The legacy "no transport yet" fallback in `getMcpActor` (which synthesized a default actor when
`ctx.actor` was missing) is removed: once the transport injects a validated actor, a missing actor is
an error (`missing_user_token`), never a silent default.

## 5. Boundaries & override

- The MCP server reuses the user-token credential system; it does **not** read or write
  `scope='webhook'` rows, and the webhook entry does not flow through it.
- Starting a workflow / enqueuing a job from an MCP tool passes through
  `WorkflowAuthorizationHook.assertCanStart` ([08 §3.8](08-adapter-extension-points.md)) like any other
  entry; the OSS default is a no-op.
- An override replaces only `McpAuthResolver` (e.g. a host-issued MCP token or JWT in MCP metadata) and
  keeps the same `ActorContext` shape; the transport, registration, and dispatch layers are unchanged.
  No edition flag or env branch is introduced in OSS code.

## 6. Relationship to other SPECs

- [02 Tech stack](02-tech-stack.md): MCP tools and REST entry points converge on the same Services.
- [03 Orchestration §3.6](03-orchestration.md): workflow/job starts triggered from MCP tools obey the
  same enqueue path and `WorkflowAuthorizationHook`.
- [06 Database schema §3.2](06-database-schema.md): the `scope='user'` token pool the MCP channel
  authenticates against (no "at most one global MCP token" constraint).
- [08 Adapter extension points §3.3](08-adapter-extension-points.md): the `McpAuthResolver`
  extension point this server consumes, and its override path.
- [34 Settings](34-settings.md): the user-facing "global MCP token" used to authenticate this channel.
