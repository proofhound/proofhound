import { expect, test } from '@playwright/test';
import { ResourceLedger, seedDataset, seedExperiment, seedModel, seedPromptVersion } from './support/api';

test('creates a prompt via the UI, then a referenced version freezes and is read-only', async ({ page, request }) => {
  const ledger = new ResourceLedger(request);
  const tag = `e2e-prompt-${Date.now()}`;
  try {
    // ---- Part A: create a prompt through the inline create dialog ----
    await page.goto('/prompts/new');
    await expect(page.getByTestId('prompt-create-dialog')).toBeVisible();
    await page.getByTestId('prompt-new-name').fill(`${tag}-prompt`);

    // POST /prompts returns the prompt detail object with a top-level { id }.
    const createResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/prompts') && response.request().method() === 'POST',
    );
    await page.getByTestId('prompt-new-submit').click();
    const createResponse = await createResponsePromise;
    const promptId = ((await createResponse.json()) as { id: string }).id;
    ledger.track('prompt', `/prompts/${promptId}`);

    // The dialog closes and the app redirects to the new prompt's detail page.
    await page.waitForURL(new RegExp(`/prompts/${promptId}$`, 'u'));
    await expect(page.getByTestId('prompt-detail-page')).toBeVisible();
    await expect(page.getByTestId('prompt-create-dialog')).toBeHidden();

    // ---- Part B: reference a version so it freezes, then verify the UI marks it frozen ----
    // Add a content version (its own draft), then reference it from an experiment. Referencing
    // a prompt version freezes it (AGENTS.md §5.5), with a DB trigger as a backstop.
    const versionId = await seedPromptVersion(request, promptId, { withMarker: false });
    const datasetId = await seedDataset(request, { name: `${tag}-ds` });
    ledger.track('dataset', `/datasets/${datasetId}`);
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);
    const experimentId = await seedExperiment(request, {
      name: `${tag}-exp`,
      promptVersionId: versionId,
      datasetId,
      modelId,
    });
    ledger.track('experiment', `/experiments/${experimentId}`);

    // Activate the frozen version directly via the ?version=<id> param (the detail page selects an
    // editable draft by default, so we must target the referenced version explicitly).
    await page.goto(`/prompts/${promptId}?version=${versionId}`);
    await expect(page.getByTestId('prompt-detail-page')).toBeVisible();

    // Frozen indicator: a dedicated badge in the active-version header, shown only when frozen.
    await expect(page.getByTestId('prompt-version-frozen-badge')).toBeVisible();
    // Read-only: the save control is not rendered for a frozen version.
    await expect(page.getByTestId('prompt-version-save')).toHaveCount(0);
  } finally {
    // Reverse-dependency teardown: experiment -> model -> dataset -> prompt.
    await ledger.cleanup();
  }
});
