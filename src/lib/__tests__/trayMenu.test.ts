/**
 * The tray menu's contract, after a report that clicking the icon did nothing.
 *
 * The icon itself could not be the fix on Linux: an AppIndicator opens its menu on a click
 * and never reports the click, so the window has to be reachable from the menu. These tests
 * pin the two things that make that true, and the item that was removed because it was
 * redundant.
 */
import { describe, expect, it } from 'vitest';
import {
  TRAY_MENU_ORDER,
  TRAY_SEPARATOR_AFTER,
  trayItemLabelKey,
  trayItemRestoresWindow,
} from '../trayMenu';

describe('the tray menu', () => {
  it('offers a window item first, because a Linux tray click only opens the menu', () => {
    expect(TRAY_MENU_ORDER[0]).toBe('show');
  });

  it('has no minimize item any more', () => {
    // Minimizing is the window's own button; from the tray it only hid the window further.
    expect(TRAY_MENU_ORDER).toEqual(['show', 'new_chat', 'settings', 'quit']);
  });

  it('brings the window forward before any item that is about the window', () => {
    for (const id of TRAY_MENU_ORDER) {
      if (id === 'quit') continue;
      expect(trayItemRestoresWindow(id), id).toBe(true);
    }
  });

  it('does not flash the window on the way out', () => {
    expect(trayItemRestoresWindow('quit')).toBe(false);
  });

  it('draws a separator between the groups it implies', () => {
    expect(TRAY_SEPARATOR_AFTER).toEqual(['new_chat']);
    for (const id of TRAY_SEPARATOR_AFTER) {
      expect(TRAY_MENU_ORDER).toContain(id);
    }
  });

  it('names a translation key for every item', () => {
    const keys = TRAY_MENU_ORDER.map(trayItemLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'tray.show',
      'tray.newChat',
      'tray.settings',
      'tray.quit',
    ]);
  });
});
