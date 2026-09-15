const WALLPAPER_DIR = 'wallpapers';
export const GLASS_WALLPAPER_MAX_BYTES = 8 * 1024 * 1024;
export const GLASS_WALLPAPER_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function wallpaperExtension(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase().trim() ?? '';
  if (!(GLASS_WALLPAPER_EXTS as readonly string[]).includes(ext)) return null;
  return ext === 'jpeg' ? 'jpg' : ext;
}

export function wallpaperMime(ext: string): string {
  return MIME_BY_EXT[ext] || 'image/jpeg';
}

export function isWallpaperDataUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI__);
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export async function saveGlassWallpaper(file: File): Promise<string> {
  if (!file || file.size <= 0) {
    throw new Error('请选择一张图片');
  }
  if (file.size > GLASS_WALLPAPER_MAX_BYTES) {
    throw new Error('壁纸需小于 8MB');
  }
  const ext = wallpaperExtension(file.name) || wallpaperExtension(file.type.replace('image/', '.')) || (file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : null);
  if (!ext) {
    throw new Error('仅支持 PNG / JPG / WEBP / GIF');
  }

  if (!isTauriRuntime()) {
    return await fileToDataUrl(file);
  }

  const { writeFile, mkdir, readDir, remove } = await import('@tauri-apps/plugin-fs');
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const dir = await join(await appDataDir(), WALLPAPER_DIR);
  await mkdir(dir, { recursive: true });

  try {
    const entries = await readDir(dir);
    for (const entry of entries) {
      if (entry.name) {
        await remove(await join(dir, entry.name));
      }
    }
  } catch {
    // 目录为空或无法列举时，直接覆盖写入即可
  }

  const fileName = `wallpaper.${ext}`;
  const path = await join(dir, fileName);
  await writeFile(path, new Uint8Array(await file.arrayBuffer()));
  return fileName;
}

export async function loadGlassWallpaperUrl(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (isWallpaperDataUrl(stored)) return stored;
  if (!isTauriRuntime()) return null;

  const { readFile, exists } = await import('@tauri-apps/plugin-fs');
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const path = await join(await appDataDir(), WALLPAPER_DIR, stored);
  if (!(await exists(path))) return null;

  const bytes = await readFile(path);
  const ext = wallpaperExtension(stored) || 'jpg';
  const blob = new Blob([bytes], { type: wallpaperMime(ext) });
  return URL.createObjectURL(blob);
}

export async function clearGlassWallpaperFile(stored: string | null | undefined): Promise<void> {
  if (!stored || isWallpaperDataUrl(stored) || !isTauriRuntime()) return;
  try {
    const { remove, exists } = await import('@tauri-apps/plugin-fs');
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const path = await join(await appDataDir(), WALLPAPER_DIR, stored);
    if (await exists(path)) {
      await remove(path);
    }
  } catch {
    // 清理失败不影响关闭主题
  }
}
