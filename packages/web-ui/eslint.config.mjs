import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

import baseConfig from '../../eslint.config.mjs';

// @proofhound/web-ui is a React/Next-coupled product-UI library (screens / hooks / providers /
// components / i18n). It needs the same React + react-hooks lint rules as apps/web so that
// rules like `react-hooks/set-state-in-effect` are defined (the moved files carry intentional
// scoped disables for it) and the React code is genuinely linted.
export default [
  ...baseConfig,
  ...nextVitals,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      // web-ui is a library, not a Next app: the page-routing rules don't apply and the
      // missing `pages/` dir otherwise prints a spurious console warning.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];
