# SaaS Adapter-Boundary Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, with checkpoints). The task groups share files (`local-contracts.module.ts`, `limiter` types), so do NOT fan out parallel subagents that edit the same files. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the remaining SaaS adapter-boundary backlog (SPEC 08 PRs 1/3/5/6/7/9/10) — including a greenfield MCP server transport — and backfill the SPEC, in one branch / one PR.

**Architecture:** Each remaining extension point becomes an abstract DI token + OSS `Local*` default bound in a `@Global` contracts module; controllers/MCP/webhook entries resolve context through those tokens; `@proofhound/limiter` and `@proofhound/llm-client` stay actor/project-unaware (opaque key threaded from the core runtime). The MCP channel gains a real Streamable-HTTP server (`@modelcontextprotocol/sdk`) wired to `McpAuthResolver`.

**Tech Stack:** NestJS 11, Drizzle, BullMQ/DBOS, `@modelcontextprotocol/sdk`, Vitest, Playwright. pnpm@10 + turbo. Commands: `pnpm typecheck`, `pnpm test`, `pnpm verify`, `pnpm --filter @proofhound/core test`.

**Design doc:** `docs/superpowers/specs/2026-06-01-saas-adapter-backlog-design.md` (decisions 1–5 approved).

---

## File Structure

**New files (`packages/core/src/server/common/contracts/`):**
- `connector-context.resolver.ts` — `abstract ConnectorContextResolver` + `ConnectorResolveResult` (§3.4)
- `local-connector-context.resolver.ts` — `LocalConnectorContextResolver` (wraps extracted webhook auth)
- `limiter-key.strategy.ts` — `abstract LimiterKeyStrategy` + `LocalLimiterKeyStrategy` (§3.7)
- `workflow-authorization.hook.ts` — `abstract WorkflowAuthorizationHook` + `LocalWorkflowAuthorizationHook` + `WorkflowKind` (§3.8)

**New files (decorator + MCP server):**
- `packages/core/src/server/common/decorators/current-project.decorator.ts`
- `packages/core/src/server/channels/mcp/mcp-server.factory.ts`
- `packages/core/src/server/channels/mcp/mcp.transport.ts`
- `packages/core/src/server/channels/mcp/mcp.module.ts`

**New SPEC files / docs:**
- `docs/specs/09-mcp-server.md` (new)
- `docs/specs/08-saas-adapter-boundary.md` (backfill)

**Modified (key):**
- `local-contracts.module.ts` (bind 3 new tokens)
- `http-actor.guard.ts` (+ project resolution step)
- `token.service.ts` / `token.module.ts` (abstract + Local)
- `webhook.service.ts` / webhook contracts module (use resolver)
- `packages/limiter/src/types.ts` + `redis-limiter.ts` (`modelId` → `key`)
- `packages/llm-client/src/{types,invoke}.ts` (opaque `limiterKey`)
- worker/server runtime that builds the limiter key
- 13 server controllers (`resolveProjectContext` → `@CurrentProject`)
- `mcp.controller.ts` (real Streamable-HTTP routes), `proofhound-server.module.ts` (+ McpModule)
- launchers / bullmq services / release-runner / webhook (WorkflowAuthorizationHook call)

---

## Task Group H1 — SPEC first (hard-constraint #1)

### Task H1.1: Write `docs/specs/09-mcp-server.md`

**Files:** Create `docs/specs/09-mcp-server.md`

- [ ] **Step 1:** Write the MCP server SPEC covering: purpose (serve the 17 tool modules over MCP per constraint #16); transport = Streamable HTTP, **stateless**, mounted at `POST/GET/DELETE /mcp`; auth = `Authorization: Bearer ph_*` extracted into `McpRequestMetadataLike.headers` → `McpAuthResolver.resolveFromMcp` (§3.3) → `McpDispatchContextFactory`; tool registration from `channels/mcp/index.ts`; access via `AccessControlService` action `mcp_tool`; error mapping (`missing/invalid/expired_user_token` → JSON-RPC error / HTTP 401); relationship to §3.3 and §8 (independent resolver, no JWT lib in OSS). Use canonical terminology (global MCP Token / API Token per constraint #3).
- [ ] **Step 2:** Cross-reference: add a "Relationship to other SPECs" line pointing to 08 §3.3 and 03 §3.6.
- [ ] **Step 3:** Run `pnpm spec:terms`. Expected: PASS (no banned synonyms).
- [ ] **Step 4:** Commit `docs(spec): add 09-mcp-server (Streamable HTTP, stateless, ph_ token)`.

### Task H1.2: Backfill `docs/specs/08-saas-adapter-boundary.md`

**Files:** Modify `docs/specs/08-saas-adapter-boundary.md`

- [ ] **Step 1:** §2 "Current state" note (line ~42): list landed extension points as §3.1/3.2/3.3/3.6/3.9; state §3.4/3.5/3.7/3.8 land in this PR.
- [ ] **Step 2:** §3.2 "Current OSS state" (lines ~68-74): replace the stale "HTTP entry guard is a stub / hardcoded LOCAL_ACTOR / no real validation" with the real PR4a/4b state (Bearer `ph_*` validated via `LocalUserTokenVerifier`; UI channel trusted header / LOCAL_ACTOR fallback).
- [ ] **Step 3:** §3.3 (line ~228) "MCP channel has no pre-validation" → describe the real MCP server (link `09-mcp-server.md`).
- [ ] **Step 4:** §7 table: add `(landed)` to PR1, PR3, PR5, PR6, PR7, PR9, PR10; add a note that PR2/4a/4b/11 were already landed.
- [ ] **Step 5:** Run `pnpm spec:terms`. Commit `docs(spec): backfill 08 landed state`.

---

## Task Group 1 — PR1 scaffolding (abstract tokens + decorator + register)

> Everything downstream depends on this. Land it before the self-contained groups.

### Task 1.1: `LimiterKeyStrategy` abstract + Local default

**Files:** Create `packages/core/src/server/common/contracts/limiter-key.strategy.ts`; Test `.../contracts/__tests__/local-limiter-key-strategy.spec.ts`

- [ ] **Step 1: Write failing test**
```ts
import { describe, expect, it } from 'vitest';
import { LocalLimiterKeyStrategy } from '../limiter-key.strategy';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';

describe('LocalLimiterKeyStrategy', () => {
  it('returns model:<modelId> ignoring actor/project', () => {
    const s = new LocalLimiterKeyStrategy();
    const actor = { actorId: 'a', actorKind: 'script' as const };
    expect(s.buildModelKey(actor, LOCAL_PROJECT_CONTEXT, 'gpt-x')).toBe('model:gpt-x');
  });
});
```
- [ ] **Step 2:** Run `pnpm --filter @proofhound/core test local-limiter-key-strategy` → FAIL (module missing).
- [ ] **Step 3: Implement**
```ts
import type { ActorContext } from '../actor-context';
import type { ProjectContext } from '@proofhound/shared';

export abstract class LimiterKeyStrategy {
  abstract buildModelKey(actor: ActorContext, project: ProjectContext, modelId: string): string;
}

export class LocalLimiterKeyStrategy extends LimiterKeyStrategy {
  buildModelKey(_actor: ActorContext, _project: ProjectContext, modelId: string): string {
    return `model:${modelId}`;
  }
}
```
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit `feat(contracts): add LimiterKeyStrategy + LocalLimiterKeyStrategy`.

### Task 1.2: `WorkflowAuthorizationHook` abstract + no-op Local + `WorkflowKind`

**Files:** Create `.../contracts/workflow-authorization.hook.ts`; Test `.../__tests__/local-workflow-authorization-hook.spec.ts`

- [ ] **Step 1: Write failing test**
```ts
import { describe, expect, it } from 'vitest';
import { LocalWorkflowAuthorizationHook } from '../workflow-authorization.hook';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';

describe('LocalWorkflowAuthorizationHook', () => {
  it('passes (no-op) for any actor/workflow', async () => {
    const hook = new LocalWorkflowAuthorizationHook();
    await expect(
      hook.assertCanStart({ actorId: 'a', actorKind: 'script' }, LOCAL_PROJECT_CONTEXT, 'experiment'),
    ).resolves.toBeUndefined();
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (`WorkflowKind` reconciled with SPEC 03: workflows `experiment`/`optimization`, queues `llm`/`probe`, in-server `release` runner)
```ts
import type { ActorContext } from '../actor-context';
import type { ProjectContext } from '@proofhound/shared';

export type WorkflowKind = 'experiment' | 'optimization' | 'release' | 'llm' | 'probe';

export abstract class WorkflowAuthorizationHook {
  abstract assertCanStart(actor: ActorContext, project: ProjectContext, workflow: WorkflowKind): Promise<void>;
}

export class LocalWorkflowAuthorizationHook extends WorkflowAuthorizationHook {
  async assertCanStart(): Promise<void> {
    /* OSS no-op: the single local project authorizes all workflow starts. */
  }
}
```
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(contracts): add WorkflowAuthorizationHook + WorkflowKind`.

### Task 1.3: `ConnectorContextResolver` abstract + result type

**Files:** Create `.../contracts/connector-context.resolver.ts` (abstract only this task; Local impl in Group 4)

- [ ] **Step 1: Implement the contract** (no test yet — pure interface; Local impl tested in Task 4.1)
```ts
import type { ActorContext, ProjectContext } from '../actor-context';
import type { ConnectorRecord } from './types-connector'; // see Task 4.1 for the row shape source

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
> NOTE: `ProjectContext` is re-exported from `../actor-context`? Verify at exec — it is defined in `@proofhound/shared`. Import from `@proofhound/shared` if `actor-context` does not re-export it.
- [ ] **Step 2:** `pnpm --filter @proofhound/core typecheck` → may fail until `ConnectorRecord` exists (Task 4.1). Defer commit to Task 4.1, OR stub `ConnectorRecord` now. Decision: define `ConnectorRecord` in this file from `WebhookConnectorRow` (Task 4.1 wires the real shape). Commit together with Task 4.1.

### Task 1.4: `@CurrentProject()` decorator

**Files:** Create `.../common/decorators/current-project.decorator.ts`; Test `.../decorators/__tests__/current-project.decorator.spec.ts`

- [ ] **Step 1: Write failing test** (decorator factory reads `request.projectContext`)
```ts
import { describe, expect, it } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { extractCurrentProject } from '../current-project.decorator';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';

function ctxWith(req: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as ExecutionContext;
}

describe('@CurrentProject', () => {
  it('returns request.projectContext', () => {
    expect(extractCurrentProject(undefined, ctxWith({ projectContext: LOCAL_PROJECT_CONTEXT }))).toBe(LOCAL_PROJECT_CONTEXT);
  });
  it('falls back to LOCAL_PROJECT_CONTEXT when absent', () => {
    expect(extractCurrentProject(undefined, ctxWith({}))).toEqual(LOCAL_PROJECT_CONTEXT);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (export `extractCurrentProject` for testability; `createParamDecorator` wraps it — mirror `current-user.decorator.ts`)
```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';

export function extractCurrentProject(_data: unknown, ctx: ExecutionContext): ProjectContext {
  const req = ctx.switchToHttp().getRequest<{ projectContext?: ProjectContext }>();
  return req.projectContext ?? LOCAL_PROJECT_CONTEXT;
}

export const CurrentProject = createParamDecorator(extractCurrentProject);
```
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(contracts): add @CurrentProject decorator`.

### Task 1.5: `HttpActorGuard` resolves + attaches `request.projectContext`

**Files:** Modify `.../contracts/http-actor.guard.ts`; Test `.../contracts/__tests__/http-actor.guard.spec.ts` (extend)

- [ ] **Step 1: Extend failing test** — guard sets `request.projectContext` from the injected `ProjectContextResolver` using `x-project-id` hint.
```ts
it('resolves and attaches request.projectContext', async () => {
  const resolver = { resolveFromHttp: async () => ({ actorId: 'a', actorKind: 'local_user' as const }) };
  const projectResolver = { resolve: async () => LOCAL_PROJECT_CONTEXT };
  const guard = new HttpActorGuard(resolver as any, projectResolver as any);
  const req: any = { headers: { 'x-project-id': 'p1' } };
  await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
  expect(req.projectContext).toBe(LOCAL_PROJECT_CONTEXT);
  expect(req.user.actorKind).toBe('local_user');
});
```
- [ ] **Step 2:** Run → FAIL (constructor arity).
- [ ] **Step 3: Implement** — add `ProjectContextResolver` constructor dep; after resolving actor:
```ts
const project = await this.projectResolver.resolve(actor, {
  projectIdHeader: readHeader(request, 'x-project-id'),
});
request.projectContext = project;
```
(Read the header defensively as in the resolver; `request.user = toCurrentUserPayload(actor)` stays.)
- [ ] **Step 4:** Run guard specs (incl. existing registration spec) → PASS.
- [ ] **Step 5:** Commit `feat(guard): resolve project context in HttpActorGuard`.

### Task 1.6: Register new tokens in `LocalContractsModule`

**Files:** Modify `.../contracts/local-contracts.module.ts`, `.../contracts/index.ts`

- [ ] **Step 1: Write failing test** `.../__tests__/local-contracts-bindings.spec.ts` — compile a testing module importing `LocalContractsModule` and assert `moduleRef.get(LimiterKeyStrategy)` / `WorkflowAuthorizationHook` resolve to Local instances.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — add providers/exports:
```ts
{ provide: LimiterKeyStrategy, useClass: LocalLimiterKeyStrategy },
{ provide: WorkflowAuthorizationHook, useClass: LocalWorkflowAuthorizationHook },
```
(ConnectorContextResolver binding handled in the webhook contracts module — Task 4.2 — since the webhook app consumes it; if the server app also needs it, add it here too.) Re-export the new abstracts from `contracts/index.ts`.
- [ ] **Step 4:** Run → PASS; `pnpm --filter @proofhound/core typecheck`.
- [ ] **Step 5:** Commit `feat(contracts): bind LimiterKeyStrategy + WorkflowAuthorizationHook in LocalContractsModule`.

---

## Task Group 7 — PR7 TokenService abstraction

### Task 7.1: Extract `abstract TokenService` + `LocalTokenService`

**Files:** Modify `packages/core/src/server/modules/token/token.service.ts`, `token.module.ts`; Modify spec `token.service.spec.ts`

- [ ] **Step 1: Update test** — `token.service.spec.ts:59` currently instantiates concrete `TokenService`. Change to instantiate `LocalTokenService` (constructor unchanged: repo, crypto, accessControl). Add an assertion `expect(service).toBeInstanceOf(TokenService)`.
- [ ] **Step 2:** Run `pnpm --filter @proofhound/core test token.service` → FAIL (LocalTokenService missing).
- [ ] **Step 3: Implement** — in `token.service.ts`:
  - Define `export abstract class TokenService { abstract listUserTokens(...): ...; abstract createUserToken(...): ...; abstract updateUserToken(...): ...; abstract revealUserToken(...): ...; abstract deleteUserToken(...): ...; }` with the **existing** method signatures (carry over `CurrentUserPayload` + `ActionSource` params).
  - Rename the current concrete class to `@Injectable() export class LocalTokenService extends TokenService { ... }` (body unchanged).
  - In `token.module.ts`: `providers: [TokenRepository, LocalTokenService, { provide: TokenService, useClass: LocalTokenService }]`, `exports: [TokenService]`.
- [ ] **Step 4:** Run token specs → PASS. `pnpm --filter @proofhound/core typecheck` (TokenController + token.tools import `TokenService` as a type/DI — still resolves).
- [ ] **Step 5:** Commit `feat(token): extract abstract TokenService + LocalTokenService (PR7)`.

---

## Task Group 10 — PR10 WorkflowAuthorizationHook integration

### Task 10.1: Gate server workflow/job starts

**Files:** Modify `experiment.service.ts`, `optimization.service.ts`, `release-line/release-runner.service.ts`, and the relevant launchers; inject `WorkflowAuthorizationHook`.

- [ ] **Step 1: Write failing test** — e.g. `experiment.service.spec.ts`: provide a spy `WorkflowAuthorizationHook` whose `assertCanStart` throws; assert `launch()` rejects before any DBOS start / payload write. (Use the existing experiment service test harness; add the hook to its providers.)
- [ ] **Step 2:** Run → FAIL (hook not called).
- [ ] **Step 3: Implement** — inject `private readonly workflowAuth: WorkflowAuthorizationHook` into each starting Service; before the launcher/enqueue call add `await this.workflowAuth.assertCanStart(toActorContext(actor), project, 'experiment' /* or 'optimization' | 'release' */);`. Sites (from audit): experiment launch/resume/retry, optimization launch/resume, release-runner enqueue.
- [ ] **Step 4:** Run the affected specs → PASS.
- [ ] **Step 5:** Commit `feat(orchestration): gate workflow starts with WorkflowAuthorizationHook (server)`.

### Task 10.2: Gate webhook enqueue

**Files:** Modify `packages/core/src/webhook/channels/webhook/webhook.service.ts` (~:128 enqueue); webhook contracts wiring.

- [ ] **Step 1: Write failing test** in `webhook.service.spec.ts` — hook throws → inbound does not enqueue.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — inject the hook into `WebhookService`; before enqueue: `await this.workflowAuth.assertCanStart(connectorActor, projectContext, 'llm');` (actor + project from the connector resolver — Group 4).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(webhook): gate enqueue with WorkflowAuthorizationHook`.

---

## Task Group 4 — PR6 ConnectorContextResolver extraction

### Task 4.1: `LocalConnectorContextResolver` (preserve expired/invalid distinction)

**Files:** Modify `connector-context.resolver.ts` (finalize `ConnectorRecord`), Create `local-connector-context.resolver.ts`; Test `.../__tests__/local-connector-context-resolver.spec.ts`. Reuse `WebhookRepository.findConnectorWithValidToken`.

- [ ] **Step 1: Write failing tests** — (a) valid token → `{ connector, projectContext:{projectId: connector.project_id...}, actorContext:{actorKind:'system_webhook', actorId: connector.id} }` + `webhookTokenId` exposed; (b) no row → throws `UnauthorizedException('invalid_webhook_token')`; (c) row with past `tokenExpiresAt` → throws `expired_webhook_token`. Mock the repo.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — move the body of `WebhookService.authorizeConnector` into `LocalConnectorContextResolver.resolveFromWebhookToken(slug, pathName, token)`: hash token, `repo.findConnectorWithValidToken`, throw `invalid_webhook_token` if missing, check `tokenExpiresAt` → `expired_webhook_token`, touch last-used, then build and return `ConnectorResolveResult` (+ surface `tokenId` for the payload — extend the result type with `webhookTokenId: string`). `ConnectorRecord` = the `WebhookConnectorRow` shape.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(webhook): add LocalConnectorContextResolver (PR6)`.

### Task 4.2: Wire the resolver into the webhook runtime

**Files:** Modify `webhook.service.ts` (call resolver instead of inline `authorizeConnector`), the webhook module's contracts binding (a `@Global` provider set or `{ provide: ConnectorContextResolver, useClass: LocalConnectorContextResolver }` in the webhook orchestration/auth module).

- [ ] **Step 1: Update test** — `webhook.service.spec.ts` asserts the injected `ConnectorContextResolver` is called and its `webhookTokenId`/actor/project propagate to the BullMQ payload + run_result (the audit confirmed `webhookTokenId` already flows; keep that assertion green).
- [ ] **Step 2:** Run → FAIL until wired.
- [ ] **Step 3: Implement** — inject `ConnectorContextResolver` into `WebhookService`; replace the private `authorizeConnector` call with `await this.connectorResolver.resolveFromWebhookToken(slug, pathName, token)`; remove the now-dead private method. Bind `LocalConnectorContextResolver` in the webhook module. Keep `webhookTokenId` payload plumbing.
- [ ] **Step 4:** Run webhook specs → PASS; `pnpm --filter @proofhound/core typecheck`.
- [ ] **Step 5:** Commit `refactor(webhook): route inbound auth through ConnectorContextResolver`.

---

## Task Group 9 — PR9 LimiterKeyStrategy integration

### Task 9.1: `packages/limiter` — `modelId` → `key`

**Files:** Modify `packages/limiter/src/types.ts` (lines with `modelId`), `redis-limiter.ts` (key builders ~:473-486, `keys(modelId)`); Tests in `packages/limiter`.

- [ ] **Step 1: Update tests** — limiter unit tests referencing `{ modelId }` switch to `{ key }`; assert composed keys use the passed `key` (e.g. `acquire({ key: 'model:gpt-x', ... })` → redis keys `ph:limiter:llm:model:gpt-x:rpm` etc.). Keep `keyPrefix` default.
- [ ] **Step 2:** Run `pnpm --filter @proofhound/limiter test` → FAIL.
- [ ] **Step 3: Implement** — rename `modelId: string` → `key: string` on `AcquireArgs`/`ReleaseArgs`/`ReportOutcomeArgs`/`getUsage`; `keys(key)` composes `${keyPrefix}:${key}:rpm|tpm|tpm:total|concurrency|autostate`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `refactor(limiter): key by opaque string instead of modelId (PR9)`.

### Task 9.2: `@proofhound/llm-client` forwards opaque `limiterKey`

**Files:** Modify `packages/llm-client/src/types.ts` (`RateLimiterLike` + invoke args), `invoke.ts` (all `deps.limiter.*` calls).

- [ ] **Step 1: Update tests** — llm-client invoke tests pass `limiterKey` in args and a fake limiter keyed by `key`; assert `acquire/release/reportOutcome` receive `{ key: limiterKey }`.
- [ ] **Step 2:** Run `pnpm --filter @proofhound/llm-client test` → FAIL.
- [ ] **Step 3: Implement** — add `limiterKey: string` to the invoke args (NOT actor/project — keeps §8). Replace every `modelId: invocationArgs.model.id` in limiter calls with `key: invocationArgs.limiterKey`; `RateLimiterLike.acquire/release/reportOutcome/getUsage` use `key`. Probe path uses `args.limiterKey`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `refactor(llm-client): thread opaque limiterKey (PR9)`.

### Task 9.3: Core runtime builds the key via the strategy

**Files:** Modify the worker llm-runner / `llm.consumer` and any server invoke path that assembles `invoke` args; inject `LimiterKeyStrategy`.

- [ ] **Step 1: Write failing test** — runner test: with `LocalLimiterKeyStrategy`, the `limiterKey` passed to `invoke` equals `model:<modelId>`; verify the strategy is consulted with the job's actor/project.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — inject `LimiterKeyStrategy`; before calling `invoke`, compute `const limiterKey = this.limiterKeyStrategy.buildModelKey(actor, project, model.id);` (actor/project from the BullMQ payload; OSS strategy ignores them — verify the payload carries enough, else pass a system actor + `LOCAL_PROJECT_CONTEXT`). Pass `limiterKey` into the invoke args. Bind `LimiterKeyStrategy` in the worker module (`proofhound-worker.module.ts`) — the worker is not a `forRoot` contracts consumer, so provide `{ provide: LimiterKeyStrategy, useClass: LocalLimiterKeyStrategy }` directly in the worker module.
- [ ] **Step 4:** Run → PASS; `pnpm --filter @proofhound/core test`.
- [ ] **Step 5:** Commit `feat(worker): build limiter key via LimiterKeyStrategy (PR9)`.

---

## Task Group 3 — PR3 controller convergence

### Task 3.1: Convert controllers to `@CurrentProject`

**Files:** Modify the 13 server controllers that call `resolveProjectContext(actor)` (dataset, prompt, experiment, optimization, run-result, annotation, canary-release, release-line, connector, monitoring, dataset-import, + any others found by grep). Pattern is identical per controller.

- [ ] **Step 1: Write failing route test** — an HTTP e2e (Nest testing app with `LocalContractsModule`) hits `GET /datasets`; assert the controller receives a resolved `ProjectContext` (LOCAL) via the guard, not via the sync helper. (If a route harness exists from PR4b's guard tests, extend it.)
- [ ] **Step 2:** Run → FAIL or rely on the conversion.
- [ ] **Step 3: Implement the pattern** in each controller:
  - Replace `resolveProjectContext(actor).projectId` with a new `@CurrentProject() project: ProjectContext` parameter → `project.projectId`.
  - Remove the `import { resolveProjectContext } from '../../common/project-context';` line.
  - Add `import { CurrentProject } from '../../common/decorators/current-project.decorator';` and `import type { ProjectContext } from '@proofhound/shared';`.
  - Example (dataset.controller.ts `listDatasets`):
    ```ts
    async listDatasets(@CurrentProject() project: ProjectContext, @CurrentUser() actor: CurrentUserPayload) {
      return this.datasetService.listDatasets(project.projectId, actor);
    }
    ```
- [ ] **Step 4:** Run `pnpm --filter @proofhound/core test` + `pnpm --filter @proofhound/core typecheck` → PASS. Grep to confirm `resolveProjectContext(` has 0 remaining controller callers.
- [ ] **Step 5:** Commit `refactor(server): converge controllers onto @CurrentProject (PR3)`.

---

## Task Group 5 — PR5 + MCP server transport (greenfield)

### Task 5.1: Add the MCP SDK dependency

**Files:** Modify `packages/core/package.json`

- [ ] **Step 1:** `pnpm --filter @proofhound/core add @modelcontextprotocol/sdk`.
- [ ] **Step 2:** `pnpm install` (workspace) → lockfile updates.
- [ ] **Step 3:** Commit `chore(core): add @modelcontextprotocol/sdk`.

### Task 5.2: `mcp-server.factory.ts` — register tools onto an SDK server

**Files:** Create `.../channels/mcp/mcp-server.factory.ts`; Test `.../channels/mcp/__tests__/mcp-server.factory.spec.ts`

- [ ] **Step 1: Write failing test** — factory builds a server from the tool aggregators + an `McpToolContext`; calling a registered tool by name routes to its `handler(input, ctx)` and returns the Service result. (Test against the SDK `Server`'s in-memory request handling, or a thin `registerTools(server, defs, ctx)` unit that we can assert directly — prefer the latter for a pure unit.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — `createMcpServer(tools: McpToolDefinition[], ctx: McpToolContext)`: instantiate the SDK `Server`/`McpServer`, `setRequestHandler` for `tools/list` (map name/description/inputSchema) and `tools/call` (look up by name → `handler(args, ctx)` → wrap result as MCP content; map thrown errors to JSON-RPC errors). Collect tools from `channels/mcp/index.ts` aggregators (each needs its Service — see Task 5.4 for DI).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(mcp): tool registration factory`.

### Task 5.3: `mcp.transport.ts` — Streamable HTTP + auth per request

**Files:** Create `.../channels/mcp/mcp.transport.ts`; Test `.../__tests__/mcp.transport.spec.ts`

- [ ] **Step 1: Write failing tests** — (a) request without `Authorization` → 401 with `missing_user_token` (or `invalid_user_token`) via `McpDispatchContextFactory`; (b) valid `ph_*` header → `McpDispatchContextFactory.build({ headers })` returns a ctx and the server handles `tools/list`. Mock `McpAuthResolver`/`ProjectContextResolver` or use Local with a seeded token.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — an injectable `McpTransportService` that, per request: builds `McpToolContext` via `McpDispatchContextFactory.build({ headers: req.headers })`, creates a stateless `StreamableHTTPServerTransport`, connects it to `createMcpServer(tools, ctx)`, and calls `transport.handleRequest(req, res, body)`. Catch `UnauthorizedException` → respond 401. Remove reliance on `getMcpActor`'s legacy fallback (now ctx.actor is always injected).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(mcp): streamable-HTTP transport with per-request auth`.

### Task 5.4: `mcp.controller.ts` + `mcp.module.ts` + server module wiring

**Files:** Modify `mcp.controller.ts`; Create `mcp.module.ts`; Modify `proofhound-server.module.ts`

- [ ] **Step 1: Write failing e2e** — boot a Nest testing app with `McpModule` + `LocalContractsModule` + a seeded `ph_*` token; `POST /mcp` an MCP `initialize` + `tools/list`; assert tools are listed; assert a bad token → 401.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — `McpController` with `@Post()`/`@Get()`/`@Delete()` delegating to `McpTransportService.handle(req, res)`; `McpModule` provides `McpTransportService`, `McpDispatchContextFactory`, the tool-aggregator providers (each tool group needs its Service — import the feature modules or a façade that exposes the Services); import `McpModule` in `ProofHoundServerModule.forRoot`. The `@Controller('mcp')` is **not** under `@UseGuards(HttpActorGuard)` (MCP auth is the transport's job via `McpAuthResolver`, not the HTTP actor guard).
- [ ] **Step 4:** Run e2e → PASS; `pnpm --filter @proofhound/core test`.
- [ ] **Step 5:** Commit `feat(mcp): mount MCP server at /mcp (PR5)`.

### Task 5.5: Remove the legacy `getMcpActor` fallback

**Files:** Modify `mcp-context.ts`

- [ ] **Step 1: Update test** — `getMcpActor(ctx)` with no `ctx.actor` now throws `UnauthorizedException`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — delete the synthesized-default branch; `if (!ctx.actor) throw new UnauthorizedException('missing_user_token');`. Remove the `TODO(mcp-transport)` comments.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `refactor(mcp): require resolver-injected actor (remove fallback)`.

---

## Task Group F — Final verify + SPEC landed markers

### Task F.1: Full gate

- [ ] **Step 1:** `pnpm typecheck` → PASS.
- [ ] **Step 2:** `pnpm lint` (`lint:fix` if needed) → PASS.
- [ ] **Step 3:** `pnpm test` → PASS.
- [ ] **Step 4:** `pnpm deps:check` (madge) → no new cycles; `pnpm spec:terms` → PASS.
- [ ] **Step 5:** If a live UI/MCP path changed and services are running, run the relevant Playwright smoke (ask the user to start services per constraint #17 — do NOT self-start).

### Task F.2: Flip remaining `(landed)` markers + i18n check

- [ ] **Step 1:** Confirm SPEC 08 §7 markers match the now-landed code (done in H1.2; re-verify).
- [ ] **Step 2:** No new user-facing strings expected; if any were added, sync `apps/web/src/i18n` zh-CN/en-US (constraint #13). MCP tool descriptions already exist.
- [ ] **Step 3:** Commit any final SPEC/i18n touch-ups.

---

## Self-Review

**Spec coverage:** PR1 → Group 1 (+ leftover ConnectorContextResolver token bound in Group 4.2). PR3 → Group 3. PR5 → Group 5. PR6 → Group 4. PR7 → Group 7. PR9 → Group 9. PR10 → Group 10. SPEC sync → Group H1 + F.2. MCP server SPEC → H1.1. ✅ all covered.

**Placeholder scan:** Two deferred specifics are intentional and flagged for exec-time confirmation (the `ProjectContext` import source in Task 1.3; the BullMQ payload's actor/project availability in Task 9.3) — resolve by reading the file before editing, not by guessing.

**Type consistency:** `LimiterKeyStrategy.buildModelKey(actor, project, modelId)`, `WorkflowAuthorizationHook.assertCanStart(actor, project, workflow)`, limiter `key` (consistent across Tasks 9.1–9.3), `ConnectorResolveResult` (Tasks 1.3/4.1) — names match across tasks.

**Ordering:** H1 → 1 → {7,10,4,9} → 3 → 5 → F. Group 3 depends on Group 1 (decorator). Group 9.3 depends on 1.1 + worker binding. Group 4.2 + 10.2 depend on 4.1.
