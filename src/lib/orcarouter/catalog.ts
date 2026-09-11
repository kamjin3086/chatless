/**
 * OrcaRouter model catalog and capability filtering.
 *
 * The single source of truth is `GET /v1/models` on the configured inference origin
 * (default `https://api.orcarouter.ai/v1`). The request is made with the user's own
 * OrcaRouter key so the list reflects what that workspace can actually call.
 *
 * Nothing here is keyed off a model's *name*. A model is admitted to a capability bucket
 * only when the catalog metadata says so, and a model that does not declare a required
 * modality fails closed instead of being offered optimistically.
 */

import type { OrcaOrigins } from './origins';
import { resolveOrcaOrigins } from './origins';

/** Endpoint types that can serve a text chat/completion turn. */
export const TEXT_ENDPOINT_TYPES = [
  'openai',
  'anthropic',
  'gemini',
  'openai-response',
] as const;

/** Endpoint types that are exclusively non-text and must never enter a text dropdown. */
export const NON_TEXT_ENDPOINT_TYPES = [
  'image-generation',
  'openai-video',
  'jina-rerank',
] as const;

export type OrcaCapability =
  | 'chat'
  | 'embedding'
  | 'image'
  | 'video'
  | 'rerank';

/** Input modalities as declared by the catalog. `text` is included for fidelity. */
export type OrcaModality = 'text' | 'image' | 'audio' | 'video' | 'file';

export interface OrcaModel {
  /** Raw catalog id, vendor/model namespace preserved verbatim. */
  id: string;
  label: string;
  supportedEndpointTypes: string[];
  /** Declared input modalities. `null` means the catalog did not declare any. */
  inputModalities: OrcaModality[] | null;
  contextLength?: number;
  maxCompletionTokens?: number;
  description?: string;
  /** Reasoning-effort ladder, only where the catalog/spec verifies it. */
  reasoningEfforts?: string[];
  /** True when this entry came from the verified seed rather than live discovery. */
  fromSeed?: boolean;
}

export interface OrcaCatalog {
  models: OrcaModel[];
  /** Where this catalog came from. */
  source: 'live' | 'seed';
  /** True when live discovery failed and a fallback is being served. */
  degraded: boolean;
  fetchedAt: number;
  /** Present when `degraded` is true. */
  reason?: string;
}

/** Bounded so a catalog response cannot consume unbounded memory. */
export const CATALOG_LIMITS = {
  timeoutMs: 12_000,
  maxBytes: 4 * 1024 * 1024,
  maxItems: 800,
} as const;

/**
 * Verified cold-start seed, used only when live discovery fails.
 *
 * Metadata below was read from `GET https://api.orcarouter.ai/v1/models` on 2026-09-11 and
 * is retained verbatim so an outage does not silently drop context windows, input
 * modalities, or the reasoning ladder.
 */
export const ORCA_SEED_MODELS: OrcaModel[] = [
  {
    id: 'openai/gpt-5.5',
    label: 'OpenAI: GPT-5.5',
    supportedEndpointTypes: ['openai', 'openai-response'],
    inputModalities: ['file', 'image', 'text'],
    maxCompletionTokens: 128000,
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    fromSeed: true,
  },
  {
    id: 'anthropic/claude-opus-4.8',
    label: 'Anthropic: Claude Opus 4.8',
    supportedEndpointTypes: ['openai', 'anthropic', 'openai-response'],
    inputModalities: ['text', 'image', 'file'],
    contextLength: 1000000,
    maxCompletionTokens: 128000,
    fromSeed: true,
  },
  {
    id: 'google/gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    supportedEndpointTypes: ['openai', 'gemini'],
    inputModalities: ['text', 'image', 'video', 'file', 'audio'],
    contextLength: 1048576,
    maxCompletionTokens: 65536,
    fromSeed: true,
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek: DeepSeek V4 Pro',
    supportedEndpointTypes: ['openai', 'openai-response'],
    inputModalities: ['text'],
    contextLength: 1048576,
    maxCompletionTokens: 384000,
    fromSeed: true,
  },
  {
    // No declared architecture: deliberately absent from every modality-filtered list.
    id: 'orcarouter/auto',
    label: 'OrcaRouter Auto',
    supportedEndpointTypes: [
      'openai',
      'openai-response',
      'anthropic',
      'gemini',
    ],
    inputModalities: null,
    fromSeed: true,
  },
];

/** Parse one raw catalog record, dropping anything that cannot describe a model. */
export function parseOrcaModel(raw: unknown): OrcaModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!id) return null;

  const endpointTypes = Array.isArray(r.supported_endpoint_types)
    ? r.supported_endpoint_types.filter(
        (t): t is string => typeof t === 'string',
      )
    : [];

  let inputModalities: OrcaModality[] | null = null;
  const architecture = r.architecture;
  if (architecture && typeof architecture === 'object') {
    const declared = (architecture as Record<string, unknown>).input_modalities;
    if (Array.isArray(declared)) {
      inputModalities = declared.filter(
        (m): m is OrcaModality =>
          m === 'text' ||
          m === 'image' ||
          m === 'audio' ||
          m === 'video' ||
          m === 'file',
      );
    }
  }

  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && isFinite(v) && v > 0 ? v : undefined;

  return {
    id,
    label: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id,
    supportedEndpointTypes: endpointTypes,
    inputModalities,
    contextLength: num(r.context_length),
    maxCompletionTokens: num(r.max_completion_tokens),
    description: typeof r.description === 'string' ? r.description : undefined,
  };
}

/** `{ data: [...] }` or a bare array, bounded by `maxItems`. */
export function parseCatalogResponse(payload: unknown): OrcaModel[] {
  const arr = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as Record<string, unknown>).data)
      ? ((payload as Record<string, unknown>).data as unknown[])
      : [];

  const out: OrcaModel[] = [];
  for (const item of arr.slice(0, CATALOG_LIMITS.maxItems)) {
    const parsed = parseOrcaModel(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

function isTextCapable(model: OrcaModel): boolean {
  const types = model.supportedEndpointTypes;
  if (
    !types.some((t) => (TEXT_ENDPOINT_TYPES as readonly string[]).includes(t))
  )
    return false;
  // A model advertising only image/video/rerank endpoints is not a text chat model even
  // if a text endpoint type leaked in.
  const nonText = types.filter((t) =>
    (NON_TEXT_ENDPOINT_TYPES as readonly string[]).includes(t),
  );
  return nonText.length < types.length;
}

export interface CatalogFilterOptions {
  capability: OrcaCapability;
  /** Required input modalities. A model must declare every one of them. */
  requiresModalities?: OrcaModality[];
}

/**
 * Filter a catalog for one entry point.
 *
 * - `chat` requires a text-capable endpoint type and excludes image/video/rerank-only models.
 * - `embedding` / `image` / `video` / `rerank` match their endpoint type strictly.
 * - `requiresModalities` is fail-closed: a model whose catalog record does not declare the
 *   modality is excluded rather than assumed compatible.
 */
export function filterCatalog(
  models: OrcaModel[],
  options: CatalogFilterOptions,
): OrcaModel[] {
  const { capability, requiresModalities } = options;

  const byCapability = models.filter((model) => {
    switch (capability) {
      case 'chat':
        return isTextCapable(model);
      case 'embedding':
        return model.supportedEndpointTypes.includes('embeddings');
      case 'image':
        return model.supportedEndpointTypes.includes('image-generation');
      case 'video':
        return model.supportedEndpointTypes.includes('openai-video');
      case 'rerank':
        return model.supportedEndpointTypes.includes('jina-rerank');
      default:
        return false;
    }
  });

  if (!requiresModalities || requiresModalities.length === 0)
    return byCapability;

  return byCapability.filter((model) => {
    if (!model.inputModalities) return false;
    return requiresModalities.every((m) => model.inputModalities!.includes(m));
  });
}

/** True when a model still satisfies the current filter, used to invalidate a stale pick. */
export function isModelCompatible(
  models: OrcaModel[],
  modelId: string,
  options: CatalogFilterOptions,
): boolean {
  return filterCatalog(models, options).some((m) => m.id === modelId);
}

export interface FetchCatalogOptions {
  apiBase?: string;
  apiKey?: string;
  capability?: OrcaCapability;
  requiresModalities?: OrcaModality[];
  fetchImpl?: typeof fetch;
  origins?: OrcaOrigins;
}

/**
 * Fetch and filter the live catalog. Throws on any failure so the caller can decide
 * whether to serve the verified seed; it never silently mixes seed entries into a
 * successful live result.
 */
export async function fetchOrcaCatalog(
  options: FetchCatalogOptions,
): Promise<OrcaCatalog> {
  const origins = options.origins ?? resolveOrcaOrigins();
  const base = (options.apiBase || origins.apiBase).replace(/\/+$/, '');
  const url = new URL(`${base}/models`);
  if (options.capability)
    url.searchParams.set('capability', options.capability);

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_LIMITS.timeoutMs);

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

    const res = await doFetch(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401
          ? 'OrcaRouter rejected the stored key while listing models. Reconnect the provider.'
          : `OrcaRouter model list failed (HTTP ${res.status}).`,
      );
    }

    const text = await res.text();
    if (text.length > CATALOG_LIMITS.maxBytes) {
      throw new Error(
        'OrcaRouter model list exceeded the accepted response size.',
      );
    }
    const parsed = parseCatalogResponse(JSON.parse(text));
    const models = filterCatalog(parsed, {
      capability: options.capability || 'chat',
      requiresModalities: options.requiresModalities,
    });

    return { models, source: 'live', degraded: false, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/** The verified seed, filtered exactly like a live result. */
export function seedCatalog(
  options: CatalogFilterOptions,
  reason?: string,
): OrcaCatalog {
  return {
    models: filterCatalog(ORCA_SEED_MODELS, options),
    source: 'seed',
    degraded: true,
    fetchedAt: Date.now(),
    reason,
  };
}

/**
 * Live discovery with a bounded, explicitly-labelled fallback.
 *
 * A successful live result is authoritative and never has seed entries mixed into it.
 * A failed live request falls back to the verified seed, which keeps its metadata.
 */
export async function loadOrcaCatalog(
  options: FetchCatalogOptions & { fallbackReason?: string },
): Promise<OrcaCatalog> {
  const filter: CatalogFilterOptions = {
    capability: options.capability || 'chat',
    requiresModalities: options.requiresModalities,
  };
  try {
    return await fetchOrcaCatalog(options);
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : 'OrcaRouter model discovery failed.';
    return seedCatalog(filter, reason);
  }
}

/** Models that can supersede the stored key. Nothing to refresh: reuse until revoked. */
export const ORCA_KEY_MANAGEMENT_URL =
  'https://www.orcarouter.ai/console/authorized-apps';
