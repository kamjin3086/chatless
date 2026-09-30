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
    // The extra blank shells are gone; the one with messages is untouched.
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['newest', 'chatted']);
    expect(db.deleteConversation).toHaveBeenCalledWith('older');
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
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['kept', 'drafted']);
    expect(db.deleteConversation).toHaveBeenCalledWith('extra');
  });

  it('falls back to creating when the emptiness check fails', async () => {
    useChatStore.setState({ conversations: [conversation('a')] } as never);
    db.select.mockRejectedValue(new Error('database unavailable'));

    const id = await useChatStore.getState().createConversation('新对话 16:00', 'model-x');

    expect(id).not.toBe('a');
    expect(db.createConversation).toHaveBeenCalledTimes(1);
  });
});
