/**
 * How the new-conversation column lays out: the greeting above the composer.
 *
 * Desktop centres the pair inside the free area. On Android the composer is the control a
 * thumb reaches, so the pair sits at the bottom instead. The block carries `mt-auto` rather
 * than the column carrying `justify-end`, so an empty state taller than the screen scrolls
 * instead of losing its top edge above the clip. The native shell already pads the WebView
 * below the system bars; the inset term keeps the gap if a build ever draws under them.
 *
 * An Android chat with no usable model has no composer to reach, so its setup prompt keeps
 * the desktop centring.
 */

const CENTRED_COLUMN =
  'flex min-h-0 flex-1 flex-col justify-center-safe overflow-y-auto';
const CENTRED_BLOCK = 'max-w-3xl py-6';
const BOTTOM_COLUMN = 'flex min-h-0 flex-1 flex-col overflow-y-auto';
const BOTTOM_BLOCK =
  'mt-auto max-w-3xl pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]';

export interface StarterLayout {
  /** The scrolling column that holds the greeting and the composer. */
  column: string;
  /** The centred max-width block around that pair. */
  block: string;
}

export function starterLayout(
  android: boolean,
  composerVisible: boolean,
): StarterLayout {
  if (android && composerVisible) {
    return { column: BOTTOM_COLUMN, block: BOTTOM_BLOCK };
  }
  return { column: CENTRED_COLUMN, block: CENTRED_BLOCK };
}
