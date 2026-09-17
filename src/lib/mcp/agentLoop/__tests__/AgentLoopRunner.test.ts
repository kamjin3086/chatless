import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamCallbacks, Message } from '@/lib/llm/types';
import { AgentLoopRunner } from '../AgentLoopRunner';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), execute: vi.fn(), append: vi.fn(), status: vi.fn(),
  store: { conversations: [], setAgentRunState: vi.fn(), updateMessage: vi.fn(), dispatchMessageAction: vi.fn() },
}));
vi.mock('@/lib/llm', () => ({ streamChat: mocks.stream, cancelStream: vi.fn(), chat: vi.fn() }));
vi.mock('@/lib/llm/ProviderRegistry', () => ({ ProviderRegistry: { get: () => ({ cancelStream: vi.fn() }) } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/mcp/pipeline', () => ({
  ToolInvocation: class { constructor(params: unknown) { Object.assign(this, params); } },
  ToolExecutionPipeline: class { run = mocks.execute; },
}));
vi.mock('@/lib/mcp/pipeline/adapters', () => ({ createDefaultAdapters: () => [] }));
vi.mock('@/lib/mcp/ToolCallCoordinator', () => ({ ToolCallCoordinator: { getInstance: () => ({
  isMessageCancelled: () => false, markToolCallComplete: vi.fn(),
}) } }));
vi.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => mocks.store } }));
vi.mock('@/store/toolLoadRequestStore', () => ({ useToolLoadRequestStore: { getState: () => ({ reset: vi.fn() }) } }));
vi.mock('@/lib/rag/CitationService', () => ({ applyCitations: vi.fn() }));
vi.mock('@/lib/rag/EvidenceRegistry', () => ({ listEvidence: () => [], clearEvidenceRegistry: vi.fn() }));
vi.mock('@/lib/mcp/promptInjector', () => ({ buildMcpSystemInjections: async () => ({ useNativeTools: true }) }));
vi.mock('../buildAgentPromptEnvelope', () => ({
  buildAgentPromptEnvelope: () => ({ prefixMessages: [], tools: [{ name: 'fs__write' }] }),
  dedupeEnvelopeSystemPrefix: (messages: Message[]) => messages,
}));
vi.mock('../resolveAgentToolCapability', () => ({ resolveAgentToolCapability: () => ({ useNativeTools: true, renderMode: 'tool_role' }) }));
vi.mock('../AgentRunEventStore', () => ({ AgentRunEventStore: {
  ensureRun: vi.fn(), loadEvents: async () => [], appendEvent: mocks.append, setRunStatus: mocks.status,
} }));
vi.mock('@/lib/chat/stream/StreamOrchestrator', () => ({ StreamOrchestrator: class {
  content = '';
  constructor(private config: any) {}
  getContext() { return { content: this.content }; }
  createCallbacks() {
    return {
      onEvent: async (event: any) => {
        await Promise.resolve(); // Exercise providers that do not await callbacks.
        if (event.type === 'tool_call') await this.config.onToolCall(event.request);
        if (event.type === 'content_token') this.content += event.content;
      },
      onComplete: vi.fn(), onError: this.config.onError,
    };
  }
} }));

const params = {
  assistantMessageId: 'run', conversationId: 'conversation', provider: 'test', model: 'model',
  historyForLlm: [{ role: 'user', content: 'write' }] as Message[], originalUserContent: 'write',
};
function tool(callbacks: StreamCallbacks, id: string, preResult?: unknown) {
  callbacks.onEvent?.({ type: 'tool_call', request: {
    server: 'fs', tool: 'write', callId: id, cardId: id, lockKey: id, args: { path: id }, preResult,
  } } as any);
}
function finish(callbacks: StreamCallbacks) { callbacks.onComplete?.(); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.append.mockResolvedValue(undefined);
  mocks.status.mockResolvedValue(undefined);
  mocks.store.updateMessage.mockResolvedValue(undefined);
  mocks.execute.mockResolvedValue({ ok: true });
  mocks.stream.mockImplementation(async (_p, _m, _history, cb) => finish(cb));
});

describe('AgentLoopRunner execution boundaries', () => {
  it('waits for complete callbacks even when the transport start returns early', async () => {
    let callbacks!: StreamCallbacks;
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => { callbacks = cb; tool(cb, 'a'); });
    const running = AgentLoopRunner.run(params);
    await vi.waitFor(() => expect(callbacks).toBeDefined());
    expect(mocks.execute).not.toHaveBeenCalled();
    finish(callbacks);
    await running;
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.append.mock.calls.findIndex(([p]) => p.event.type === 'tool_call_requested')).toBeGreaterThanOrEqual(0);
  });

  it('discards tool calls from a failed partial stream', async () => {
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => {
      tool(cb, 'a'); cb.onError(new Error('connection lost'));
    });
    await AgentLoopRunner.run(params);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenLastCalledWith('run', 'failed');
  });

  it('persists requests first and executes writes sequentially in call order', async () => {
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => {
      cb.onEvent({ type: 'content_token', content: 'I will write both.' });
      tool(cb, 'a'); tool(cb, 'b'); finish(cb);
    });
    let release!: () => void;
    mocks.execute.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
    const running = AgentLoopRunner.run(params);
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.append.mock.calls.filter(([p]) => p.event.type === 'tool_call_requested')).toHaveLength(2);
    release();
    await running;
    expect(mocks.execute.mock.calls.map(([p]) => p.callId)).toEqual(['a', 'b']);
    const history = mocks.stream.mock.calls[1][2] as Message[];
    expect(history.find((m) => m.tool_calls)?.content).toBe('I will write both.');
    expect(history.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['a', 'b']);
    const started = mocks.append.mock.calls.filter(([p]) => p.event.type === 'tool_call_started').map(([p]) => p.event.callId);
    expect(started).toEqual(['a', 'b']);
  });

  it('delivers steering before dispatching later calls from the completed response', async () => {
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => {
      tool(cb, 'a'); tool(cb, 'b'); finish(cb);
    });
    let release!: () => void;
    mocks.execute.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
    const running = AgentLoopRunner.run(params);
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    await expect(AgentLoopRunner.steer('run', 'do something else')).resolves.toBe(true);
    release();
    await running;

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const bOutput = mocks.append.mock.calls
      .map(([p]) => p.event)
      .find((event) => event.type === 'tool_call_output' && event.callId === 'b');
    expect(bOutput.output.error.code).toBe('NOT_DISPATCHED');
    const followUpHistory = mocks.stream.mock.calls[1][2] as Message[];
    const firstToolResult = followUpHistory.findIndex((message) => message.role === 'tool');
    const supplement = followUpHistory.findIndex((message) => message.role === 'user' && message.content === 'do something else');
    expect(firstToolResult).toBeGreaterThanOrEqual(0);
    expect(supplement).toBeGreaterThan(firstToolResult);
  });

  it('does not execute when persisting the request fails', async () => {
    mocks.append.mockRejectedValue(new Error('disk full'));
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => { tool(cb, 'a'); finish(cb); });
    await expect(AgentLoopRunner.run(params)).rejects.toThrow('disk full');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenLastCalledWith('run', 'failed');
  });

  it('stops dispatch when saving an executed result fails', async () => {
    mocks.append.mockImplementation(async ({ event }) => { if (event.type === 'tool_call_output') throw new Error('disk full'); });
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => { tool(cb, 'a'); tool(cb, 'b'); finish(cb); });
    await expect(AgentLoopRunner.run(params)).rejects.toThrow('disk full');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it('feeds argument errors back without executing and keeps current input once', async () => {
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => {
      tool(cb, 'a', { error: 'INVALID_ARGUMENTS' }); finish(cb);
    });
    await AgentLoopRunner.run(params);
    expect(mocks.execute).not.toHaveBeenCalled();
    const history = mocks.stream.mock.calls[1][2] as Message[];
    expect(history.filter((m) => m.role === 'user' && m.content === 'write')).toHaveLength(1);
    expect(history.find((m) => m.role === 'tool')?.content).toContain('INVALID_ARGUMENTS');
  });

  it('pauses on unknown side effects and records remaining calls as unexecuted', async () => {
    mocks.execute.mockResolvedValueOnce({ ok: false, resultStatus: 'unknown' });
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => { tool(cb, 'a'); tool(cb, 'b'); finish(cb); });
    await AgentLoopRunner.run(params);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.status).toHaveBeenLastCalledWith('run', 'paused');
    const outputs = mocks.append.mock.calls.filter(([p]) => p.event.type === 'tool_call_output').map(([p]) => p.event);
    expect(outputs).toHaveLength(2);
    expect(outputs[1].output.error.code).toBe('NOT_DISPATCHED');
  });

  it('propagates final status persistence failure and still releases the run', async () => {
    mocks.status.mockRejectedValueOnce(new Error('status write failed'));
    await expect(AgentLoopRunner.run(params)).rejects.toThrow('status write failed');
    await expect(AgentLoopRunner.run(params)).resolves.toBeUndefined();
  });

  it('does not expose tools while regenerating a prior answer', async () => {
    await AgentLoopRunner.run({ ...params, assistantMessageId: 'regenerate', regenerate: true });
    expect(mocks.stream.mock.calls[0][4]).toMatchObject({ toolChoice: 'none', __useNativeTools: false });
  });

  it('retains steering received during a final text response', async () => {
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => {
      await AgentLoopRunner.steer('run', 'write'); finish(cb);
    });
    await AgentLoopRunner.run(params);
    expect(mocks.stream.mock.calls[1][2].filter((m: Message) => m.role === 'user')).toHaveLength(2);
  });

  it('cancels a waiting stream without dispatching queued tools', async () => {
    let callbacks!: StreamCallbacks;
    mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => { callbacks = cb; tool(cb, 'a'); });
    const running = AgentLoopRunner.run(params);
    await vi.waitFor(() => expect(callbacks).toBeDefined());
    await expect(AgentLoopRunner.run({ ...params, assistantMessageId: 'other' })).rejects.toThrow('已有运行');
    AgentLoopRunner.cancel({ assistantMessageId: 'run' });
    await running;
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenLastCalledWith('run', 'cancelled');
  });
});
