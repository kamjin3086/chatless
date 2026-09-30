import { getToolCallStrategy, shouldUseNativeToolCalls } from '@/lib/llm/types/tool-capability';
import type { RenderMode } from '@/lib/mcp/pipeline/context/ConversationEventLog';

export type AgentToolCapability = {
  useNativeTools: boolean;
  renderMode: RenderMode;
  strategy: ReturnType<typeof getToolCallStrategy>;
};

/**
 * Thin capability layer for Agent loop: degrade when provider/model lacks native tools.
 */
export function resolveAgentToolCapability(provider: string, model: string): AgentToolCapability {
  const useNativeTools = shouldUseNativeToolCalls(provider, model);
  const strategy = getToolCallStrategy(provider, model);
  return {
    useNativeTools,
    renderMode: useNativeTools ? 'tool_role' : 'text_wrapper',
    strategy,
  };
}
