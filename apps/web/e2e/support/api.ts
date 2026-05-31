import type { APIRequestContext } from '@playwright/test';
import { FAKE_LLM_ENDPOINT } from './fake-llm-contract.mjs';

export const SERVER_URL =
  process.env.PLAYWRIGHT_SERVER_URL ?? process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';
export const WEBHOOK_URL = process.env.PLAYWRIGHT_WEBHOOK_URL ?? 'http://localhost:4001';

async function postJson<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const res = await request.post(`${SERVER_URL}${path}`, { data });
  if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Ordered teardown: register resources, then delete in reverse-dependency order, never throwing. */
export class ResourceLedger {
  private readonly items: Array<{ kind: string; path: string }> = [];
  constructor(private readonly request: APIRequestContext) {}
  track(kind: string, path: string) { this.items.push({ kind, path }); }
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
