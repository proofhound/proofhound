import { expect, test } from '@playwright/test';
import {
  ResourceLedger,
  SERVER_URL,
  seedModel,
  seedPrompt,
  seedPromptVersion,
} from './support/api';

// Inbound-payload schema we attach to the webhook connector at creation time. The release-new
// FieldMappingTable populates its variable/external-id <select> options from
// config.expectedPayloadSchema (extractFieldOptionsFromConnector). A connector created without it
// exposes no fields, so the variable mapping would be empty and the submit gate would never enable.
const EXPECTED_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
  },
} as const;

// seedWebhookConnector doesn't accept an expectedPayloadSchema, so create the webhook connector
// directly here (config.webhookSlug + expectedPayloadSchema). Returns the connector id.
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

test('creates a production release through the UI and lands on a running release line', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000); // production release enters 'running' on submit; UI list polls.
  const ledger = new ResourceLedger(request);
  const tag = `e2e-prod-${Date.now()}`;
  let productionEventId: string | null = null;

  try {
    // ---- Seed prerequisites via REST ----
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    const versionId = await seedPromptVersion(request, promptId, { withMarker: false });
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);
    const { connectorId } = await seedWebhookConnectorWithSchema(request, `${tag}-input`);
    ledger.track('connector', `/connectors/${connectorId}`);

    // ---- Drive the create UI in production (default) mode ----
    await page.goto('/releases/new');
    await expect(page.getByTestId('release-new-page')).toBeVisible();

    // Production requires a release name; there is NO separate submitReason field — the production
    // submitReason is derived from the name (+ optional description) in handleSubmit.
    await page.getByTestId('release-new-name').fill(tag);

    // Select prompt + version + model + input connector (rows auto-default, but click to be explicit).
    await page.getByTestId(`release-new-prompt-row-${promptId}`).click();
    await page.getByTestId(`release-new-version-row-${versionId}`).click();
    await page.getByTestId(`release-new-model-row-${modelId}`).click();
    await page.getByTestId(`release-new-input-connector-${connectorId}`).click();

    // variableMapping: map prompt variable 'text' to the inbound 'text' field, and the external-id
    // field to 'id'. Native <select>s; defaults already infer these, but set them explicitly.
    await page.getByTestId('release-new-mapping-source-text').selectOption('text');
    await page.getByTestId('release-new-mapping-external-id').selectOption('id');

    // Webhook input is not a queue, so traffic is fixed at 100% (no release-new-traffic control).

    // ---- Submit -> POST /production-releases; capture the event id from the response ----
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/production-releases') && response.request().method() === 'POST',
      ),
      page.getByTestId('release-new-submit').click(),
    ]);
    const createdEvent = (await createResponse.json()) as { id: string };
    productionEventId = createdEvent.id;

    // The page pushes to /releases/<promptId>--<connectorId> (release line id), not a bare UUID.
    await page.waitForURL(/\/releases\/[0-9a-f-]{36}--[0-9a-f-]{36}(\?.*)?$/u);

    // ---- Assert the release line is running ----
    await expect(page.getByTestId('release-line-detail-status')).toContainText(/running/i, {
      timeout: 30_000,
    });
  } finally {
    // Stop the production release via POST /production-releases/{eventId}/stop {reason}, then
    // delete connector/prompt/model (best-effort; ignore errors).
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
