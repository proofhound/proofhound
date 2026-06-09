import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const packageDir = resolve(args[0] ?? '.npm-packages');
const distTag = args[1] ?? 'latest';

for (const packageName of publishablePackages) {
  const shortName = packageShortName(packageName);
  const tarball = readdirSync(packageDir).find(
    (fileName) => fileName.startsWith(`proofhound-${shortName}-`) && fileName.endsWith('.tgz'),
  );

  if (!tarball) {
    throw new Error(`Missing packed tarball for ${packageName}`);
  }

  execFileSync('npm', ['publish', join(packageDir, tarball), '--access', 'public', '--tag', distTag], {
    stdio: 'inherit',
  });
}
