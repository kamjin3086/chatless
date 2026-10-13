import {
  type ThinkingLevelAggregate,
  type ThinkingTurnRecord,
  aggregateThinkingTurns,
  mergeThinkingTurn,
} from '@/lib/llm/thinkingTelemetry';
/**
 * Storage for per-level thinking telemetry (#101).
 *
 * A bounded window of recent turns, kept in memory and mirrored to a JSON store so the
 * aggregate outlives the session - the comparison the ticket asks for spans conversations,
 * and an in-memory-only buffer would reset every time the app closes and quietly make the
 * numbers unrepresentative (only this session's model would ever show up).
 *
 * Nothing here may break a reply: storage errors are logged and swallowed, because losing a
 * statistic is not the same kind of failure as losing an answer.
 */
import { StorageUtil } from '@/lib/storage';

/**
 * How many turns this file keeps. That is a retention bound, not the comparison window:
 * the view asks for the last 20 (#101), and everything older is dropped here so a year of
 * chatting cannot grow this file without limit.
 */
export const THINKING_TURN_HISTORY = 200;

const STORE_FILE = 'thinking-telemetry.json';
const STORE_KEY = 'thinkingTurns';

let turns: ThinkingTurnRecord[] = [];
let loaded = false;
const listeners = new Set<(turns: readonly ThinkingTurnRecord[]) => void>();

function notify(): void {
  const snapshot = [...turns];
  // One listener throwing must not stop the others, and a view that throws must not turn
  // telemetry into a failed reply.
  for (const listener of [...listeners]) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('thinking telemetry listener failed', error);
    }
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const stored = await StorageUtil.getItem<ThinkingTurnRecord[]>(
      STORE_KEY,
      [],
      STORE_FILE,
    );
    if (Array.isArray(stored)) {
      // Merge, do not replace. A completion that landed while this read was in flight is not
      // in the snapshot, and overwriting here would drop it without a trace.
      const known = new Set(
        turns.map((t) => t.messageId).filter((id) => id !== undefined),
      );
      const fromDisk = stored.filter(
        (t) =>
          t &&
          typeof t === 'object' &&
          !(t.messageId !== undefined && known.has(t.messageId)),
      );
      const merged = [...fromDisk, ...turns].slice(-THINKING_TURN_HISTORY);
      if (merged.length !== turns.length) {
        turns = merged;
        notify();
      }
    }
  } catch (error) {
    console.error('reading thinking telemetry failed', error);
  }
}

async function persist(): Promise<void> {
  try {
    await StorageUtil.setItem(STORE_KEY, turns, STORE_FILE);
  } catch (error) {
    console.error('writing thinking telemetry failed', error);
  }
}

/** Append one completed turn and keep the window bounded. */
export async function recordThinkingTurn(
  turn: ThinkingTurnRecord,
): Promise<ThinkingTurnRecord> {
  await ensureLoaded();
  // Rounds of one answer share a message id; fold them so "this answer cost" is the answer,
  // not its last request.
  let index = -1;
  if (turn.messageId !== undefined) {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].messageId === turn.messageId) {
        index = i;
        break;
      }
    }
  }
  turns =
    index >= 0
      ? turns.map((t, i) => (i === index ? mergeThinkingTurn(t, turn) : t))
      : [...turns, turn].slice(-THINKING_TURN_HISTORY);
  await persist();
  notify();
  return turn;
}

/** Recent turns, oldest first. */
export async function readThinkingTurns(): Promise<ThinkingTurnRecord[]> {
  await ensureLoaded();
  return [...turns];
}

/** The turn behind one message - what a message footer shows, or `null` for "unknown". */
export async function getTurnForMessage(
  messageId: string,
): Promise<ThinkingTurnRecord | null> {
  await ensureLoaded();
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].messageId === messageId) return { ...turns[i] };
  }
  return null;
}

/**
 * Aggregate the recent window by level. Pass a smaller `limit` to ask about the last few
 * turns only; the default is the whole stored window, which is what "over recent turns"
 * means to a user looking at this a week later.
 */
export async function aggregateRecentThinking(
  limit?: number,
): Promise<ThinkingLevelAggregate[]> {
  await ensureLoaded();
  const window = limit && limit > 0 ? turns.slice(-limit) : turns;
  return aggregateThinkingTurns(window);
}

export function subscribeThinkingTurns(
  listener: (turns: readonly ThinkingTurnRecord[]) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam only: forget the in-memory window and force a reload. */
export function resetThinkingTurnsForTests(): void {
  turns = [];
  loaded = false;
}
