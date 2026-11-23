import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import { SecuritySettings } from '../SecuritySettings';

const settings = vi.hoisted(() => ({
  locale: 'zh' as Locale,
}));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (
    selector?: (state: {
      locale: Locale;
      t: (key: TranslationKey) => string;
    }) => unknown,
  ) => {
    const state = {
      locale: settings.locale,
      t: (key: TranslationKey) => translate(settings.locale, key),
    };
    return selector ? selector(state) : state;
  },
}));

const chatState = vi.hoisted(() => ({
  conversations: [{ id: 'conv-1', title: '项目调研' }],
  currentConversationId: 'conv-1' as string | null,
  isGenerating: false,
  agentRuns: {} as Record<string, unknown>,
}));

vi.mock('@/store/chatStore', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) =>
    selector(chatState),
}));

const attachmentMock = vi.hoisted(() => {
  const state = {
    clearWorkingDir: vi.fn(),
    clearWorkspaceError: vi.fn(),
    workspaceErrorByConversation: {} as Record<string, string | undefined>,
    setWorkingDir: vi.fn(),
    markWorkspaceMaterialized: vi.fn(),
    setWorkspaceError: vi.fn(),
  };
  const useStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useStore.getState = () => state;
  return { useStore, state };
});

vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: attachmentMock.useStore,
}));

const fsAllowlist = vi.hoisted(() => {
  const directories = [
    {
      id: 'dir-1',
      path: '/home/user/项目资料',
      alias: '资料',
      permissions: { read: true, write: true, create: true, delete: false },
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const state = {
    directories,
    load: vi.fn(),
    removeDirectory: vi.fn(),
    updateDirectory: vi.fn(),
  };
  const useStore = () => state;
  useStore.getState = () => state;
  return { useStore, state };
});

vi.mock('@/store/filesystemAllowlistStore', () => ({
  useFilesystemAllowlistStore: fsAllowlist.useStore,
}));

vi.mock('@/lib/mcp/accessPolicy', () => ({
  getGlobalAccess: vi.fn().mockResolvedValue('ask'),
  getConversationAccess: vi.fn().mockReturnValue(undefined),
  setGlobalAccess: vi.fn().mockResolvedValue(undefined),
  clearConversationAccess: vi.fn(),
}));

vi.mock('@/lib/agentWorkspace/workspaceService', () => ({
  ensureConversationWorkspace: vi.fn(),
  exportConversationWorkspace: vi.fn(),
  revealConversationWorkspace: vi.fn(),
  trashConversationWorkspaces: vi.fn(),
  trashEveryConversationWorkspace: vi.fn(),
}));

vi.mock('@/lib/filesystemAllowlist', () => ({
  ensureAllowlistedDirectory: vi.fn(),
  normalizeAlias: (input: string) => input.trim(),
}));

vi.mock('@/lib/filesystemAllowlist/backendSync', () => ({
  syncFilesystemAllowlistToBackend: vi.fn().mockResolvedValue(undefined),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

function render(locale: Locale): string {
  settings.locale = locale;
  return renderToStaticMarkup(createElement(SecuritySettings));
}

describe('SecuritySettings localization', () => {
  it('renders shell, filesystem and workspace copy in both locales', () => {
    const en = render('en');
    const zh = render('zh');

    for (const [english, chinese] of [
      ['Command execution', '命令执行'],
      ['Ask before running', '执行前是否询问'],
      ['Ask every time', '每次询问'],
      ['Never ask', '不再询问'],
      ['File access allowlist', '文件访问白名单'],
      ['Operations outside the allowlist', '白名单之外的操作'],
      ['Add directory', '添加目录'],
      ['Read', '读'],
      ['Write', '写'],
      ['Create', '建'],
      ['Delete', '删'],
      ['Manual', '手动添加'],
      ['Conversation artifacts', '会话产物'],
      ['Current conversation', '当前会话'],
      ['Open directory', '打开目录'],
      ['Export', '导出'],
      ['Clean all conversation artifacts', '清理全部会话产物'],
    ]) {
      expect(en).toContain(english);
      expect(zh).toContain(chinese);
    }

    // Untranslated user data (conversation title and allowlist alias) stays intact.
    for (const html of [en, zh]) {
      expect(html).toContain('项目调研');
      expect(html).toContain('@资料');
    }
  });

  it('keeps the default ask trust level and rwcd permission values unchanged', () => {
    const zh = render('zh');

    // Shell and filesystem both default to `ask`, so the ask hint is visible
    // while the unrestricted hint is not.
    expect(zh).toContain(
      '弹卡片询问，可选仅本次 / 本会话不再询问 / 始终不再询问',
    );
    expect(zh).toContain(
      '弹卡片询问，可选仅本次 / 以后都允许 / 本会话不再询问',
    );
    expect(zh).not.toContain(
      '不再询问，适合长时间自动任务；破坏性命令仍会被沙箱拦截',
    );
    expect(zh).not.toContain(
      '不再询问，文件读写和删除直接执行（适合长时间自动任务）',
    );

    // Default directory permissions render exactly as stored: read/write/create
    // granted, delete denied. The ✓/– marks come from the permission booleans,
    // not from translation catalogs.
    expect(zh).toContain('读✓');
    expect(zh).toContain('写✓');
    expect(zh).toContain('建✓');
    expect(zh).toContain('删–');
  });
});
