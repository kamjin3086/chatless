/**
 * How tall the composer's textarea should be.
 *
 * The floor used to be a hand-tuned `rows={3}` plus a `MIN_INPUT_HEIGHT = 66` that had to be
 * kept in step with a CSS class by hand, so an empty composer sat three lines tall and every
 * font or density change made it wrong again. It was replaced by one line of the element's
 * own metrics - which then made an empty composer a single row, and a single row reads like a
 * search field rather than a place to write a message.
 *
 * So the floor is a line count, measured against the element's metrics: an empty composer sits
 * two lines tall whatever the theme says the font is, and the drag/auto-grow bounds still
 * apply above it.
 */

/** An empty composer: room to write, not a single-row input. */
export const COMPOSER_FLOOR_LINES = 2;

function metrics(styles: {
  lineHeight?: string;
  fontSize?: string;
  paddingTop?: string;
  paddingBottom?: string;
}): { line: number; pad: number } {
  const line =
    parseFloat(styles.lineHeight || '') ||
    (parseFloat(styles.fontSize || '') || 16) * 1.5;
  const pad =
    (parseFloat(styles.paddingTop || '') || 0) +
    (parseFloat(styles.paddingBottom || '') || 0);
  return { line, pad };
}

/** One line box plus the element's own vertical padding. */
export function oneLineHeight(styles: {
  lineHeight?: string;
  fontSize?: string;
  paddingTop?: string;
  paddingBottom?: string;
}): number {
  const { line, pad } = metrics(styles);
  return Math.round(line + pad);
}

/** The shortest a composer may be: `COMPOSER_FLOOR_LINES` lines plus that padding. */
export function composerFloor(
  styles: {
    lineHeight?: string;
    fontSize?: string;
    paddingTop?: string;
    paddingBottom?: string;
  },
  lines: number = COMPOSER_FLOOR_LINES,
): number {
  const { line, pad } = metrics(styles);
  return Math.round(line * Math.max(1, lines) + pad);
}

export function nextInputHeight({
  contentHeight,
  floor,
  limit,
  manual = null,
}: {
  contentHeight: number;
  floor: number;
  limit: number;
  manual?: number | null;
}): number {
  const bottom = Math.max(1, floor);
  const ceiling = Math.max(bottom, limit);
  const wanted =
    manual !== null && manual > 0 ? manual : contentHeight || bottom;
  return Math.min(Math.max(Math.round(wanted), bottom), ceiling);
}
