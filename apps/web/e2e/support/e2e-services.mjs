import { createServer } from 'node:http';
import net from 'node:net';
import { createWriteStream, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../../../..');

const DEFAULT_MODEL_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/proofhound_e2e';
const DEFAULT_REDIS_URL = 'redis://localhost:6379/1';
const DEFAULT_BASE_URL = 'http://localhost:3200';
const DEFAULT_API_URL = 'http://localhost:4200';
const DEFAULT_WEBHOOK_URL = 'http://localhost:4201';
const DEFAULT_READY_URL = 'http://127.0.0.1:5598/readyz';

const children = [];
let shuttingDown = false;
let readinessServer;

process.once('SIGINT', () => void shutdown(130));
process.once('SIGTERM', () => void shutdown(0));

main().catch((error) => {
  console.error('[e2e-services] failed to start', error);
  void shutdown(1);
});

async function main() {
  loadRootEnv();

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL;
  const apiURL = process.env.PLAYWRIGHT_SERVER_URL ?? process.env.NEXT_PUBLIC_SERVER_URL ?? DEFAULT_API_URL;
  const webhookURL = process.env.PLAYWRIGHT_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL;
  const readyURL = process.env.PLAYWRIGHT_SERVICES_READY_URL ?? DEFAULT_READY_URL;
  const databaseURL = process.env.E2E_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const redisURL = process.env.E2E_REDIS_URL ?? DEFAULT_REDIS_URL;

  process.env.DATABASE_URL = databaseURL;
  process.env.E2E_DATABASE_URL = databaseURL;
  process.env.REDIS_URL = redisURL;
  process.env.E2E_REDIS_URL = redisURL;
  process.env.NEXT_PUBLIC_SERVER_URL = apiURL;
  process.env.WEB_PUBLIC_URL = process.env.WEB_PUBLIC_URL ?? baseURL;
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
  process.env.MODEL_API_KEY_ENCRYPTION_KEY = process.env.MODEL_API_KEY_ENCRYPTION_KEY ?? DEFAULT_MODEL_KEY;
  process.env.WEBHOOK_BODY_LIMIT = process.env.WEBHOOK_BODY_LIMIT ?? '1mb';
  process.env.WORKER_CONCURRENCY = process.env.WORKER_CONCURRENCY ?? '16';
  process.env.RELEASE_RUNNER_SCAN_INTERVAL_MS = process.env.RELEASE_RUNNER_SCAN_INTERVAL_MS ?? '2000';

  await ensureDependencyServices(databaseURL, redisURL);
  await resetDatabase();
  await startHttpService({
    name: 'server',
    readyUrl: new URL('/readyz', apiURL).toString(),
    command: ['pnpm', ['--filter', '@proofhound/server', 'dev']],
    env: serviceEnv({ PORT: undefined, SERVER_PORT: String(urlPort(apiURL, 4000)) }),
    logFile: '/tmp/proofhound-e2e-server.log',
  });
  await startHttpService({
    name: 'webhook',
    readyUrl: new URL('/readyz', webhookURL).toString(),
    command: ['pnpm', ['--filter', '@proofhound/webhook', 'dev']],
    env: serviceEnv({ PORT: String(urlPort(webhookURL, 4001)) }),
    logFile: '/tmp/proofhound-e2e-webhook.log',
  });
  await startWorker();

  await startReadinessServer(readyURL);
}

function loadRootEnv() {
  const envPath = resolve(rootDir, '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.warn('[e2e-services] unable to load root .env', error);
  }
}

async function ensureDependencyServices(databaseURL, redisURL) {
  const databaseReady = await isTcpReachable(urlHost(databaseURL), urlPort(databaseURL, 5432), 750);
  const redisReady = await isTcpReachable(urlHost(redisURL), urlPort(redisURL, 6379), 750);
  const shouldStartKafka = process.env.PLAYWRIGHT_START_KAFKA === '1';
  const kafkaReady = shouldStartKafka ? await isTcpReachable('127.0.0.1', 9092, 750) : true;
  const missingServices = [
    ...(databaseReady ? [] : ['postgres']),
    ...(redisReady ? [] : ['redis']),
    ...(kafkaReady ? [] : ['kafka']),
  ];

  if (missingServices.length === 0) {
    const dependencies = shouldStartKafka ? 'postgres/redis/kafka' : 'postgres/redis';
    console.log(`[e2e-services] ${dependencies} already reachable`);
    return;
  }

  if (process.env.PLAYWRIGHT_SKIP_DOCKER === '1') {
    console.log(
      `[e2e-services] missing ${missingServices.join(', ')}; PLAYWRIGHT_SKIP_DOCKER=1 so not starting docker`,
    );
    return;
  }

  const missingLocalUrls = [...(databaseReady ? [] : [databaseURL]), ...(redisReady ? [] : [redisURL])];
  const canStartDocker = missingLocalUrls.every((url) => isLocalHost(urlHost(url)));
  if (!canStartDocker) {
    console.log('[e2e-services] dependency URLs are not local; not starting docker compose');
    return;
  }

  await runForeground('docker compose dependencies', 'docker', [
    'compose',
    '-f',
    'dev/docker-compose.yml',
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '180',
    ...missingServices,
  ]);
}

async function resetDatabase() {
  if (process.env.PLAYWRIGHT_SKIP_DB_RESET === '1') {
    console.log('[e2e-services] PLAYWRIGHT_SKIP_DB_RESET=1; skipping isolated database reset');
    return;
  }
  await runForeground('isolated e2e database reset', 'pnpm', ['db:e2e:reset']);
}

async function startHttpService({ name, readyUrl, command, env, logFile }) {
  const child = startProcess(name, command[0], command[1], env, logFile);
  await waitForHttpOk(name, readyUrl, 180_000);
  console.log(`[e2e-services] ${name} ready at ${readyUrl}`);
  return child;
}

async function startWorker() {
  const child = startProcess(
    'worker',
    'pnpm',
    ['--filter', '@proofhound/worker', 'dev'],
    serviceEnv({ PORT: undefined }),
    '/tmp/proofhound-e2e-worker.log',
  );
  await waitForOutput(child, /worker_started/u, 180_000);
  console.log('[e2e-services] worker ready');
}

function serviceEnv(overrides) {
  const env = { ...process.env, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
  }
  return env;
}

function startProcess(name, command, args, env, logFile) {
  console.log(`[e2e-services] starting ${name}: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd: rootDir,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.name = name;
  child.outputBuffer = '';
  children.push(child);

  const log = createWriteStream(logFile, { flags: 'a' });
  const pipe = (chunk, target) => {
    const text = chunk.toString();
    child.outputBuffer += text;
    log.write(text);
    target.write(prefixLines(name, text));
  };
  child.stdout.on('data', (chunk) => pipe(chunk, process.stdout));
  child.stderr.on('data', (chunk) => pipe(chunk, process.stderr));
  child.on('exit', (code, signal) => {
    log.end();
    if (!shuttingDown && code !== 0) {
      console.error(`[e2e-services] ${name} exited unexpectedly`, { code, signal });
      void shutdown(code ?? 1);
    }
  });
  child.on('error', (error) => {
    console.error(`[e2e-services] unable to start ${name}`, error);
    void shutdown(1);
  });
  return child;
}

async function runForeground(label, command, args) {
  console.log(`[e2e-services] running ${label}: ${command} ${args.join(' ')}`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: rootDir, env: process.env, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
    child.on('error', reject);
  });
}

async function waitForHttpOk(name, readyUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHttpOk(readyUrl)) return;
    await sleep(1_000);
  }
  throw new Error(`${name} did not become ready at ${readyUrl}`);
}

async function waitForOutput(child, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(child.outputBuffer)) return;
    await sleep(500);
  }
  throw new Error(`${child.name} did not print readiness marker ${pattern}`);
}

async function isHttpOk(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function isTcpReachable(host, port, timeoutMs) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

async function startReadinessServer(readyUrl) {
  const url = new URL(readyUrl);
  const port = urlPort(readyUrl, 5598);
  const host = url.hostname || '127.0.0.1';
  readinessServer = createServer((request, response) => {
    if (request.url === url.pathname) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise((resolvePromise, reject) => {
    readinessServer.once('error', reject);
    readinessServer.listen(port, host, resolvePromise);
  });
  console.log(`[e2e-services] readiness endpoint listening at ${readyUrl}`);
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[e2e-services] shutting down started child processes');
  readinessServer?.close();
  await Promise.all(children.map(stopChild));
  process.exit(exitCode);
}

function stopChild(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.killed) {
      resolvePromise();
      return;
    }
    child.once('exit', resolvePromise);
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      resolvePromise();
    }
    setTimeout(() => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already exited.
      }
      resolvePromise();
    }, 8_000).unref();
  });
}

function urlHost(value) {
  return new URL(value).hostname || '127.0.0.1';
}

function urlPort(value, fallback) {
  const url = new URL(value);
  if (url.port) return Number(url.port);
  if (url.protocol === 'https:') return 443;
  if (url.protocol === 'http:') return 80;
  if (url.protocol === 'redis:') return 6379;
  if (url.protocol.startsWith('postgres')) return 5432;
  return fallback;
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function prefixLines(name, text) {
  return text
    .split(/(\n)/u)
    .map((part) => (part === '\n' || part.length === 0 ? part : `[${name}] ${part}`))
    .join('');
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
