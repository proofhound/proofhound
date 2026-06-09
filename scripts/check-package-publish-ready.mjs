import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const requestedVersion = args[0];
const registry = args[1] ?? 'https://registry.npmjs.org/';

if (!requestedVersion) {
  throw new Error('Usage: node scripts/check-package-publish-ready.mjs <version> [registry]');
}

for (const packageName of publishablePackages) {
  const packageJsonPath = join('packages', packageShortName(packageName), 'package.json');
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  if (manifest.version !== requestedVersion) {
    throw new Error(`${packageName} is ${manifest.version}, not requested version ${requestedVersion}`);
  }

  const result = spawnSync('npm', ['view', `${packageName}@${requestedVersion}`, 'version', '--registry', registry], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    throw new Error(`${packageName}@${requestedVersion} is already published to ${registry}`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (!/E404|404 Not Found|is not in this registry/i.test(output)) {
    throw new Error(`Could not confirm ${packageName}@${requestedVersion} is unpublished:\n${output}`);
  }

  process.stdout.write(`unpublished ${packageName}@${requestedVersion}\n`);
}
