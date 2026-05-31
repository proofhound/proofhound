import { expect, test } from '@playwright/test';
import {
  ResourceLedger,
  SERVER_URL,
  postWebhook,
  seedCanaryRelease,
  seedModel,
  seedPrompt,
  seedPromptVersion,
  seedWebhookConnector,
  waitForReleaseRunResults,
} from './support/api';

test('creates an annotation task from a canary release and labels a sample via the UI', async ({ page, request }) => {
  // Orchestration: webhook -> queue -> worker -> run_results, then 5s UI polling. Exceeds the 30s default.
  test.setTimeout(90_000);
  const ledger = new ResourceLedger(request);
  const tag = `e2e-annot-${Date.now()}`;
  let eventId: string | null = null;

  try {
    // ---- Full prerequisite chain: model + prompt(+frozen version) + webhook connector + canary release ----
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    // withMarker:false -> baseline; outputSchema declares classification 'A | B' => categoryOptions ['A','B'].
    const promptVersionId = await seedPromptVersion(request, promptId, { withMarker: false });

    const { connectorId, webhookToken, webhookSlug } = await seedWebhookConnector(request, `${tag}-conn`);
    ledger.track('connector', `/connectors/${connectorId}`);

    const { eventId: canaryEventId, releaseLineId, releaseVariantId } = await seedCanaryRelease(request, {
      promptVersionId,
      modelId,
      connectorId,
      name: `${tag}-canary`,
    });
    eventId = canaryEventId;
    expect(releaseVariantId).toBeTruthy();
    const variantId = releaseVariantId as string;

    // ---- Drive inbound traffic so the variant accumulates canary run_results to annotate ----
    await postWebhook(request, { slug: webhookSlug, token: webhookToken, payload: { id: 'ext-1', text: 'A' } });
    await postWebhook(request, { slug: webhookSlug, token: webhookToken, payload: { id: 'ext-2', text: 'B' } });
    await postWebhook(request, { slug: webhookSlug, token: webhookToken, payload: { id: 'ext-3', text: 'A' } });
    await waitForReleaseRunResults(request, { releaseLineId, releaseVariantId: variantId, scope: 'canary', min: 2 });

    // ---- Create the annotation task through the UI ----
    await page.goto('/annotations/new');
    await expect(page.getByTestId('annotation-new-page')).toBeVisible();

    await page.getByTestId('annotation-new-task-name').fill(tag);
    // Release line is a native <select>; release variant is a tile-button group (auto-selects the first).
    await page.getByTestId('annotation-new-release-line-select').selectOption(releaseLineId);
    await page.getByTestId(`annotation-new-release-variant-option-${variantId}`).click();
    // Scope is a Segmented control; 'Canary candidate' is the default but click it to be explicit.
    await page.getByTestId('annotation-new-scope').getByRole('button', { name: 'Canary candidate' }).click();
    await page.getByTestId('annotation-new-sample-size').fill('2');

    await expect(page.getByTestId('annotation-new-submit')).toBeEnabled();
    await page.getByTestId('annotation-new-submit').click();

    await page.waitForURL(/\/annotations\/[0-9a-f-]{36}$/u);
    await expect(page.getByTestId('annotation-detail-page')).toBeVisible();

    // ---- Label the first (default-selected) sample: pick category 'A' then save ----
    const categoryA = page.getByTestId('annotation-sample-category-A');
    await expect(categoryA).toBeVisible();
    await categoryA.click();

    const save = page.getByTestId('annotation-save');
    await expect(save).toBeEnabled();
    await save.click();

    // Persistence: the submitted-sample metric increments from 0 to >=1 after the write lands.
    await expect(page.getByTestId('annotation-detail-metric-submitted-value')).toContainText(/\b[1-9]\d*\b/, {
      timeout: 30_000,
    });
  } finally {
    // Cancel the running canary first (stops orchestration), then delete the seeded resources.
    if (eventId) {
      await request.post(`${SERVER_URL}/canary-releases/${eventId}/cancel`, { data: {} }).catch(() => undefined);
    }
    // Annotation tasks have NO delete route, so they are not tracked/cleaned here.
    await ledger.cleanup();
  }
});
