import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CreateKnowledgeDialog } from '@/components/knowledge/CreateKnowledgeDialog';
import { EditKnowledgeDialog } from '@/components/knowledge/EditKnowledgeDialog';
import { KnowledgeBaseCard } from '@/components/knowledge/KnowledgeBaseCard';
import { KnowledgeBaseDetailDialog } from '@/components/knowledge/KnowledgeBaseDetailDialog';
import { formatKnowledgeDocumentCount } from '@/components/knowledge/formatKnowledgeDocumentCount';
import { createKnowledgeMenuItems } from '@/components/knowledge/knowledgeMenu';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import type { KnowledgeBase } from '@/lib/knowledgeService';
import KnowledgePage from '../page';

const testLocale = vi.hoisted(() => ({
  value: 'zh' as Locale,
  select: vi.fn(),
}));

vi.mock('@/store/localeStore', () => {
  // Match the real store's stable translator identity to distinguish subscribing
  // to the active locale from merely reading the translator during render.
  const t = (key: TranslationKey) => translate(testLocale.value, key);
  return {
    useLocaleStore: (
      select: (state: { locale: Locale; t: typeof t }) => unknown,
    ) => {
      const value = select({ locale: testLocale.value, t });
      testLocale.select(value);
      return value;
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=knowledge'),
}));
vi.mock('@/components/resources/ResourceManager', () => ({
  ResourceManager: () => null,
}));
vi.mock('@/components/knowledge/RAGQueryInterface', () => ({
  RAGQueryInterface: () => null,
}));
vi.mock('@/lib/knowledgeService', () => ({ KnowledgeService: {} }));
vi.mock('@/lib/unifiedFileService', () => ({ UnifiedFileService: {} }));
vi.mock('@/lib/sampleDataInitializer', () => ({
  initializeSampleDataIfNeeded: vi.fn(),
}));

// Keep the dialog markup on the server so its localized content and close label
// can be inspected without a browser or a new test dependency.
vi.mock('@radix-ui/react-dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@radix-ui/react-dialog')>()),
  Portal: ({ children }: PropsWithChildren) => children,
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => testLocale.select.mockClear());

const kb: KnowledgeBase = {
  id: 'abcdef123456',
  name: '产品手册',
  description: '',
  icon: 'database',
  isEncrypted: false,
  createdAt: Date.UTC(2024, 0, 2, 12, 34),
  updatedAt: Date.UTC(2025, 7, 23, 12, 34),
};
const dialogProps = { open: true, onOpenChange: vi.fn() };

const localeCases = [
  {
    locale: 'en',
    language: 'en-US',
    navigation: [
      'Resources',
      'Knowledge Bases',
      'My Knowledge Bases',
      'Ask a Question',
      'Recently updated',
      'Name',
      'Document count',
      'New',
    ],
    create: [
      'Create knowledge base',
      'Knowledge base name',
      'Knowledge base description',
      '(optional)',
      'e.g. Technical docs or product manuals',
      'Briefly describe its purpose and contents',
      'Cancel',
      'Create',
      'Close',
    ],
    edit: [
      'Edit knowledge base',
      'Knowledge base name',
      'Knowledge base description',
      'Cancel',
      'Save',
      'Close',
    ],
    noDescription: 'No description',
    oneDocument: '1 document',
    updatedOn: 'Updated on ',
    summary: ['Created', 'Manage documents', 'Rename', 'Delete', 'Close'],
    menu: ['Rename', 'Edit description', '', 'Delete'],
  },
  {
    locale: 'zh',
    language: 'zh-CN',
    navigation: [
      '资源',
      '知识库',
      '我的知识库',
      '智能问答',
      '最近更新',
      '名称',
      '文档数量',
      '新建',
    ],
    create: [
      '创建知识库',
      '知识库名称',
      '知识库描述',
      '（可选）',
      '例如：技术文档、产品手册…',
      '简要说明知识库的用途和内容…',
      '取消',
      '创建',
      '关闭',
    ],
    edit: ['编辑知识库', '知识库名称', '知识库描述', '取消', '保存', '关闭'],
    noDescription: '暂无描述',
    oneDocument: '1 个文档',
    updatedOn: '更新于 ',
    summary: ['创建时间', '管理文档', '重命名', '删除', '关闭'],
    menu: ['重命名', '修改描述', '', '删除'],
  },
] as const;

for (const strings of localeCases) {
  describe(`knowledge library in ${strings.language}`, () => {
    beforeEach(() => {
      testLocale.value = strings.locale;
    });

    it('subscribes to the active locale and translates tabs and sort options', () => {
      const html = renderToStaticMarkup(createElement(KnowledgePage));
      for (const text of strings.navigation)
        expect(html).toContain(`>${text}<`);
      expect(testLocale.select).toHaveBeenCalledWith(strings.locale);
      expect(
        testLocale.select.mock.calls.every(
          ([selection]) => selection === strings.locale,
        ),
      ).toBe(true);
    });

    it('localizes the card and its date, keeping the stored name intact', () => {
      const html = renderToStaticMarkup(
        createElement(KnowledgeBaseCard, { kb: { ...kb, documentCount: 1 } }),
      );
      expect(html).toContain(kb.name);
      expect(html).toContain(strings.noDescription);
      expect(html).toContain(`${strings.oneDocument}</span>`);
      expect(html).toContain(
        new Date(kb.updatedAt).toLocaleDateString(strings.language),
      );
      expect(testLocale.select).toHaveBeenCalledWith(strings.locale);
    });

    it('localizes the preview with a short update date and full creation timestamp', () => {
      const html = renderToStaticMarkup(
        createElement(KnowledgeBaseDetailDialog, {
          ...dialogProps,
          kb: { ...kb, documentCount: 1 },
        }),
      );
      for (const text of [
        ...strings.summary,
        kb.name,
        strings.noDescription,
        strings.oneDocument,
      ]) {
        expect(html).toContain(`>${text}<`);
      }
      expect(html).toContain(
        `${strings.updatedOn}${new Date(kb.updatedAt).toLocaleDateString(strings.language)}`,
      );
      expect(html).toContain(
        new Date(kb.createdAt).toLocaleString(strings.language),
      );
      expect(testLocale.select).toHaveBeenCalledWith(strings.locale);
    });

    it('localizes create and edit dialog labels, placeholders, actions and close controls', () => {
      const create = renderToStaticMarkup(
        createElement(CreateKnowledgeDialog, {
          ...dialogProps,
          onCreate: vi.fn(),
        }),
      );
      const edit = renderToStaticMarkup(
        createElement(EditKnowledgeDialog, {
          ...dialogProps,
          kb,
          onSave: vi.fn(),
        }),
      );
      for (const text of strings.create) expect(create).toContain(text);
      for (const text of strings.edit) expect(edit).toContain(text);
      expect(testLocale.select.mock.calls).toEqual([
        [strings.locale],
        [strings.locale],
      ]);
    });

    it('translates the shared context menu while preserving its actions', () => {
      const onRename = vi.fn();
      const onDelete = vi.fn();
      const menu = createKnowledgeMenuItems(kb, strings.locale, {
        onRename,
        onDelete,
      });
      expect(menu.map((item) => item.text)).toEqual(strings.menu);
      menu.find((item) => item.id === 'editDesc')?.action?.();
      menu.find((item) => item.id === 'delete')?.action?.();
      expect(onRename).toHaveBeenCalledWith(kb);
      expect(onDelete).toHaveBeenCalledWith(kb);
    });
  });
}

it('formats document counts for zero and grouped plurals', () => {
  expect(formatKnowledgeDocumentCount('en', 0)).toBe('0 documents');
  expect(formatKnowledgeDocumentCount('en', 1234)).toBe('1,234 documents');
  expect(formatKnowledgeDocumentCount('zh', 0)).toBe('0 个文档');
  expect(formatKnowledgeDocumentCount('zh', 1234)).toBe('1,234 个文档');
});
