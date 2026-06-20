import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from './support/api';

// Unlike the page-shell smokes, this exercises the real upload → create → detail flow, so it needs the API
// server + isolated e2e database running (e.g. `pnpm dev:e2e`).
const fixturePath = resolve('e2e/fixtures/dataset-smoke.jsonl');
// The visually-hidden file input (the folder input has no `accept`).
const FILE_INPUT = 'input[accept=".csv,.tsv,.jsonl,.json,.zip"]';
const STREAMING_THRESHOLD_BYTES = 10 * 1024 * 1024;

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
      '/examples/datasets/images/image-url-fields.csv',
    );
    await expect(page.getByTestId('dataset-image-sample-proofhound-image-url-array.csv')).toHaveAttribute(
      'download',
      'proofhound-image-url-array.csv',
    );
    await expect(page.getByTestId('dataset-image-sample-proofhound-image-base64.jsonl')).toHaveAttribute(
      'href',
      '/examples/datasets/images/image-base64.jsonl',
    );
    await expect(page.getByTestId('dataset-image-sample-proofhound-image-zip-relative-paths.zip')).toHaveAttribute(
      'href',
      '/examples/datasets/images/image-zip-relative-paths.zip',
    );

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

test.describe('large delimited dataset upload', () => {
  test('reports raw upload unavailable with the OSS default object storage provider', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/dataset-imports/raw/capabilities`);

    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toEqual({ supported: false, maxBytes: 2_147_483_648 });
  });

  for (const { format, delimiter } of [
    { format: 'csv' as const, delimiter: ',' },
    { format: 'tsv' as const, delimiter: '\t' },
  ] satisfies Array<{ format: 'csv' | 'tsv'; delimiter: ',' | '\t' }>) {
    test(`streams a ${format} file larger than the server body limit through dataset-import batches`, async ({
      page,
      request,
    }, testInfo) => {
      const datasetFile = testInfo.outputPath(`large-${testInfo.repeatEachIndex}.${testInfo.project.name}.${format}`);
      const { rowCount, byteLength } = await writeLargeDelimitedFixture(datasetFile, format, delimiter);
      expect(byteLength).toBeGreaterThan(STREAMING_THRESHOLD_BYTES);

      const name = `e2e-large-${format}-${Date.now()}`;
      let datasetId = '';
      let importId = '';

      try {
        await page.goto('/datasets/new');
        await expect(page.getByTestId('dataset-upload-page')).toBeVisible();

        await page.locator(FILE_INPUT).setInputFiles(datasetFile);
        await expect(page.getByText('Parsed', { exact: true })).toBeVisible();

        await page.getByPlaceholder('risk-eval-v4').fill(name);

        const importButton = page.getByRole('button', { name: /Import/ });
        await expect(importButton).toContainText('Large file · sample count tallied while importing');
        await expect(importButton).toBeEnabled();

        const createImportResponse = page.waitForResponse(
          (response) => response.request().method() === 'POST' && response.url().endsWith('/dataset-imports'),
        );
        const firstBatchResponse = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' && /\/dataset-imports\/[^/]+\/batch$/u.test(response.url()),
        );
        const completeResponse = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' && /\/dataset-imports\/[^/]+\/complete$/u.test(response.url()),
        );

        await importButton.click();

        const created = await createImportResponse;
        expect(created.status()).toBe(201);
        const createBody = JSON.parse(created.request().postData() ?? '{}') as {
          sourceFormat?: string;
          sourceFile?: { fileSizeBytes?: number };
        };
        expect(createBody.sourceFormat).toBe(format);
        expect(createBody.sourceFile?.fileSizeBytes).toBe(byteLength);
        importId = ((await created.json()) as { id: string }).id;

        const firstBatch = await firstBatchResponse;
        expect(firstBatch.status()).toBe(201);
        const firstBatchBody = JSON.parse(firstBatch.request().postData() ?? '{}') as {
          samples?: Array<Record<string, unknown>>;
        };
        expect(firstBatchBody.samples?.length).toBeGreaterThan(0);
        expect(Buffer.byteLength(firstBatch.request().postData() ?? '', 'utf8')).toBeLessThan(10 * 1024 * 1024);

        const completed = await completeResponse;
        expect(completed.status()).toBe(201);
        const completeBody = (await completed.json()) as { dataset: { id: string }; sampleCount: number };
        datasetId = completeBody.dataset.id;
        expect(completeBody.sampleCount).toBe(rowCount);

        await page.waitForURL('**/datasets');
        await expect(page.getByTestId('datasets-page')).toBeVisible();
        await expect(page.getByText(name)).toBeVisible();
      } finally {
        if (datasetId) {
          await request.delete(`${SERVER_URL}/datasets/${datasetId}`).catch(() => undefined);
        }
        if (importId) {
          await request.delete(`${SERVER_URL}/dataset-imports/${importId}`).catch(() => undefined);
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
