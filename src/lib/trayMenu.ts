/**
 * The tray menu as data: which items exist, in what order, and which of them bring the window
 * back before doing their job.
 *
 * Two decisions live here, both from a user report that clicking the tray icon did nothing:
 *
 * - Linux is the reason the list starts with "Show window". A tray icon there is an
 *   AppIndicator: a left click opens the attached menu and no click event ever reaches the
 *   app, so "click the icon to get the window back" can only exist as a menu item. Every
 *   item restoring the window first means the shortest path out of a hidden window is one
 *   click on the icon plus any item.
 * - "Minimize" is gone. Minimizing is the window's own button, and a minimized window is
 *   already "visible" to the tray - the item only existed to make a hidden window harder to
 *   find again.
 */

export type TrayMenuItemId = 'show' | 'new_chat' | 'settings' | 'quit';

/** Order in the menu; separators are drawn between the groups this order implies. */
export const TRAY_MENU_ORDER: readonly TrayMenuItemId[] = [
  'show',
  'new_chat',
  'settings',
  'quit',
];

/** Items after which the native menu draws a separator. */
export const TRAY_SEPARATOR_AFTER: readonly TrayMenuItemId[] = ['new_chat'];

/**
 * Quit exits; every other item is about a window the user is trying to reach, so it comes
 * forward first. Restoring before quitting would only flash a window on the way out.
 */
export function trayItemRestoresWindow(id: TrayMenuItemId): boolean {
  return id !== 'quit';
}

/** The i18n key for an item, so the menu and the translation table cannot drift. */
export function trayItemLabelKey(
  id: TrayMenuItemId,
): 'tray.show' | 'tray.newChat' | 'tray.settings' | 'tray.quit' {
  switch (id) {
    case 'show':
      return 'tray.show';
    case 'new_chat':
      return 'tray.newChat';
    case 'settings':
      return 'tray.settings';
    case 'quit':
      return 'tray.quit';
  }
}
