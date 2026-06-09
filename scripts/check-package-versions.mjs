import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const versions = new Map();

for (const packageName of publishablePackages) {
  const packageJsonPath = join('packages', packageShortName(packageName), 'package.json');
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  versions.set(packageName, manifest.version);
}

const uniqueVersions = new Set(versions.values());
if (uniqueVersions.size !== 1) {
  for (const [packageName, version] of versions) {
    process.stderr.write(`${packageName}: ${version}\n`);
  }
  throw new Error('Publishable @proofhound/* packages must share one version');
}

const version = [...uniqueVersions][0];
const expectedVersion = args[0];

if (expectedVersion && expectedVersion !== version) {
  throw new Error(`Publishable @proofhound/* packages are ${version}, not requested version ${expectedVersion}`);
}

process.stdout.write(`${version}\n`);
