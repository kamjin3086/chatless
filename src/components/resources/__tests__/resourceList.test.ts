import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { ResourceList } from '../ResourceList';
import type { ResourceDocument, ResourceListType } from '../types';

const settings = vi.hoisted(() => ({ locale: 'en' as Locale }));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => Locale) => select(settings),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { settings.locale = 'en'; });

const createdAt = '2024-04-18T12:00:00.000Z';
const document: ResourceDocument = {
  id: 'upload',
  title: '报告$&.pdf',
  filePath: '/uploads/报告$&.pdf',
  fileType: 'pdf',
  fileSize: 100,
  createdAt,
  updatedAt: createdAt,
  isIndexed: true,
};
const chatFile: ResourceDocument = { ...document, id: 'chat', title: 'chat.pdf', source: 'chat', isIndexed: false };

function render(type: ResourceListType, resources: ResourceDocument[] = [], loading = false) {
  return renderToStaticMarkup(createElement(ResourceList, { type, resources, loading }));
}

describe('ResourceList locale and filtering', () => {
  it.each([
    ['documents', 'No documents', '暂无文档'],
    ['files', 'No files', '暂无文件'],
    ['chat', 'No chat attachments', '暂无聊天附件'],
    ['knowledge', 'No indexed resources', '知识库中暂无资源'],
  ] as const)('localizes the %s empty state', (type, english, chinese) => {
    expect(render(type)).toContain(english);
    settings.locale = 'zh';
    expect(render(type)).toContain(chinese);
  });

  it('uses the list loading text instead of an empty or loaded state', () => {
    expect(render('documents', [document], true)).toContain('Loading resources…');
    settings.locale = 'zh';
    expect(render('documents', [document], true)).toContain('加载资源中...');
  });

  it('uses the app locale for dates without rewriting filenames or filter results', () => {
    for (const [locale, language] of [['en', 'en-US'], ['zh', 'zh-CN']] as const) {
      settings.locale = locale;
      const html = render('documents', [document, chatFile]);
      expect(html).toContain('报告$&amp;.pdf');
      expect(html).toContain(new Date(createdAt).toLocaleDateString(language));
      expect(html).not.toContain('chat.pdf');
      expect(render('chat', [document, chatFile])).toContain('chat.pdf');
      expect(render('knowledge', [document, chatFile])).not.toContain('chat.pdf');
    }
  });
});
