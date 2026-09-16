import { describe, expect, it, vi } from 'vitest';
import { AgentRunControlPlane } from '../AgentRunControlPlane';

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
