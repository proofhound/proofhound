# ProofHound

The ProofHound open-source edition targets self-hosted scenarios, providing a single-workspace prompt lifecycle toolset: prompt versions, dataset regression testing, experiments, optimizations, canary releases, production releases, run results, annotations, and rollbacks.

The repository keeps thin abstractions such as `project_id`, `ProjectContext`, `ActorContext`, and `accessControl` for the local single-project data boundary and future external control plane integration; product documentation narrates around a single workspace by default and does not expand on a control plane feature list.

This repository carries only OSS self-hosted capabilities. Future SaaS / control plane capabilities are carried by a separate repository; this repository's architecture may leave clean, thin, currently usable interface hooks, but must not pre-embed modules, features, dependencies, or product entry points that are currently useless for the sake of SaaS.

> Solo project (ZiqiXiao). Codex assists with implementation, ZiqiXiao holds all decision-making authority. When uncertain, ask first; do not rehearse all the way to the end only to discover the direction was wrong.

> `AGENTS.md` is the single source of truth. `CLAUDE.md` is a symlink to this file — edit only this file.

## 1. Tech Stack

| Layer    | Choice                                                                     |
| -------- | -------------------------------------------------------------------------- |
| Frontend | Next.js + TypeScript + Refine + shadcn/ui + Tailwind                       |
| Backend  | NestJS + TypeScript monolith, split along Module boundaries               |
| Database | Native PostgreSQL + Drizzle ORM, schema prefix `ph_*`                      |
| Auth     | Dual-channel HTTP entry (API `Authorization: Bearer ph_*` user token / UI deployment-layer trusted header or LOCAL_ACTOR fallback); MCP entry user token; Webhook entry per-connector webhook token; OSS ships no built-in login system, deployment forms A/B/C detailed in [08](docs/specs/08-saas-adapter-boundary.md) |
| Storage  | Current OSS main path stores datasets / results in PostgreSQL; object storage is reserved until a real consumer exists |
| Realtime | React Query polling + NestJS SSE (business orchestration streaming)        |
| Orchestration | DBOS + BullMQ + Node.js LLM Worker                                    |
| Rate limit | Redis centralized rate limiting (RPM / TPM / concurrency)               |
| Logging  | Pino stdout JSON                                                           |
| Testing  | Vitest + Playwright                                                        |

## 2. Code Layout and Commands

```
proofhound/
├── apps/        server / webhook / worker / web
├── packages/    core / shared / db / crypto / logger / limiter / metrics / judgment / optimization-strategy / orchestration-shared / llm-client / connector-client / api-client / ui / web-ui
├── dev/         local development dependency services docker-compose
├── docs/specs/  open-source edition business SPEC
├── .agents/skills/
├── AGENTS.md / CLAUDE.md
└── pnpm-workspace.yaml / tsconfig.base.json
```

`@proofhound/core` (backend) and `@proofhound/web-ui` (frontend) hold the isomorphic, deployment-agnostic logic; `apps/*` are thin shells that inject the OSS/SaaS adapter contracts — server via `ProofHoundServerModule.forRoot({ contracts })`, web via `<ProofHoundWebProvider contracts>`.

Common commands (pnpm@10 + turbo orchestration):

| Purpose                                  | Command                                                       |
| ---------------------------------------- | ------------------------------------------------------------- |
| Start full-stack local dev (docker + migrate + 5 services) | `pnpm dev`                                  |
| Single service                           | `pnpm dev:server` / `dev:web` / `dev:worker` / `dev:webhook`  |
| Type check / Lint                        | `pnpm typecheck` / `pnpm lint` (`lint:fix` auto-fixes)        |
| Test                                     | `pnpm test` (= test:unit) / `pnpm test:e2e`                   |
| Migration                                | `pnpm db:generate` (generate) / `pnpm db:migrate` (apply)     |
| Reset / seed database                    | `pnpm db:reset` / `pnpm db:seed`                              |
| Full gate                                | `pnpm verify` = `typecheck + lint + test + deps:check + spec:terms` |
| Circular deps / terminology check        | `pnpm deps:check` (madge) / `pnpm spec:terms`                 |

> First run: after `cp .env.example .env`, fill in `DATABASE_URL` / `REDIS_URL`; `MODEL_API_KEY_ENCRYPTION_KEY` (@proofhound/crypto encrypts/decrypts the API Key) is an application-managed secret, and its absence will cause startup / invocation failures.

### Git workflow

- Branch naming: `<type>/<kebab>` aligned with Conventional Commits (`feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, …) — e.g. `refactor/contracts-forroot-override`.
- `master` is PR-only: no direct push (branch protection + `enforce_admins`). Squash-merge with a Conventional-Commit PR title so release-please categorizes it.
- The primary working directory stays on `master` by default. Unless explicitly told otherwise, do not check out a feature branch in the primary checkout — create a worktree (below) for any non-`master` development, so the primary tree always reflects `master`.
- Worktrees: the repo-root `worktrees/` directory is the designated home for branch-development worktrees. It is deliberately excluded from every root tool — `.gitignore` (`/worktrees/`), `.dockerignore` (`worktrees`), `pnpm-workspace.yaml` (`!worktrees/**`), and `.prettierignore` (`worktrees`) — so a nested checkout there is never tracked, copied into a Docker build context, treated as a pnpm workspace package, or rewritten by `pnpm format`. Always create worktrees under it, never elsewhere in the tree.
- Create with `mkdir -p worktrees && git worktree add worktrees/<name> -b <type>/<kebab> master` (a fresh `<type>/<kebab>` branch off `master`). Do not rely on tooling that forces a `worktree-` prefix or rewrites `/` to `+`; rename the branch to conform if it does.
- After creating a worktree, before working in it: (1) copy the local secrets from the primary worktree so the new tree can boot — `cp .env worktrees/<name>/.env` (`.env` is gitignored, so a fresh worktree starts without it); (2) build its own CodeGraph index with `cd worktrees/<name> && codegraph init -i` (`.codegraph` state is gitignored and per-worktree, so the index does not carry over).
- Keep the VS Code multi-root workspace in step with the live worktrees. The single workspace file lives at the main checkout's `.vscode/proofhound.code-workspace` (under the gitignored `.vscode/`, so it is per-machine and never committed; its `folders` paths are relative to `.vscode/`). When you **add** a worktree, append `{ "path": "../worktrees/<name>" }` to its `folders` array — create the file if it is missing, always keeping `{ "path": ".." }` (the main checkout) as the first entry, e.g. `{ "folders": [{ "path": ".." }, { "path": "../worktrees/<name>" }], "settings": {} }`. When you **remove** a worktree, delete the matching `folders` entry.

## 3. What to Read Before Starting

| What you want to do                      | Required SPEC                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Understand the overall loop / navigation | [00](docs/specs/00-overview.md) + [01](docs/specs/01-navigation.md)                                                                                                            |
| Unsure where code goes / package deps    | [07 Code structure](docs/specs/07-code-structure.md)                                                                                                                          |
| Change PostgreSQL / DB schema            | [04](docs/specs/04-postgresql.md) + [06](docs/specs/06-database-schema.md)                                                                                                     |
| Change DBOS / BullMQ / runner            | [03](docs/specs/03-orchestration.md) + the corresponding business SPEC                                                                                                        |
| Change logging / LLM invocation logs     | [05](docs/specs/05-logging.md) + [21](docs/specs/21-models.md)                                                                                                                 |
| Change models / datasets / prompts / experiments / optimizations | [21](docs/specs/21-models.md) + [22](docs/specs/22-datasets.md) + [23](docs/specs/23-prompts.md) + [24](docs/specs/24-experiments.md) + [25](docs/specs/25-optimizations.md) |
| Change connectors / releases / run results | [26](docs/specs/26-connectors.md) + [27](docs/specs/27-releases.md) + [30](docs/specs/30-run-results.md)                                                                     |
| Change quick start / settings page       | [33](docs/specs/33-quick-start.md) + [34](docs/specs/34-settings.md)                                                                                                          |
| Change entry authentication / token system / SaaS adapter interfaces | [08](docs/specs/08-saas-adapter-boundary.md)                                                                                                  |

## 4. OSS / SaaS Boundary

- The current repository prioritizes serving the complete, usable closed loop of the open-source self-hosted edition; any new architecture must be able to explain how it improves current OSS functionality, maintainability, or the local data boundary.
- Thin interfaces such as `project_id`, `ProjectContext`, `ActorContext`, `accessControl`, Provider interfaces, and API / MCP boundaries may be kept as future external SaaS control plane integration points; these interfaces must have an open-source default implementation that is genuinely used by current code paths. The full contract of the adapter extension points (`ProjectContextResolver` / `ActorContextResolver` / `McpAuthResolver` / `ConnectorContextResolver` / `TokenService` / `AccessControlService` / `LimiterKeyStrategy` / `WorkflowAuthorizationHook`) is in [08 Control Plane Adapter Boundary](docs/specs/08-saas-adapter-boundary.md).
- SaaS-exclusive capabilities such as organization / member / role permissions, tenant billing, plan quotas, hosted login, approvals, auditing, platform monitoring, alerting, and multi-project control plane are not implemented in this repository, nor pre-embedded via hidden menus, edition flags, empty migrations, empty Services, empty UI, or unused dependencies.
- The integration assumption between future SaaS and OSS is to connect through stable API / MCP / Provider / deployment configuration, rather than maintaining a hosted-only branch, a commercial-edition toggle, or a dual-form product in the same repository.
- If an abstraction only serves future SaaS and has no genuine caller or default behavior in the current OSS, do not add it yet; when uncertain, ask ZiqiXiao first.

## 5. Open-Source Edition Hard Constraints

1. For business-semantic changes, change the SPEC before changing the code; the SPEC is the source of truth.
2. The open-source edition has only one local project as the data boundary. Keep the `project_id` on all in-project business resources, the `projectId` / `ProjectContext` in Service inputs, and the Repository's `project_id` filtering; do not expand these abstractions into control plane features.
3. User-facing strings use the canonical product terminology consistently (do not invent synonyms): prompt version / run results / canary release / production release / Local admin app / API Token / global MCP Token.
4. Default physical deletion has been removed, and no new soft-delete flow is added; before deleting a prompt or prompt version you must list the affected experiments / optimizations / canary candidates / production release events.
5. A prompt version is frozen as soon as it is referenced, with a DB trigger as a backstop; do not bypass it.
6. A production release enters `running` as soon as it is submitted.
7. Run results are immutable once written; annotations are written to `ph_runs.annotations`.
8. Controllers only do parameter validation, authentication adaptation, and calling Service / workflow / queue; business logic lives in the Service.
9. DTOs use Zod `z.infer`, shared between frontend and backend.
10. Application logs are written only as stdout JSON; LLM invocations must record the complete inputs and responses before writing run results.
11. Rate limiting goes through Redis centralized counting; do not maintain quotas locally in-process.
12. PostgreSQL-first; do not depend on managed-platform proprietary SQL extensions.
13. Adding / modifying user-facing strings on the frontend goes through `apps/web/src/i18n`, keeping `zh-CN` / `en-US` in sync.
14. Frontend date-time is uniformly `YYYY/MM/DD HH:mm:ss`.
15. Frontend theme colors use semantic tokens; do not hardcode single-theme colors.
16. Every Service method that can be invoked by the frontend exposes a corresponding MCP tool in `apps/server/src/channels/mcp/`; UI internal state is exempt.
17. Do not start local development services (web / server / worker / database / Redis, etc.) on your own; when you need integration or verification, first check the relevant existing services, and if they are already running use them directly, otherwise ask the user to start them before continuing. Exception: when the user explicitly asks to run `pnpm test:e2e` / Playwright e2e, the test command may start its configured isolated e2e services (for example server / webhook / worker / web / fake LLM) and shut them down as part of the test run.

## 6. Definition of Done

- Business code is complete and the local main path runs.
- Unit tests cover Service / DBOS step / BullMQ handler / pure strategy functions.
- Frontend changes add a Playwright smoke when necessary.
- Frontend copy is synced across the Chinese and English i18n.
- DB schema changes go through a Drizzle migration, not manual `psql` edits to the database.
- Business semantics are synced to the SPEC.
- `pnpm verify` is green, or the delivery notes clearly state which items were not run and why.

## 7. Skill Routing

| Task                   | SKILL                           |
| ---------------------- | ------------------------------- |
| Unsure where to start  | `proofhound-overview`           |
| NestJS Module          | `proofhound-backend-module`     |
| DBOS / BullMQ / runner | `proofhound-dbos-workflow`      |
| LLM invocation         | `proofhound-llm-invocation`     |
| DB schema / migration  | `proofhound-database-migration` |
| Refine / frontend resource | `proofhound-frontend-resource`  |

## 8. What Not to Do

- Do not turn future control plane integration hooks into a same-repository branch or an open-source-edition business module.
- Do not pre-embed for future SaaS any edition flag, plan check, tenant UI, control plane route, empty table, empty Service, or unused dependency that the current OSS does not use.
- Do not remove the `project_id` data boundary.
- Do not write data directly to the database from the frontend; all writes go through the server.
- Do not reuse any entry token (user token / webhook token) with an external JWT; tokens are managed by the application layer.
- Do not let the user token and webhook token reuse the same scope / the same resolver; the user token (`scope='user'`) shares the HTTP API + MCP entries, the webhook token (`scope='webhook'`) is used only for inbound traffic of the corresponding connector, and the two credential systems are mutually independent.
- Do not truncate messages / response.content in LLM invocation logs unless they exceed the hard limit.
