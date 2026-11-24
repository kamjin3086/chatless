import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { ResourceManager } from '../ResourceManager';

const settings = vi.hoisted(() => ({ locale: 'en' as Locale }));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => Locale) =>
    select(settings),
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: (
    select: (state: { setCurrentConversation: () => void }) => unknown,
  ) => select({ setCurrentConversation: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/unifiedFileService', () => ({ UnifiedFileService: {} }));
vi.mock('@/lib/utils/fileOpener', () => ({ FileOpener: {} }));
vi.mock('@/lib/knowledgeService', () => ({ KnowledgeService: {} }));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  settings.locale = 'en';
});

function render(totalFileCount: number) {
  return renderToStaticMarkup(
    createElement(ResourceManager, { totalFileCount }),
  );
}

it('localizes toolbar, categories and recent-reference empty state without changing sort keys', () => {
  const en = render(1);
  expect(en).toContain('1 file<');
  expect(en).toContain('aria-label="Sort resources by"');
  expect(en).toContain('value="size">Size');
  expect(en).toContain('Indexed only');
  expect(en).toContain('Chat files');
  expect(en).toContain('No recent references');

  settings.locale = 'zh';
  const zh = render(1234);
  expect(zh).toContain('1,234 个文件');
  expect(zh).toContain('aria-label="资源排序方式"');
  expect(zh).toContain('value="size">大小');
  expect(zh).toContain('仅已入库');
  expect(zh).toContain('聊天文件');
  expect(zh).toContain('暂无引用');
});

it('shows a pluralized, grouped resource count in English', () => {
  expect(render(1234)).toContain('1,234 files<');
});
