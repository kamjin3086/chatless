/**
 * Window size presets are logical pixels, which is not the same budget as the
 * desktop: the work area is what is left after the taskbar or dock, so the
 * shipped default of 1280x760 does not fit a 1536x864 display at 125 % (that
 * leaves 1228x691 usable). The window itself is clamped on the Rust side, where
 * it also has to hold for a restored window before this bundle loads - see
 * `src-tauri/src/window_fit.rs`. This module only speaks to that side and keeps
 * the preset as the user's choice, so it is what they get on a bigger display.
 */

import { isTauriEnvironment } from '@/lib/utils/environment';

export interface WindowSize {
  width: number;
  height: number;
}

/**
 * The sizes the settings row offers, smallest first.
 *
 * They live here rather than in the store that persists the choice so that the row, the store
 * and `src-tauri/tauri.conf.json` all read one definition - the config is what actually sizes a
 * fresh install, because a preset is only applied when the row changes and window-state restores
 * the last size after that.
 */
export type WindowSizePreset =
  | '900x700'
  | '1024x768'
  | '1280x760'
  | '1280x800'
  | '1366x768'
  | '1440x900'
  | '1600x900';

export const WINDOW_SIZE_PRESETS: WindowSizePreset[] = [
  '900x700',
  '1024x768',
  '1280x760',
  '1280x800',
  '1366x768',
  '1440x900',
  '1600x900',
];

/**
 * What a first launch opens at, and the size the settings row labels "default". Must agree with
 * `app.windows[0]` in `src-tauri/tauri.conf.json`. 1280x760 is the size the message column
 * wants - below the 1200px breakpoint that column caps at 768 and a 280 sidebar leaves it
 * squeezed - and it is short enough that a 1366x768 desktop or a 1080p one at 150 % only loses
 * what the work-area clamp in `src-tauri/src/window_fit.rs` takes back.
 */
export const DEFAULT_WINDOW_SIZE_PRESET: WindowSizePreset = '1280x760';

/**
 * The smallest the window may get, and the floor is the layout's rather than a round number: the
 * conversation sidebar stops at 240 (`ChatLayout.MIN_SIDEBAR_WIDTH`) and the message column stops
 * at 400 (the sidebar drag clamps to `innerWidth - 400`), so the 280 default sidebar plus the 400
 * column already needs 680. Vertically the chrome above the messages is the 32px custom title bar
 * (`--titlebar-height`), the 36px chat header and the composer's own two-line floor plus its
 * margin - about 176px - so 520 still leaves a readable strip of messages. Below this the app
 * does not resize, it clips, and "显示不全" is reported as a bug in the window size.
 */
export const MIN_WINDOW_SIZE: WindowSize = { width: 720, height: 520 };

export interface AppliedWindowSize {
  requested: WindowSize;
  applied: WindowSize;
  workArea: WindowSize;
  reduced: boolean;
}

interface WindowFitReply {
  size: WindowSize;
  workArea: WindowSize;
}
/** `'1024x768'` -> `{ width: 1024, height: 768 }`; anything else -> null. */
export function parseWindowSizePreset(preset: string): WindowSize | null {
  const match = /^(\d+)x(\d+)$/.exec(preset.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/** `'1280x760'` -> `'1280 × 760'`: a label built from the stored value cannot disagree with it. */
export function formatWindowSizePreset(preset: WindowSizePreset): string {
  const size = parseWindowSizePreset(preset);
  return size ? `${size.width} × ${size.height}` : preset;
}

/** Logical work area of the current display; null in a browser. */
export async function readWindowWorkArea(): Promise<WindowSize | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<WindowSize | null>('window_work_area');
  } catch {
    return null;
  }
}

/**
 * What the Rust side reported, in the shape the settings row speaks: whole
 * logical pixels, and whether the display cost the user any of what they asked
 * for. Floored, because a value divided by the scale factor is fractional and
 * rounding up would claim a pixel more than fits.
 */
export function describeWindowFit(
  requested: WindowSize,
  fit: WindowFitReply,
): AppliedWindowSize {
  const applied = {
    width: Math.floor(fit.size.width),
    height: Math.floor(fit.size.height),
  };
  return {
    requested,
    applied,
    workArea: fit.workArea,
    reduced:
      applied.width < requested.width || applied.height < requested.height,
  };
}

/**
 * Set the window to a preset and report what it actually took. Null when there
 * is nothing to apply: an unreadable preset, or a browser tab whose stub store
 * has no window to resize.
 */
export async function applyWindowSizePreset(
  preset: string,
): Promise<AppliedWindowSize | null> {
  const requested = parseWindowSizePreset(preset);
  if (!requested || !isTauriEnvironment()) return null;

  const { invoke } = await import('@tauri-apps/api/core');
  const fit = await invoke<WindowFitReply | null>('apply_window_size', {
    width: requested.width,
    height: requested.height,
  });
  return fit ? describeWindowFit(requested, fit) : null;
}
