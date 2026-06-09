const fs = require('node:fs');
const { builtinModules } = require('node:module');
const path = require('node:path');
const { createTsconfigPathAliases } = require('../../scripts/tsconfig-path-aliases.cjs');

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

// loader.ts under packages/optimization-strategy/src/error-pattern-analysis/prompts/ uses
// readFileSync(__dirname + '/*.md') to load prompt templates; after webpack bundles, __dirname
// resolves to apps/server/dist/, so .md files must be flat-copied there.
const OPTIMIZATION_PROMPT_DIR = path.resolve(
  __dirname,
  '../../packages/optimization-strategy/src/error-pattern-analysis/prompts',
);

class CopyOptimizationPromptsPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync('CopyOptimizationPromptsPlugin', (compilation, callback) => {
      const distDir = compiler.options.output.path;
      try {
        for (const file of fs.readdirSync(OPTIMIZATION_PROMPT_DIR)) {
          if (!file.endsWith('.md')) continue;
          fs.copyFileSync(path.join(OPTIMIZATION_PROMPT_DIR, file), path.join(distDir, file));
        }
        callback();
      } catch (err) {
        callback(err);
      }
    });
  }
}

module.exports = (options) => ({
  ...options,
  resolve: {
    ...options.resolve,
    alias: {
      ...(options.resolve?.alias ?? {}),
      ...createTsconfigPathAliases(),
    },
  },
  externals: [
    ({ request }, callback) => {
      if (!request || request.startsWith('.') || path.isAbsolute(request)) {
        callback();
        return;
      }

      if (request.startsWith('@proofhound/')) {
        callback();
        return;
      }

      callback(null, builtins.has(request) ? `node-commonjs ${request}` : `commonjs ${request}`);
    },
  ],
  plugins: [...(options.plugins ?? []), new CopyOptimizationPromptsPlugin()],
  watchOptions: {
    ...options.watchOptions,
    ignored: ['**/.git/**', '**/.next/**', '**/.turbo/**', '**/coverage/**', '**/dist/**', '**/node_modules/**'],
  },
});
