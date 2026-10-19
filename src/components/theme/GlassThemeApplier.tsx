"use client";

import { useEffect, useState } from 'react';
import { GLASS_FROST_CSS, GLASS_FROST_STYLE_ID } from '@/lib/glass/frostStyle';
import {
  deriveAmbientWallpaper,
  isWallpaperDataUrl,
  loadGlassWallpaperUrl,
} from '@/lib/glass/wallpaper';
import { useUiPreferences } from '@/store/uiPreferences';

function syncGlassFrostStyle(enabled: boolean) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(GLASS_FROST_STYLE_ID);
  if (!enabled) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.textContent = GLASS_FROST_CSS;
    return;
  }
  const el = document.createElement('style');
  el.id = GLASS_FROST_STYLE_ID;
  el.textContent = GLASS_FROST_CSS;
  document.head.appendChild(el);
}

/**
 * 将玻璃主题 class 与壁纸挂到根节点。关闭后不渲染壁纸层，避免额外绘制。
 */
export function GlassThemeApplier() {
  const initialized = useUiPreferences((s) => s.initialized);
  const glassTheme = useUiPreferences((s) => s.glassTheme);
  const wallpaperFile = useUiPreferences((s) => s.glassWallpaperFile);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ambientUrl, setAmbientUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized || typeof document === 'undefined') return;
    const html = document.documentElement;
    if (glassTheme) html.classList.add('glass-ui');
    else html.classList.remove('glass-ui');
    syncGlassFrostStyle(!!glassTheme);
    return () => {
      html.classList.remove('glass-ui');
      syncGlassFrostStyle(false);
    };
  }, [initialized, glassTheme, GLASS_FROST_CSS]);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    const run = async () => {
      if (!glassTheme || !wallpaperFile) {
        setImageUrl(null);
        return;
      }
      const url = await loadGlassWallpaperUrl(wallpaperFile);
      if (cancelled) {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      createdUrl = url && url.startsWith('blob:') ? url : null;
      setImageUrl(url);
    };

    void run();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [glassTheme, wallpaperFile]);

  /**
   * The ambient derivative is what the window actually draws: downscaled and blurred once,
   * so the UI never pays a per-frame blur to keep text readable. Derived lazily, which covers
   * wallpapers stored before this existed as well as a freshly chosen one.
   */
  useEffect(() => {
    let cancelled = false;
    if (!imageUrl) {
      setAmbientUrl(null);
      return;
    }
    deriveAmbientWallpaper(imageUrl).then((url) => {
      if (!cancelled) setAmbientUrl(url);
    }).catch(() => {
      if (!cancelled) setAmbientUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  if (!initialized || !glassTheme) return null;

  const resolved = imageUrl || (isWallpaperDataUrl(wallpaperFile) ? wallpaperFile : null);

  return (
    <GlassWallpaperLayer imageUrl={resolved} ambientUrl={ambientUrl} />
  );
}

/**
 * The wallpaper, as two layers: the image (the ambient derivative when one could be made,
 * otherwise the original with the CSS blur fallback) and the veil that brings any photo into
 * a readable luminance range. Both are inert and sit under the window sheet.
 */
function GlassWallpaperLayer({
  imageUrl,
  ambientUrl,
}: {
  imageUrl: string | null;
  ambientUrl: string | null;
}) {
  if (!imageUrl) return null;
  const fallingBack = !ambientUrl;
  return (
    <div className="glass-wallpaper pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <div
        data-testid="glass-wallpaper-image"
        data-ambient={fallingBack ? 'fallback' : 'baked'}
        className={
          fallingBack
            ? 'glass-wallpaper-image glass-wallpaper-image-fallback'
            : 'glass-wallpaper-image'
        }
        style={{ backgroundImage: `url("${ambientUrl || imageUrl}")` }}
      />
      <div className="glass-wallpaper-veil" data-testid="glass-wallpaper-veil" />
    </div>
  );
}
