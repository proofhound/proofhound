# 07 · Code Structure

This document explains how the open-source self-hosted repository is organized: what each directory does, how packages depend on one another, and where new code should go. The open-source repository only maintains the single-workspace product, keeping a single local project as the `project_id` data boundary.

## Contents

- [§1 Repository Principles](#1-repository-principles)
- [§2 Top-Level Layout](#2-top-level-layout)
- [§3 apps/server — NestJS Backend](#3-appsserver--nestjs-backend)
- [§4 apps/webhook — Webhook ingress](#4-appswebhook--webhook-ingress)
- [§5 apps/worker — LLM Worker](#5-appsworker--llm-worker)
- [§6 apps/web — Next.js Frontend](#6-appsweb--nextjs-frontend)
- [§7 packages — Shared Packages](#7-packages--shared-packages)
- [§8 Dependency Rules](#8-dependency-rules)
- [§9 Where New Code Goes](#9-where-new-code-goes)

## 1. Repository Principles

1. **One open-source product form**: This repository only maintains the self-hosted OSS edition.
2. **Local single-project boundary**: Public routes and the frontend are built around core business resources and provide no project management UI; business tables, DTOs, Services, and Repositories retain the `project_id` / `projectId` boundary. The current project is uniformly resolved through `ProjectContextProvider` / `resolveProjectContext`, and the OSS implementation returns the local project.
3. **Shared DTOs are the source of truth for contracts**: `packages/shared/src/dto/` defines the Zod schemas shared by the backend, the frontend, and the API client.
4. **Thin Controllers, business logic in Services**: REST / MCP / Webhook only handle authentication, validation, and adaptation; business semantics live in the same set of Services.
5. **Cross-cutting foundational capabilities go in packages**: Logging, rate limiting, the LLM client, connector drivers, and strategy packages are tested independently and do not depend back on apps.

## 2. Top-Level Layout

```text
proofhound/
├── apps/
│   ├── server/       # NestJS admin API / MCP / DBOS / BullMQ producer / runner service
│   ├── webhook/      # Standalone Webhook ingress
│   ├── worker/       # BullMQ LLM worker
│   └── web/          # Next.js + Refine + shadcn/ui frontend
├── packages/
│   ├── shared/       # Zod DTO / shared types
│   ├── db/           # Drizzle schema / migrations / seed
│   ├── api-client/   # HTTP client
│   ├── orchestration-shared/
│   ├── providers/
│   ├── logger/
│   ├── limiter/
│   ├── llm-client/
│   ├── connector-client/
│   ├── judgment/
│   ├── metrics/
│   ├── optimization-strategy/
│   └── ui/
├── dev/              # Local dependency services such as Redis / Kafka
├── docs/specs/       # Source of truth for features
├── .agents/skills/   # Codex skills
├── AGENTS.md
└── CLAUDE.md
```

## 3. apps/server — NestJS Backend

`apps/server` hosts the admin API, MCP, DBOS workflows, the BullMQ producer, and the long-running runner.

```text
apps/server/src/
├── app.module.ts
├── main.ts
├── channels/
│   └── mcp/
│       ├── token.tools.ts
│       ├── model.tools.ts
│       ├── dataset.tools.ts
│       ├── prompt.tools.ts
│       ├── connector.tools.ts
│       ├── experiment.tools.ts
│       ├── optimization.tools.ts
│       ├── canary-release.tools.ts
│       ├── production-release.tools.ts
│       ├── run-result.tools.ts
│       └── quick-start.tools.ts
├── common/
│   ├── actor-context.ts
│   ├── access-control.ts
│   ├── project-context.ts
│   ├── project-context.module.ts
│   ├── guards/local-http-actor.guard.ts
│   ├── decorators/current-user.decorator.ts
│   └── pipes/zod-validation.pipe.ts
├── infrastructure/
│   ├── llm/
│   ├── orchestration/
│   ├── redis/
│   └── storage/
└── modules/
    ├── token/
    ├── model/
    ├── dataset/
    ├── prompt/
    ├── connector/
    ├── experiment/
    ├── optimization/
    ├── canary-release/
    ├── production-release/
    ├── run-result/
    └── quick-start/
```

Standard layout for a business module:

```text
modules/prompt/
├── prompt.module.ts
├── prompt.controller.ts
├── prompt.service.ts
├── prompt.repository.ts
└── __tests__/
```

DTOs do not go into `apps/server/src/modules/*`. All request / response schemas live in `packages/shared/src/dto/`.

## 4. apps/webhook — Webhook ingress

`apps/webhook` only hosts public-facing webhooks:

- `/webhooks/*`
- `/healthz`
- `/readyz`

It is responsible for per-connector webhook token authentication (see [08](08-saas-adapter-boundary.md) §3.4 `ConnectorContextResolver`), payload size guards, basic validation, and enqueueing or acknowledging. Do not implement admin APIs in the webhook app, and do not import `apps/server` in reverse.

## 5. apps/worker — LLM Worker

`apps/worker` consumes the `llm` queue, executes LLM calls, and writes run results. It is unaware of the Web UI and does not directly implement business Controllers.

Core constraints:

- LLM calls go through Redis rate limiting first.
- LLM call logs must be written before the run result.
- Handlers must be idempotent; BullMQ retries must not duplicate factual results.
- Once a run result is written to `ph_runs.run_results`, it is immutable.

## 6. apps/web — Next.js Frontend

The frontend is the open-source local admin app, and the root path leads into core resources. The frontend does not show an explicit project selector and provides no project management UI; pages obtain the current project through `ProjectContextProvider` / `resolveProjectContext`. The OSS implementation always returns the local project, but the API client / DTOs may carry the `projectId` returned by the server.

```text
apps/web/src/app/
├── page.tsx                     # Redirects to /dashboard
├── dashboard/
├── monitoring/
├── models/
├── datasets/
├── prompts/
├── experiments/
├── optimizations/
├── comparisons/
├── connectors/
├── releases/
├── annotations/
├── settings/
├── canary-releases/
└── production-releases/
```

The three frontend layers:

| Layer | Location | Responsibility |
| -- | ---- | ---- |
| C1 | `packages/api-client/src/<resource>.ts` | HTTP client |
| C2 | `@proofhound/web-ui/hooks` | React Query hooks |
| C3 | `@proofhound/web-ui/screens` \| `@proofhound/web-ui/components` | Product screens and domain components |

`apps/web` is the OSS thin shell: 5–18 line route wrappers that import screens from `@proofhound/web-ui/screens`, chrome components (`components/layout/`: AppShell / sidebar / header), and the root `<ProofHoundWebProvider contracts={localWebContracts}>` wiring in `app/layout.tsx`. The chrome components are app-level and do not move into the shared package.

When adding or renaming pages, update the Playwright smoke tests accordingly. User-facing strings go through `@proofhound/web-ui/i18n` and must provide both `zh-CN` / `en-US`.

## 7. packages — Shared Packages

| Package | Responsibility |
| -- | ---- |
| `@proofhound/shared` | DTOs, Zod schemas, shared constants |
| `@proofhound/db` | Drizzle schema, migration, seed, reset |
| `@proofhound/api-client` | HTTP client shared by the frontend and scripts |
| `@proofhound/orchestration-shared` | DBOS workflow ids, BullMQ queues, job payload schemas |
| `@proofhound/providers` | Replaceable interfaces such as Storage / Realtime |
| `@proofhound/logger` | Pino factory and redact |
| `@proofhound/limiter` | Redis RPM / TPM / concurrency rate limiting |
| `@proofhound/llm-client` | LLM provider call wrapper |
| `@proofhound/connector-client` | Redis / Kafka / Webhook connector drivers |
| `@proofhound/judgment` | Judgment strategies |
| `@proofhound/metrics` | Offline experiment metric computation strategies |
| `@proofhound/optimization-strategy` | Optimization strategies |
| `@proofhound/ui` | Design system: shadcn atomic primitives + `cn()` + `Main` layout primitive + pure UI hooks + `UiStringsContext` |
| `@proofhound/web-ui` | Product UI: screens / hooks / i18n / providers / components / lib / contracts (see §4.2 of [08](08-saas-adapter-boundary.md) for subpath exports) |

## 8. Dependency Rules

```text
apps/*  -> packages/*
packages/api-client -> packages/shared
packages/db -> packages/shared (share types only when necessary)
packages/llm-client -> packages/logger
packages/connector-client -> packages/logger
packages/metrics / judgment / optimization-strategy -> packages/shared
packages/web -> packages/ui, packages/api-client, packages/shared
```

Forbidden:

- `packages/*` importing `apps/*`
- The frontend writing business data directly to the database
- The webhook app reusing the server's internal Services
- Expanding the `project_id` / `accessControl` abstractions into control-plane business modules
- Removing the `project_id` boundary on business resources or letting a Repository omit `project_id` filtering

## 9. Where New Code Goes

| Need | Location |
| ---- | ---- |
| New REST resource | `apps/server/src/modules/<resource>/` + `packages/shared/src/dto/` |
| New MCP tool | `apps/server/src/channels/mcp/<resource>.tools.ts` |
| New frontend screen (shared) | `packages/web/src/screens/<resource>/` + route wrapper in `apps/web/src/app/<resource>/page.tsx` |
| New API client | `packages/api-client/src/<resource>.ts` |
| New DB table / column | `packages/db/src/schema/` + migration |
| New BullMQ payload | `packages/orchestration-shared/src/` |
| New LLM provider | `packages/llm-client/src/` |
| New connector driver | `packages/connector-client/src/` |
| New judgment / metric / optimization strategy | `packages/judgment` / `packages/metrics` / `packages/optimization-strategy` |
