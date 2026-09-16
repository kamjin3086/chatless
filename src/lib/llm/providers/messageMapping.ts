import type { LlmMessage } from './BaseProvider';

/** Preserve provider-specific fields when replaying an assistant/tool turn. */
export function toOpenAIMessage(message: LlmMessage): Record<string, unknown> {
  const source = message as LlmMessage & { providerData?: Record<string, unknown>; raw?: unknown };
  const raw = source.raw && typeof source.raw === 'object' ? source.raw as Record<string, unknown> : {};
  const mapped: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.images?.length) {
    mapped.content = [
      { type: 'text', text: message.content },
      ...message.images.map((url) => ({ type: 'image_url', image_url: { url } })),
    ];
  }
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
    }));
  }
  return mapped;
}

/** Map display roles and tool results to Gemini's content/part protocol. */
export function toGeminiContent(message: LlmMessage): { role: string; parts: Record<string, unknown>[] } {
  if (message.role === 'tool') {
    let value: unknown = message.content;
    try { value = JSON.parse(message.content); } catch { /* Plain text tool output. */ }
    const response = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : { result: value };
    return { role: 'user', parts: [{ functionResponse: { name: message.name, response } }] };
  }
  const parts: Record<string, unknown>[] = message.content ? [{ text: message.content }] : [];
  for (const image of message.images || []) {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(image);
    if (!match) throw new Error('Gemini image input must be a base64 data URL');
    parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  }
  for (const call of message.tool_calls || []) {
    const signature = (call.providerData as Record<string, unknown> | undefined)?.thoughtSignature;
    parts.push({
      functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments) },
      ...(signature ? { thoughtSignature: signature } : {}),
    });
  }
  return { role: message.role === 'assistant' ? 'model' : 'user', parts };
}
