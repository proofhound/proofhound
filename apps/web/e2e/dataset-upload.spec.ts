import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from './support/api';

// Unlike the page-shell smokes, this exercises the real upload → create → detail flow, so it needs the API
// server + isolated e2e database running (e.g. `pnpm dev:e2e`).
const fixturePath = resolve('e2e/fixtures/dataset-smoke.jsonl');
// The visually-hidden file input (the folder input has no `accept`).
const FILE_INPUT = 'input[accept=".csv,.tsv,.jsonl,.zip"]';
// Above this size the upload page previews only a head prefix (PREVIEW_PREFIX_MAX_BYTES in dataset-upload-page).
const PREVIEW_PREFIX_THRESHOLD_BYTES = 1024 * 1024;

test('uploads a JSONL dataset and browses its server-paginated detail', async ({ page }) => {
  const name = `e2e-ds-${Date.now()}`;
  let datasetId = '';

  try {
    await page.goto('/datasets/new');
    await expect(page.getByTestId('dataset-upload-page')).toBeVisible();
    await expect(page.getByTestId('dataset-upload-limit-info')).toBeVisible();
    await expect(page.getByTestId('dataset-upload-image-samples')).toBeVisible();
    await expect(page.getByTestId('dataset-image-sample-proofhound-image-url-fields.csv')).toHaveAttribute(
      'href',
      /^data:text\/csv;charset=utf-8,/,
    );
    await expect(page.getByTestId('dataset-image-sample-proofhound-image-url-array.csv')).toHaveAttribute(
      'download',
      'proofhound-image-url-array.csv',
    );
    await expect(page.getByTestId('dataset-image-sample-proofhound-image-base64.jsonl')).toHaveAttribute(
      'href',
      /^data:application\/x-ndjson;charset=utf-8,/,
    );
    await expect(page.getByTestId('dataset-image-sample-proofhound-image-zip-relative-paths.zip')).toHaveAttribute(
      'href',
      /^data:application\/zip;base64,UEs/,
    );

    // The file input is hidden; setInputFiles drives the in-browser parse + field-role inference.
    await page.locator(FILE_INPUT).setInputFiles(fixturePath);
    await expect(page.getByText('Parsed', { exact: true })).toBeVisible();

    await page.getByPlaceholder('risk-eval-v4').fill(name);

    const importButton = page.getByRole('button', { name: /Import/ });
    await expect(importButton).toBeEnabled();

    const uploadResponse = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/datasets/upload'),
    );
    await importButton.click();
    const created = await uploadResponse;
    expect(created.status()).toBe(201);
    const uploaded = (await created.json()) as { datasetId: string | null; state: string };
    expect(uploaded.state).toBe('completed');
    datasetId = uploaded.datasetId ?? '';
    expect(datasetId).not.toBe('');

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

test.describe('large delimited dataset upload', () => {
  for (const { format, delimiter } of [
    { format: 'csv' as const, delimiter: ',' },
    { format: 'tsv' as const, delimiter: '\t' },
  ] satisfies Array<{ format: 'csv' | 'tsv'; delimiter: ',' | '\t' }>) {
    test(`uploads a large ${format} file in a single multipart request`, async ({ page, request }, testInfo) => {
      const datasetFile = testInfo.outputPath(`large-${testInfo.repeatEachIndex}.${testInfo.project.name}.${format}`);
      const { rowCount, byteLength } = await writeLargeDelimitedFixture(datasetFile, format, delimiter);
      // Large enough that the browser previews only a head prefix instead of parsing the whole file.
      expect(byteLength).toBeGreaterThan(PREVIEW_PREFIX_THRESHOLD_BYTES);

      const name = `e2e-large-${format}-${Date.now()}`;
      let datasetId = '';

      try {
        await page.goto('/datasets/new');
        await expect(page.getByTestId('dataset-upload-page')).toBeVisible();

        await page.locator(FILE_INPUT).setInputFiles(datasetFile);
        await expect(page.getByText('Parsed', { exact: true })).toBeVisible();

        await page.getByPlaceholder('risk-eval-v4').fill(name);

        const importButton = page.getByRole('button', { name: /Import/ });
        // Large files keep only a preview prefix in state, so the button shows the streaming label.
        await expect(importButton).toContainText(/sample count tallied while importing/i);
        await expect(importButton).toBeEnabled();

        const uploadResponse = page.waitForResponse(
          (response) => response.request().method() === 'POST' && response.url().endsWith('/datasets/upload'),
        );

        await importButton.click();

        const uploaded = await uploadResponse;
        expect(uploaded.status()).toBe(201);
        const body = (await uploaded.json()) as {
          datasetId: string | null;
          progress: { importedRows: number };
          sourceFormat: string;
          state: string;
        };
        expect(body.state).toBe('completed');
        expect(body.sourceFormat).toBe(format);
        expect(body.progress.importedRows).toBe(rowCount);
        datasetId = body.datasetId ?? '';
        expect(datasetId).not.toBe('');

        await page.waitForURL('**/datasets');
        await expect(page.getByTestId('datasets-page')).toBeVisible();
        await expect(page.getByText(name)).toBeVisible();
      } finally {
        if (datasetId) {
          await request.delete(`${SERVER_URL}/datasets/${datasetId}`).catch(() => undefined);
        }
      }
    });
  }
});

async function writeLargeDelimitedFixture(path: string, format: 'csv' | 'tsv', delimiter: ',' | '\t') {
  const rowCount = 56;
  const payload = 'x'.repeat(200 * 1024);
  const quote = format === 'csv' ? '"' : '';
  let byteLength = 0;

  const stream = createWriteStream(path);
  const write = (chunk: string) =>
    new Promise<void>((resolvePromise, reject) => {
      byteLength += Buffer.byteLength(chunk, 'utf8');
      if (stream.write(chunk)) {
        resolvePromise();
        return;
      }
      stream.once('drain', resolvePromise);
      stream.once('error', reject);
    });

  await write(['sample_id', 'text', 'expected_output'].join(delimiter) + '\n');
  for (let index = 0; index < rowCount; index += 1) {
    const row = [`case-${String(index + 1).padStart(4, '0')}`, `${quote}${payload}${quote}`, 'ok'];
    await write(row.join(delimiter) + '\n');
  }

  await new Promise<void>((resolvePromise, reject) => {
    stream.end((error?: Error | null) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });

  return { rowCount, byteLength };
}
