import type { LlmMessage } from './BaseProvider';

/** Preserve provider-specific fields when replaying an assistant/tool turn. */
export function toOpenAIMessage(message: LlmMessage): Record<string, unknown> {
  const source = message as LlmMessage & { providerData?: Record<string, unknown>; raw?: unknown };
  const raw = source.raw && typeof source.raw === 'object' ? source.raw as Record<string, unknown> : {};
  const mapped: Record<string, unknown> = { role: message.role, content: message.content };
  for (const key of ['reasoning_content', 'reasoning', 'thought_signature', 'thoughtSignature']) {
    const value = source.providerData?.[key] ?? raw[key];
    if (value !== undefined) mapped[key] = value;
  }
  if (message.role === 'tool') {
    if (message.tool_call_id) mapped.tool_call_id = message.tool_call_id;
    if (message.name) mapped.name = message.name;
  }
  if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    mapped.tool_calls = message.tool_calls.map((call) => ({
      id: call.id,
      type: call.type,
      function: { ...call.function },
      ...(call.providerData && typeof call.providerData === 'object' ? call.providerData : {}),
    }));
  }
  return mapped;
}

