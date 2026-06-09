import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const version = args[0];

if (!version) {
  throw new Error('Usage: node scripts/set-package-versions.mjs <version>');
}

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid semver version: ${version}`);
}

for (const packageName of publishablePackages) {
  const packageJsonPath = join('packages', packageShortName(packageName), 'package.json');
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const oldVersion = manifest.version;
  manifest.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${packageName}: ${oldVersion} -> ${version}\n`);
}
