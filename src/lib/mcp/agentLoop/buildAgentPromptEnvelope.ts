import type { Message as LlmMessage } from '@/lib/llm/types';
import type { ToolDefinition } from '@/lib/llm/types/tool-schema';
import { PromptEnvelopeBuilder } from '@/lib/mcp/pipeline/context/PromptEnvelopeBuilder';
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
  const systemTexts = (injection.systemMessages || [])
    .map((m) => String(m.content || '').trim())
    .filter(Boolean);

  return envelopeBuilder.build({
    environmentContext: systemTexts.join('\n\n'),
    tools: (injection.nativeTools || []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as ToolDefinition['parameters'],
    })),
  });
}

/**
 * Remove system messages whose content is already represented in the envelope prefix
 * (e.g. time duplicated by MCP inject). Keeps user custom prompts.
 */
export function dedupeEnvelopeSystemPrefix(
  messages: LlmMessage[],
  envelopePrefix: LlmMessage[],
): LlmMessage[] {
  const envBlob = envelopePrefix
    .map((m) => String(m.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
  if (!envBlob) return messages;
  return messages.filter((m) => {
    if (m.role !== 'system') return true;
    const c = String(m.content || '').trim();
    if (!c) return false;
    return !envBlob.includes(c);
  });
}

/** @deprecated use dedupeEnvelopeSystemPrefix */
export function stripLeadingSystemForEnvelope(messages: LlmMessage[]): LlmMessage[] {
  let idx = 0;
  while (idx < messages.length && messages[idx]?.role === 'system') {
    idx += 1;
  }
  return messages.slice(idx);
}
