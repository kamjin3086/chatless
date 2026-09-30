import { describe, expect, test } from 'vitest';
import { windowControlsOnLeft } from '../windowControls';

describe('windowControlsOnLeft', () => {
  test('macOS families keep traffic lights on the left', () => {
    expect(windowControlsOnLeft('macos')).toBe(true);
    expect(windowControlsOnLeft('darwin')).toBe(true);
    expect(windowControlsOnLeft('OSX')).toBe(true);
  });

  test('Windows and Linux keep caption buttons on the right', () => {
    expect(windowControlsOnLeft('windows')).toBe(false);
    expect(windowControlsOnLeft('linux')).toBe(false);
  });
});
