import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { UserMessageBlock } from '../UserMessageBlock';

const settings = vi.hoisted(() => ({ locale: 'zh' as Locale }));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => unknown) =>
    select(settings),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

function render(content: string) {
  return renderToStaticMarkup(
    createElement(UserMessageBlock, {
      id: 'saved-message',
      content,
      documentReference: {
        fileName: '原始资料.md',
        fileType: 'md',
        fileSize: 1024,
        summary: '保存的摘要',
      },
      contextData: '保存的文档内容',
      knowledgeBaseReference: { id: 'kb-1', name: '项目资料' },
      images: ['data:image/png;base64,iVBORw=='],
    }),
  );
}

describe('UserMessageBlock attachment locale', () => {
  it.each([
    [
      'en',
      'Referenced knowledge base',
      'View full text',
      'Attached image',
      'Please answer using the attached document and knowledge base.',
    ],
    [
      'zh',
      '引用知识库',
      '查看完整内容',
      '附加的图片',
      '请基于上述文档和知识库为我解答问题',
    ],
  ] as const)(
    'localizes only first-party attachment text in %s',
    (locale, reference, expand, imageAlt, placeholder) => {
      settings.locale = locale;
      const savedContent = '保存的消息';
      const html = render(savedContent);
      for (const raw of [
        savedContent,
        '原始资料.md',
        '保存的摘要',
        '项目资料',
        'data:image/png;base64,iVBORw==',
      ]) {
        expect(html).toContain(raw);
      }
      expect(html).toContain(reference);
      expect(html).toContain(expand);
      expect(html).toContain(`alt="${imageAlt}"`);
      expect(html).not.toContain(placeholder);
      expect(render('')).toContain(placeholder);
    },
  );
});
