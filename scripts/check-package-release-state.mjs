import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const expectedVersion = args[0];

if (!expectedVersion) {
  throw new Error('Usage: node scripts/check-package-release-state.mjs <version>');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertVersion(label, actualVersion) {
  if (actualVersion !== expectedVersion) {
    throw new Error(`${label} is ${actualVersion}, not requested version ${expectedVersion}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

assertVersion('root package.json version', readJson('package.json').version);
assertVersion('release-please manifest root version', readJson('.release-please-manifest.json')['.']);

for (const packageName of publishablePackages) {
  const packageJsonPath = join('packages', packageShortName(packageName), 'package.json');
  assertVersion(`${packageName} version`, readJson(packageJsonPath).version);
}

if (!existsSync('CHANGELOG.md')) {
  throw new Error('CHANGELOG.md is missing; run release mode=prepare and merge its Release PR before publishing');
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const headingPattern = new RegExp(`^## \\[?${escapeRegExp(expectedVersion)}\\]?\\b`, 'm');

if (!headingPattern.test(changelog)) {
  throw new Error(`CHANGELOG.md does not contain a release heading for ${expectedVersion}`);
}

process.stdout.write(`release state ok ${expectedVersion}\n`);
