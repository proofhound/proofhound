import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function copyDirectory(sourceDir, targetDir) {
  rmSync(targetDir, { force: true, recursive: true });
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    if (statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    copyFileSync(sourcePath, targetPath);
  }
}

copyDirectory(join(packageRoot, 'src/styles'), join(packageRoot, 'dist/styles'));
