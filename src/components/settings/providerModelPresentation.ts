import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';

type Translate = (key: TranslationKey) => string;

export function translateProviderModelNotification(key: TranslationKey) {
  return translate(useLocaleStore.getState().locale, key);
}

export function formatProviderModelCount(t: Translate, count: number) {
  return t(
    count === 1 ? 'provider.list.oneModel' : 'provider.list.modelCount',
  ).replace('{0}', String(count));
}

export function formatProviderModelStrategyUpdate(
  t: Translate,
  updated: number,
  skipped = 0,
) {
  const count = formatProviderModelCount(t, updated);
  if (skipped > 0) {
    return t('provider.models.strategyUpdatedWithSkipped')
      .replace('{0}', count)
      .replace('{1}', formatProviderModelCount(t, skipped));
  }
  return t('provider.models.strategyUpdated').replace('{0}', count);
}
