# 01 · Navigation

The OSS Web UI is a single-workspace application. Users see business resources directly after entering the app; the data layer still keeps a single local project as the `project_id` boundary.

The fixed top bar shows, on the left, the ProofHound brand mark (linking to the dashboard) followed by a breadcrumb of the current module and current feature or object: in the OSS edition a module home page shows `current module`, a sub-feature `current module / current feature`, and a detail page `current module / object name`. The workspace name (`Default Project`) is surfaced on the dashboard rather than as a breadcrumb prefix, and the frontend provides no project selector; a host shell may prepend additional context (e.g. workspace / project name) at the same hierarchy position. The top bar carries the Quick Start entry and the theme / language controls on the right, and exposes the sidebar toggle on small screens.

## 1. Top-level navigation

The sidebar groups local workspace resources by workflow:

| Order | Group | Menu | Route | Description |
| --- | --- | --- | --- | --- |
| 1 | Observability | Dashboard | `/dashboard` | Local workspace overview entry |
| 2 | Observability | Monitoring | `/monitoring` | Run and system monitoring entry |
| 3 | Assets | Models | `/models` | Local model configuration, connectivity testing, rate limit and pricing configuration |
| 4 | Assets | Datasets | `/datasets` | Dataset upload, sample viewing, field mapping |
| 5 | Assets | Prompts | `/prompts` | Prompt list, detail, version editing, trial run |
| 6 | Development | Experiments | `/experiments` | Offline regression experiments and run result viewing |
| 7 | Development | Optimizations | `/optimizations` | Automatic analysis, candidate version generation, round-by-round experiments |
| 8 | Production | Connectors | `/connectors` | Redis / Kafka / Webhook input and output connectors |
| 9 | Production | Releases | `/releases` | Production entry combining canary release and production release |
| 10 | Production | Annotations | `/annotations` | Manual annotation entry |
| 11 | Settings | Settings | `/settings` | User token management entry (the same token is shared across the HTTP API and MCP entries) |

## 2. Default home page

`/` redirects directly to `/dashboard`. All business resources use top-level routes, for example `/datasets`, `/experiments/:id`, `/releases`.

The current frontend may first provide empty pages for menus that are not yet implemented; `/comparisons` keeps a placeholder page reachable by direct access but does not expose a top-level navigation entry; the legacy detail routes for canary release and production release serve only as compatibility entries, and should all later redirect or mount onto the unified release detail at `/releases`.

## 3. Dashboard

`/dashboard` hosts the original project overview page and reuses its layout: on the left is an activity feed filterable by All / Pending / Experiments / Optimizations / Releases, and on the right are asset count summaries and quick actions. In the activity feed, canary release and production release are unified under "Release" events and are no longer shown separately.

The page is used to show the current local project's asset counts and recent events: the number of prompts, datasets, models, connectors, and release lines, along with recent changes to experiments, optimizations, and release lines.

The dashboard does not display monitoring usage charts; run result usage aggregation still belongs to `/monitoring`.

## 4. Quick start

The fixed top action bar provides a quick start entry on the right. Quick start uses the default local project to create datasets, model configurations, and optimization tasks. See [33](33-quick-start.md) for details.
