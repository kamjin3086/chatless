/**
 * 连点"+"不应该堆出一串空会话。
 *
 * 判定"空会话"只能问数据库：store 里的 messages 是懒加载的，重启后每个会话
 * 都挂着空数组（见 chatStore.loadConversations）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});

const db = vi.hoisted(() => ({
  select: vi.fn(),
  createConversation: vi.fn(async () => {}),
  deleteConversation: vi.fn(async () => true),
}));

vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({ select: db.select }),
      getConversationRepository: () => ({
        create: db.createConversation,
        delete: db.deleteConversation,
      }),
      getMessageRepository: () => ({}),
    }),
  },
}));

import { useChatStore } from '../chatStore';
import { useConversationAttachmentStore } from '../conversationAttachmentStore';

function conversation(id: string) {
  return {
    id,
    title: `新对话 ${id}`,
    created_at: 1,
    updated_at: 1,
    messages: [],
    model_id: 'default',
    is_favorite: false,
  } as never;
}

/** The query returns the conversations that DO have messages. */
function withMessages(...ids: string[]) {
  db.select.mockResolvedValue(ids.map((conversation_id) => ({ conversation_id })));
}

beforeEach(() => {
  db.select.mockReset();
  db.createConversation.mockClear();
  db.deleteConversation.mockClear();
  useConversationAttachmentStore.setState({ mountedDirByConversation: {}, archivedConversations: {}, archivedWorkspaces: {}, openedWorkspaces: [] });
  useChatStore.setState({
    conversations: [],
    currentConversationId: null,
    inputDrafts: {},
    lastUsedModelPerChat: {},
    _messagesLoaded: {},
  } as never);
});

describe('creating a conversation', () => {
  it('selects the existing blank conversation instead of adding another one', async () => {
    useChatStore.setState({
      conversations: [conversation('newest'), conversation('older'), conversation('chatted')],
      currentConversationId: 'older',
    } as never);
    withMessages('chatted');

    const id = await useChatStore.getState().createConversation('新对话 16:00', 'model-x');

    expect(id).toBe('newest');
    expect(useChatStore.getState().currentConversationId).toBe('newest');
    // Reusing a blank chat is not permission to delete another chat.
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['newest', 'older', 'chatted']);
    expect(db.deleteConversation).not.toHaveBeenCalled();
    expect(db.createConversation).not.toHaveBeenCalled();
  });

  it('creates a conversation when nothing is blank', async () => {
    useChatStore.setState({ conversations: [conversation('a')], currentConversationId: 'a' } as never);
    withMessages('a');

    const id = await useChatStore.getState().createConversation('新对话 16:00', 'model-x');

    expect(id).not.toBe('a');
    expect(db.createConversation).toHaveBeenCalledTimes(1);
    expect(db.deleteConversation).not.toHaveBeenCalled();
  });

  it('keeps a blank conversation that holds an unsent draft', async () => {
    useChatStore.setState({
      conversations: [conversation('kept'), conversation('drafted'), conversation('extra')],
      currentConversationId: 'kept',
      inputDrafts: { drafted: '写了一半的话' },
    } as never);
    withMessages();

    const id = await useChatStore.getState().createConversation('新对话 16:00', 'model-x');

    expect(id).toBe('kept');
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['kept', 'drafted', 'extra']);
    expect(db.deleteConversation).not.toHaveBeenCalled();
  });

  it('creates in the requested directory without reusing another workspace’s blank chat', async () => {
    useChatStore.setState({ conversations: [conversation('default')], currentConversationId: 'default' });
    withMessages();
    const attachments = useConversationAttachmentStore.getState();
    attachments.registerWorkspace('/test/workspace');
    expect(attachments.getMountedDir('default')).toBeUndefined();

    const id = await useChatStore.getState().createConversation('Project', 'model-x', undefined, '/test/workspace');
    expect(id).not.toBe('default');
    expect(attachments.getMountedDir(id)).toBe('/test/workspace');
    expect(attachments.getWorkingDir(id)).toBe('/test/workspace');
    expect(await useChatStore.getState().createConversation('Reuse', 'model-x')).toBe(id);
    expect(attachments.getWorkingDir(id)).toBe('/test/workspace');
    expect(await useChatStore.getState().createConversation('Default', 'model-x', undefined, null)).toBe('default');
    expect(attachments.getWorkingDir('default')).not.toBe('/test/workspace');
    expect(db.deleteConversation).not.toHaveBeenCalled();
  });

  it('does not reuse an archived blank conversation', async () => {
    useChatStore.setState({ conversations: [conversation('archived')] });
    useConversationAttachmentStore.getState().archiveConversation('archived', true);
    withMessages();
    const id = await useChatStore.getState().createConversation('New', 'model-x');
    expect(id).not.toBe('archived');
    expect(db.deleteConversation).not.toHaveBeenCalled();
  });

  it('falls back to Default when global creation would inherit an archived workspace', async () => {
    const path = '/test/archived';
    useChatStore.setState({ conversations: [conversation('project'), conversation('default')], currentConversationId: 'project' });
    const attachments = useConversationAttachmentStore.getState();
    attachments.setMountedDir('project', path);
    attachments.archiveWorkspace(path, true);
    withMessages();

    const create = useChatStore.getState().createConversation;
    await expect(create('Project', 'model-x', undefined, path)).rejects.toThrow('Restore the workspace');
    expect(await create('New', 'model-x')).toBe('default');
    expect(attachments.getMountedDir('project')).toBe(path);
    expect(db.createConversation).not.toHaveBeenCalled();
    expect(db.deleteConversation).not.toHaveBeenCalled();
  });

  it('retains the conversation and its workspace when deletion cannot be written', async () => {
    useChatStore.setState({ conversations: [conversation('keep')], currentConversationId: 'keep' });
    const attachments = useConversationAttachmentStore.getState();
    attachments.setMountedDir('keep', '/test/workspace');
    db.deleteConversation.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(useChatStore.getState().deleteConversation('keep')).rejects.toThrow('database unavailable');
    expect(useChatStore.getState().currentConversationId).toBe('keep');
    expect(useChatStore.getState().conversations.map((chat) => chat.id)).toEqual(['keep']);
    expect(attachments.getMountedDir('keep')).toBe('/test/workspace');
  });

  it('falls back to creating when the emptiness check fails', async () => {
    useChatStore.setState({ conversations: [conversation('a')] } as never);
    db.select.mockRejectedValue(new Error('database unavailable'));

    const id = await useChatStore.getState().createConversation('新对话 16:00', 'model-x');

    expect(id).not.toBe('a');
    expect(db.createConversation).toHaveBeenCalledTimes(1);
  });
});
