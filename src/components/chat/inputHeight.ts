/**
 * How tall the composer's textarea should be.
 *
 * The floor used to be a hand-tuned `rows={3}` plus a `MIN_INPUT_HEIGHT = 66` that had to be
 * kept in step with a CSS class by hand, so an empty composer sat three lines tall and every
 * font or density change made it wrong again. The floor is now one line of the element's own
 * metrics - line box plus its padding - which is what an empty one-line composer actually
 * costs, whatever the theme says the font is.
 */
export function oneLineHeight(styles: {
  lineHeight?: string;
  fontSize?: string;
  paddingTop?: string;
  paddingBottom?: string;
}): number {
  const line =
    parseFloat(styles.lineHeight || '') ||
    (parseFloat(styles.fontSize || '') || 16) * 1.5;
  const pad =
    (parseFloat(styles.paddingTop || '') || 0) +
    (parseFloat(styles.paddingBottom || '') || 0);
  return Math.round(line + pad);
}

export function nextInputHeight({
  contentHeight,
  oneLine,
  limit,
  manual = null,
}: {
  contentHeight: number;
  oneLine: number;
  limit: number;
  manual?: number | null;
}): number {
  const floor = Math.max(1, oneLine);
  const ceiling = Math.max(floor, limit);
  const wanted =
    manual !== null && manual > 0 ? manual : contentHeight || floor;
  return Math.min(Math.max(Math.round(wanted), floor), ceiling);
}
