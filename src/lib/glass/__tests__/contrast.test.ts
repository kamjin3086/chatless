/**
 * The contrast floor, as arithmetic.
 *
 * The theme's promise is "body text stays readable on any wallpaper". That is only checkable
 * if the promise is a computation: composite the actual stack - photo, veil, panel fill,
 * text - and compare against the WCAG floor. These tests pin the arithmetic with known
 * pairs, and pin the theme's own tokens against the floor using the veil values it ships.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_FLOOR,
  composite,
  contrastOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from '../contrast';

const ROOT = path.resolve(__dirname, '../../..');

describe('the compositing arithmetic', () => {
  it('reads the colour forms the theme uses', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0d1015')).toEqual({ r: 13, g: 16, b: 21, a: 1 });
    expect(parseColor('rgba(5, 8, 13, 0.38)')).toEqual({
      r: 5,
      g: 8,
      b: 13,
      a: 0.38,
    });
    expect(parseColor('rgb(250 252 255 / 95%)')).toEqual({
      r: 250,
      g: 252,
      b: 255,
      a: 0.95,
    });
  });

  it('matches the WCAG reference values', () => {
    expect(contrastRatio(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(
      21,
      5,
    );
    // #767676 on white is the canonical "exactly AA" grey (4.54:1).
    expect(
      contrastRatio(parseColor('#767676'), parseColor('#ffffff')),
    ).toBeCloseTo(4.54, 1);
    // Order must not matter.
    expect(contrastRatio(parseColor('#fff'), parseColor('#000'))).toBeCloseTo(
      21,
      5,
    );
  });

  it('composites a translucent layer over what is behind it', () => {
    const half = composite(
      parseColor('rgba(0, 0, 0, 0.5)'),
      parseColor('#fff'),
    );
    expect(half.r).toBe(128);
    expect(relativeLuminance(half)).toBeLessThan(
      relativeLuminance(parseColor('#fff')),
    );
  });
});

describe('the glass theme keeps text above its floor', () => {
  // The cheapest wallpapers the veil has to survive, as the extremes of the luminance range a
  // photograph can carry.
  const BLACK_PHOTO = '#000000';
  const WHITE_PHOTO = '#ffffff';

  /**
   * The tokens are read from `globals.css`, not restated here. The first version of this test
   * hard-coded the veil and the sheet fill it was written against; both then changed, the test
   * kept passing, and a bright wallpaper put muted text at 2.75:1 in the rendered window. A
   * check that restates the values it checks cannot catch that.
   */
  const GLOBALS = readFileSync(path.join(ROOT, 'styles/globals.css'), 'utf8');

  function block(selector: string): string {
    const index = GLOBALS.indexOf(selector);
    expect(index, selector).toBeGreaterThanOrEqual(0);
    const open = GLOBALS.indexOf('{', index);
    const close = GLOBALS.indexOf('}', open);
    return GLOBALS.slice(open + 1, close);
  }

  function token(body: string, name: string): string {
    const match = body.match(new RegExp(`${name}\s*:\s*([^;]+);`));
    expect(match, name).toBeTruthy();
    return match![1].trim();
  }

  const LIGHT = block('.glass-ui {');
  const DARK = block('.glass-ui.dark {');

  /** Every fill the theme paints text on, bottom level first. */
  const FILLS = [
    ['the sheet', '--glass-base-fill'],
    ['a card', '--glass-surface-fill'],
    ['a control', '--glass-control-fill'],
  ] as const;

  const TEXT = [
    ['primary', '--glass-text-primary', CONTRAST_FLOOR.body],
    ['secondary', '--glass-text-secondary', CONTRAST_FLOOR.body],
    ['muted', '--glass-text-muted', CONTRAST_FLOOR.large],
  ] as const;

  for (const [theme, body, photo] of [
    ['dark', DARK, WHITE_PHOTO],
    ['light', LIGHT, BLACK_PHOTO],
  ] as const) {
    const veil = token(body, '--glass-veil');

    for (const [fillLabel, fillToken] of FILLS) {
      for (const [textLabel, textToken, floor] of TEXT) {
        it(`${theme}: ${textLabel} text on ${fillLabel} clears its floor over the extreme photo`, () => {
          const ratio = contrastOver(
            token(body, textToken),
            photo,
            [veil, token(body, fillToken)],
          );
          expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(floor);
        });
      }
    }

    it(`${theme}: text over the opaque overlay leaves the glass channel entirely`, () => {
      const ratio = contrastOver(token(body, '--glass-text-primary'), photo, [
        token(body, '--glass-overlay-fill'),
      ]);
      expect(ratio).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
    });
  }
});
