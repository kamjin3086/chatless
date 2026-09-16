/**
 * ContentEventHandler 单元测试
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ContentEventHandler } from '../handlers/ContentEventHandler';
import {
  createTestContext,
  createContentTokenEvent,
  createThinkingStartEvent,
  mockChatStore,
} from './test-utils';
import { useChatStore } from '@/store/chatStore';

vi.mock('@/store/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(),
  },
}));

describe('ContentEventHandler', () => {
  let handler: ContentEventHandler;
  let store: ReturnType<typeof mockChatStore>;

  beforeEach(() => {
    handler = new ContentEventHandler();
    store = mockChatStore();
    vi.mocked(useChatStore.getState).mockReturnValue(store.getState() as never);
  });

  afterEach(() => {
    store.clear();
  });

  describe('canHandle', () => {
    it('should handle content_token event', () => {
      const event = createContentTokenEvent('内容');
      expect(handler.canHandle(event)).toBe(true);
    });

    it('should not handle thinking_start event', () => {
      const event = createThinkingStartEvent();
      expect(handler.canHandle(event)).toBe(false);
    });
  });

  describe('handle content_token', () => {
    it('should accumulate content and dispatch TOKEN_APPEND action', () => {
      const context = createTestContext();
      const event = createContentTokenEvent('Hello');

      handler.handle(event, context);

      expect(context.content).toBe('Hello');

      const actions = store.getActions();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        messageId: 'test-msg-123',
        action: { type: 'TOKEN_APPEND', chunk: 'Hello' },
      });

      const contents = store.getContents();
      expect(contents['test-msg-123']).toBe('Hello');
    });

    it('should accumulate content over multiple tokens', () => {
      const context = createTestContext();

      handler.handle(createContentTokenEvent('Hello'), context);
      handler.handle(createContentTokenEvent(' '), context);
      handler.handle(createContentTokenEvent('World'), context);

      expect(context.content).toBe('Hello World');

      const actions = store.getActions();
      expect(actions).toHaveLength(3);

      const contents = store.getContents();
      expect(contents['test-msg-123']).toBe('Hello World');
    });

    it('should not dispatch action if content is empty', () => {
      const context = createTestContext();
      const event = createContentTokenEvent('');

      handler.handle(event, context);

      expect(context.content).toBe('');
      const actions = store.getActions();
      expect(actions).toHaveLength(0);
    });

    it('should handle non-string content by converting to string', () => {
      const context = createTestContext();
      const event = { ...(createContentTokenEvent('') as any), content: 123 } as any;
      handler.handle(event as any, context);

      expect(context.content).toBe('123');
      const actions = store.getActions();
      expect(actions).toHaveLength(1);
    });
  });

  describe('streaming simulation', () => {
    it('should handle realistic streaming flow', () => {
      const context = createTestContext();
      const tokens = ['你', '好', '，', '世', '界', '！'];

      tokens.forEach((token) => {
        handler.handle(createContentTokenEvent(token), context);
      });

      expect(context.content).toBe('你好，世界！');

      const actions = store.getActions();
      expect(actions).toHaveLength(6);
      expect(actions.every((a) => a.action.type === 'TOKEN_APPEND')).toBe(true);
    });
  });
});
