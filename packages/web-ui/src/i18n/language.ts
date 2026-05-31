export const LANGUAGE_STORAGE_KEY = 'proofhound.language';

export const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '中文', shortLabel: '中' },
  { value: 'en-US', label: 'English', shortLabel: 'EN' },
] as const;

export type Language = (typeof LANGUAGE_OPTIONS)[number]['value'];

export const DEFAULT_LANGUAGE: Language = 'zh-CN';

export function isLanguage(value: string | null): value is Language {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function resolveSupportedBrowserLanguage(value: string | null | undefined): Language | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US';
  return null;
}

export function resolveBrowserLanguage(languages: readonly (string | null | undefined)[]): Language {
  for (const language of languages) {
    const resolvedLanguage = resolveSupportedBrowserLanguage(language);
    if (resolvedLanguage) return resolvedLanguage;
  }
  return DEFAULT_LANGUAGE;
}

export function resolveAcceptLanguageHeader(value: string | null | undefined): Language {
  const languages = (value ?? '')
    .split(',')
    .map((entry, index) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const qParam = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const parsedQ = qParam ? Number(qParam.slice(2)) : 1;
      const q = Number.isFinite(parsedQ) ? parsedQ : 1;
      return { index, q, tag: tag.trim() };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((left, right) => right.q - left.q || left.index - right.index)
    .map((entry) => entry.tag);

  return resolveBrowserLanguage(languages);
}
