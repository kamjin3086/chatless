import type { Locale, TranslationKey } from './types';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  zh: zhCN,
  en: enUS,
};

export function translate(locale: Locale, key: TranslationKey): string {
  return dictionaries[locale]?.[key] ?? dictionaries.zh[key] ?? key;
}

export function getHtmlLang(locale: Locale): string {
  return locale === 'en' ? 'en-US' : 'zh-CN';
}

export { dictionaries };
