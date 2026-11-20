import { describe, expect, test } from 'vitest';
import { describeWindowFit, parseWindowSizePreset } from '../windowFit';

describe('parseWindowSizePreset', () => {
  test('reads the preset shape the settings select stores', () => {
    expect(parseWindowSizePreset('1024x768')).toEqual({
      width: 1024,
      height: 768,
    });
    expect(parseWindowSizePreset(' 1440x900 ')).toEqual({
      width: 1440,
      height: 900,
    });
  });

  test('rejects anything that is not "<width>x<height>"', () => {
    expect(parseWindowSizePreset('1024×768')).toBeNull();
    expect(parseWindowSizePreset('1024 x 768')).toBeNull();
    expect(parseWindowSizePreset('big')).toBeNull();
    expect(parseWindowSizePreset('')).toBeNull();
    expect(parseWindowSizePreset('0x700')).toBeNull();
    expect(parseWindowSizePreset('-1024x768')).toBeNull();
  });
});

describe('describeWindowFit', () => {
  // The reported display: 1536x864 at 125 % leaves 1228x691 usable, so the
  // Rust side answers with a shorter window than the 1024x768 preset asked for.
  test('says the display cost the user height', () => {
    expect(
      describeWindowFit(
        { width: 1024, height: 768 },
        {
          size: { width: 1024, height: 691 },
          workArea: { width: 1228, height: 691 },
        },
      ),
    ).toEqual({
      requested: { width: 1024, height: 768 },
      applied: { width: 1024, height: 691 },
      workArea: { width: 1228, height: 691 },
      reduced: true,
    });
  });

  test('keeps the preset when the window took it whole', () => {
    const fitted = describeWindowFit(
      { width: 1024, height: 768 },
      {
        size: { width: 1024, height: 768 },
        workArea: { width: 1536, height: 816 },
      },
    );
    expect(fitted.applied).toEqual({ width: 1024, height: 768 });
    expect(fitted.reduced).toBe(false);
  });

  test('floors a fractional logical size instead of claiming the extra pixel', () => {
    const fitted = describeWindowFit(
      { width: 1280, height: 800 },
      {
        size: { width: 1227.2, height: 690.6 },
        workArea: { width: 1227.2, height: 690.6 },
      },
    );
    expect(fitted.applied).toEqual({ width: 1227, height: 690 });
    expect(fitted.reduced).toBe(true);
  });
});
