# 00 · Overview

The open-source edition of ProofHound targets self-hosted scenarios, providing a single-workspace prompt lifecycle toolkit: prompt versions, dataset regression testing, experiments, optimizations, releases (canary stage and production release), run results, annotations, and rollbacks.

The open-source edition keeps a single local project as the `project_id` data boundary. `project_id`, actor UUID, `ProjectContext`, and `accessControl` are thin abstractions reserved for the local boundary and future external control plane integration; all other product semantics default to a single-workspace narrative and do not expand into multi-project, multi-tenant, multi-organization, or role management.

## 1. Core Abstractions

- **Prompt version**: Each modification of a prompt forms an immutable version; it becomes frozen once referenced by an experiment, a canary release, or a production release.
- **Local project**: The open-source edition has only one project by default, used to carry the `project_id` data boundary.
- **Dataset**: The source of regression samples and field schemas.
- **Experiment**: Runs an offline regression against one prompt version, one dataset, and one model.
- **Optimization**: Starting from a dataset or an experiment, automatically analyzes errors, generates candidate versions, and runs experiments.
- **Release**: Connects a prompt version to an upstream connector; queue connectors typically validate with a small canary-stage traffic share first, then split to 100% to be promoted to production release; a Webhook's first release goes directly to production release.
- **Run result**: The immutable record after every LLM call is persisted to the table.

## 2. Product Boundary

The open-source edition only has local admin app semantics, providing no project management UI and no explicit project switching. Models, connectors, datasets, prompts, experiments, releases, and run results all belong to the same local project; the current project is resolved centrally by `ProjectContextProvider` / `resolveProjectContext`, the OSS implementation always returns the local project, and a future external control plane only replaces this layer.

Business tables must retain the `project_id` and actor UUID fields, but the actor does not foreign-key to a user table; business Services depend only on the thin `accessControl` abstraction, making it easy for a future external control plane to replace the entry policy.

## 3. Invocation Channels

ProofHound exposes three external invocation channels, all of which enter the same set of Service logic:

1. Web UI: the local admin app, the UI channel of the HTTP entry (deployment-layer trusted header or LOCAL_ACTOR fallback, see [08](08-adapter-extension-points.md) §3.2.1 deployment forms).
2. HTTP API + user token / Webhook + webhook token: calls from scripts / CI / external business systems; the user token (`ph_*` prefix) goes through `Authorization: Bearer`, and the webhook token goes through per-connector ingress.
3. MCP + user token: an Agent invokes local workspace capabilities as tools; the same user token can be used for both the HTTP API and MCP entries.

## 4. Key Invariants

- A prompt has at most one running production lane at a time.
- An upstream connector belongs to at most one active release line at a time; within the same line, a production lane and a canary candidate lane may share that upstream.
- A canary candidate does not change the current prompt's production release; only after a split to 100% and promotion does production switch to the candidate version.
- A model's RPM / TPM / concurrency limits are counted uniformly across all invocation channels and all replicas.
- Only one in-progress optimization task is allowed at a time.
- A run result is immutable once written; manual annotations are written to a separate `ph_runs.annotations`.

## 5. SPEC Index

| Topic                                          | SPEC                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Navigation / Tech stack / Orchestration / PostgreSQL / Logging | [01](01-navigation.md) / [02](02-tech-stack.md) / [03](03-orchestration.md) / [04](04-postgresql.md) / [05](05-logging.md) |
| Database / Code structure                      | [06](06-database-schema.md) / [07](07-code-structure.md)                                                                   |
| Models / Datasets / Prompts / Experiments / Optimizations | [21](21-models.md) / [22](22-datasets.md) / [23](23-prompts.md) / [24](24-experiments.md) / [25](25-optimizations.md)      |
| Connectors / Releases / Run results            | [26](26-connectors.md) / [27](27-releases.md) / [30](30-run-results.md)                                                    |
| Quick start / Settings                         | [33](33-quick-start.md) / [34](34-settings.md)                                                                             |
