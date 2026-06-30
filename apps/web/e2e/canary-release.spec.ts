import { expect, test } from '@playwright/test';
import {
  ResourceLedger,
  SERVER_URL,
  seedModel,
  seedPrompt,
  seedPromptVersion,
} from './support/api';

// Inbound-payload schema attached to the webhook connector at creation time so the release-new
// FieldMappingTable has fields to map (see production-release.spec.ts for the rationale). The canary
// is added to a running production line, so the mapping is INHERITED (read-only) — but the
// production release we seed first still needs a non-empty externalIdField/variableMapping, which
// the schema lets the page infer.
const EXPECTED_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
  },
} as const;

async function seedWebhookConnectorWithSchema(
  request: Parameters<typeof seedModel>[0],
  name: string,
): Promise<{ connectorId: string }> {
  const webhookSlug = `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request.post(`${SERVER_URL}/connectors`, {
    data: {
      name,
      type: 'webhook',
      direction: 'input',
      config: { webhookMode: 'async', webhookSlug, expectedPayloadSchema: EXPECTED_PAYLOAD_SCHEMA },
    },
  });
  if (!res.ok()) throw new Error(`POST /connectors -> ${res.status()}: ${await res.text()}`);
  const out = (await res.json()) as { id: string };
  return { connectorId: out.id };
}

// A production release must already be RUNNING on the line for the release-new page to enter
// "add canary" mode (?mode=canary&line=...). Create it directly via REST and return the event id.
async function seedProductionRelease(
  request: Parameters<typeof seedModel>[0],
  args: { promptId: string; promptVersionId: string; modelId: string; connectorId: string; name: string },
): Promise<{ eventId: string }> {
  const res = await request.post(`${SERVER_URL}/production-releases`, {
    data: {
      promptId: args.promptId,
      promptVersionId: args.promptVersionId,
      modelId: args.modelId,
      inputConnectorId: args.connectorId,
      outputConnectorIds: [],
      eventType: 'from_prompt',
      runConfig: { rpmLimit: 600, tpmLimit: 100000, concurrency: 4, temperature: 0 },
      variableMapping: { text: 'text', id: 'id' },
      filterRules: null,
      recordMode: 'all',
      externalIdField: 'id',
      submitReason: args.name,
    },
  });
  if (!res.ok()) throw new Error(`POST /production-releases -> ${res.status()}: ${await res.text()}`);
  const out = (await res.json()) as { id: string };
  return { eventId: out.id };
}

test('adds a canary release to a running production line through the UI', async ({ page, request }) => {
  test.setTimeout(90_000); // add-canary UI flow + canary auto-start + detail status poll.
  const ledger = new ResourceLedger(request);
  const tag = `e2e-canary-${Date.now()}`;
  let canaryEventId: string | null = null;
  let productionEventId: string | null = null;

  try {
    // ---- Seed prerequisites via REST. TWO versions: v1 goes to production, v2 to the canary
    // (the add-canary picker filters out the production version, so the canary must differ). ----
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    const productionVersionId = await seedPromptVersion(request, promptId, { withMarker: false });
    const canaryVersionId = await seedPromptVersion(request, promptId, { withMarker: false });
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);
    const { connectorId } = await seedWebhookConnectorWithSchema(request, `${tag}-input`);
    ledger.track('connector', `/connectors/${connectorId}`);

    // ---- A running production release on the line is the precondition for "add canary" mode ----
    const production = await seedProductionRelease(request, {
      promptId,
      promptVersionId: productionVersionId,
      modelId,
      connectorId,
      name: `${tag}-prod`,
    });
    productionEventId = production.eventId;

    // The add-canary mode matches on the release line's REAL UUID (releaseLineSchema.id), NOT the
    // derived `${promptId}--${connectorId}` display id used in the post-submit URL. Look it up.
    const linesRes = await request.get(`${SERVER_URL}/release-lines`);
    if (!linesRes.ok()) throw new Error(`GET /release-lines -> ${linesRes.status()}`);
    const lines = (await linesRes.json()) as {
      data: Array<{ id: string; promptId: string | null; inputConnectorId: string | null }>;
    };
    const lineRow = lines.data.find((l) => l.promptId === promptId && l.inputConnectorId === connectorId);
    if (!lineRow) throw new Error('seeded production release line not found in GET /release-lines');
    const releaseLineId = lineRow.id;

    // ---- Drive the add-canary UI (?mode=canary&line=...). Prompt + input connector + variable
    // mapping + external id are LOCKED/inherited from the production event; the user only picks a
    // different prompt version + model. A webhook upstream now exposes the canary traffic ratio and
    // the split / dual-run mode controls — it is no longer pinned to 100%. ----
    await page.goto(`/releases/new?mode=canary&line=${encodeURIComponent(releaseLineId)}`);
    await expect(page.getByTestId('release-new-page')).toBeVisible();

    // Pick the canary's prompt version (must differ from production) and the model.
    await page.getByTestId(`release-new-version-row-${canaryVersionId}`).click();
    await page.getByTestId(`release-new-model-row-${modelId}`).click();

    // The webhook canary can now carve traffic by ratio and mirror via dual-run: choose 30% dual-run.
    await expect(page.getByTestId('release-new-traffic-mode-dual-run')).toBeVisible();
    await page.getByTestId('release-new-traffic-mode-dual-run').click();
    await page.getByTestId('release-new-traffic').fill('30');

    // ---- Submit -> POST /canary-releases; assert the carved ratio/mode + capture the EVENT id ----
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/canary-releases') && response.request().method() === 'POST',
      ),
      page.getByTestId('release-new-submit').click(),
    ]);
    const createPayload = createResponse.request().postDataJSON() as {
      trafficRatio: number;
      trafficMode: string;
    };
    expect(createPayload.trafficRatio).toBeCloseTo(0.3, 5);
    expect(createPayload.trafficMode).toBe('dual_run');
    const createdCanary = (await createResponse.json()) as { id: string };
    canaryEventId = createdCanary.id;

    // The page pushes to /releases/<promptId>--<connectorId> (release line id), not a bare UUID.
    await page.waitForURL(/\/releases\/[0-9a-f-]{36}--[0-9a-f-]{36}(\?.*)?$/u);

    // ---- Assert the release line is running (production stays running; canary auto-starts) ----
    await expect(page.getByTestId('release-line-detail-status')).toContainText(/running/i, {
      timeout: 30_000,
    });
  } finally {
    // Cancel the canary via POST /canary-releases/{canaryId}/cancel, then stop the production
    // release, then delete connector/prompt/model (best-effort; ignore errors).
    if (canaryEventId) {
      await request
        .post(`${SERVER_URL}/canary-releases/${canaryEventId}/cancel`, { data: { reason: 'e2e cleanup' } })
        .catch(() => undefined);
    }
    if (productionEventId) {
      await request
        .post(`${SERVER_URL}/production-releases/${productionEventId}/stop`, {
          data: { reason: 'e2e cleanup' },
        })
        .catch(() => undefined);
    }
    await ledger.cleanup();
  }
});
