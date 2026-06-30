# 08 · Adapter extension points

This document defines the replaceable adapter extension points the OSS trunk provides: the contract of each extension point, its OSS default implementation, and its call boundary. An external consumer (a control-plane host shell, a different deployment, etc.) can override the defaults by depending on the OSS packages and binding its own implementations — without forking or patching OSS source.

> This SPEC only constrains the OSS trunk side. The OSS must keep the extension points stable and thin enough that an external consumer can override the default implementations through package exports alone. How any particular external consumer implements an override is out of scope here.

> Consistent with section 7 "Things you shouldn't do #1" in CLAUDE.md / AGENTS.md: this SPEC does not introduce any control plane business (organizations / memberships / roles / project switcher, etc.) into the OSS trunk.

## 1. Roles

| Side                                | Role                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proofhound` (OSS, this repository) | Business implementation packaged through `@proofhound/core` + adapter extension points + local default implementations + OSS process shells                     |
| External consumer (out of scope)    | Depends on the OSS packages (`@proofhound/core` and foundational `@proofhound/*` packages) and overrides extension points to add its own deployment behavior; not implemented in this repository |

The OSS trunk must always run standalone in a "local single project + default implementation" form. This repository carries no external consumer and no edition branch; the form difference is borne entirely by the `contracts` module an external consumer supplies (§2).

This design follows an "open-core + adapter override" shape: the OSS trunk is a single shared business codebase, and replacement happens by binding a different `contracts` module at assembly time rather than by an edition flag or a forked branch.

## 2. Core package and adapter injection mechanism

The reusable backend runtime is exported from `packages/core` as `@proofhound/core`. `apps/server`, `apps/webhook`, and `apps/worker` are OSS process shells only; they are not library entry points, and an external consumer must not import them through deep paths or app-level barrels.

During local development an external consumer may consume the OSS packages through a workspace link, local tarballs, or a local registry. The import surface must still be the same package exports used by npm distribution, for example `@proofhound/core/server` and `@proofhound/core/contracts`; local source paths under `apps/*` are never the integration contract.

The OSS must guarantee the following contracts:

- Public exports of `@proofhound/core` and other `packages/*` packages are stable; any breaking export change is treated as a breaking change
- `@proofhound/core` declares dependencies on the foundational OSS packages it uses (`@proofhound/shared`, `@proofhound/db`, `@proofhound/logger`, etc.) instead of bundling duplicate copies of them into one artifact
- `@proofhound/core` exposes stable subpaths for the reusable runtime:
  - `@proofhound/core/server`: `ProofHoundServerModule.forRoot({ contracts })`
  - `@proofhound/core/webhook`: `ProofHoundWebhookModule`
  - `@proofhound/core/worker`: `ProofHoundWorkerModule`
  - `@proofhound/core/contracts`: abstract-class DI tokens and OSS local defaults
  - `@proofhound/core/infra`: shared Nest infra modules/services required to compose an OSS or external `contracts` module without deep-importing `packages/core/src/*`
- All extension points are injected via DI tokens (abstract class); internal OSS code never hard-imports the concrete classes of the default implementations
- The core server module is assembled as a dynamic module via `ProofHoundServerModule.forRoot({ contracts })`. The `contracts` argument is a `@Global` module that binds every extension-point token to a concrete implementation: the OSS shell passes `LocalContractsModule` (the `Local*` defaults), and an external consumer passes its own `contracts` module binding its own implementations. Assembly-time injection through `forRoot` is the **production** mechanism for replacing extension points; OSS business code never learns which `contracts` module was supplied, and no edition flag is introduced (cf. §6)
- `overrideProvider` (`Test.createTestingModule(...).overrideProvider(X)`) is reserved strictly as a **test-time** replacement primitive—`@nestjs/testing` must never enter the production bundle. Production form differences are carried solely by the `contracts` module handed to `forRoot`, not by `overrideProvider`
- App-level barrels are not an accepted integration mechanism. If runtime code must be shared, it belongs in `packages/core` and is exported by `@proofhound/core`, not by `apps/server/src/index.ts` or equivalent.

DI tokens uniformly use abstract class form (e.g. `ProjectContextResolver`), not Symbol—cross-package shared Symbol token behavior is unstable. The `contracts` module passed to each runtime root's `forRoot({ contracts })` is the only edition-variable input, keeping the seam to a single assembly-time point rather than a runtime branch. Any concrete local default, repository, or shared infra module that an external consumer needs to assemble its own `contracts` module must be exposed through a stable `@proofhound/core/*` subpath; an external consumer must not deep-import `packages/core/src/*`.

All thirteen extension points (§3.1–§3.13) are abstract-class DI tokens with an OSS `Local*` or no-op default, bound in the `contracts` module supplied to each runtime root (OSS: `LocalContractsModule`). Feature modules consume those providers and do not bind local defaults that would shadow them. The shared infra and local-default building blocks needed by an external `contracts` module are exported from `@proofhound/core/infra` and `@proofhound/core/contracts`, respectively. The one exception is `HttpActorGuard` (§3.9), an executable base class instantiated from `@UseGuards` metadata rather than a provider.

## 3. Extension point list

The OSS trunk provides the following 17 extension points. Each extension point requires: interface (abstract class) + OSS default implementation + Nest module registration.

| No.  | Extension point             | Entry channel                                             |
| ---- | --------------------------- | --------------------------------------------------------- |
| 3.1  | `ProjectContextResolver`    | HTTP / MCP / Webhook combined                             |
| 3.2  | `ActorContextResolver`      | HTTP (user token)                                         |
| 3.3  | `McpAuthResolver`           | MCP channel (user token)                                  |
| 3.4  | `ConnectorContextResolver`  | Webhook (per-connector webhook token)                     |
| 3.5  | `TokenService`              | User token CRUD                                           |
| 3.6  | `AccessControlService`      | Service layer                                             |
| 3.7  | `LimiterKeyStrategy`        | Rate limit before LLM calls                               |
| 3.8  | `WorkflowAuthorizationHook` | Before starting a workflow / enqueuing a job              |
| 3.9  | `HttpActorGuard`            | HTTP (guard shell; depends on §3.2)                       |
| 3.10 | `RuntimeLimitsProvider`     | Per-call RPM / TPM / concurrency merge before LLM enqueue |
| 3.11 | `QuotaPolicyHook`           | Storage writes and execution-slot admission               |
| 3.12 | `UsageMeteringHook`         | Best-effort domain usage event emission                   |
| 3.13 | `DatasetUploadService`      | Dataset file upload + import strategy (write side: transport + storage)  |
| 3.14 | `DatasetSampleRepository`   | Dataset sample read path (execution render / preview / search / export)  |
| 3.15 | `DatasetDeletionHook`       | Dataset permanent-deletion impact list (before the rule-4 cascade)       |
| 3.16 | `PromptDeletionHook`        | Prompt / version permanent-deletion impact list (before the rule-4 cascade) |
| 3.17 | `ReleaseLineDeletionHook`   | Release-line permanent-deletion impact list (before the rule-4 cascade)  |

ProofHound's entry credential system is divided into three categories by channel, mutually non-reusable and never parsing each other's credentials, corresponding to three parallel entry resolvers:

- **User token (API channel)**: a local admin app credential created by the user, **the same token is usable for both the HTTP API and MCP entries** → HTTP goes through `ActorContextResolver` (§3.2), MCP goes through `McpAuthResolver` (§3.3); in OSS both resolvers use `LocalUserTokenVerifier` for hash comparison / expiry validation, while `TokenService` (§3.5) owns CRUD for those user tokens. The plaintext uniformly carries the `ph_` prefix to distinguish it from the JWT form (see §3.2)
- **UI session credential (HTTP UI channel)**: the identity source of browser requests; in OSS it is a **trusted header injected by the deployment layer** (default `X-Forwarded-User`) or a LOCAL_ACTOR fallback. An override may instead carry a host-issued bearer credential (e.g. a JWT in `Authorization: Bearer eyJ*`). The OSS browser carries no application-layer token / cookie. It shares the same `ActorContextResolver` with the user token (internal branching within §3.2), but does not share credential storage—the UI session credential is not written to `ph_core.tokens`
- **Webhook token**: per-connector, generated once when the connector is created, scoped only to the corresponding connector's inbound → `ConnectorContextResolver` (§3.4); its lifecycle follows the connector and is not managed by `TokenService`

The three resolvers can each be overridden independently: integrating a host-issued bearer credential into the HTTP UI channel only replaces the internal JWT-verification branch of `ActorContextResolver` (the API-channel user-token path is preserved at the same time); an override of the MCP entry replaces `McpAuthResolver`; if the webhook entry switches to HMAC or multi-tenant isolation, only `ConnectorContextResolver` is replaced. Replacing any one does not affect the other two.

Current OSS state:

- The HTTP entry performs real validation: `HttpActorGuard` delegates to `ActorContextResolver`, which validates `Authorization: Bearer ph_*` against `ph_core.tokens scope='user'` (API channel) or reads the trusted deployment header / falls back to LOCAL_ACTOR (UI channel); the guard additionally resolves and attaches `request.projectContext` via `ProjectContextResolver`, read by the `@CurrentProject()` decorator
- The MCP entry serves a real Streamable-HTTP MCP server (see [09-mcp-server.md](09-mcp-server.md)) that validates the user token via `McpAuthResolver` before dispatching any tool
- The webhook entry validates inbound credentials via `ConnectorContextResolver` (extracted from the previously inline webhook auth); the error code `invalid_webhook_token` is distinguished from the user token failure code `invalid_user_token`

The three entry resolvers defined in this section serve a dual purpose: "completing real OSS validation" and "providing an adapter integration point". The OSS default implementations `LocalActorContextResolver` / `LocalMcpAuthResolver` / `LocalConnectorContextResolver` must perform real validation; they are not no-ops.

### 3.1 ProjectContextResolver

Resolves the actor + project hint from the user entry (HTTP / MCP) into a `ProjectContext`, **and validates whether the actor has permission to access that project**. The webhook entry does not go through this resolver—webhook credentials do not represent the project administrator; `ConnectorContextResolver` (§3.4) produces the ProjectContext directly.

| Item                 | OSS default                                             | Override (examples)                                                                                                                    |
| -------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `LocalProjectContextResolver`                           | a resolver returning a real, validated `ProjectContext`                                                                                |
| Behavior             | Always returns `LOCAL_PROJECT_CONTEXT`, no access check | resolves the real project from the actor + an explicit project hint (HTTP header / MCP metadata) and validates the actor's access      |
| Failure behavior     | Does not throw                                          | throws `ProjectAccessDeniedError` (the type OSS declares alongside the interface) when access is denied                                |

Contract draft:

```ts
export interface ProjectContextHint {
  projectId?: string; // trusted runtime/database boundary
  projectIdHeader?: string; // HTTP X-Project-Id
  mcpMetadata?: McpMetadataLike;
}

export abstract class ProjectContextResolver {
  abstract resolve(actor: ActorContext, hint?: ProjectContextHint): Promise<ProjectContext>;
}
```

Call entries:

- **HTTP Controller** invokes the resolver indirectly via the `@CurrentProject()` decorator
- **MCP channel** obtains the resolver via DI in `mcp-context.ts` and calls it explicitly
- **Webhook entry (core webhook runtime mounted by `apps/webhook`): does not call this resolver**. Webhook credentials do not represent the project administrator; `ConnectorContextResolver` (§3.4) produces the ProjectContext + ActorContext in one shot; under OSS the projectId is fixed to LOCAL, and after an override replaces the resolver the real projectId is determined by the connector configuration
- **DBOS workflow / BullMQ handler do not call the resolver**—the projectId has already been validated by the entry at enqueue time and written into the payload; inside the workflow only the payload is trusted
- **Release runner** may call the resolver with an internal `system_release_runner` actor and a trusted DB `projectId` hint to recover the already-authorized release event's `ProjectContext.orgId` for LLM payload attribution. Experiment / optimization recovery may do the same with an internal `system_workflow_recovery` actor when resuming an already-authorized running row after process restart. These are not per-tick user re-authorization; they are context hydration for background DB-row paths.

### 3.2 ActorContextResolver

Dedicated to the HTTP entry (core server Controllers mounted by the `apps/server` OSS shell): resolves the identity credential in the request into an `ActorContext`. The HTTP entry **carries two sources at the same time**—external API calls (script / CI / third party) and browser UI sessions—branched at the request layer by the same resolver. The MCP entry belongs to §3.3, the webhook entry to §3.4.

| Item                 | OSS default                                                                                                                                                                            | Override (examples)                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation class | `LocalActorContextResolver`                                                                                                                                                            | a resolver that verifies a host-issued UI credential                                                                                                                     |
| Credential source    | API channel: the user token parsed from `Authorization: Bearer ph_*`; UI channel: trusted deployment header (default `X-Forwarded-User`) or fallback to LOCAL_ACTOR when no credential | API channel may stay as-is (its own tokens can coexist with OSS user tokens in a different store); UI channel may carry a host-issued bearer credential (e.g. a JWT) verified offline |
| Returns              | API → `actorKind='script'`, `actorId`=tokenId; UI → `actorKind='local_user'`, `actorId`=`LOCAL_ACTOR_ID` (trusted header hit or fallback)                                              | API unchanged; UI → `actorKind='local_user'` with `actorId` from the host identity and any role / organization claims placed in `actor.claims`                            |

Contract draft:

```ts
export abstract class ActorContextResolver {
  abstract resolveFromHttp(req: HttpRequestLike): Promise<ActorContext>;
  abstract resolveFromUserToken(token: string): Promise<ActorContext>;
}
```

**Dual-channel branching at the HTTP request layer** (internal resolver logic, not exposed as a new abstract method):

```
1. Does Authorization: Bearer <X> exist?
   ├─ X starts with ph_ (opaque user token) → API channel, sha256 compare against ph_core.tokens scope='user'
   └─ X starts with eyJ and contains two . (JWT form) → OSS: 401 unsupported_credential (an override may verify a host-issued JWT here)
2. No Authorization, trusted deployment header hit?
   └─ Construct actorKind='local_user' (OSS, actorId=LOCAL_ACTOR_ID); an override that already took a step-1 bearer credential does not reach this branch
3. None → OSS: LOCAL_ACTOR fallback (an override may instead require a credential and return 401)
```

API tokens must adopt the `ph_` prefix to distinguish them from the JWT form—this is a convention, not an env configuration. The token generation side (`POST /tokens`) uniformly outputs plaintext with the `ph_` prefix; the resolver side **does not strip the prefix** before hash comparison (the prefix is part of the token entity and participates in the hash).

`ActorContext` is actually shaped like `{ actorId, actorKind, projectId? }` (`packages/core/src/server/common/actor-context.ts`). `actorKind` is a flat enum, **not** a colon-namespaced string—the specific id is held separately in `actorId`, not encoded into kind. The parts produced by the HTTP entry:

- `actorKind='script'`: the script actor corresponding to a user token under the API channel, `actorId`=token row id (common to OSS and any override)
- `actorKind='local_user'`: the user under the UI channel. Under OSS, `actorId`=`LOCAL_ACTOR_ID` (the trusted header hit and the LOCAL_ACTOR fallback share the same actorKind); an override may instead set `actorId` from its own identity and place role / organization in `actor.claims`

`actorKind='system_mcp'` / `actorKind='system_webhook'` are produced by §3.3 / §3.4 respectively and do not go through this resolver. `actorKind='system_release_runner'` and `actorKind='system_workflow_recovery'` are internal background actors used only to hydrate ProjectContext from a trusted DB project id.

OSS default implementation behavior (following the branching order above):

**API channel (`Authorization: Bearer ph_*`)**:

- Parse the header, strip the `Bearer ` prefix (malformed format → 401 `invalid_authorization_header`)
- sha256 hash the full token (including the `ph_` prefix), query `ph_core.tokens where scope='user' AND token_hash=? AND revoked_at IS NULL` (no match → 401 `invalid_user_token`)
- Validate `expires_at` (expired → 401 `expired_user_token`) and `ip_whitelist` (no match → 401 `ip_not_allowed`)
- Asynchronously touch `last_used_at` without blocking the response
- Construct `{ actorKind: 'script', actorId: tokenId }`

**JWT form (`Authorization: Bearer eyJ*`)**:

- OSS does not issue JWTs; on encountering one it returns 401 `unsupported_credential`
- Do not introduce a JWT verification library / JWKS client on the OSS side—this is an override's exclusive path

**UI channel (no `Authorization`)**:

- Read `req.headers[trustedUserHeader]` (`trustedUserHeader` comes from env `PH_TRUSTED_USER_HEADER`, default `X-Forwarded-User`)
- Non-empty → `{ actorKind: 'local_user', actorId: LOCAL_ACTOR_ID }` (trusted header hit; formation B)
- Empty → fall back to LOCAL_ACTOR: `{ actorKind: 'local_user', actorId: LOCAL_ACTOR_ID }` (formation A)

The OSS browser **does not carry** `Authorization` and **does not carry** a session cookie; the actual identity source of the UI channel is the deployment layer (a reverse proxy injecting a trusted header) or the single-machine local LOCAL_ACTOR fallback. The OSS has no built-in login page / session store / password storage / CSRF protection (no browser cookie, so the attack surface does not exist).

`ActorContext` shape stability constraints (actual type `{ actorId, actorKind, projectId? }`):

- Adding an `ActorContext` field in OSS is treated as a breaking change
- The two `local_user` sources—trusted-header and LOCAL_ACTOR fallback—are not distinguished (in the OSS single workspace both are the local owner; there is currently no `sourceLabel` field; add an optional field later if auditing the formation A/B difference is needed)
- Additional claims (org id, roles) that an override attaches to the actor go into the `actor.claims` sub-object
- OSS business code does not read `actor.claims`

#### 3.2.1 Deployment formations A / B / C

The OSS supports two deployment formations and does not support a third:

| Formation                                                 | Deployment scenario                                                                                                                                                                                                           | UI channel credential                                  | Audience                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| **A. Local / intranet single user**                       | docker-compose running on a laptop / intranet machine, accessed only by yourself or a trusted network                                                                                                                         | None (LOCAL_ACTOR fallback)                            | OSS default formation; ZiqiXiao single-person project scenario      |
| **B. Reverse proxy + SSO**                                | Deployed on the public internet, fronted by oauth2-proxy / Cloudflare Access / Tailscale Serve / Authelia / nginx auth_request, etc., with the proxy completing authentication and injecting a trusted header to the upstream | Trusted deployment header (default `X-Forwarded-User`) | Team / public shared access                                         |
| **C. Public internet direct + no proxy + built-in login** | Exposed to the public internet with no reverse proxy, expecting the OSS to ship its own login page + session system                                                                                                           | —                                                      | **Not supported**. The requester should choose formation B |

The trusted header name for formation B is overridden by the env `PH_TRUSTED_USER_HEADER`; default names for mainstream reverse proxies for reference:

| Reverse proxy     | Default header                       |
| ----------------- | ------------------------------------ |
| oauth2-proxy      | `X-Auth-Request-User`                |
| Cloudflare Access | `Cf-Access-Authenticated-User-Email` |
| Tailscale Serve   | `Tailscale-User-Login`               |
| Authelia          | `Remote-User`                        |

Reasons for not supporting formation C: a built-in login system requires subsystems such as a login page / password storage / session store / CSRF protection / password reset / email sending, which is a scope explosion for a single-workspace OSS; the security responsibility of a public deployment is more reasonably borne by the reverse proxy (formation B), consistent with the common pattern of single-service OSS such as Prometheus / AlertManager. When a requester insists on formation C, guide them to choose formation B (the login concern is then owned by the reverse proxy or an external host shell).

### 3.3 McpAuthResolver

Dedicated to the MCP channel (`packages/core/src/server/channels/mcp/`): resolves the user token carried in the MCP request metadata into an `ActorContext`. **Independent of `ActorContextResolver`**—although under OSS the HTTP / MCP entries share the same user token resource pool, the two entries are handled by independent resolvers, and an override can replace them separately (e.g. the HTTP UI channel takes a host-issued JWT while MCP still uses static tokens).

| Item                 | OSS default                                                                       | Override (examples)                                 |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Implementation class | `LocalMcpAuthResolver`                                                            | a resolver accepting a host-issued MCP credential        |
| Credential source    | The user token in the MCP request metadata (same resource pool as the HTTP entry) | a host-issued credential in MCP metadata                 |
| Returns              | actor UUID + `actorKind='system_mcp'`                                             | actor UUID + any host claims (e.g. organization / role)  |

Contract draft:

```ts
export abstract class McpAuthResolver {
  abstract resolveFromMcp(metadata: McpRequestMetadataLike): Promise<ActorContext>;
  abstract resolveFromUserToken(token: string): Promise<ActorContext>;
}
```

`ActorContext` `actorKind` (the part produced by the MCP entry):

- `actorKind='system_mcp'`: the system actor corresponding to a user token under the MCP entry, `actorId`=token row id

OSS default implementation behavior:

- Extract the token from the MCP metadata (the exact extraction path is determined by the actual MCP SDK form, confirmed at PR implementation time)
- Take the token from the MCP metadata (missing → `missing_user_token`)
- After sha256 hash, query `ph_core.tokens where scope='user' AND token_hash=? AND revoked_at IS NULL` (no match → `invalid_user_token`)
- Validate `expires_at` (expired → `expired_user_token`) and `ip_whitelist`
- Asynchronously touch `last_used_at`
- Construct `{ actorKind: 'system_mcp', actorId: tokenId }`

Current OSS state: the MCP channel serves a real Streamable-HTTP MCP server (see [09-mcp-server.md](09-mcp-server.md)); `LocalMcpAuthResolver` validates the user token from the request `Authorization` header before any tool is dispatched.

Override constraints:

- An override may accept a different MCP credential (e.g. a host-issued token or JWT), but must still return the same `ActorContext` shape
- When an override customizes the actor `actorKind`, name it with a `system_` prefix (e.g. `system_org_mcp`, with extra ids placed in `actorId` / `claims`) to avoid overlap with user / script

### 3.4 ConnectorContextResolver

Dedicated to the core webhook entry runtime mounted by `apps/webhook`: resolves `(:webhookSlug, :pathName) + webhook token` into a connector context, then produces a `ProjectContext` and a system actor. **Independent of `ActorContextResolver` (§3.2) / `McpAuthResolver` (§3.3)**; the credential systems are not reused.

| Item                 | OSS default                                                                                                               | Override (examples)                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Implementation class | `LocalConnectorContextResolver`                                                                                           | a resolver with custom webhook auth                                      |
| Binding module       | `LocalContractsModule` (the implementation lives in the webhook runtime because it depends on `WebhookRepository`)        | the override's own `contracts` module                                    |
| Credential source    | `ph_core.tokens where scope='webhook' AND connector_id=?` (stored as sha256 hash; row-level association to the connector) | Same as OSS, or additional HMAC signature / multi-tenant isolation       |
| Returns              | `{ connector, projectContext, actorContext }`, actor `actorKind='system_webhook'` (connectorId placed in `actorId`)       | Same structure, projectContext determined by the connector configuration |

Contract draft:

```ts
export interface ConnectorResolveResult {
  connector: ConnectorRecord;
  projectContext: ProjectContext;
  actorContext: ActorContext; // actorKind='system_webhook', actorId=connectorId
}

export abstract class ConnectorContextResolver {
  abstract resolveFromWebhookToken(
    webhookSlug: string,
    pathName: string,
    token: string,
  ): Promise<ConnectorResolveResult>;
}
```

Entry constraints:

- Inbound requests locate the connector by `(:webhookSlug, :pathName)`; not found → 404
- Validate the token; failure → 401 `invalid_webhook_token` (distinguished from the user token failure code `invalid_user_token`)
- The resolution result directly produces the ProjectContext / ActorContext and **no longer goes through** `ActorContextResolver` / `McpAuthResolver`
- The subsequently dispatched BullMQ job and the actor written into `ph_runs.run_results` are both `actorKind='system_webhook'` (connectorId in `actorId`)
- Idempotent deduplication uses the `externalId` in the request body as the key, handled by the business layer; the resolver is unaware of it

Credential / resource boundary:

- Webhook tokens are physically stored as `ph_core.tokens` rows (`scope='webhook'`, `connector_id` non-null), associated with the connector via the `connector_id` foreign key
- **The same connector supports multiple webhook tokens coexisting in steady state**, used for per-consumer distribution: one webhook entry can issue different tokens to multiple consumers, with call statistics and auditing done per token
- Credential lifecycle is **managed as part of the connector resource**: the first webhook token is generated when the connector is created; deleting a connector cascade-deletes its tokens; adding / revoking tokens goes through the connector-dimension API; it is **not** managed by `TokenService` (§3.5)
- `TokenService` CRUD only handles `scope='user'` and neither reads nor writes `scope='webhook'` rows
- **There is no built-in grace period / background cleanup cron**: rotation is performed by the user themselves ("create new token + revoke old token"), with timing under the user's control; `expires_at` is a security upper bound actively set by the user (e.g. "this token expires in 90 days"), and expired token rows are **retained** for auditing and manual revocation
- The `name` field has a max length of 64 characters (landed via the `tokens_name_length_check` CHECK constraint); no description field is introduced (name is sufficient to identify the per-consumer purpose)
- The goal of the resource boundary design: webhook tokens coexist with user tokens in the physical table (for unified auditing / indexing / hash uniqueness), but their lifecycle, override path, and scope validation semantics are completely independent

Usage statistics per token:

- The `ph_runs.run_results` table adds `webhook_token_id uuid NULL` (FK → `ph_core.tokens.id`, ON DELETE SET NULL), filled only by calls triggered by the webhook entry; the HTTP / MCP entries write NULL
- The BullMQ job payload carries `webhookTokenId` (optional field); the worker passes it through when writing the run_result
- `ActorContext` only contains `actorKind='system_webhook'` (connectorId placed in `actorId`), without encoding tokenId into actorKind—the tokenId is materialized into the run_result column and does not rely on parsing the actor field
- The monitoring / connector detail page can GROUP BY `webhook_token_id` to aggregate call count, success rate, and last call time, for per-consumer usage observation

### 3.5 TokenService

CRUD for user tokens. **Current state**: `TokenService` is an abstract-class DI token exported from `@proofhound/core/contracts`; the OSS default `LocalTokenService` only handles `scope='user'`. The token→`ActorContext` validation (hash comparison / expiry) is **not in this service**, but split into `LocalUserTokenVerifier`, reused by `ActorContextResolver` (§3.2) / `McpAuthResolver` (§3.3).

| Item                 | OSS default                                                                                                                   | Override (examples)                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Implementation class | Abstract `TokenService` + OSS default `LocalTokenService`, bound in `LocalContractsModule`                                    | an override bound in the override's own `contracts` module                                                  |
| Data source          | The `ph_core.tokens` table (only `scope='user'` rows)                                                                         | the override's own token table                                                                              |
| Behavior             | Local admin app user token CRUD (the same token is usable for HTTP API + MCP); validation handled by `LocalUserTokenVerifier` | the override's own token CRUD; validation handled by its `ActorContextResolver` / `McpAuthResolver`         |

Contract draft:

```ts
// Validation lives in LocalUserTokenVerifier (token → ActorContext), not on TokenService.
export abstract class TokenService {
  abstract listUserTokens(actor: CurrentUserPayload): Promise<ListUserTokensResponseDto>;
  abstract createUserToken(
    input: CreateUserTokenDto,
    actor: CurrentUserPayload,
    source?: 'api' | 'mcp',
  ): Promise<CreateUserTokenResponseDto>;
  abstract updateUserToken(
    tokenId: string,
    input: UpdateUserTokenDto,
    actor: CurrentUserPayload,
    source?: 'api' | 'mcp',
  ): Promise<UpdateUserTokenResponseDto>;
  abstract revealUserToken(
    tokenId: string,
    actor: CurrentUserPayload,
    source?: 'api' | 'mcp',
  ): Promise<RevealUserTokenResponseDto>;
  abstract deleteUserToken(
    tokenId: string,
    actor: CurrentUserPayload,
    source?: 'api' | 'mcp',
  ): Promise<DeleteUserTokenResponseDto>;
}
```

OSS default / override semantics:

- The OSS default implementation reads and writes `ph_core.tokens`, but only acts on `scope='user'` rows
- An override may read and write its own token table; in that case the OSS `ph_core.tokens` **does not write user rows** (the table structure is retained; `scope='webhook'` rows are still read and written by the connector resource)
- `TokenModule` only declares the HTTP controller; it does **not** bind `{ provide: TokenService, useClass: LocalTokenService }`. This prevents the feature module from shadowing the `contracts` module and ensures HTTP `/tokens` and MCP token tools both see the edition-supplied provider.
- An override does not need a feature flag or env branch in OSS code—simply bind `TokenService` in the `contracts` module passed to `ProofHoundServerModule.forRoot({ contracts })`

Webhook tokens (`scope='webhook'`) are **not** managed by this service; see §3.4. When an override replaces `TokenService` it does not affect the webhook entry; to replace the webhook integration, only override `ConnectorContextResolver`.

### 3.6 AccessControlService

Decides whether `actor + project + action` is allowed.

| Item                 | OSS default                                                                                                                                                               | Override (examples)                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Implementation class | Abstract `AccessControlService` + OSS default `LocalAccessControlService` (`packages/core/src/server/common/contracts/`), DI-bound in `LocalContractsModule` | a membership / role-based check                   |
| Behavior             | `system_*` + `local_user` all pass; `script` passes but is forbidden `platform_manage` (to prevent token privilege escalation); everything else forbidden    | checks based on the actor's membership + role     |

Contract draft:

```ts
// AccessAction + the toActorContext() normalizer live in
// packages/core/src/server/common/access-control.ts; the seam lives in common/contracts/.
export type AccessAction =
  | 'project_read'
  | 'project_write'
  | 'release_manage'
  | 'platform_manage'
  | 'user_token_manage'
  | 'mcp_tool';

export abstract class AccessControlService {
  abstract assertCan(actor: ActorContext, project: ProjectContext, action: AccessAction): Promise<void>;
}
// OSS default LocalAccessControlService applies the actorKind rules below and ignores `project`;
// an override binds its own check to the same token in its `contracts` module.
```

Signature constraints:

- Services inject `AccessControlService` and call `await this.accessControl.assertCan(toActorContext(actor), project, action)`; the old directly-imported `accessControl` singleton is removed.
- Three parameters `(actor, project, action)`, async; the OSS implementation ignores actor/project beyond `actorKind`, but an override must read them. Platform-level actions (e.g. `user_token_manage`) that are not project-scoped pass the actor-derived local project (`actor.projectId ? { projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT`).
- `mcp_tool` is a channel-level gate: the MCP transport/context factory calls it once after resolving the actor + project and before SDK tool dispatch. The called Service still performs its normal business action check, so an override can deny the MCP channel independently without losing project/read/write/release granularity.
- `AccessAction` is a 6-value coarse-grained enum; it may be refined later if an override's access model needs it, but without coupling to roles or resource ids.
- An actor with `actorKind='system_webhook'` passes everything by default under OSS; an override may define "which actions a connector inbound may perform" (generally limited to channel actions, such as writing run results)

### 3.7 LimiterKeyStrategy

Generates rate limit keys.

| Item                 | OSS default               | Override (examples)                               |
| -------------------- | ------------------------- | ---------------------------------------------- |
| Implementation class | `LocalLimiterKeyStrategy` | a broader-scoped strategy                                              |
| Key composition      | `model:<modelId>`         | e.g. `<scope>:model:<modelId>` to isolate counting per tenant / group |

Realized contract:

```ts
export abstract class LimiterKeyStrategy {
  // Keyed by (project, modelId). Runtime LLM/probe callers build the key before invoking llm-client;
  // actor is intentionally NOT part of the key — rate limits are per-project (org) + model, never per-actor.
  abstract buildModelKey(project: ProjectContext, modelId: string): string;
}
```

Caller constraints:

- The internals of `packages/limiter` are unaware of project, remaining a pure key/value counter; its public arg is renamed `modelId`→`key` so the caller supplies the composed key
- Runtime callers assemble the key via the strategy and thread it as an OPAQUE `limiterKey` string through `@proofhound/llm-client` to the limiter (`@proofhound/llm-client` stays project-unaware, §6). This includes the BullMQ LLM runner (`payload.projectId + modelId`), model connectivity probes, prompt try-run, and optimization analysis/generation calls.
- `packages/optimization-strategy` receives `analysisLimiterKey` from the core runtime and passes it to `invokeLLM`; it must not reconstruct `model:<modelId>` internally.
- `ProjectContext` carries an optional, override-only `orgId`. The enqueue / launch side seeds it from the resolved project context and threads it through the worker LLM / probe job payloads, release runner LLM payloads, the experiment / optimization workflow inputs, and the synchronous probe / prompt try-run / optimization analysis-generation paths, so a broader-scoped strategy can read `project.orgId` to compose a wider key without re-querying. OSS leaves it undefined and `LocalLimiterKeyStrategy` ignores it.
- Queued model probes also call `RuntimeLimitsProvider` in the worker before `testModelConnectivity`; a model-level RPM / TPM of `-1` does not bypass a positive runtime / deployment cap.
- Server-side and worker callers obtain `LimiterKeyStrategy` from the `contracts` module supplied to their runtime root. Worker assembly must not bind `LocalLimiterKeyStrategy` directly, otherwise an override cannot replace it consistently through the same `forRoot({ contracts })` seam.
- The source of the rate limit quota configuration (RPM / TPM / concurrency cap) is also indirectly determined by the strategy when overridden (the key prefix determines the counting space)
- The autostate of auto-concurrency (latency / token EWMA + backoff multiplier) is also per-key state, reusing the same key counting space (`model:<modelId>:autostate` under OSS); changing the key prefix in the strategy naturally isolates it, and the `LimiterKeyStrategy` contract stays unchanged

### 3.8 WorkflowAuthorizationHook

When a DBOS workflow / BullMQ job starts, validates whether the actor may start a workflow on that projectId.

| Item                 | OSS default                              | Override (examples)                                                                            |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Implementation class | `LocalWorkflowAuthorizationHook` (no-op) | a role-aware hook                                                                           |
| Behavior             | Passes directly                          | validates whether the actor's role on that project allows starting that workflow / job type |

Realized contract:

```ts
export type WorkflowKind = 'experiment' | 'optimization' | 'release' | 'llm' | 'probe';

export abstract class WorkflowAuthorizationHook {
  abstract assertCanStart(actor: ActorContext, project: ProjectContext, workflow: WorkflowKind): Promise<void>;
}
```

Entry constraints:

- **Core server Services**: every Service method that starts a workflow / enqueues a job calls the hook once before writing the payload. Direct connectivity probes that run synchronously still call the hook with the resolved ProjectContext, including `orgId` when present, before invoking the probe driver / LLM client because they are the current OSS execution path for the `probe` workflow kind.
- **Release entries**: production release submission and canary release creation / resume call the hook with `workflow='release'` before writing a new `running` release event or resuming a stopped canary. The hook receives the resolved ProjectContext, including `orgId` when present. The in-server release runner does not re-authorize each tick; it only hydrates project context for background LLM payload org attribution and trusts that running release events were authorized at the user entry.
- **Core webhook runtime**: the webhook ingress calls the hook before enqueuing the BullMQ job; the actor is `actorKind='system_webhook'` and the project is the ProjectContext returned by `ConnectorContextResolver`
- The projectId inside the payload is **not** re-authorized on the worker / runner side—once a payload is written it is considered already authorized
- This is the only boundary in the OSS trunk where "trusting the entry authentication" is allowed; the worker / runner do not hold an actor

### 3.9 HttpActorGuard

The `@UseGuards()` entry shell of the HTTP Controller. Nest registers the class in the `@UseGuards(HttpActorGuard)` metadata directly as an enhancer injectable, so `HttpActorGuard` cannot be merely an abstract DI token—it must be an executable base class. The guard itself does not parse credentials; it only takes on three things: "declaring a stable entry at the Controller decorator layer, calling `ActorContextResolver.resolveFromHttp`, and attaching the result to `request.user`". An override usually only needs to replace §3.2; if it genuinely needs to replace guard behavior (e.g. adding tenant scope injection or cross-origin session handling), it must ensure the `HttpActorGuard` base class referenced in the Controller metadata can still execute and delegate to the corresponding resolver / context adapter.

| Item                 | OSS default                                                                                                                                                                      | Override (examples)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | The `HttpActorGuard` executable base class, used directly by OSS (no separate subclass, and not registered as a provider; routes auto-instantiate it from `@UseGuards` metadata) | Reuse `HttpActorGuard` + replace `ActorContextResolver`; the guard class itself is **not** replaced via provider override (the Controller metadata references `HttpActorGuard`, and `overrideProvider(HttpActorGuard)` cannot swap out the route guard); when a guard-layer extension is needed (tenant context injection, etc.), it is borne by the collaborator the base class delegates to (the resolver / a future added hook) |
| Responsibility       | Calls `ActorContextResolver.resolveFromHttp(req)` → adapts to `CurrentUserPayload` → attaches `request.user`                                                                     | Same as OSS; can additionally attach host-specific context (e.g. org claims, tenant context)                                                                                                                                                                                                                                                                                                                                       |
| Failure behavior     | Does not swallow the error when the resolver throws 401; the guard itself does not throw                                                                                         | Same as OSS                                                                                                                                                                                                                                                                                                                                                                                                                        |

Contract draft:

```ts
@Injectable()
export class HttpActorGuard implements CanActivate {
  constructor(private readonly resolver: ActorContextResolver) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const actor = await this.resolver.resolveFromHttp(req);
    req.user = toCurrentUserPayload(actor);
    return true;
  }
}
```

The unified Controller-side form:

```ts
@UseGuards(HttpActorGuard)
export class XxxController { ... }
```

The Controller directly uses `@UseGuards(HttpActorGuard)`. `HttpActorGuard` is **not registered as a provider in `ContractsModule`**—the route execution chain auto-instantiates it from the class reference in the `@UseGuards` metadata (resolving through the module's injectables set rather than the provider token, so a provider override cannot replace the guard in the metadata, hence it must be an executable base class). The guard's sole constructor dependency `ActorContextResolver` is provided by the global `ContractsModule`; its DB dependency chain (`LocalActorContextResolver → LocalUserTokenVerifier`) is encapsulated inside `ContractsModule`, so feature modules **do not need** to import `DatabaseModule` for the guard. An override replacing authentication only replaces `ActorContextResolver`. This is also why regression tests need to cover real HTTP routes.

### 3.10 RuntimeLimitsProvider

Folds deployment-level runtime caps into a call's per-call RPM / TPM / concurrency limits — e.g. a per-tenant concurrency ceiling. It carries **no** billing semantics: it only translates an already-resolved `ProjectContext` (+ model id / source) into an optional `RuntimeLimits` override. The BullMQ LLM worker (`llm-runner`) invokes it once per job, just before taking `min(merged caps, model-level quota)` (SPEC 21 §quota), so queued job sources (experiment, optimization child experiments, release, webhook) are capped uniformly at the worker enforcement point. Synchronous LLM callers (`prompt_try_run`, `probe`, `optimization_analysis`, `optimization_generate`) invoke the same provider before calling `@proofhound/llm-client`, then apply the same `min(merged caps, model-level quota)` rule. The model-level cap remains the hard ceiling in all paths.

| Item                 | OSS default                                                                       | Override (examples)                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `LocalRuntimeLimitsProvider`                                                      | a cap-aware provider                                                                                                       |
| Behavior             | Pass-through: returns the caller's `limits` unchanged (no plan / quota awareness) | reads the resolved `project.orgId` to look up a cap and lower `concurrency` (and optionally RPM / TPM) to that ceiling      |

Realized contract:

```ts
export interface RuntimeLimitsInput {
  project: ProjectContext;
  modelId: string;
  source: string; // LLM source or synchronous caller tag
  limits?: RuntimeLimits;
}

export abstract class RuntimeLimitsProvider {
  abstract mergeLlmLimits(input: RuntimeLimitsInput): Promise<RuntimeLimits | undefined>;
}
```

Caller constraints:

- The provider is invoked by core runtime callers before invoking or enqueueing LLM work, never inside `@proofhound/limiter` or `@proofhound/llm-client`; those stay project-unaware (§6).
- The OSS `LocalRuntimeLimitsProvider` MUST be a genuine pass-through so OSS behavior is byte-identical; the hook exists only so an override can clamp limits without forking the workflow. Together with `project.orgId` (§3.7) it lets an override both isolate the rate-limit bucket and cap its concurrency.
- This hook only sets the per-call ceiling fed into the existing `min(limits, model quota)` logic; it does **not** implement a whole-org shared concurrency pool (that would require a second limiter gate and is out of scope here).

### 3.11 QuotaPolicyHook

Validates a quota policy at the exact write / execution points that are otherwise deep inside OSS business flows. This hook carries no billing model in OSS: it receives project context, actor context when available, an operation source, and best-effort incoming byte estimates. OSS local behavior is a no-op.

| Item                 | OSS default                | Override (examples)                                                                                                      |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `LocalQuotaPolicyHook`     | a quota-enforcing hook                                                                                            |
| Storage behavior     | Pass-through               | checks a storage quota before dataset uploads / import batches and run-result writes                              |
| Execution behavior   | Runs the callback directly | optionally gates / reserves an execution slot around LLM and probe calls, using a distributed limiter when needed |

Realized contract:

```ts
export type StorageQuotaSource = 'dataset_upload' | 'dataset_import' | 'dataset_import_batch' | 'run_result';

export interface StorageQuotaInput {
  project: ProjectContext;
  source: StorageQuotaSource;
  actor?: ActorContext;
  bytes?: number; // best-effort incoming write size
}

export interface ExecutionSlotInput {
  project: ProjectContext;
  source: string;
  modelId?: string;
  requestId?: string;
}

export abstract class QuotaPolicyHook {
  abstract assertCanStore(input: StorageQuotaInput): Promise<void>;
  abstract withExecutionSlot<T>(input: ExecutionSlotInput, run: () => Promise<T>): Promise<T>;
}
```

Caller constraints:

- Dataset creation and dataset import session / batch append call `assertCanStore` before writing rows or objects. The byte estimate is intentionally best-effort and exists to prevent obvious limit overshoots; the authoritative used value remains database/object-storage usage aggregation.
- Run-result writers call `assertCanStore` before inserting immutable run results. This covers worker LLM results and synchronous server-side LLM/probe result paths without making the `ph_runs` schema aware of plans.
- LLM and model-probe runners wrap the actual provider call in `withExecutionSlot`. OSS local mode runs the callback directly; an override may use the hook to enforce broader execution-slot admission in addition to the existing per-model limiter.
- This hook must not introduce organizations, plan tables, or billing branches into OSS. Override semantics live in the replacement implementation and use `ProjectContext.orgId` or an override-side project-to-org lookup.

### 3.12 UsageMeteringHook

Emits immutable domain usage events when business facts happen. The hook is intentionally observation-only: OSS emits generic events with project / actor / source context, and the default implementation is no-op. It carries no organization, billing, plan, tenant, or hosted-edition semantics in OSS.

| Item                 | OSS default                  | Override (examples)                                                                                                                                  |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `NoopUsageMeteringHook`      | an event-persisting hook bound in the override's `contracts` module                                                                          |
| Behavior             | Best-effort no-op            | persist idempotent events with bounded O(1) writes, resolve project-to-org inside the override, and mark usage read models dirty as needed    |
| Failure behavior     | Never blocks the caller path | replacement implementations may throw, but OSS callers must wrap the hook so failures are logged and swallowed                               |

Realized contract:

```ts
export type UsageMeteringDimension = 'project' | 'job' | 'run_result' | 'release' | 'storage' | 'concurrency' | 'model';

export interface UsageMeteringEvent {
  idempotencyKey: string;
  dimension: UsageMeteringDimension;
  eventType: string;
  projectId: string;
  actorId?: string | null;
  occurredAt: Date;
  source: 'server' | 'worker' | 'workflow' | 'release-runner';
  payload?: Record<string, unknown>;
}

export abstract class UsageMeteringHook {
  abstract record(event: UsageMeteringEvent): Promise<void>;
}
```

Caller constraints:

- Events are emitted after the corresponding business fact has been accepted or written. The hook is not a transaction boundary in OSS; if a future event must commit atomically with a business write, add a real outbox in a later SPEC change.
- Every event must include a stable `idempotencyKey` derived from the business fact, for example `run_result:<runResultId>:created`, `job:<queue>:<jobId>:<attempt>:<eventType>`, or `model:<modelId>:<eventType>:<updatedAt>`.
- `UsageMeteringHook.record()` is called on request, worker, workflow, and release-runner hot paths. Replacement implementations must be bounded/O(1): append the idempotent event, optionally mark a coarse project/dimension dirty key, and return.
- Replacement implementations must not synchronously aggregate `ph_runs.run_results`, storage/object detail rows, release detail tables, model read models, or other high-cardinality tables from `record()`. Dirty recompute, read-model refresh, and rollups must run asynchronously in batched workers.
- A dirty key means "batch this project/dimension later"; it does not authorize immediate in-hook recompute. Override dirty processors should coalesce by project/dimension/window, use touched-project or time-window filters, and run full scans only in low-frequency reconciliation jobs.
- For idempotent override event stores, dirty marking should happen only when the event insert actually wins. Duplicate hook calls caused by retries must not create additional dirty churn.
- High-volume events such as `run_result.created` carry enough payload (`status`, token counts, cost estimate, latency, source ids) for incremental rollups. Full detail-table scans are reserved for hourly/daily reconciliation over touched projects, bounded time windows, or shards.
- Hook failures are best-effort only. Callers must use the safe wrapper around `UsageMeteringHook.record()` and log a warning without changing the original success / failure behavior.
- OSS emits only `projectId` and optional flat `actorId`; an override resolves any organization or billing ownership inside the replacement hook by looking up the project. OSS event payloads must not include organization, plan, billing, tenant, quota tier, or control-plane fields.
- Current emitters cover worker job lifecycle (`job.started` / `job.completed` / `job.attempt_failed` / `job.failed` / `job.rate_limited`), immutable run-result creation (`run_result.created`), release line / event / run attachment facts, dataset and import dirty facts, and model configuration changes. These events are generic domain observations; the OSS UI does not expose a usage ledger or billing page.

### 3.13 DatasetUploadService

How an uploaded dataset file is received, parsed, staged, and promoted. The OSS default is a single synchronous path: `multipart/form-data` → Multer `diskStorage` temp file → server stream-parse → staging → atomic promote into `dataset_samples` (inline DB) → temp file deleted (see [22 §3.1.1](22-datasets.md#311-the-oss-upload-path-single-synchronous)).

| Item           | OSS default                  | Override                                            |
| -------------- | ---------------------------- | --------------------------------------------------- |
| Implementation | OSS Multer-synchronous upload | a custom upload / import strategy                   |
| Bound in       | `LocalContractsModule`       | the override's `contracts` module                   |

OSS contract points that keep it replaceable:

- The import is exposed as **composable, independently-callable units** (parse-to-staging, promote-staging-to-DB) so an alternative implementation can reuse them and wrap its own steps around them. OSS does **not** ship a post-import hook — extension is by composition.
- The **frontend counterpart** is a swappable dataset upload component slot wired through `WebContracts` (§4): OSS provides the multipart uploader + preview / field-mapping wizard; the rest of the dataset upload screen is reused.
- This replaces a previously code-only, never-documented `ObjectStorageProvider`, which is **removed from the OSS trunk** — OSS no longer contains any object-storage mechanism.
- Run-result payloads are stored and read **inline** from their rows with no read seam. Dataset-sample reads instead go through the §3.14 `DatasetSampleRepository` (OSS default: inline), so an external storage layer integrates by replacing **both** the write side here and the §3.14 read side, reusing the OSS execution / preview / export paths instead of forking them. OSS export streams directly from the API (no signed-URL redirect).

### 3.14 DatasetSampleRepository

How dataset sample rows are read back: for execution rendering (experiment / optimization), for the detail-page preview / search / category distribution, and for export. The OSS default `LocalDatasetSampleRepository` reads samples **inline** from `ph_assets.dataset_samples.data` via Drizzle; it consolidates what were previously scattered inline reads across the experiment workflow, the optimization repository, and the dataset repository into one place — a DRY/maintainability win independent of any override.

| Item           | OSS default                                                          | Override                                                                       |
| -------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Implementation | `LocalDatasetSampleRepository` (inline Drizzle read of `data`)       | a repository that hydrates each sample's payload from external storage         |
| Bound in       | `LocalContractsModule`                                               | the override's `contracts` module                                             |

Contract shape (neutral — no object-storage / payload-ref / offload concept leaks into OSS):

- Input is `(projectId, datasetId, sampleIds | keyset cursor)`; output is sample rows `{ id, data }`. The override decides internally whether `data` is already inline or must be loaded from elsewhere; the OSS interface never names a storage backend.
- **The worker is not a consumer.** The experiment workflow reads sample `data` on the server side at render time (via this repository), renders the prompt, and enqueues the already-rendered prompt into BullMQ; the worker never touches `dataset_samples`. The read seam is therefore server-side only.
- **OSS schema is unchanged**: no `payload_ref` / offload columns. An override that offloads payloads owns its own schema extension and read implementation entirely on its side; OSS stores and reads `data` inline.
- Search (`data::text ILIKE`) and category-profiling (`data ->> <field>`) SQL aggregations are exposed as overridable methods on the same repository, so an override that offloads the entire payload can replace them too; the OSS default keeps them as inline SQL.

This is the dataset-sample counterpart to the §3.13 write-side adapter: §3.13 owns how samples are written / promoted, §3.14 owns how they are read back. (Run-result payloads keep no read seam — see §3.13.)

### 3.15–3.17 Permanent-deletion impact hooks

CLAUDE.md §5 rule 4 fixes the permanent-deletion flow: **run the deletion hook first to list the affected resources, surface that list in OSS, then cascade-delete.** Each of the three deletable parent resources owns one hook that computes the impact list:

| No.  | Hook                       | OSS default (`Local*`)                               | Impact list it returns                                                |
| ---- | -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| 3.15 | `DatasetDeletionHook`      | inline impact query via `DatasetRepository`          | affected experiments + optimizations                                 |
| 3.16 | `PromptDeletionHook`       | inline impact query via `PromptRepository`           | affected release lines + experiments + optimizations (prompt shell or a single version) |
| 3.17 | `ReleaseLineDeletionHook`  | inline impact query via `ReleaseLineRepository`       | affected events + versions + annotation tasks + run-result count     |

| Item           | OSS default            | Override                                              |
| -------------- | ---------------------- | ----------------------------------------------------- |
| Implementation | `Local*DeletionHook` (inline impact query) | a hook that computes the impact set against a wider resource graph |
| Bound in       | `LocalContractsModule` | the override's `contracts` module                     |

Contract points that keep them replaceable while keeping the cascade as fixed OSS logic:

- The hook computes **only the impact list** — what the OSS UI lists before the user confirms a permanent deletion. The cascade delete itself stays in the Service (`DatasetService` / `PromptService` / `ReleaseLineService`) and is fixed rule-4 OSS semantics, **not** part of the seam. An override widens what counts as "affected" without forking the cascade.
- They are bound in `LocalContractsModule` (not in their feature module) for the same reason as §3.13 / §3.14: a feature-module binding would shadow the global one and make `forRoot({ contracts })` unable to replace it. The `Local*` impl's only dependency is its feature repository (a stateless `DATABASE_CLIENT` wrapper), provided privately in the contracts module — the same pattern as `WebhookRepository` serving `LocalConnectorContextResolver`.
- OSS ships a single inline implementation in active use on every permanent-deletion path; the seam exists so a host that deletes against a wider resource graph (e.g. references the OSS single-project boundary does not model) can substitute its own impact computation, reusing the OSS cascade and confirmation UI unchanged.

## 4. Frontend reuse strategy

The frontend reuse mechanism mirrors the backend `@proofhound/core` + `ProofHoundServerModule.forRoot({ contracts })` pattern: the OSS product UI is extracted into a shared package `@proofhound/web-ui`, and each app becomes a thin shell that wires the shared package through a single `<ProofHoundWebProvider contracts={WebContracts}>` entry point.

### 4.0 Package architecture

```
packages/
  ui/            # Pure design system (atomic primitives + cn() + Main layout primitive)
  web-ui/        # Shared product UI (screens / hooks / components / i18n / providers / lib / contracts)
apps/web/        # OSS thin shell: route wrappers + chrome (AppShell / sidebar / header) + contracts wiring
host apps/web/   # external host shell: its own chrome (e.g. nav / project switcher) + the same @proofhound/web-ui/screens
```

Dependency direction: `@proofhound/ui` (zero business) ← `@proofhound/web-ui` (depends on ui + api-client + shared) ← `apps/web` (thin shell). `deps:check` (madge) must have no new circular dependencies.

`@proofhound/web-ui` subpath exports:

| Subpath                                 | Contents                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@proofhound/web-ui/screens`            | Product resource screens (`DatasetsListScreen`, `PromptDetailScreen`, …) + dashboard page                    |
| `@proofhound/web-ui/hooks`              | Domain hooks (signatures unchanged, still accept `projectId`) + utility hooks                                |
| `@proofhound/web-ui/providers`          | `ProofHoundWebProvider`, underlying Refine / ProjectContext / Navigation / I18n providers (`useResolveHref`) |
| `@proofhound/web-ui/i18n`               | Full dictionary + `I18nProvider` / `useI18n` + language utilities                                            |
| `@proofhound/web-ui/components`         | 12 product-domain components + charts + annotation sub-components                                            |
| `@proofhound/web-ui/lib`                | `formatDateTime` / `getApiErrorMessage` / `releases` / `project-name` / `uuid` / `model-*` domain utilities  |
| `@proofhound/web-ui/contracts`          | `WebContracts` type + `localWebContracts`                                                                    |
| `@proofhound/web-ui/styles/globals.css` | Theme CSS variables / semantic classes / animation keyframes                                                 |

### 4.1 ProjectId transport

A multi-project host backend must know the `projectId` of the current request.

**Adopted approach: HTTP `X-Project-Id` header.**

Reasons:

- OSS routes are currently all `/<resource>` (e.g. `/prompts`, `/datasets`), without a project prefix; changing them to path-based `/projects/:projectId/<resource>` would require changing 96 client calls and all Controller routes, with no benefit on the OSS side
- The OSS backend `LocalProjectContextResolver` simply ignores the header, with no behavior change
- An override's `ProjectContextResolver` reads the projectId from the header and validates it against the actor
- The `httpClient` interceptor registered by `ProofHoundWebProvider` (via `configureApiClient`) injects the `projectId` from the current `ProjectContextSource` into the header at startup; before `ProofHoundWebProvider` mounts, the `httpClient` has no interceptor

Implementation constraints:

- All methods of `packages/api-client` retain the existing `(projectId: string, ...)` parameter signature
- The first parameter `projectId` serves two purposes at once: React Query cache key boundary + source of the `X-Project-Id` header
- Adding the header at the HTTP layer is handled uniformly by the `httpClient` interceptor registered by `configureApiClient`; business clients do not set the header directly
- The OSS backend does not enforce the presence of the header; an override enforces it within the resolver
- The MCP entry's project hint goes through MCP metadata, not reusing the HTTP header
- The webhook entry does not carry `X-Project-Id`; the project is looked up by `ConnectorContextResolver` from the connector configuration (§3.4)

Not adopted:

| Approach                                     | Reason for not adopting                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| path-based `/projects/:projectId/<resource>` | Large change; no value on the OSS side; header + React Query cache key is already enough for multi-project switching |
| subdomain `<projectId>.example.com`          | High deployment complexity; troublesome cookie domain management; unfriendly multi-project switching interaction     |
| URL query string `?projectId=...`            | Easy to omit; the frontend must append the parameter on every request; inconsistent with RESTful conventions        |

### 4.2 Auth credential transport

The OSS browser **does not actively carry any auth credential** (sends no `Authorization`, sends no session cookie); a host shell's browser may carry a bearer token in `Authorization: Bearer`. To allow the shared product UI in `@proofhound/web-ui` to remain unchanged across deployments, `packages/api-client` exposes an `AuthSource` abstraction; the OSS default implementation returns `null`, and an override returns a real token.

`AuthSource` is part of `WebContracts` and is wired at the single `ProofHoundWebProvider` entry point—OSS passes `localWebContracts` (which carries `LocalAuthSource`); an override passes its own `AuthSource`. The provider calls `configureApiClient({ authSource, getProjectId, baseUrl })` on mount (in a client effect), which registers the axios request interceptor for both `Authorization` and `X-Project-Id`; screens and hooks in `@proofhound/web-ui` never touch `AuthSource` directly.

Realized contract (`packages/api-client`):

```ts
// packages/api-client/src/auth-source.ts
export abstract class AuthSource {
  /** Returns a Bearer token, or null. OSS returns null (browser carries no credential). */
  abstract getToken(): Promise<string | null>;
}

// OSS default
export class LocalAuthSource extends AuthSource {
  async getToken(): Promise<string | null> {
    return null; // OSS browser does not send Authorization
  }
}

// Injected by an external host shell
export class HostAuthSource extends AuthSource {
  constructor(private auth: HostAuthClient) {
    super();
  }
  async getToken(): Promise<string | null> {
    // returns a real bearer token from the host's auth SDK / session
    return this.auth.getAccessToken();
  }
}
```

The `configureApiClient` call inside `ProofHoundWebProvider` registers one request interceptor (idempotent—a re-config ejects the prior one):

```ts
// packages/api-client/src/configure.ts  (called once by ProofHoundWebProvider in a client effect)
export interface ApiClientConfig {
  authSource: AuthSource;
  getProjectId: () => string; // OSS: () => LOCAL_PROJECT_CONTEXT.projectId; an override: () => current project id
  baseUrl?: string;
}
export function configureApiClient(config: ApiClientConfig): void {
  if (config.baseUrl) httpClient.defaults.baseURL = config.baseUrl;
  // (ejects any previously-registered interceptor first, so re-config does not stack)
  httpClient.interceptors.request.use(async (req) => {
    const token = await config.authSource.getToken();
    if (token) req.headers.set('Authorization', `Bearer ${token}`);
    const pid = config.getProjectId();
    if (pid) req.headers.set('X-Project-Id', pid);
    return req;
  });
}
```

`WebContracts` type and OSS default:

```ts
// @proofhound/web-ui/contracts
export interface WebContracts {
  authSource: AuthSource; // OSS: LocalAuthSource (getToken()→null)
  projectContext: ProjectContext; // OSS: constant LOCAL_PROJECT_CONTEXT. An override: a reactive multi-tenant source is a future extension.
  baseUrl?: string; // default: NEXT_PUBLIC_SERVER_URL → localhost:4000
  webhookBaseUrl?: string; // optional webhook deployment origin for connector call examples. A host injects the webhook service URL; OSS omits it and keeps a placeholder.
  i18nExtend?: Partial<Record<Language, Record<string, string>>>; // host-supplied extra keys
  resolveHref?: (href: string) => string; // OSS: omitted (identity). An override: scopes flat product paths to its own route prefix (§4.3)
}

export const localWebContracts: WebContracts = {
  authSource: new LocalAuthSource(),
  projectContext: LOCAL_PROJECT_CONTEXT,
};
```

`ProofHoundWebProvider` usage — RSC boundary rules (realized in OSS `apps/web`):

`WebContracts.authSource` is a **class instance** (`LocalAuthSource`), which React Server Components cannot pass across the server→client prop boundary. The root `layout.tsx` is an async Server Component, so it must NOT pass `contracts` directly to the client `ProofHoundWebProvider`. Wrap it in a `'use client'` module that owns the contracts; the layout passes only serializable data (`defaultLanguage: string`) + `children`:

```tsx
// apps/web/src/app/providers.tsx  ('use client')
'use client';
import { ProofHoundWebProvider } from '@proofhound/web-ui/providers';
import { localWebContracts } from '@proofhound/web-ui/contracts';
import { type Language } from '@proofhound/web-ui/i18n/language';
export function Providers({ defaultLanguage, children }: { defaultLanguage: Language; children: ReactNode }) {
  return (
    <ProofHoundWebProvider contracts={localWebContracts} defaultLanguage={defaultLanguage}>
      {children}
    </ProofHoundWebProvider>
  );
}

// apps/web/src/app/layout.tsx  (async Server Component)
// server-safe language utils come from the non-'use client' subpath @proofhound/web-ui/i18n/language
import { resolveAcceptLanguageHeader } from '@proofhound/web-ui/i18n/language';
import { Providers } from './providers';
const defaultLanguage = resolveAcceptLanguageHeader((await headers()).get('accept-language'));
<Providers defaultLanguage={defaultLanguage}>
  {children}
  {/* route wrappers import @proofhound/web-ui/screens */}
</Providers>;
```

Two boundary rules a consuming app (OSS or an external host) must follow: (1) server code calls server-safe i18n utils (e.g. `resolveAcceptLanguageHeader`) from `@proofhound/web-ui/i18n/language` (NOT the `'use client'` `@proofhound/web-ui/i18n` barrel); (2) the class-instance `contracts` is constructed/held behind a `'use client'` boundary, never passed as a prop from a Server Component. Also: the consuming app must register the shared package sources for Tailwind (`@proofhound/web-ui/styles/globals.css` carries `@source` directives for `@proofhound/web-ui` + `@proofhound/ui`; the app's own chrome is auto-detected) so responsive utility classes in the shared components are not purged.

An override passes `{ authSource: <host auth source>, projectContext: <reactive multi-tenant source>, i18nExtend: <host console dict> }`. Most product UI screens and hooks in `@proofhound/web-ui` are identical in both cases, with the contracts injection point as the default difference.

Upload strategy pages are the exception: `/datasets/new` may be host-owned at the route level. The OSS route uses the shared conservative upload page (Uppy source selection + client-driven dataset import batches). A host app may mount its own page for multipart/resumable/provider-specific upload, quota presentation, and progress modeling, then call the stable dataset import / commit primitives. The shared OSS upload page must not grow edition flags, hosted-provider branches, or host-only progress states to support those needs.

Implementation constraints:

- `AuthSource` and `ProjectContextSource` are consumed only by `configureApiClient` inside `ProofHoundWebProvider`; screens / hooks / components in `@proofhound/web-ui` never read them directly
- The OSS `LocalAuthSource` always returns `null`—the browser not carrying a credential is an OSS design requirement, not a bug
- An override injects its own `AuthSource`, with the host's auth SDK managing the access token and refresh
- The browser side **does not** use the user token (`ph_*`) as a session—the user token is only for external scripts / CI / MCP clients to copy-paste, and never goes into localStorage / sessionStorage
- When an external script calls the HTTP API, the caller sets `Authorization: Bearer ph_*` itself, without going through `AuthSource`
- The MCP entry's credential does not go through this abstraction—the MCP client config directly holds the user token
- The project switcher UI is **host-only private chrome** and does not belong in `@proofhound/web-ui`; the OSS thin shell and the shared package both do not build a project switcher (see §6)

Not adopted:

| Approach                                                                                                   | Reason for not adopting                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| OSS shipping a cookie session + login page                                                                 | A single-workspace OSS does not need a login system; see the rejection reasoning for formation C in §3.2.1          |
| OSS injecting the user token into the browser localStorage as a session                                    | XSS exposes a long-lived credential; conflicts with OWASP's "API keys are not appropriate for authenticating users" |
| Forcing `httpClient` to always set the `Authorization` header under OSS too (e.g. sending an empty string) | Increases the risk of the backend resolver misjudging; the OSS browser silently not sending is a cleaner contract   |
| Keeping product UI inside `apps/web/src` without extraction                                                | An external host cannot import `apps/web/src`; physical package extraction is the prerequisite for reuse            |

### 4.3 Navigation href resolution

`@proofhound/web-ui` screens navigate to flat product paths — `<Link href="/models/new">`, `router.push('/releases/new')`, and a single post-delete hard reload `window.location.href = '/connectors'`. OSS serves screens at exactly those flat paths, so this is correct as-is. A hosting shell whose routes live under a different prefix — e.g. serving the same screens under `/app/.../<resource>` — needs every one of those hrefs rewritten to its scoped route, in a single navigation hop (no bounce through the flat path first).

**Adopted approach: a host-injected `resolveHref` consumed by in-package navigation wrappers.**

`WebContracts.resolveHref?: (href: string) => string` defaults to identity. `ProofHoundWebProvider` feeds it into a `NavigationProvider` (a React context exposing `useResolveHref()`). `@proofhound/web-ui` ships two thin wrappers that every screen uses instead of the Next primitives:

- `components/navigation/link` — wraps `next/link`, rewriting a string `href` through `resolveHref` **at render time**, so the rendered `<a href>` is already the host's real route.
- `hooks/use-router` — wraps `next/navigation`'s `useRouter`, routing `push` / `replace` / `prefetch` destinations through `resolveHref`; `back` / `forward` / `refresh` (no href) pass through.

A `no-restricted-imports` ESLint rule scoped to `packages/web-ui/src/**` bans direct `next/link` and the `useRouter` named import from `next/navigation`, so new screens cannot bypass the seam; the two wrapper modules are the only sanctioned consumers (inline opt-out). A screen performing a hard navigation calls `useResolveHref()` directly.

Why render-time rewrite (not a host-side click interceptor): because the wrapper sets the resolved href on the DOM node, right-click "copy link", open-in-new-tab, middle-click, and hover prefetch all target the correct URL — none of which a click-time `preventDefault` + reroute can fix, since it leaves the DOM `href` pointing at the flat path.

Contract requirements for an injected resolver:

- **Idempotent / no-op on hrefs it does not own** (already-scoped paths, cross-origin URLs, hash-only fragments, `mailto:`). The wrappers render scoped hrefs onto the DOM, and a screen-level click guard (e.g. the prompt-detail unsaved-changes guard) reads an anchor's already-rendered href and re-feeds it into `router.push` — so the resolver must see an already-scoped path and return it unchanged rather than scope it twice.
- Orthogonal to §4.1: this scopes the **browser-visible route**, not the API call. The HTTP API stays flat `/<resource>` + `X-Project-Id` header regardless; `resolveHref` never touches request URLs.

OSS omits `resolveHref` (identity), so `<Link>` / `useRouter` behave exactly as the bare Next primitives. An override injects a resolver that maps a flat product path to its own scoped route from the active scope, and as a result the host shell needs no click-time navigation interception.

Not adopted:

| Approach                                                  | Reason for not adopting                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host-side capture-phase click interceptor rewriting `<a>` | Cannot rewrite the DOM `href`, so copy-link / new-tab / prefetch stay wrong; cannot catch imperative `router.push` / `window.location` at all                    |
| Next.js `rewrites` / `basePath` / middleware              | `basePath` is static (no dynamic per-scope segments); rewrites hide the canonical URL (the scope lives in the URL); neither fixes the client-side `push` target  |
| Passing the host's whole router/Link in through contracts | Coarser and leaks routing mechanics across the boundary; a pure `resolveHref` function lets OSS keep owning prefetch / scroll / App Router semantics             |

## 5. Schema boundary

The OSS trunk database schema does not concede to any external control plane:

- The `project_id` column of OSS business tables is retained, and participates only in the single `LOCAL_PROJECT_ID` data
- OSS does **not** add an `organization_id` column
- OSS does **not** add control plane tables such as `memberships` / `roles` / `audit_log`
- OSS does **not** add control-plane-only fields such as `organization_id` / role / membership to `ph_core.tokens`
- A control-plane consumer builds `organizations` / `memberships` / `project_memberships` / `roles` / `audit_log`, etc., in a separate schema (the prefix is up to that consumer, e.g. `cp_*`)
- An external consumer associates with OSS business tables by joining via `project_id`; the OSS schema exposes no foreign key outward
- Such a consumer decides the many-to-many / one-to-many relationship between organization and project; OSS makes no assumptions

The `scope` dimension of `ph_core.tokens`:

- OSS maintains two scopes: `user` (the local admin app credential shared by HTTP API + MCP) and `webhook` (per-connector inbound)
- A `scope='webhook'` row must fill in `connector_id` (FK → `ph_assets.connectors`), indicating that the token is part of the connector resource
- `scope='user'` rows are CRUD-managed by `TokenService` (§3.5); `webhook` rows are CRUD-managed by the connector service, which TokenService neither reads nor writes
- When `TokenService` is overridden, `user` rows **do not write data** (carried by the override's own token table); `webhook` rows are **still written by the OSS default connector service** (an override of the webhook entry is done only at the `ConnectorContextResolver` layer, without touching connector resource management)
- The `name` field has a max length of 64 characters (CHECK constraint)

`ph_core.tokens.expires_at` / `revoked_at` semantics:

- `expires_at` is set actively by the user (nullable), serving as the token's security expiry upper bound
- `revoked_at` is filled when the user actively revokes, taking effect immediately
- There is no background cleanup cron; expired / revoked token rows are **retained** (for FK references from `ph_runs.run_results.webhook_token_id` and audit traceability)
- The resolver query condition is uniformly `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`

Webhook entry attribution of `ph_runs.run_results`:

- The table adds `webhook_token_id uuid NULL` (FK → `ph_core.tokens.id` ON DELETE SET NULL), filled only by calls triggered by the webhook entry
- Used for per-consumer usage statistics per token; the HTTP / MCP entries write NULL
- Deleting a webhook token does **not** cascade-delete run_results rows (audit integrity requires it)

The OSS schema change principles remain unchanged ([06](06-database-schema.md)): `ph_*` prefix, Drizzle migration, PostgreSQL-first.

## 6. Things you shouldn't do

- Do not introduce organizations / memberships / roles business implementations into the OSS trunk
- Do not add an `organization_id` column or control plane tables to the OSS schema
- Do not add control-plane-only fields such as `organization_id` / membership / role to `ph_core.tokens`
- Do not make `apps/server`, `apps/webhook`, or `apps/worker` library entry points; reusable backend runtime belongs in `packages/core` and is exported as `@proofhound/core`
- Do not add app-level barrels as a shortcut for external reuse
- Do not build a project switcher or organization switcher in the OSS frontend or in the shared `@proofhound/web-ui` package—the project switcher is host-only private chrome that belongs in an external host's app shell, not in the shared product UI
- Do not introduce an `IS_PLATFORM`-style edition flag anywhere in the OSS trunk or in `@proofhound/web-ui` to distinguish deployment forms within the same codebase (an in-codebase edition flag tends to cause long-term technical debt that is hard to refactor out later); in the shared package the single `WebContracts` injection at `ProofHoundWebProvider` is the default variation point, and upload-strategy pages such as `/datasets/new` may instead be replaced by the host route without adding host-only branches to shared screens
- Do not let OSS Controllers / Services directly import default implementation classes—import only the abstract class (i.e. the DI token)
- Do not make foundational packages such as `packages/limiter` / `packages/llm-client` / `packages/connector-client` aware of actor / project
- Do not write form branches in OSS code via env vars such as `process.env.DEPLOYMENT_MODE='saas'`—the form difference is borne by provider override
- Do not read `actor.claims` in OSS business code—claims is an override-only extension slot
- Do not let `TokenService` read or write `scope='webhook'` rows, nor let `ConnectorContextResolver` read or write `scope='user'` rows; the physical table is shared but the scope boundary is strictly separated
- Do not call `ActorContextResolver` or `McpAuthResolver` inside the webhook entry resolver; the three entry resolvers never call each other
- Do not validate the actor's project access at the webhook entry—the webhook credential is a per-consumer channel credential, not the project administrator; the webhook entry produces the ProjectContext directly via `ConnectorContextResolver`, without going through `ProjectContextResolver`'s access check
- Do not introduce a built-in grace period / background cleanup cron for webhook tokens—multiple tokens are a per-consumer steady-state semantic, and rotation is performed by the user autonomously ("create new token + revoke old token"), with expired / revoked rows retained for auditing
- Do not build a login page / password storage / session store / CSRF protection into OSS—a single-workspace OSS does not need a login system, and the UI channel identity is borne by deployment formation A (LOCAL_ACTOR fallback) or B (reverse proxy trusted header); see §3.2.1
- Do not put the user token (`ph_*`) into the browser localStorage / sessionStorage / cookie as a session credential—the user token is an "API key" in the OWASP sense, unsuitable as a user identity credential, with a very high risk of XSS exposing a long-lived credential; the browser UI session credential system and the user token system are **strictly separated**
- Do not let the OSS `LocalActorContextResolver` introduce a JWT verification library / JWKS client—the JWT form is an override's exclusive path, and OSS always returns 401 `unsupported_credential` when it encounters a JWT
- Do not set an empty-string `Authorization` header by default on the OSS browser side—the OSS browser silently not sending `Authorization` is the contract of the `AuthSource` abstraction; do not actively send an empty header for the sake of "format uniformity"

## 7. Relationship to other SPECs

- [00](00-overview.md): this SPEC is an expansion of 00's "thin abstractions / future external control plane integration"
- [02](02-tech-stack.md): this SPEC introduces no new tech stack, only specifying the use of existing NestJS DI and axios interceptors
- [03](03-orchestration.md): §3.8 `WorkflowAuthorizationHook` of this SPEC is a new pre-step for the 03 orchestration entry; the complete `WorkflowKind` enum is governed by 03's workflow / queue list; the webhook entry paragraph at the end of 03 §3 aligns with §3.4 `ConnectorContextResolver` of this SPEC
- [06](06-database-schema.md): §5 of this SPEC makes clear that an external consumer's schema does not enter `ph_*`; the `scope='webhook'` + `connector_id` fields and the user / webhook scope binary introduced by this SPEC are reflected in the `ph_core.tokens` table structure in 06 §3.2
- [07](07-code-structure.md): reusable backend runtime is extracted to `packages/core`; the abstract classes and default implementations of the extension points are exported from `@proofhound/core/contracts`; shared Nest infra used to compose runtime modules is exported from `@proofhound/core/infra`; the MCP / Controller entries go through the `@CurrentProject()` decorator; the frontend package layout (`@proofhound/ui` design system, `@proofhound/web-ui` shared product UI, `apps/web` OSS thin shell) is governed by §7 of that SPEC
- [26](26-connectors.md): §3.4 `ConnectorContextResolver` of this SPEC is extracted from the existing connector authentication logic of the webhook runtime, with the credential lifecycle managed by the connector resource
