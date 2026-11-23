import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRecoveryView, getAppRecoveryLocale } from '../AppRecoveryView';

vi.mock('@/lib/storage', () => {
  throw new Error('Recovery must not depend on storage');
});
vi.mock('@/store/localeStore', () => {
  throw new Error('Recovery must not depend on the locale store');
});

describe('AppRecoveryView', () => {
  it.each([
    ['zh-CN', 'en-US', 'zh'],
    ['en-US', 'zh-CN', 'en'],
    ['', 'zh-Hant-TW', 'zh'],
    [undefined, 'en-GB', 'en'],
    [undefined, undefined, 'en'],
  ])(
    'uses document language %s before browser language %s',
    (documentLanguage, browserLanguage, expected) => {
      expect(getAppRecoveryLocale(documentLanguage, browserLanguage)).toBe(
        expected,
      );
    },
  );

  it('renders the English recovery fallback without a browser or storage', () => {
    const html = renderToStaticMarkup(createElement(AppRecoveryView));
    expect(html).toContain('lang="en-US"');
    expect(html).toContain('Chatless ran into an error');
    expect(html).toContain('Reload the interface.');
    expect(html).toContain('>Reload</button>');
    expect(html).not.toContain('>Close window</button>');
  });
});
