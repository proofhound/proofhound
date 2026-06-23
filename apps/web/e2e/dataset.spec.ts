import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from './support/api';

// Mirrors dataset-upload.spec.ts (JSONL) for the CSV happy path: it exercises the real
// in-browser parse -> dataset import session -> list flow, so it needs the API server + database
// running (e.g. `pnpm dev`). It self-cleans the dataset it creates via the REST API.
const fixturePath = resolve('e2e/fixtures/dataset-smoke.csv');
// The visually-hidden file input (the folder input has no `accept`).
const FILE_INPUT = 'input[accept=".csv,.tsv,.jsonl,.zip"]';

test('uploads a CSV dataset and lands on the list', async ({ page }) => {
  const name = `e2e-ds-csv-${Date.now()}`;
  let datasetId = '';

  try {
    await page.goto('/datasets/new');
    await expect(page.getByTestId('dataset-upload-page')).toBeVisible();

    // The file input is hidden; setInputFiles drives the in-browser CSV parse + field-role inference.
    await page.locator(FILE_INPUT).setInputFiles(fixturePath);
    await expect(page.getByText('Parsed', { exact: true })).toBeVisible();

    await page.getByPlaceholder('risk-eval-v4').fill(name);

    const importButton = page.getByRole('button', { name: /Import/ });
    await expect(importButton).toBeEnabled();

    const createDatasetResponse = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/datasets'),
    );
    await importButton.click();
    const created = await createDatasetResponse;
    expect(created.status()).toBe(201);
    datasetId = ((await created.json()) as { dataset: { id: string } }).dataset.id;
    expect(datasetId).not.toBe('');

    // Lands back on the list with the new dataset visible.
    await page.waitForURL('**/datasets');
    await expect(page.getByTestId('datasets-page')).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
  } finally {
    if (datasetId) {
      await page.request.delete(`${SERVER_URL}/datasets/${datasetId}`).catch(() => undefined);
    }
  }
});
