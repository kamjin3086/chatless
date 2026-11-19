import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { cpus, platform, release, arch } from 'node:os';
import { EmbeddingService } from '@/lib/embedding/EmbeddingService';
import { RetrievalService } from '@/lib/retrieval/RetrievalService';
import casesFile from './real-semantic-cases.json';

// This is an IPC transport adapter, not a model/data fixture: every invocation
// executes in the running desktop's real WebView, native runtime and SQLite DB.
const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({
        getConnectionUrl: () => 'sqlite:mychat.db',
        select: (query: string, values: unknown[] = []) =>
          transport.invoke('plugin:sql|select', {
            db: 'sqlite:mychat.db',
            query,
            values,
          }),
      }),
    }),
  },
}));
const enabled = Boolean(
  process.env.CHATLESS_KB_SESSION_ID && process.env.CHATLESS_KB_ID,
);
const requireEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};
let embedding: EmbeddingService | undefined;
let coldInitializationMs = 0;
let documents: Array<{
  id: string;
  title: string;
  embedding_fingerprint: string;
}> = [];

async function invoke(command: string, args: unknown = {}): Promise<unknown> {
  const response = await fetch(
    `${process.env.CHATLESS_KB_DRIVER_URL || 'http://127.0.0.1:4444'}/session/${requireEnv('CHATLESS_KB_SESSION_ID')}/execute/async`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: `const done=arguments[arguments.length-1];
      window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({result:value}),error=>done({failure:String(error)}));`,
        args: [command, args],
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  const body: { value: { result?: unknown; failure?: string } } =
    await response.json();
  if (!response.ok || body.value.failure)
    throw new Error(body.value.failure || JSON.stringify(body));
  return body.value.result;
}
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

beforeAll(async () => {
  if (!enabled) return;
  transport.invoke.mockImplementation(invoke);
  vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });
  const result = await invoke('plugin:sql|select', {
    db: 'sqlite:mychat.db',
    query: `SELECT d.id,d.title,d.embedding_fingerprint FROM documents d
    JOIN doc_knowledge_mappings m ON m.document_id=d.id WHERE m.knowledge_base_id=? AND d.semantic_status='ready'`,
    values: [requireEnv('CHATLESS_KB_ID')],
  });
  if (!Array.isArray(result)) throw new Error('Invalid real corpus response');
  documents = result;
  expect(documents).toHaveLength(4);
  const fingerprint = documents[0].embedding_fingerprint;
  expect(
    documents.every((doc) => doc.embedding_fingerprint === fingerprint),
  ).toBe(true);
  const [, modelName, , maxLength] = fingerprint.split(':');
  embedding = new EmbeddingService({
    enableCache: false,
    config: {
      strategy: 'local-onnx',
      modelName,
      modelPath: requireEnv('CHATLESS_KB_MODEL_PATH'),
      tokenizerPath: requireEnv('CHATLESS_KB_TOKENIZER_PATH'),
      maxLength: Number(maxLength),
      maxBatchSize: 8,
      timeout: 60_000,
    },
  });
  const started = performance.now();
  await embedding.initialize();
  coldInitializationMs = performance.now() - started;
  expect(embedding.getEmbeddingSource()).toBe('real');
  expect(embedding.getEmbeddingFingerprint()).toBe(fingerprint);
}, 120_000);

afterAll(async () => {
  await embedding?.cleanup();
  vi.unstubAllGlobals();
});

it.skipIf(!enabled)(
  'measures real query embeddings and production Dense/FTS/RRF against frozen questions',
  async () => {
    if (!embedding)
      throw new Error('Real embedding service was not initialized');
    const retrieval = new RetrievalService();
    const options = {
      knowledgeBaseIds: [requireEnv('CHATLESS_KB_ID')],
      documentIds: documents.map((doc) => doc.id),
      embeddingFingerprint: documents[0].embedding_fingerprint,
      topK: 8,
    };
    const measurements = [];
    for (const item of casesFile.cases) {
      const expected = documents.find((doc) => doc.title === item.document);
      if (!expected) throw new Error(`Missing frozen source ${item.document}`);
      const started = performance.now();
      const vector = await embedding.generateEmbedding(item.query);
      const embedded = performance.now();
      const dense = await retrieval.searchByQueryWithDiagnostics(
        '',
        vector,
        options,
      );
      const denseFinished = performance.now();
      const hybrid = await retrieval.searchByQueryWithDiagnostics(
        item.query,
        vector,
        options,
      );
      const finished = performance.now();
      const supports = (result: (typeof hybrid.results)[number]) =>
        result.metadata?.documentId === expected.id &&
        result.content.includes(item.fact);
      measurements.push({
        id: item.id,
        expectedDocument: expected.id,
        denseHit: dense.results.some(supports),
        hybridHit: hybrid.results.some(supports),
        denseCandidates: dense.denseHits,
        lexicalCandidates: hybrid.lexicalHits,
        queryEmbeddingMs: embedded - started,
        denseMs: denseFinished - embedded,
        hybridMs: finished - denseFinished,
        queryPlusHybridMs: embedded - started + finished - denseFinished,
        denseDocuments: dense.results.map(
          (result) => result.metadata?.documentId,
        ),
        hybridDocuments: hybrid.results.map(
          (result) => result.metadata?.documentId,
        ),
      });
      expect(dense.denseHits).toBeGreaterThan(0);
      expect(
        hybrid.results.every((result) =>
          documents.some((doc) => doc.id === result.metadata?.documentId),
        ),
      ).toBe(true);
    }
    const report = {
      timestamp: new Date().toISOString(),
      fixtureVersion: casesFile.version,
      fixtureSha256: createHash('sha256')
        .update(
          readFileSync(new URL('./real-semantic-cases.json', import.meta.url)),
        )
        .digest('hex'),
      machine: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
      },
      modelFileSha256: createHash('sha256')
        .update(readFileSync(requireEnv('CHATLESS_KB_MODEL_PATH')))
        .digest('hex'),
      tokenizerFileSha256: createHash('sha256')
        .update(readFileSync(requireEnv('CHATLESS_KB_TOKENIZER_PATH')))
        .digest('hex'),
      fingerprint: documents[0].embedding_fingerprint,
      dimension: embedding.getDimension(),
      inferenceSource: embedding.getEmbeddingSource(),
      modelPath: requireEnv('CHATLESS_KB_MODEL_PATH'),
      tokenizerPath: requireEnv('CHATLESS_KB_TOKENIZER_PATH'),
      modelBytes: readFileSync(requireEnv('CHATLESS_KB_MODEL_PATH')).length,
      coldInitializationMs,
      corpusDocuments: documents,
      questions: measurements.length,
      denseRecallAt8:
        measurements.filter((item) => item.denseHit).length /
        measurements.length,
      hybridRecallAt8:
        measurements.filter((item) => item.hybridHit).length /
        measurements.length,
      p95QueryEmbeddingMs: percentile(
        measurements.map((item) => item.queryEmbeddingMs),
        0.95,
      ),
      p95HybridMs: percentile(
        measurements.map((item) => item.hybridMs),
        0.95,
      ),
      p95QueryPlusHybridMs: percentile(
        measurements.map((item) => item.queryPlusHybridMs),
        0.95,
      ),
      scope:
        'Real 4-format small corpus; this does not replace the separate 50K scan/fusion benchmark or the real Qwen chat/UI run.',
      measurements,
    };
    writeFileSync(
      requireEnv('CHATLESS_KB_QUALITY_REPORT'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        denseRecallAt8: report.denseRecallAt8,
        hybridRecallAt8: report.hybridRecallAt8,
        p95QueryEmbeddingMs: report.p95QueryEmbeddingMs,
        p95HybridMs: report.p95HybridMs,
      }),
    );
    expect(report.hybridRecallAt8).toBeGreaterThanOrEqual(0.9);
  },
  180_000,
);
