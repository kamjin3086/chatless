export const NIGHT_BRIGHTNESS_MIN = 50;
export const NIGHT_BRIGHTNESS_MAX = 100;
export const NIGHT_BRIGHTNESS_DEFAULT = 100;

export function clampNightBrightness(value: number): number {
  if (!Number.isFinite(value)) return NIGHT_BRIGHTNESS_DEFAULT;
  return Math.min(NIGHT_BRIGHTNESS_MAX, Math.max(NIGHT_BRIGHTNESS_MIN, Math.round(value)));
}

/** 将 50–100 的亮度映射为黑色遮罩透明度。100 为当前默认，50 约 42% 遮罩，避免文字被压没。 */
export function nightOverlayFromBrightness(percent: number): number {
  const t = 1 - clampNightBrightness(percent) / 100;
  return Math.round(t * 0.84 * 1000) / 1000;
}

export function applyNightBrightnessCss(percent: number): void {
  if (typeof document === 'undefined') return;
  const clamped = clampNightBrightness(percent);
  const overlay = nightOverlayFromBrightness(clamped);
  const mix = Math.round((1 - clamped / 100) * 100);
  const html = document.documentElement;
  html.style.setProperty('--night-brightness', String(clamped / 100));
  html.style.setProperty('--night-overlay', String(overlay));
  html.style.setProperty('--night-mix', `${mix}%`);
}
