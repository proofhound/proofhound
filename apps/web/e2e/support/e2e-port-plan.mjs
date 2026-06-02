import net from 'node:net';

const DEFAULT_BASE_URL = 'http://localhost:3200';
const DEFAULT_API_URL = 'http://localhost:4200';
const DEFAULT_WEBHOOK_URL = 'http://localhost:4201';
const DEFAULT_READY_URL = 'http://127.0.0.1:5598/readyz';
const DEFAULT_FAKE_LLM_PORT = 5599;

const usedPorts = new Set();

const plan = await createPortPlan();
process.stdout.write(`${JSON.stringify(plan)}\n`);

async function createPortPlan() {
  const baseURL = await resolveUrlPort({
    explicitUrl: process.env.PLAYWRIGHT_BASE_URL,
    preferredUrl: process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL,
  });
  const apiURL = await resolveUrlPort({
    explicitUrl: process.env.PLAYWRIGHT_SERVER_URL,
    preferredUrl: process.env.PLAYWRIGHT_SERVER_URL ?? process.env.NEXT_PUBLIC_SERVER_URL ?? DEFAULT_API_URL,
  });
  const webhookURL = await resolveUrlPort({
    explicitUrl: process.env.PLAYWRIGHT_WEBHOOK_URL,
    preferredUrl: process.env.PLAYWRIGHT_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL,
  });
  const servicesReadyURL = await resolveUrlPort({
    explicitUrl: process.env.PLAYWRIGHT_SERVICES_READY_URL,
    preferredUrl: process.env.PLAYWRIGHT_SERVICES_READY_URL ?? DEFAULT_READY_URL,
  });
  const fakeLLMPort = await resolvePort({
    explicitPort: process.env.FAKE_LLM_PORT,
    preferredPort: Number(process.env.FAKE_LLM_PORT ?? DEFAULT_FAKE_LLM_PORT),
    host: '127.0.0.1',
  });

  return {
    baseURL,
    apiURL,
    webhookURL,
    servicesReadyURL,
    fakeLLMPort,
    env: {
      PLAYWRIGHT_BASE_URL: baseURL,
      PLAYWRIGHT_SERVER_URL: apiURL,
      NEXT_PUBLIC_SERVER_URL: apiURL,
      NEXT_PUBLIC_API_URL: apiURL,
      PLAYWRIGHT_WEBHOOK_URL: webhookURL,
      PLAYWRIGHT_SERVICES_READY_URL: servicesReadyURL,
      FAKE_LLM_PORT: String(fakeLLMPort),
      WEB_PUBLIC_URL: baseURL,
    },
  };
}

async function resolveUrlPort({ explicitUrl, preferredUrl }) {
  const url = new URL(preferredUrl);
  const port = urlPort(url);

  if (explicitUrl) {
    markPort(port);
    return formatUrl(url);
  }

  if (!usedPorts.has(port) && (await isPortAvailable(url.hostname, port))) {
    markPort(port);
    return formatUrl(url);
  }

  const freePort = await findFreePort(port + 1, url.hostname);
  url.port = String(freePort);
  markPort(freePort);
  return formatUrl(url);
}

async function resolvePort({ explicitPort, preferredPort, host }) {
  if (!Number.isInteger(preferredPort) || preferredPort <= 0) {
    throw new Error(`invalid preferred e2e port: ${preferredPort}`);
  }

  if (explicitPort) {
    markPort(preferredPort);
    return preferredPort;
  }

  if (!usedPorts.has(preferredPort) && (await isPortAvailable(host, preferredPort))) {
    markPort(preferredPort);
    return preferredPort;
  }

  const freePort = await findFreePort(preferredPort + 1, host);
  markPort(freePort);
  return freePort;
}

async function findFreePort(start, host) {
  for (let port = start; port < start + 200; port += 1) {
    if (usedPorts.has(port)) continue;
    if (await isPortAvailable(host, port)) return port;
  }
  throw new Error(`unable to find free e2e port near ${start}`);
}

function markPort(port) {
  usedPorts.add(port);
}

function urlPort(url) {
  if (url.port) return Number(url.port);
  if (url.protocol === 'https:') return 443;
  return 80;
}

function formatUrl(url) {
  if (url.pathname === '/' && url.search === '' && url.hash === '') return url.origin;
  return url.toString();
}

function isPortAvailable(host, port) {
  const listenHost = host === 'localhost' ? '127.0.0.1' : host;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ host: listenHost, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}
