import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LANGUAGE,
  resolveAcceptLanguageHeader,
  resolveBrowserLanguage,
  resolveSupportedBrowserLanguage,
} from './language';

describe('i18n browser language resolution', () => {
  it('maps supported Chinese browser locales to zh-CN', () => {
    expect(resolveSupportedBrowserLanguage('zh')).toBe('zh-CN');
    expect(resolveSupportedBrowserLanguage('zh-CN')).toBe('zh-CN');
    expect(resolveSupportedBrowserLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(resolveSupportedBrowserLanguage('zh-TW')).toBe('zh-CN');
  });

  it('maps supported English browser locales to en-US', () => {
    expect(resolveSupportedBrowserLanguage('en')).toBe('en-US');
    expect(resolveSupportedBrowserLanguage('en-US')).toBe('en-US');
    expect(resolveSupportedBrowserLanguage('en-GB')).toBe('en-US');
  });

  it('uses the first supported browser language and falls back to the default language', () => {
    expect(resolveBrowserLanguage(['fr-FR', 'en-GB', 'zh-CN'])).toBe('en-US');
    expect(resolveBrowserLanguage(['ja-JP', null, undefined])).toBe(DEFAULT_LANGUAGE);
  });

  it('respects Accept-Language quality values for server-side defaults', () => {
    expect(resolveAcceptLanguageHeader('zh-CN;q=0.7,en-US;q=0.9')).toBe('en-US');
    expect(resolveAcceptLanguageHeader('ja-JP,fr-FR;q=0.8')).toBe(DEFAULT_LANGUAGE);
  });
});
