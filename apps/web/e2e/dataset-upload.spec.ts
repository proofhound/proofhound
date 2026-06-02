import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from './support/api';

// Unlike the page-shell smokes, this exercises the real upload → create → detail flow, so it needs the API
// server + isolated e2e database running (e.g. `pnpm dev:e2e`).
const fixturePath = resolve('e2e/fixtures/dataset-smoke.jsonl');
// The visually-hidden file input (the folder input has no `accept`).
const FILE_INPUT = 'input[accept=".csv,.tsv,.jsonl,.json,.zip"]';

test('uploads a JSONL dataset and browses its server-paginated detail', async ({ page }) => {
  const name = `e2e-ds-${Date.now()}`;
  let datasetId = '';

  try {
    await page.goto('/datasets/new');
    await expect(page.getByTestId('dataset-upload-page')).toBeVisible();

    // The file input is hidden; setInputFiles drives the in-browser parse + field-role inference.
    await page.locator(FILE_INPUT).setInputFiles(fixturePath);
    await expect(page.getByText('Parsed', { exact: true })).toBeVisible();

    await page.getByPlaceholder('risk-eval-v4').fill(name);

    const importButton = page.getByRole('button', { name: /Import/ });
    await expect(importButton).toBeEnabled();

    const createResponse = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/datasets'),
    );
    await importButton.click();
    const created = await createResponse;
    expect(created.status()).toBe(201);
    datasetId = ((await created.json()) as { dataset: { id: string } }).dataset.id;

    // Lands back on the list with the new dataset visible.
    await page.waitForURL('**/datasets');
    await expect(page.getByTestId('datasets-page')).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();

    // Detail: samples are server-paginated (50/page); 60 rows => 2 pages.
    await page.goto(`/datasets/${datasetId}`);
    await expect(page.getByTestId('dataset-samples-table')).toBeVisible();
    await expect(page.getByText(/case-\d{6}/).first()).toBeVisible();

    // Next page hits the server with page=2 (no client-side slicing).
    const pageTwo = page.waitForResponse((response) => /\/samples\?.*page=2/.test(response.url()));
    await page.getByRole('button', { name: 'Next page' }).click();
    await pageTwo;

    // Search is server-side (data::text ILIKE); the matching sample surfaces regardless of page.
    const searched = page.waitForResponse((response) => /\/samples\?.*search=case-000005/.test(response.url()));
    await page.locator('input[type="search"]').fill('case-000005');
    await searched;
    await expect(page.getByTestId('dataset-samples-table').getByText('case-000005')).toBeVisible();
  } finally {
    if (datasetId) {
      await page.request.delete(`${SERVER_URL}/datasets/${datasetId}`).catch(() => undefined);
    }
  }
});
