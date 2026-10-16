import { describe, expect, it, vi } from 'vitest';
import { restoreWindow, trayClickAction } from '../trayClick';

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
});

function fakeWindow(fail?: 'unminimize' | 'show' | 'setFocus') {
  const calls: string[] = [];
  const step = (name: 'unminimize' | 'show' | 'setFocus') => async () => {
    calls.push(name);
    if (name === fail) throw new Error(`${name} refused`);
  };
  return {
    calls,
    window: {
      unminimize: step('unminimize'),
      show: step('show'),
      setFocus: step('setFocus'),
    },
  };
}

describe('bringing the window back', () => {
  it('un-minimizes before showing, or the show does nothing', async () => {
    const { window, calls } = fakeWindow();
    await restoreWindow(window);
    expect(calls).toEqual(['unminimize', 'show', 'setFocus']);
  });

  it('still shows and focuses when un-minimizing fails', async () => {
    // A single try/catch around all three meant a rejected unminimize left the tray click
    // doing nothing at all - worse than the path it replaced.
    const { window, calls } = fakeWindow('unminimize');
    const reported: string[] = [];
    await restoreWindow(window, (step) => reported.push(step));
    expect(calls).toEqual(['unminimize', 'show', 'setFocus']);
    expect(reported).toEqual(['unminimize']);
  });

  it('reports a failing focus attempt rather than swallowing it', async () => {
    const { window } = fakeWindow('setFocus');
    const spy = vi.fn();
    await restoreWindow(window, spy);
    expect(spy).toHaveBeenCalledWith('setFocus', expect.any(Error));
  });
});
