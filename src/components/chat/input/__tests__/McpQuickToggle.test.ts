import React, { createElement, useState, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { McpQuickToggle } from '../McpQuickToggle';

const { localeState } = vi.hoisted(() => ({
  localeState: { locale: 'zh' as Locale },
}));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => Locale) =>
    select(localeState),
}));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.mock('@/components/ui/action-panel', async (importOriginal) => {
  const panel =
    await importOriginal<typeof import('@/components/ui/action-panel')>();
  // Inspect the popover contents without mounting its DOM portal.
  return {
    ...panel,
    ActionPanelContent: ({ children }: PropsWithChildren) => children,
  };
});
vi.stubGlobal('React', React);

test.each([
  [
    'en',
    'MCP servers',
    '0/0 connected',
    'Enabled',
    'No configured servers',
    'Add a server in Settings',
    'Manage MCP servers',
  ],
  [
    'zh',
    'MCP 服务器',
    '0/0 已连接',
    '已启用',
    '暂无配置的服务器',
    '前往设置页面添加',
    '管理 MCP 服务器',
  ],
] as const)(
  'renders the empty MCP quick toggle in %s',
  (locale, title, count, status, empty, hint, manage) => {
    localeState.locale = locale;
    const html = renderToStaticMarkup(createElement(McpQuickToggle));
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain(`aria-label="${title}"`);
    expect(html).toContain(count);
    expect(html).toContain(`>${status}<`);
    expect(html).toContain(empty);
    expect(html).toContain(hint);
    expect(html).toContain(`>${manage}<`);
    expect(html).toContain('href="/settings?tab=mcpServers"');
  },
);

test.each([
  [
    'en',
    '1/2 connected',
    'Disabled',
    'Connected',
    'Disconnected',
    'Connect',
    'Insert @mention',
    '@Mention',
  ],
  [
    'zh',
    '1/2 已连接',
    '已禁用',
    '已连接',
    '未连接',
    '连接',
    '插入 @引用',
    '@引用',
  ],
] as const)(
  'localizes the MCP quick toggle statuses and actions in %s without translating server names',
  (
    locale,
    count,
    status,
    connected,
    disconnected,
    connect,
    insert,
    mention,
  ) => {
    localeState.locale = locale;
    // Seed the populated snapshot normally loaded by the client effect.
    const all = ['资料索引', 'second-server'];
    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([all, vi.fn()])
      .mockReturnValueOnce([[all[0]], vi.fn()])
      .mockReturnValueOnce([[all[0]], vi.fn()])
      .mockReturnValueOnce([false, vi.fn()]);
    const html = renderToStaticMarkup(
      createElement(McpQuickToggle, { onInsertMention: vi.fn() }),
    );
    expect(html).toContain(count);
    expect(html).toContain(`>${status}<`);
    expect(html).toContain(`>${connected}<`);
    expect(html).toContain(`>${disconnected}<`);
    expect(html).toContain(`title="${connect}"`);
    expect(html).toContain(`title="${insert}">${mention}</button>`);
    for (const name of all) expect(html).toContain(`>${name}<`);
  },
);
