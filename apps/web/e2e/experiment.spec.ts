import { expect, test } from '@playwright/test';
import { ResourceLedger, seedDataset, seedModel, seedPrompt, seedPromptVersion } from './support/api';

test('creates an experiment via the UI and it runs to success against the fake LLM', async ({ page, request }) => {
  test.setTimeout(150_000); // orchestration: queue + worker + 5s UI polling can exceed the 30s default
  const ledger = new ResourceLedger(request);
  const tag = `e2e-exp-${Date.now()}`;
  try {
    const datasetId = await seedDataset(request, { name: `${tag}-ds` });
    ledger.track('dataset', `/datasets/${datasetId}`);
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    const versionId = await seedPromptVersion(request, promptId, { withMarker: true });
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);

    await page.goto('/experiments/new');
    await expect(page.getByTestId('experiment-new-page')).toBeVisible();
    await page.getByTestId('experiment-new-name').fill(tag);
    await page.getByTestId(`experiment-new-prompt-row-${promptId}`).click();
    await page.getByTestId(`experiment-new-prompt-version-row-${versionId}`).click();
    await page.getByTestId(`experiment-new-dataset-row-${datasetId}`).click();
    await page.getByTestId(`experiment-new-model-row-${modelId}`).click();

    await page.getByTestId('experiment-new-submit').click();
    await page.waitForURL(/\/experiments\/[0-9a-f-]{36}$/u);
    const experimentId = page.url().split('/').pop() as string;
    ledger.track('experiment', `/experiments/${experimentId}`);

    // Worker drains the queue, calls the fake LLM, writes run_results; DBOS flips status. UI polls every 5s.
    await expect(page.getByTestId('experiment-detail-status-badge')).toContainText(/success/i, { timeout: 90_000 });
    await expect(page.getByTestId('experiment-samples')).toBeVisible();
  } finally {
    await ledger.cleanup();
  }
});
