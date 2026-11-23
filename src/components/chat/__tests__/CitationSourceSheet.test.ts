import React, { createElement, type PropsWithChildren, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { Citation } from '@/lib/rag/evidenceTypes';
import { CitationSourceSheet } from '../CitationSourceSheet';

const localeState = vi.hoisted(() => ({ locale: 'zh' as Locale }));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => Locale) =>
    select(localeState),
}));
vi.mock('@radix-ui/react-dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@radix-ui/react-dialog')>()),
  Portal: ({ children }: PropsWithChildren) => children,
}));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.stubGlobal('React', React);

const citation: Citation = {
  id: 'citation-1',
  n: 1,
  evidenceId: 'E1',
  documentId: 'doc',
  documentName: '实验记录 $&',
  locator: {},
  quote: '原始引用\nOriginal quote $&',
};

function render() {
  return renderToStaticMarkup(
    createElement(CitationSourceSheet, {
      citation,
      conversationId: 'chat',
      open: true,
      onOpenChange: vi.fn(),
    }),
  );
}

it.each([
  {
    locale: 'en',
    snapshot: 'Citation snapshot',
    source: 'Source text',
    close: 'Close',
    exact: 'Cited passage',
    empty: 'There is no readable text at this location.',
    actions: [
      'Cited location',
      'Nearby text',
      'Next passage',
      'Current version',
      'Open current file',
    ],
  },
  {
    locale: 'zh',
    snapshot: '引用时快照',
    source: '当前原文',
    close: '关闭',
    exact: '引用对应原文',
    empty: '此位置没有可读取的文本。',
    actions: ['引用位置', '相邻段落', '下一段', '当前版本', '打开当前文件'],
  },
] as const)(
  'localizes citation sheet controls and accessible names in $locale',
  ({ locale, snapshot, source, close, exact, empty, actions }) => {
    localeState.locale = locale;
    const html = render();
    expect(html).toContain(`aria-label="${snapshot}"`);
    expect(html).toContain(
      `data-citation-source-text="true" aria-label="${source}"`,
    );
    expect(html).toContain(`class="sr-only">${close}</span>`);
    for (const text of [snapshot, exact, empty, ...actions])
      expect(html).toContain(`>${text}<`);
    expect(html).toContain('>实验记录 $&amp;<');
    expect(html).toContain('>原始引用\nOriginal quote $&amp;</blockquote>');
  },
);

it('localizes the current-version heading and live feedback without translating the source text', () => {
  localeState.locale = 'en';
  // Seed the read state for static rendering; Radix portals and effects do not run on the server.
  for (const value of [
    '目前版本的原文 $&',
    'next-cursor',
    true,
    undefined,
    true,
  ]) {
    vi.mocked(useState).mockReturnValueOnce([value, vi.fn()]);
  }
  const html = render();
  expect(html).toContain('>Current version (from the start of the document)<');
  expect(html).toContain('aria-busy="true"');
  expect(html).toMatch(/role="status"[^>]*>Reading source…</);
  expect(html).toContain('>目前版本的原文 $&amp;<');
});

it('translates an existing read error in the currently selected locale', () => {
  for (const [locale, message] of [
    [
      'en',
      'This document is not indexed yet. Try again after indexing finishes.',
    ],
    ['zh', '当前文档尚未完成索引，请完成索引后重试。'],
  ] as const) {
    localeState.locale = locale;
    for (const value of [
      '',
      undefined,
      false,
      'citationSource.indexNotReady',
      false,
    ]) {
      vi.mocked(useState).mockReturnValueOnce([value, vi.fn()]);
    }
    expect(render()).toMatch(new RegExp(`role="alert"[^>]*>${message}<`));
  }
});
