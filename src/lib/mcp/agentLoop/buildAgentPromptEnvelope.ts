import type { ToolDefinition } from '@/lib/llm/types/tool-schema';
import { PromptEnvelopeBuilder } from '@/lib/mcp/pipeline/context/PromptEnvelopeBuilder';
import { composeSystemPrompt, type PromptBlock } from '@/lib/mcp/prompt/composition';
import type { InjectionResult } from '@/lib/mcp/promptInjector';

/**
 * Injection vs Envelope alignment (M2):
 *
 * | buildMcpSystemInjections     | PromptEnvelopeBuilder slot |
 * |------------------------------|----------------------------|
 * | systemMessages[] (merged)    | environmentContext (joined) |
 * | nativeTools[]                | tools (deterministic sort)  |
 * | useNativeTools flag          | handled by capability layer |
 *
 * Agent loop uses envelope prefix + tools; does NOT duplicate systemMessages in compact suffix.
 */

const envelopeBuilder = new PromptEnvelopeBuilder();

export function buildAgentPromptEnvelope(injection: InjectionResult) {
  const blocks: PromptBlock[] = (injection.systemMessages || [])
    .filter((block) => String(block?.content || '').trim())
    .map((block, index) => ({
      id: block.id || `block-${index}`,
      layer: block.layer || 'conversation',
      order: typeof block.order === 'number' ? block.order : index,
      content: String(block.content || '').trim(),
    }));

  const composed = composeSystemPrompt(blocks);
  const envelope = envelopeBuilder.build({
    systemMessage: composed.systemMessage,
    tools: (injection.nativeTools || []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as ToolDefinition['parameters'],
    })),
  });

  return {
    ...envelope,
    blocks: composed.blocks,
    stableFingerprint: composed.stableFingerprint,
    fullFingerprint: composed.fullFingerprint,
  };
}
