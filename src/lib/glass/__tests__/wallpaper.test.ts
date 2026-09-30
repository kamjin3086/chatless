import { describe, expect, test } from 'vitest';
import {
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
