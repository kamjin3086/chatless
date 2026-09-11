'use client';

/**
 * OrcaRouter integration preview (development tool).
 *
 * Renders the real OrcaRouter provider panel and a real `role="listbox"` model dropdown
 * so the integration's two authentication choices and its capability-filtered model
 * lists can be captured and asserted by an automated UI check.
 *
 * The catalog is real live data captured from `GET /v1/models` and written next to this
 * page by `scripts/screenshot_evidence.py`; it is parsed and filtered here by the
 * project's own `@/lib/orcarouter/catalog` module, the same code the app uses. The page
 * reads it over same-origin HTTP because a static export has no server runtime to proxy
 * the authenticated request — the API key stays on the harness side and never reaches
 * the browser.
 *
 * Follows the existing `src/app/dev-tools/*` preview-page convention in this repository.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { OrcaRouterConnectPanel } from '@/components/settings/OrcaRouterConnectPanel';
import {
  filterCatalog,
  parseCatalogResponse,
  type OrcaCatalog,
  type OrcaModel,
  type OrcaModality,
} from '@/lib/orcarouter/catalog';

export default function OrcaRouterPreviewPage() {
  const [catalog, setCatalog] = useState<OrcaCatalog | null>(null);
  const [activeModalities, setActiveModalities] = useState<OrcaModality[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/orcarouter-catalog.json', {
          cache: 'no-store',
        });
        const payload = await res.json();
        const models = parseCatalogResponse(payload);
        setCatalog({ models, source: 'live', degraded: false, fetchedAt: 0 });
      } catch {
        setCatalog({
          models: [],
          source: 'seed',
          degraded: true,
          fetchedAt: 0,
        });
      }
    })();
  }, []);

  const allModels = catalog?.models ?? [];
  const chatModels = useMemo(
    () => filterCatalog(allModels, { capability: 'chat' }),
    [allModels],
  );
  const imageModels = useMemo(
    () =>
      filterCatalog(allModels, {
        capability: 'chat',
        requiresModalities: ['image'],
      }),
    [allModels],
  );

  // Entry point under test: the harness flips the required modality the way attaching an
  // image in the chat input would, and the option list is recomputed from the real catalog.
  const visible = useMemo(
    () =>
      filterCatalog(allModels, {
        capability: 'chat',
        requiresModalities: activeModalities,
      }),
    [allModels, activeModalities],
  );

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__orcaCatalog = {
      chatTotal: chatModels.length,
      imageTotal: imageModels.length,
    };
    (window as unknown as Record<string, unknown>).__orcaSetModalities = (
      mods: OrcaModality[],
    ) => {
      setActiveModalities(mods);
    };
  }, [chatModels.length, imageModels.length]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold text-slate-800">
            OrcaRouter integration preview
          </h1>
          <p className="text-xs text-slate-500">
            {catalog
              ? `${allModels.length} models in the live catalog`
              : 'loading catalog…'}
          </p>
        </header>

        <div className="rounded-lg border border-slate-200/70 bg-white p-3">
          <OrcaRouterConnectPanel />
        </div>

        <ModelDropdownPreview models={visible} />
      </div>
    </div>
  );
}

/**
 * Model dropdown built from the project's own listbox styling: the floating panel has an
 * opaque background, a visible border, and its right edge lines up with the trigger's.
 */
function ModelDropdownPreview({ models }: { models: OrcaModel[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative rounded-lg border border-slate-200/70 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-700">模型</span>
        <button
          type="button"
          data-testid="orcarouter-model-trigger"
          aria-haspopup="listbox"
          aria-expanded={open ? 'true' : 'false'}
          onClick={() => setOpen((v) => !v)}
          className="h-8 rounded-md border border-slate-200/70 px-2.5 text-xs transition-colors hover:bg-slate-100"
        >
          {models[0]?.label || '选择模型'} ▾
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          aria-label="OrcaRouter models"
          className="absolute right-3 top-[52px] z-50 max-h-[420px] overflow-y-auto rounded-2xl border border-slate-300/80 bg-white shadow-2xl"
          style={{ width: 360 }}
        >
          {models.map((m) => (
            <div
              key={m.id}
              role="option"
              aria-selected={false}
              className="px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
            >
              <div className="font-medium">{m.label}</div>
              <div className="text-[10px] text-slate-400">{m.id}</div>
            </div>
          ))}
        </div>
      )}

      <p
        className="mt-2 text-[11px] text-slate-400"
        data-testid="orcarouter-model-count"
      >
        {models.length} models visible for the current input
      </p>
    </div>
  );
}
