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
    openedWorkspaces: [],
    archivedWorkspaces: {},
    archivedConversations: {},
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

  it('never derives @WorkDir from project membership', () => {
    const store = useConversationAttachmentStore.getState();
    const sessionFolder = 'C:/Users/x/Documents/Chatless/session-3f9a21';
    store.setMountedDir(CONVERSATION, 'D:/projects/site');
    expect(store.getWorkingDir(CONVERSATION)).toBeUndefined();
    expect(store.isSessionDirInUse(CONVERSATION)).toBe(false);

    store.setWorkingDir(CONVERSATION, sessionFolder);
    expect(store.getWorkingDir(CONVERSATION)).toBe(sessionFolder);
    expect(store.isSessionDirInUse(CONVERSATION)).toBe(true);

    store.clearWorkingDir(CONVERSATION);
    expect(store.getWorkingDir(CONVERSATION)).toBeUndefined();
    expect(store.getMountedDir(CONVERSATION)).toBe('D:/projects/site');
  });
});

describe('attachment persistence', () => {
  it('persists workspace registration and archive flags without attaching a directory', async () => {
    const store = useConversationAttachmentStore.getState();
    store.registerWorkspace('D:\\projects\\site\\');
    store.registerWorkspace('D:/projects/site');
    store.archiveWorkspace('D:/projects/site', true);
    store.archiveConversation(CONVERSATION, true);
    const saved = localStorage.getItem('conversation-knowledge-mounts');
    expect(saved).toBeTruthy();
    useConversationAttachmentStore.setState({ openedWorkspaces: [], archivedWorkspaces: {}, archivedConversations: {} });
    localStorage.setItem('conversation-knowledge-mounts', saved ?? '');
    await useConversationAttachmentStore.persist.rehydrate();
    expect(useConversationAttachmentStore.getState()).toMatchObject({
      openedWorkspaces: ['D:/projects/site'],
      archivedWorkspaces: { 'D:/projects/site': true },
      archivedConversations: { [CONVERSATION]: true },
      mountedDirByConversation: {},
    });
    store.archiveWorkspace('D:/projects/site', false);
    expect(useConversationAttachmentStore.getState().archivedConversations[CONVERSATION]).toBe(true);
  });
  it('restores legacy attached directories as membership, not agent access', async () => {
    localStorage.setItem('conversation-knowledge-mounts', JSON.stringify({
      state: { mountedDirByConversation: { [CONVERSATION]: 'D:/projects/site' } },
      version: 0,
    }));
    await useConversationAttachmentStore.persist.rehydrate();
    const store = useConversationAttachmentStore.getState();
    expect(store.getMountedDir(CONVERSATION)).toBe('D:/projects/site');
    expect(store.getWorkingDir(CONVERSATION)).toBeUndefined();
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

    useConversationAttachmentStore.getState().markWorkspaceMaterialized(CONVERSATION);
    expect(useConversationAttachmentStore.getState().isWorkspaceMaterialized(CONVERSATION)).toBe(true);
  });
});
