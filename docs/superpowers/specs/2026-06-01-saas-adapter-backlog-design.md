# SaaS Adapter-Boundary Backlog — Implementation Design

- **Date:** 2026-06-01
- **Branch:** `feat/saas-adapter-backlog`
- **Status:** Approved (decisions 1–5 signed off by ZiqiXiao)
- **Governing SPEC:** [`docs/specs/08-saas-adapter-boundary.md`](../../specs/08-saas-adapter-boundary.md) (+ new `docs/specs/09-mcp-server.md`)

## 1. Context & problem

An audit of `docs/specs/08-saas-adapter-boundary.md` §7 (PR0–11) against the actual codebase
found **7 of 13 PRs not fully landed**, plus SPEC drift (the SPEC under-reports landed state).

Audited status (master @ `02f5bd4`):

| PR | Extension point | Status |
| -- | --------------- | ------ |
| PR0 extract `@proofhound/core` | — | ✅ landed |
| PR1 DI abstractions + `@CurrentProject` + register | §3.1–3.9 | ⚠️ partial (4/8 abstracts + HttpActorGuard; decorator absent; Connector/Token/Limiter/Workflow missing) |
| PR2 tokens table + run_results.webhook_token_id | — | ✅ landed |
| PR3 converge Controllers/MCP | §3.1 | ⚠️ partial (actor/guard half only; project/decorator half absent) |
| PR4a Actor API channel + ph_ prefix | §3.2 | ✅ landed |
| PR4b Actor UI channel + HttpActorGuard | §3.2/3.9 | ✅ landed |
| PR5 McpAuthResolver real validation | §3.3 | ⚠️ partial (resolver landed; MCP entry has **no transport** to wire it into) |
| PR6 ConnectorContextResolver extraction | §3.4 | ⚠️ partial (token-model groundwork only; auth still inline) |
| PR7 TokenService abstraction | §3.5 | ❌ not landed |
| PR8 AccessControl DI seam | §3.6 | ✅ landed |
| PR9 LimiterKeyStrategy | §3.7 | ❌ not landed |
| PR10 WorkflowAuthorizationHook | §3.8 | ❌ not landed |
| PR11 API client transport | — | ✅ landed |

**Decision (ZiqiXiao):** complete the entire remaining backlog — including building the
**greenfield MCP server transport** that PR5 depends on — in **one worktree, one combined PR**.

Key constraint surfaced during brainstorming: the MCP channel today has tool *definitions*
(17 `*.tools.ts`) but **no server and no transport** (no `@modelcontextprotocol/sdk`,
`mcp.controller.ts` is an empty unregistered `@Controller('mcp')`). Standing up an MCP server
is a new business capability, so per CLAUDE.md hard-constraint #1 it gets its own SPEC first
(`docs/specs/09-mcp-server.md`).

## 2. Scope (8 work items, one PR)

| # | Item | SPEC PR | Size |
| - | ---- | ------- | ---- |
| A | Build MCP server transport + wire `McpAuthResolver` | PR5 | 🟥 greenfield |
| B | `@CurrentProject` decorator + 4 remaining abstract DI tokens + register | PR1 | 🟧 |
| C | Converge 13 Controllers + MCP onto resolver (async `ProjectContextResolver`) | PR3 | 🟧 |
| D | `ConnectorContextResolver` extraction | PR6 | 🟨 |
| E | `TokenService` abstraction | PR7 | 🟩 |
| F | `LimiterKeyStrategy` integration | PR9 | 🟧 |
| G | `WorkflowAuthorizationHook` integration | PR10 | 🟨 |
| H | SPEC sync (08 backfill) + new `09-mcp-server.md` | — | 🟩 docs |

**Out of scope:** organizations/roles/RBAC (SaaS-only, §8 red lines); any `Remote*`
implementation; edition flags; MCP client config docs beyond what the server needs.

## 3. Approved design decisions

### Decision 1 — MCP transport: Streamable HTTP, stateless, reuse `Authorization: Bearer ph_*`

- **SDK:** add `@modelcontextprotocol/sdk` to `@proofhound/core`.
- **Transport:** Streamable HTTP (modern; SSE is legacy). Mounted at the existing `/mcp` route;
  the Nest handler hands `req`/`res` to the SDK's `StreamableHTTPServerTransport`.
- **Session:** **stateless** — one transport+server per request, no session store (fits a
  single-workspace OSS, minimal surface).
- **Auth:** client sends `Authorization: Bearer ph_*` as an HTTP header (the **same** user-token
  pool as the HTTP API). The transport adapter passes the headers as `McpRequestMetadataLike` to
  `McpAuthResolver.resolveFromMcp(metadata)`. This stays a **separate resolver** from
  `ActorContextResolver` — the two never call each other (§8 red line).
- **Tool registration:** register the 17 `createXxxTools(service)` aggregators on the MCP server;
  each handler receives the `McpToolContext` assembled by the already-written
  `McpDispatchContextFactory.build(metadata)` (actor via `McpAuthResolver`, project via
  `ProjectContextResolver`). Tool calls flow through `AccessControlService` action `mcp_tool`.
- Rejected: stdio transport (needs a subprocess, wrong for a web service); stateful sessions
  (single workspace doesn't need them).

### Decision 2 — `LimiterKeyStrategy`: build the key at the runtime layer, pass an opaque string down

- New `LimiterKeyStrategy` abstract + `LocalLimiterKeyStrategy` (returns `model:<modelId>`) in
  core contracts.
- The **core runtime** (worker `llm-runner` / server) computes
  `limiterKey = strategy.buildModelKey(actor, project, modelId)`.
- Only the **opaque `limiterKey: string`** is threaded down into `llm-client` invoke → `limiter`.
  `@proofhound/llm-client` and `@proofhound/limiter` stay **actor/project-unaware** (§8 red line).
- `packages/limiter` API: rename `modelId` → `key` on `AcquireArgs`/`ReleaseArgs`/`ReportOutcomeArgs`;
  the limiter still composes `key:rpm | key:tpm | key:concurrency | key:autostate`. OSS default key
  `model:<modelId>` keeps behavior equivalent (Redis counter keys are ephemeral; namespace change is safe).
- Rejected: passing actor/project into `llm-client`/`limiter` (violates §8).

### Decision 3 — `@CurrentProject`: guard resolves project, decorator only reads it

- A param decorator cannot inject DI services and `ProjectContextResolver.resolve()` is async, so
  **`HttpActorGuard`** — after resolving the actor — also calls
  `ProjectContextResolver.resolve(actor, { projectIdHeader: req['x-project-id'] })` and attaches the
  result to `request.projectContext`.
- `@CurrentProject()` is a thin **synchronous** reader of `request.projectContext`.
- This wires the DI `ProjectContextResolver` into the live request path (fixes the audited §3.1
  "resolver bound but never called" gap).
- The 13 controllers replace `resolveProjectContext(actor)` with a `@CurrentProject() project`
  parameter. The MCP half of PR3 is delivered by Decision 1's transport.

### Decision 4 — `ConnectorContextResolver` must preserve the expired/invalid distinction

- Extract `WebhookService.authorizeConnector()` (`webhook.service.ts:193-212`) into a
  `ConnectorContextResolver` abstract + `LocalConnectorContextResolver`.
- The resolver SQL **does not** add `expires_at > now()` (current inline behavior); the resolver
  itself checks expiry and throws `expired_webhook_token` vs `invalid_webhook_token`. A literal copy
  of SPEC §688's query would collapse the two codes.
- Returns `{ connector, projectContext, actorContext }` with `actorKind='system_webhook'`,
  `actorId=connectorId`. The existing `webhookTokenId` → job-payload → `run_results.webhook_token_id`
  flow is preserved.

### Decision 5 — New MCP SPEC at `docs/specs/09-mcp-server.md`

- 09–20 is an empty number band; MCP is an entry channel parallel to webhook.
- Implementation design doc (this file) lives under `docs/superpowers/specs/`.

### No-suspense items (build straight to SPEC 08 §3.x)

- **PR7:** `token.service.ts` → `abstract TokenService` + `LocalTokenService`; the abstract class is
  the DI token, `LocalTokenService` (holding `TokenRepository`) is bound in the token feature module
  (where its repo lives); SaaS overrides with `RemoteTokenService`. Handles `scope='user'` only.
- **PR10:** `WorkflowAuthorizationHook` abstract + `LocalWorkflowAuthorizationHook` (no-op) +
  `WorkflowKind` enum reconciled against `docs/specs/03-orchestration.md`; bound in
  `LocalContractsModule`; `assertCanStart(actor, project, workflow)` called once before each
  workflow start / job enqueue.
- **SPEC 08 backfill:** update §2 + §3.2 "current state" blocks, and the §7 `(landed)` markers, to
  match reality after this PR.

## 4. Component design

### 4.1 New contracts (`packages/core/src/server/common/contracts/`)

| File | Export | Notes |
| ---- | ------ | ----- |
| `connector-context.resolver.ts` | `abstract ConnectorContextResolver` + `ConnectorResolveResult` | §3.4 contract draft |
| `local-connector-context.resolver.ts` | `LocalConnectorContextResolver` | wraps the extracted webhook auth; **lives so the webhook runtime can inject it** |
| `modules/token/token.service.ts` | `abstract TokenService` (DI token) | §3.5; `LocalTokenService` in same module |
| `limiter-key.strategy.ts` | `abstract LimiterKeyStrategy` + `LocalLimiterKeyStrategy` | §3.7 |
| `workflow-authorization.hook.ts` | `abstract WorkflowAuthorizationHook` + `LocalWorkflowAuthorizationHook` + `WorkflowKind` | §3.8 |

`LocalContractsModule` binds the new tokens (`ConnectorContextResolver`, `LimiterKeyStrategy`,
`WorkflowAuthorizationHook`) alongside the existing four. `TokenService` is bound in the token
feature module (repo locality). Note: `ConnectorContextResolver` is consumed by the **webhook**
runtime, which is a different Nest app (`ProofHoundWebhookModule`) — it gets its own
`@Global` contracts binding (or the webhook module imports a shared local-contracts provider set);
resolve the exact wiring in the plan.

### 4.2 `@CurrentProject` decorator

- `packages/core/src/server/common/decorators/current-project.decorator.ts` — reads
  `request.projectContext`. Mirrors the existing `current-user.decorator.ts`.
- `HttpActorGuard.canActivate` gains a second step: resolve + attach `request.projectContext`.
  The guard already depends only on `ActorContextResolver`; it now also injects
  `ProjectContextResolver` (both from the global contracts module).

### 4.3 MCP server (`packages/core/src/server/channels/mcp/`)

- `mcp.controller.ts` — real `@Controller('mcp')` with `POST`/`GET`/`DELETE` (Streamable HTTP
  semantics) delegating to the transport service. Registered in a new `McpModule` imported by
  `ProofHoundServerModule`.
- `mcp-server.factory.ts` (new) — builds an SDK `Server`/`McpServer`, registers all tools from
  `channels/mcp/index.ts`, maps each tool's `inputSchema` + `handler(input, ctx)`.
- `mcp.transport.ts` (new) — per-request `StreamableHTTPServerTransport`; extracts the
  `Authorization` header → `McpDispatchContextFactory.build(headers)` → injects `ctx` into the
  handlers; maps thrown `UnauthorizedException('*_user_token')` to MCP/HTTP 401.
- Remove the `getMcpActor` legacy fallback (the "no transport yet" branch); once the transport
  injects a validated actor, a missing actor must **throw**, not synthesize a default.

### 4.4 LimiterKeyStrategy wiring

- Strategy lives in core contracts; the **worker** `llm-runner` / `llm.consumer` and any server
  call path build `limiterKey` and pass it into the `llm-client` invoke deps as an opaque field.
- `packages/llm-client/src/invoke.ts`: `deps.limiter.acquire/release/reportOutcome` switch from
  `{ modelId }` to `{ key: limiterKey }`; `invoke` accepts the pre-built `limiterKey` (no actor/project).
- `packages/limiter`: param rename + internal key composition uses the passed `key`.

## 5. SPEC changes (item H — written FIRST, per hard-constraint #1)

1. **`docs/specs/08-saas-adapter-boundary.md`** — backfill:
   - §2 current-state note: list §3.1/3.2/3.3/3.6/3.9 as landed; correct "remaining six".
   - §3.2 "Current OSS state": HTTP entry now does real token validation (PR4a/4b landed) — remove
     the stale "stub / hardcoded LOCAL_ACTOR" wording.
   - §3.3 / §3.4 / §3.5 / §3.7 / §3.8: mark each as landed once implemented; update the "current
     state" sentences (e.g. §3.3 "MCP channel has no pre-validation" → describe the real transport).
   - §7 table: add `(landed)` markers for PR1, PR3, PR5, PR6, PR7, PR9, PR10 (and note PR2/4a/4b/11
     were already landed but untagged).
   - Cross-reference the new `09-mcp-server.md` from §3.3 and §9.
2. **`docs/specs/09-mcp-server.md`** *(new)* — MCP server transport SPEC: transport choice
   (Streamable HTTP, stateless), `/mcp` endpoint contract, token-in-`Authorization` extraction,
   tool registration model, error mapping, relationship to §3.3 `McpAuthResolver` and constraint #16.

## 6. Implementation ordering (phases within the one PR)

1. **SPEC first** — write `09-mcp-server.md`, backfill `08`, commit (source of truth before code).
2. **PR1 scaffolding** — 4 new abstract tokens + `LocalLimiterKeyStrategy`/`LocalWorkflowAuthorizationHook`/
   `LocalConnectorContextResolver` placeholders + `@CurrentProject` decorator + register in contracts.
3. **Independent self-contained items (parallelizable)** — PR7, PR10, PR6, PR9.
4. **PR3 convergence** — guard resolves project; 13 controllers move to `@CurrentProject`.
5. **MCP server transport + PR5** — SDK, server factory, transport, controller, module, wire auth.
6. **Verify** — `pnpm verify` green; unit tests per Service/step/handler/strategy; e2e/Playwright smokes
   where a live path changed (HTTP guard project resolution, MCP server happy path).

## 7. Testing strategy

- **Unit:** each new abstract's Local default (`LocalLimiterKeyStrategy.buildModelKey`,
  `LocalWorkflowAuthorizationHook.assertCanStart` no-op, `LocalConnectorContextResolver` expired vs
  invalid, `LocalTokenService` CRUD), the `@CurrentProject` guard step, the MCP tool dispatch +
  auth (validated actor injected; missing/expired/invalid token → 401), limiter key threading.
- **Integration/e2e:** real HTTP routes through `HttpActorGuard` (now resolving project);
  MCP server happy-path tool call with a `ph_*` token; webhook auth still distinguishes
  `expired_webhook_token`/`invalid_webhook_token` after extraction.
- **Regression:** `pnpm deps:check` (no new cycles), `pnpm spec:terms`.

## 8. Risks

- **MCP transport** is the largest, least-spec'd piece; the SDK's exact Streamable HTTP + Nest
  integration shape is confirmed at implementation time (SPEC §3.3 anticipates this).
- **PR3** touches 13 controllers + async project resolution — broad but mechanical; covered by HTTP
  route regression tests.
- **PR9** changes `packages/limiter` public types — all call sites must move in lock-step.
- **Single PR** is large; mitigated by clean per-item commits inside the branch and item-scoped tests.
