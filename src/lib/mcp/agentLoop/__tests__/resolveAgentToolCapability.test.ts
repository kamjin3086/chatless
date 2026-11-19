/**
 * The thin layer over the track (#162): it turns one track value into the two things the agent
 * loop reads - whether the request carries tools, and how a tool call is rendered.
 *
 * The table itself is asserted in `capabilityTrack.test.ts`; this file only checks the mapping,
 * so it stubs the track and cannot pass by agreeing with the table.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveAgentToolCapability } from '../resolveAgentToolCapability';

const track = { value: 'native' as 'native' | 'prompt' | 'disabled' };

vi.mock('@/lib/llm/types/tool-capability', () => ({
  resolveToolTrack: vi.fn(() => track.value),
  getToolCallStrategy: vi.fn(() => ({
    useNative: track.value === 'native',
    usePromptInjection: track.value === 'prompt',
    maxTools: 0,
    parallelToolCalls: false,
    streamingToolCalls: false,
  })),
}));

describe('resolveAgentToolCapability', () => {
  it('native: request tools, render in the tool role', () => {
    track.value = 'native';
    const cap = resolveAgentToolCapability('openai', 'gpt-4');
    expect(cap.track).toBe('native');
    expect(cap.useNativeTools).toBe(true);
    expect(cap.renderMode).toBe('tool_role');
    expect(cap.strategy.useNative).toBe(true);
  });

  it('prompt: no request tools, render as a text wrapper', () => {
    track.value = 'prompt';
    const cap = resolveAgentToolCapability('ollama', 'llama3');
    expect(cap.track).toBe('prompt');
    expect(cap.useNativeTools).toBe(false);
    expect(cap.renderMode).toBe('text_wrapper');
    expect(cap.strategy.usePromptInjection).toBe(true);
  });

  it('disabled: no request tools, and no prompt channel either', () => {
    track.value = 'disabled';
    const cap = resolveAgentToolCapability('openai', 'gpt-4');
    expect(cap.track).toBe('disabled');
    expect(cap.useNativeTools).toBe(false);
    expect(cap.strategy.usePromptInjection).toBe(false);
  });
});
