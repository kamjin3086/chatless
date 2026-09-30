import { StateFlags } from '@tauri-apps/plugin-window-state';

/** Size/position/visibility only. Native decorations stay off because we draw a custom title bar. */
export const PERSISTED_WINDOW_STATE: StateFlags =
  StateFlags.ALL & ~StateFlags.DECORATIONS;

export async function savePersistedWindowState(): Promise<void> {
  const { saveWindowState } = await import('@tauri-apps/plugin-window-state');
  await saveWindowState(PERSISTED_WINDOW_STATE);
}
