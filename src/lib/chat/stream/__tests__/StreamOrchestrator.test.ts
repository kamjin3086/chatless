/**
 * StreamOrchestrator 集成测试
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { StreamOrchestrator } from '../StreamOrchestrator';
import type { StreamOrchestratorConfig } from '../types';
import {
  createThinkingStartEvent,
  createThinkingTokenEvent,
  createThinkingEndEvent,
  createContentTokenEvent,
  mockChatStore,
} from './test-utils';
import { useChatStore } from '@/store/chatStore';

vi.mock('@/store/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/lib/chat/tool-call-cleanup', () => ({
  cleanToolCallInstructions: vi.fn((text: string) => text),
  cleanToolCallInstructionsForDisplay: vi.fn((text: string) => text),
  extractToolCallFromText: vi.fn(() => null),
  createToolCardMarker: vi.fn(() => '{"__tool_call_card__":{}}'),
}));

describe('StreamOrchestrator', () => {
  let store: ReturnType<typeof mockChatStore>;
  let config: StreamOrchestratorConfig;

  beforeEach(() => {
    store = mockChatStore();
    vi.mocked(useChatStore.getState).mockReturnValue(store.getState() as never);

    config = {
      messageId: 'test-msg-123',
      conversationId: 'test-conv-456',
      provider: 'openai',
      model: 'gpt-4',
      originalUserContent: '测试问题',
      historyForLlm: [],
      skipTitleGeneration: true,
    };
  });

  afterEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  describe('createCallbacks', () => {
    it('should create valid stream callbacks', () => {
      const orchestrator = new StreamOrchestrator(config);
      const callbacks = orchestrator.createCallbacks();

      expect(callbacks).toHaveProperty('onStart');
      expect(callbacks).toHaveProperty('onEvent');
      expect(callbacks).toHaveProperty('onComplete');
      expect(callbacks).toHaveProperty('onError');
    });
  });

  describe('event handling', () => {
    it('should handle thinking events', async () => {
      const orchestrator = new StreamOrchestrator(config);
      const callbacks = orchestrator.createCallbacks();

      callbacks.onStart?.();
      await callbacks.onEvent!(createThinkingStartEvent());
      await callbacks.onEvent!(createThinkingTokenEvent('分析中...'));
      await callbacks.onEvent!(createThinkingEndEvent());

      const context = orchestrator.getContext();
      expect(context.fsmState).toBe('RENDERING_BODY');
      expect(context.thinkingStartTime).toBeGreaterThan(0);

      const actions = store.getActions();
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.map((a) => a.action.type)).toContain('THINK_START');
      expect(actions.map((a) => a.action.type)).toContain('THINK_END');
    });

    it('should handle content events', async () => {
      const orchestrator = new StreamOrchestrator(config);
      const callbacks = orchestrator.createCallbacks();

      callbacks.onStart?.();
      await callbacks.onEvent!(createContentTokenEvent('你好'));
      await callbacks.onEvent!(createContentTokenEvent('世界'));

      const context = orchestrator.getContext();
      expect(context.content).toBe('你好世界');

      const actions = store.getActions();
      expect(actions.filter((a) => a.action.type === 'TOKEN_APPEND')).toHaveLength(2);
    });
  });

  describe('complete flow', () => {
    it('should handle a complete thinking + content flow', async () => {
      const orchestrator = new StreamOrchestrator(config);
      const callbacks = orchestrator.createCallbacks();

      callbacks.onStart?.();

      await callbacks.onEvent!(createThinkingStartEvent());
      await callbacks.onEvent!(createThinkingTokenEvent('让我思考一下...'));
      await callbacks.onEvent!(createThinkingEndEvent());

      await callbacks.onEvent!(createContentTokenEvent('这是我的答案。'));

      await callbacks.onComplete!();

      const context = orchestrator.getContext();
      expect(context.content).toContain('这是我的答案');
      expect(context.fsmState).toBe('RENDERING_BODY');
      expect(context.thinkingStartTime).toBeGreaterThan(0);

      const actions = store.getActions();
      const actionTypes = actions.map((a) => a.action.type);
      expect(actionTypes).toContain('THINK_START');
      expect(actionTypes).toContain('THINK_END');
      expect(actionTypes).toContain('TOKEN_APPEND');
      expect(actionTypes).toContain('STREAM_END');
    });
  });

  describe('error handling', () => {
    it('should swallow handler errors without crashing the stream', async () => {
      const onError = vi.fn();
      const configWithError = { ...config, onError };
      const orchestrator = new StreamOrchestrator(configWithError);
      const callbacks = orchestrator.createCallbacks();

      vi.mocked(useChatStore.getState).mockReturnValue({
        dispatchMessageAction: () => {
          throw new Error('Test error');
        },
      } as never);

      callbacks.onStart?.();
      await callbacks.onEvent!(createThinkingStartEvent());

      // ThinkingEventHandler catches internally; stream should not throw
      expect(onError).not.toHaveBeenCalled();
    });

    it('should handle onComplete errors gracefully', async () => {
      const onError = vi.fn();
      const configWithError = { ...config, onError };
      const orchestrator = new StreamOrchestrator(configWithError);
      const callbacks = orchestrator.createCallbacks();

      vi.mocked(useChatStore.getState).mockReturnValue({
        ...store.getState(),
        updateMessage: vi.fn().mockRejectedValue(new Error('Update failed')),
      } as never);

      callbacks.onStart?.();
      await callbacks.onEvent!(createContentTokenEvent('test'));
      await callbacks.onComplete!();

      expect(onError).toHaveBeenCalled();
    });
  });

  describe('context access', () => {
    it('should provide read-only context', () => {
      const orchestrator = new StreamOrchestrator(config);
      const context1 = orchestrator.getContext();
      const context2 = orchestrator.getContext();

      expect(context1).not.toBe(context2);
      expect(context1.messageId).toBe(context2.messageId);
      expect(context1.conversationId).toBe(context2.conversationId);
    });
  });

  describe('UI update callback', () => {
    it('should call onUIUpdate callback after completion', async () => {
      const onUIUpdate = vi.fn();
      const configWithUI = { ...config, onUIUpdate };
      const orchestrator = new StreamOrchestrator(configWithUI);
      const callbacks = orchestrator.createCallbacks();

      callbacks.onStart?.();
      await callbacks.onEvent!(createContentTokenEvent('测试内容'));
      await callbacks.onComplete!();

      expect(onUIUpdate).toHaveBeenCalled();
    });
  });
});
