/**
 * Android has no `workspace_ensure` command: creating a conversation there must not resolve
 * a desktop working directory or report its failure. Desktop keeps both.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
});

const platform = vi.hoisted(() => ({ android: false }));

const db = vi.hoisted(() => ({
  select: vi.fn(async () => []),
  createConversation: vi.fn(async () => {}),
}));

const workspace = vi.hoisted(() => ({
  ensureConversationWorkspace: vi.fn(async () => ({
    root: '/home/user/Documents/Chatless/chat',
    manifestPath: '/home/user/Documents/Chatless/chat/AGENTS.md',
    created: false,
    exists: true,
    adoptedLegacy: false,
  })),
}));

const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('@/lib/utils/runtimePlatform', () => ({
  isAndroidTauri: () => platform.android,
}));

vi.mock('@/lib/agentWorkspace/workspaceService', () => workspace);

vi.mock('@/components/ui/sonner', () => ({ toast }));

vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({ select: db.select }),
      getConversationRepository: () => ({ create: db.createConversation }),
      getMessageRepository: () => ({}),
    }),
  },
}));

import { useChatStore } from '../chatStore';
import { useConversationAttachmentStore } from '../conversationAttachmentStore';

beforeEach(() => {
  platform.android = false;
  db.select.mockClear();
  db.createConversation.mockClear();
  workspace.ensureConversationWorkspace.mockClear();
  toast.error.mockClear();
  useConversationAttachmentStore.setState({
    mountedDirByConversation: {},
    sessionDirByConversation: {},
    workspaceExistsByConversation: {},
    workspaceErrorByConversation: {},
    archivedConversations: {},
    archivedWorkspaces: {},
    openedWorkspaces: [],
  });
  useChatStore.setState({
    conversations: [],
    currentConversationId: null,
    pendingWorkspace: null,
    inputDrafts: {},
    lastUsedModelPerChat: {},
    _messagesLoaded: {},
  } as never);
});

describe('creating a conversation on Android', () => {
  it('does not resolve a desktop workspace or report its failure', async () => {
    platform.android = true;
    const id = await useChatStore
      .getState()
      .createConversation('新对话', 'model-a');

    expect(workspace.ensureConversationWorkspace).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(
      useConversationAttachmentStore.getState().workspaceErrorByConversation[
        id
      ],
    ).toBeUndefined();
  });
});

describe('creating a conversation on desktop', () => {
  it('still resolves the @WorkDir it always had', async () => {
    const id = await useChatStore
      .getState()
      .createConversation('new conversation', 'model-a');

    expect(workspace.ensureConversationWorkspace).toHaveBeenCalledTimes(1);
    expect(workspace.ensureConversationWorkspace).toHaveBeenCalledWith({
      conversationId: id,
      title: 'new conversation',
      materialize: false,
    });
    expect(useConversationAttachmentStore.getState().getSessionDir(id)).toBe(
      '/home/user/Documents/Chatless/chat',
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
