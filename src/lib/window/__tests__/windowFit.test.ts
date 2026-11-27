import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_WINDOW_SIZE_PRESET,
  describeWindowFit,
  formatWindowSizePreset,
  MIN_WINDOW_SIZE,
  parseWindowSizePreset,
  WINDOW_SIZE_PRESETS,
} from '../windowFit';

type MainWindow = {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
};

/** The `main` window from one of the Tauri config files, read from the repo rather than assumed. */
function mainWindow(file: string): MainWindow {
  const config = JSON.parse(
    readFileSync(
      new URL(`../../../../src-tauri/${file}`, import.meta.url),
      'utf8',
    ),
  ) as { app: { windows: MainWindow[] } };
  const main = config.app.windows.find((w) => w && w.width && w.height);
  if (!main) throw new Error(`${file} has no sized window`);
  return main;
}

describe('the size presets', () => {
  test('offers the default among them, and labels it with the stored value', () => {
    expect(WINDOW_SIZE_PRESETS).toContain(DEFAULT_WINDOW_SIZE_PRESET);
    expect(formatWindowSizePreset(DEFAULT_WINDOW_SIZE_PRESET)).toBe(
      '1280 × 760',
    );
  });

  // The preset is only applied when the settings row changes, so a fresh install is sized by
  // the config - and the row still says which size it calls the default. When the two drift, the
  // settings page describes a window the app never opens: the first launch of #169-era builds was
  // 900x700 while the row said 1024x768.
  test('keeps the default the same size the desktop config opens', () => {
    const main = mainWindow('tauri.conf.json');
    expect(`${main.width}x${main.height}`).toBe(DEFAULT_WINDOW_SIZE_PRESET);
  });

  // The acceptance runs drive this window over WebDriver, so a size that only a user never sees
  // would make every screenshot from them describe a layout nobody gets.
  test('sizes the acceptance window like the shipping one', () => {
    const shipped = mainWindow('tauri.conf.json');
    const e2e = mainWindow('tauri.e2e.conf.json');
    expect({ width: e2e.width, height: e2e.height }).toEqual({
      width: shipped.width,
      height: shipped.height,
    });
  });

  // Shrinking past this does not resize the layout, it clips it - which is reported as a broken
  // window size. The floor is the layout's: see MIN_WINDOW_SIZE.
  test('keeps the configured floor at the size the layout needs', () => {
    const main = mainWindow('tauri.conf.json');
    expect({ width: main.minWidth, height: main.minHeight }).toEqual(
      MIN_WINDOW_SIZE,
    );
    const e2e = mainWindow('tauri.e2e.conf.json');
    expect({ width: e2e.minWidth, height: e2e.minHeight }).toEqual(
      MIN_WINDOW_SIZE,
    );
  });
});

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
