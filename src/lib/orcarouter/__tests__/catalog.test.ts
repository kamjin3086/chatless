/**
 * Model catalog and capability-filter tests.
 *
 * The fixtures mirror the real shape of `GET https://api.orcarouter.ai/v1/models`:
 * every capability decision is driven by `supported_endpoint_types` and
 * `architecture.input_modalities`, never by a model's name.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ORCA_SEED_MODELS,
  filterCatalog,
  isModelCompatible,
  loadOrcaCatalog,
  parseCatalogResponse,
  parseOrcaModel,
  seedCatalog,
  type OrcaModel,
} from '../catalog';

/** Fixture set covering every capability the contract names. */
const FIXTURES: OrcaModel[] = [
  {
    id: 'openai/gpt-5.5',
    label: 'OpenAI: GPT-5.5',
    supportedEndpointTypes: ['openai', 'openai-response'],
    inputModalities: ['file', 'image', 'text'],
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek: DeepSeek V4 Pro',
    supportedEndpointTypes: ['openai', 'openai-response'],
    inputModalities: ['text'],
  },
  {
    id: 'google/gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    supportedEndpointTypes: ['openai', 'gemini'],
    inputModalities: ['text', 'image', 'video', 'file', 'audio'],
  },
  {
    id: 'orcarouter/auto',
    label: 'OrcaRouter Auto',
    supportedEndpointTypes: [
      'openai',
      'openai-response',
      'anthropic',
      'gemini',
    ],
    inputModalities: null,
  },
  {
    id: 'openai/text-embedding-3-large',
    label: 'Text Embedding 3 Large',
    supportedEndpointTypes: ['embeddings'],
    inputModalities: ['text'],
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    supportedEndpointTypes: ['image-generation'],
    inputModalities: ['text'],
  },
  {
    id: 'google/veo-3',
    label: 'Veo 3',
    supportedEndpointTypes: ['openai-video'],
    inputModalities: ['text', 'image'],
  },
  {
    id: 'jina/jina-reranker-v3',
    label: 'Jina Reranker v3',
    supportedEndpointTypes: ['jina-rerank'],
    inputModalities: ['text'],
  },
];

const ids = (models: OrcaModel[]) => models.map((m) => m.id);

describe('Catalog parsing', () => {
  it('parses the { data: [...] } envelope and a bare array', () => {
    const envelope = parseCatalogResponse({
      object: 'list',
      data: [{ id: 'a/b' }, { id: 'c/d' }],
    });
    assert.deepEqual(ids(envelope), ['a/b', 'c/d']);
    assert.deepEqual(ids(parseCatalogResponse([{ id: 'x/y' }])), ['x/y']);
  });

  it('preserves the vendor/model namespace verbatim', () => {
    const parsed = parseOrcaModel({
      id: 'anthropic/claude-opus-4.8',
      name: 'Anthropic: Claude Opus 4.8',
    });
    assert.equal(parsed?.id, 'anthropic/claude-opus-4.8');
    assert.equal(parsed?.label, 'Anthropic: Claude Opus 4.8');
  });

  it('drops records that cannot describe a model', () => {
    assert.equal(parseOrcaModel(null), null);
    assert.equal(parseOrcaModel({ name: 'no id' }), null);
    assert.equal(parseOrcaModel('a string'), null);
    assert.deepEqual(
      parseCatalogResponse({ data: [null, { id: '' }, { id: 'ok/one' }] }).map(
        (m) => m.id,
      ),
      ['ok/one'],
    );
  });

  it('reads declared input modalities and leaves an undeclared set null', () => {
    const declared = parseOrcaModel({
      id: 'a/b',
      architecture: { input_modalities: ['text', 'image'] },
    });
    assert.deepEqual(declared?.inputModalities, ['text', 'image']);
    const undeclared = parseOrcaModel({ id: 'a/c' });
    assert.equal(undeclared?.inputModalities, null);
  });

  it('ignores unknown modalities rather than admitting them', () => {
    const parsed = parseOrcaModel({
      id: 'a/b',
      architecture: { input_modalities: ['text', 'telepathy'] },
    });
    assert.deepEqual(parsed?.inputModalities, ['text']);
  });
});

describe('Capability filtering', () => {
  it('keeps only text-capable chat models and excludes non-text specialties', () => {
    const chat = filterCatalog(FIXTURES, { capability: 'chat' });
    assert.ok(ids(chat).includes('openai/gpt-5.5'));
    assert.ok(ids(chat).includes('orcarouter/auto'));
    assert.ok(
      !ids(chat).includes('gpt-image-2'),
      'image-generation model must not enter a text dropdown',
    );
    assert.ok(
      !ids(chat).includes('google/veo-3'),
      'video model must not enter a text dropdown',
    );
    assert.ok(
      !ids(chat).includes('jina/jina-reranker-v3'),
      'rerank model must not enter a text dropdown',
    );
    assert.ok(
      !ids(chat).includes('openai/text-embedding-3-large'),
      'embedding model must not enter a text dropdown',
    );
  });

  it('filters embedding models strictly by the embeddings endpoint type', () => {
    assert.deepEqual(
      ids(filterCatalog(FIXTURES, { capability: 'embedding' })),
      ['openai/text-embedding-3-large'],
    );
  });

  it('filters image, video, and rerank strictly by their endpoint types', () => {
    assert.deepEqual(ids(filterCatalog(FIXTURES, { capability: 'image' })), [
      'gpt-image-2',
    ]);
    assert.deepEqual(ids(filterCatalog(FIXTURES, { capability: 'video' })), [
      'google/veo-3',
    ]);
    assert.deepEqual(ids(filterCatalog(FIXTURES, { capability: 'rerank' })), [
      'jina/jina-reranker-v3',
    ]);
  });

  it('fails closed when a model does not declare the required modality', () => {
    const withImage = filterCatalog(FIXTURES, {
      capability: 'chat',
      requiresModalities: ['image'],
    });
    assert.ok(ids(withImage).includes('openai/gpt-5.5'));
    assert.ok(ids(withImage).includes('google/gemini-3.5-flash'));
    assert.ok(
      !ids(withImage).includes('deepseek/deepseek-v4-pro'),
      'text-only chat model must drop out',
    );
    assert.ok(
      !ids(withImage).includes('orcarouter/auto'),
      'a model with no declared architecture must not be assumed multimodal',
    );
    // Non-text specialties stay out even though they declare image input.
    assert.ok(!ids(withImage).includes('google/veo-3'));
    assert.ok(!ids(withImage).includes('gpt-image-2'));
  });

  it('applies the chat filter before the modality filter', () => {
    const audio = filterCatalog(FIXTURES, {
      capability: 'chat',
      requiresModalities: ['audio'],
    });
    assert.deepEqual(ids(audio), ['google/gemini-3.5-flash']);
  });

  it('reports a stored model as incompatible once it leaves the filtered list', () => {
    const before = filterCatalog(FIXTURES, { capability: 'chat' });
    assert.equal(
      isModelCompatible(before, 'deepseek/deepseek-v4-pro', {
        capability: 'chat',
      }),
      true,
    );
    // Attaching an image invalidates the text-only pick.
    const after = filterCatalog(FIXTURES, {
      capability: 'chat',
      requiresModalities: ['image'],
    });
    assert.equal(
      isModelCompatible(after, 'deepseek/deepseek-v4-pro', {
        capability: 'chat',
        requiresModalities: ['image'],
      }),
      false,
    );
  });
});

describe('Verified seed fallback', () => {
  it('keeps the five verified seeds with their metadata intact', () => {
    const seeded = seedCatalog({ capability: 'chat' });
    assert.equal(seeded.source, 'seed');
    assert.equal(seeded.degraded, true);
    assert.deepEqual(ids(seeded.models).sort(), [
      'anthropic/claude-opus-4.8',
      'deepseek/deepseek-v4-pro',
      'google/gemini-3.5-flash',
      'openai/gpt-5.5',
      'orcarouter/auto',
    ]);
  });

  it('retains the GPT-5.5 reasoning ladder and input modalities', () => {
    const gpt = ORCA_SEED_MODELS.find((m) => m.id === 'openai/gpt-5.5');
    assert.deepEqual(gpt?.reasoningEfforts, ['low', 'medium', 'high', 'xhigh']);
    assert.deepEqual(gpt?.inputModalities, ['file', 'image', 'text']);
    assert.equal(gpt?.maxCompletionTokens, 128000);
  });

  it('retains context windows and modalities for the other seeds', () => {
    const opus = ORCA_SEED_MODELS.find(
      (m) => m.id === 'anthropic/claude-opus-4.8',
    );
    assert.equal(opus?.contextLength, 1000000);
    assert.deepEqual(opus?.inputModalities, ['text', 'image', 'file']);
    const gemini = ORCA_SEED_MODELS.find(
      (m) => m.id === 'google/gemini-3.5-flash',
    );
    assert.equal(gemini?.contextLength, 1048576);
    assert.deepEqual(gemini?.inputModalities, [
      'text',
      'image',
      'video',
      'file',
      'audio',
    ]);
  });

  it('serves a degraded, explicitly-labelled seed when live discovery fails', async () => {
    const catalog = await loadOrcaCatalog({
      capability: 'chat',
      fetchImpl: (async () => {
        throw new TypeError('network down');
      }) as unknown as typeof fetch,
    });
    assert.equal(catalog.degraded, true);
    assert.equal(catalog.source, 'seed');
    assert.ok(catalog.reason);
    assert.ok(
      catalog.models.length > 0,
      'an outage must not leave the user with no models',
    );
  });

  it('applies the modality filter to the seed as well', async () => {
    const catalog = await loadOrcaCatalog({
      capability: 'chat',
      requiresModalities: ['image'],
      fetchImpl: (async () => {
        throw new TypeError('network down');
      }) as unknown as typeof fetch,
    });
    assert.ok(!catalog.models.some((m) => m.id === 'deepseek/deepseek-v4-pro'));
    assert.ok(!catalog.models.some((m) => m.id === 'orcarouter/auto'));
    assert.ok(catalog.models.some((m) => m.id === 'openai/gpt-5.5'));
  });
});

describe('Live discovery', () => {
  function servingCatalog(
    payload: unknown,
    capture?: (url: string, headers: Record<string, string>) => void,
  ) {
    return (async (url: string, init: RequestInit) => {
      capture?.(String(url), (init.headers || {}) as Record<string, string>);
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('requests the configured origin models path with the capability and a bearer key', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = servingCatalog({ data: FIXTURES }, (u, h) => {
      seenUrl = u;
      seenHeaders = h;
    });

    const catalog = await loadOrcaCatalog({
      apiBase: 'https://api.orcarouter.ai/v1',
      apiKey: 'sk-orca-fake-key-000',
      capability: 'chat',
      fetchImpl,
    });

    assert.equal(
      seenUrl,
      'https://api.orcarouter.ai/v1/models?capability=chat',
    );
    assert.equal(seenHeaders.Authorization, 'Bearer sk-orca-fake-key-000');
    assert.equal(catalog.source, 'live');
    assert.equal(catalog.degraded, false);
  });

  it('treats a successful live result as authoritative and never mixes seed entries in', async () => {
    const catalog = await loadOrcaCatalog({
      capability: 'chat',
      fetchImpl: servingCatalog({
        data: [
          { id: 'vendor/live-only', supported_endpoint_types: ['openai'] },
        ],
      }),
    });
    assert.deepEqual(ids(catalog.models), ['vendor/live-only']);
    assert.ok(
      !ids(catalog.models).includes('openai/gpt-5.5'),
      'seed entries must not leak into a live result',
    );
    assert.equal(catalog.source, 'live');
  });

  it('falls back to the seed on an auth failure rather than showing an empty list', async () => {
    const catalog = await loadOrcaCatalog({
      capability: 'chat',
      fetchImpl: (async () =>
        new Response('{}', { status: 401 })) as unknown as typeof fetch,
    });
    assert.equal(catalog.degraded, true);
    assert.ok(
      catalog.reason?.includes('401') ||
        catalog.reason?.toLowerCase().includes('reconnect'),
    );
    assert.ok(catalog.models.length > 0);
  });

  it('falls back to the seed on a 429 and on an unreadable body', async () => {
    for (const fetchImpl of [
      (async () =>
        new Response('{}', { status: 429 })) as unknown as typeof fetch,
      (async () =>
        new Response('not json', { status: 200 })) as unknown as typeof fetch,
    ]) {
      const catalog = await loadOrcaCatalog({ capability: 'chat', fetchImpl });
      assert.equal(catalog.degraded, true);
      assert.ok(catalog.models.length > 0);
    }
  });

  it('honours the returned endpoint metadata instead of the model name', async () => {
    // Named like a chat model, but the catalog says image-generation only.
    const catalog = await loadOrcaCatalog({
      capability: 'chat',
      fetchImpl: servingCatalog({
        data: [
          {
            id: 'vendor/gpt-5-lookalike',
            name: 'GPT-5 Lookalike',
            supported_endpoint_types: ['image-generation'],
          },
        ],
      }),
    });
    assert.equal(
      catalog.models.length,
      0,
      'a name must never imply a capability',
    );
  });
});
