import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { ChatListItem } from '@/components/layout/ChatListItem';
import { SidebarFooter } from '@/components/layout/SidebarFooter';
import { SidebarHeader } from '@/components/layout/SidebarHeader';
import { ChatInput } from '@/components/chat/input/ChatInput';
import { MoreOptionsMenu } from '@/components/chat/input/MoreOptionsMenu';
import { NewMessageIndicator } from '@/components/chat/NewMessageIndicator';
import { ScrollToBottomButton } from '@/components/chat/ScrollToBottomButton';
import { CitationPopover } from '@/components/chat/CitationPopover';
import { FileHistoryPopover } from '@/components/chat/FileHistoryPopover';
import { ContextCompactionNotice } from '@/components/chat/ContextCompactionNotice';
import { MessageNavigationMenu } from '@/components/chat/MessageNavigationMenu';
import { MARKDOWN_THEMES } from '@/hooks/useMarkdownTheme';

const localeState = vi.hoisted(() => ({
  locale: 'zh' as Locale,
}));

// The compaction store lives in memory only, and its server snapshot is the
// empty initial state, so the notice is rendered from a stand-in.
const compactionState = vi.hoisted(() => ({
  notices: {
    'message-1': {
      messageId: 'message-1',
      conversationId: 'conversation-1',
      coveredMessages: 7,
      summary: '摘要正文',
      reused: false,
      at: 0,
    },
  },
}));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => unknown) =>
    select(localeState),
}));

vi.mock('@/store/contextCompactionStore', () => ({
  useContextCompactionStore: (
    select: (state: typeof compactionState) => unknown,
  ) => select(compactionState),
}));

vi.mock('@/store/chatStore', () => ({
  useChatStore: (
    select: (state: { currentConversationId: string | null }) => unknown,
  ) => select({ currentConversationId: 'conversation-1' }),
}));

// The navigation menu renders inside a Radix menu portal, which static markup
// cannot open. Plain elements keep the copy under test without the portal.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  DropdownMenuSeparator: () => createElement('div'),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const CASES = [
  {
    locale: 'zh' as Locale,
    newMessage: '新消息',
    newMessageAria: '查看新消息',
    scrollToBottom: '回到底部',
    scrollToBottomTitle: '回到底部并恢复自动滚动',
    favorite: '收藏',
    more: '更多',
    history: '历史记录',
    prompts: '提示词库',
    resources: '知识资源',
    settings: '设置',
    shortcuts: '快捷键',
    inputPlaceholder: '输入消息...',
    selectKnowledgeBase: '选择知识库',
    sessionParameters: '会话参数',
    citationAria: '查看引用 1',
    versionHistory: '历史版本',
    navigationCount: '消息导航 (2条)',
    navigationFilterAll: '全部',
    navigationFilterUser: '用户',
    navigationRoleUser: '用户',
    navigationRoleAssistant: 'AI助手',
    navigationSearch: '搜索消息内容...',
    navigationNoMatches: '无匹配消息',
    compactionSummary: '历史已压缩 7 条',
    compactionTooltip:
      '较早的历史已被摘要，模型看到的是摘要 + 最近几轮完整对话',
    relativeTime: '前',
    swissTheme: '瑞士简约',
    swissDescription: '优雅简洁，注重排版与留白',
  },
  {
    locale: 'en' as Locale,
    newMessage: 'New messages',
    newMessageAria: 'View new messages',
    scrollToBottom: 'Scroll to bottom',
    scrollToBottomTitle: 'Scroll to the bottom and resume auto-scrolling',
    favorite: 'Favorite',
    more: 'More',
    history: 'History',
    prompts: 'Prompt library',
    resources: 'Knowledge resources',
    settings: 'Settings',
    shortcuts: 'Keyboard shortcuts',
    inputPlaceholder: 'Type a message...',
    selectKnowledgeBase: 'Select knowledge base',
    sessionParameters: 'Session parameters',
    citationAria: 'View citation 1',
    versionHistory: 'Version history',
    navigationCount: 'Message navigation (2)',
    navigationFilterAll: 'All',
    navigationFilterUser: 'User',
    navigationRoleUser: 'User',
    navigationRoleAssistant: 'AI assistant',
    navigationSearch: 'Search messages...',
    navigationNoMatches: 'No matching messages',
    compactionSummary: '7 earlier messages compacted',
    compactionTooltip:
      'Earlier history has been summarized; the model sees the summary plus the last few turns in full.',
    relativeTime: 'ago',
    swissTheme: 'Swiss minimal',
    swissDescription:
      'Elegant and simple, focused on typography and whitespace',
  },
] as const;

it.each(CASES)('localizes chat UI leftovers in $locale', (current) => {
  const other = CASES.find((entry) => entry.locale !== current.locale)!;
  localeState.locale = current.locale;

  const newMessageHtml = renderToStaticMarkup(
    createElement(NewMessageIndicator, { show: true, onClick: () => {} }),
  );
  expect(newMessageHtml).toContain(`aria-label="${current.newMessageAria}"`);
  expect(newMessageHtml).toContain(`>${current.newMessage}<`);
  expect(newMessageHtml).not.toContain(other.newMessageAria);

  const scrollHtml = renderToStaticMarkup(
    createElement(ScrollToBottomButton, { show: true, onClick: () => {} }),
  );
  expect(scrollHtml).toContain(`aria-label="${current.scrollToBottom}"`);
  expect(scrollHtml).toContain(`title="${current.scrollToBottomTitle}"`);
  expect(scrollHtml).not.toContain(other.scrollToBottomTitle);

  const listItemHtml = renderToStaticMarkup(
    createElement(ChatListItem, {
      id: 'chat-1',
      title: '一条会话',
      onSelect: () => {},
      onStarToggle: () => {},
      onMoreActions: () => {},
    }),
  );
  expect(listItemHtml).toContain(`title="${current.favorite}"`);
  expect(listItemHtml).toContain(`title="${current.more}"`);
  expect(listItemHtml).not.toContain(other.favorite);

  const footerHtml = renderToStaticMarkup(createElement(SidebarFooter, {}));
  for (const label of [
    current.history,
    current.prompts,
    current.resources,
    current.settings,
    current.shortcuts,
  ]) {
    expect(footerHtml).toContain(`>${label}<`);
  }
  expect(footerHtml).not.toContain(`>${other.history}<`);

  const headerHtml = renderToStaticMarkup(
    createElement(SidebarHeader, {
      userName: 'Kamjin',
      avatarUrl: '',
      onSettingsClick: () => {},
    }),
  );
  expect(headerHtml).toContain(`title="${current.settings}"`);
  expect(headerHtml).not.toContain(`title="${other.settings}"`);

  const inputHtml = renderToStaticMarkup(
    createElement(ChatInput, { onSubmit: () => {} }),
  );
  expect(inputHtml).toContain(`placeholder="${current.inputPlaceholder}"`);
  expect(inputHtml).toContain(`>${current.selectKnowledgeBase}<`);
  expect(inputHtml).not.toContain(other.selectKnowledgeBase);

  const moreOptionsHtml = renderToStaticMarkup(
    createElement(MoreOptionsMenu, { canEditSessionParameters: true }),
  );
  expect(moreOptionsHtml).toContain(`title="${current.sessionParameters}"`);
  expect(moreOptionsHtml).not.toContain(other.sessionParameters);

  const citationHtml = renderToStaticMarkup(
    createElement(CitationPopover, {
      citation: {
        n: 1,
        documentName: '原始资料.md',
        quote: '引用的原文',
        locator: {},
      } as any,
    }),
  );
  expect(citationHtml).toContain(`aria-label="${current.citationAria}"`);
  expect(citationHtml).not.toContain(other.citationAria);

  const historyHtml = renderToStaticMarkup(
    createElement(FileHistoryPopover, { path: '/tmp/notes.md' }),
  );
  expect(historyHtml).toContain(`title="${current.versionHistory}"`);
  expect(historyHtml).toContain(`aria-label="${current.versionHistory}"`);
  expect(historyHtml).not.toContain(`title="${other.versionHistory}"`);

  const compactionHtml = renderToStaticMarkup(
    createElement(ContextCompactionNotice, { messageId: 'message-1' }),
  );
  expect(compactionHtml).toContain(current.compactionSummary);
  expect(compactionHtml).toContain(`title="${current.compactionTooltip}"`);
  expect(compactionHtml).not.toContain(other.compactionSummary);

  const navigationHtml = renderToStaticMarkup(
    createElement(MessageNavigationMenu, {
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: '第一条消息',
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'message-2',
          role: 'assistant',
          content: '第二条消息',
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
      ] as any,
      onNavigateToMessage: () => {},
      onClose: () => {},
    }),
  );
  expect(navigationHtml).toContain(current.navigationCount);
  expect(navigationHtml).toContain(`>${current.navigationFilterAll}<`);
  expect(navigationHtml).toContain(`>${current.navigationFilterUser}<`);
  expect(navigationHtml).toContain(`>${current.navigationRoleAssistant}<`);
  expect(navigationHtml).toContain(`placeholder="${current.navigationSearch}"`);
  expect(navigationHtml).toContain(current.relativeTime);
  expect(navigationHtml).not.toContain(other.navigationCount);

  const emptyNavigationHtml = renderToStaticMarkup(
    createElement(MessageNavigationMenu, {
      messages: [],
      onNavigateToMessage: () => {},
      onClose: () => {},
    }),
  );
  expect(emptyNavigationHtml).toContain(current.navigationNoMatches);
  expect(emptyNavigationHtml).not.toContain(other.navigationNoMatches);

  const swiss = MARKDOWN_THEMES(current.locale).swiss;
  expect(swiss.name).toBe(current.swissTheme);
  expect(swiss.description).toBe(current.swissDescription);
});
