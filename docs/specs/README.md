# ProofHound · Specs Index

This directory is the source of truth for the open-source self-hosted edition. The docs default to a single-workspace narrative; for the reasons behind retained abstractions such as `project_id`, see [00 Overview](00-overview.md), [06 Database Schema](06-database-schema.md), and [07 Code Structure](07-code-structure.md).

## Reading path

When you first encounter the repository, read in this order:

1. [00 Overview](00-overview.md) — product boundaries, core loop, open-source self-hosted form
2. [01 Navigation](01-navigation.md) — pages and menus of the local admin app
3. [02 Tech Stack](02-tech-stack.md) — the technology stack and runtime form
4. [03 Orchestration Spec](03-orchestration.md) / [04 PostgreSQL Usage Spec](04-postgresql.md) / [05 Logging Spec](05-logging.md) / [06 Database Schema](06-database-schema.md) / [07 Code Structure](07-code-structure.md) / [08 Adapter extension points](08-adapter-extension-points.md) / [09 MCP Server](09-mcp-server.md) — cross-cutting constraints
5. Business feature SPECs: models, datasets, prompts, experiments, optimizations, connectors, releases, run results, quick start, settings

## Index

### Foundations

| No.  | Topic |
| ---- | ---- |
| 00 | [Overview](00-overview.md) |
| 01 | [Navigation](01-navigation.md) |
| 02 | [Tech Stack](02-tech-stack.md) |
| 03 | [Orchestration Spec](03-orchestration.md) |
| 04 | [PostgreSQL Usage Spec](04-postgresql.md) |
| 05 | [Logging Spec](05-logging.md) |
| 06 | [Database Schema](06-database-schema.md) |
| 07 | [Code Structure](07-code-structure.md) |
| 08 | [Control Plane Adapter Boundary](08-adapter-extension-points.md) |
| 09 | [MCP Server](09-mcp-server.md) |

### Business features

| No.  | Topic |
| ---- | ---- |
| 21 | [Models](21-models.md) |
| 22 | [Datasets](22-datasets.md) |
| 23 | [Prompts](23-prompts.md) |
| 24 | [Experiments](24-experiments.md) |
| 25 | [Optimizations](25-optimizations.md) |
| 26 | [Connectors](26-connectors.md) |
| 27 | [Releases](27-releases.md) |
| 30 | [Run Results](30-run-results.md) |
| 33 | [Quick Start](33-quick-start.md) |
| 34 | [Settings](34-settings.md) |

## Feature relationships

```text
Models ───────────┐
Datasets ─────────┼──► Experiments ───► Optimizations
Prompts ──────────┘          │
                             ▼
Connectors ─────► Releases (canary stage / production state)
                             │
                             └────► Run results
```

- Models / Datasets / Prompts are the foundational assets.
- Experiments and Optimizations are used for offline validation and automated improvement.
- Connectors and Releases are used to onboard live traffic; a release internally contains a canary stage and a production state.
- Run results are the fact table for all LLM calls and the entry point for troubleshooting.
- Settings is used to manage user tokens (the same token is shared across the HTTP API and MCP entry points).

## Skill packs

The repository ships two same-source skill packs for Codex / Claude Code:

- `.agents/skills/`
- `.claude/skills/`

When adding or modifying skills, keep both sides in sync. For the global hard constraints, see [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md) at the repository root.
