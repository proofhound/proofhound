import { expect, test } from '@playwright/test';

test('unknown routes render the 404 page', async ({ page }) => {
  const response = await page.goto('/missing-proofhound-route');

  expect(response?.status()).toBe(404);
  await expect(page.getByTestId('not-found-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard');
});

test('back action from 404 restores the previous app page', async ({ page }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:3200');

  await page.goto('/prompts');
  await expect(page.getByTestId('prompts-page')).toBeVisible();

  await page.goto('/missing-proofhound-route', { referer: `${baseURL}/prompts` });
  await expect(page.getByTestId('not-found-page')).toBeVisible();

  await page.getByRole('button', { name: 'Go back' }).click();

  await page.waitForURL('/prompts');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('prompts-page')).toBeVisible();
});
