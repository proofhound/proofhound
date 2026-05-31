import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { Suspense, type ReactNode } from 'react';
// Server-safe language utils MUST come from the non-'use client' subpath: the i18n barrel
// (index.tsx) is 'use client', so importing resolveAcceptLanguageHeader from it and calling it
// in this server component throws "called from the server but … is on the client".
import { DEFAULT_LANGUAGE, resolveAcceptLanguageHeader, type Language } from '@proofhound/web-ui/i18n/language';
// The provider tree (which owns the class-instance contracts) lives behind a 'use client'
// boundary so this Server Component never passes a class instance across the RSC boundary.
import { Providers } from './providers';
import '@xyflow/react/dist/style.css';
import '@proofhound/web-ui/styles/globals.css';

export const metadata: Metadata = {
  title: 'ProofHound',
  description: '提示词全生命周期治理平台',
};

const preferenceInitScript = `
try {
  var theme = window.localStorage.getItem('proofhound.theme');
  var language = window.localStorage.getItem('proofhound.language');
  var browserLanguages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  var resolveBrowserLanguage = function (value) {
    if (!value) return null;
    var normalized = String(value).toLowerCase();
    if (normalized === 'zh' || normalized.indexOf('zh-') === 0) return 'zh-CN';
    if (normalized === 'en' || normalized.indexOf('en-') === 0) return 'en-US';
    return null;
  };
  var themeOptions = ['system', 'light', 'dark', 'twilight', 'electric'];
  var themePreference = themeOptions.indexOf(theme) >= 0 ? theme : 'system';
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var resolvedTheme = themePreference === 'system' ? (systemDark ? 'dark' : 'light') : themePreference;
  var resolvedLanguage = ['zh-CN', 'en-US'].indexOf(language) >= 0 ? language : null;
  for (var i = 0; !resolvedLanguage && i < browserLanguages.length; i += 1) {
    resolvedLanguage = resolveBrowserLanguage(browserLanguages[i]);
  }
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = themePreference;
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  document.documentElement.lang = resolvedLanguage || '${DEFAULT_LANGUAGE}';
} catch (_) {}
`;

async function getRequestLanguage(): Promise<Language> {
  const requestHeaders = await headers();
  return resolveAcceptLanguageHeader(requestHeaders.get('accept-language'));
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const defaultLanguage = await getRequestLanguage();

  return (
    <html lang={defaultLanguage} suppressHydrationWarning>
      <head>
        <Script
          id="proofhound-preferences"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: preferenceInitScript }}
        />
      </head>
      <body>
        <Suspense fallback={null}>
          <Providers defaultLanguage={defaultLanguage}>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
