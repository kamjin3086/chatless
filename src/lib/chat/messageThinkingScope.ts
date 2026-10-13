/**
 * The pending "this message only" thinking choice.
 *
 * Deliberately memory-only and consumed by the send it applies to: a choice made for one
 * message must not survive into the next one, and anything persisted here would do exactly
 * that across reloads. Replacing a pending choice overwrites it - there is one next message.
 *
 * Keyed by conversation so a pending choice in one chat cannot shadow another.
 */
import type { ModelParameters } from '@/types/model-params';
import { readThinkingChoice } from '@/lib/chat/thinkingScope';

const pending = new Map<string, Partial<ModelParameters>>();
const listeners = new Map<string, Set<() => void>>();

function notify(conversationId: string): void {
  const set = listeners.get(conversationId);
  if (!set) return;
  for (const listener of [...set]) listener();
}

function copy(params: Partial<ModelParameters>): Partial<ModelParameters> {
  return { ...params };
}

/** Store a choice for the next message sent in this conversation. */
export function setMessageScope(
  conversationId: string,
  params: Partial<ModelParameters> | null,
): void {
  if (!params || readThinkingChoice(params) === 'inherit') {
    const had = pending.delete(conversationId);
    if (had) notify(conversationId);
    return;
  }
  pending.set(conversationId, copy(params));
  notify(conversationId);
}

/** What is waiting, without consuming it - what the control displays. */
export function peekMessageScope(
  conversationId: string,
): Partial<ModelParameters> | null {
  const found = pending.get(conversationId);
  return found ? copy(found) : null;
}

/** Consume it: the send that reads this is the message the choice was made for. */
export function takeMessageScope(
  conversationId: string,
): Partial<ModelParameters> | null {
  const found = pending.get(conversationId);
  if (!found) return null;
  pending.delete(conversationId);
  // The control shows what is pending, so consuming it quietly would leave a stale label.
  notify(conversationId);
  return copy(found);
}

/** Withdraw a pending choice, e.g. the user changed their mind before sending. */
export function clearMessageScope(conversationId: string): void {
  const had = pending.delete(conversationId);
  if (had) notify(conversationId);
}

/**
 * Watch one conversation's pending choice. The control displays it, so it has to hear when
 * it is set, withdrawn, or consumed by a send.
 */
export function subscribeMessageScope(
  conversationId: string,
  listener: () => void,
): () => void {
  let set = listeners.get(conversationId);
  if (!set) {
    set = new Set();
    listeners.set(conversationId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(conversationId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(conversationId);
  };
}
