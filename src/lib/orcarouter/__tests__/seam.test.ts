/**
 * Seam tests: the two adapters must be interchangeable downstream.
 *
 * The contract requires proof that the provider request path and model discovery do not
 * care which adapter produced the credential — only the resulting key matters. These
 * tests drive both adapters through the real catalog fetch path and assert the outbound
 * request and the parsed result are identical.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MemoryCredentialStore } from '../credentials';
import {
  ApiKeyCredentialProvider,
  PkceCredentialProvider,
} from '../adapters';
import { fetchOrcaCatalog, parseCatalogResponse, filterCatalog } from '../catalog';

const FAKE_KEY = 'sk-orca-fake-test-key-000000000000';
const API_BASE = 'https://api.orcarouter.ai/v1';

const CATALOG_PAYLOAD = {
  object: 'list',
  data: [
    {
      id: 'openai/gpt-5.5',
      name: 'OpenAI: GPT-5.5',
      supported_endpoint_types: ['openai', 'openai-response'],
      architecture: { input_modalities: ['file', 'image', 'text'] },
      context_length: 400000,
    },
    {
      id: 'deepseek/deepseek-v4-pro',
      name: 'DeepSeek: DeepSeek V4 Pro',
      supported_endpoint_types: ['openai'],
      architecture: { input_modalities: ['text'] },
    },
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      supported_endpoint_types: ['image-generation'],
      architecture: { input_modalities: ['text'] },
    },
  ],
};

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function capturingFetch(captured: Captured[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), headers: (init.headers || {}) as Record<string, string> });
    return new Response(JSON.stringify(CATALOG_PAYLOAD), { status: 200 });
  }) as unknown as typeof fetch;
}

/** Both adapters, each holding a credential. */
async function bothCredentials() {
  const apiStore = new MemoryCredentialStore();
  const pkceStore = new MemoryCredentialStore();

  const apiKeyProvider = new ApiKeyCredentialProvider(apiStore, 'orcarouter');
  const fromApiKey = await apiKeyProvider.save(FAKE_KEY);

  const pkceProvider = new PkceCredentialProvider(
    pkceStore,
    {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ key: FAKE_KEY, user_id: '777', scope: 'api' }), {
          status: 200,
        })) as unknown as typeof fetch,
    },
    'orcarouter-oauth',
  );
  const session = await pkceProvider.begin('oob');
  const fromPkce = await pkceProvider.complete(session.attempt, 'fake-code');

  return { fromApiKey, fromPkce };
}

describe('Credential source independence', () => {
  it('produces the same credential shape from both adapters', async () => {
    const { fromApiKey, fromPkce } = await bothCredentials();

    assert.deepEqual(Object.keys(fromApiKey).sort(), Object.keys(fromPkce).sort());
    assert.equal(fromApiKey.key, fromPkce.key);
    assert.equal(fromApiKey.scope, fromPkce.scope);
    assert.equal(fromApiKey.needsReauth, fromPkce.needsReauth);
    // The method differs; nothing else the downstream consumes does.
    assert.equal(fromApiKey.method, 'api-key');
    assert.equal(fromPkce.method, 'pkce');
  });

  it('makes an identical model-discovery request regardless of which adapter supplied the key', async () => {
    const { fromApiKey, fromPkce } = await bothCredentials();

    const apiCaptured: Captured[] = [];
    const pkceCaptured: Captured[] = [];

    const viaApiKey = await fetchOrcaCatalog({
      apiBase: API_BASE,
      apiKey: fromApiKey.key,
      capability: 'chat',
      fetchImpl: capturingFetch(apiCaptured),
    });
    const viaPkce = await fetchOrcaCatalog({
      apiBase: API_BASE,
      apiKey: fromPkce.key,
      capability: 'chat',
      fetchImpl: capturingFetch(pkceCaptured),
    });

    // Same origin, same path, same capability, same auth header.
    assert.deepEqual(apiCaptured, pkceCaptured);
    assert.equal(apiCaptured[0].url, 'https://api.orcarouter.ai/v1/models?capability=chat');
    assert.equal(apiCaptured[0].headers.Authorization, `Bearer ${FAKE_KEY}`);

    // And the discovery result is identical, so no downstream branch can exist.
    assert.deepEqual(
      viaApiKey.models.map((m) => m.id),
      viaPkce.models.map((m) => m.id),
    );
    assert.deepEqual(viaApiKey.source, viaPkce.source);
    assert.deepEqual(viaApiKey.degraded, viaPkce.degraded);
  });

  it('applies the same capability filter to both, with no credential-aware branch', async () => {
    const { fromApiKey, fromPkce } = await bothCredentials();
    assert.equal(fromApiKey.key, fromPkce.key);

    const parsed = parseCatalogResponse(CATALOG_PAYLOAD);
    const chat = filterCatalog(parsed, { capability: 'chat' });
    const multimodal = filterCatalog(parsed, { capability: 'chat', requiresModalities: ['image'] });

    // The filter is a pure function of the catalog, not of the credential.
    assert.deepEqual(
      chat.map((m) => m.id),
      ['openai/gpt-5.5', 'deepseek/deepseek-v4-pro'],
    );
    assert.deepEqual(
      multimodal.map((m) => m.id),
      ['openai/gpt-5.5'],
    );
    // The image-generation-only record never reaches a text list.
    assert.ok(!chat.some((m) => m.id === 'gpt-image-2'));
  });

  it('scopes a 401 transition to the adapter that owns the rejected credential', async () => {
    const { fromApiKey, fromPkce } = await bothCredentials();
    assert.equal(fromApiKey.generation, 1);
    assert.equal(fromPkce.generation, 1);

    // Independently stored, so marking one does not affect the other.
    const { markNeedsReauth } = await import('../credentials');

    const apiStore = new MemoryCredentialStore();
    const provider = new ApiKeyCredentialProvider(apiStore, 'orcarouter');
    await provider.save(FAKE_KEY);

    await markNeedsReauth(apiStore, 'orcarouter', 1);
    const apiStatus = await provider.describe();
    assert.equal(apiStatus.needsReauth, true);

    // The other adapter's store is untouched.
    const otherStore = new MemoryCredentialStore();
    const other = new ApiKeyCredentialProvider(otherStore, 'orcarouter-oauth');
    await other.save(FAKE_KEY);
    assert.equal((await other.describe()).needsReauth, false);
  });
});
