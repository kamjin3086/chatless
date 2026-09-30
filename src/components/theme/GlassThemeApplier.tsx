"use client";

import { useEffect, useState } from 'react';
import { GLASS_FROST_CSS, GLASS_FROST_STYLE_ID } from '@/lib/glass/frostStyle';
import { isWallpaperDataUrl, loadGlassWallpaperUrl } from '@/lib/glass/wallpaper';
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

  if (!initialized || !glassTheme) return null;

  const resolved = imageUrl || (isWallpaperDataUrl(wallpaperFile) ? wallpaperFile : null);

  return (
    <GlassWallpaperLayer imageUrl={resolved} />
  );
}

function GlassWallpaperLayer({ imageUrl }: { imageUrl: string | null }) {
  useEffect(() => {
    const html = document.documentElement;
    if (!imageUrl) {
      html.style.removeProperty('background-image');
      html.style.removeProperty('background-size');
      html.style.removeProperty('background-position');
      return;
    }
    html.style.backgroundImage = `url("${imageUrl}")`;
    html.style.backgroundSize = 'cover';
    html.style.backgroundPosition = 'center';
    html.style.backgroundAttachment = 'fixed';
    return () => {
      html.style.removeProperty('background-image');
      html.style.removeProperty('background-size');
      html.style.removeProperty('background-position');
      html.style.removeProperty('background-attachment');
    };
  }, [imageUrl]);

  if (imageUrl) return null;

  return (
    <div className="glass-wallpaper pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <div className="glass-wallpaper-fallback h-full w-full" />
    </div>
  );
}
