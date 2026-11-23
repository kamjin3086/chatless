import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { KnowledgeBase } from '@/lib/knowledgeService';
import { KnowledgeFilterBar } from '../KnowledgeFilterBar';
import { KnowledgeTabs } from '../KnowledgeTabs';
import { KnowledgeBaseItem } from '../KnowledgeBaseItem';
import { RAGQueryInterface } from '../RAGQueryInterface';

const settings = vi.hoisted(() => ({ locale: 'zh' as Locale }));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => unknown) =>
    select(settings),
}));

// Render Radix Select children inline so the static markup contains the item labels.
vi.mock('@/components/ui/select', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    Select: inline,
    SelectContent: inline,
    SelectTrigger: inline,
    SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) =>
      createElement('span', { 'data-value': value }, children),
    SelectValue: ({ placeholder }: { placeholder: string }) => placeholder,
  };
});

// Render the context menu items inline to exercise the localized menu labels.
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({
    children,
    menuItems,
  }: PropsWithChildren<{ menuItems: { id: string; text: string }[] }>) =>
    createElement(
      'div',
      {},
      children,
      ...menuItems.map((item) =>
        createElement('span', { key: item.id }, item.text),
      ),
    ),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/knowledgeService', () => ({
  KnowledgeService: {
    initDb: vi.fn(),
    getAllKnowledgeBases: vi.fn(() => Promise.resolve([])),
  },
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  settings.locale = 'zh';
});

it.each([
  [
    'zh',
    '全部',
    '本地',
    '最近更新',
    '名称',
    '文档数量',
    '搜索知识库...',
    '新建知识库',
  ],
  [
    'en',
    'All',
    'Local',
    'Recently updated',
    'Name',
    'Document count',
    'Search knowledge bases…',
    'New knowledge base',
  ],
] as const)(
  'localizes knowledge filter bar in %s',
  (locale, all, local, recent, name, docs, placeholder, create) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(
      createElement(KnowledgeFilterBar, {
        activeFilter: 'all',
        onFilterChange: vi.fn(),
        sortBy: 'recent',
        onSortChange: vi.fn(),
        onCreateKnowledgeBase: vi.fn(),
      }),
    );
    for (const label of [all, local, recent, name, docs]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain(`placeholder="${placeholder}"`);
    expect(html).toContain(`title="${create}"`);
  },
);

it.each([
  ['zh', '我的知识库', '共享知识库', '模板', '智能问答'],
  [
    'en',
    'My Knowledge Bases',
    'Shared knowledge bases',
    'Templates',
    'Ask a Question',
  ],
] as const)(
  'localizes knowledge tabs in %s',
  (locale, my, shared, templates, query) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(
      createElement(KnowledgeTabs, {
        activeTab: 'my',
        onTabChange: vi.fn(),
      }),
    );
    for (const label of [my, shared, templates, query]) {
      expect(html).toContain(`>${label}<`);
    }
  },
);

it.each([
  ['zh', '暂无描述', '重命名', '删除'],
  ['en', 'No description', 'Rename', 'Delete'],
] as const)(
  'localizes knowledge base item fallback and context menu in %s',
  (locale, noDescription, rename, deleteLabel) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(
      createElement(KnowledgeBaseItem, {
        kb: { id: 'kb-1', name: '项目资料' } as KnowledgeBase & {
          documentCount?: number;
        },
        isActive: false,
        onClick: vi.fn(),
      }),
    );
    expect(html).toContain(`>${noDescription}<`);
    expect(html).toContain(`>${rename}<`);
    expect(html).toContain(`>${deleteLabel}<`);
  },
);

it.each([
  [
    'zh',
    '使用 Agent 问答',
    'Agent 会按需列出资料、检索原文并继续阅读长文档，回答中保留可核对引用。',
    '正在加载知识库…',
    '打开 Agent 对话',
  ],
  [
    'en',
    'Ask with Agent',
    'The Agent lists sources as needed, retrieves the original text, continues reading long documents, and keeps verifiable citations in the answer.',
    'Loading knowledge base…',
    'Open Agent chat',
  ],
] as const)(
  'localizes RAG query launcher in %s',
  (locale, title, description, placeholder, open) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(createElement(RAGQueryInterface));
    expect(html).toContain(`>${title}<`);
    expect(html).toContain(`>${description}<`);
    expect(html).toContain(`>${placeholder}<`);
    expect(html).toContain(`>${open}<`);
  },
);
