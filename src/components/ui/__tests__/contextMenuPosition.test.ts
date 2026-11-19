import { beforeEach, expect, it, vi } from 'vitest';

// The native popup is the branch that ships: `core:menu:default` is in
// src-tauri/capabilities/main.json, so `Menu.new` resolves and the DOM fallback
// never runs inside the app.
const popup = vi.fn();
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: vi.fn(async () => ({ popup })) },
}));

import { Position } from '@tauri-apps/api/dpi';
import { popupNativeMenu } from '../context-menu';

beforeEach(() => {
  popup.mockClear();
});

const items = [
  { id: 'edit', text: '重命名对话', action: () => {} },
  { id: 'sep', text: '', separator: true },
  { id: 'delete', text: '删除对话', action: () => {} },
];

it('pops the native menu at the cursor instead of the default position', async () => {
  await popupNativeMenu(items, 240, 180);

  expect(popup).toHaveBeenCalledTimes(1);
  const at = popup.mock.calls[0][0];
  expect(at).toBeDefined();
  expect({ type: at.type, x: at.x, y: at.y }).toEqual({
    type: 'Logical',
    x: 240,
    y: 180,
  });
});

it('serializes to the tagged Logical variant the Rust command deserializes', async () => {
  await popupNativeMenu(items, 240, 180);

  // `Menu.popup` wraps a non-Position argument in `new Position(at)` (api/menu/menu.js:114),
  // so a bare `{x, y}` serializes as `{undefined: {x, y}}` and the command rejects it.
  expect(new Position(popup.mock.calls[0][0]).toJSON()).toEqual({
    Logical: { x: 240, y: 180 },
  });
});

it('keeps separators out of the native items', async () => {
  await popupNativeMenu(items, 12, 34);

  expect((await import('@tauri-apps/api/menu')).Menu.new).toHaveBeenCalledWith({
    items: [
      { id: 'edit', text: '重命名对话', action: expect.any(Function) },
      {
        id: 'delete',
        text: '删除对话',
        action: expect.any(Function),
      },
    ],
  });
});
