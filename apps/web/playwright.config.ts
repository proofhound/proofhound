import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const configDir = __dirname;
const portPlan = resolvePortPlan();
Object.assign(process.env, portPlan.env);

const baseURL = portPlan.baseURL;
const serverURL = new URL(baseURL);
const apiURL = portPlan.apiURL;
const servicesReadyURL = portPlan.servicesReadyURL;
const webPort = serverURL.port || (serverURL.protocol === 'https:' ? '443' : '80');
const gracefulShutdown = { signal: 'SIGTERM' as const, timeout: 15_000 };

console.log(
  `[e2e-ports] web=${baseURL} api=${apiURL} webhook=${portPlan.webhookURL} services=${servicesReadyURL} fakeLlm=${portPlan.fakeLLMPort}`,
);

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
      command: `node ${'e2e/support/e2e-services.mjs'}`,
      url: servicesReadyURL,
      reuseExistingServer: false,
      timeout: 240_000,
      gracefulShutdown,
    },
    {
      command: `pnpm exec next dev -H ${serverURL.hostname} -p ${webPort}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_SERVER_URL: apiURL,
        NEXT_PUBLIC_API_URL: apiURL,
      },
      gracefulShutdown,
    },
    {
      command: `node ${'e2e/support/fake-llm-server.mjs'}`,
      url: `http://127.0.0.1:${portPlan.fakeLLMPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown,
    },
  ],
});

type PortPlan = {
  baseURL: string;
  apiURL: string;
  webhookURL: string;
  servicesReadyURL: string;
  fakeLLMPort: number;
  env: Record<string, string>;
};

function resolvePortPlan(): PortPlan {
  const output = execFileSync(process.execPath, [resolve(configDir, 'e2e/support/e2e-port-plan.mjs')], {
    cwd: configDir,
    env: process.env,
    encoding: 'utf8',
  });
  return JSON.parse(output) as PortPlan;
}
