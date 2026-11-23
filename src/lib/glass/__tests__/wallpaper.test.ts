import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AMBIENT_MAX_EDGE,
  GLASS_WALLPAPER_MAX_BYTES,
  ambientTargetSize,
  deriveAmbientWallpaper,
  isWallpaperDataUrl,
  saveGlassWallpaper,
  wallpaperExtension,
  wallpaperMime,
  WallpaperSaveError,
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

describe('saveGlassWallpaper', () => {
  afterEach(() => vi.unstubAllGlobals());

  test.each([
    [new File([], 'wallpaper.png'), 'emptyFile'],
    [
      new File(
        [new Uint8Array(GLASS_WALLPAPER_MAX_BYTES + 1)],
        'wallpaper.png',
      ),
      'tooLarge',
    ],
    [
      new File(['text'], 'wallpaper.txt', { type: 'text/plain' }),
      'unsupportedFormat',
    ],
  ])(
    'reports a stable, localizable reason for rejecting %s',
    async (file, reason) => {
      await expect(saveGlassWallpaper(file)).rejects.toEqual(
        expect.objectContaining({ name: 'WallpaperSaveError', reason }),
      );
    },
  );

  test('accepts a supported image at the existing size limit', async () => {
    vi.stubGlobal(
      'FileReader',
      class {
        result = 'data:image/png;base64,AA==';
        onload?: () => void;
        readAsDataURL() {
          this.onload?.();
        }
      },
    );
    const file = new File(
      [new Uint8Array(GLASS_WALLPAPER_MAX_BYTES)],
      'wallpaper.png',
    );
    await expect(saveGlassWallpaper(file)).resolves.toBe(
      'data:image/png;base64,AA==',
    );
  });

  test('reports a read failure without losing the original FileReader error', async () => {
    const cause = new DOMException('File cannot be read', 'NotReadableError');
    vi.stubGlobal(
      'FileReader',
      class {
        error = cause;
        onerror?: () => void;
        readAsDataURL() {
          this.onerror?.();
        }
      },
    );
    const result = saveGlassWallpaper(new File(['image'], 'wallpaper.png'));
    await expect(result).rejects.toBeInstanceOf(WallpaperSaveError);
    await expect(result).rejects.toMatchObject({ reason: 'readFailed', cause });
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
