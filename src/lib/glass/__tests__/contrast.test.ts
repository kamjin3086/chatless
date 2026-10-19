/**
 * The contrast floor, as arithmetic.
 *
 * The theme's promise is "body text stays readable on any wallpaper". That is only checkable
 * if the promise is a computation: composite the actual stack - photo, veil, panel fill,
 * text - and compare against the WCAG floor. These tests pin the arithmetic with known
 * pairs, and pin the theme's own tokens against the floor using the veil values it ships.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_FLOOR,
  composite,
  contrastOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from '../contrast';

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
  // The darkest and brightest wallpapers the veil has to survive, as the extremes of the
  // luminance range a photograph can carry.
  const BLACK_PHOTO = '#000000';
  const WHITE_PHOTO = '#ffffff';

  // The veil values the theme ships. They were raised until the *dimmest* token cleared its
  // floor over a pure-white (dark theme) and pure-black (light theme) photograph - the two
  // extremes no photo can exceed. That is why they look high: a mid-luminance backdrop cannot
  // carry both dark and light text at 4.5, so the photo has to be pushed to one end.
  const DARK_LAYERS = ['rgba(5, 8, 13, 0.75)', 'rgba(255, 255, 255, 0.07)'];
  const LIGHT_LAYERS = [
    'rgba(248, 250, 252, 0.76)',
    'rgba(255, 255, 255, 0.26)',
  ];

  it('dark theme: all three text levels clear their floor over a white photograph', () => {
    expect(
      contrastOver('rgb(241, 245, 249)', WHITE_PHOTO, DARK_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
    expect(
      contrastOver('rgb(203, 213, 225)', WHITE_PHOTO, DARK_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
    expect(
      contrastOver('rgb(148, 163, 184)', WHITE_PHOTO, DARK_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.large);
    // and a black photograph is easier still
    expect(
      contrastOver('rgb(241, 245, 249)', BLACK_PHOTO, DARK_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
  });

  it('light theme: all three text levels clear their floor over a black photograph', () => {
    expect(
      contrastOver('rgb(30, 41, 59)', BLACK_PHOTO, LIGHT_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
    expect(
      contrastOver('rgb(71, 85, 105)', BLACK_PHOTO, LIGHT_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
    expect(
      contrastOver('rgb(100, 116, 139)', BLACK_PHOTO, LIGHT_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.large);
    expect(
      contrastOver('rgb(30, 41, 59)', WHITE_PHOTO, LIGHT_LAYERS),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
  });

  it('overlays carry text well above the floor by staying opaque', () => {
    const layers = ['rgba(250, 252, 255, 0.95)'];
    expect(
      contrastOver('rgb(30, 41, 59)', WHITE_PHOTO, layers),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
    const darkLayers = ['rgba(17, 20, 27, 0.95)'];
    expect(
      contrastOver('rgb(241, 245, 249)', BLACK_PHOTO, darkLayers),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
  });
});
