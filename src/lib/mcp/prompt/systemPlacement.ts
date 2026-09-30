import type { Message as LlmMessage } from '@/lib/llm/types';

/**
 * Keep every request to exactly one leading system message.
 *
 * OpenAI-compatible endpoints (and the Qwen-style chat templates behind them)
 * only render a system message at the start of a conversation.  A system message
 * that lands after the first user/assistant turn makes the whole request fail —
 * the homelab gateway answers HTTP 400 with "message N has role 'system' after a
 * non-system turn".
 *
 * History assembly is spread across several modules (regeneration notes, history
 * summaries, compaction), so the invariant is enforced once, where the request is
 * finally put together: any later system text is merged into the leading system
 * message, preserving its content and order, instead of being sent in place.
 */
export function enforceSingleLeadingSystem(messages: LlmMessage[]): LlmMessage[] {
  const list = Array.isArray(messages) ? messages : [];
  const firstNonSystem = list.findIndex((message) => message?.role !== 'system');
  if (firstNonSystem < 0) {
    // All system (or empty): merge into one message.
    return mergeSystemMessages(list);
  }
  const strays = list
    .map((message, index) => ({ message, index }))
    .filter((entry) => entry.index > firstNonSystem && entry.message?.role === 'system');
  if (strays.length === 0) return list;

  const systemTexts = list
    .filter((message) => message?.role === 'system')
    .map((message) => String(message.content || '').trim())
    .filter(Boolean);
  const others = list.filter((message) => message?.role !== 'system');
  const merged: LlmMessage = { role: 'system', content: systemTexts.join('\n\n') };
  return [merged, ...others];
}

function mergeSystemMessages(list: LlmMessage[]): LlmMessage[] {
  if (list.length <= 1) return list;
  const content = list.map((message) => String(message.content || '').trim()).filter(Boolean).join('\n\n');
  return content ? [{ role: 'system', content }] : [];
}
