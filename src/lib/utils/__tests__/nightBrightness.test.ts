import { describe, expect, test } from 'vitest';
import {
  clampNightBrightness,
  nightOverlayFromBrightness,
  NIGHT_BRIGHTNESS_DEFAULT,
} from '../nightBrightness';

describe('nightBrightness', () => {
  test('把值限制在 50–100', () => {
    expect(clampNightBrightness(100)).toBe(100);
    expect(clampNightBrightness(50)).toBe(50);
    expect(clampNightBrightness(12)).toBe(50);
    expect(clampNightBrightness(140)).toBe(100);
    expect(clampNightBrightness(Number.NaN)).toBe(NIGHT_BRIGHTNESS_DEFAULT);
  });

  test('100% 时遮罩为 0，调暗时逐渐增加', () => {
    expect(nightOverlayFromBrightness(100)).toBe(0);
    expect(nightOverlayFromBrightness(50)).toBeGreaterThan(0.3);
    expect(nightOverlayFromBrightness(50)).toBeLessThan(0.5);
    expect(nightOverlayFromBrightness(75)).toBeGreaterThan(0);
    expect(nightOverlayFromBrightness(75)).toBeLessThan(nightOverlayFromBrightness(50));
  });
});
