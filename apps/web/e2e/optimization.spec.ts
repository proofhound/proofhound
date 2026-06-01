import { expect, test } from '@playwright/test';
import { ResourceLedger, seedDataset, seedModel, seedPrompt, seedPromptVersion } from './support/api';

test('runs a prompt-version optimization to success via the UI', async ({ page, request }) => {
  test.setTimeout(240_000); // optimizer loop: queue + worker + multi-round fake-LLM + 5s UI polling
  const ledger = new ResourceLedger(request);
  const tag = `e2e-opt-${Date.now()}`;
  try {
    // ---- Seed prerequisites via REST (proven path: baseline prompt + positive-limit model) ----
    const datasetId = await seedDataset(request, { name: `${tag}-ds` });
    ledger.track('dataset', `/datasets/${datasetId}`);
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    // BASELINE version (no marker → fake LLM is wrong → accuracy 0 until the optimizer injects its marker).
    const baseVersionId = await seedPromptVersion(request, promptId, { withMarker: false });
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);

    // ---- Drive the create UI in 'from_prompt_version' (origin mode 'prompt') ----
    await page.goto('/optimizations/new');
    await expect(page.getByTestId('optimization-new-page')).toBeVisible();
    await page.getByTestId('optimization-new-name').fill(tag);
    await page.getByTestId('optimization-new-origin-mode-prompt').click();
    await page.getByTestId(`optimization-new-prompt-row-${promptId}`).click();
    await page.getByTestId(`optimization-new-version-row-${baseVersionId}`).click();
    await page.getByTestId(`optimization-new-dataset-row-${datasetId}`).click();
    await page.getByTestId(`optimization-new-model-row-${modelId}`).click();
    await page.getByTestId(`optimization-new-analysis-model-row-${modelId}`).click();

    // Goal: accuracy >= 0.95 overall. The form defaults to accuracy/gte/0.90; controls are native
    // <select>/<input>, so set explicitly to reach the 0.95 target the seed proved attainable.
    await page.getByTestId('optimization-new-goal-metric').selectOption('accuracy');
    await page.getByTestId('optimization-new-goal-comparator').selectOption('gte');
    await page.getByTestId('optimization-new-goal-target').fill('0.95');

    await page.getByTestId('optimization-new-submit').click();
    await page.waitForURL(/\/optimizations\/[0-9a-f-]{36}$/u);
    const optimizationId = page.url().split('/').pop() as string;
    ledger.track('optimization', `/optimizations/${optimizationId}`);

    // Worker runs the optimizer loop against the fake LLM; once the marker prompt is generated,
    // accuracy hits 1.0 → goals_met → status 'success'. UI polls every 5s.
    await expect(page.getByTestId('optimization-detail-status-badge')).toContainText(/success/i, {
      timeout: 200_000,
    });
  } finally {
    await ledger.cleanup();
  }
});
