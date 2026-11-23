import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { UpdateNotesPreview } from '../UpdateNotesPreview';

const preferences = vi.hoisted(() => ({ locale: 'zh' as Locale }));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof preferences) => Locale) =>
    select(preferences),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

function render(locale: Locale, body?: string): string {
  preferences.locale = locale;
  return renderToStaticMarkup(createElement(UpdateNotesPreview, { body }));
}

it('shows only the release notes for the app locale', () => {
  const body =
    '## Downloads\ninstaller instructions\n\n## zh-CN\n\n中文说明\n\n## en-US\n\nEnglish notes\n';
  expect(render('zh', body)).toMatch(/>中文说明<\/div>$/);
  expect(render('en', body)).toMatch(/>English notes<\/div>$/);
});

it('bounds the legacy preview and renders HTML and links as inert text', () => {
  const text = '<a href="https://example.com">installer</a>';
  const html = render('en', `${text}${'x'.repeat(600)}overflow marker`);
  expect(html).toContain('&lt;a href=');
  expect(html).not.toContain('<a ');
  expect(html).not.toContain('overflow marker');
  expect(html).toMatch(/…<\/div>$/);
  expect(html).toContain('line-clamp-4');
});

it.each([undefined, '', ' \r\n\t'])(
  'does not render a preview for an empty body (%s)',
  (body) => {
    expect(render('zh', body)).toBe('');
  },
);
