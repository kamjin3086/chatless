"use client";

import { useEffect, useState } from 'react';
import { applyNightBrightnessCss, nightOverlayFromBrightness } from '@/lib/utils/nightBrightness';
import { useUiPreferences } from '@/store/uiPreferences';

function useIsDarkTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const sync = () => setIsDark(html.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

/** 仅在暗色模式下用一层黑色遮罩压低界面亮度，避免 filter 影响 fixed 层。 */
export function NightBrightnessApplier() {
  const initialized = useUiPreferences((s) => s.initialized);
  const nightBrightness = useUiPreferences((s) => s.nightBrightness);
  const isDark = useIsDarkTheme();

  useEffect(() => {
    if (!initialized) return;
    applyNightBrightnessCss(nightBrightness);
  }, [initialized, nightBrightness]);

  const overlay = nightOverlayFromBrightness(nightBrightness);
  if (!initialized || !isDark || overlay < 0.005) return null;

  return (
    <div className="night-dim-veil" aria-hidden="true" />
  );
}
