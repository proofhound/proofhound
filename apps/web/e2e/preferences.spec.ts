import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { ResourceLedger, SERVER_URL, seedDataset } from './support/api';

function formatDateTime(value: string, timeZone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

async function getDataset(request: APIRequestContext, datasetId: string) {
  const response = await request.get(`${SERVER_URL}/datasets/${datasetId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; createdAt: string };
}

test('timezone preference changes OSS page timestamps', async ({ page, request }) => {
  const ledger = new ResourceLedger(request);
  const datasetId = await seedDataset(request, { name: `e2e-timezone-${Date.now()}` });
  ledger.track('dataset', `/datasets/${datasetId}`);

  try {
    const dataset = await getDataset(request, datasetId);
    await page.addInitScript(() => {
      window.localStorage.setItem('proofhound.timeZone', 'UTC');
    });

    await page.goto('/datasets');
    const createdAtCell = page.getByTestId(`dataset-created-at-${datasetId}`);
    await expect(createdAtCell).toHaveText(formatDateTime(dataset.createdAt, 'UTC'));

    await page.getByRole('button', { name: 'Change timezone' }).click();
    await page.getByTestId('timezone-menu-trigger').hover();
    await expect(page.getByTestId('timezone-search')).toBeVisible();
    await page.getByTestId('timezone-search').fill('Shanghai');
    await page.getByTestId('timezone-option-Asia/Shanghai').dispatchEvent('click');
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('proofhound.timeZone')))
      .toBe('Asia/Shanghai');

    await expect(createdAtCell).toHaveText(formatDateTime(dataset.createdAt, 'Asia/Shanghai'));
  } finally {
    await ledger.cleanup();
  }
});

test('app pages expose language and theme color controls', async ({ page }) => {
  await page.goto('/prompts');

  // Theme color is switched from the top-bar theme dropdown (no layout-customization drawer in the OSS shell).
  await page.getByRole('button', { name: 'Change theme color' }).click();
  await page.getByRole('menuitemradio', { name: /Electric/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'electric');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'electric');

  // The removed layout-customization drawer must no longer be reachable from the app shell.
  await expect(page.getByRole('button', { name: 'Open theme settings' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Change theme color' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

  await page.getByRole('button', { name: 'Change theme color' }).click();
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);

  await page.getByRole('button', { name: 'Change theme color' }).click();
  await page.getByRole('menuitemradio', { name: /Twilight/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'twilight');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'twilight');

  await page.getByRole('button', { name: 'Change language' }).click();
  await page.getByRole('menuitemradio', { name: /中文/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByTestId('prompts-page').getByRole('heading', { name: '提示词' })).toBeVisible();
});
