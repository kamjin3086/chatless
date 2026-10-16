/**
 * What the tray icon should do when it is clicked.
 *
 * `isVisible()` is true for a minimized window, so a tray toggle written against visibility
 * alone treats a minimized window as "on screen" and hides it - which is how one click did
 * nothing visible and the second brought the window back. The minimized case has to be asked
 * about by name, and restoring has to un-minimize before it can take focus.
 */
export type WindowSurface = { visible: boolean; minimized: boolean };

export type TrayClick = 'hide' | 'restore';

/** Steps, in order. `show` before `unminimize` leaves a minimized window still minimized. */
export const RESTORE_STEPS = ['unminimize', 'show', 'setFocus'] as const;

export function trayClickAction({
  visible,
  minimized,
}: WindowSurface): TrayClick {
  if (minimized) return 'restore';
  return visible ? 'hide' : 'restore';
}
