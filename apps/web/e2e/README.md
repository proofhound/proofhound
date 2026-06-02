# ProofHound Web E2E Suite

Functional Playwright e2e covering the core lifecycle through the real UI + server + worker +
DBOS + BullMQ, with LLM calls replaced by a deterministic fake server. No real LLM calls are made.

## Specs

| Spec                                                        | Covers                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `smoke.spec.ts`, `not-found.spec.ts`, `preferences.spec.ts` | page-shell smokes (pre-existing)                                              |
| `dataset-upload.spec.ts`                                    | JSONL upload + paginated detail (pre-existing)                                |
| `dataset.spec.ts`                                           | CSV upload → parse → create → list landing                                    |
| `model.spec.ts`                                             | create a model (provider endpoint → fake LLM)                                 |
| `prompt.spec.ts`                                            | create prompt + draft version; referencing it freezes the version (read-only) |
| `experiment.spec.ts`                                        | UI create experiment → real worker → fake LLM → `success` + run results       |
| `monitoring.spec.ts`                                        | real experiment run results → monitoring stats / timeseries / ranking totals  |
| `optimization.spec.ts`                                      | UI create optimization → optimizer loop reaches `goals_met` → `success`       |
| `canary-release.spec.ts`                                    | add a canary to a running production line (`?mode=canary&line=`)              |
| `production-release.spec.ts`                                | create a production release → `running`                                       |
| `annotation.spec.ts`                                        | webhook → release run results → create annotation task → label a sample       |

## How to run

```bash
# Starts the isolated e2e stack, runs Playwright, then stops the stack.
pnpm test:e2e
# or a single spec:
pnpm test:e2e e2e/experiment.spec.ts --reporter=line
```

`pnpm test:e2e` creates/resets the local `proofhound_e2e` database, uses Redis DB 1, starts API,
webhook, worker, web, and the fake LLM server, then cleans up the app processes after Playwright exits.
It prefers API `http://localhost:4200`, webhook `http://localhost:4201`, web `http://localhost:3200`,
orchestrator `http://127.0.0.1:5598/readyz`, and fake LLM port `5599`; occupied defaults are replaced
with nearby free ports unless the corresponding environment variable is explicitly set.

For interactive debugging, `pnpm dev:e2e` starts the same isolated stack on the documented default ports
and leaves it running. In that mode, run Playwright separately from another terminal.

Do not point the default e2e suite at the ordinary `pnpm dev` stack unless you intentionally override the
URLs and accept that it will write to that stack's `DATABASE_URL`.

### Environment overrides

| Var                                                | Default                                                      | Purpose                                                            |
| -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `E2E_DATABASE_URL`                                 | `postgres://postgres:postgres@localhost:5432/proofhound_e2e` | isolated e2e database                                              |
| `E2E_REDIS_URL`                                    | `redis://localhost:6379/1`                                   | isolated Redis DB                                                  |
| `PLAYWRIGHT_BASE_URL`                              | `http://localhost:3200`                                      | web app under test                                                 |
| `PLAYWRIGHT_SERVER_URL` / `NEXT_PUBLIC_SERVER_URL` | `http://localhost:4200`                                      | API base (REST seeding)                                            |
| `PLAYWRIGHT_WEBHOOK_URL`                           | `http://localhost:4201`                                      | webhook ingress (annotation)                                       |
| `PLAYWRIGHT_SERVICES_READY_URL`                    | `http://127.0.0.1:5598/readyz`                               | e2e process-orchestrator readiness endpoint                        |
| `PLAYWRIGHT_SKIP_DOCKER`                           | unset                                                        | set `1` to fail fast instead of starting local docker dependencies |
| `PLAYWRIGHT_SKIP_DB_RESET`                         | unset                                                        | set `1` to skip the pre-e2e isolated database reset                |
| `PLAYWRIGHT_START_KAFKA`                           | unset                                                        | set `1` to include Kafka in dependency orchestration               |
| `FAKE_LLM_PORT`                                    | `5599`                                                       | fake LLM server port                                               |

When the `PLAYWRIGHT_*_URL` / `FAKE_LLM_PORT` variables above are unset, their default ports are
preferred but not fixed; occupied defaults are replaced with nearby free ports. Setting one of these
variables pins that endpoint to the supplied value, and the run fails if that pinned port is already
occupied because Playwright always starts its own application processes.

## Architecture

- **No login:** the OSS `LOCAL_ACTOR` fallback authenticates UI + REST automatically (no token header).
- **Process orchestration:** Playwright starts fresh API / webhook / worker / web / fake LLM processes
  for each run. It writes service logs to `/tmp/proofhound-e2e-*.log`.
- **Database isolation:** e2e runs against `proofhound_e2e` by default. The Playwright service
  orchestrator resets that database before starting the app services, so failed tests cannot leave
  residue in the ordinary development database.
- **Seeding:** prerequisite resources are created over REST via Playwright `APIRequestContext`
  (`e2e/support/api.ts`), not by clicking through the UI; each spec drives only its own domain UI and
  self-cleans via a `ResourceLedger` (reverse-dependency teardown).
- **Fake LLM** (`e2e/support/fake-llm-server.mjs`): an OpenAI-compatible HTTP stub managed as the second
  Playwright `webServer`. The real worker calls it because the seeded model's `endpoint` points at it.
  - Inference responses are deterministic. The optimizer's `generate` step injects a marker
    (`[OPT_MARKER_V1]`) wrapping the answer in `<ANS>…</ANS>`; when the rendered prompt contains the
    marker the stub echoes the wrapped label, so accuracy jumps to 1.0 and optimizations reach
    `goals_met`. Without the marker (baseline) it returns a wrong decision.
  - Optimizer analysis/generate steps are dispatched by Chinese system-prompt role markers, so prompts
    and optimizations are seeded with `promptLanguage: 'zh-CN'`.
- **Determinism gotchas baked into the seed helpers:** datasets use `text == expected`; judgment is
  `exact_match` with `expectedField: 'expected'`; models use positive rpm/tpm (the experiment UI gates
  on positive limits); optimizations send `fieldWhitelist`. See comments in `e2e/support/api.ts`.
