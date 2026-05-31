import { defineConfig, devices } from '@playwright/test';
import { FAKE_LLM_PORT } from './e2e/support/fake-llm-contract.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const serverURL = new URL(baseURL);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL,
    locale: 'en-US',
    // Record a full trace for every test locally (view with `pnpm test:e2e:report`); keep CI lean.
    trace: process.env.CI ? 'on-first-retry' : 'on',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `pnpm exec next dev -H ${serverURL.hostname} -p ${serverURL.port || '3000'}`,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `node ${'e2e/support/fake-llm-server.mjs'}`,
      url: `http://127.0.0.1:${FAKE_LLM_PORT}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
