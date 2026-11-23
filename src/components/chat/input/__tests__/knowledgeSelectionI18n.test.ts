import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { KnowledgeBase } from '@/lib/knowledgeService';
import { KnowledgeBaseSelector } from '../KnowledgeBaseSelector';
import { SelectedKnowledgeBaseView } from '../SelectedKnowledgeBaseView';
import { AttachedDocumentView } from '../AttachedDocumentView';

const settings = vi.hoisted(() => ({ locale: 'zh' as Locale }));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => unknown) =>
    select(settings),
}));

// Render the action panel children inline to exercise the actual selector copy in Node.
vi.mock('@/components/ui/action-panel', () => {
  const childrenOnly = ({ children }: { children: ReactNode }) => children;
  const header = ({ title, subtitle }: { title: string; subtitle?: string }) =>
    createElement(
      'div',
      {},
      createElement('span', {}, title),
      createElement('span', {}, subtitle),
    );
  const search = ({ placeholder }: { placeholder?: string }) =>
    createElement('input', { placeholder });
  const empty = ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) =>
    createElement(
      'div',
      {},
      createElement('span', {}, title),
      createElement('span', {}, description),
    );
  return {
    ActionPanel: childrenOnly,
    ActionPanelTrigger: childrenOnly,
    ActionPanelContent: childrenOnly,
    ActionPanelHeader: header,
    ActionPanelSearch: search,
    ActionPanelList: childrenOnly,
    ActionPanelItem: () => null,
    ActionPanelEmpty: empty,
  };
});

vi.mock('@/lib/knowledgeService', () => ({
  KnowledgeService: {
    getAllKnowledgeBases: vi.fn(() => Promise.resolve([])),
    initDb: vi.fn(),
    createKnowledgeBase: vi.fn(),
    addDocumentToKnowledgeBase: vi.fn(),
  },
}));
vi.mock('@/lib/knowledgeBaseConfig', () => ({
  getCurrentKnowledgeBaseConfig: () => ({
    documentProcessing: { bigFileSizeMb: 1, bigTokenThreshold: 100000 },
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  settings.locale = 'zh';
});

it.each([
  [
    'zh',
    '选择知识库',
    'AI 将基于所选知识库内容回答',
    '搜索知识库...',
    '没有找到匹配的知识库',
    '暂无可用的知识库',
  ],
  [
    'en',
    'Select a knowledge base',
    'AI will answer based on the selected knowledge base',
    'Search knowledge bases…',
    'No matching knowledge bases',
    'No available knowledge bases',
  ],
] as const)(
  'localizes the knowledge base selector in %s',
  (locale, choose, subtitle, placeholder, emptyTitle, emptyDescription) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(
      createElement(KnowledgeBaseSelector, {
        onSelect: vi.fn(),
        selectedKnowledgeBase: null,
      }),
    );
    expect(html).toContain(`title="${choose}"`);
    expect(html).toContain(`>${choose}<`);
    expect(html).toContain(`>${subtitle}<`);
    expect(html).toContain(`placeholder="${placeholder}"`);
    expect(html).toContain(`>${emptyTitle}<`);
    expect(html).toContain(`>${emptyDescription}<`);
  },
);

it.each([
  ['zh', '更换知识库'],
  ['en', 'Change knowledge base'],
] as const)(
  'localizes the switch trigger when a knowledge base is selected in %s',
  (locale, change) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(
      createElement(KnowledgeBaseSelector, {
        onSelect: vi.fn(),
        selectedKnowledgeBase: {
          id: 'kb-1',
          name: '项目资料',
        } as KnowledgeBase,
      }),
    );
    expect(html).toContain(`title="${change}"`);
  },
);

it.each([
  ['zh', '管理知识库', '移除'],
  ['en', 'Manage knowledge base', 'Remove'],
] as const)(
  'localizes the selected knowledge base actions in %s',
  (locale, manage, remove) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(
      createElement(SelectedKnowledgeBaseView, {
        knowledgeBase: { id: 'kb-1', name: '项目资料' } as KnowledgeBase,
        onRemove: vi.fn(),
      }),
    );
    expect(html).toContain(`title="${manage}"`);
    expect(html).toContain(`title="${remove}"`);
  },
);

it.each([
  ['zh', '文档较大，建议索引到知识库', '索引', '移除'],
  [
    'en',
    'Large document — consider indexing it to a knowledge base',
    'Index',
    'Remove',
  ],
] as const)(
  'localizes the attached document quick-index actions in %s',
  (locale, indexTitle, index, remove) => {
    settings.locale = locale;
    const html = renderToStaticMarkup(
      createElement(AttachedDocumentView, {
        document: {
          name: 'report.pdf',
          summary: '报告内容',
          fileSize: 2 * 1024 * 1024,
        },
        onRemove: vi.fn(),
      }),
    );
    expect(html).toContain(`title="${indexTitle}"`);
    expect(html).toContain(`>${index}<`);
    expect(html).toContain(`title="${remove}"`);
  },
);
