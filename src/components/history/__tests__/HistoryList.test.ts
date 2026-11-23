import React, { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { HistoryGroup } from '@/types/history';
import HistoryList from '../HistoryList';
import HistoryQuickFilter from '../HistoryQuickFilter';
import HistoryToolbar from '../HistoryToolbar';

let locale: Locale;
const historyState = {
  groupedHistory: [] as HistoryGroup[],
  isLoading: false,
  selectedItems: ['entry'],
  searchQuery: '项目',
  sortBy: 'date',
  sortOrder: 'desc',
  viewMode: 'list',
  currentFilter: { dateRange: 'all' },
};

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: { locale: Locale }) => unknown) =>
    select({ locale }),
}));
vi.mock('@/store/historyStore', () => ({
  useHistoryStore: () => historyState,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

it.each([
  [
    'en',
    'Search conversation titles and content…',
    'Clear search',
    'No matching conversations',
    'This month',
    'Selected: 1',
    'Delete selected conversations',
  ],
  [
    'zh',
    '搜索会话标题和内容…',
    '清除搜索',
    '未找到匹配的会话',
    '本月',
    '已选择 1 项',
    '删除选中的会话',
  ],
] as const)(
  'renders history search, filters and batch controls in %s',
  (language, search, clear, noMatches, month, selected, remove) => {
    locale = language;
    historyState.groupedHistory = [];
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(HistoryToolbar),
        createElement(HistoryQuickFilter),
        createElement(HistoryList),
      ),
    );
    expect(html).toContain(`aria-label="${search}"`);
    expect(html).toContain(`title="${clear}"`);
    expect(html).toContain('value="项目"');
    expect(html).toContain(noMatches);
    expect(html).toContain(`>${month}</button>`);
    expect(html).toContain(selected);
    expect(html).toContain(`title="${remove}"`);
  },
);

it.each([
  ['en', 'Yesterday', 'January 2024', 'Delete conversation'],
  ['zh', '昨天', '2024年01月', '删除会话'],
] as const)(
  'renders localized group headings and row actions in %s without translating titles',
  (language, relative, month, remove) => {
    locale = language;
    const title = '项目 $&';
    const time = new Date(2024, 0, 5, 12).getTime();
    const item = {
      id: 'entry',
      conversationId: 'entry',
      title,
      summary: '',
      model: 'model',
      tags: [],
      timestamp: time,
      fullTimestamp: '2024-01-05 12:00:00',
      createdAt: time,
      updatedAt: time,
      isFavorite: false,
      messageCount: 1,
      lastMessage: '',
    };
    historyState.groupedHistory = [
      { date: 'yesterday', displayName: '昨天', items: [] },
      { date: '2024-01', displayName: '2024年01月', items: [item] },
    ];
    const html = renderToStaticMarkup(createElement(HistoryList));
    expect(html).toContain(`>${relative}</div>`);
    expect(html).toContain(`>${month}</div>`);
    expect(html).toContain(`title="${remove}"`);
    expect(html).toContain('title="项目 $&amp;"');
    expect(item.title).toBe(title);
  },
);
