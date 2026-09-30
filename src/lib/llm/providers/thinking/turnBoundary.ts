/**
 * Streaming guard for chat-template turn boundaries.
 *
 * See `@/lib/llm/chatTemplateTokens` for why this exists. The guard is applied
 * to every `ThinkingModeStrategy` by the factory, so it covers all providers
 * without touching individual stream parsers:
 *
 *   - text before the first end-of-turn token is passed through;
 *   - the boundary token itself and everything after it is dropped, so a model
 *     that invents the next turns of the conversation can no longer have that
 *     invented turn rendered as the answer;
 *   - tokens are matched across chunk boundaries (`<|im_` + `end|>`).
 *
 * The guard never rewrites what it forwards beyond stripping stray template
 * tokens, and it only ever drops text *after* a turn boundary.
 */

import type { ThinkingModeStrategy, ThinkingToken, ProcessedOutput } from './types';
import {
  ALL_TEMPLATE_TOKENS,
  STRIP_ONLY_TOKENS,
  TURN_END_TOKENS,
  TURN_OPEN_TOKENS,
  stripTemplateTokens,
} from '@/lib/llm/chatTemplateTokens';

/** Tokens that end the turn, plus the turn-opening ones that mean "moved on". */
const TERMINATOR_TOKENS = [...TURN_END_TOKENS, ...TURN_OPEN_TOKENS];

/** Longest token; a tail shorter than this can still be a token prefix. */
const MAX_TOKEN_LENGTH = Math.max(...ALL_TEMPLATE_TOKENS.map((token) => token.length));

export interface TurnBoundaryGuard {
  /** True once a turn boundary was seen; nothing after it is forwarded. */
  readonly ended: boolean;
  /** Characters discarded from the boundary token onwards, for diagnostics. */
  readonly droppedChars: number;
  /** Filter one provider token. Always keeps `done` and the object identity shape. */
  filterToken(token: ThinkingToken): ThinkingToken;
  reset(): void;
}

/**
 * Earliest terminator in `text`, preferring the longest match at the earliest
 * position so `<|im_end|>` wins over a hypothetical shorter prefix of itself.
 */
export function findEarliestTerminator(
  text: string,
  includeTurnOpen: boolean,
): { index: number; token: string } | null {
  const tokens = includeTurnOpen ? TERMINATOR_TOKENS : TURN_END_TOKENS;
  let best: { index: number; token: string } | null = null;
  for (const token of tokens) {
    const index = text.indexOf(token);
    if (index === -1) continue;
    if (!best || index < best.index || (index === best.index && token.length > best.token.length)) {
      best = { index, token };
    }
  }
  return best;
}

/**
 * Index from which `text` must be held back because it might still turn into a
 * token once the next chunk arrives. A complete strip-only token is held too,
 * so a role word that follows it in the next chunk is removed with it.
 */
export function holdBackFrom(text: string): number {
  for (const token of STRIP_ONLY_TOKENS) {
    if (text.endsWith(token)) return text.length - token.length;
  }
  const max = Math.min(MAX_TOKEN_LENGTH - 1, text.length);
  for (let length = 1; length <= max; length += 1) {
    const tail = text.slice(text.length - length);
    if (ALL_TEMPLATE_TOKENS.some((token) => token.startsWith(tail))) return text.length - length;
  }
  return text.length;
}

export function createTurnBoundaryGuard(): TurnBoundaryGuard {
  let pending = '';
  let ended = false;
  let droppedChars = 0;
  let sawText = false;

  const push = (text: string): string => {
    if (!text) return '';
    if (ended) {
      droppedChars += text.length;
      return '';
    }

    pending += text;

    // A turn-opening token only ends the turn once something was already
    // forwarded; a leading `<|im_start|>assistant` is template noise.
    const candidate = findEarliestTerminator(pending, true);
    let boundary = candidate;
    if (candidate && (TURN_OPEN_TOKENS as readonly string[]).includes(candidate.token)) {
      const before = pending.slice(0, candidate.index);
      if (!sawText && !before.trim()) boundary = null;
    }
    let body: string;
    if (boundary) {
      body = pending.slice(0, boundary.index);
      droppedChars += pending.length - boundary.index;
      pending = '';
      ended = true;
    } else {
      const cut = holdBackFrom(pending);
      body = pending.slice(0, cut);
      pending = pending.slice(cut);
    }

    const clean = stripTemplateTokens(body);
    if (clean.trim()) sawText = true;
    return clean;
  };

  return {
    get ended() {
      return ended;
    },
    get droppedChars() {
      return droppedChars;
    },
    filterToken(token: ThinkingToken): ThinkingToken {
      const next: ThinkingToken = { ...token };
      if (typeof next.thinking === 'string') next.thinking = push(next.thinking);
      if (typeof next.reasoning_content === 'string') next.reasoning_content = push(next.reasoning_content);
      if (typeof next.content === 'string') next.content = push(next.content);
      return next;
    },
    reset() {
      pending = '';
      ended = false;
      droppedChars = 0;
      sawText = false;
    },
  };
}

/**
 * Wraps a strategy so every provider gets the guard, including the strategies
 * that override `processToken` (standard / ollama) and the ones that do not.
 */
export function guardTurnBoundaries(inner: ThinkingModeStrategy): ThinkingModeStrategy {
  const guard = createTurnBoundaryGuard();

  return {
    processToken(token: ThinkingToken): ProcessedOutput {
      if (guard.ended) {
        // The turn is over. Drop the delta, but still let the inner strategy
        // close its own state (thinking_end / stream_complete) on `done`.
        const out = token.done ? inner.processToken({ done: true }) : { events: [], isComplete: false };
        return { ...out, turnEnded: true, turnEndDroppedChars: guard.droppedChars };
      }

      const out = inner.processToken(guard.filterToken(token));
      return guard.ended
        ? { ...out, turnEnded: true, turnEndDroppedChars: guard.droppedChars }
        : out;
    },
    reset(): void {
      guard.reset();
      inner.reset();
    },
  };
}
