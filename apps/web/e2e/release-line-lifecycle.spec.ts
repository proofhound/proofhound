import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ResourceLedger,
  SERVER_URL,
  postWebhook,
  seedModel,
  seedPrompt,
  seedPromptVersion,
  waitForReleaseRunResults,
} from './support/api';

const EXPECTED_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
  },
} as const;

type ReleaseLineListResponse = {
  data: Array<{
    id: string;
    name: string;
    promptId: string | null;
    inputConnectorId: string | null;
    currentProductionEvent: { releaseVersionId: string | null } | null;
  }>;
};

async function seedWebhookConnectorWithSchema(request: APIRequestContext, name: string) {
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
  const out = (await res.json()) as {
    id: string;
    config: { webhookSlug?: string };
    initialWebhookToken?: { plaintext: string };
  };
  let webhookToken = out.initialWebhookToken?.plaintext;
  if (!webhookToken) {
    const tokenRes = await request.post(`${SERVER_URL}/connectors/${out.id}/webhook-tokens`, {
      data: { name: 'e2e' },
    });
    if (!tokenRes.ok()) {
      throw new Error(`POST /connectors/${out.id}/webhook-tokens -> ${tokenRes.status()}: ${await tokenRes.text()}`);
    }
    webhookToken = ((await tokenRes.json()) as { plaintext: string }).plaintext;
  }
  return { connectorId: out.id, webhookSlug: out.config.webhookSlug ?? webhookSlug, webhookToken };
}

async function seedProductionRelease(
  request: APIRequestContext,
  args: { promptId: string; promptVersionId: string; modelId: string; connectorId: string; name: string },
) {
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

async function findReleaseLine(
  request: APIRequestContext,
  args: { promptId: string; connectorId: string },
): Promise<ReleaseLineListResponse['data'][number]> {
  const linesRes = await request.get(`${SERVER_URL}/release-lines`);
  if (!linesRes.ok()) throw new Error(`GET /release-lines -> ${linesRes.status()}: ${await linesRes.text()}`);
  const lines = (await linesRes.json()) as ReleaseLineListResponse;
  const line = lines.data.find((item) => item.promptId === args.promptId && item.inputConnectorId === args.connectorId);
  if (!line) throw new Error('seeded release line not found in GET /release-lines');
  return line;
}

test('stops, archives, unarchives, and permanently deletes a release line from the detail page', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const ledger = new ResourceLedger(request);
  const tag = `e2e-release-line-${Date.now()}`;
  let releaseLineId: string | null = null;
  let releaseLineName: string | null = null;
  let productionEventId: string | null = null;

  try {
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    const promptVersionId = await seedPromptVersion(request, promptId, { withMarker: true });
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);
    const { connectorId, webhookSlug, webhookToken } = await seedWebhookConnectorWithSchema(request, `${tag}-input`);
    ledger.track('connector', `/connectors/${connectorId}`);

    const production = await seedProductionRelease(request, {
      promptId,
      promptVersionId,
      modelId,
      connectorId,
      name: `${tag}-prod`,
    });
    productionEventId = production.eventId;

    const seededLine = await findReleaseLine(request, { promptId, connectorId });
    releaseLineId = seededLine.id;
    releaseLineName = seededLine.name;
    const releaseVersionId = seededLine.currentProductionEvent?.releaseVersionId;
    if (!releaseVersionId) throw new Error('seeded production line does not expose a release version id');

    await postWebhook(request, {
      slug: webhookSlug,
      token: webhookToken,
      payload: { id: `${tag}-ext-1`, text: 'A' },
    });
    await waitForReleaseRunResults(request, {
      releaseLineId,
      releaseVersionId,
      scope: 'online',
      min: 1,
    });

    await page.goto(`/releases/${encodeURIComponent(releaseLineId)}`);
    await expect(page.getByTestId('release-line-detail-page')).toBeVisible();
    await expect(page.getByTestId('release-line-detail-status')).toContainText(/running/i, { timeout: 30_000 });

    await page.getByTestId('release-line-detail-stop').click();
    await expect(page.getByTestId('release-stop-production-dialog')).toBeVisible();
    await page.locator('#release-stop-production-name').fill(releaseLineName);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/release-lines/${releaseLineId}/stop`) && response.request().method() === 'POST',
      ),
      page.getByTestId('release-stop-production-confirm').click(),
    ]);
    await expect(page.getByTestId('release-line-detail-start')).toBeVisible();
    await expect(page.getByTestId('release-line-detail-archive')).toBeVisible();

    await page.getByTestId('release-line-detail-archive').click();
    await expect(page.getByTestId('release-line-detail-archive-dialog')).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/release-lines/${releaseLineId}/archive`) && response.request().method() === 'POST',
      ),
      page.getByTestId('release-line-detail-archive-confirm').click(),
    ]);
    await expect(page.getByTestId('release-line-detail-unarchive')).toBeVisible();
    await expect(page.getByTestId('release-line-detail-status')).toContainText(/archived/i);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/release-lines/${releaseLineId}/unarchive`) &&
          response.request().method() === 'POST',
      ),
      page.getByTestId('release-line-detail-unarchive').click(),
    ]);
    await expect(page.getByTestId('release-line-detail-start')).toBeVisible();
    await expect(page.getByTestId('release-line-detail-archive')).toBeVisible();

    await page.goto(`/releases/${encodeURIComponent(releaseLineId)}?tab=settings`);
    await expect(page.getByTestId('release-line-settings-tab')).toBeVisible();
    await page.getByTestId('release-line-delete-open').click();
    await expect(page.getByTestId('release-line-delete-dialog')).toBeVisible();
    await expect(page.getByTestId('release-line-delete-impact')).toBeVisible();
    await expect(page.getByTestId('release-line-delete-impact-events')).toContainText(/[1-9]\d*/);
    await expect(page.getByTestId('release-line-delete-impact-versions')).toContainText(/[1-9]\d*/);
    await expect(page.getByTestId('release-line-delete-impact-run-results')).toContainText(/1/);

    await page.locator('#release-line-delete-name').fill(releaseLineName);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/release-lines/${releaseLineId}`) && response.request().method() === 'DELETE',
      ),
      page.getByTestId('release-line-delete-confirm').click(),
    ]);
    releaseLineId = null;
    productionEventId = null;
    await page.waitForURL(/\/releases(\?.*)?$/u);
  } finally {
    if (releaseLineId && releaseLineName) {
      await request
        .delete(`${SERVER_URL}/release-lines/${releaseLineId}`, {
          data: { confirmationName: releaseLineName, reason: 'e2e cleanup' },
        })
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
