import type { APIRequestContext } from '@playwright/test';
import { FAKE_LLM_ENDPOINT } from './fake-llm-contract.mjs';

export const SERVER_URL =
  process.env.PLAYWRIGHT_SERVER_URL ?? process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4200';
export const WEBHOOK_URL = process.env.PLAYWRIGHT_WEBHOOK_URL ?? 'http://localhost:4201';

async function postJson<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const res = await request.post(`${SERVER_URL}${path}`, { data });
  if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${SERVER_URL}${path}`);
  if (!res.ok()) throw new Error(`GET ${path} -> ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Ordered teardown: register resources, then delete in reverse-dependency order, never throwing. */
export class ResourceLedger {
  private readonly items: Array<{ kind: string; path: string }> = [];
  constructor(private readonly request: APIRequestContext) {}
  track(kind: string, path: string) {
    this.items.push({ kind, path });
  }
  async cleanup() {
    // delete in reverse insertion order (children were created/tracked after parents)
    for (const item of [...this.items].reverse()) {
      await this.request.delete(`${SERVER_URL}${item.path}`).catch(() => undefined);
    }
  }
}

// ---- Dataset: deterministic `text == expected` so the fake server can echo the answer ----
export async function seedDataset(
  request: APIRequestContext,
  opts: { name: string; labels?: string[] } = { name: 'e2e-ds' },
) {
  const labels = opts.labels ?? ['A', 'B', 'A', 'B', 'A', 'B'];
  const body = {
    name: opts.name,
    uploadSource: { fileName: 'e2e.jsonl', fileSizeBytes: 256, contentType: 'application/jsonl' },
    fieldMappings: [
      { name: 'text', role: 'text' },
      { name: 'expected', role: 'expected' },
    ],
    samples: labels.map((l) => ({ text: l, expected: l })),
  };
  const out = await postJson<{ dataset: { id: string } }>(request, '/datasets', body);
  return out.dataset.id;
}

// ---- Prompt + draft version (no publish step exists; referencing a version auto-freezes it) ----
export async function seedPrompt(request: APIRequestContext, name: string) {
  // POST /prompts returns the prompt object itself (top-level id), no wrapper.
  const out = await postJson<{ id: string }>(request, '/prompts', {
    name,
    promptLanguage: 'zh-CN',
  });
  return out.id;
}

/**
 * Create a draft version then PATCH its content. `withMarker=false` produces a BASELINE prompt
 * (no marker → fake server returns wrong → accuracy 0). Judgment is exact_match on `decision`,
 * with classification options 'A'|'B' (also satisfies annotation category-options requirement).
 */
export async function seedPromptVersion(
  request: APIRequestContext,
  promptId: string,
  opts: { withMarker?: boolean } = {},
) {
  // POST /versions returns the FULL prompt object with all versions; the new draft has the highest versionNumber.
  const created = await postJson<{ id: string; versions: Array<{ id: string; versionNumber: number }> }>(
    request,
    `/prompts/${promptId}/versions`,
    { changeReason: 'e2e seed' },
  );
  const versionId = created.versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a)).id;
  const body = opts.withMarker
    ? `判断输入并输出分类。[OPT_MARKER_V1] 输入：<ANS>{{text}}</ANS>`
    : `判断输入并输出分类。输入：{{text}}`;
  await request.patch(`${SERVER_URL}/prompts/${promptId}/versions/${versionId}`, {
    data: {
      body,
      variables: [{ name: 'text', type: 'text', required: true }],
      outputSchema: { fields: [{ key: 'decision', isJudgment: true, value: 'A | B' }] },
      // expectedField MUST be declared: without it the judge defaults to the `expected_output` key,
      // which the samples do not have (they store `expected`), yielding judge_error / accuracy 0.
      judgmentRules: { ruleName: 'exact_match', expectedField: 'expected', config: { decisionField: 'decision' } },
      promptLanguage: 'zh-CN',
      changeReason: 'e2e content',
    },
  });
  return versionId;
}

// ---- Model pointing at the fake LLM (openai-compatible) ----
export async function seedModel(request: APIRequestContext, name: string) {
  // POST /models returns the model object itself (top-level id), no wrapper.
  const out = await postJson<{ id: string }>(request, '/models', {
    name,
    providerType: 'openai',
    providerModelId: 'fake-model',
    endpoint: FAKE_LLM_ENDPOINT,
    apiKey: 'sk-fake-e2e',
    // Positive limits (NOT -1/unlimited): the experiment-new UI gates submit on rpm/tpm being
    // positive numbers (isExperimentRunParamsComplete). High enough to never throttle the tiny e2e runs.
    rpm: { limit: 600 },
    tpm: { limit: 100000 },
  });
  return out.id;
}

// ---- Experiment (REST path, used to seed an optimization source if needed) ----
export async function seedExperiment(
  request: APIRequestContext,
  args: { name: string; promptVersionId: string; datasetId: string; modelId: string },
) {
  // POST /experiments returns the experiment object itself (top-level id), no wrapper.
  const out = await postJson<{ id: string }>(request, '/experiments', {
    name: args.name,
    promptVersionId: args.promptVersionId,
    datasetId: args.datasetId,
    modelId: args.modelId,
    runConfig: { concurrency: 4, temperature: 0, retries: 0, sampleTimeoutSeconds: 60 },
  });
  return out.id;
}

// ---- Optimization (from a baseline version; reaches goals_met once the marker prompt is generated) ----
export async function seedOptimization(
  request: APIRequestContext,
  args: { name: string; promptId: string; baseVersionId: string; datasetId: string; modelId: string; target?: number },
) {
  // POST /optimizations returns the optimization object itself (top-level id), no wrapper.
  const out = await postJson<{ id: string }>(request, '/optimizations', {
    name: args.name,
    strategy: 'error_pattern_analysis',
    startingMode: 'from_prompt_version',
    promptId: args.promptId,
    baseVersionId: args.baseVersionId,
    datasetId: args.datasetId,
    experimentModelId: args.modelId,
    analysisModelId: args.modelId,
    promptLanguage: 'zh-CN',
    // fieldWhitelist is REQUIRED: the workflow's snapshot gate rejects {} (it needs both arrays).
    fieldWhitelist: { inputFields: ['text'], metaFields: [] },
    goals: [{ metric: 'accuracy', comparator: 'gte', target: args.target ?? 0.95, scope: 'overall' }],
    loopLimits: { maxRounds: 3, stopAfterNoImprovementRounds: 0 },
  });
  return out.id;
}

// ---- Webhook input connector ---------------------------------------------------------------
// POST /connectors (webhook:input) returns the full connector detail PLUS `initialWebhookToken`
// (only present at creation time). The plaintext token is used as `Authorization: Bearer <token>`
// for inbound POST /webhooks/<slug>. The slug we sent lives under `config.webhookSlug`; the
// top-level `webhookPath` is an internal UUID, NOT the slug, so we must read the slug we control.
export async function seedWebhookConnector(request: APIRequestContext, name: string) {
  const webhookSlug = `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const out = await postJson<{
    id: string;
    config: { webhookSlug?: string };
    initialWebhookToken?: { plaintext: string };
  }>(request, '/connectors', {
    name,
    type: 'webhook',
    direction: 'input',
    config: { webhookMode: 'async', webhookSlug },
  });
  let webhookToken = out.initialWebhookToken?.plaintext;
  if (!webhookToken) {
    // Fallback: mint a token explicitly if the create response did not include one.
    const tok = await postJson<{ plaintext: string }>(request, `/connectors/${out.id}/webhook-tokens`, {
      name: 'e2e',
    });
    webhookToken = tok.plaintext;
  }
  return { connectorId: out.id, webhookToken, webhookSlug: out.config.webhookSlug ?? webhookSlug };
}

// ---- Canary release ------------------------------------------------------------------------
// POST /canary-releases creates the event AND auto-sets status='running' (no separate /start
// call is needed — verified against the running stack). The response `.id` is the canary EVENT
// id; `.releaseLineId` / `.releaseVersionId` identify the line+version used by annotation options.
// variableMapping MUST include a row with target='id' (DTO superRefine); externalIdField='id'
// maps the inbound payload `id` to the run result's externalId.
export async function seedCanaryRelease(
  request: APIRequestContext,
  args: { promptVersionId: string; modelId: string; connectorId: string; name: string },
) {
  const out = await postJson<{
    id: string;
    releaseLineId: string;
    releaseVersionId: string | null;
    status: string;
  }>(request, '/canary-releases', {
    name: args.name,
    promptVersionId: args.promptVersionId,
    modelId: args.modelId,
    inputConnectorId: args.connectorId,
    outputConnectorIds: [],
    trafficRatio: 1,
    trafficMode: 'split',
    runMode: 'manual',
    recordMode: 'all',
    variableMapping: [
      { source: 'text', target: 'text', required: true },
      { source: 'id', target: 'id', required: true },
    ],
    externalIdField: 'id',
    runConfig: { rpmLimit: 600, tpmLimit: 100000, concurrency: 5, temperature: 0 },
  });
  // Create auto-starts (status='running'); only call /start if some future build does not.
  if (out.status !== 'running') {
    await request.post(`${SERVER_URL}/canary-releases/${out.id}/start`, { data: {} });
  }
  return { eventId: out.id, releaseLineId: out.releaseLineId, releaseVersionId: out.releaseVersionId };
}

// ---- Inbound webhook traffic ---------------------------------------------------------------
// POST {WEBHOOK_URL}/webhooks/<slug> with Bearer <plaintext webhook token>. Returns 201 with
// { status:'accepted', run_result_id, external_id, ... }. The payload `text` is mapped to the
// prompt var `text`; payload `id` becomes the externalId.
export async function postWebhook(
  request: APIRequestContext,
  args: { slug: string; token: string; payload: Record<string, unknown> },
) {
  const res = await request.post(`${WEBHOOK_URL}/webhooks/${args.slug}`, {
    headers: { Authorization: `Bearer ${args.token}` },
    data: args.payload,
  });
  if (!res.ok()) throw new Error(`POST /webhooks/${args.slug} -> ${res.status()}: ${await res.text()}`);
  return (await res.json()) as { status: string; run_result_id: string; external_id: string | null };
}

// ---- Wait for run results to be attributed to a release version ----------------------------
// GET /annotation-tasks/options exposes per-version counts. Poll until the version's count for
// the requested scope ('canary'|'online') reaches `min`. Timeout 60s.
type AnnotationOptionsResponse = {
  data: Array<{
    id: string;
    versions: Array<{ id: string; canaryCount: number; onlineCount: number; categoryOptions: string[] }>;
  }>;
};
export async function waitForReleaseRunResults(
  request: APIRequestContext,
  args: {
    releaseLineId: string;
    releaseVersionId: string;
    scope?: 'canary' | 'online';
    min: number;
    timeoutMs?: number;
  },
) {
  const scope = args.scope ?? 'canary';
  const deadline = Date.now() + (args.timeoutMs ?? 60_000);
  let count = 0;
  for (;;) {
    const opts = await getJson<AnnotationOptionsResponse>(request, '/annotation-tasks/options');
    const version = opts.data
      .find((line) => line.id === args.releaseLineId)
      ?.versions.find((v) => v.id === args.releaseVersionId);
    count = version ? (scope === 'canary' ? version.canaryCount : version.onlineCount) : 0;
    if (count >= args.min) return count;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForReleaseRunResults timed out: ${scope}Count=${count} < ${args.min} for version ${args.releaseVersionId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
