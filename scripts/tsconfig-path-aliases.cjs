const fs = require('node:fs');
const path = require('node:path');

function createTsconfigPathAliases(tsconfigPath = path.resolve(__dirname, '../tsconfig.base.json')) {
  const tsconfigDir = path.dirname(tsconfigPath);
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  const paths = tsconfig.compilerOptions?.paths ?? {};
  const aliases = {};

  for (const [key, targets] of Object.entries(paths)) {
    const target = targets?.[0];
    if (!target) continue;

    if (key.endsWith('/*') && target.endsWith('/*')) {
      aliases[key.slice(0, -2)] = path.resolve(tsconfigDir, target.slice(0, -2));
      continue;
    }

    aliases[`${key}$`] = path.resolve(tsconfigDir, target);
  }

  return aliases;
}

module.exports = { createTsconfigPathAliases };
