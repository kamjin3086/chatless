/**
 * Composited contrast, so "the text is readable over a wallpaper" is a number instead of an
 * opinion.
 *
 * Glass puts text over something the author of the theme did not choose: a photograph, with
 * a veil over it, with a translucent panel over that. The only way to state a floor is to
 * compute the ratio between the colour that ends up under the glyphs and the colour of the
 * glyphs - which is what this does, using the WCAG definitions.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const HEX = /^#([0-9a-f]{3,8})$/i;
const FUNCTIONAL = /^rgba?\(([^)]+)\)$/i;

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`. Throws otherwise. */
export function parseColor(value: string): Rgba {
  const text = value.trim();
  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b, a] = digits.split('').map((d) => parseInt(d + d, 16));
      return { r, g, b, a: digits.length === 4 ? a / 255 : 1 };
    }
    if (digits.length === 6 || digits.length === 8) {
      const r = parseInt(digits.slice(0, 2), 16);
      const g = parseInt(digits.slice(2, 4), 16);
      const b = parseInt(digits.slice(4, 6), 16);
      const a =
        digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    throw new Error(`unsupported hex colour: ${value}`);
  }
  const fn = FUNCTIONAL.exec(text);
  if (fn) {
    // `rgb(a, b, c)`, `rgb(a b c / d)` and `rgba(a, b, c, d)` all occur in the theme.
    const parts = fn[1]
      .split(/[,/]|\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 3) throw new Error(`unsupported colour: ${value}`);
    const [r, g, b, a] = parts;
    return {
      r: clampByte(parseFloat(r)),
      g: clampByte(parseFloat(g)),
      b: clampByte(parseFloat(b)),
      a:
        a === undefined
          ? 1
          : Math.min(
              1,
              Math.max(
                0,
                a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a),
              ),
            ),
    };
  }
  throw new Error(`unsupported colour: ${value}`);
}

/** `top` painted over `bottom`, straight alpha compositing. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) =>
    (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return {
    r: clampByte(mix(top.r, bottom.r)),
    g: clampByte(mix(top.g, bottom.g)),
    b: clampByte(mix(top.b, bottom.b)),
    a,
  };
}

/** WCAG relative luminance. Alpha is ignored: callers composite first. */
export function relativeLuminance(color: Rgba): number {
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * toLinear(color.r) +
    0.7152 * toLinear(color.g) +
    0.0722 * toLinear(color.b)
  );
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The ratio a reader actually gets: `text` composited over the surfaces that sit between it
 * and the backdrop, then measured against the backdrop. Layers are ordered from the
 * bottom up - wallpaper, veil, panel fill - and the text is composited over the result.
 */
export function contrastOver(
  text: string,
  backdrop: string,
  layers: readonly string[] = [],
): number {
  let background = parseColor(backdrop);
  for (const layer of layers) {
    background = composite(parseColor(layer), background);
  }
  const foreground = composite(parseColor(text), background);
  return contrastRatio(foreground, background);
}

/** WCAG AA floors: 4.5 for body text, 3 for large text. */
export const CONTRAST_FLOOR = { body: 4.5, large: 3 } as const;
