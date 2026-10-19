import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  commitHistory,
  composerHistory,
  historyShortcut,
  redoHistory,
  undoHistory,
} from '../composerHistory';
import { composerFloor, nextInputHeight, oneLineHeight } from '../inputHeight';

/**
 * The composer is a controlled textarea whose value also gets written by drafts, the send
 * path and the slash/mention overlays. Native undo therefore holds a mixture of keystrokes the
 * user meant and rewrites they did not, which is why the shortcut drives its own list.
 */
describe('composer history', () => {
  it('walks back and forward over what was typed', () => {
    let h = composerHistory('');
    h = commitHistory(h, '查一下天气');
    h = commitHistory(h, '查一下天气，明天呢');
    expect(undoHistory(h).present).toBe('查一下天气');
    expect(undoHistory(undoHistory(h)).present).toBe('');
    // redo steps forward one at a time, back to what was there before any of it
    expect(redoHistory(undoHistory(h)).present).toBe('查一下天气，明天呢');
    expect(redoHistory(undoHistory(undoHistory(h))).present).toBe('查一下天气');
  });

  it('does not store the same text twice, or an empty keystroke', () => {
    let h = composerHistory('a');
    h = commitHistory(h, 'a');
    expect(canUndo(h)).toBe(false);
    h = commitHistory(h, 'ab');
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it('drops the redo branch once something new is typed', () => {
    const h = commitHistory(undoHistory(composerHistory('a')), 'b');
    expect(canRedo(h)).toBe(false);
  });

  it('forgets the far past rather than growing forever', () => {
    let h = composerHistory('');
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1)
      h = commitHistory(h, `v${i}`);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe('the shortcut, per platform', () => {
  const ev = (key: string, mods: Record<string, boolean> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it('uses Command on macOS and Ctrl elsewhere', () => {
    expect(historyShortcut(ev('z', { metaKey: true }), 'MacIntel')).toBe(
      'undo',
    );
    expect(historyShortcut(ev('z', { ctrlKey: true }), 'MacIntel')).toBe(null);
    expect(historyShortcut(ev('z', { ctrlKey: true }), 'Win32')).toBe('undo');
    expect(historyShortcut(ev('z', { metaKey: true }), 'Win32')).toBe(null);
  });

  it('reads shift+Ctrl/Cmd+Z as redo, and Ctrl+Y too where that is the custom', () => {
    expect(
      historyShortcut(ev('Z', { metaKey: true, shiftKey: true }), 'MacIntel'),
    ).toBe('redo');
    expect(
      historyShortcut(
        ev('z', { ctrlKey: true, shiftKey: true }),
        'Linux x86_64',
      ),
    ).toBe('redo');
    expect(historyShortcut(ev('y', { ctrlKey: true }), 'Win32')).toBe('redo');
    // macOS keeps Ctrl+Y for "move to end of line"
    expect(historyShortcut(ev('y', { ctrlKey: true }), 'MacIntel')).toBe(null);
  });

  it("leaves plain typing, alt combos and the browser's own chords alone", () => {
    expect(historyShortcut(ev('z'), 'Win32')).toBe(null);
    expect(
      historyShortcut(ev('z', { ctrlKey: true, altKey: true }), 'Win32'),
    ).toBe(null);
    expect(historyShortcut(ev('a', { ctrlKey: true }), 'Win32')).toBe(null);
  });
});

describe('how tall the composer is', () => {
  const styles = {
    lineHeight: '24px',
    fontSize: '16px',
    paddingTop: '10px',
    paddingBottom: '36px',
  };

  it('measures the floor from the element, not from a constant', () => {
    expect(oneLineHeight(styles)).toBe(70);
    // no explicit line-height: fall back to the font size, still one line
    expect(oneLineHeight({ fontSize: '16px' })).toBe(24 + 0);
  });

  it('sits two lines tall when empty, so it reads as a place to write', () => {
    // A single row made the composer look like a search field (one line of text inside a
    // 70px box). The floor is a line count, not a constant: 2 lines + 46px of padding.
    expect(composerFloor(styles)).toBe(94);
    const floor = composerFloor(styles);
    expect(nextInputHeight({ contentHeight: 24, floor, limit: 240 })).toBe(94);
    expect(nextInputHeight({ contentHeight: 150, floor, limit: 240 })).toBe(
      150,
    );
    expect(nextInputHeight({ contentHeight: 4000, floor, limit: 240 })).toBe(
      240,
    );
  });

  it('honours a height the user dragged to, within the same bounds', () => {
    const floor = composerFloor(styles);
    expect(
      nextInputHeight({ contentHeight: 30, floor, limit: 240, manual: 180 }),
    ).toBe(180);
    expect(
      nextInputHeight({ contentHeight: 30, floor, limit: 240, manual: 5 }),
    ).toBe(94);
    expect(
      nextInputHeight({ contentHeight: 30, floor, limit: 240, manual: 9999 }),
    ).toBe(240);
  });

  it('keeps the two-line floor even when the window is short', () => {
    // `limit` is 40% of the viewport; on a tiny window that can fall below the floor, and a
    // composer shorter than its floor would clip the first line.
    const floor = composerFloor(styles);
    expect(nextInputHeight({ contentHeight: 24, floor, limit: 60 })).toBe(
      floor,
    );
  });
});
