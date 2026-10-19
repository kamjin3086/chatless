/**
 * An in-memory stand-in for the Tauri store, so the settings routes render in a browser.
 *
 * #124: the provider list comes from the Tauri store, so a plain `next dev` in a browser
 * showed an empty settings page - one empty notification region - and every "the toggle
 * works" claim about provider settings was a read-the-code claim. With this in place the
 * app's own path runs unchanged: `ProviderInitializationService` writes the catalogue here,
 * the model and provider repositories read it back, and the routes render rows, key inputs
 * and status badges. Nothing is seeded by hand, so a browser cannot disagree with the app
 * about what "a fresh install" looks like.
 *
 * Turning it on: `?devStore=1` on any URL. The choice is remembered for the tab
 * (sessionStorage), so following a provider into a dialog or another settings tab keeps it;
 * `?devStore=0` turns it off again. A query flag rather than an env var means one `next dev`
 * serves both states.
 *
 * It cannot apply where it must not: inside Tauri, where a real store exists and a stub
 * would shadow the user's data, and in a production build. The build gate lives at the
 * import site in `StorageUtil.getStore`, on a `process.env.NODE_ENV` comparison the bundler
 * inlines, so a production payload does not import this module at all - a guard inside this
 * file could not do that, because the caller's argument object is evaluated before the
 * branch is taken.
 */
import { isTauriEnvironment } from '@/lib/utils/environment';

/** Query parameter that switches the stub on for this tab. */
export const DEV_STORE_QUERY = 'devStore';

/** Remembers the choice for the tab, so navigation does not silently drop it. */
export const DEV_STORE_SESSION_KEY = 'chatless:dev-store';

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

const stores = new Map<string, Map<string, unknown>>();

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
  let rows = stores.get(name);
  if (!rows) {
    rows = new Map<string, unknown>();
    stores.set(name, rows);
  }
  const data = rows;

  return {
    async set(key, value) {
      data.set(key, copy(value));
    },
    async get<T = unknown>(key: string) {
      return copy(data.get(key)) as T | undefined;
    },
    async has(key) {
      return data.has(key);
    },
    async delete(key) {
      return data.delete(key);
    },
    async clear() {
      data.clear();
    },
    async keys() {
      return [...data.keys()];
    },
    async length() {
      return data.size;
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
