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
  it('maps injection system messages to environment prefix and sorts tools', () => {
    const envelope = buildAgentPromptEnvelope({
      systemMessages: [{ role: 'system', content: '【权限】allow fs' }],
      useNativeTools: true,
      nativeTools: [
        { name: 'shell__run', description: 'run', parameters: { type: 'object', properties: {} } },
        { name: 'fs__read', description: 'read', parameters: { type: 'object', properties: {} } },
      ],
      enabledServers: [],
    });

    expect(envelope.prefixMessages).toHaveLength(1);
    expect(String(envelope.prefixMessages[0].content)).toContain('【权限】');
    expect(envelope.tools.map((t) => t.name)).toEqual(['fs__read', 'shell__run']);
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
