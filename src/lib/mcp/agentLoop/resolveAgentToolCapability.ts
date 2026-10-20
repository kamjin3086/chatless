import { getToolCallStrategy, resolveToolTrack, type ToolTrack } from '@/lib/llm/types/tool-capability';
import type { RenderMode } from '@/lib/mcp/pipeline/context/ConversationEventLog';

export type AgentToolCapability = {
  /** Which channel this run uses; the only value the prompt composer and the stream read. */
  track: ToolTrack;
  useNativeTools: boolean;
  renderMode: RenderMode;
  strategy: ReturnType<typeof getToolCallStrategy>;
};

/**
 * Thin capability layer for Agent loop: degrade when provider/model lacks native tools.
 */
export function resolveAgentToolCapability(provider: string, model: string): AgentToolCapability {
  const track = resolveToolTrack(provider, model);
  const strategy = getToolCallStrategy(provider, model);
  return {
    track,
    useNativeTools: track === 'native',
    renderMode: track === 'native' ? 'tool_role' : 'text_wrapper',
    strategy,
  };
}
