import { describe, expect, test } from 'vitest';
import { dictionaries, translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';

function interpolationPlaceholders(message: string): string[] {
  // Double braces are literal prompt-variable examples, not UI interpolation.
  return (message.match(/(?<!\{)\{(?:\d+|[A-Za-z_]\w*)\}(?!\})/g) ?? []).sort();
}

describe('i18n', () => {
  test('中文与英文翻译键存在', () => {
    expect(translate('zh', 'nav.chat')).toBe('聊天');
    expect(translate('en', 'nav.chat')).toBe('Chat');
  });

  test('未知键回退到中文或原键', () => {
    // @ts-expect-error testing fallback
    expect(translate('en', 'missing.key')).toBe('missing.key');
  });

  test('Chinese and English catalogs have the same keys', () => {
    const { en, zh } = dictionaries;

    expect({
      missingFromEn: Object.keys(zh).filter((key) => !Object.hasOwn(en, key)),
      missingFromZh: Object.keys(en).filter((key) => !Object.hasOwn(zh, key)),
    }).toEqual({ missingFromEn: [], missingFromZh: [] });
  });

  test('Chinese and English messages preserve interpolation placeholders', () => {
    const { en, zh } = dictionaries;

    for (const key of Object.keys(zh) as TranslationKey[]) {
      if (!Object.hasOwn(en, key)) continue;
      expect
        .soft(interpolationPlaceholders(en[key]), key)
        .toEqual(interpolationPlaceholders(zh[key]));
    }
  });
});
