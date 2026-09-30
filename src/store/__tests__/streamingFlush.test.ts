/**
 * 流式写入的回归门槛。
 *
 * 背景：会话列表项（ConversationItem）的 memo 比较 updated_at，聊天页与侧边栏又都
 * 订阅 conversations。流式期间只要每帧改 updated_at 或每 chunk 写一次 store，
 * 整棵树就会跟着重渲染。这里固定住三条规则：
 *   1. 流式 flush 不更新会话 updated_at；
 *   2. STREAM_END 才更新一次；
 *   3. segments 仍然按帧写入（UI 的渲染依据）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  // node 环境没有 rAF：用 setTimeout 模拟一帧。
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
});

vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({ select: async () => [] }),
      getConversationRepository: () => ({}),
      getMessageRepository: () => ({ update: async () => {} }),
      isInitialized: () => false,
    }),
  },
}));

import { useChatStore } from '../chatStore';

const CONVERSATION = 'conv-stream';
const MESSAGE = 'msg-stream';

function seed() {
  useChatStore.setState({
    conversations: [{
      id: CONVERSATION,
      title: '流式测试',
      created_at: 1,
      updated_at: 111,
      messages: [{
        id: MESSAGE,
        conversation_id: CONVERSATION,
        role: 'assistant',
        content: '',
        created_at: 1,
        updated_at: 1,
        status: 'loading',
        segments: [],
      }],
    }],
    currentConversationId: CONVERSATION,
    _messagesLoaded: { [CONVERSATION]: true },
  } as never);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function conversationUpdatedAt(): number {
  return Number(useChatStore.getState().conversations[0]?.updated_at);
}

function currentSegments(): any[] {
  return (useChatStore.getState().conversations[0]?.messages?.[0] as any)?.segments || [];
}

beforeEach(() => {
  seed();
});

describe('streaming store writes', () => {
  it('writes segments per flush but leaves updated_at alone until the stream ends', async () => {
    const store = useChatStore.getState();

    store.dispatchMessageAction(MESSAGE, { type: 'TOKEN_APPEND', chunk: '你好' } as never);
    await flush();
    expect(currentSegments().map((s: any) => s.text).join('')).toContain('你好');
    expect(conversationUpdatedAt()).toBe(111);

    useChatStore.getState().dispatchMessageAction(MESSAGE, { type: 'TOKEN_APPEND', chunk: '，世界' } as never);
    await flush();
    expect(currentSegments().map((s: any) => s.text).join('')).toContain('，世界');
    expect(conversationUpdatedAt()).toBe(111);
  });

  it('updates updated_at once when the stream ends', async () => {
    const store = useChatStore.getState();
    store.dispatchMessageAction(MESSAGE, { type: 'STREAM_END' } as never);
    await flush();

    expect(conversationUpdatedAt()).not.toBe(111);
  });
});
