/**
 * #157: a browser that cannot click still needs to see the glass theme. The URL is the
 * only input a headless screenshot has, so the stub seeds the same three preferences the
 * app itself reads - before initialization reads them, and never over values this tab has
 * already written.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSeedQuery } from '../devStore';

function memorySession(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

function enterBrowser(search: string) {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubGlobal('window', {
    location: { search },
    sessionStorage: memorySession(),
  });
}

async function loadDevStore() {
  vi.resetModules();
  return await import('../devStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('parseSeedQuery', () => {
  it('reads the three glass seeds and ignores the dev-store flag', () => {
    expect(
      parseSeedQuery(
        '?devStore=1&theme=dark&glass=1&wallpaper=data:image/png;base64,abc',
      ),
    ).toEqual({
      theme: 'dark',
      glass: true,
      wallpaper: 'data:image/png;base64,abc',
    });
  });

  it('accepts the glass switch as 0/false too', () => {
    expect(parseSeedQuery('?glass=0')).toEqual({ glass: false });
    expect(parseSeedQuery('?glass=false')).toEqual({ glass: false });
  });

  it('keeps a base64 plus sign instead of decoding it as a space', () => {
    expect(
      parseSeedQuery('?wallpaper=data:image/png;base64,abc+def').wallpaper,
    ).toBe('data:image/png;base64,abc+def');
    expect(
      parseSeedQuery('?wallpaper=data:image/png;base64,abc%2Bdef').wallpaper,
    ).toBe('data:image/png;base64,abc+def');
  });

  it('treats none as an explicit clear', () => {
    expect(parseSeedQuery('?wallpaper=none')).toEqual({ wallpaper: null });
  });

  it('ignores unknown keys and values it cannot accept', () => {
    expect(
      parseSeedQuery('?theme=blue&glass=yes&wallpaper=https%3A%2F%2Fx'),
    ).toEqual({});
    expect(parseSeedQuery('?something=else')).toEqual({});
    expect(parseSeedQuery('')).toEqual({});
  });
});

describe('seeding a fresh store', () => {
  it('writes theme and glass before the first read', async () => {
    enterBrowser(
      '?devStore=1&theme=dark&glass=1&wallpaper=data:image/png;base64,abc',
    );
    const { devStore } = await loadDevStore();

    const theme = devStore('app-storage.json');
    expect(await theme.get('app_theme')).toBe('dark');

    const preferences = devStore('user-preferences.json');
    expect(await preferences.get('ui_glass_theme')).toBe(true);
    expect(await preferences.get('ui_glass_wallpaper_file')).toBe(
      'data:image/png;base64,abc',
    );
  });

  it('leaves the wallpaper absent when the URL says none', async () => {
    enterBrowser('?devStore=1&wallpaper=none');
    const { devStore } = await loadDevStore();

    const preferences = devStore('user-preferences.json');
    expect(await preferences.get('ui_glass_wallpaper_file')).toBeUndefined();
  });

  it('lets a later none URL clear a wallpaper this URL seeded', async () => {
    enterBrowser('?devStore=1&wallpaper=data:image/png;base64,abc');
    const { devStore } = await loadDevStore();
    const preferences = devStore('user-preferences.json');
    expect(await preferences.get('ui_glass_wallpaper_file')).toBe(
      'data:image/png;base64,abc',
    );

    (globalThis as any).window.location.search = '?devStore=1&wallpaper=none';
    expect(
      await devStore('user-preferences.json').get('ui_glass_wallpaper_file'),
    ).toBeUndefined();
  });

  it('does not clear a wallpaper the page itself wrote', async () => {
    enterBrowser('?devStore=1&wallpaper=data:image/png;base64,abc');
    const { devStore } = await loadDevStore();
    const preferences = devStore('user-preferences.json');
    await preferences.set(
      'ui_glass_wallpaper_file',
      'data:image/png;base64,page',
    );

    (globalThis as any).window.location.search = '?devStore=1&wallpaper=none';
    expect(
      await devStore('user-preferences.json').get('ui_glass_wallpaper_file'),
    ).toBe('data:image/png;base64,page');
  });

  it('does not overwrite a value this tab already wrote', async () => {
    enterBrowser('?devStore=1&theme=dark');
    const { devStore } = await loadDevStore();

    const theme = devStore('app-storage.json');
    await theme.set('app_theme', 'light');
    // A later store call re-reads the same URL; the seeded value must not come back.
    expect(await devStore('app-storage.json').get('app_theme')).toBe('light');
  });

  it('does not seed in production or inside Tauri', async () => {
    enterBrowser('?devStore=1&theme=dark');
    vi.stubEnv('NODE_ENV', 'production');
    const production = await loadDevStore();
    expect(
      await production.devStore('app-storage.json').get('app_theme'),
    ).toBeUndefined();

    enterBrowser('?devStore=1&theme=dark');
    (globalThis as any).window.__TAURI_INTERNALS__ = {};
    const tauri = await loadDevStore();
    expect(
      await tauri.devStore('app-storage.json').get('app_theme'),
    ).toBeUndefined();
  });
});
