import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function listTarball(tarballPath) {
  return run('tar', ['-tzf', tarballPath])
    .trim()
    .split('\n')
    .filter(Boolean);
}

function extractTarball(tarballPath, targetDir) {
  run('tar', ['-xzf', tarballPath, '-C', targetDir]);
}

function hasEntry(entries, path) {
  return entries.includes(`package/${path}`);
}

function hasEntryMatching(entries, pattern) {
  return entries.some((entry) => pattern.test(entry));
}

function collectDependencyVersions(manifest) {
  return [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
    manifest.devDependencies,
  ].filter(Boolean);
}

function assertNoWorkspaceDependencies(manifest, packageName) {
  for (const dependencyMap of collectDependencyVersions(manifest)) {
    for (const [dependencyName, version] of Object.entries(dependencyMap)) {
      assert(
        typeof version !== 'string' || !version.startsWith('workspace:'),
        `${packageName} still has workspace dependency ${dependencyName}@${version}`,
      );
    }
  }
}

function assertNoForbiddenEntries(entries, packageName) {
  const forbiddenPatterns = [
    /(^|\/)\.env(?:\.|$)/,
    /(^|\/)node_modules\//,
    /(^|\/)coverage\//,
    /^package\/apps\//,
    /^package\/dist\/packages\//,
    /(^|\/)__tests__\//,
    /(^|\/)tsconfig\.tsbuildinfo$/,
    /\.(?:test|spec)\.[cm]?[jt]sx?$/,
    /(^|\/)vitest(?:\.|$)/,
    /sensitive/i,
  ];

  for (const entry of entries) {
    const matched = forbiddenPatterns.find((pattern) => pattern.test(entry));
    assert(!matched, `${packageName} tarball includes forbidden entry: ${entry}`);
  }
}

function assertManifest(manifest, packageName) {
  assert(manifest.name === packageName, `${packageName} tarball manifest has name ${manifest.name}`);
  assert(manifest.private !== true, `${packageName} tarball manifest is private`);
  assert(manifest.main === './dist/index.js', `${packageName} main must be ./dist/index.js`);
  assert(manifest.types === './dist/index.d.ts', `${packageName} types must be ./dist/index.d.ts`);
  assert(JSON.stringify(manifest.exports).includes('./dist/'), `${packageName} exports must point to dist`);
  assert(!JSON.stringify(manifest.exports).includes('./src/'), `${packageName} exports still point to src`);
  assert(manifest.publishConfig?.access === 'public', `${packageName} publishConfig.access must be public`);
  assert(
    manifest.publishConfig?.registry === 'https://registry.npmjs.org/',
    `${packageName} publishConfig.registry must be npmjs`,
  );
  assertNoWorkspaceDependencies(manifest, packageName);
}

function assertPackageAssets(entries, packageName) {
  assert(hasEntry(entries, 'dist/index.js'), `${packageName} is missing dist/index.js`);
  assert(hasEntry(entries, 'dist/index.d.ts'), `${packageName} is missing dist/index.d.ts`);

  if (packageName === '@proofhound/db') {
    assert(
      hasEntryMatching(entries, /^package\/dist\/migrations\/0000_.+\.sql$/),
      '@proofhound/db is missing dist/migrations/0000_*.sql',
    );
  }

  if (packageName === '@proofhound/web-ui') {
    assert(
      hasEntry(entries, 'dist/styles/globals.css'),
      '@proofhound/web-ui is missing dist/styles/globals.css',
    );
  }

  if (packageName === '@proofhound/optimization-strategy') {
    assert(
      hasEntryMatching(entries, /^package\/dist\/error-pattern-analysis\/prompts\/.+\.md$/),
      '@proofhound/optimization-strategy is missing prompt markdown assets',
    );
  }
}

function packAndCheck(packageName) {
  const tempDir = mkdtempSync(join(tmpdir(), `${packageShortName(packageName)}-pack-`));
  const packDir = join(tempDir, 'pack');
  const extractDir = join(tempDir, 'extract');

  try {
    run('mkdir', ['-p', packDir, extractDir]);
    run('pnpm', ['--filter', packageName, 'pack', '--pack-destination', packDir], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const tarballs = readdirSync(packDir).filter((fileName) => fileName.endsWith('.tgz'));
    assert(tarballs.length === 1, `${packageName} produced ${tarballs.length} tarballs`);

    const tarballPath = join(packDir, tarballs[0]);
    const entries = listTarball(tarballPath);
    assertNoForbiddenEntries(entries, packageName);
    assertPackageAssets(entries, packageName);

    extractTarball(tarballPath, extractDir);
    const manifest = JSON.parse(readFileSync(join(extractDir, 'package/package.json'), 'utf8'));
    assertManifest(manifest, packageName);

    process.stdout.write(`ok ${packageName}\n`);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

for (const packageName of publishablePackages) {
  packAndCheck(packageName);
}
