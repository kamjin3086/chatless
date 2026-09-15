"use client";

import { create } from 'zustand';
import StorageUtil from '@/lib/storage';
import type { Locale, TranslationKey } from '@/i18n/types';
import { translate, getHtmlLang } from '@/i18n';

const LANG_KEY = 'app_lang';

interface LocaleState {
  locale: Locale;
  initialized: boolean;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: 'zh',
  initialized: false,
  setLocale: (locale) => {
    set({ locale });
    void StorageUtil.setItem(LANG_KEY, locale);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = getHtmlLang(locale);
    }
  },
  t: (key) => translate(get().locale, key),
}));

(async () => {
  const saved = await StorageUtil.getItem<string>(LANG_KEY, 'zh');
  const locale: Locale = saved === 'en' ? 'en' : 'zh';
  useLocaleStore.setState({ locale, initialized: true });
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getHtmlLang(locale);
  }
})();
