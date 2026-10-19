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

/**
 * The ambient variant of a wallpaper: downscaled and blurred once, then reused.
 *
 * A photograph behind text is not readable on its own - a bright image washes the text out,
 * a dark one swallows it - and the running UI must not pay a per-frame blur to find out. The
 * blur is baked by the canvas, so the wallpaper layer is a plain image; the CSS filter is
 * only the fallback for a source that cannot be decoded here.
 *
 * Animated images arrive as their first frame: a canvas takes a frame, not the animation.
 * That is the accepted trade for "the wallpaper is atmosphere, not a gallery", and the
 * picker says so.
 */
export const AMBIENT_MAX_EDGE = 1600;

/** Blur radius baked into the derivative, in its own pixels. */
export const AMBIENT_BLUR_PX = 18;

/** Longest edge no larger than `maxEdge`, aspect preserved. Pure, so it can be tested. */
export function ambientTargetSize(
  width: number,
  height: number,
  maxEdge: number = AMBIENT_MAX_EDGE,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
  const h = Math.max(1, Math.round(Number.isFinite(height) ? height : 1));
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

const ambientCache = new Map<string, string>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('壁纸解码失败'));
    image.src = src;
  });
}

/**
 * Downscale + blur into a data URL, memoised per source. Returns `null` where there is no
 * canvas to draw on (unit tests, SSR) or the image cannot be decoded - the caller then shows
 * the original with the CSS blur fallback.
 */
export async function deriveAmbientWallpaper(src: string): Promise<string | null> {
  if (!src) return null;
  const cached = ambientCache.get(src);
  if (cached) return cached;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  try {
    const image = await loadImage(src);
    const target = ambientTargetSize(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    );
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.filter = `blur(${AMBIENT_BLUR_PX}px)`;
    // Drawing slightly larger than the canvas hides the blurred edge bleeding inward.
    ctx.drawImage(image, -AMBIENT_BLUR_PX, -AMBIENT_BLUR_PX, target.width + AMBIENT_BLUR_PX * 2, target.height + AMBIENT_BLUR_PX * 2);
    const url = canvas.toDataURL('image/jpeg', 0.82);
    ambientCache.set(src, url);
    return url;
  } catch {
    return null;
  }
}

/** Test-only: forget what was derived, so a case can re-run the pipeline. */
export function resetAmbientWallpaperCache(): void {
  ambientCache.clear();
}
