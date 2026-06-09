import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { publishablePackages } from './package-publish-list.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const destination = resolve(args[0] ?? '.npm-packages');

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });

for (const packageName of publishablePackages) {
  execFileSync('pnpm', ['--filter', packageName, 'pack', '--pack-destination', destination], {
    stdio: 'inherit',
  });
}

process.stdout.write(`Packed ${publishablePackages.length} packages into ${destination}\n`);
