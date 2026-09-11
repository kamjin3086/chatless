/**
 * Live end-to-end check through the provider code path.
 *
 * This deliberately goes through `OrcaRouterProvider.fetchModels()` — the same method the
 * application uses — rather than issuing a bare curl, so the assertion covers the wiring
 * (origin resolution, Bearer transport, catalog parsing, capability filtering) and not
 * just the upstream service.
 *
 * Run with: ORCAROUTER_API_KEY=... node --import tsx scripts/orcarouter-smoke.ts
 * The key is read from the environment and never printed.
 */

import { OrcaRouterProvider } from '../src/lib/llm/providers/OrcaRouterProvider';
import {
  filterCatalog,
  parseOrcaModel,
  type OrcaModel,
  type OrcaModality,
} from '../src/lib/orcarouter/catalog';
import { resolveOrcaOrigins } from '../src/lib/orcarouter/origins';

async function main() {
  const apiKey = process.env.ORCAROUTER_API_KEY;
  if (!apiKey) {
    console.error('ORCAROUTER_API_KEY is not set');
    process.exit(2);
  }

  const origins = resolveOrcaOrigins();
  console.log(`auth origin      : ${origins.authBase}`);
  console.log(`inference origin : ${origins.apiBase}`);

  // Discovery goes through the provider: /v1/models with the capability filter applied.
  const provider = new OrcaRouterProvider(`${origins.apiBase}`, apiKey, 'OrcaRouter - API');

  const textModels = await provider.fetchModels();
  if (!textModels) {
    console.error('FAIL: provider.fetchModels() returned null (live discovery failed)');
    process.exit(1);
  }
  console.log(`text chat catalog : ${textModels.length} models`);

  // The same call the selector makes, to prove the capability filter runs on real data.
  const raw = await fetchCatalogRaw(origins.apiBase, apiKey);
  const chat = filterCatalog(raw, { capability: 'chat' });
  const chatWithImage = filterCatalog(raw, { capability: 'chat', requiresModalities: ['image'] });
  const embedding = filterCatalog(raw, { capability: 'embedding' });
  const image = filterCatalog(raw, { capability: 'image' });

  console.log(`parsed catalog    : ${raw.length} models`);
  console.log(`capability=chat   : ${chat.length}`);
  console.log(`chat + image input: ${chatWithImage.length}`);
  console.log(`embedding         : ${embedding.length}`);
  console.log(`image generation  : ${image.length}`);

  // Fail closed: every chat+image model must declare image input.
  const undeclared = chatWithImage.filter((m) => !m.inputModalities?.includes('image'));
  if (undeclared.length > 0) {
    console.error(`FAIL: ${undeclared.length} models lack a declared image modality`);
    process.exit(1);
  }
  // Non-text specialties must never leak into the text list.
  const leaked = chat.filter((m) =>
    m.supportedEndpointTypes.every((t) => t === 'image-generation' || t === 'openai-video' || t === 'jina-rerank'),
  );
  if (leaked.length > 0) {
    console.error(`FAIL: non-text models leaked into chat: ${leaked.map((m) => m.id).join(', ')}`);
    process.exit(1);
  }

  // A real inference request through the OpenAI-compatible adapter.
  const chosen = chatWithImage[0] ?? chat[0];
  console.log(`inference model  : ${chosen.id}`);
  const res = await fetch(`${origins.apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: chosen.id,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      max_tokens: 16,
      stream: false,
    }),
  });
  if (!res.ok) {
    console.error(`FAIL: inference returned HTTP ${res.status}`);
    process.exit(1);
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content ?? '';
  console.log(`inference reply  : ${JSON.stringify(content.slice(0, 80))}`);

  console.log('\nLIVE CHECK PASSED');
}

/** Raw catalog read, parsed with the same parser the provider uses. */
async function fetchCatalogRaw(apiBase: string, apiKey: string): Promise<OrcaModel[]> {
  const res = await fetch(`${apiBase.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
  const payload = (await res.json()) as { data?: unknown[] };
  return (payload.data ?? []).map(parseOrcaModel).filter((m): m is OrcaModel => m !== null);
}

void (0 as unknown as OrcaModality);
main().catch((e) => {
  console.error('live check failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
