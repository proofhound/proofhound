import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const tsFiles = ['**/*.{ts,tsx,mts,cts}'];

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/db/src/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      // Nest's emitDecoratorMetadata uses constructor parameter classes as runtime DI tokens.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  prettier,
];
