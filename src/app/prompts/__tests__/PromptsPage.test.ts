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
import { PromptEditorDialog } from '@/components/prompts/PromptEditorDialog';
import { PromptImportExport } from '@/components/prompts/PromptImportExport';
import { RecentUsedList } from '@/components/ui/RecentUsedList';
import type { Locale } from '@/i18n/types';
import type { PromptItem } from '@/types/prompt';
import PromptsPage from '../page';

const state = vi.hoisted(() => ({
  locale: 'en' as Locale,
  prompts: [] as PromptItem[],
  searchQuery: '',
  currentConversationId: null as string | null,
  getHistory: vi.fn(),
  importPrompts: vi.fn(),
  updateConversation: vi.fn(),
  push: vi.fn(),
  recent: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (store: { locale: Locale }) => unknown) =>
    select(state),
}));
vi.mock('@/store/promptStore', () => ({
  usePromptStore: (select: (store: unknown) => unknown) =>
    select({
      prompts: state.prompts,
      ui: { searchQuery: state.searchQuery, sortBy: 'recent' },
      getHistory: state.getHistory,
      importPrompts: state.importPrompts,
    }),
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: (select: (store: unknown) => unknown) => select(state),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/ui/sonner', () => ({ toast: state.toast }));
vi.mock('@/components/ui/RecentUsedList', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/ui/RecentUsedList')>();
  return {
    ...actual,
    RecentUsedList: (props: React.ComponentProps<typeof RecentUsedList>) => {
      state.recent(props);
      return createElement(actual.RecentUsedList, props);
    },
  };
});
// Keep the open editor in the server render instead of waiting for a DOM portal.
vi.mock('@radix-ui/react-dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@radix-ui/react-dialog')>()),
  Portal: ({ children }: PropsWithChildren) => children,
}));

const updated = new Date(2025, 4, 14, 16, 25);
const used = new Date(2025, 4, 15, 16, 25);
const prompt: PromptItem = {
  id: 'original-id',
  name: '用户写的标题',
  description: '用途说明',
  content: '保留 {{topic="原始值"}} <example>',
  tags: ['自定义标签'],
  shortcuts: ['快捷词'],
  createdAt: updated.getTime(),
  updatedAt: updated.getTime(),
  stats: { uses: 1, lastUsedAt: used.getTime() },
};
const editorProps = { open: true, onOpenChange: vi.fn(), onSubmit: vi.fn() };

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  state.prompts = [];
  state.searchQuery = '';
  state.currentConversationId = null;
  state.getHistory.mockReturnValue([]);
});

const localeCases = [
  {
    locale: 'en',
    language: 'en-US',
    search: 'Search prompts…',
    clearSearch: 'Clear search',
    empty: 'No prompts yet',
    noMatches: 'No matching prompts',
    recentlyUsed: 'Recently used',
    singleUse: '1 use',
    manyUses: '1,200 uses',
    createTitle: 'New prompt',
    editTitle: 'Edit prompt',
    placeholder: 'Enter prompt content…',
    tokenHelp: 'Use {{variable}} to define variables',
    history: 'View history (1)',
    close: 'Close editor',
    save: 'Save',
    selectConversation: 'Choose a conversation first',
    applied: 'Applied to the current conversation',
    importSummary: 'Import complete: 1,200 added, 2 updated, 0 skipped',
    missingCsv: 'Missing required CSV fields',
    requiredCsv: 'Required fields missing from the CSV: content',
  },
  {
    locale: 'zh',
    language: 'zh-CN',
    search: '搜索提示词…',
    clearSearch: '清除搜索',
    empty: '暂无提示词',
    noMatches: '未找到匹配的提示词',
    recentlyUsed: '最近使用',
    singleUse: '1 次',
    manyUses: '1,200 次',
    createTitle: '新建提示词',
    editTitle: '编辑提示词',
    placeholder: '输入提示词内容…',
    tokenHelp: '用 {{变量}} 定义变量',
    history: '查看历史（1）',
    close: '关闭编辑器',
    save: '保存',
    selectConversation: '请先选择一个对话',
    applied: '已应用到当前对话',
    importSummary: '导入完成：新增 1,200，更新 2，跳过 0',
    missingCsv: 'CSV 文件缺少必要字段',
    requiredCsv: 'CSV 文件缺少以下字段：content',
  },
] as const;

describe.each(localeCases)('prompt library ($locale)', (strings) => {
  beforeEach(() => {
    state.locale = strings.locale;
  });

  it('renders the real page with localized empty and search states', () => {
    const empty = renderToStaticMarkup(createElement(PromptsPage));
    expect(empty).toContain(`placeholder="${strings.search}"`);
    expect(empty).toContain(strings.empty);
    expect(empty).toContain(strings.createTitle);

    state.searchQuery = 'unmatched';
    const filtered = renderToStaticMarkup(createElement(PromptsPage));
    expect(filtered).toContain(strings.noMatches);
    expect(filtered).toContain(`aria-label="${strings.clearSearch}"`);
  });

  it('formats card counts and both dates without translating stored prompt fields', () => {
    state.prompts = [
      prompt,
      { ...prompt, id: 'another', stats: { uses: 1200 } },
    ];
    const html = renderToStaticMarkup(createElement(PromptsPage));
    expect(html).toContain(strings.recentlyUsed);
    expect(html).toContain(`${strings.singleUse} · `);
    expect(html).toContain(`${strings.manyUses} · `);
    expect(html).toContain(updated.toLocaleString(strings.language));
    expect(html).toContain(prompt.name);
    expect(html).toContain(prompt.description);
    expect(html).toContain('保留 {{topic=&quot;原始值&quot;}} &lt;example&gt;');
    expect(html).toContain('自定义标签');
    expect(html).toContain('#快捷词');
    expect(state.recent).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            name: prompt.name,
            time: used.toLocaleDateString(strings.language),
          }),
        ],
      }),
    );
  });

  it('localizes applying from the recent list without changing the conversation update', () => {
    state.prompts = [prompt];
    renderToStaticMarkup(createElement(PromptsPage));
    state.recent.mock.calls[0][0].onItemClick(prompt.id);
    expect(state.toast.info).toHaveBeenCalledWith(strings.selectConversation);
    expect(state.updateConversation).not.toHaveBeenCalled();

    state.currentConversationId = 'chat-id';
    renderToStaticMarkup(createElement(PromptsPage));
    state.recent.mock.lastCall?.[0].onItemClick(prompt.id);
    expect(state.toast.success).toHaveBeenCalledWith(strings.applied);
    expect(state.updateConversation).toHaveBeenCalledWith('chat-id', {
      system_prompt_applied: { promptId: prompt.id, mode: 'permanent' },
    });
    expect(state.push).toHaveBeenNthCalledWith(1, '/chat');
    expect(state.push).toHaveBeenNthCalledWith(2, '/chat');
  });

  it('localizes editor controls and hints without translating variable syntax in saved content', () => {
    const create = renderToStaticMarkup(
      createElement(PromptEditorDialog, editorProps),
    );
    expect(create).toContain(strings.createTitle);
    expect(create).toContain(strings.placeholder);
    expect(create).toContain(`≈ 0 tokens · ${strings.tokenHelp}`);
    expect(create).toContain(`aria-label="${strings.close}"`);
    expect(create).toContain(strings.save);

    state.getHistory.mockReturnValue([
      { ...prompt, savedAt: updated.getTime() },
    ]);
    const edit = renderToStaticMarkup(
      createElement(PromptEditorDialog, { ...editorProps, initial: prompt }),
    );
    expect(edit).toContain(strings.editTitle);
    expect(edit).toContain(`title="${strings.history}"`);
    expect(edit).not.toContain(strings.placeholder);
    expect(edit).toMatch(
      /<textarea[^>]*>保留 \{\{topic=&quot;原始值&quot;\}\} &lt;example&gt;<\/textarea>/u,
    );
  });

  it('localizes the import summary and CSV errors without changing imported data or CSV fields', async () => {
    // Capture the mounted file input's handler from the real import control.
    type FileInputProps = {
      type: string;
      onChange: (event: unknown) => Promise<void>;
    };
    const captureInput = vi.fn<(props: FileInputProps) => void>();
    function ImportControl() {
      const control = PromptImportExport();
      const input = React.Children.toArray(
        control.props.children.props.children,
      ).find(
        (child): child is React.ReactElement<FileInputProps> =>
          React.isValidElement<FileInputProps>(child) &&
          child.type === 'input' &&
          child.props.type === 'file',
      );
      if (input) captureInput(input.props);
      return control;
    }
    renderToStaticMarkup(createElement(ImportControl));
    expect(captureInput).toHaveBeenCalledOnce();
    const input = captureInput.mock.calls[0][0];
    const chooseFile = (name: string, body: string) =>
      input.onChange({
        target: { files: [{ name, text: async () => body }] },
      });
    state.importPrompts.mockReturnValue({
      created: 1200,
      updated: 2,
      skipped: 0,
    });
    await chooseFile('prompts.json', JSON.stringify({ prompts: [prompt] }));
    expect(state.importPrompts).toHaveBeenCalledWith([prompt]);
    expect(state.toast.success).toHaveBeenCalledWith(strings.importSummary);

    await chooseFile('prompts.csv', 'name\nExample');
    expect(state.toast.error).toHaveBeenCalledWith(strings.missingCsv, {
      description: strings.requiredCsv,
    });
    expect(state.importPrompts).toHaveBeenCalledOnce();
  });
});
