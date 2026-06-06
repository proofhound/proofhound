import { expect, test } from '@playwright/test';

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
