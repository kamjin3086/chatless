/**
 * The composer's own undo history.
 *
 * The composer keeps its own list of what the user had typed, rather than leaning on the
 * browser's undo for a `<textarea>` whose value other code also writes (draft restore, the
 * clear after send, the slash/mention overlays). That keeps undo meaning "the text I had",
 * independent of what the browser happens to have recorded - and it is the only way to scope
 * the history per conversation, which the browser's list cannot do.
 *
 * Pure and unsorted by design: the component owns when a state is committed, this owns what
 * undo and redo mean.
 */
export type ComposerHistory = {
  past: string[];
  present: string;
  future: string[];
};

/** Anything past this is not a draft worth keeping; it would only grow the stack. */
export const HISTORY_LIMIT = 60;

export function composerHistory(value = ''): ComposerHistory {
  return { past: [], present: value, future: [] };
}

/**
 * Commit what is on screen. The same text twice is not a step - the caret moves, and a user
 * who presses undo gets whatever the caret was doing before they touched anything.
 */
export function commitHistory(
  h: ComposerHistory,
  value: string,
): ComposerHistory {
  if (value === h.present) return h;
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: value, future: [] };
}

export function undoHistory(h: ComposerHistory): ComposerHistory {
  if (!h.past.length) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1];
  return {
    past,
    present,
    future: [h.present, ...h.future].slice(0, HISTORY_LIMIT),
  };
}

export function redoHistory(h: ComposerHistory): ComposerHistory {
  if (!h.future.length) return h;
  const [present, ...future] = h.future;
  return {
    past: [...h.past, h.present].slice(-HISTORY_LIMIT),
    present,
    future,
  };
}

export function canUndo(h: ComposerHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: ComposerHistory): boolean {
  return h.future.length > 0;
}

/**
 * Undo on Ctrl+Z (Cmd+Z on macOS), redo on Ctrl/Cmd+Shift+Z, plus Ctrl+Y on Windows and
 * Linux, where that chord has always meant redo. On macOS Ctrl+Y is left alone: whatever it
 * does in a given text field is the user's, not ours.
 */
export function historyShortcut(
  event: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey?: boolean;
    key: string;
  },
  platform: string = typeof navigator !== 'undefined'
    ? navigator.platform || ''
    : '',
): 'undo' | 'redo' | null {
  const isMac = /mac|iphone|ipad|ipod/i.test(platform);
  const held = isMac ? event.metaKey : event.ctrlKey;
  if (!held || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !isMac && !event.shiftKey) return 'redo';
  return null;
}
