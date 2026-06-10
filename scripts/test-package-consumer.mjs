import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const mode = args[0] ?? 'tarball';
const version = args[1] ?? readUnifiedPackageVersion();
const source = args[2] ?? (mode === 'tarball' ? '.npm-packages' : 'https://registry.npmjs.org/');

if (!['tarball', 'registry'].includes(mode)) {
  throw new Error('Usage: node scripts/test-package-consumer.mjs <tarball|registry> [version] [source]');
}

function readUnifiedPackageVersion() {
  const versions = new Set(
    publishablePackages.map((packageName) => {
      const packageJsonPath = join('packages', packageShortName(packageName), 'package.json');
      return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
    }),
  );

  if (versions.size !== 1) {
    throw new Error('Publishable @proofhound/* packages must share one version');
  }

  return [...versions][0];
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function findTarball(packageName, tarballDir) {
  const shortName = packageShortName(packageName);
  const expectedPrefix = `proofhound-${shortName}-${version}`;
  const tarball = readdirSync(tarballDir).find(
    (fileName) => fileName.startsWith(expectedPrefix) && fileName.endsWith('.tgz'),
  );

  if (!tarball) {
    throw new Error(`Missing ${expectedPrefix}.tgz in ${tarballDir}`);
  }

  return join(tarballDir, tarball);
}

function dependencySpec(packageName) {
  if (mode === 'registry') return version;
  return `file:${findTarball(packageName, resolve(source))}`;
}

// Registry mode mimics an anonymous consumer: ignore any ambient npm auth
// (for example the .npmrc + NODE_AUTH_TOKEN that actions/setup-node injects).
function consumerInstallEnv(consumerDir) {
  if (mode !== 'registry') return process.env;

  const env = { ...process.env };
  delete env.NODE_AUTH_TOKEN;
  delete env.NPM_TOKEN;
  const anonymousUserConfig = join(consumerDir, '.npmrc-anonymous');
  writeFileSync(anonymousUserConfig, '');
  env.NPM_CONFIG_USERCONFIG = anonymousUserConfig;
  return env;
}

function installConsumer(consumerDir) {
  const installArgs = ['install', '--ignore-scripts'];
  if (mode === 'registry') {
    installArgs.push('--registry', source);
  }

  // Freshly published packages can take minutes to propagate through the npm
  // registry read path, so give registry mode a generous retry budget.
  const maxAttempts = mode === 'registry' ? 40 : 1;
  const retryDelayMs = 15_000;
  const env = consumerInstallEnv(consumerDir);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      run('pnpm', installArgs, { cwd: consumerDir, env });
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      process.stderr.write(
        `Consumer install failed, retrying in ${retryDelayMs / 1000}s (${attempt}/${maxAttempts})...\n`,
      );
      sleep(retryDelayMs);
    }
  }
}

function writeConsumerPackage(consumerDir) {
  const dependencies = Object.fromEntries(
    publishablePackages.map((packageName) => [packageName, dependencySpec(packageName)]),
  );
  const packageJson = {
    private: true,
    type: 'module',
    dependencies,
  };

  if (mode === 'tarball') {
    packageJson.pnpm = {
      overrides: dependencies,
    };
  }

  writeFileSync(join(consumerDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
}

function writeConsumerSmokeTest(consumerDir) {
  const exportSpecifiers = [
    ...publishablePackages,
    '@proofhound/core/server',
    '@proofhound/core/webhook',
    '@proofhound/core/worker',
    '@proofhound/core/worker/config',
    '@proofhound/core/contracts',
    '@proofhound/core/infra',
    '@proofhound/db/schema',
    '@proofhound/ui/strings',
    '@proofhound/ui/primitives',
    '@proofhound/ui/lib',
    '@proofhound/ui/layout',
    '@proofhound/ui/hooks',
    '@proofhound/ui/brand',
    '@proofhound/web-ui/screens',
    '@proofhound/web-ui/hooks',
    '@proofhound/web-ui/providers',
    '@proofhound/web-ui/i18n',
    '@proofhound/web-ui/i18n/language',
    '@proofhound/web-ui/components',
    '@proofhound/web-ui/lib',
    '@proofhound/web-ui/contracts',
    '@proofhound/web-ui/styles/globals.css',
  ];

  const testSource = `
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedVersion = ${JSON.stringify(version)};
const packageNames = ${JSON.stringify(publishablePackages)};
const exportSpecifiers = ${JSON.stringify(exportSpecifiers)};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function packageRoot(packageName) {
  let current = dirname(fileURLToPath(import.meta.resolve(packageName)));
  while (current !== dirname(current)) {
    const manifestPath = join(current, 'package.json');
    if (existsSync(manifestPath)) return current;
    current = dirname(current);
  }
  throw new Error(\`Could not locate package root for \${packageName}\`);
}

for (const specifier of exportSpecifiers) {
  const resolved = fileURLToPath(import.meta.resolve(specifier));
  assert(existsSync(resolved), \`\${specifier} resolves to missing file \${resolved}\`);
  assert(resolved.includes('/dist/'), \`\${specifier} does not resolve to dist: \${resolved}\`);
}

for (const packageName of packageNames) {
  const root = packageRoot(packageName);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert(manifest.version === expectedVersion, \`\${packageName} installed \${manifest.version}, expected \${expectedVersion}\`);
  assert(manifest.private !== true, \`\${packageName} is private in consumer install\`);
  assert(!JSON.stringify(manifest).includes('workspace:'), \`\${packageName} manifest still contains workspace:\`);
}

const dbRoot = packageRoot('@proofhound/db');
assert(
  readdirSync(join(dbRoot, 'dist/migrations')).some((fileName) => /^0000_.+\\.sql$/.test(fileName)),
  '@proofhound/db consumer install is missing dist/migrations/0000_*.sql',
);

const optimizationRoot = packageRoot('@proofhound/optimization-strategy');
assert(
  readdirSync(join(optimizationRoot, 'dist/error-pattern-analysis/prompts')).some((fileName) => fileName.endsWith('.md')),
  '@proofhound/optimization-strategy consumer install is missing prompt markdown assets',
);

console.log(\`consumer ok \${expectedVersion}\`);
`;

  writeFileSync(join(consumerDir, 'consumer-smoke.mjs'), testSource);
}

const consumerDir = mkdtempSync(join(tmpdir(), `proofhound-${mode}-consumer-`));

try {
  writeConsumerPackage(consumerDir);
  installConsumer(consumerDir);
  writeConsumerSmokeTest(consumerDir);
  run('node', ['consumer-smoke.mjs'], { cwd: consumerDir });
} finally {
  rmSync(consumerDir, { force: true, recursive: true });
}
