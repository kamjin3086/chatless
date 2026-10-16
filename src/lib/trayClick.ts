/**
 * What the tray icon should do when it is clicked.
 *
 * `isVisible()` is true for a minimized window, so a tray toggle written against visibility
 * alone treats a minimized window as "on screen" and hides it - which is how one click did
 * nothing visible and the second brought the window back. The minimized case has to be asked
 * about by name, and restoring has to un-minimize before it can take focus.
 */
/** The two window states a tray click has to tell apart. */
export type WindowVisibility = { visible: boolean; minimized: boolean };

export type TrayClick = 'hide' | 'restore';

export type RestorableWindow = {
  unminimize: () => Promise<void>;
  show: () => Promise<void>;
  setFocus: () => Promise<void>;
};

/**
 * Bring the window forward, whatever state it is in.
 *
 * Order matters: `show()` on a minimized window leaves it minimized, which is the tray click
 * that appears to do nothing. Each step is guarded on its own because one rejected step (a
 * window that was already restored, a focus the OS will not hand over) must not cost the user
 * the other two - the version with one try/catch around all three did exactly that, and was
 * worse than the code it replaced.
 */
export async function restoreWindow(
  window: RestorableWindow,
  report: (step: string, error: unknown) => void = () => {},
): Promise<void> {
  for (const step of ['unminimize', 'show', 'setFocus'] as const) {
    try {
      await window[step]();
    } catch (error) {
      report(step, error);
    }
  }
}

export function trayClickAction({
  visible,
  minimized,
}: WindowVisibility): TrayClick {
  if (minimized) return 'restore';
  return visible ? 'hide' : 'restore';
}
