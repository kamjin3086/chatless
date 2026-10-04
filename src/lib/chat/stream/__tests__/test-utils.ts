import { createStreamEvent } from '@/lib/llm/types/stream-events';
import type { StreamContext, StreamOrchestratorConfig } from '../types';

type RecordedAction = {
  messageId: string;
  action: { type: string; chunk?: string; timestamp?: number };
};

export function mockChatStore(conversationId = 'test-conv-456', messageId = 'test-msg-123') {
  const actions: RecordedAction[] = [];
  const contents: Record<string, string> = { [messageId]: '' };
  let updateCalls = 0;

  const state = {
    conversations: [
      {
        id: conversationId,
        messages: [{ id: messageId, content: '' }],
      },
    ],
    dispatchMessageAction: (msgId: string, action: RecordedAction['action']) => {
      actions.push({ messageId: msgId, action });
    },
    updateMessageContentInMemory: (msgId: string, content: string) => {
      contents[msgId] = content;
      const conv = state.conversations.find((c) => c.id === conversationId);
      const msg = conv?.messages.find((m) => m.id === msgId);
      if (msg) msg.content = content;
    },
    // 流式正文的落盘入口（store + DB）。计数用于验收"每 chunk 不再写一次 store"。
    updateMessage: async (msgId: string, patch: { content?: string }) => {
      updateCalls += 1;
      if (typeof patch?.content === 'string') {
        contents[msgId] = patch.content;
        const conv = state.conversations.find((c) => c.id === conversationId);
        const msg = conv?.messages.find((m) => m.id === msgId);
        if (msg) msg.content = patch.content;
      }
    },
    deleteMessage: async () => {},
    setInputDraft: () => {},
  };

  return {
    getState: () => state,
    getActions: () => [...actions],
    getContents: () => ({ ...contents }),
    getUpdateCalls: () => updateCalls,
    clear: () => {
      actions.length = 0;
      updateCalls = 0;
      for (const key of Object.keys(contents)) delete contents[key];
    },
  };
}

export function createTestContext(overrides: Partial<StreamContext> = {}): StreamContext {
  return {
    messageId: 'test-msg-123',
    conversationId: 'test-conv-456',
    content: '',
    toolStarted: false,
    thinkingStartTime: 0,
    fsmState: 'RENDERING_BODY',
    metadata: {
      provider: 'openai',
      model: 'gpt-4',
      originalUserContent: '测试问题',
      historyForLlm: [],
    },
    ...overrides,
  };
}

export function createStreamOrchestratorConfig(
  overrides: Partial<StreamOrchestratorConfig> = {},
): StreamOrchestratorConfig {
  return {
    messageId: 'test-msg-123',
    conversationId: 'test-conv-456',
    provider: 'openai',
    model: 'gpt-4',
    originalUserContent: '测试问题',
    historyForLlm: [],
    ...overrides,
  };
}

export const createThinkingStartEvent = createStreamEvent.thinkingStart;
export const createThinkingTokenEvent = createStreamEvent.thinkingToken;
export const createThinkingEndEvent = createStreamEvent.thinkingEnd;
export const createContentTokenEvent = createStreamEvent.contentToken;
