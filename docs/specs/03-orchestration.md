# 03 · Workflow Orchestration Spec

This chapter explains how long-running tasks and asynchronous jobs are carried in the open-source self-hosted edition. Orchestration only handles business logic that spans multiple steps and needs retry / pause / resume / streaming output; synchronous requests stay inside NestJS Services.

## 1. Runtime Topology

```text
apps/server (mounts @proofhound/core/server)
  ├─ REST / MCP Controller
  ├─ DBOS runtime
  ├─ LLM pending producer
  └─ release runner service
          │
          ▼
        Redis pending backlog / admission leases / BullMQ ready queue
          │
          ▼
apps/worker (mounts @proofhound/core/worker)
  ├─ LLM admission dispatcher
  ├─ llm consumer -> LLM -> run_results
  └─ dataset-import consumer -> raw file -> staging -> dataset_samples
```

DBOS workflow state is written to the same Postgres instance. After a server restart, DBOS workflows resume from their step boundary; the runner service resumes from business-table state.

## 2. BullMQ Queues

| Queue            | Who enqueues             | Who consumes  | Content                                          |
| ---------------- | ------------------------ | ------------- | ------------------------------------------------ |
| `llm`            | admission dispatcher     | apps/worker   | Ready-to-run LLM calls                           |
| `dataset-import` | server                   | apps/worker   | Stream-parse uploaded raw dataset and promote it |
| `probe`          | server                   | server/worker | Model / connector connectivity probe             |
| `export`         | server                   | server        | CSV / JSONL export                               |

The server workflow / release runner / webhook producer first writes LLM calls into a Redis **pending admission backlog** keyed by the limiter/fairness key. A worker-side dispatcher admits pending jobs into the BullMQ `llm` ready queue only after a concurrency admission lease is available. This uses ordinary Redis + BullMQ primitives; BullMQ Pro groups are not required. The `dataset-import` queue is only for raw-upload imports. The legacy client-streamed batch path remains a synchronous staging/promote request path; cleanup of abandoned pre-queued sessions uses an in-server sweep tick; see [§3.5](#35-probe--export--dataset-import-cleanup).

## 3. Orchestration Inventory

### 3.1 ExperimentWorkflow

Experiments are carried by a DBOS workflow:

- Read the experiment, prompt version, dataset, model, and run configuration.
- Generate a stable `runResultId` per sample.
- Enqueue LLM calls into the LLM pending admission backlog; the worker dispatcher later moves admitted jobs into the BullMQ `llm` ready queue.
- The worker writes `ph_runs.run_results`; `ExperimentWorkflow` also reconciles BullMQ-terminal LLM jobs whose
  business row is missing into failed run results, so a missed worker finalization event cannot leave an experiment
  polling forever.
- The workflow aggregates progress and metrics and writes them back to `ph_runs.experiments`.
- `control_state` supports `stop` / `resume`; legacy `cancel` experiment actions are normalized to `stop`.
  When `ExperimentWorkflow` observes `stop` while a batch is in flight, it removes this experiment's not-yet-started
  `llm` jobs from both the Redis pending backlog and BullMQ (`waiting` / `delayed` / `prioritized` / `waiting-children` / `paused`) and then waits only
  for already-started jobs in that batch to reach terminal `ph_runs.run_results` rows before finalizing `stopped`.
  Pending jobs are treated as non-terminal during polling/reconciliation rather than as missing BullMQ jobs. If BullMQ already reports a job as `completed` / `failed` but the matching `run_results` row is still missing,
  the normal poll loop records an idempotent failed run result from the queued payload before rechecking progress;
  stop cleanup also removes that stale terminal job.

### 3.2 OptimizationWorkflow

Optimization is carried by a DBOS workflow:

- The starting point can be an experiment, a prompt version, or a dataset.
- The analysis and generation steps produce `optimization_analysis` / `optimization_generate` run results.
- Each round's sub-experiment is written to `ph_runs.experiments`, linked via `optimization_id + round_index`.
- Step state is written to `ph_runs.optimization_round_steps`.
- `control_state` supports `stop` / `resume` / `cancel`.

### 3.3 Release Runner

Releases do not enter DBOS; they are driven by an in-server runner service ticking periodically. A unified release runner handles both the production lane and the canary candidate lane:

- Scan active release lines and the running / stopped lane snapshots in `release_line_events`.
- Consume messages from queued upstream connectors and route them by external ID, field filters, traffic mode, and ratio.
- Queue consumption holds a Redis mutex lease per release line and renews it periodically; at any given moment only one server instance consumes a given input route,
  avoiding duplicate enqueues or duplicate recording in multi-instance deployments.
- Provide the same routing decisions for the Webhook entry point: the first Webhook production runs directly, and subsequent split / dual_run canaries are routed by the release line.
- Enqueue into the LLM pending admission backlog.
- LLM jobs use `source='release'` and `source_id=release_line_events.id`, no longer distinguishing canary from production on the run result source.
- Write run results, push outputs to the corresponding lane's output connector, and accumulate the release event count snapshot.
- Read the release event's `control_state` to respond to stop / resume / cancel / extend.
- When a split canary reaches 100%, transactionally write a `promote_canary` production lane event and set the canary event to `completed`.
- The runner does not re-authorize on each tick. Production release submission and canary release creation / resume call `WorkflowAuthorizationHook(workflow='release')` before writing or resuming a `running` release event; the runner trusts those authorized events. For SaaS org-scoped LLM buckets, the runner may hydrate the already-known project through `ProjectContextResolver` using an internal `system_release_runner` actor and the DB row's `project_id`, only to carry `orgId` into the LLM payload.

### 3.4 Release Event Stream

Release operation history is the `release_line_events` event stream:

- `ph_releases.release_line_events` records each new production, new canary, traffic adjustment, promotion from canary, config change, rollback, or force stop.
- A new production event enters `running` upon commit.
- When a new running event is written, the previous running production event for the same prompt is stopped in the same transaction.
- Upstream connectors belong to the release line and cannot be changed via `config_change`.

### 3.5 Probe / Export / Dataset Import Cleanup

- `probe`: model or connector connectivity probe. Direct probes call `WorkflowAuthorizationHook(workflow='probe')` with the resolved ProjectContext, including `orgId` when present, before invoking the model LLM probe or connector driver. Model probes can be executed by the worker when queued because they trigger real LLM calls; queued model probes apply `RuntimeLimitsProvider` before invoking the LLM client, the same as normal LLM jobs.
- `export`: paginate over business data, write to Storage, and return a signed URL.
- Dataset import: raw-upload import enters the `dataset-import` BullMQ queue after `POST /dataset-imports/:id/complete` (see [22 §3.1.2](22-datasets.md#312-raw-upload--asynchronous-backend-import)). The handler must be idempotent for the import id: if the session is already `completed`, `failed`, or `aborted`, it returns the existing state; otherwise it streams the raw object, writes staging batches, promotes, records usage events, and clears temporary resources. Abandoned sessions that never reached the queue (`created` / `uploading` / `uploaded`) are cleaned up by an in-server **periodic sweep tick**: it marks them `aborted`, clears staging rows, aborts pending upload sessions, deletes finalized temporary raw objects, and calls `ObjectStorageProvider.sweepPendingUploads(...)` for provider-level pending objects whose database session was never created.

### 3.6 Webhook Entry Point

`apps/webhook` is a standalone NestJS process shell that mounts `@proofhound/core/webhook`. It does not mount `HttpActorGuard`, does not go through the MCP context resolver, and **does not call `ProjectContextResolver`'s actor-project access check** (the webhook credential is a per-consumer channel credential and does not represent the project administrator). Entry-point authentication and context resolution are done in one step by a dedicated `ConnectorContextResolver` that directly produces a ProjectContext + ActorContext (contract in [08 §3.4](08-saas-adapter-boundary.md#34-connectorcontextresolver)).

Request processing path:

1. Inbound `POST /:webhookSlug[/:pathName]` locates the connector by `(slug, pathName)`; not found → 404
2. Extract the webhook token from `Authorization: Bearer <token>`, sha256-hash it, and look up `ph_core.tokens where scope='webhook' AND connector_id=<connector.id> AND token_hash=? AND revoked_at IS NULL`; verify `expires_at`; failure → 401 `invalid_webhook_token`
3. Resolution output:
   - `ProjectContext`: `{ projectId: connector.projectId }`. In OSS, `projectId` is fixed to the local default project; in SaaS, after replacing `ConnectorContextResolver`, it is determined by the connector configuration
   - `ActorContext`: `{ actorKind: 'system_webhook', actorId: connectorId }`. This actor does not map to any user / API token actor; in run results and logs, the event's actor identity is recorded with the flat `actorKind` plus the connector id in `actorId`
4. Subsequent routing / enqueue logic reuses the same flow as the §3.3 Release Runner: release line decisions (production / canary / split / dual_run), variable mapping, enqueue into the LLM pending admission backlog; the BullMQ job payload additionally carries `webhookTokenId` (the resolved webhook token UUID)
5. Writes to `ph_runs.run_results` and stdout logs both use the above `ProjectContext / ActorContext`; when the worker writes a run_result, it passes the `webhookTokenId` from the payload through to the `ph_runs.run_results.webhook_token_id` column, used for per-consumer usage aggregation by token (the HTTP / MCP entry points write NULL)
6. Idempotent deduplication is keyed on the `externalId` in the request body and handled by the business layer; the resolver is unaware of it

Credential isolation principles:

- The webhook token and the user token (shared by HTTP API + MCP) are two credential systems that do not reuse each other and do not resolve each other's tokens
- Both physically coexist in `ph_core.tokens` (distinguished by `scope`), but their lifecycles, entry-point resolvers, and SaaS replacement paths are entirely independent
- The webhook token's lifecycle is managed by the connector resource (creation / addition / revocation / deletion follow the connector), not by `TokenService`; a single connector supports multiple valid tokens coexisting steadily for per-consumer distribution (see [26 §5.2](26-connectors.md#52-token-management))

Current transition state: the existing `authorizeConnector` at `apps/webhook/src/channels/webhook/webhook.service.ts:185-206` is an inline form of `ConnectorContextResolver`. The core extraction moves the reusable webhook runtime into `packages/core/src/webhook`; this resolver refactor then switches authorization to the unified token model (scope='webhook' + connector_id) and changes the error code from `invalid_api_token` to `invalid_webhook_token`.

## 4. General Conventions

- Logic with side effects in a DBOS workflow must be placed within step boundaries.
- BullMQ handlers must be idempotent, backed by a business unique key.
- BullMQ retries are handled by the queue policy; do not swallow errors in a wrapper outside the handler.
- Do not bloat the payload with large objects; read large objects from the database by ID.
- Payload schemas live in `packages/orchestration-shared`.

## 5. Control Semantics

ProofHound does not rely on workflow engine signals. User controls are written to business-table state columns, which the orchestration layer reads periodically:

| User action                              | Landing point                                                 | Who observes it      |
| ---------------------------------------- | ------------------------------------------------------------- | -------------------- |
| Stop / resume an experiment              | `ph_runs.experiments.control_state`                           | ExperimentWorkflow   |
| Stop / resume / cancel an optimization   | `ph_runs.optimizations.control_state`                         | OptimizationWorkflow |
| Stop / resume / cancel / extend a canary | `ph_releases.release_line_events.control_state`               | Release runner       |
| Force-stop production                    | A new `force_stop` event in `ph_releases.release_line_events` | Release runner       |

## 6. Streaming Output

Optimization analysis / generation can push a token stream via NestJS SSE. Implementation path:

```text
LLM stream chunk -> worker -> Redis Pub/Sub -> server SSE -> web
```

The current open-source schema does not keep a separate `ph_streaming` table; short-lived streaming state should use Redis or in-process fan-out, and high-frequency chunks should not be persisted long-term as business data. The final content must still be written to the LLM call log and `ph_runs.run_results`.

## 7. Division of Responsibilities

| Responsibility                     | apps/server | apps/worker |
| ---------------------------------- | ----------- | ----------- |
| REST / MCP param validation        | ✓           | -           |
| Start a DBOS workflow              | ✓           | -           |
| Enqueue an LLM pending job         | ✓           | -           |
| Admit pending LLM jobs to BullMQ   | -           | ✓           |
| Release runner                     | ✓           | -           |
| Consume the `llm` queue            | -           | ✓           |
| Consume the `dataset-import` queue | -           | ✓           |
| Call the LLM                       | -           | ✓           |
| Write run results                  | ✓ or worker | ✓           |
| Redis rate limit                   | ✓ or worker | ✓           |

Rate limiting has **two independent gates**; do not conflate them when configuring:

- **Worker process concurrency**: BullMQ `@Processor('llm', { concurrency })` (default 4, overridable via `WORKER_CONCURRENCY`), the number of jobs a single process pulls simultaneously, **shared across all models**.
- **Model-level effective concurrency**: Redis controls "the number of in-flight requests globally for a limiter key" using the opaque key produced by `LimiterKeyStrategy` (OSS default: `model:<modelId>`), **shared across all worker processes / all entry points that resolve to that key**; when auto-concurrency is enabled, the system self-tunes it ([21 §6.1](21-models.md#61-auto-concurrency)).

For the queued `llm` channel, jobs first enter a Redis pending backlog grouped by fairness key. The dispatcher scans due keys, attempts one concurrency admission lease per key at a time, and only then writes the job to BullMQ as ready. A key with no available slot is rescheduled without blocking other due keys behind it. For an admitted job, the admission lease is the concurrency reservation; immediately before the provider request, the worker calls the Redis limiter in pre-reserved mode so RPM / TPM remain call-time sliding-window checks without double-counting concurrency. Non-admitted/direct invocations still reserve concurrency through the limiter itself. Admission leases are heartbeated while the worker runs, released when it finishes, and expire for crash recovery.

For raising a model's effective concurrency to actually take effect, you still need enough worker processes × process concurrency; otherwise it will be bottlenecked by worker process concurrency. The recommended deployment shape is a high worker process concurrency plus the pending/ready dispatcher, so BullMQ pulls only jobs that have already passed admission instead of consuming a worker slot and then discovering that no model slot is available.

## 8. Integration Test Isolation

When the server restarts, experiment / optimization recovery scans running rows with `dbos_workflow_id`. If DBOS no longer reports the workflow as active, recovery may resolve the row's already-known `project_id` through `ProjectContextResolver` using an internal `system_workflow_recovery` actor only to recover `ProjectContext.orgId`, then resume the workflow with that org attribution. This is not user re-authorization; the original start/resume entry already called `WorkflowAuthorizationHook`.

DBOS integration tests must:

- Use a dedicated `systemDatabaseSchemaName='dbos_test_<unique>'`.
- Run tests serially to avoid the DBOS global runtime interfering with each other.
- In `afterAll`, call `DBOS.shutdown()` first, then drop the current suite's DBOS schema.
- `pnpm db:clean-test-residue` only cleans up leftover `dbos_test_*` schemas, not business data.

## 9. Mapping to Business SPECs

| SPEC                                    | Orchestration carrier                                         |
| --------------------------------------- | ------------------------------------------------------------- |
| [24 Experiments](24-experiments.md)     | DBOS `ExperimentWorkflow` + `llm` queue                       |
| [25 Optimizations](25-optimizations.md) | DBOS `OptimizationWorkflow` + sub-experiment workflow         |
| [26 Connectors](26-connectors.md)       | probe job / runner service                                    |
| [27 Releases](27-releases.md)           | server release runner + `llm` queue + production event stream |
| [30 Run Results](30-run-results.md)     | worker / service writes `ph_runs.run_results`                 |
