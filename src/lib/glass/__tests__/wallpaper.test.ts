import { describe, expect, test } from 'vitest';
import {
  AMBIENT_MAX_EDGE,
  ambientTargetSize,
  deriveAmbientWallpaper,
  isWallpaperDataUrl,
  wallpaperExtension,
  wallpaperMime,
} from '../wallpaper';

describe('glass wallpaper helpers', () => {
  test('只接受常见图片扩展名，并把 jpeg 归一成 jpg', () => {
    expect(wallpaperExtension('bg.PNG')).toBe('png');
    expect(wallpaperExtension('wall.JPEG')).toBe('jpg');
    expect(wallpaperExtension('photo.webp')).toBe('webp');
    expect(wallpaperExtension('notes.txt')).toBeNull();
    expect(wallpaperExtension('noext')).toBeNull();
  });

  test('按扩展名给出 mime', () => {
    expect(wallpaperMime('png')).toBe('image/png');
    expect(wallpaperMime('jpg')).toBe('image/jpeg');
    expect(wallpaperMime('webp')).toBe('image/webp');
  });

  test('识别 data URL 壁纸', () => {
    expect(isWallpaperDataUrl('data:image/png;base64,aaa')).toBe(true);
    expect(isWallpaperDataUrl('wallpaper.jpg')).toBe(false);
    expect(isWallpaperDataUrl(null)).toBe(false);
  });
});

describe('the ambient wallpaper derivative', () => {
  test('clamps the longest edge and keeps the aspect ratio', () => {
    expect(ambientTargetSize(3200, 1800)).toEqual({ width: 1600, height: 900 });
    expect(ambientTargetSize(1800, 3200)).toEqual({ width: 900, height: 1600 });
    // Portrait phone photo, very tall: the longest edge is the height.
    expect(ambientTargetSize(900, 4000)).toEqual({ width: 360, height: 1600 });
  });

  test('leaves a small image alone', () => {
    expect(ambientTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(ambientTargetSize(AMBIENT_MAX_EDGE, 10)).toEqual({
      width: AMBIENT_MAX_EDGE,
      height: 10,
    });
  });

  test('is idempotent and survives nonsense dimensions', () => {
    const once = ambientTargetSize(4000, 2000);
    expect(ambientTargetSize(once.width, once.height)).toEqual(once);
    expect(ambientTargetSize(Number.NaN, 0)).toEqual({ width: 1, height: 1 });
  });

  test('returns null where there is no canvas to draw on', async () => {
    // Node has no DOM: the caller falls back to the original plus a CSS blur.
    expect(await deriveAmbientWallpaper('blob:whatever')).toBeNull();
    expect(await deriveAmbientWallpaper('')).toBeNull();
  });
});
