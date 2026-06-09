import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(packageRoot, 'src/migrations');
const targetDir = join(packageRoot, 'dist/migrations');

rmSync(targetDir, { force: true, recursive: true });
mkdirSync(targetDir, { recursive: true });

for (const fileName of readdirSync(sourceDir)) {
  if (!fileName.endsWith('.sql')) continue;
  copyFileSync(join(sourceDir, fileName), join(targetDir, fileName));
}
