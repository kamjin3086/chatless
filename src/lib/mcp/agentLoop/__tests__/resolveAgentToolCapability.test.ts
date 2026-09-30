import { describe, expect, it, vi } from 'vitest';
import { resolveAgentToolCapability } from '../resolveAgentToolCapability';

vi.mock('@/lib/llm/types/tool-capability', () => ({
  shouldUseNativeToolCalls: vi.fn((provider: string) => provider !== 'ollama'),
  getToolCallStrategy: vi.fn((provider: string) => ({
    useNative: provider !== 'ollama',
    usePromptInjection: provider === 'ollama',
    maxTools: 0,
    parallelToolCalls: false,
    streamingToolCalls: false,
  })),
}));

describe('resolveAgentToolCapability', () => {
  it('uses tool_role + native tools for compatible providers', () => {
    const cap = resolveAgentToolCapability('openai', 'gpt-4');
    expect(cap.useNativeTools).toBe(true);
    expect(cap.renderMode).toBe('tool_role');
    expect(cap.strategy.useNative).toBe(true);
  });

  it('degrades to text_wrapper for ollama without native tools', () => {
    const cap = resolveAgentToolCapability('ollama', 'llama3');
    expect(cap.useNativeTools).toBe(false);
    expect(cap.renderMode).toBe('text_wrapper');
    expect(cap.strategy.usePromptInjection).toBe(true);
  });
});
