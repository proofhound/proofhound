import { expect, test } from '@playwright/test';
import {
  ResourceLedger,
  SERVER_URL,
  seedDataset,
  seedExperiment,
  seedModel,
  seedPrompt,
  seedPromptVersion,
} from './support/api';

test('archives and restores datasets and prompts from the list pages', async ({ page, request }) => {
  const ledger = new ResourceLedger(request);
  const tag = `e2e-archive-${Date.now()}`;

  try {
    const datasetId = await seedDataset(request, { name: `${tag}-dataset` });
    ledger.track('dataset', `/datasets/${datasetId}`);
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);

    await page.goto('/datasets');
    await page.getByPlaceholder('Search name / description').fill(`${tag}-dataset`);
    await expect(page.getByText(`${tag}-dataset`)).toBeVisible();

    await page.getByTestId(`dataset-action-more-${datasetId}`).click();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/datasets/${datasetId}/archive`) && response.request().method() === 'PATCH',
      ),
      page.getByTestId(`dataset-action-archive-${datasetId}`).click(),
    ]);
    await expect(page.getByTestId(`dataset-action-start-experiment-${datasetId}`)).toBeDisabled();
    await expect(page.getByTestId(`dataset-action-start-optimization-${datasetId}`)).toBeDisabled();

    await page.getByTestId(`dataset-action-more-${datasetId}`).click();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/datasets/${datasetId}/restore`) && response.request().method() === 'PATCH',
      ),
      page.getByTestId(`dataset-action-restore-${datasetId}`).click(),
    ]);
    await expect(page.getByTestId(`dataset-action-start-experiment-${datasetId}`)).toBeEnabled();
    await expect(page.getByTestId(`dataset-action-start-optimization-${datasetId}`)).toBeEnabled();

    await page.goto('/prompts');
    await page.getByPlaceholder('Search name, tags, or variables...').fill(`${tag}-prompt`);
    await expect(page.getByText(`${tag}-prompt`)).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/prompts/${promptId}/archive`) && response.request().method() === 'PATCH',
      ),
      page.getByTestId(`prompt-action-archive-${promptId}`).click(),
    ]);
    await expect(page.getByTestId(`prompt-action-start-experiment-${promptId}`)).toBeDisabled();
    await expect(page.getByTestId(`prompt-action-start-optimization-${promptId}`)).toBeDisabled();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/prompts/${promptId}/restore`) && response.request().method() === 'PATCH',
      ),
      page.getByTestId(`prompt-action-restore-${promptId}`).click(),
    ]);
    await expect(page.getByTestId(`prompt-action-start-experiment-${promptId}`)).toBeEnabled();
    await expect(page.getByTestId(`prompt-action-start-optimization-${promptId}`)).toBeEnabled();
  } finally {
    await ledger.cleanup();
  }
});

test('shows deletion impact and cascades dependent experiments', async ({ page, request }) => {
  test.setTimeout(90_000);
  const ledger = new ResourceLedger(request);
  const tag = `e2e-delete-impact-${Date.now()}`;

  try {
    const datasetId = await seedDataset(request, { name: `${tag}-dataset` });
    ledger.track('dataset', `/datasets/${datasetId}`);
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    const promptVersionId = await seedPromptVersion(request, promptId, { withMarker: true });
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);
    const experimentId = await seedExperiment(request, {
      name: `${tag}-experiment`,
      promptVersionId,
      datasetId,
      modelId,
    });
    ledger.track('experiment', `/experiments/${experimentId}`);

    await page.goto('/datasets');
    await page.getByPlaceholder('Search name / description').fill(`${tag}-dataset`);
    await expect(page.getByText(`${tag}-dataset`)).toBeVisible();
    await page.getByTestId(`dataset-action-more-${datasetId}`).click();
    await page.getByTestId(`dataset-action-delete-${datasetId}`).click();

    await expect(page.getByTestId('datasets-delete-dialog')).toBeVisible();
    await expect(page.getByTestId('datasets-delete-impact')).toContainText(`${tag}-experiment`);
    await expect(page.getByTestId('datasets-delete-impact')).toContainText('Experiment');

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith(`/datasets/${datasetId}`) && response.request().method() === 'DELETE',
      ),
      page.getByTestId('datasets-delete-confirm').click(),
    ]);
    await expect(page.getByText(`${tag}-dataset`)).toHaveCount(0);
    await expectResourceMissing(request, `/experiments/${experimentId}`);

    const promptDeleteDatasetId = await seedDataset(request, { name: `${tag}-prompt-dataset` });
    ledger.track('dataset', `/datasets/${promptDeleteDatasetId}`);
    const promptDeletePromptId = await seedPrompt(request, `${tag}-prompt-delete`);
    ledger.track('prompt', `/prompts/${promptDeletePromptId}`);
    const promptDeleteVersionId = await seedPromptVersion(request, promptDeletePromptId, { withMarker: true });
    const promptDeleteExperimentId = await seedExperiment(request, {
      name: `${tag}-prompt-experiment`,
      promptVersionId: promptDeleteVersionId,
      datasetId: promptDeleteDatasetId,
      modelId,
    });
    ledger.track('experiment', `/experiments/${promptDeleteExperimentId}`);

    await page.goto('/prompts');
    await page.getByPlaceholder('Search name, tags, or variables...').fill(`${tag}-prompt-delete`);
    await expect(page.getByText(`${tag}-prompt-delete`)).toBeVisible();
    await page.getByTestId(`prompt-action-delete-${promptDeletePromptId}`).click();

    await expect(page.getByTestId('prompts-delete-dialog')).toBeVisible();
    await expect(page.getByTestId('prompts-delete-impact')).toContainText(`${tag}-prompt-experiment`);
    await expect(page.getByTestId('prompts-delete-impact')).toContainText('Experiment');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/prompts/${promptDeletePromptId}`) && response.request().method() === 'DELETE',
      ),
      page.getByTestId('prompts-delete-confirm').click(),
    ]);
    await expect(page.getByText(`${tag}-prompt-delete`)).toHaveCount(0);
    await expectResourceMissing(request, `/experiments/${promptDeleteExperimentId}`);
  } finally {
    await ledger.cleanup();
  }
});

async function expectResourceMissing(request: Parameters<typeof seedDataset>[0], path: string) {
  const res = await request.get(`${SERVER_URL}${path}`);
  expect(res.status()).toBe(404);
}
