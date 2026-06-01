# Extract `@proofhound/core` Runtime Package (PR0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the reusable server / webhook / worker backend runtime out of `apps/*` into a single new `packages/core` (`@proofhound/core`) with stable subpath exports, reducing `apps/server` / `apps/webhook` / `apps/worker` to thin process shells — with shared infrastructure de-duplicated in one step.

**Architecture:** One package `@proofhound/core` consumed as TS source (same convention as `@proofhound/shared` / `@proofhound/db`: `exports` point at `./src/*.ts`, wired via `tsconfig.base.json` `paths`, bundled by each shell's `nest build --webpack`). Internal layout: `src/server`, `src/webhook`, `src/worker` for per-runtime code, plus a new `src/shared` area for genuinely-shared infrastructure. Public surface = four subpaths: `@proofhound/core/server`, `/webhook`, `/worker`, `/contracts`. The server root module `AppModule` is renamed `ProofHoundServerModule` (keeps `.forRoot({ contracts })`).

**Tech Stack:** pnpm@10 workspace + turbo, NestJS 11, TypeScript 6, Vitest 4, webpack via `@nestjs/cli`, Drizzle ORM, BullMQ, DBOS, ioredis.

---

## Execution Corrections (discovered during implementation)

Two plan gaps surfaced when fixing imports (Task 6); both corrected:

- **`project-context` is NOT shared — it stays in `server/common/`.** `project-context.ts` imports server-only siblings (`actor-context`, `contracts/*`, `decorators/current-user.decorator`) and is never used by webhook/worker. Moving it to `src/shared` created a `shared → server` inversion. Correction: `project-context.ts` + `project-context.module.ts` live in `packages/core/src/server/common/` (their original home). Strike them from the Task 3 shared extraction and the Task 6 rewrite table.
- **`worker-concurrency.ts` moves INTO core, not the shell.** `worker/consumers/llm.consumer.ts` imports it at module-load (for the `@Processor` concurrency), so it must be `packages/core/src/worker/config/worker-concurrency.ts`. The worker barrel `@proofhound/core/worker` re-exports `DEFAULT_WORKER_CONCURRENCY` + `resolveWorkerConcurrency`; the worker shell's `env.schema.ts` imports them from `@proofhound/core/worker` (handled in Task 8). This overrides Judgment Call #4 for `worker-concurrency` only (`env.schema`/`listen-port` still stay in the shell).

## Judgment Calls For ZiqiXiao To Confirm At Plan Review

These are decisions this plan locked in; flag any you want changed before execution starts.

1. **New `src/shared/` area (beyond SPEC 07 §3 sketch).** SPEC §3 drew `infrastructure/*` only under `server/`. De-dup across runtimes requires a cross-runtime home, so this plan introduces `packages/core/src/shared/` for the truly-shared infra (`database`, `redis` + `redis-mutex`, `crypto`, `config`, `health`, `filters` — NOT `project-context`, see Execution Corrections). **Task 11 updates SPEC 07 §3 to show it.** Alternative rejected: keep shared infra under `server/` and have webhook/worker reach into `../../server/...` (creates webhook→server / worker→server coupling inside the package).

2. **Selective de-dup, not blanket.** Only the files proven identical or cleanly supersettable are merged. Per-runtime-by-nature files stay in their runtime subdir: `listen-port.ts` (server `SERVER_PORT`/4000 vs webhook `PORT`/4001), `bullmq` topology (server producer+self-consumer+DBOS vs webhook producer-only vs worker consumer), and `env.schema.ts` (different env subsets).

3. **One intentional behavior delta:** the unified `PinoExceptionFilter` takes a `serviceName` ctor arg and uses the server's richer behavior (logs 4xx as `warn` + 5xx as `error`). Webhook today logs 5xx only — after this it will also emit `warn` logs for 4xx. Logs-only change. Say so if you want webhook's old quieter behavior preserved (would add a `logClientErrors` flag).

4. **Process config (`env.schema.ts`, `listen-port.ts`, `worker-concurrency.ts`) stays in the shell** (`apps/*/src/`), next to `main.ts`, as per-runtime deployment concerns. This means a shell is `main.ts` + a tiny `config/` — slightly more than SPEC §4's literal "only `main.ts`". Alternative: move them into `packages/core/src/<runtime>/config` and export via the subpath. This plan keeps them in the shell; **Task 11 softens SPEC §4 wording to "`main.ts` + process config".**

5. **Shells keep their external npm deps.** webpack externalizes every non-`@proofhound/*` import as `commonjs`, so the bundled `dist/main.js` must resolve them from the app's own dependency tree (pnpm isolated node_modules does not hoist). Each shell therefore keeps its runtime npm deps **and** adds `@proofhound/core`. `@proofhound/core` also declares the full set (for its own typecheck/test). Some declared-dependency duplication is expected and correct.

6. **Single PR, internal checkpoints.** Per your call this is one PR0. The tasks below still verify (`typecheck` → `test` → `deps:check` → `build`) at boundaries so a break is localized, not discovered at the end.

---

## Target Layout

```text
packages/core/
├── package.json                 # @proofhound/core, subpath exports
├── tsconfig.json                # extends ../../tsconfig.base.json (decorators on)
├── tsconfig.build.json          # prod build excludes tests
├── vitest.config.ts             # swc + tsconfig-paths, includes src/**/*.spec.ts + test/**
└── src/
    ├── index.ts                 # re-exports the four subpaths
    ├── shared/                  # cross-runtime shared infra (NEW)
    │   ├── database/{database.module.ts,database.constants.ts}
    │   ├── redis/{redis.module.ts(superset),redis.constants.ts,redis-mutex.service.ts}
    │   ├── crypto/{crypto.module.ts,crypto.service.ts}
    │   ├── config/config.module.ts
    │   ├── project-context/{project-context.ts,project-context.module.ts}
    │   ├── health/{health.controller.ts,health.service.ts}
    │   └── filters/pino-exception.filter.ts   # parameterized by serviceName
    ├── server/
    │   ├── index.ts             # ProofHoundServerModule + server-facing re-exports
    │   ├── proofhound-server.module.ts        # was app.module.ts (AppModule)
    │   ├── channels/mcp/...
    │   ├── common/              # contracts/, decorators/, actor-context.ts, access-control.ts, errors/, pipes/
    │   ├── infrastructure/      # llm/, orchestration/ (DBOS+BullMQ); database/redis/crypto now from ../../shared
    │   └── modules/             # 12 business modules
    ├── webhook/
    │   ├── index.ts             # ProofHoundWebhookModule
    │   ├── proofhound-webhook.module.ts       # was app.module.ts (WebhookAppModule)
    │   ├── channels/webhook/...
    │   └── infrastructure/orchestration/      # webhook bullmq (producer-only, kept)
    └── worker/
        ├── index.ts             # ProofHoundWorkerModule
        ├── proofhound-worker.module.ts        # was worker.module.ts (WorkerModule)
        ├── consumers/, runners/, infrastructure/llm/, scripts/

apps/server/  apps/webhook/  apps/worker/
└── src/main.ts  + src/config/{env.schema.ts, listen-port.ts[, worker-concurrency.ts]}
    package.json (slim: @proofhound/core + externalized npm deps)
    nest-cli.json, webpack.config.js, tsconfig.json, tsconfig.build.json (server)
```

**Public exports (`packages/core/package.json`):**

| Subpath | Resolves to | Surface |
| -- | -- | -- |
| `@proofhound/core/server` | `src/server/index.ts` | `ProofHoundServerModule` |
| `@proofhound/core/webhook` | `src/webhook/index.ts` | `ProofHoundWebhookModule` |
| `@proofhound/core/worker` | `src/worker/index.ts` | `ProofHoundWorkerModule` |
| `@proofhound/core/contracts` | `src/server/common/contracts/index.ts` | abstract tokens + `Local*` defaults + `LocalContractsModule` |

---

## Task 1: Scaffold `packages/core` (configs + paths, no moves yet)

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsconfig.build.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts` (temporary empty barrel)
- Modify: `tsconfig.base.json:24-53` (add `@proofhound/core` paths)

- [ ] **Step 1: Create `packages/core/package.json`**

Dependency set = union of the three apps (server is already the superset; webhook/worker add nothing new).

```json
{
  "name": "@proofhound/core",
  "version": "0.0.0",
  "private": true,
  "description": "ProofHound reusable backend runtime: server / webhook / worker NestJS modules, contracts, local defaults, Services, Repositories",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server/index.ts",
    "./webhook": "./src/webhook/index.ts",
    "./worker": "./src/worker/index.ts",
    "./contracts": "./src/server/common/contracts/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint \"src/**/*.ts\"",
    "test": "vitest run",
    "test:unit": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "clean": "rm -rf dist .turbo tsconfig.tsbuildinfo"
  },
  "dependencies": {
    "@dbos-inc/dbos-sdk": "^4.18.10",
    "@nestjs/bullmq": "^11.0.4",
    "@nestjs/common": "^11.1.21",
    "@nestjs/config": "^4.0.4",
    "@nestjs/core": "^11.1.21",
    "@nestjs/platform-express": "^11.1.21",
    "@proofhound/connector-client": "workspace:*",
    "@proofhound/crypto": "workspace:*",
    "@proofhound/db": "workspace:*",
    "@proofhound/judgment": "workspace:*",
    "@proofhound/limiter": "workspace:*",
    "@proofhound/llm-client": "workspace:*",
    "@proofhound/logger": "workspace:*",
    "@proofhound/metrics": "workspace:*",
    "@proofhound/optimization-strategy": "workspace:*",
    "@proofhound/orchestration-shared": "workspace:*",
    "@proofhound/shared": "workspace:*",
    "bullmq": "^5.76.10",
    "drizzle-orm": "^0.45.2",
    "express": "^5.2.1",
    "ioredis": "^5.10.1",
    "jose": "^6.2.3",
    "jsonrepair": "^3.14.0",
    "kafkajs": "^2.2.4",
    "nestjs-pino": "^4.6.1",
    "pino": "^10.3.1",
    "pino-http": "^11.0.0",
    "postgres": "^3.4.9",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "sharp": "^0.34.5",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.1.21",
    "@swc/core": "^1.13.20",
    "@types/express": "^5.0.6",
    "@types/node": "^24.12.4",
    "@types/supertest": "^7.2.0",
    "@vitest/coverage-v8": "^4.1.6",
    "supertest": "^7.2.2",
    "tsx": "^4.21.1",
    "typescript": "^6.0.3",
    "unplugin-swc": "^1.5.7",
    "vite-tsconfig-paths": "^5.1.4",
    "vitest": "^4.1.6"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`** (mirrors the apps' decorator settings; `rootDir` repo root so `@proofhound/*` path imports resolve)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022",
    "outDir": "./dist",
    "tsBuildInfoFile": "./dist/.tsbuildinfo",
    "rootDir": "../../",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/core/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "exclude": [
    "dist",
    "node_modules",
    "test",
    "**/*.spec.ts",
    "**/__tests__/**",
    "vitest.config.ts"
  ]
}
```

- [ ] **Step 4: Create `packages/core/vitest.config.ts`** (same toolchain as the apps; include both co-located `__tests__` specs and the DBOS `test/` dir that will move here)

```ts
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'forks',
    setupFiles: ['reflect-metadata'],
    testTimeout: 10_000,
    passWithNoTests: true,
    coverage: { provider: 'v8', reportsDirectory: './coverage' },
  },
});
```

- [ ] **Step 5: Create temporary `packages/core/src/index.ts`**

```ts
// Temporary placeholder; real re-exports added in Task 9.
export {};
```

- [ ] **Step 6: Register `@proofhound/core` paths in `tsconfig.base.json`**

Add inside `compilerOptions.paths` (alongside the existing `@proofhound/*` entries):

```json
      "@proofhound/core": ["./packages/core/src/index.ts"],
      "@proofhound/core/server": ["./packages/core/src/server/index.ts"],
      "@proofhound/core/webhook": ["./packages/core/src/webhook/index.ts"],
      "@proofhound/core/worker": ["./packages/core/src/worker/index.ts"],
      "@proofhound/core/contracts": ["./packages/core/src/server/common/contracts/index.ts"],
```

- [ ] **Step 7: Install so pnpm links the new workspace package**

Run: `pnpm install`
Expected: lockfile updates, `@proofhound/core` recognized as a workspace package. No build errors (core is empty).

- [ ] **Step 8: Commit**

```bash
git add packages/core tsconfig.base.json pnpm-lock.yaml
git commit -m "chore(core): scaffold empty @proofhound/core package + tsconfig paths"
```

---

## Task 2: Move the three runtime trees into `packages/core` (wholesale, history-preserving)

Move whole subtrees with `git mv` so relative imports **within each tree** stay valid; only cross-tree (shared infra) imports break, fixed in Tasks 3–7.

**Files:** moves only (no content edits this task).

- [ ] **Step 1: Move the server runtime** (everything except the shell `main.ts` and `config/`)

```bash
cd packages/core
mkdir -p src/server
git mv ../../apps/server/src/app.module.ts        src/server/proofhound-server.module.ts
git mv ../../apps/server/src/channels             src/server/channels
git mv ../../apps/server/src/common               src/server/common
git mv ../../apps/server/src/infrastructure       src/server/infrastructure
git mv ../../apps/server/src/modules              src/server/modules
git mv ../../apps/server/src/sse                  src/server/sse
# server DBOS / integration tests
mkdir -p test
git mv ../../apps/server/test/dbos               test/dbos
```

Leave in `apps/server/src/`: `main.ts`, `config/`. (`config/__tests__/listen-port.spec.ts` stays with `config/`.)

- [ ] **Step 2: Move the webhook runtime**

```bash
mkdir -p src/webhook
git mv ../../apps/webhook/src/channels           src/webhook/channels
git mv ../../apps/webhook/src/common             src/webhook/common
git mv ../../apps/webhook/src/infrastructure     src/webhook/infrastructure
git mv ../../apps/webhook/src/app.module.ts      src/webhook/proofhound-webhook.module.ts
```

Leave in `apps/webhook/src/`: `main.ts`, `config/`.

- [ ] **Step 3: Move the worker runtime**

```bash
mkdir -p src/worker
git mv ../../apps/worker/src/consumers           src/worker/consumers
git mv ../../apps/worker/src/runners             src/worker/runners
git mv ../../apps/worker/src/infrastructure      src/worker/infrastructure
git mv ../../apps/worker/src/scripts             src/worker/scripts
git mv ../../apps/worker/src/worker.module.ts    src/worker/proofhound-worker.module.ts
```

Leave in `apps/worker/src/`: `main.ts`, `config/` (`env.schema.ts`, `worker-concurrency.ts`).

- [ ] **Step 4: Sanity check the move (do NOT typecheck yet — imports are knowingly broken)**

Run: `git status --short | grep -c '^R'`
Expected: a large number of renames (R) recorded; no files lost (`git status` shows only renames/moves, no deletions of un-moved files).

- [ ] **Step 5: Commit the raw move**

```bash
cd ../..
git add -A
git commit -m "refactor(core): move server/webhook/worker runtime trees into packages/core (no import fixes yet)"
```

---

## Task 3: Extract shared infra into `packages/core/src/shared` (de-dup, supersets)

Pull the genuinely-shared infra out of `src/server` into `src/shared`, reconciling the two superset files. The webhook/worker duplicate copies are removed in Task 4.

**Files:**
- Move: `src/server/infrastructure/database/*` → `src/shared/database/`
- Move: `src/server/infrastructure/redis/*` → `src/shared/redis/`
- Move: `src/server/infrastructure/crypto/*` → `src/shared/crypto/`
- Move: `src/server/config/config.module.ts` is in the shell — instead move `apps/server`'s config.module here (see Step 4)
- Move: `src/server/common/project-context.ts` + `project-context.module.ts` → `src/shared/project-context/`
- Move: `src/server/common/health.controller.ts` + `health.service.ts` (+ `__tests__/health.service.spec.ts`) → `src/shared/health/`
- Move: `src/server/common/filters/pino-exception.filter.ts` (+ `__tests__`) → `src/shared/filters/`
- Modify: `src/shared/redis/redis.module.ts` (superset), `src/shared/filters/pino-exception.filter.ts` (parameterize)

- [ ] **Step 1: Move database / redis / crypto from server infra to shared**

```bash
cd packages/core
mkdir -p src/shared/database src/shared/redis src/shared/crypto
git mv src/server/infrastructure/database/database.module.ts     src/shared/database/database.module.ts
git mv src/server/infrastructure/database/database.constants.ts  src/shared/database/database.constants.ts
git mv src/server/infrastructure/redis/redis.module.ts           src/shared/redis/redis.module.ts
git mv src/server/infrastructure/redis/redis.constants.ts        src/shared/redis/redis.constants.ts
git mv src/server/infrastructure/redis/redis-mutex.service.ts    src/shared/redis/redis-mutex.service.ts
git mv src/server/infrastructure/redis/__tests__                 src/shared/redis/__tests__
git mv src/server/infrastructure/crypto/crypto.module.ts         src/shared/crypto/crypto.module.ts
git mv src/server/infrastructure/crypto/crypto.service.ts        src/shared/crypto/crypto.service.ts
```

(Server's `redis.module.ts` is already the superset — it provides `RedisMutexService`. No content change needed here; webhook/worker will adopt it in Task 4.)

- [ ] **Step 2: Move project-context + health + filter to shared**

```bash
mkdir -p src/shared/project-context src/shared/health src/shared/filters
git mv src/server/common/project-context.ts          src/shared/project-context/project-context.ts
git mv src/server/common/project-context.module.ts   src/shared/project-context/project-context.module.ts
git mv src/server/common/health.controller.ts        src/shared/health/health.controller.ts
git mv src/server/common/health.service.ts           src/shared/health/health.service.ts
mkdir -p src/shared/health/__tests__
git mv src/server/common/__tests__/health.service.spec.ts  src/shared/health/__tests__/health.service.spec.ts
git mv src/server/common/filters/pino-exception.filter.ts  src/shared/filters/pino-exception.filter.ts
git mv src/server/common/filters/__tests__/pino-exception.filter.spec.ts  src/shared/filters/__tests__/pino-exception.filter.spec.ts
```

- [ ] **Step 3: Move the Nest ConfigModule wrapper to shared**

The shell `main.ts` no longer imports `ConfigModule` (the root module imports it). Move it from the server shell into shared:

```bash
mkdir -p src/shared/config
git mv ../../apps/server/src/config/config.module.ts  src/shared/config/config.module.ts
```

(`apps/server/src/config/` keeps `env.schema.ts`, `listen-port.ts`, and their `__tests__`.)

- [ ] **Step 4: Parameterize the shared `PinoExceptionFilter`**

Replace `packages/core/src/shared/filters/pino-exception.filter.ts` with the unified, service-named version (server's richer behavior; webhook gains 4xx `warn` logs — see Judgment Call #3):

```ts
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class PinoExceptionFilter implements ExceptionFilter {
  private readonly logger;

  constructor(serviceName = 'api') {
    this.logger = createLogger('exception.filter', { service: serviceName });
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: unknown }>();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const responseBody = this.toResponseBody(exception, status);
    const payload = {
      status,
      requestId: request.id,
      req: { method: request.method, url: request.originalUrl ?? request.url },
      errorClass: exception instanceof Error ? exception.constructor.name : typeof exception,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ ...payload, err: exception }, 'http_exception_thrown');
    } else if (status >= HttpStatus.BAD_REQUEST) {
      this.logger.warn({ ...payload, response: responseBody }, 'http_client_error');
    }

    response.status(status).json(responseBody);
  }

  private toResponseBody(exception: unknown, status: number): Record<string, unknown> {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        return { statusCode: status, message: body };
      }
      return body as Record<string, unknown>;
    }
    return { statusCode: status, message: 'Internal server error' };
  }
}
```

- [ ] **Step 5: Commit the shared extraction (imports still broken — next tasks fix)**

```bash
cd ../..
git add -A
git commit -m "refactor(core): extract shared infra (db/redis/crypto/config/project-context/health/filter) into src/shared"
```

---

## Task 4: De-duplicate webhook / worker infra → reuse `src/shared`

Delete the webhook/worker copies that are now redundant; point their modules at `src/shared`. Keep webhook's own `orchestration/` (producer-only BullMQ topology differs).

**Files:**
- Delete: `src/webhook/infrastructure/database/*`, `src/webhook/infrastructure/redis/*`, `src/webhook/common/health.*`, `src/webhook/common/filters/*`, `src/webhook/common/__tests__/health.service.spec.ts`
- Delete: `src/worker/infrastructure/database/*`, `src/worker/infrastructure/redis/*`
- Modify: `src/webhook/proofhound-webhook.module.ts`, `src/worker/proofhound-worker.module.ts`

- [ ] **Step 1: Remove webhook duplicate infra**

```bash
cd packages/core
git rm -r src/webhook/infrastructure/database src/webhook/infrastructure/redis
git rm src/webhook/common/health.controller.ts src/webhook/common/health.service.ts
git rm src/webhook/common/__tests__/health.service.spec.ts
git rm -r src/webhook/common/filters
```

(If `src/webhook/common/` is now empty, remove it too: `rmdir src/webhook/common 2>/dev/null || true`.)

- [ ] **Step 2: Remove worker duplicate infra**

```bash
git rm -r src/worker/infrastructure/database src/worker/infrastructure/redis
```

- [ ] **Step 3: Rewire `src/webhook/proofhound-webhook.module.ts`** (rename class, import shared)

```ts
import { Module } from '@nestjs/common';
import { WebhookModule } from './channels/webhook/webhook.module';
import { HealthController } from '../shared/health/health.controller';
import { HealthService } from '../shared/health/health.service';
import { DatabaseModule } from '../shared/database/database.module';
import { RedisModule } from '../shared/redis/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule, WebhookModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class ProofHoundWebhookModule {}
```

- [ ] **Step 4: Rewire `src/worker/proofhound-worker.module.ts`** (rename class, import shared)

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LlmConsumer, llmConsumerProviders } from './consumers/llm.consumer';
import { ProbeConsumer } from './consumers/probe.consumer';
import { DatabaseModule } from '../shared/database/database.module';
import { RedisModule } from '../shared/redis/redis.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
        },
      }),
    }),
    BullModule.registerQueue({ name: 'llm' }, { name: 'probe' }),
  ],
  providers: [...llmConsumerProviders, LlmConsumer, ProbeConsumer],
})
export class ProofHoundWorkerModule {}
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add -A
git commit -m "refactor(core): de-dup webhook/worker infra onto src/shared; rename their root modules"
```

---

## Task 5: Rename + rewire the server root module

**Files:**
- Modify: `packages/core/src/server/proofhound-server.module.ts`

- [ ] **Step 1: Rename `AppModule` → `ProofHoundServerModule` and update shared imports**

Edit `packages/core/src/server/proofhound-server.module.ts`:
- Rename the class `AppModule` → `ProofHoundServerModule` (keep the `static forRoot(options: AppModuleOptions)` signature; rename the interface to `ProofHoundServerModuleOptions` for clarity, exported).
- Update the import lines for the relocated shared modules:

```ts
// was: './config/config.module'
import { ConfigModule } from '../shared/config/config.module';
// was: './common/project-context.module'
import { ProjectContextModule } from '../shared/project-context/project-context.module';
// was: './infrastructure/crypto/crypto.module'
import { CryptoModule } from '../shared/crypto/crypto.module';
// was: './infrastructure/database/database.module'
import { DatabaseModule } from '../shared/database/database.module';
// was: './infrastructure/redis/redis.module'
import { RedisModule } from '../shared/redis/redis.module';
// was: './common/health.controller' / './common/health.service'
import { HealthController } from '../shared/health/health.controller';
import { HealthService } from '../shared/health/health.service';
// OrchestrationModule stays server-local:
import { OrchestrationModule } from './infrastructure/orchestration';
```

Keep the rest of the `imports` array (all `./modules/*`) unchanged. The `contracts` dynamic import (`options.contracts`) is untouched.

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/server/proofhound-server.module.ts
git commit -m "refactor(core): rename AppModule -> ProofHoundServerModule, point at src/shared"
```

---

## Task 6: Fix all remaining intra-`core` relative imports (typecheck-driven)

After the shared extraction, every `src/server/**` file that imported the relocated infra has a stale relative path. Fix them mechanically against the compiler.

**Import-rewrite rules** (old path under `src/server` → new target):

| Old (relative to a server file) | New target |
| -- | -- |
| `…/infrastructure/database/database.module` | `<rel>/shared/database/database.module` |
| `…/infrastructure/database/database.constants` | `<rel>/shared/database/database.constants` |
| `…/infrastructure/redis/redis.module` | `<rel>/shared/redis/redis.module` |
| `…/infrastructure/redis/redis.constants` | `<rel>/shared/redis/redis.constants` |
| `…/infrastructure/redis/redis-mutex.service` | `<rel>/shared/redis/redis-mutex.service` |
| `…/infrastructure/crypto/crypto.*` | `<rel>/shared/crypto/crypto.*` |
| `…/common/project-context` | `<rel>/shared/project-context/project-context` |
| `…/common/project-context.module` | `<rel>/shared/project-context/project-context.module` |
| `…/common/health.*` | `<rel>/shared/health/health.*` |
| `…/common/filters/pino-exception.filter` | `<rel>/shared/filters/pino-exception.filter` |

`<rel>` = the correct number of `../` from the importing file up to `src/`, then into `shared/`. Example: `src/server/modules/prompt/prompt.repository.ts` importing the DB constants becomes `../../../shared/database/database.constants`.

- [ ] **Step 1: Run the compiler to enumerate broken imports**

Run: `pnpm --filter @proofhound/core typecheck`
Expected: FAIL — a list of `TS2307: Cannot find module '…/infrastructure/database/…'` (and similar) errors. This list is the worklist.

- [ ] **Step 2: Fix each broken import** per the table above. Work file-by-file from the error list. Also handle two non-table cases surfaced by the compiler:
  - `PinoExceptionFilter` is now constructed with a service name where instantiated inside core (search `new PinoExceptionFilter(`); pass `'api'` for server contexts.
  - any test under `src/shared/**/__tests__` whose relative import to the moved subject changed.

- [ ] **Step 3: Re-run until green**

Run: `pnpm --filter @proofhound/core typecheck`
Expected: PASS (0 errors).

- [ ] **Step 4: Run core unit tests**

Run: `pnpm --filter @proofhound/core test`
Expected: PASS (the moved `__tests__` + DBOS `test/dbos` specs run green). Fix any spec whose relative import or `PinoExceptionFilter` instantiation moved.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): fix intra-core relative imports after shared extraction; core typecheck + tests green"
```

---

## Task 7: Create the subpath barrels

**Files:**
- Create: `packages/core/src/server/index.ts`
- Create: `packages/core/src/webhook/index.ts`
- Create: `packages/core/src/worker/index.ts`
- Modify: `packages/core/src/index.ts`
- Verify: `packages/core/src/server/common/contracts/index.ts` already exists (the `@proofhound/core/contracts` target) and additionally exports `LocalContractsModule`.

- [ ] **Step 1: `packages/core/src/server/index.ts`**

```ts
export { ProofHoundServerModule } from './proofhound-server.module';
export type { ProofHoundServerModuleOptions } from './proofhound-server.module';
```

- [ ] **Step 2: `packages/core/src/webhook/index.ts`**

```ts
export { ProofHoundWebhookModule } from './proofhound-webhook.module';
```

- [ ] **Step 3: `packages/core/src/worker/index.ts`**

```ts
export { ProofHoundWorkerModule } from './proofhound-worker.module';
```

- [ ] **Step 4: Ensure `LocalContractsModule` is on the `/contracts` barrel**

`packages/core/src/server/common/contracts/index.ts` currently re-exports the resolvers/guards/defaults. Add (if not already present):

```ts
export { LocalContractsModule } from './local-contracts.module';
```

- [ ] **Step 5: Replace `packages/core/src/index.ts`**

```ts
export { ProofHoundServerModule } from './server';
export type { ProofHoundServerModuleOptions } from './server';
export { ProofHoundWebhookModule } from './webhook';
export { ProofHoundWorkerModule } from './worker';
```

- [ ] **Step 6: Typecheck core**

Run: `pnpm --filter @proofhound/core typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add @proofhound/core subpath barrels (server/webhook/worker/contracts)"
```

---

## Task 8: Reduce the three apps to shells

**Files:**
- Modify: `apps/server/src/main.ts`, `apps/webhook/src/main.ts`, `apps/worker/src/main.ts`
- Modify: `apps/server/package.json`, `apps/webhook/package.json`, `apps/worker/package.json`
- Modify (server only): `apps/server/vitest.integration.config.ts` removal / relocation (the integration tests moved to core)

- [ ] **Step 1: `apps/server/src/main.ts`** — import runtime from `@proofhound/core`

Change only the three import lines that pointed into the moved source; the body is unchanged:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createHttpLogger, createLogger } from '@proofhound/logger';
import { json, urlencoded } from 'express';
import { ProofHoundServerModule } from '@proofhound/core/server';
import { LocalContractsModule } from '@proofhound/core/contracts';
import { PinoExceptionFilter } from '@proofhound/core/contracts'; // see note
import { resolveListenPort } from './config/listen-port';
// …unchanged bootstrap body, except:
//   AppModule.forRoot(...) -> ProofHoundServerModule.forRoot({ contracts: LocalContractsModule })
//   new PinoExceptionFilter() -> new PinoExceptionFilter('api')
```

NOTE on `PinoExceptionFilter`: it now lives in `src/shared/filters` which is **not** a public subpath. Two options — pick one at execution:
  - (a) Add `export { PinoExceptionFilter } from '../../shared/filters/pino-exception.filter';` to `src/server/index.ts` and import it from `@proofhound/core/server`. **(preferred — keeps the shell off internal paths)**
  - (b) Apply the global filter inside `ProofHoundServerModule` via an `APP_FILTER` provider instead of in `main.ts`, and drop it from the shell entirely.

This plan uses (a): add `PinoExceptionFilter` to `src/server/index.ts` exports and import `{ ProofHoundServerModule, PinoExceptionFilter } from '@proofhound/core/server'` (remove the `/contracts` import of it).

- [ ] **Step 2: `apps/webhook/src/main.ts`** — swap the module + filter imports

```ts
import { ProofHoundWebhookModule } from '@proofhound/core/webhook';
import { PinoExceptionFilter } from '@proofhound/core/webhook'; // add to webhook/index.ts exports
// keep: import { envSchema } from './config/env.schema';
// keep: import { resolveListenPort } from './config/listen-port';
// body unchanged except:
//   WebhookAppModule -> ProofHoundWebhookModule
//   new PinoExceptionFilter() -> new PinoExceptionFilter('webhook-ingress')
```

Add to `packages/core/src/webhook/index.ts`:
```ts
export { PinoExceptionFilter } from '../shared/filters/pino-exception.filter';
```

- [ ] **Step 3: `apps/worker/src/main.ts`** — swap the module import only

```ts
import { ProofHoundWorkerModule } from '@proofhound/core/worker';
// keep: import { envSchema } from './config/env.schema';
// body unchanged except WorkerModule -> ProofHoundWorkerModule
```

- [ ] **Step 4: Slim each shell `package.json`** — add `@proofhound/core`, keep externalized npm deps, drop the workspace deps now reached transitively only if the shell no longer imports them directly.

For `apps/server/package.json` `dependencies`: keep `@nestjs/core`, `@proofhound/logger`, `express`, `reflect-metadata` (directly imported by `main.ts`) plus the **externalized** npm deps the bundled core needs at runtime (the full npm set from core: `@dbos-inc/dbos-sdk`, `@nestjs/*`, `bullmq`, `drizzle-orm`, `ioredis`, `jose`, `jsonrepair`, `kafkajs`, `nestjs-pino`, `pino`, `pino-http`, `postgres`, `rxjs`, `sharp`, `zod`), and add:
```json
    "@proofhound/core": "workspace:*",
```
Keep the `@proofhound/*` workspace deps that are bundled transitively via core — they can be removed from the shell since webpack bundles them through `@proofhound/core`; to stay safe and avoid resolution surprises, **leave them in place** for this PR (cleanup is a follow-up). devDependencies (nest cli / webpack / swc / vitest toolchain) unchanged.

Apply the equivalent to `apps/webhook/package.json` and `apps/worker/package.json` (add `@proofhound/core`, keep their existing deps).

- [ ] **Step 5: Relocate server integration test config**

`apps/server/vitest.integration.config.ts` referenced the moved DBOS tests. Since `test/dbos` moved to `packages/core/test/dbos`, remove `apps/server/vitest.integration.config.ts` and the `test:integration` script from `apps/server/package.json`, or recreate the equivalent under `packages/core` if integration runs are still wanted there. This plan removes it from the shell (core's `vitest.config.ts` already includes `test/**/*.spec.ts`).

```bash
git rm apps/server/vitest.integration.config.ts
```
Then delete the `"test:integration": ...` line from `apps/server/package.json`.

- [ ] **Step 6: Install + typecheck the whole workspace**

Run: `pnpm install && pnpm -w typecheck`
Expected: PASS across all packages and the three shells.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(apps): reduce server/webhook/worker to shells consuming @proofhound/core"
```

---

## Task 9: Update Dockerfiles + deployment references

**Files:**
- Modify: `apps/server/Dockerfile`, `apps/webhook/Dockerfile`, `apps/worker/Dockerfile`

- [ ] **Step 1: Read the three Dockerfiles** and confirm the build stage has `packages/` available before `pnpm --filter @proofhound/<app> build`. The current server Dockerfile copies `packages packages` in the `deps` stage and builds from `FROM deps`, so `packages/core` is already present. Verify the same for webhook/worker.

- [ ] **Step 2: Confirm `pnpm --filter @proofhound/<app>... install` includes `@proofhound/core`.** The `...` suffix pulls dependencies, and `@proofhound/core` is now a dep — so it is included. No change expected; if a Dockerfile pins an explicit package list, add `@proofhound/core`.

- [ ] **Step 3: Build each image (or at least the build command) to verify**

Run (server, as representative): `pnpm --filter @proofhound/server build`
Expected: webpack bundles `@proofhound/core` source into `dist/main.js`; build succeeds. Repeat for webhook and worker.

- [ ] **Step 4: Commit any Dockerfile changes**

```bash
git add apps/*/Dockerfile
git commit -m "chore(docker): ensure shells build with @proofhound/core in context"
```

---

## Task 10: De-dup / circular-dependency + boundary verification

- [ ] **Step 1: Circular + boundary check (madge)**

Run: `pnpm deps:check`
Expected: PASS. Specifically assert no `packages/* -> apps/*` edge and **no `core/webhook -> core/server` or `core/worker -> core/server`** edge (webhook/worker import only `src/shared`, never `src/server`). If madge flags an intra-core webhook→server import, fix it (it means a webhook/worker file still references a server-only path).

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS (core holds the bulk of the specs now; shells have near-zero).

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

---

## Task 11: Sync SPEC to the realized layout

The SPEC's target sketch must match what was built (CLAUDE.md hard constraint #1: SPEC is the source of truth).

**Files:**
- Modify: `docs/specs/07-code-structure.md` (§3 layout, §4 shell)
- Modify: `docs/specs/08-saas-adapter-boundary.md` (only if the `/contracts` target path wording drifted)

- [ ] **Step 1: Add the `shared/` area to SPEC 07 §3** core layout block (it currently shows infra only under `server/`). Insert a `shared/` subtree listing `database`, `redis` (+ `redis-mutex`), `crypto`, `config`, `project-context`, `health`, `filters`, with a one-line note: "cross-runtime infra de-duplicated here; `webhook`/`worker` import from `../shared`, never from `server`."

- [ ] **Step 2: Soften SPEC 07 §4 / §5 / §6 shell wording** from "only `main.ts`" to "`main.ts` + per-runtime process config (`env.schema.ts`, `listen-port.ts`, `worker-concurrency.ts`)", reflecting Judgment Call #4.

- [ ] **Step 3: Terminology check**

Run: `pnpm spec:terms`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/specs
git commit -m "docs(specs): reflect realized @proofhound/core layout (shared area + shell config)"
```

---

## Task 12: Final gate

- [ ] **Step 1: Full CI**

Run: `pnpm ci`  (= `typecheck + lint + test + deps:check + spec:terms`)
Expected: GREEN. If any item is skipped (e.g. needs running DB/Redis for an integration test), note which and why in the PR description per CLAUDE.md Definition of Done.

- [ ] **Step 2: Build all three shells once more**

Run: `pnpm --filter @proofhound/server build && pnpm --filter @proofhound/webhook build && pnpm --filter @proofhound/worker build`
Expected: all succeed.

- [ ] **Step 3 (manual, ask ZiqiXiao — do not self-start services):** smoke-run each shell against the already-running local dev stack to confirm the externalized deps resolve at runtime (`node dist/main.js` boots, `/healthz` 200 for server + webhook; worker logs `worker_started`). Per CLAUDE.md #17, do not start the stack yourself — use the running services or ask ZiqiXiao to start them.

---

## Self-Review Notes (coverage vs SPEC)

- SPEC 07 §3 `packages/core` + subpaths → Tasks 1, 7 (exports), 11 (layout sync). ✅
- SPEC 07 §4–§6 shells → Task 8. ✅
- SPEC 08 §2 "`@proofhound/core` declares its deps, subpath exports, `ProofHoundServerModule.forRoot`" → Tasks 1, 5, 7. ✅
- SPEC 08 §7 PR0 row ("extraction, not a barrel; OSS apps must consume the package so it has a real OSS caller") → Tasks 2–8 (apps consume `@proofhound/core`). ✅
- De-dup (your "move + de-dup in one step") → Tasks 3, 4, with selective boundary documented (Judgment Calls #1–#3). ✅
- `forRoot({ contracts })` mechanism + `LocalContractsModule` + `overrideProvider` test-only — unchanged; only the module name changes (Task 5). ✅
