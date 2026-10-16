import { describe, expect, it } from 'vitest';
import { RESTORE_STEPS, trayClickAction } from '../trayClick';

/**
 * `isVisible()` answers true for a minimized window. Every tray interaction written against
 * visibility alone therefore treats "minimized" as "on screen" and hides it, which is the
 * two-click dance the owner reported: click the tray icon, the window is still sitting
 * minimized in the taskbar; click again, it comes up.
 */
describe('what a tray click means', () => {
  it('restores a minimized window instead of hiding it', () => {
    expect(trayClickAction({ visible: true, minimized: true })).toBe('restore');
  });

  it('hides a window that is actually on screen, and restores one that is hidden', () => {
    expect(trayClickAction({ visible: true, minimized: false })).toBe('hide');
    expect(trayClickAction({ visible: false, minimized: false })).toBe(
      'restore',
    );
    // hidden and "minimized" at once: there is nothing to hide, so bring it back
    expect(trayClickAction({ visible: false, minimized: true })).toBe(
      'restore',
    );
  });

  it('un-miniminimises before showing, or the show does nothing', () => {
    expect(RESTORE_STEPS).toEqual(['unminimize', 'show', 'setFocus']);
  });
});
