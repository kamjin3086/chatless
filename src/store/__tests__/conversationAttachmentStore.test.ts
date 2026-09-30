import { beforeEach, describe, expect, it, vi } from 'vitest';

// zustand's persist middleware attaches `store.persist` only when a storage
// exists; without this stub the whole API is missing in the node test env.
vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});

import { useConversationAttachmentStore } from '../conversationAttachmentStore';

const CONVERSATION = 'conv-1';

beforeEach(() => {
  useConversationAttachmentStore.setState({
    sessionDirByConversation: {},
    mountedDirByConversation: {},
    workspaceErrorByConversation: {},
    knowledgeBaseByConversation: {},
  } as never);
});

describe('@WorkDir resolution', () => {
  it('uses the session folder when nothing is attached', () => {
    const store = useConversationAttachmentStore.getState();
    store.setWorkingDir(CONVERSATION, 'C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
    expect(useConversationAttachmentStore.getState().getWorkingDir(CONVERSATION))
      .toBe('C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
  });

  it('lets an attached directory become @WorkDir, and restores the session folder on detach', () => {
    const store = useConversationAttachmentStore.getState();
    store.setWorkingDir(CONVERSATION, 'C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
    store.setMountedDir(CONVERSATION, 'D:/projects/site');

    expect(useConversationAttachmentStore.getState().getWorkingDir(CONVERSATION)).toBe('D:/projects/site');
    expect(useConversationAttachmentStore.getState().getSessionDir(CONVERSATION))
      .toBe('C:/Users/x/Documents/Chatless/线缆整改-3f9a21');

    useConversationAttachmentStore.getState().clearMountedDir(CONVERSATION);
    expect(useConversationAttachmentStore.getState().getWorkingDir(CONVERSATION))
      .toBe('C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
  });
});

describe('attachment persistence', () => {
  it('keeps an attached directory across restarts, scoped to its conversation', () => {
    // "附加目录" is a conversation-scoped grant the user asked for: it must survive
    // a restart and disappear when the user detaches it.
    useConversationAttachmentStore.getState().setMountedDir(CONVERSATION, 'D:/projects/site');
    const persisted = useConversationAttachmentStore.persist.getOptions().partialize!({
      ...useConversationAttachmentStore.getState(),
      mountedDirByConversation: { [CONVERSATION]: 'D:/projects/site' },
    }) as Record<string, unknown>;
    expect(persisted.mountedDirByConversation).toEqual({ [CONVERSATION]: 'D:/projects/site' });
    // The session folder is owned by the backend mapping, not localStorage.
    expect(persisted.sessionDirByConversation).toBeUndefined();
  });

  it('records why a workspace could not be prepared, so the UI can offer a retry', () => {
    const store = useConversationAttachmentStore.getState();
    store.setWorkspaceError(CONVERSATION, 'WORKSPACE_PERMISSION_DENIED: 创建会话目录失败');
    expect(useConversationAttachmentStore.getState().getWorkspaceError(CONVERSATION))
      .toContain('WORKSPACE_PERMISSION_DENIED');

    useConversationAttachmentStore.getState().clearWorkspaceError(CONVERSATION);
    expect(useConversationAttachmentStore.getState().getWorkspaceError(CONVERSATION)).toBeUndefined();
  });

  it('tracks whether the session folder is the one in use, and whether it exists yet', () => {
    const store = useConversationAttachmentStore.getState();
    // Resolved but not created: a chat-only conversation.
    store.setWorkingDir(CONVERSATION, 'C:/Users/x/Documents/Chatless/新对话-ab12cd', false);
    expect(useConversationAttachmentStore.getState().isSessionDirInUse(CONVERSATION)).toBe(true);
    expect(useConversationAttachmentStore.getState().isWorkspaceMaterialized(CONVERSATION)).toBe(false);

    // The user picked their own folder: the session folder is out of the picture.
    store.setMountedDir(CONVERSATION, 'D:/projects/site');
    expect(useConversationAttachmentStore.getState().isSessionDirInUse(CONVERSATION)).toBe(false);
    // The mounted folder is what the agent works in.
    expect(useConversationAttachmentStore.getState().getWorkingDir(CONVERSATION)).toBe('D:/projects/site');

    useConversationAttachmentStore.getState().clearMountedDir(CONVERSATION);
    expect(useConversationAttachmentStore.getState().isSessionDirInUse(CONVERSATION)).toBe(true);

    useConversationAttachmentStore.getState().markWorkspaceMaterialized(CONVERSATION);
    expect(useConversationAttachmentStore.getState().isWorkspaceMaterialized(CONVERSATION)).toBe(true);
  });
});
