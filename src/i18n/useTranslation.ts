'use client';

import { useCallback } from 'react';
import { useLocaleStore } from '@/store/localeStore';
import { translate } from './index';
import type { TranslationKey } from './types';

export function useTranslation() {
  const locale = useLocaleStore((state) => state.locale);
  return useCallback((key: TranslationKey) => translate(locale, key), [locale]);
}
