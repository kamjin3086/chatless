import { describe, expect, test } from 'vitest';
import { translate } from '@/i18n';

describe('i18n', () => {
  test('中文与英文翻译键存在', () => {
    expect(translate('zh', 'nav.chat')).toBe('聊天');
    expect(translate('en', 'nav.chat')).toBe('Chat');
  });

  test('未知键回退到中文或原键', () => {
    // @ts-expect-error testing fallback
    expect(translate('en', 'missing.key')).toBe('missing.key');
  });
});
