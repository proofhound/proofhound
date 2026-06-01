# ProofHound Web E2E Suite

Functional Playwright e2e covering the core lifecycle through the real UI + server + worker +
DBOS + BullMQ, with LLM calls replaced by a deterministic fake server. No real LLM calls are made.

## Specs

| Spec | Covers |
| --- | --- |
| `smoke.spec.ts`, `not-found.spec.ts`, `preferences.spec.ts` | page-shell smokes (pre-existing) |
| `dataset-upload.spec.ts` | JSONL upload + paginated detail (pre-existing) |
| `dataset.spec.ts` | CSV upload → parse → create → list landing |
| `model.spec.ts` | create a model (provider endpoint → fake LLM) |
| `prompt.spec.ts` | create prompt + draft version; referencing it freezes the version (read-only) |
| `experiment.spec.ts` | UI create experiment → real worker → fake LLM → `success` + run results |
| `optimization.spec.ts` | UI create optimization → optimizer loop reaches `goals_met` → `success` |
| `canary-release.spec.ts` | add a canary to a running production line (`?mode=canary&line=`) |
| `production-release.spec.ts` | create a production release → `running` |
| `annotation.spec.ts` | webhook → release run results → create annotation task → label a sample |

## How to run

The suite does **not** start the dev stack. Start it first, then run Playwright.

```bash
# 1. Start the full stack FROM THIS CHECKOUT so the served web carries the e2e testids.
#    (CORS: the API only allows the WEB_PUBLIC_URL origin — default http://localhost:3000 —
#     so the web app MUST be served on :3000. Running `pnpm dev` from this worktree does that.)
pnpm dev

# 2. Run the suite (Playwright reuses the running web on :3000 and auto-starts the fake LLM on :5599).
pnpm --filter @proofhound/web test:e2e
# or a single spec:
pnpm --filter @proofhound/web exec playwright test e2e/experiment.spec.ts --reporter=line
```

If you run the backend from the main checkout and the web from this worktree, make sure the web that
serves :3000 is THIS checkout (it has the testids); the backend code is identical, so a shared backend
is fine.

### Environment overrides

| Var | Default | Purpose |
| --- | --- | --- |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | web app under test |
| `PLAYWRIGHT_SERVER_URL` / `NEXT_PUBLIC_SERVER_URL` | `http://localhost:4000` | API base (REST seeding) |
| `PLAYWRIGHT_WEBHOOK_URL` | `http://localhost:4001` | webhook ingress (annotation) |
| `FAKE_LLM_PORT` | `5599` | fake LLM server port |

## Architecture

- **No login:** the OSS `LOCAL_ACTOR` fallback authenticates UI + REST automatically (no token header).
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
