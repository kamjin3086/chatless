import { ContentEventHandler } from '../handlers/ContentEventHandler';
import { createTestContext, createContentTokenEvent, mockChatStore } from './test-utils';

jest.mock('@/store/chatStore', () => ({
  useChatStore: {
    getState: jest.fn(),
  },
}));

describe('Inline thinking parsing (content_token)', () => {
  let handler: ContentEventHandler;
  let store: ReturnType<typeof mockChatStore>;

  beforeEach(() => {
    handler = new ContentEventHandler();
    store = mockChatStore();
    const { useChatStore } = require('@/store/chatStore');
    useChatStore.getState.mockReturnValue(store.getState());
  });

  afterEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  it('should convert <think>...</think> into THINK_* actions and not leak tags into TOKEN_APPEND', () => {
    const context = createTestContext({ hasProviderThinking: false });
    handler.handle(createContentTokenEvent('Hello <think>ABC</think> World'), context);

    const actions = store.getActions().map((a) => a.action);
    const types = actions.map((a) => a.type);
    expect(types).toContain('THINK_START');
    expect(types).toContain('THINK_APPEND');
    expect(types).toContain('THINK_END');

    // TOKEN_APPEND 的 chunk 不应包含 <think> 标签
    const tokenAppends = actions.filter((a) => a.type === 'TOKEN_APPEND').map((a) => String(a.chunk || ''));
    const combined = tokenAppends.join('');
    expect(combined).toContain('Hello ');
    expect(combined).toContain(' World');
    expect(combined).not.toContain('<think>');
    expect(combined).not.toContain('</think>');
  });

  it('should parse GPT-OSS <|channel|>analysis ... <|channel|>final as thinking', () => {
    const context = createTestContext({ hasProviderThinking: false });
    handler.handle(createContentTokenEvent('A<|channel|>analysisTHINKING<|channel|>finalB'), context);
    const actions = store.getActions().map((a) => a.action);
    expect(actions.some((a) => a.type === 'THINK_START')).toBe(true);
    expect(actions.some((a) => a.type === 'THINK_END')).toBe(true);
    const tokenAppends = actions.filter((a) => a.type === 'TOKEN_APPEND').map((a) => String(a.chunk || '')).join('');
    expect(tokenAppends).toContain('A');
    expect(tokenAppends).toContain('B');
    expect(tokenAppends).not.toContain('<|channel|>analysis');
  });

  it('should not run inline think parsing when provider thinking events are present', () => {
    const context = createTestContext({ hasProviderThinking: true });
    handler.handle(createContentTokenEvent('X <think>Y</think> Z'), context);
    const actions = store.getActions().map((a) => a.action);
    // 不应产生 THINK_*，只应 TOKEN_APPEND
    expect(actions.some((a) => a.type === 'THINK_START')).toBe(false);
    expect(actions.some((a) => a.type === 'THINK_END')).toBe(false);
    const combined = actions.filter((a) => a.type === 'TOKEN_APPEND').map((a) => String(a.chunk || '')).join('');
    expect(combined).toContain('<think>');
  });
});




