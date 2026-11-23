'use client';

import { create } from 'zustand';
import { getHtmlLang, translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import StorageUtil from '@/lib/storage';

const LANG_KEY = 'app_lang';
const DEFAULT_LOCALE: Locale = 'zh';
let pendingLocaleWrite: Promise<unknown> = Promise.resolve();

interface LocaleState {
  locale: Locale;
  initialized: boolean;
  setLocale: (locale: Locale) => void;
  /** Live translation for non-React callers. Components should use useTranslation. */
  t: (key: TranslationKey) => string;
}

export const useLocaleStore = create<LocaleState>((_set, get) => ({
  locale: DEFAULT_LOCALE,
  initialized: false,
  setLocale: (locale) => {
    // Save selections in order without waiting to update the UI.
    pendingLocaleWrite = pendingLocaleWrite.then(() =>
      StorageUtil.setItem(LANG_KEY, locale),
    );
    applyLocale(locale);
  },
  t: (key) => translate(get().locale, key),
}));

function applyLocale(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getHtmlLang(locale);
  }
  useLocaleStore.setState({ locale, initialized: true });
}

void (async () => {
  const saved = await StorageUtil.getItem<string>(LANG_KEY, DEFAULT_LOCALE);
  // An explicit selection, even of the default locale, beats a late startup read.
  if (useLocaleStore.getState().initialized) return;
  applyLocale(saved === 'en' ? 'en' : DEFAULT_LOCALE);
})();
