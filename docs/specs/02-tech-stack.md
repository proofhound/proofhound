# 02 · Tech Stack

This document describes the implementation choices for the open-source self-hosted edition. Feature semantics are defined by the individual business SPECs; the tech stack only describes "what carries them."

## 1. Overall Shape

```text
Web UI (Next.js + Refine + shadcn/ui)
        │ HTTPS / SSE
        ▼
apps/server (OSS process shell)
        │ mounts
        ▼
@proofhound/core/server (NestJS runtime)
  - REST management API / MCP
  - local actor injection
  - DBOS workflow runtime
  - BullMQ producer
  - release runner service
        │
        ├── PostgreSQL
        ├── Redis (BullMQ / limiter / PubSub)
        └── apps/worker (OSS process shell)
              └── @proofhound/core/worker (BullMQ LLM consumer)

apps/webhook (OSS process shell)
        └── @proofhound/core/webhook
              - standalone /webhooks/* ingress
              - Webhook token authentication (per-connector)
              - enqueue / acknowledgment
```

Entry-point authentication is uniformly constrained by SPEC 08 §3 / §3.2.1: the HTTP entry point is dual-channel (the API channel uses an `Authorization: Bearer ph_*` user token; the UI channel uses a deployment-layer trusted header or falls back to LOCAL_ACTOR, routed by `ActorContextResolver`); the MCP entry point uses the user token (sharing the same token resource pool as the HTTP API); the Webhook entry point uses a per-connector webhook token. The OSS edition does not ship a built-in login page or session system; for UI-channel credential forms, see SPEC 08 deployment topologies A/B/C.

## 2. Frontend

- Next.js App Router + TypeScript.
- Refine carries resource-based CRUD, Providers, and the form / table flows.
- shadcn/ui + Tailwind carry the UI.
- React Query carries caching, polling, and mutations.
- Runtime pages poll every 5 seconds by default; long text streams or high-frequency progress can use NestJS SSE.
- All user-facing strings go through `packages/web-ui/src/i18n` (`@proofhound/web-ui`), supporting only `zh-CN` / `en-US`.

## 3. Backend

- A NestJS monolith runtime published from `packages/core` as `@proofhound/core`, split into modules under `packages/core/src/server/modules/<resource>/` after the core extraction.
- `apps/server`, `apps/webhook`, and `apps/worker` are thin OSS process shells. They load env, configure process-level middleware / logging, and mount the matching core runtime; they are not library entry points.
- Controllers only handle parameter validation, local actor injection, calling the Service, starting a workflow, or enqueuing a job.
- Request entry points are uniformly converted into an `ActorContext`, and the default local `ProjectContext` is resolved via `ProjectContextProvider` / `resolveProjectContext`; business Services authorize actions through `accessControl.assertCan(...)`.
- DTOs uniformly come from the Zod schemas in `packages/shared/src/dto/`.
- MCP tools and REST entry points converge on the same set of Services.
- Webhook ingress lives independently as the core webhook runtime mounted by `apps/webhook` and does not mount the management API.

## 4. Data Layer

- PostgreSQL stores all business data.
- Drizzle ORM defines the schema and migrations.
- Dataset imports and current exports use PostgreSQL-backed flows; no object-storage provider is part of the current OSS runtime.
- Object storage remains a future extension point for real consumers such as offline image storage or signed export files (see [04 §4](04-postgresql.md#4-storage)).
- Database Realtime is not used for page subscriptions.
- No dependency on hosted-platform proprietary SQL extensions; stay PostgreSQL-first.

The open-source edition's business schemas are only:

- `ph_core` (a single local project + tokens)
- `ph_assets`
- `ph_runs`
- `ph_releases`

See [06 Database Schema](06-database-schema.md) for details.

## 5. Orchestration: DBOS + BullMQ + Runner

| Carrier               | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| DBOS workflow         | Multi-step recoverable tasks like experiments and optimizations |
| BullMQ `llm` queue    | All LLM calls                                        |
| server runner service | Long-running consumption for canary releases and production releases |
| BullMQ one-off job    | Background tasks such as exports and connectivity probes |

Run status, progress, and results are read from the business fact tables.

## 6. Rate Limiting

A model's RPM / TPM / concurrency caps are uniformly counted by a centralized Redis rate limiter. Experiments, optimizations, canary releases, production releases, the REST API, and MCP all share the same model quota.

Acquire before a call, release after it finishes; on a process crash, concurrency slots self-heal via TTL.

Concurrency supports an **automatic mode** (enabled by default): RPM / TPM are still manually entered by the user as caps, and the system derives target concurrency via Little's Law plus multiplicative back-off on upstream 429s (AIMD), self-tuning within `[1, concurrency cap]`, with state centrally maintained in Redis (a per-`modelId` autostate hash). See [21 §6.1](21-models.md#61-auto-concurrency) for details.

## 7. Connectors

Connectors support three kinds:

- Redis List / Stream
- Kafka topic
- Webhook input / output

Connector configuration is stored directly in `ph_assets.connectors`.

## 8. Testing

| Layer                 | Tool                                              |
| --------------------- | ------------------------------------------------- |
| Unit tests            | Vitest                                            |
| DBOS integration tests | Vitest + a real Postgres, with an isolated `dbos_test_*` schema |
| Frontend e2e          | Playwright smoke                                  |

DBOS integration tests must run serially: `pool: 'forks'`, `singleFork: true`, `fileParallelism: false`.

## 9. Deployment

- Local dependency services: `dev/docker-compose.yml` provides PostgreSQL / Redis / Kafka, etc.
- PostgreSQL: production uses standard PostgreSQL 14+.
- Object storage is not wired in the current OSS runtime; add a provider only when a concrete storage-backed feature needs it.
- Production target: server / webhook / worker / web are deployed as separate processes; log collection, retention, metrics, and tracing are the responsibility of the deployment environment.

## 10. Channel Consistency

The business semantics of the Web UI, REST API, Webhook, and MCP must converge on the same set of Services / workflows / runners. The only differences are in entry-point authentication, parameter adaptation, and response shape.
