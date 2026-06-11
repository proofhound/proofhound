# 08 · Control plane adapter boundary

This document describes the boundary between the open-source self-hosted edition and the future SaaS / control plane edition: which replaceable abstraction points (adapter extension points) the OSS trunk provides, the contract of each extension point, and how the SaaS repository overrides the default implementations.

> The control plane / SaaS edition is implemented in a separate repository. This SPEC only constrains the OSS trunk side—the OSS must provide extension points that are stable and thin enough that the SaaS repository can depend on OSS packages and override the default implementations without forking or patching OSS source.

> Consistent with section 7 "Things you shouldn't do #1" in CLAUDE.md / AGENTS.md: this SPEC does not introduce any control plane business (organizations / memberships / roles / project switcher, etc.) into the OSS trunk.

## 1. Roles

| Repository                          | Role                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `proofhound` (OSS, this repository) | Business implementation packaged through `@proofhound/core` + adapter extension points + local default implementations + OSS process shells                  |
| Separate SaaS repository            | Depends on OSS packages (`@proofhound/core` and foundational `@proofhound/*` packages), overrides extension points, adds multi-tenant control plane business |

The OSS trunk must always run standalone in a "local single project + default implementation" form; the SaaS repository does not exist in this repository, nor does this repository carry an edition branch.

Form reference: this design follows the "open-core + adapter override" pattern (close to GitLab CE/EE, Sentry SaaS), distinct from Supabase's "multi-instance + outer orchestration" pattern. Both forms have their trade-offs; ProofHound chose adapter override based on a realistic judgment about team size and a single-tenant shared business codebase.

## 2. Core package and adapter injection mechanism

The reusable backend runtime is exported from `packages/core` as `@proofhound/core`. `apps/server`, `apps/webhook`, and `apps/worker` are OSS process shells only; they are not library entry points, and the SaaS repository must not import them through deep paths or app-level barrels.

During local development the SaaS repository may consume the OSS packages through a workspace link, local tarballs, or a local registry. The import surface must still be the same package exports used by npm distribution, for example `@proofhound/core/server` and `@proofhound/core/contracts`; local source paths under `apps/*` are never the integration contract.

The OSS must guarantee the following contracts:

- Public exports of `@proofhound/core` and other `packages/*` packages are stable; any breaking export change is treated as a breaking change
- `@proofhound/core` declares dependencies on the foundational OSS packages it uses (`@proofhound/shared`, `@proofhound/db`, `@proofhound/logger`, etc.) instead of bundling duplicate copies of them into one artifact
- `@proofhound/core` exposes stable subpaths for the reusable runtime:
  - `@proofhound/core/server`: `ProofHoundServerModule.forRoot({ contracts })`
  - `@proofhound/core/webhook`: `ProofHoundWebhookModule`
  - `@proofhound/core/worker`: `ProofHoundWorkerModule`
  - `@proofhound/core/contracts`: abstract-class DI tokens and OSS local defaults
  - `@proofhound/core/infra`: shared Nest infra modules/services required to compose an OSS or SaaS `contracts` module without deep-importing `packages/core/src/*`
- All extension points are injected via DI tokens (abstract class); internal OSS code never hard-imports the concrete classes of the default implementations
- The core server module is assembled as a dynamic module via `ProofHoundServerModule.forRoot({ contracts })`. The `contracts` argument is a `@Global` module that binds every extension-point token to a concrete implementation: the OSS shell passes `LocalContractsModule` (the `Local*` defaults), a SaaS shell passes its own `SaasContractsModule` (the `Remote*` implementations). Assembly-time injection through `forRoot` is the **production** mechanism for replacing extension points; OSS business code never learns which `contracts` module was supplied, and no edition flag is introduced (cf. §8)
- `overrideProvider` (`Test.createTestingModule(...).overrideProvider(X)`) is reserved strictly as a **test-time** replacement primitive—`@nestjs/testing` must never enter the production bundle. Production form differences are carried solely by the `contracts` module handed to `forRoot`, not by `overrideProvider`
- App-level barrels are not an accepted integration mechanism. If runtime code must be shared, it belongs in `packages/core` and is exported by `@proofhound/core`, not by `apps/server/src/index.ts` or equivalent.

DI tokens uniformly use abstract class form (e.g. `ProjectContextResolver`), not Symbol—cross-package shared Symbol token behavior is unstable. The `contracts` module passed to each runtime root's `forRoot({ contracts })` is the only edition-variable input, keeping OSS↔SaaS to a single assembly-time seam rather than a runtime branch. Any concrete local default, repository, or shared infra module that the SaaS repository needs to assemble that module must be exposed through a stable `@proofhound/core/*` subpath; SaaS must not deep-import `packages/core/src/*`.

> Current state (2026-06): PR0 has landed — the reusable runtime lives in `packages/core` (`@proofhound/core`, internal layout `src/{shared,server,webhook,worker}`) and the OSS apps are thin process shells consuming it; `ProofHoundServerModule.forRoot({ contracts })`, `ProofHoundWebhookModule.forRoot({ contracts })`, and `ProofHoundWorkerModule.forRoot({ contracts })` are wired in the three OSS process shells. `@proofhound/core` is currently a **workspace-internal TS-source package** (`private: true`, `main`/`exports` point at `src/`, consumed via source like the other `@proofhound/*` packages — its `tsc` `dist/` is not the integration artifact and nothing consumes it yet). A formal published / tarball package build is a **separate future step**, not required for the workspace-link / local-tarball / local-registry consumption noted above. As of 2026-06 all twelve extension points (§3.1–§3.12) have landed: each is an abstract-class DI token with an OSS `Local*` or no-op default. The extension-point tokens are bound in the `contracts` module supplied to each runtime root (OSS: `LocalContractsModule`, SaaS: `SaasContractsModule`); feature modules consume those providers and do not bind local defaults that would shadow them. The shared infra and local-default building blocks needed by an external contracts module are exported from `@proofhound/core/infra` and `@proofhound/core/contracts`, respectively. The remaining exception is `HttpActorGuard` (§3.9), an executable base class instantiated from `@UseGuards` metadata rather than a provider.

## 3. Extension point list

The OSS trunk must land the following 12 extension points. Each extension point requires: interface (abstract class) + OSS default implementation + Nest module registration.

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

ProofHound's entry credential system is divided into three categories by channel, mutually non-reusable and never parsing each other's credentials, corresponding to three parallel entry resolvers:

- **User token (API channel)**: a local admin app credential created by the user, **the same token is usable for both the HTTP API and MCP entries** → HTTP goes through `ActorContextResolver` (§3.2), MCP goes through `McpAuthResolver` (§3.3); in OSS both resolvers use `LocalUserTokenVerifier` for hash comparison / expiry validation, while `TokenService` (§3.5) owns CRUD for those user tokens. The plaintext uniformly carries the `ph_` prefix to distinguish it from the JWT form (see §3.2)
- **UI session credential (HTTP UI channel)**: the identity source of browser requests; in the OSS form it is a **trusted header injected by the deployment layer** (default `X-Forwarded-User`) or a LOCAL_ACTOR fallback; in the SaaS form it is a **Supabase JWT** (`Authorization: Bearer eyJ*`). The OSS browser carries no application-layer token / cookie. It shares the same `ActorContextResolver` with the user token (internal branching within §3.2), but does not share credential storage—the UI session credential is not written to `ph_core.tokens`
- **Webhook token**: per-connector, generated once when the connector is created, scoped only to the corresponding connector's inbound → `ConnectorContextResolver` (§3.4); its lifecycle follows the connector and is not managed by `TokenService`

The three resolvers can each be overridden independently: in the SaaS form, integrating a Supabase JWT into the HTTP UI channel only replaces the internal JWT verification branch of `ActorContextResolver` (the API channel user token path is preserved at the same time); SaaS authentication of the MCP entry replaces `McpAuthResolver`; if the webhook entry switches to HMAC or multi-tenant isolation, only `ConnectorContextResolver` is replaced. Replacing any one does not affect the other two.

Current OSS state (2026-06):

- The HTTP entry performs real validation: `HttpActorGuard` delegates to `ActorContextResolver`, which validates `Authorization: Bearer ph_*` against `ph_core.tokens scope='user'` (API channel) or reads the trusted deployment header / falls back to LOCAL_ACTOR (UI channel); the guard additionally resolves and attaches `request.projectContext` via `ProjectContextResolver`, read by the `@CurrentProject()` decorator
- The MCP entry serves a real Streamable-HTTP MCP server (see [09-mcp-server.md](09-mcp-server.md)) that validates the user token via `McpAuthResolver` before dispatching any tool
- The webhook entry validates inbound credentials via `ConnectorContextResolver` (extracted from the previously inline webhook auth); the error code `invalid_webhook_token` is distinguished from the user token failure code `invalid_user_token`

The three entry resolvers defined in this section serve a dual purpose: "completing real OSS validation" and "providing a SaaS adapter integration point". The OSS default implementations `LocalActorContextResolver` / `LocalMcpAuthResolver` / `LocalConnectorContextResolver` must perform real validation; they are not no-ops.

### 3.1 ProjectContextResolver

Resolves the actor + project hint from the user entry (HTTP / MCP) into a `ProjectContext`, **and validates whether the actor has permission to access that project**. The webhook entry does not go through this resolver—webhook credentials do not represent the project administrator; `ConnectorContextResolver` (§3.4) produces the ProjectContext directly.

| Item                 | OSS default                                             | SaaS expectation                                                                                                                                                              |
| -------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `LocalProjectContextResolver`                           | `RemoteProjectContextResolver` (in the SaaS repository)                                                                                                                       |
| Behavior             | Always returns `LOCAL_PROJECT_CONTEXT`, no access check | Reads the actor's current organization and explicit project hint (HTTP header / MCP metadata), validates the actor's access to the project, returns the real `ProjectContext` |
| Failure behavior     | Does not throw                                          | Throws `ProjectAccessDeniedError` (the OSS declares this error type alongside the interface)                                                                                  |

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
- **Webhook entry (core webhook runtime mounted by `apps/webhook`): does not call this resolver**. Webhook credentials do not represent the project administrator; `ConnectorContextResolver` (§3.4) produces the ProjectContext + ActorContext in one shot; under OSS the projectId is fixed to LOCAL, and after the SaaS replaces the resolver the real projectId is determined by the connector configuration
- **DBOS workflow / BullMQ handler do not call the resolver**—the projectId has already been validated by the entry at enqueue time and written into the payload; inside the workflow only the payload is trusted
- **Release runner** may call the resolver with an internal `system_release_runner` actor and a trusted DB `projectId` hint to recover the already-authorized release event's `ProjectContext.orgId` for LLM payload attribution. Experiment / optimization recovery may do the same with an internal `system_workflow_recovery` actor when resuming an already-authorized running row after process restart. These are not per-tick user re-authorization; they are context hydration for background DB-row paths.

### 3.2 ActorContextResolver

Dedicated to the HTTP entry (core server Controllers mounted by the `apps/server` OSS shell): resolves the identity credential in the request into an `ActorContext`. The HTTP entry **carries two sources at the same time**—external API calls (script / CI / third party) and browser UI sessions—branched at the request layer by the same resolver. The MCP entry belongs to §3.3, the webhook entry to §3.4.

| Item                 | OSS default                                                                                                                                                                            | SaaS expectation                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation class | `LocalActorContextResolver`                                                                                                                                                            | `RemoteActorContextResolver` (in the SaaS repository)                                                                                                                    |
| Credential source    | API channel: the user token parsed from `Authorization: Bearer ph_*`; UI channel: trusted deployment header (default `X-Forwarded-User`) or fallback to LOCAL_ACTOR when no credential | API channel: same as OSS (OSS user tokens and SaaS self-managed tokens coexist in different stores); UI channel: `Authorization: Bearer <Supabase JWT>` verified offline |
| Returns              | API → `actorKind='script'`, `actorId`=tokenId; UI → `actorKind='local_user'`, `actorId`=`LOCAL_ACTOR_ID` (trusted header hit or fallback)                                              | API → same as OSS; UI → `actorKind='local_user'`, `actorId`=Supabase `sub` + `actor.claims` (role / org)                                                                 |

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
   └─ X starts with eyJ and contains two . (JWT form) → OSS: 401 unsupported_credential; SaaS: JWT verified offline
2. No Authorization, trusted deployment header hit?
   └─ Construct actorKind='local_user' (OSS, actorId=LOCAL_ACTOR_ID); SaaS does not take this branch, UI credential already in step 1
3. None → OSS: LOCAL_ACTOR fallback; SaaS: 401
```

API tokens must adopt the `ph_` prefix to distinguish them from the JWT form—this is a convention, not an env configuration. The token generation side (`POST /tokens`) uniformly outputs plaintext with the `ph_` prefix; the resolver side **does not strip the prefix** before hash comparison (the prefix is part of the token entity and participates in the hash).

`ActorContext` is actually shaped like `{ actorId, actorKind, projectId? }` (`packages/core/src/server/common/actor-context.ts`). `actorKind` is a flat enum, **not** a colon-namespaced string—the specific id is held separately in `actorId`, not encoded into kind. The parts produced by the HTTP entry:

- `actorKind='script'`: the script actor corresponding to a user token under the API channel, `actorId`=token row id (common to OSS / SaaS)
- `actorKind='local_user'`: the user under the UI channel. Under OSS, `actorId`=`LOCAL_ACTOR_ID` (the trusted header hit and the LOCAL_ACTOR fallback share the same actorKind); under SaaS, `actorId`=Supabase `sub`, with role/org placed in `actor.claims`

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
- Do not introduce a JWT verification library / JWKS client on the OSS side—this is the SaaS adapter's exclusive path

**UI channel (no `Authorization`)**:

- Read `req.headers[trustedUserHeader]` (`trustedUserHeader` comes from env `PH_TRUSTED_USER_HEADER`, default `X-Forwarded-User`)
- Non-empty → `{ actorKind: 'local_user', actorId: LOCAL_ACTOR_ID }` (trusted header hit; formation B)
- Empty → fall back to LOCAL_ACTOR: `{ actorKind: 'local_user', actorId: LOCAL_ACTOR_ID }` (formation A)

The OSS browser **does not carry** `Authorization` and **does not carry** a session cookie; the actual identity source of the UI channel is the deployment layer (a reverse proxy injecting a trusted header) or the single-machine local LOCAL_ACTOR fallback. The OSS has no built-in login page / session store / password storage / CSRF protection (no browser cookie, so the attack surface does not exist).

`ActorContext` shape stability constraints (actual type `{ actorId, actorKind, projectId? }`):

- Adding an `ActorContext` field in OSS is treated as a breaking change
- The two `local_user` sources—trusted-header and LOCAL_ACTOR fallback—are not distinguished (in the OSS single workspace both are the local owner; there is currently no `sourceLabel` field; add an optional field later if auditing the formation A/B difference is needed)
- Additional claims (org id, roles) that SaaS attaches to the actor go into the `actor.claims` sub-object
- OSS business code does not read `actor.claims`

#### 3.2.1 Deployment formations A / B / C

The OSS supports two deployment formations and does not support a third:

| Formation                                                 | Deployment scenario                                                                                                                                                                                                           | UI channel credential                                  | Audience                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| **A. Local / intranet single user**                       | docker-compose running on a laptop / intranet machine, accessed only by yourself or a trusted network                                                                                                                         | None (LOCAL_ACTOR fallback)                            | OSS default formation; ZiqiXiao single-person project scenario      |
| **B. Reverse proxy + SSO**                                | Deployed on the public internet, fronted by oauth2-proxy / Cloudflare Access / Tailscale Serve / Authelia / nginx auth_request, etc., with the proxy completing authentication and injecting a trusted header to the upstream | Trusted deployment header (default `X-Forwarded-User`) | Team / public shared access                                         |
| **C. Public internet direct + no proxy + built-in login** | Exposed to the public internet with no reverse proxy, expecting the OSS to ship its own login page + session system                                                                                                           | —                                                      | **Not supported**. The requester should upgrade to SaaS or choose B |

The trusted header name for formation B is overridden by the env `PH_TRUSTED_USER_HEADER`; default names for mainstream reverse proxies for reference:

| Reverse proxy     | Default header                       |
| ----------------- | ------------------------------------ |
| oauth2-proxy      | `X-Auth-Request-User`                |
| Cloudflare Access | `Cf-Access-Authenticated-User-Email` |
| Tailscale Serve   | `Tailscale-User-Login`               |
| Authelia          | `Remote-User`                        |

Reasons for not supporting formation C: a built-in login system requires subsystems such as a login page / password storage / session store / CSRF protection / password reset / email sending, which is a scope explosion for a single-workspace OSS; the security responsibility of a public deployment is more reasonably borne by the reverse proxy (formation B), consistent with the common pattern of single-service OSS such as Prometheus / AlertManager. When a requester insists on formation C, guide them to choose formation B or SaaS.

### 3.3 McpAuthResolver

Dedicated to the MCP channel (`packages/core/src/server/channels/mcp/`): resolves the user token carried in the MCP request metadata into an `ActorContext`. **Independent of `ActorContextResolver`**—although under OSS the HTTP / MCP entries share the same user token resource pool, the two entries are handled by independent resolvers, and the SaaS form can override them separately (e.g. SaaS HTTP integrates a Supabase JWT while MCP still uses static tokens).

| Item                 | OSS default                                                                       | SaaS expectation                                 |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Implementation class | `LocalMcpAuthResolver`                                                            | `RemoteMcpAuthResolver` (in the SaaS repository) |
| Credential source    | The user token in the MCP request metadata (same resource pool as the HTTP entry) | per-org MCP token / SaaS JWT in MCP metadata     |
| Returns              | actor UUID + `actorKind='system_mcp'`                                             | actor UUID + current organization + role claims  |

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

SaaS replacement constraints:

- The SaaS `RemoteMcpAuthResolver` may accept a per-org MCP token or JWT, but must still return the same `ActorContext` shape
- When SaaS customizes the actor `actorKind`, name it with a `system_` prefix (e.g. `system_org_mcp`, with orgId placed in `actorId` / `claims`) to avoid overlap with user / script

### 3.4 ConnectorContextResolver

Dedicated to the core webhook entry runtime mounted by `apps/webhook`: resolves `(:webhookSlug, :pathName) + webhook token` into a connector context, then produces a `ProjectContext` and a system actor. **Independent of `ActorContextResolver` (§3.2) / `McpAuthResolver` (§3.3)**; the credential systems are not reused.

| Item                 | OSS default                                                                                                               | SaaS expectation                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Implementation class | `LocalConnectorContextResolver`                                                                                           | `RemoteConnectorContextResolver`                                         |
| Binding module       | `LocalContractsModule` (the implementation lives in the webhook runtime because it depends on `WebhookRepository`)        | `SaasContractsModule`                                                    |
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
- The goal of the resource boundary design: webhook tokens coexist with user tokens in the physical table (for unified auditing / indexing / hash uniqueness), but their lifecycle, SaaS replacement path, and scope validation semantics are completely independent

Usage statistics per token:

- The `ph_runs.run_results` table adds `webhook_token_id uuid NULL` (FK → `ph_core.tokens.id`, ON DELETE SET NULL), filled only by calls triggered by the webhook entry; the HTTP / MCP entries write NULL
- The BullMQ job payload carries `webhookTokenId` (optional field); the worker passes it through when writing the run_result
- `ActorContext` only contains `actorKind='system_webhook'` (connectorId placed in `actorId`), without encoding tokenId into actorKind—the tokenId is materialized into the run_result column and does not rely on parsing the actor field
- The monitoring / connector detail page can GROUP BY `webhook_token_id` to aggregate call count, success rate, and last call time, for per-consumer usage observation

### 3.5 TokenService

CRUD for user tokens. **Current state**: `TokenService` is an abstract-class DI token exported from `@proofhound/core/contracts`; the OSS default `LocalTokenService` only handles `scope='user'`. The token→`ActorContext` validation (hash comparison / expiry) is **not in this service**, but split into `LocalUserTokenVerifier`, reused by `ActorContextResolver` (§3.2) / `McpAuthResolver` (§3.3).

| Item                 | OSS default                                                                                                                   | SaaS expectation                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Implementation class | Abstract `TokenService` + OSS default `LocalTokenService`, bound in `LocalContractsModule`                                    | `RemoteTokenService`, bound in the SaaS `contracts` module                                                  |
| Data source          | The `ph_core.tokens` table (only `scope='user'` rows)                                                                         | The token table of the SaaS schema                                                                          |
| Behavior             | Local admin app user token CRUD (the same token is usable for HTTP API + MCP); validation handled by `LocalUserTokenVerifier` | per-org / per-user token CRUD; validation is handled by the SaaS `ActorContextResolver` / `McpAuthResolver` |

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

OSS / SaaS switching semantics:

- The OSS default implementation reads and writes `ph_core.tokens`, but only acts on `scope='user'` rows
- The SaaS implementation reads and writes the token table of the SaaS schema; under a SaaS deployment, the OSS `ph_core.tokens` **does not write user rows** (the table structure is retained; `scope='webhook'` rows are still read and written by the connector resource)
- `TokenModule` only declares the HTTP controller; it does **not** bind `{ provide: TokenService, useClass: LocalTokenService }`. This prevents the feature module from shadowing the `contracts` module and ensures HTTP `/tokens` and MCP token tools both see the edition-supplied provider.
- SaaS does not need to add a feature flag or env branch in OSS code—simply bind `TokenService` in the `contracts` module passed to `ProofHoundServerModule.forRoot({ contracts })`

Webhook tokens (`scope='webhook'`) are **not** managed by this service; see §3.4. When SaaS replaces `TokenService` it does not affect the webhook entry; to replace the webhook integration, only override `ConnectorContextResolver`.

### 3.6 AccessControlService

Decides whether `actor + project + action` is allowed.

| Item                 | OSS default                                                                                                                                                               | SaaS expectation                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Implementation class | Abstract `AccessControlService` + OSS default `LocalAccessControlService` (`packages/core/src/server/common/contracts/`), DI-bound in `LocalContractsModule` (landed PR8) | `RbacAccessControl`                               |
| Behavior             | `system_*` + `local_user` all pass; `script` passes but is forbidden `platform_manage` (to prevent token privilege escalation); everything else forbidden                 | Checks based on the actor's org membership + role |

Contract draft:

```ts
// Landed (PR8). AccessAction + the toActorContext() normalizer live in
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
// SaaS binds RbacAccessControl to the same token in its SaasContractsModule.
```

Signature constraints (landed PR8):

- Services inject `AccessControlService` and call `await this.accessControl.assertCan(toActorContext(actor), project, action)`; the old directly-imported `accessControl` singleton is removed.
- Three parameters `(actor, project, action)`, async; the OSS implementation ignores actor/project beyond `actorKind`, but SaaS must read them. Platform-level actions (e.g. `user_token_manage`) that are not project-scoped pass the actor-derived local project (`actor.projectId ? { projectId, source: 'local' } : LOCAL_PROJECT_CONTEXT`).
- `mcp_tool` is a channel-level gate: the MCP transport/context factory calls it once after resolving the actor + project and before SDK tool dispatch. The called Service still performs its normal business action check, so SaaS can deny the MCP channel independently without losing project/read/write/release granularity.
- `AccessAction` is a 6-value coarse-grained enum; it may be refined later if SaaS RBAC needs it, but without coupling to roles or resource ids.
- An actor with `actorKind='system_webhook'` passes everything by default under OSS; SaaS may define in the RBAC implementation "which actions a connector inbound may perform" (generally limited to channel actions, such as writing run results)

### 3.7 LimiterKeyStrategy

Generates rate limit keys.

| Item                 | OSS default               | SaaS expectation                               |
| -------------------- | ------------------------- | ---------------------------------------------- |
| Implementation class | `LocalLimiterKeyStrategy` | `OrgScopedLimiterKeyStrategy`                  |
| Key composition      | `model:<modelId>`         | `org:<orgId>:model:<modelId>` or finer-grained |

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
- Runtime callers assemble the key via the strategy and thread it as an OPAQUE `limiterKey` string through `@proofhound/llm-client` to the limiter (`@proofhound/llm-client` stays project-unaware, §8). This includes the BullMQ LLM runner (`payload.projectId + modelId`), model connectivity probes, prompt try-run, and optimization analysis/generation calls.
- `packages/optimization-strategy` receives `analysisLimiterKey` from the core runtime and passes it to `invokeLLM`; it must not reconstruct `model:<modelId>` internally.
- `ProjectContext` carries an optional, SaaS-only `orgId`. The enqueue / launch side seeds it from the resolved project context and threads it through the worker LLM / probe job payloads, release runner LLM payloads, the experiment / optimization workflow inputs, and the synchronous probe / prompt try-run / optimization analysis-generation paths, so a SaaS `OrgScopedLimiterKeyStrategy` reads `project.orgId` to compose `org:<orgId>:model:<modelId>` without re-querying. OSS leaves it undefined and `LocalLimiterKeyStrategy` ignores it.
- Queued model probes also call `RuntimeLimitsProvider` in the worker before `testModelConnectivity`; a model-level RPM / TPM of `-1` does not bypass a positive org plan cap.
- Server-side and worker callers obtain `LimiterKeyStrategy` from the `contracts` module supplied to their runtime root. Worker assembly must not bind `LocalLimiterKeyStrategy` directly, otherwise SaaS cannot replace it consistently through the same `forRoot({ contracts })` seam.
- The source of the rate limit quota configuration (RPM / TPM / concurrency cap) is also indirectly determined by the strategy in the SaaS form (the key prefix determines the counting space)
- The autostate of auto-concurrency (latency / token EWMA + backoff multiplier) is also per-key state, reusing the same key counting space (`model:<modelId>:autostate` under OSS); changing the key prefix in the strategy naturally isolates it, and the `LimiterKeyStrategy` contract stays unchanged

### 3.8 WorkflowAuthorizationHook

When a DBOS workflow / BullMQ job starts, validates whether the actor may start a workflow on that projectId.

| Item                 | OSS default                              | SaaS expectation                                                                            |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Implementation class | `LocalWorkflowAuthorizationHook` (no-op) | `RbacWorkflowAuthorizationHook`                                                             |
| Behavior             | Passes directly                          | Validates whether the actor's role on that project allows starting that workflow / job type |

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

The `@UseGuards()` entry shell of the HTTP Controller. Nest registers the class in the `@UseGuards(HttpActorGuard)` metadata directly as an enhancer injectable, so `HttpActorGuard` cannot be merely an abstract DI token—it must be an executable base class. The guard itself does not parse credentials; it only takes on three things: "declaring a stable entry at the Controller decorator layer, calling `ActorContextResolver.resolveFromHttp`, and attaching the result to `request.user`". SaaS usually only needs to override §3.2; if it genuinely needs to replace guard behavior (e.g. adding tenant scope injection or cross-origin session handling), it must ensure the `HttpActorGuard` base class referenced in the Controller metadata can still execute and delegate to the corresponding resolver / context adapter.

| Item                 | OSS default                                                                                                                                                                      | SaaS expectation                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | The `HttpActorGuard` executable base class, used directly by OSS (no separate subclass, and not registered as a provider; routes auto-instantiate it from `@UseGuards` metadata) | Reuse `HttpActorGuard` + replace `ActorContextResolver`; the guard class itself is **not** replaced via provider override (the Controller metadata references `HttpActorGuard`, and `overrideProvider(HttpActorGuard)` cannot swap out the route guard); when a guard-layer extension is needed (tenant context injection, etc.), it is borne by the collaborator the base class delegates to (the resolver / a future added hook) |
| Responsibility       | Calls `ActorContextResolver.resolveFromHttp(req)` → adapts to `CurrentUserPayload` → attaches `request.user`                                                                     | Same as OSS; can additionally attach SaaS-specific context (e.g. org claims, tenant context)                                                                                                                                                                                                                                                                                                                                       |
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

The Controller directly uses `@UseGuards(HttpActorGuard)`. `HttpActorGuard` is **not registered as a provider in `ContractsModule`**—the route execution chain auto-instantiates it from the class reference in the `@UseGuards` metadata (resolving through the module's injectables set rather than the provider token, so a provider override cannot replace the guard in the metadata, hence it must be an executable base class). The guard's sole constructor dependency `ActorContextResolver` is provided by the global `ContractsModule`; its DB dependency chain (`LocalActorContextResolver → LocalUserTokenVerifier`) is encapsulated inside `ContractsModule`, so feature modules **do not need** to import `DatabaseModule` for the guard. SaaS replacing authentication only overrides `ActorContextResolver`. This is also why regression tests need to cover real HTTP routes.

### 3.10 RuntimeLimitsProvider

Folds deployment-level runtime caps into a call's per-call RPM / TPM / concurrency limits — e.g. a SaaS org plan's concurrency ceiling. It carries **no** billing semantics: it only translates an already-resolved `ProjectContext` (+ model id / source) into an optional `RuntimeLimits` override. The BullMQ LLM worker (`llm-runner`) invokes it once per job, just before taking `min(merged caps, model-level quota)` (SPEC 21 §quota), so queued job sources (experiment, optimization child experiments, release, webhook) are capped uniformly at the worker enforcement point. Synchronous LLM callers (`prompt_try_run`, `probe`, `optimization_analysis`, `optimization_generate`) invoke the same provider before calling `@proofhound/llm-client`, then apply the same `min(merged caps, model-level quota)` rule. The model-level cap remains the hard ceiling in all paths.

| Item                 | OSS default                                                                       | SaaS expectation                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `LocalRuntimeLimitsProvider`                                                      | e.g. `PlanQuotaRuntimeLimitsProvider`                                                                                             |
| Behavior             | Pass-through: returns the caller's `limits` unchanged (no plan / quota awareness) | Reads the resolved `project.orgId` to look up the org plan and lower `concurrency` (and optionally RPM / TPM) to the plan ceiling |

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

- The provider is invoked by core runtime callers before invoking or enqueueing LLM work, never inside `@proofhound/limiter` or `@proofhound/llm-client`; those stay project / plan-unaware (§8).
- The OSS `LocalRuntimeLimitsProvider` MUST be a genuine pass-through so OSS behavior is byte-identical; the hook exists only so a SaaS override can clamp limits without forking the workflow. Together with `project.orgId` (§3.7) it lets a SaaS plan both isolate the rate-limit bucket and cap its concurrency.
- This hook only sets the per-call ceiling fed into the existing `min(limits, model quota)` logic; it does **not** implement a whole-org shared concurrency pool (that would require a second limiter gate and is out of scope here).

### 3.11 QuotaPolicyHook

Validates hosted quota policy at the exact write / execution points that are otherwise deep inside OSS business flows. This hook carries no SaaS billing model in OSS: it receives project context, actor context when available, an operation source, and best-effort incoming byte estimates. OSS local behavior is a no-op.

| Item                 | OSS default                | SaaS expectation                                                                                                      |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `LocalQuotaPolicyHook`     | e.g. `SaasQuotaPolicyHook`                                                                                            |
| Storage behavior     | Pass-through               | Checks organization storage quota before dataset uploads/import batches and run-result writes                         |
| Execution behavior   | Runs the callback directly | Optionally gates / reserves an org execution slot around LLM and probe calls, using a distributed limiter when needed |

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
- LLM and model-probe runners wrap the actual provider call in `withExecutionSlot`. OSS local mode runs the callback directly; SaaS may use the hook to enforce org-level execution-slot admission in addition to the existing per-model limiter.
- This hook must not introduce organizations, plan tables, or billing branches into OSS. SaaS semantics live in the replacement implementation and use `ProjectContext.orgId` or a SaaS-side project-to-org lookup.

### 3.12 UsageMeteringHook

Emits immutable domain usage events when business facts happen. The hook is intentionally observation-only: OSS emits generic events with project / actor / source context, and the default implementation is no-op. It carries no organization, billing, plan, tenant, or hosted-edition semantics in OSS.

| Item                 | OSS default                  | SaaS expectation                                                                                                                                  |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation class | `NoopUsageMeteringHook`      | e.g. `SaasUsageMeteringHook` bound in the SaaS `contracts` module                                                                                 |
| Behavior             | Best-effort no-op            | Persist idempotent events with bounded O(1) writes, resolve project-to-org inside the SaaS repository, and mark usage read models dirty as needed |
| Failure behavior     | Never blocks the caller path | Replacement implementations may throw, but OSS callers must wrap the hook so failures are logged and swallowed                                    |

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
- A dirty key means "batch this project/dimension later"; it does not authorize immediate in-hook recompute. SaaS dirty processors should coalesce by project/dimension/window, use touched-project or time-window filters, and run full scans only in low-frequency reconciliation jobs.
- For idempotent SaaS event stores, dirty marking should happen only when the event insert actually wins. Duplicate hook calls caused by retries must not create additional dirty churn.
- High-volume events such as `run_result.created` carry enough payload (`status`, token counts, cost estimate, latency, source ids) for incremental rollups. Full detail-table scans are reserved for hourly/daily reconciliation over touched projects, bounded time windows, or shards.
- Hook failures are best-effort only. Callers must use the safe wrapper around `UsageMeteringHook.record()` and log a warning without changing the original success / failure behavior.
- OSS emits only `projectId` and optional flat `actorId`; SaaS resolves any organization or billing ownership inside the replacement hook by looking up the project. OSS event payloads must not include organization, plan, billing, tenant, quota tier, or control-plane fields.
- Current emitters cover worker job lifecycle (`job.started` / `job.completed` / `job.attempt_failed` / `job.failed` / `job.rate_limited`), immutable run-result creation (`run_result.created`), release line / event / run attachment facts, dataset and import dirty facts, and model configuration changes. These events are generic domain observations; the OSS UI does not expose a usage ledger or billing page.

## 4. Frontend reuse strategy

The frontend reuse mechanism mirrors the backend `@proofhound/core` + `ProofHoundServerModule.forRoot({ contracts })` pattern: the OSS product UI is extracted into a shared package `@proofhound/web-ui`, and each app (OSS / SaaS) becomes a thin shell that wires the shared package through a single `<ProofHoundWebProvider contracts={WebContracts}>` entry point.

### 4.0 Package architecture

```
packages/
  ui/            # Pure design system (atomic primitives + cn() + Main layout primitive)
  web-ui/        # Shared product UI (screens / hooks / components / i18n / providers / lib / contracts)
apps/web/        # OSS thin shell: route wrappers + chrome (AppShell / sidebar / header) + contracts wiring
SaaS apps/web/   # SaaS thin shell: own chrome (org nav / billing / project switcher) + same @proofhound/web-ui/screens
```

Dependency direction: `@proofhound/ui` (zero business) ← `@proofhound/web-ui` (depends on ui + api-client + shared) ← `apps/web` (thin shell). `deps:check` (madge) must have no new circular dependencies.

`@proofhound/web-ui` subpath exports:

| Subpath                                 | Contents                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@proofhound/web-ui/screens`            | Product resource screens (`DatasetsListScreen`, `PromptDetailScreen`, …) + dashboard page                   |
| `@proofhound/web-ui/hooks`              | Domain hooks (signatures unchanged, still accept `projectId`) + utility hooks                               |
| `@proofhound/web-ui/providers`          | `ProofHoundWebProvider`, underlying Refine / ProjectContext / I18n providers                                |
| `@proofhound/web-ui/i18n`               | Full dictionary + `I18nProvider` / `useI18n` + language utilities                                           |
| `@proofhound/web-ui/components`         | 12 product-domain components + charts + annotation sub-components                                           |
| `@proofhound/web-ui/lib`                | `formatDateTime` / `getApiErrorMessage` / `releases` / `project-name` / `uuid` / `model-*` domain utilities |
| `@proofhound/web-ui/contracts`          | `WebContracts` type + `localWebContracts`                                                                   |
| `@proofhound/web-ui/styles/globals.css` | Theme CSS variables / semantic classes / animation keyframes                                                |

### 4.1 ProjectId transport

The SaaS backend must know the `projectId` of the current request.

**Adopted approach: HTTP `X-Project-Id` header.**

Reasons:

- OSS routes are currently all `/<resource>` (e.g. `/prompts`, `/datasets`), without a project prefix; changing them to path-based `/projects/:projectId/<resource>` would require changing 96 client calls and all Controller routes, with no benefit on the OSS side
- The OSS backend `LocalProjectContextResolver` simply ignores the header, with no behavior change
- The SaaS backend `RemoteProjectContextResolver` reads the projectId from the header and validates it against the actor
- The `httpClient` interceptor registered by `ProofHoundWebProvider` (via `configureApiClient`) injects the `projectId` from the current `ProjectContextSource` into the header at startup; before `ProofHoundWebProvider` mounts, the `httpClient` has no interceptor

Implementation constraints:

- All methods of `packages/api-client` retain the existing `(projectId: string, ...)` parameter signature
- The first parameter `projectId` serves two purposes at once: React Query cache key boundary + source of the `X-Project-Id` header
- Adding the header at the HTTP layer is handled uniformly by the `httpClient` interceptor registered by `configureApiClient`; business clients do not set the header directly
- The OSS backend does not enforce the presence of the header; the SaaS backend enforces it within the resolver
- The MCP entry's project hint goes through MCP metadata, not reusing the HTTP header
- The webhook entry does not carry `X-Project-Id`; the project is looked up by `ConnectorContextResolver` from the connector configuration (§3.4)

Not adopted:

| Approach                                     | Reason for not adopting                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| path-based `/projects/:projectId/<resource>` | Large change; no value on the OSS side; SaaS project switching via header + React Query cache key is already enough |
| subdomain `<projectId>.proofhound.app`       | High deployment complexity; troublesome cookie domain management; unfriendly SaaS project switching interaction     |
| URL query string `?projectId=...`            | Easy to omit; the frontend must append the parameter on every request; inconsistent with RESTful conventions        |

### 4.2 Auth credential transport

The OSS browser **does not actively carry any auth credential** (sends no `Authorization`, sends no session cookie); the SaaS browser carries a Supabase JWT in `Authorization: Bearer`. To allow the shared product UI in `@proofhound/web-ui` to remain unchanged between OSS and SaaS, `packages/api-client` exposes an `AuthSource` abstraction; the OSS default implementation returns `null`, and the SaaS override returns the JWT.

`AuthSource` is part of `WebContracts` and is wired at the single `ProofHoundWebProvider` entry point—OSS passes `localWebContracts` (which carries `LocalAuthSource`); SaaS passes `SupabaseAuthSource`. The provider calls `configureApiClient({ authSource, getProjectId, baseUrl })` on mount (in a client effect), which registers the axios request interceptor for both `Authorization` and `X-Project-Id`; screens and hooks in `@proofhound/web-ui` never touch `AuthSource` directly.

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

// Injected by the SaaS repository
export class SupabaseAuthSource extends AuthSource {
  constructor(private supabase: SupabaseClient) {
    super();
  }
  async getToken(): Promise<string | null> {
    const { data } = await this.supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
}
```

The `configureApiClient` call inside `ProofHoundWebProvider` registers one request interceptor (idempotent—a re-config ejects the prior one):

```ts
// packages/api-client/src/configure.ts  (called once by ProofHoundWebProvider in a client effect)
export interface ApiClientConfig {
  authSource: AuthSource;
  getProjectId: () => string; // OSS: () => LOCAL_PROJECT_CONTEXT.projectId; SaaS: () => current project id
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
  projectContext: ProjectContext; // OSS: constant LOCAL_PROJECT_CONTEXT. SaaS: a reactive multi-tenant source is a future extension.
  baseUrl?: string; // default: NEXT_PUBLIC_SERVER_URL → localhost:4000
  i18nExtend?: Partial<Record<Language, Record<string, string>>>; // SaaS console keys
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

Two boundary rules a consuming app (OSS or SaaS) must follow: (1) server code calls server-safe i18n utils (e.g. `resolveAcceptLanguageHeader`) from `@proofhound/web-ui/i18n/language` (NOT the `'use client'` `@proofhound/web-ui/i18n` barrel); (2) the class-instance `contracts` is constructed/held behind a `'use client'` boundary, never passed as a prop from a Server Component. Also: the consuming app must register the shared package sources for Tailwind (`@proofhound/web-ui/styles/globals.css` carries `@source` directives for `@proofhound/web-ui` + `@proofhound/ui`; the app's own chrome is auto-detected) so responsive utility classes in the shared components are not purged.

SaaS passes `{ authSource: SupabaseAuthSource, projectContext: <reactive multi-tenant source>, i18nExtend: saasConsoleDict }`. The product UI screens and hooks in `@proofhound/web-ui` are identical in both cases—the contracts injection point is the single difference.

Implementation constraints:

- `AuthSource` and `ProjectContextSource` are consumed only by `configureApiClient` inside `ProofHoundWebProvider`; screens / hooks / components in `@proofhound/web-ui` never read them directly
- The OSS `LocalAuthSource` always returns `null`—the browser not carrying a credential is an OSS design requirement, not a bug
- SaaS injects `SupabaseAuthSource`, with `@supabase/supabase-js` managing the access token and refresh
- The browser side **does not** use the user token (`ph_*`) as a session—the user token is only for external scripts / CI / MCP clients to copy-paste, and never goes into localStorage / sessionStorage
- When an external script calls the HTTP API, the caller sets `Authorization: Bearer ph_*` itself, without going through `AuthSource`
- The MCP entry's credential does not go through this abstraction—the MCP client config directly holds the user token
- The project switcher UI is **SaaS-only private chrome** and does not belong in `@proofhound/web-ui`; the OSS thin shell and the shared package both do not build a project switcher (see §8)

Not adopted:

| Approach                                                                                                   | Reason for not adopting                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| OSS shipping a cookie session + login page                                                                 | A single-workspace OSS does not need a login system; see the rejection reasoning for formation C in §3.2.1          |
| OSS injecting the user token into the browser localStorage as a session                                    | XSS exposes a long-lived credential; conflicts with OWASP's "API keys are not appropriate for authenticating users" |
| Forcing `httpClient` to always set the `Authorization` header under OSS too (e.g. sending an empty string) | Increases the risk of the backend resolver misjudging; the OSS browser silently not sending is a cleaner contract   |
| Keeping product UI inside `apps/web/src` without extraction                                                | SaaS repository cannot import `apps/web/src`; physical package extraction is the prerequisite for reuse             |

## 5. Schema boundary

The OSS trunk database schema does not concede to SaaS:

- The `project_id` column of OSS business tables is retained, and participates only in the single `LOCAL_PROJECT_ID` data
- OSS does **not** add an `organization_id` column
- OSS does **not** add control plane tables such as `memberships` / `roles` / `audit_log`
- OSS does **not** add SaaS-only fields such as `organization_id` / role / membership to `ph_core.tokens` for control plane alignment
- SaaS builds `organizations` / `memberships` / `project_memberships` / `roles` / `audit_log`, etc., in a separate schema (the prefix is up to the SaaS repository, suggested e.g. `cp_*`)
- The way SaaS associates with OSS business tables: join via `project_id`; the OSS schema does not expose any foreign key to SaaS
- SaaS decides the many-to-many / one-to-many relationship between organization and project; OSS makes no assumptions

The `scope` dimension of `ph_core.tokens`:

- OSS maintains two scopes: `user` (the local admin app credential shared by HTTP API + MCP) and `webhook` (per-connector inbound)
- A `scope='webhook'` row must fill in `connector_id` (FK → `ph_assets.connectors`), indicating that the token is part of the connector resource
- `scope='user'` rows are CRUD-managed by `TokenService` (§3.5); `webhook` rows are CRUD-managed by the connector service, which TokenService neither reads nor writes
- In the SaaS form, `user` rows **do not write data** (carried by the SaaS schema's own token table); `webhook` rows are **still written by the OSS default connector service** (the SaaS replacement of the webhook entry is done only at the `ConnectorContextResolver` layer, without touching connector resource management)
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

## 6. The shutdown mechanism of the token system under SaaS

The OSS trunk provides `TokenService` (§3.5) as the extension point for user token CRUD. In the SaaS form:

- The SaaS repository binds `TokenService` to `RemoteTokenService` inside its `SaasContractsModule` (the `contracts` argument handed to `ProofHoundServerModule.forRoot({ contracts })`, see §2)
- `RemoteTokenService` reads and writes the SaaS schema's token table and does not write `scope='user'` rows in the OSS `ph_core.tokens`
- The OSS `ph_core.tokens` table structure is retained; under a SaaS deployment the `user` scope does not write data, but `scope='webhook'` rows are still written normally (managed by the connector resource, unrelated to the SaaS switch)
- Likewise, `ActorContextResolver` (§3.2) and `McpAuthResolver` (§3.3) are also replaced by SaaS with their respective Remote implementations; the three are overridden independently without affecting each other
- There is no need to write env branches such as `process.env.DEPLOYMENT_MODE` in OSS code—the form difference is entirely borne by the `contracts` module passed to `forRoot` (§2)

The per-connector token of the webhook entry is not managed by `TokenService`; it is stored in `ph_core.tokens with scope='webhook' AND connector_id=?` and validated by `ConnectorContextResolver` (§3.4). If SaaS wants to replace the webhook integration (e.g. switch to HMAC, add multi-tenant isolation), it only needs to override `ConnectorContextResolver`, without affecting `TokenService` / `ActorContextResolver` / `McpAuthResolver`.

## 7. Evolution and PR breakdown

The OSS trunk migrates from its current state to an adapter-ready state, with PRs broken down in the following order:

| No. | PR content                                                                                      | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Extract `@proofhound/core` runtime package **(landed)**                                         | Move reusable server / webhook / worker runtime from `apps/*` into `packages/core`; expose `@proofhound/core/server`, `@proofhound/core/webhook`, `@proofhound/core/worker`, `@proofhound/core/contracts`, and `@proofhound/core/infra`; reduce `apps/server`, `apps/webhook`, and `apps/worker` to process shells. This is an extraction, not an app-level barrel. OSS apps must consume the new package themselves so the package has a real OSS caller.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1   | Land the DI abstractions and decorator **(landed)**                                             | Define the abstract classes of the 9 extension points (§3.1–§3.9) + OSS `Local*` default implementations, add the `@CurrentProject()` decorator, register OSS defaults in `LocalContractsModule`, and have server / webhook / worker roots consume that module through `forRoot({ contracts })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | DB migration: tokens table refactor + run_results adds webhook_token_id **(landed)**            | Drizzle migration: (1) merge `project_api` + `global_mcp` into `user`, rename the `ph_core.api_tokens` table to `ph_core.tokens`; (2) extend the CHECK constraint to allow `scope='webhook'`, add the `connector_id` FK, backfill existing webhook token rows; (3) remove the `ph_assets.connectors.webhook_token_id` reverse reference; (4) remove the global MCP singleton unique constraint; (5) add a length max 64 CHECK to the `name` field; (6) `ph_runs.run_results` adds `webhook_token_id uuid NULL REFERENCES ph_core.tokens(id) ON DELETE SET NULL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | Converge the Controller / MCP entries **(landed)**                                              | Replace the direct `resolveProjectContext()` calls in the server Controllers with the `@CurrentProject()` decorator (project resolved by `HttpActorGuard` via `ProjectContextResolver`); the MCP entry resolves project context through the MCP server transport (see [09-mcp-server.md](09-mcp-server.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4a  | `LocalActorContextResolver` API channel + ph\_ prefix **(landed)**                              | Implement HTTP `Authorization: Bearer ph_*` parsing, sha256 hash (**including the `ph_` prefix**) comparison against `ph_core.tokens where scope='user'`, expiry / IP whitelist validation, touch `last_used_at`; the JWT form (`eyJ*`) returns 401 `unsupported_credential`; the token generation side (`POST /tokens`) uniformly outputs plaintext with the `ph_` prefix, and the sha256 hash includes the prefix. **Note**: after this PR lands, all old user tokens (without the prefix) become invalid; the OSS single-person project requires ZiqiXiao to manually revoke + recreate once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4b  | `LocalActorContextResolver` UI channel + HttpActorGuard rework **(landed)**                     | On the basis of PR4a, complete the UI channel branch: when there is no `Authorization`, read the trusted deployment header (env `PH_TRUSTED_USER_HEADER`, default `X-Forwarded-User`) → `actorKind='local_user'`; if the header is also absent → LOCAL_ACTOR fallback (`actorKind='local_user'`, `actorId=LOCAL_ACTOR_ID`); change `HttpActorGuard` to an executable base class, dependency-inject `ActorContextResolver`, and remove the hardcoded LOCAL_ACTOR. **Precondition**: the old HTTP guard stub's "no Bearer → direct 401" behavior must be changed to channel-aware in this PR, otherwise after PR4a lands the OSS Web UI is in an unopenable state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | `LocalMcpAuthResolver` completes real validation **(landed)**                                   | Implement token extraction from the MCP metadata, sha256 hash comparison against `ph_core.tokens where scope='user'`, expiry validation; the MCP server transport (see [09-mcp-server.md](09-mcp-server.md)) calls the resolver to validate the user token before dispatching any tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | `LocalConnectorContextResolver` extraction + going through the unified token model **(landed)** | Extract the inline webhook authorization logic (now in `packages/core/src/webhook/channels/webhook/webhook.service.ts`) into a resolver that queries `ph_core.tokens where scope='webhook' AND connector_id=? AND revoked_at IS NULL` (the query deliberately **omits** the `expires_at > now()` filter so the resolver can tell expired from invalid: a missing row → `invalid_webhook_token`, a present-but-expired row → `expired_webhook_token`) and returns `{ connector, projectContext, actorContext }`; **the resolver produces the projectContext in one shot and does not call `ProjectContextResolver`**; the error code uses `invalid_webhook_token` (distinguished from the user token's `invalid_user_token`); the actor is `actorKind='system_webhook'` (the flat enum lives in the core actor context, connectorId placed in `actorId`, no new kind variant added); the webhook entry's BullMQ job payload carries `webhookTokenId`, and the worker fills the `webhook_token_id` column when writing the run_result; add `webhook.service.spec.ts` asserting that the context and tokenId returned by the resolver propagate to the downstream LLM job |
| 7   | `TokenService` abstraction **(landed)**                                                         | Change the existing token Service into an abstract class + `LocalTokenService` implementation, handling only `scope='user'` rows; export the token from `@proofhound/core/contracts`; bind the OSS default in `LocalContractsModule`, while `TokenModule` consumes the edition-supplied provider and does not shadow it with a local default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 8   | `AccessControl` DI seam **(landed)**                                                            | Extracted abstract `AccessControlService` + OSS `LocalAccessControlService` (`common/contracts/`), bound `@Global` in `LocalContractsModule`; converted 34 call sites across 15 Services to `await this.accessControl.assertCan(toActorContext(actor), project, action)` (async, three-param)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | `LimiterKeyStrategy` integration **(landed)**                                                   | The core runtime builds the key via the strategy and passes it down as an **opaque string**; `packages/limiter` and `packages/llm-client` stay actor/project-unaware (§8). `packages/limiter` keeps being a pure counter — its key parameter is renamed `modelId`→`key` so the caller supplies the composed key. Worker assembly consumes the same contracts module and does not hard-bind the local limiter strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | `WorkflowAuthorizationHook` integration **(landed)**                                            | Call the hook before starting a workflow / enqueuing a job, OSS no-op; core webhook runtime integrated in sync. `WorkflowKind` reconciled with [03-orchestration](03-orchestration.md): `experiment` / `optimization` / `release` / `llm` / `probe`. Release entry Services authorize before writing/resuming `running` release events; direct model / connector probes authorize before the probe execution path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | API client transport **(landed)**                                                               | `packages/api-client` exposes `AuthSource` + `configureApiClient`; `ProofHoundWebProvider` calls `configureApiClient({ authSource, getProjectId, baseUrl })` before its children render to register a single request interceptor that adds `X-Project-Id` (§4.1) from the active `ProjectContext` and `Authorization` (§4.2) only when the token is non-null. OSS injects `LocalAuthSource` (returns null); SaaS injects `SupabaseAuthSource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | `QuotaPolicyHook` integration **(landed)**                                                      | Call the hook before dataset upload/import writes, immutable run-result inserts, and LLM/probe execution-slot admission points. OSS default is no-op; SaaS can enforce storage quota and whole-org execution slots without adding plan semantics to OSS business modules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 13  | `UsageMeteringHook` integration **(landed)**                                                    | Emit generic, idempotent, best-effort domain usage events from job lifecycle, run result writes, release facts, dataset/import dirty facts, and model configuration changes. OSS default is no-op; SaaS can persist events and mark usage read models dirty without leaking organization, billing, plan, or tenant fields into OSS code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

All PRs (0–13) have landed. The OSS authentication layer is production-usable across all three entries—HTTP / MCP / Webhook all perform real token validation, the HTTP entry's dual channels are channel-aware, and the MCP channel serves a real Streamable-HTTP server (see [09-mcp-server.md](09-mcp-server.md)). All twelve extension points (§3.1–§3.12) are DI-ified with OSS `Local*` / no-op defaults, giving the SaaS repository a stable package import surface to override against. (§3.10 `RuntimeLimitsProvider`, §3.11 `QuotaPolicyHook`, and §3.12 `UsageMeteringHook` were added after the initial nine, following the same abstract-token + default implementation pattern.)

PR 1 has a relatively large scope (8 extension points + decorator + module registration); at implementation time it can be split into eight independent PRs 1a-1h, one per extension point, starting from `ProjectContextResolver`. The specific split is decided by the implementer at their own pace.

PR 2 is the schema precondition for the subsequent PRs 4a/4b/6 and must be merged first. PR 4a → PR 4b ordering: after 4a lands, master is in an "OSS Web UI cannot open" state, and 4b must immediately follow to restore UI usability; do not ship 4a alone. There is no dependency among the three entries PR 4a/4b (HTTP), PR 5 (MCP), and PR 6 (Webhook); they can be implemented in parallel.

## 8. Things you shouldn't do

- Do not introduce organizations / memberships / roles business implementations into the OSS trunk
- Do not add an `organization_id` column or control plane tables to the OSS schema
- Do not add SaaS-only fields such as `organization_id` / membership / role to `ph_core.tokens` for control plane alignment
- Do not make `apps/server`, `apps/webhook`, or `apps/worker` library entry points; reusable backend runtime belongs in `packages/core` and is exported as `@proofhound/core`
- Do not add app-level barrels as a shortcut for SaaS reuse
- Do not build a project switcher or organization switcher in the OSS frontend or in the shared `@proofhound/web-ui` package—the project switcher is SaaS-only private chrome that belongs in the SaaS app shell, not in the shared product UI
- Do not introduce an `IS_PLATFORM`-style edition flag anywhere in the OSS trunk or in `@proofhound/web-ui` to distinguish self-hosted / SaaS forms within the same codebase (cf. the Supabase Studio cautionary tale: it caused long-term technical debt + community criticism, and the team itself could not pull off a refactor); in the shared package the single `WebContracts` injection at `ProofHoundWebProvider` is the only allowed variation point—screens / hooks / components must be form-neutral
- Do not let OSS Controllers / Services directly import default implementation classes—import only the abstract class (i.e. the DI token)
- Do not make foundational packages such as `packages/limiter` / `packages/llm-client` / `packages/connector-client` aware of actor / project
- Do not write form branches in OSS code via env vars such as `process.env.DEPLOYMENT_MODE='saas'`—the form difference is borne by provider override
- Do not read `actor.claims` in OSS business code—claims is a SaaS-only extension slot
- Do not let `TokenService` read or write `scope='webhook'` rows, nor let `ConnectorContextResolver` read or write `scope='user'` rows; the physical table is shared but the scope boundary is strictly separated
- Do not call `ActorContextResolver` or `McpAuthResolver` inside the webhook entry resolver; the three entry resolvers never call each other
- Do not validate the actor's project access at the webhook entry—the webhook credential is a per-consumer channel credential, not the project administrator; the webhook entry produces the ProjectContext directly via `ConnectorContextResolver`, without going through `ProjectContextResolver`'s access check
- Do not introduce a built-in grace period / background cleanup cron for webhook tokens—multiple tokens are a per-consumer steady-state semantic, and rotation is performed by the user autonomously ("create new token + revoke old token"), with expired / revoked rows retained for auditing
- Do not build a login page / password storage / session store / CSRF protection into OSS—a single-workspace OSS does not need a login system, and the UI channel identity is borne by deployment formation A (LOCAL_ACTOR fallback) or B (reverse proxy trusted header); see §3.2.1
- Do not put the user token (`ph_*`) into the browser localStorage / sessionStorage / cookie as a session credential—the user token is an "API key" in the OWASP sense, unsuitable as a user identity credential, with a very high risk of XSS exposing a long-lived credential; the browser UI session credential system and the user token system are **strictly separated**
- Do not let the OSS `LocalActorContextResolver` introduce a JWT verification library / JWKS client—the JWT form is the SaaS adapter's exclusive path, and OSS always returns 401 `unsupported_credential` when it encounters a JWT
- Do not set an empty-string `Authorization` header by default on the OSS browser side—the OSS browser silently not sending `Authorization` is the contract of the `AuthSource` abstraction; do not actively send an empty header for the sake of "format uniformity"

## 9. Relationship to other SPECs

- [00](00-overview.md): this SPEC is an expansion of 00's "thin abstractions / future external control plane integration"
- [02](02-tech-stack.md): this SPEC introduces no new tech stack, only specifying the use of existing NestJS DI and axios interceptors
- [03](03-orchestration.md): §3.8 `WorkflowAuthorizationHook` of this SPEC is a new pre-step for the 03 orchestration entry; the complete `WorkflowKind` enum is governed by 03's workflow / queue list; the webhook entry paragraph at the end of 03 §3 aligns with §3.4 `ConnectorContextResolver` of this SPEC
- [06](06-database-schema.md): §5 of this SPEC makes clear that the SaaS schema does not enter `ph_*`; the `scope='webhook'` + `connector_id` fields and the user / webhook scope binary introduced by this SPEC are reflected in the `ph_core.tokens` table structure in 06 §3.2
- [07](07-code-structure.md): reusable backend runtime is extracted to `packages/core`; the abstract classes and default implementations of the extension points are exported from `@proofhound/core/contracts`; shared Nest infra used to compose runtime modules is exported from `@proofhound/core/infra`; the MCP / Controller entries go through the `@CurrentProject()` decorator; the frontend package layout (`@proofhound/ui` design system, `@proofhound/web-ui` shared product UI, `apps/web` OSS thin shell) is governed by §7 of that SPEC
- [26](26-connectors.md): §3.4 `ConnectorContextResolver` of this SPEC is extracted from the existing connector authentication logic of the webhook runtime, with the credential lifecycle managed by the connector resource
