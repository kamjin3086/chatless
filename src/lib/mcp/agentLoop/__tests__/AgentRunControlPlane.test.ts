import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunControlPlane } from '../AgentRunControlPlane';
import { AgentRunEventStore } from '../AgentRunEventStore';

vi.mock('../AgentRunEventStore', () => ({
  AgentRunEventStore: {
    ensureRun: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    loadEvents: vi.fn().mockResolvedValue([]),
    setRunStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/mcp/pipeline/context/ContextWindowManager', () => ({
  ContextWindowManager: class {
    async compact(messages: unknown[]) {
      return messages.length > 2 ? messages.slice(-2) : messages;
    }
  },
}));

describe('AgentRunControlPlane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AgentRunEventStore.appendEvent).mockResolvedValue(undefined);
  });

  it('serializes concurrent durable writes before exposing events', async () => {
    const plane = new AgentRunControlPlane('run', 'conv', 'msg');
    let release!: () => void;
    vi.mocked(AgentRunEventStore.appendEvent).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = plane.record({ type: 'user_message', content: 'one' });
    const second = plane.record({ type: 'user_message', content: 'two' });
    await vi.waitFor(() => expect(AgentRunEventStore.appendEvent).toHaveBeenCalledTimes(1));
    expect(plane.eventLog.snapshot()).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(vi.mocked(AgentRunEventStore.appendEvent).mock.calls.map(([p]) => p.seq)).toEqual([1, 2]);
    expect(plane.eventLog.snapshot()).toHaveLength(2);
  });

  it('keeps failed writes out of model context and prevents later writes hiding the gap', async () => {
    const plane = new AgentRunControlPlane('run', 'conv', 'msg');
    vi.mocked(AgentRunEventStore.appendEvent).mockRejectedValueOnce(new Error('disk full'));
    await expect(plane.record({ type: 'user_message', content: 'one' })).rejects.toThrow('disk full');
    await expect(plane.record({ type: 'user_message', content: 'two' })).rejects.toThrow('disk full');
    expect(plane.eventLog.snapshot()).toEqual([]);
    expect(AgentRunEventStore.appendEvent).toHaveBeenCalledOnce();
  });

  it('does not deduplicate intentional repeated user text across turns', async () => {
    const plane = new AgentRunControlPlane('run', 'conv', 'msg');
    await plane.record({ type: 'user_message', content: 'continue' });
    expect(plane.buildLlmMessages([{ role: 'user', content: 'continue' }])).toHaveLength(2);
  });
  it('projects tool rounds via renderForModel', async () => {
    const plane = new AgentRunControlPlane('run-1', 'conv-1', 'msg-1');
    await plane.start();
    await plane.record({ type: 'user_message', content: 'hello' });
    await plane.record({
      type: 'tool_call_requested',
      callId: 'c1',
      server: 'fs',
      tool: 'read',
      args: { path: '/tmp/a' },
    });
    await plane.record({
      type: 'tool_call_output',
      callId: 'c1',
      server: 'fs',
      tool: 'read',
      output: 'file content',
    });
    await plane.record({ type: 'assistant_message', content: 'done' });

    const projected = plane.buildLlmMessages([], 'text_wrapper');
    expect(projected.length).toBeGreaterThan(0);
    expect(projected.some((m) => m.role === 'user' && String(m.content).includes('hello'))).toBe(true);
    expect(projected.some((m) => String(m.content).includes('file content'))).toBe(true);
  });

  it('compacts projected messages', async () => {
    const plane = new AgentRunControlPlane('run-2', 'conv-2', 'msg-2');
    await plane.start();
    const base = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ] as any[];
    const compacted = await plane.compactHistory([...base, ...plane.buildLlmMessages([], 'text_wrapper')], 'openai', 'gpt-4');
    expect(compacted.length).toBeLessThanOrEqual(4);
  });

  it('records cancelled without loading semantics in projection', async () => {
    const plane = new AgentRunControlPlane('run-3', 'conv-3', 'msg-3');
    await plane.start();
    await plane.record({ type: 'user_message', content: 'do task' });
    await plane.recordCancelled();

    const projected = plane.buildLlmMessages([], 'text_wrapper');
    const text = projected.map((m) => String(m.content || '')).join('\n');
    expect(text).toContain('agent_run_cancelled');
    expect(text.toLowerCase()).not.toContain('loading');
  });
});
