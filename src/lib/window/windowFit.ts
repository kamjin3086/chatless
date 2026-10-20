/**
 * Window size presets are logical pixels, which is not the same budget as the
 * desktop: the work area is what is left after the taskbar or dock, so the
 * shipped default of 1024x768 does not fit a 1536x864 display at 125 % (that
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
