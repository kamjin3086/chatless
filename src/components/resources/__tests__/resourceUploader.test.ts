import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { ResourceUploader } from '../ResourceUploader';

const settings = vi.hoisted(() => ({ locale: 'zh' as Locale }));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => Locale) =>
    select(settings),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  settings.locale = 'zh';
});

it.each(['button', 'dropzone'] as const)(
  'keeps a mounted multi-file input for the %s picker',
  (displayType) => {
    const html = renderToStaticMarkup(
      createElement(ResourceUploader, {
        displayType,
        onUploadSuccess: vi.fn(),
      }),
    );
    expect(html.match(/<input\b[^>]*type="file"[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('multiple=""');
    expect(html).toContain('aria-label="选择上传文件"');
    expect(html).not.toContain('accept="*.*"');
  },
);

it('exposes the dropzone as a keyboard-operable upload button', () => {
  const html = renderToStaticMarkup(
    createElement(ResourceUploader, {
      displayType: 'dropzone',
      onUploadSuccess: vi.fn(),
    }),
  );
  expect(html).toMatch(
    /<button\b[^>]*>[\s\S]*拖放文件或点击上传[\s\S]*<\/button>/,
  );
});

it('localizes the English file input and dropzone button', () => {
  settings.locale = 'en';
  const html = renderToStaticMarkup(
    createElement(ResourceUploader, {
      displayType: 'dropzone',
      onUploadSuccess: vi.fn(),
    }),
  );
  expect(html).toContain('aria-label="Choose files to upload"');
  expect(html).toMatch(
    /<button\b[^>]*>[\s\S]*Drop files here or click to upload[\s\S]*<\/button>/,
  );
});
