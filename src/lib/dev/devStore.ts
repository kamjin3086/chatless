/**
 * An in-memory stand-in for the Tauri store, so the settings routes render in a browser.
 *
 * #124: the provider list comes from the Tauri store, so a plain `next dev` in a browser
 * showed an empty settings page - one empty notification region - and every "the toggle
 * works" claim about provider settings was a read-the-code claim. With this in place the
 * app's own path runs unchanged: `ProviderInitializationService` writes the catalogue here,
 * the model and provider repositories read it back, and the routes render rows, key inputs
 * and status badges. The stub still starts from the app's own fresh-install path; a URL may
 * seed only the theme/glass preferences it explicitly asks for, before the app reads them.
 * It does not invent providers, models or other data.
 *
 * Turning it on: `?devStore=1` on any URL. The choice is remembered for the tab
 * (sessionStorage), so following a provider into a dialog or another settings tab keeps it;
 * `?devStore=0` turns it off again. A query flag rather than an env var means one `next dev`
 * serves both states.
 *
 * Seeding is evaluated whenever a store is touched. The app reads theme/glass during
 * initialization, so the seed URL belongs on the page load; an in-app navigation that adds
 * seed parameters later cannot re-apply the theme. A value this URL seeded may be updated
 * or cleared by a later URL; a value the page/test wrote is never overwritten.
 *
 * It cannot apply where it must not: inside Tauri, where a real store exists and a stub
 * would shadow the user's data, and in a production build. The build gate lives at the
 * import site in `StorageUtil.getStore`, on a `process.env.NODE_ENV` comparison the bundler
 * inlines, so a production payload does not import this module at all - a guard inside this
 * file could not do that, because the caller's argument object is evaluated before the
 * branch is taken.
 */
import { isTauriEnvironment } from '@/lib/utils/environment';
import {
  GLASS_THEME_KEY,
  GLASS_WALLPAPER_KEY,
  THEME_KEY,
} from '@/lib/preferences/keys';

/** Query parameter that switches the stub on for this tab. */
export const DEV_STORE_QUERY = 'devStore';

/** Remembers the choice for the tab, so navigation does not silently drop it. */
export const DEV_STORE_SESSION_KEY = 'chatless:dev-store';

export type SeedTheme = 'light' | 'dark' | 'system';

/** The preferences a URL may seed into a fresh in-memory store. */
export interface DevStoreSeed {
  theme?: SeedTheme;
  glass?: boolean;
  /** A wallpaper data URL, or null for "none" (leave the key absent). */
  wallpaper?: string | null;
}

/** The two stores the seeded preferences live in. */
const THEME_STORE = 'app-storage.json';
const USER_PREFERENCES_STORE = 'user-preferences.json';

/**
 * Read the seed preferences from the page query.
 *
 * A pure function so the parser can be tested without a browser. Unknown keys and
 * unaccepted values are ignored rather than repaired: a URL that says `theme=blue` should
 * leave the app's own default in place, and a wallpaper is only accepted in the data-URL
 * form the browser path already stores (an http URL is not a local setting).
 */
export function parseSeedQuery(search: string): DevStoreSeed {
  const seed: DevStoreSeed = {};

  const theme = rawQueryValue(search, 'theme')?.toLowerCase();
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    seed.theme = theme;
  }

  const glass = rawQueryValue(search, 'glass');
  if (glass === '1' || glass === 'true') seed.glass = true;
  else if (glass === '0' || glass === 'false') seed.glass = false;

  const wallpaper = rawQueryValue(search, 'wallpaper');
  if (wallpaper === 'none') seed.wallpaper = null;
  else if (wallpaper?.startsWith('data:image/')) seed.wallpaper = wallpaper;

  return seed;
}

/**
 * Read one query value without `URLSearchParams`' `+` -> space decoding. A base64 data URL
 * commonly contains `+`; decoding it as a space silently corrupts the wallpaper.
 */
function rawQueryValue(search: string, name: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    let key: string;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      continue;
    }
    if (key !== name) continue;
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      // A bare `%` is not valid percent-encoding, but a data URL may still contain one;
      // keep the raw value instead of dropping the wallpaper.
      return rawValue;
    }
  }
  return null;
}

interface SeedRule {
  source: keyof DevStoreSeed;
  key: string;
  /** A null source value means "clear", not "write null" (only the wallpaper today). */
  clearOnNull?: boolean;
}

/** Which store gets which seed field. Adding a seed target is one row. */
const SEED_RULES: Record<string, readonly SeedRule[]> = {
  [THEME_STORE]: [{ source: 'theme', key: THEME_KEY }],
  [USER_PREFERENCES_STORE]: [
    { source: 'glass', key: GLASS_THEME_KEY },
    { source: 'wallpaper', key: GLASS_WALLPAPER_KEY, clearOnNull: true },
  ],
};

interface StoreState {
  rows: Map<string, unknown>;
  /** Keys this URL put there, so a later URL can update/clear a seed, not a page write. */
  seeded: Set<string>;
}

/**
 * Apply the URL's seed to one store. A key this URL put there may be updated or cleared by
 * a later URL; a key the page/test wrote is not in the mark set and wins.
 */
function seedRows(name: string, state: StoreState, seed: DevStoreSeed): void {
  const canWrite = (key: string) =>
    !state.rows.has(key) || state.seeded.has(key);
  const write = (key: string, value: unknown) => {
    if (!canWrite(key)) return;
    state.rows.set(key, copy(value));
    state.seeded.add(key);
  };
  const clear = (key: string) => {
    if (!canWrite(key)) return;
    state.rows.delete(key);
    state.seeded.delete(key);
  };

  for (const rule of SEED_RULES[name] ?? []) {
    const value = seed[rule.source];
    if (value === undefined) continue;
    if (value === null) {
      if (rule.clearOnNull) clear(rule.key);
      continue;
    }
    write(rule.key, value);
  }
}

export interface DevStoreConditions {
  nodeEnv: string | undefined;
  /** Whether a real Tauri store exists in this runtime. */
  tauri: boolean;
  /** Whether this tab asked for the stub (`?devStore=1`, or an earlier request). */
  requested: boolean;
}

/** The rule, with its inputs handed in so it can be stated without a browser. */
export function devStoreApplies({
  nodeEnv,
  tauri,
  requested,
}: DevStoreConditions): boolean {
  return nodeEnv !== 'production' && requested && !tauri;
}

/** Whether this page should read and write through the in-memory store. */
export function devStoreEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return devStoreApplies({
    nodeEnv: process.env.NODE_ENV,
    tauri: isTauriEnvironment(),
    requested: requestedForThisTab(),
  });
}

/**
 * `?devStore=1` sets this tab's choice, `?devStore=0` clears it; otherwise it is recalled.
 * It writes as well as reads - that is how the choice survives a route change - so it is
 * named for the tab's request rather than for a predicate over the URL.
 */
function requestedForThisTab(): boolean {
  const session = safeSession();
  const flag = new URLSearchParams(window.location?.search ?? '').get(
    DEV_STORE_QUERY,
  );
  if (flag !== null) {
    const on = flag !== '0' && flag !== 'false';
    try {
      if (on) session?.setItem(DEV_STORE_SESSION_KEY, '1');
      else session?.removeItem(DEV_STORE_SESSION_KEY);
    } catch {
      /* a browser that refuses sessionStorage keeps the query flag working per page */
    }
    return on;
  }
  try {
    return session?.getItem(DEV_STORE_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function safeSession(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** The subset of the Tauri `Store` this app uses. */
export interface DevStore {
  set(key: string, value: unknown): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  length(): Promise<number>;
  save(): Promise<void>;
}

const stores = new Map<string, StoreState>();

/**
 * One store per file name, the way the Tauri plugin has one per file - so `model-parameters
 * .json` and `providers-config.json` cannot see each other's keys even in the stub.
 *
 * Values cross the boundary as JSON, in both directions, because that is what the real store
 * does: it serializes on write and parses on read. Storing a reference would let a caller
 * mutate stored data (the real one cannot be mutated that way), and would also keep types
 * the real store would have flattened - so a bug that only appears against real storage
 * would stay hidden in the stub.
 */
export function devStore(name: string): DevStore {
  let state = stores.get(name);
  if (!state) {
    state = { rows: new Map<string, unknown>(), seeded: new Set<string>() };
    stores.set(name, state);
  }
  const { rows, seeded } = state;

  // Seed on every touch, before that store answers. The app reads theme/glass during
  // initialization, so the URL belongs on the page load; rows this URL seeded may still be
  // updated by a later URL, while a value the page/test wrote removes its mark and wins.
  if (devStoreEnabled()) {
    seedRows(name, state, parseSeedQuery(window.location?.search ?? ''));
  }

  return {
    async set(key, value) {
      rows.set(key, copy(value));
      seeded.delete(key);
    },
    async get<T = unknown>(key: string) {
      return copy(rows.get(key)) as T | undefined;
    },
    async has(key) {
      return rows.has(key);
    },
    async delete(key) {
      seeded.delete(key);
      return rows.delete(key);
    },
    async clear() {
      rows.clear();
      seeded.clear();
    },
    async keys() {
      return [...rows.keys()];
    },
    async length() {
      return rows.size;
    },
    async save() {
      /* there is no file to flush */
    },
  };
}

/** What the real store does to a value on the way in and on the way out. */
function copy(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
