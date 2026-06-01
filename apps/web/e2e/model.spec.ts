import { expect, test } from '@playwright/test';
import { SERVER_URL } from './support/api';
import { FAKE_LLM_ENDPOINT } from './support/fake-llm-contract.mjs';

test('creates a model via the UI at /models/new', async ({ page }) => {
  const name = `e2e-model-${Date.now()}`;
  let modelId: string | undefined;
  try {
    await page.goto('/models/new');
    await expect(page.getByTestId('model-new-page')).toBeVisible();

    await page.getByTestId('model-new-name').fill(name);

    // providerType is a Radix Select (combobox), not a native <select>:
    // open the trigger, then click the 'openai' option rendered in the portal.
    await page.getByTestId('model-new-provider-type').click();
    await page.getByTestId('model-new-provider-option-openai').click();

    await page.getByTestId('model-new-endpoint').fill(FAKE_LLM_ENDPOINT);
    await page.getByTestId('model-new-api-key').fill('sk-fake-e2e');
    await page.getByTestId('model-new-provider-model-id').fill('fake-model');

    // Required by the submit gate (readProjectModelCreatePayload): contextWindowTokens must be a
    // positive integer, rpm/tpm must be positive integers (no UI defaults for these three fields).
    await page.getByTestId('model-new-context-window').fill('128000');
    await page.getByTestId('model-new-rpm-limit').fill('600');
    await page.getByTestId('model-new-tpm-limit').fill('100000');

    // Capture the created model id from the create response (envelope: top-level { id }).
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/models') &&
        response.ok(),
    );

    await page.getByTestId('model-new-submit').click();

    const created = (await (await createResponse).json()) as { id: string };
    modelId = created.id;
    expect(modelId).toBeTruthy();

    // Success: the new-model form redirects to the models list.
    await page.waitForURL(/\/models$/u);
    await expect(page.getByTestId('models-page')).toBeVisible();
  } finally {
    if (modelId) await page.request.delete(`${SERVER_URL}/models/${modelId}`).catch(() => undefined);
  }
});
