import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import type { Locale } from '@/i18n/types';
import { createConversationMenuItems } from '@/components/ui/context-menu';
import { ConversationSidebar } from '../ConversationSidebar';
import { DeleteConversationDialog } from '../DeleteConversationDialog';
import { EditableTitle } from '../EditableTitle';

let locale: Locale;
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: { locale: Locale }) => unknown) =>
    select({ locale }),
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: (select: (state: object) => unknown) =>
    select({
      openedWorkspaces: [],
      mountedDirByConversation: {},
      archivedWorkspaces: {},
    }),
}));
vi.mock('@/store/uiPreferences', () => ({
  useUiPreferences: (select: (state: object) => unknown) =>
    select({ conversationGrouping: 'time' }),
}));
vi.mock('@/lib/chat/actions/download', () => ({
  exportConversationMarkdown: vi.fn(),
}));
vi.mock('@/components/ui/alert-dialog', () => {
  const renderChildren = ({ children }: PropsWithChildren) => children;
  return {
    AlertDialog: renderChildren,
    AlertDialogContent: renderChildren,
    AlertDialogHeader: renderChildren,
    AlertDialogFooter: renderChildren,
    AlertDialogTitle: renderChildren,
    AlertDialogDescription: renderChildren,
    AlertDialogCancel: renderChildren,
    AlertDialogAction: renderChildren,
  };
});

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const title = '项目 $& <notes>';
const escapedTitle = '项目 $&amp; &lt;notes&gt;';

function renderSidebar(filter: 'recent' | 'archived', searchQuery?: string) {
  return renderToStaticMarkup(
    createElement(ConversationSidebar, {
      filter,
      filteredConversations: [],
      isSearching: searchQuery !== undefined,
      searchQuery,
      onCreateInWorkspace: vi.fn(),
    }),
  );
}

it.each([
  [
    'en',
    `No conversations match “${escapedTitle}”.`,
    'No archived conversations or workspaces',
  ],
  ['zh', `没有找到与“${escapedTitle}”相关的会话。`, '没有已归档的会话或工作区'],
] as const)(
  'renders sidebar search and archive states in %s',
  (language, noResults, emptyArchive) => {
    locale = language;
    expect(renderSidebar('recent', title)).toContain(noResults);
    expect(renderSidebar('archived')).toContain(emptyArchive);
  },
);

it.each([
  [
    'en',
    'Click to edit the title',
    `“${escapedTitle}” will be deleted. This can’t be undone.`,
    'Close',
  ],
  [
    'zh',
    '点击编辑标题',
    `会话“${escapedTitle}”将被删除，此操作无法撤销。`,
    '关闭',
  ],
] as const)(
  'translates rename and delete controls in %s without replacing the title',
  (language, editHint, warning, close) => {
    locale = language;
    const onTitleChange = vi.fn();
    const edit = renderToStaticMarkup(
      createElement(EditableTitle, { initialTitle: title, onTitleChange }),
    );
    expect(edit).toContain(`title="${editHint}"`);
    expect(edit).toContain(`>${escapedTitle}</span>`);
    expect(onTitleChange).not.toHaveBeenCalled();

    const dialog = renderToStaticMarkup(
      createElement(DeleteConversationDialog, {
        isOpen: true,
        onOpenChange: vi.fn(),
        onConfirm: vi.fn(),
        conversation: {
          id: 'conversation-id',
          title,
          created_at: 0,
          updated_at: 0,
          messages: [],
          model_id: 'model',
          is_favorite: false,
        },
      }),
    );
    expect(dialog).toContain(warning);
    expect(dialog).toContain(`aria-label="${close}"`);
  },
);

it.each([
  ['en', 'Rename conversation', 'Delete conversation', 'Unarchive'],
  ['zh', '重命名会话', '删除会话', '取消归档'],
] as const)(
  'keeps menu action IDs and handlers while changing the labels to %s',
  (language, rename, remove, unarchive) => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onUnarchive = vi.fn();
    const items = createConversationMenuItems(
      language,
      'conversation-id',
      false,
      onRename,
      onDelete,
      vi.fn(),
      undefined,
      undefined,
      { text: translate(language, 'chatSidebar.restore'), action: onUnarchive },
    );
    for (const [id, text] of [
      ['edit', rename],
      ['delete', remove],
      ['archive', unarchive],
    ]) {
      const item = items.find((entry) => entry.id === id);
      expect(item?.text).toBe(text);
      item?.action?.();
    }
    expect(onRename).toHaveBeenCalledWith('conversation-id');
    expect(onDelete).toHaveBeenCalledWith('conversation-id');
    expect(onUnarchive).toHaveBeenCalledOnce();
  },
);
