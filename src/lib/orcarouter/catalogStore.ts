/**
 * OrcaRouter catalog store.
 *
 * Holds the capability-filtered catalog for the model selector. The catalog is loaded
 * through the provider layer, which owns the credential; the selector only ever receives
 * minimal model metadata (id + label + declared capabilities).
 *
 * A successful live load is authoritative. A failed load serves the verified seed and is
 * marked `degraded` so the UI can say so — it never degrades into free-text entry.
 */

import { create } from 'zustand';
import {
  loadOrcaCatalog,
  type OrcaCapability,
  type OrcaCatalog,
  type OrcaModality,
} from './catalog';

export interface OrcaCatalogKey {
  capability: OrcaCapability;
  requiresModalities: OrcaModality[];
}

function keyOf(k: OrcaCatalogKey): string {
  return `${k.capability}|${[...k.requiresModalities].sort().join(',')}`;
}

export interface OrcaCatalogState {
  entries: Record<string, OrcaCatalog>;
  loading: Record<string, boolean>;
  /** Load (or reload) the catalog for one capability + modality requirement. */
  load: (
    key: OrcaCatalogKey,
    options?: { apiBase?: string; apiKey?: string; force?: boolean },
  ) => Promise<OrcaCatalog>;
  get: (key: OrcaCatalogKey) => OrcaCatalog | undefined;
  isLoading: (key: OrcaCatalogKey) => boolean;
  /** Drop a cached entry so the next read refetches. */
  invalidate: (key?: OrcaCatalogKey) => void;
}

export const useOrcaCatalogStore = create<OrcaCatalogState>((set, get) => ({
  entries: {},
  loading: {},

  async load(key, options) {
    const k = keyOf(key);
    const cached = get().entries[k];
    if (cached && !options?.force) return cached;

    set((s) => ({ loading: { ...s.loading, [k]: true } }));
    try {
      const catalog = await loadOrcaCatalog({
        apiBase: options?.apiBase,
        apiKey: options?.apiKey,
        capability: key.capability,
        requiresModalities: key.requiresModalities,
      });
      set((s) => ({ entries: { ...s.entries, [k]: catalog } }));
      return catalog;
    } finally {
      set((s) => ({ loading: { ...s.loading, [k]: false } }));
    }
  },

  get(key) {
    return get().entries[keyOf(key)];
  },

  isLoading(key) {
    return !!get().loading[keyOf(key)];
  },

  invalidate(key) {
    if (!key) {
      set({ entries: {}, loading: {} });
      return;
    }
    const k = keyOf(key);
    set((s) => {
      const next = { ...s.entries };
      delete next[k];
      return { entries: next };
    });
  },
}));

/**
 * Text chat with the given attachment modalities.
 * No modalities means a plain text turn: the chat capability filter alone applies.
 */
export function textCatalogKey(
  requiredModalities: OrcaModality[] = [],
): OrcaCatalogKey {
  return { capability: 'chat', requiresModalities: requiredModalities };
}
