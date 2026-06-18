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
      // Keep navigation routed through the host resolveHref seam (SPEC 08 §4.3): screens
      // must use the in-package Link / useRouter wrappers, never next/link or
      // next/navigation's useRouter directly, so a hosting shell can scope every href.
      // The two wrapper modules are the single sanctioned consumers (inline eslint-disable).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/link',
              message:
                "Import { Link } from web-ui's components/navigation/link instead, so hrefs route through the host resolveHref seam.",
            },
            {
              name: 'next/navigation',
              importNames: ['useRouter'],
              message:
                "Import { useRouter } from web-ui's hooks/use-router instead, so push/replace/prefetch route through the host resolveHref seam.",
            },
          ],
        },
      ],
    },
  },
];
