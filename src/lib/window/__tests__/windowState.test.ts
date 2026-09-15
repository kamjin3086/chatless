import { describe, expect, test } from 'vitest';
import { StateFlags } from '@tauri-apps/plugin-window-state';
import { PERSISTED_WINDOW_STATE } from '../windowState';

describe('PERSISTED_WINDOW_STATE', () => {
  test('does not persist native window decorations', () => {
    expect(PERSISTED_WINDOW_STATE & StateFlags.DECORATIONS).toBe(0);
    expect(PERSISTED_WINDOW_STATE & StateFlags.SIZE).toBe(StateFlags.SIZE);
    expect(PERSISTED_WINDOW_STATE & StateFlags.POSITION).toBe(StateFlags.POSITION);
  });
});
