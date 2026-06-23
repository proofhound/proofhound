import { expect, test } from '@playwright/test';
import type { RunResultListResponseDto } from '@proofhound/shared';
import { ResourceLedger, SERVER_URL, seedDataset, seedModel, seedPrompt, seedPromptVersion } from './support/api';

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
    const samplesTable = page.getByTestId('experiment-samples');
    await expect(samplesTable).toBeVisible();
    await expect(samplesTable.getByRole('columnheader', { name: /Expected|期望输出/u })).toBeVisible();
    await expect(samplesTable.getByRole('columnheader', { name: /^(Success|是否成功)$/u })).toBeVisible();
    await expect(samplesTable.getByRole('columnheader', { name: /^(Failure reason|失败原因)$/u })).toBeVisible();
    await expect(samplesTable.getByText(/Correct|正确/u).first()).toBeVisible();

    const resultsResponse = await request.get(`${SERVER_URL}/experiments/${experimentId}/run-results`, {
      params: { pageSize: 20 },
    });
    expect(resultsResponse.ok()).toBeTruthy();
    const results = (await resultsResponse.json()) as RunResultListResponseDto;
    expect(results.data.length).toBeGreaterThan(0);
    expect(results.data.every((row) => row.expectedOutput === 'A' || row.expectedOutput === 'B')).toBe(true);
    expect(results.data.every((row) => row.status === 'success')).toBe(true);
    expect(results.data.every((row) => row.judgmentStatus === 'correct')).toBe(true);
    expect(results.data.every((row) => row.isCorrect === true)).toBe(true);
    expect(results.data.every((row) => row.errorMessage === null)).toBe(true);
  } finally {
    await ledger.cleanup();
  }
});
