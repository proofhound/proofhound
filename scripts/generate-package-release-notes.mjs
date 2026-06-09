import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageShortName, publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const version = args[0] ?? readUnifiedPackageVersion();
const distTag = args[1] ?? 'latest';
const outputPath = args[2];

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

const notes = [
  `# ProofHound OSS v${version}`,
  '',
  `npm dist-tag: \`${distTag}\``,
  '',
  'Published npm packages:',
  '',
  ...publishablePackages.map((packageName) => `- \`${packageName}@${version}\``),
  '',
  'SaaS consumers should pin these exact `@proofhound/*` versions. Only npm versions with a matching GitHub Release are considered consumable.',
  '',
].join('\n');

if (outputPath) {
  writeFileSync(outputPath, notes);
} else {
  process.stdout.write(notes);
}
