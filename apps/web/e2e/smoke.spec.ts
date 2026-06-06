import { expect, test } from '@playwright/test';

test('home page opens the local dashboard workspace', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/dashboard');
  const topBar = page.locator('header').first();
  const brandLink = topBar.getByRole('link', { name: 'ProofHound' });
  await expect(brandLink).toBeVisible();
  await expect(brandLink).toHaveAttribute('href', '/dashboard');
  const sidebar = page.locator('[data-sidebar="sidebar"]');
  await expect(sidebar).toBeVisible();
  await expect(page.getByText('Observability')).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Monitoring' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Prompts' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Releases' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Comparison' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Quick start' })).toBeVisible();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard-page').getByRole('heading', { name: 'Default Project' })).toBeVisible();
  await expect(page.getByTestId('dashboard-events')).toBeVisible();
  await expect(page.getByTestId('overview-side-rail')).toBeVisible();
  await expect(page.getByTestId('dashboard-asset-summary')).toBeVisible();
  await expect(page.getByTestId('dashboard-asset-summary').getByRole('heading', { name: 'Assets' })).toBeVisible();
  await expect(page.getByTestId('dashboard-events').getByRole('button', { name: /All/ })).toBeVisible();
  await expect(page.getByTestId('dashboard-events').getByRole('button', { name: /Canary/ })).toHaveCount(0);
  await expect(page.getByText('Requests')).toHaveCount(0);
});

test('monitoring page renders usage overview', async ({ page }) => {
  await page.goto('/monitoring');
  await expect(page.getByTestId('monitoring-page')).toBeVisible();
  await expect(page.getByTestId('monitoring-page').getByRole('heading', { name: 'Monitoring' })).toBeVisible();
  await expect(page.getByLabel('Requests')).toBeVisible();
  await expect(page.getByText('Prompt ranking')).toBeVisible();
  await expect(page.getByText('Model ranking')).toBeVisible();
});

test('core app routes render their pages', async ({ page }) => {
  const routes = [
    { path: '/dashboard', testId: 'dashboard-page' },
    { path: '/comparisons', testId: 'comparisons-page' },
    { path: '/quick-start', testId: 'quick-start-page' },
    { path: '/releases', testId: 'releases-page' },
    { path: '/releases/new', testId: 'release-new-page' },
    { path: '/annotations', testId: 'annotations-page' },
    { path: '/annotations/new', testId: 'annotation-new-page' },
    { path: '/settings', testId: 'settings-page' },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByTestId(route.testId)).toBeVisible();
  }
});
