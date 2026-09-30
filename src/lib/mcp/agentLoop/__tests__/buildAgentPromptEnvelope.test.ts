import { describe, expect, it, vi } from 'vitest';
import { buildAgentPromptEnvelope } from '../buildAgentPromptEnvelope';
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
      return messages.length > 3 ? (messages as unknown[]).slice(-2) : messages;
    }
  },
}));

describe('buildAgentPromptEnvelope', () => {
  it('merges blocks into one system message, stable first, and sorts tools', () => {
    const envelope = buildAgentPromptEnvelope({
      systemMessages: [
        { id: 'current-time', layer: 'turn', order: 10, content: '当前时间：12:00' },
        { id: 'agent-contract', layer: 'stable', order: 10, content: '【契约】be truthful' },
        { id: 'session-workspace', layer: 'conversation', order: 20, content: '工作目录：D:/work' },
      ],
      useNativeTools: true,
      nativeTools: [
        { name: 'shell__run', description: 'run', parameters: { type: 'object', properties: {} } },
        { name: 'fs__read', description: 'read', parameters: { type: 'object', properties: {} } },
      ],
      enabledServers: [],
    });

    expect(envelope.prefixMessages).toHaveLength(1);
    const content = String(envelope.prefixMessages[0].content);
    // Stable, then conversation, then the per-turn block.
    expect(content.indexOf('【契约】')).toBeLessThan(content.indexOf('工作目录'));
    expect(content.indexOf('工作目录')).toBeLessThan(content.indexOf('当前时间'));
    expect(envelope.blocks.map((b) => b.id)).toEqual(['agent-contract', 'session-workspace', 'current-time']);
    expect(envelope.tools.map((t) => t.name)).toEqual(['fs__read', 'shell__run']);
  });

  it('keeps the cacheable prefix identical when only the turn block changes', () => {
    const base = {
      useNativeTools: true,
      nativeTools: [],
      enabledServers: [],
    } as const;
    const first = buildAgentPromptEnvelope({
      ...base,
      systemMessages: [
        { id: 'agent-contract', layer: 'stable', order: 10, content: 'contract' },
        { id: 'current-time', layer: 'turn', order: 10, content: '当前时间：12:00' },
      ],
    });
    const second = buildAgentPromptEnvelope({
      ...base,
      systemMessages: [
        { id: 'agent-contract', layer: 'stable', order: 10, content: 'contract' },
        { id: 'current-time', layer: 'turn', order: 10, content: '当前时间：12:01' },
      ],
    });

    expect(second.stableFingerprint).toBe(first.stableFingerprint);
    expect(second.fullFingerprint).not.toBe(first.fullFingerprint);
  });
});

describe('AgentRunControlPlane.assembleRoundMessages', () => {
  it('keeps prefix messages when compacting variable suffix', async () => {
    const plane = new AgentRunControlPlane('run-a', 'conv-a', 'msg-a');
    await plane.start();
    await plane.record({ type: 'user_message', content: 'u-run' });

    const prefix = [
      { role: 'system', content: 'prefix-1' },
      { role: 'system', content: 'prefix-2' },
    ] as any[];
    const base = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ] as any[];

    const assembled = await plane.assembleRoundMessages({
      prefixMessages: prefix,
      baseHistory: base,
      renderMode: 'text_wrapper',
      provider: 'openai',
      model: 'gpt-4',
    });

    expect(assembled[0]).toEqual(prefix[0]);
    expect(assembled[1]).toEqual(prefix[1]);
    expect(assembled.length).toBeGreaterThan(2);
    expect(assembled.length).toBeLessThan(prefix.length + base.length + 2);
  });
});
