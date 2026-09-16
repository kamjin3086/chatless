import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ContentEventHandler } from '../handlers/ContentEventHandler';
import { createTestContext, createContentTokenEvent, mockChatStore } from './test-utils';
import { useChatStore } from '@/store/chatStore';

vi.mock('@/store/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(),
  },
}));

describe('Inline thinking parsing (content_token)', () => {
  let handler: ContentEventHandler;
  let store: ReturnType<typeof mockChatStore>;

  beforeEach(() => {
    handler = new ContentEventHandler();
    store = mockChatStore();
    vi.mocked(useChatStore.getState).mockReturnValue(store.getState() as never);
  });

  afterEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('should convert <think>...</think> into THINK_* actions and not leak tags into TOKEN_APPEND', () => {
    const context = createTestContext({ hasProviderThinking: false });
    handler.handle(createContentTokenEvent('Hello <think>ABC</think>'), context);
    handler.handle(createContentTokenEvent(' World'), context);

    const actions = store.getActions().map((a) => a.action);
    const types = actions.map((a) => a.type);
    expect(types).toContain('THINK_START');
    expect(types).toContain('THINK_APPEND');
    expect(types).toContain('THINK_END');

    const tokenAppends = actions.filter((a) => a.type === 'TOKEN_APPEND').map((a) => String(a.chunk || ''));
    const combined = tokenAppends.join('');
    expect(combined).toContain('Hello ');
    expect(combined).toContain(' World');
    expect(combined).not.toContain('<think>');
    expect(combined).not.toContain('</think>');
  });

  it('should not run inline think parsing when provider thinking events are present', () => {
    const context = createTestContext({ hasProviderThinking: true });
    handler.handle(createContentTokenEvent('X <think>Y</think> Z'), context);
    const actions = store.getActions().map((a) => a.action);
    expect(actions.some((a) => a.type === 'THINK_START')).toBe(false);
    expect(actions.some((a) => a.type === 'THINK_END')).toBe(false);
    const combined = actions.filter((a) => a.type === 'TOKEN_APPEND').map((a) => String(a.chunk || '')).join('');
    expect(combined).toContain('<think>');
  });
});
