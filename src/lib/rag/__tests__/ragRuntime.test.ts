import { beforeEach, expect, it, vi } from 'vitest';
import type { EmbeddingConfig } from '@/lib/embedding/types';

const state = vi.hoisted(() => ({
  embedding: {
    strategy: 'ollama',
    modelName: 'chosen',
    apiUrl: 'http://127.0.0.1:11434',
  },
  listeners: new Set<(config: unknown) => void>(),
  services: [] as Array<{
    config: any;
    cleanup: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
  }>,
  initialize: vi.fn(),
  artifactSuffix: '',
  dbInitialized: false,
  wake: vi.fn(),
}));
vi.mock('@/lib/knowledgeBaseConfig', () => ({
  loadKnowledgeBaseConfig: async () => ({ embedding: state.embedding }),
  getKnowledgeBaseConfigManager: () => ({
    addListener: (fn: (value: unknown) => void) => state.listeners.add(fn),
  }),
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({ isInitialized: () => state.dbInitialized }),
  },
}));
vi.mock('@/lib/indexing/SemanticIndexQueue', () => ({
  semanticIndexQueue: { wakeWaiting: state.wake },
}));
vi.mock('../RAGService', () => ({
  createDefaultRAGConfig: () => ({
    embedding: { strategy: 'local-onnx' },
    retrieval: {},
    context: {},
  }),
  RAGService: class {
    config: any;
    artifactSuffix = state.artifactSuffix;
    cleanup = vi.fn(async () => {});
    initialize = vi.fn(() => state.initialize(this.config));
    constructor(config: any) {
      this.config = config;
      state.services.push(this);
    }
    getEmbeddingService() {
      return {
        isUsableForRag: () => true,
        getEmbeddingFingerprint: () =>
          `${this.config.embedding.modelName}${this.artifactSuffix}`,
      };
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.embedding = {
    strategy: 'ollama',
    modelName: 'chosen',
    apiUrl: 'http://127.0.0.1:11434',
  };
  state.listeners.clear();
  state.services = [];
  state.dbInitialized = false;
  state.artifactSuffix = '';
  state.wake.mockReset();
  state.initialize.mockReset().mockResolvedValue(undefined);
});

it('reuses healthy probe identity, ignores unsaved test configurations and refreshes a changed artifact', async () => {
  const runtime = await import('../ragServiceInstance');
  const config: EmbeddingConfig = { ...state.embedding, strategy: 'ollama' };
  await runtime.getRAGService();
  await runtime.reconcileEmbeddingProbe(config, 'chosen');
  await runtime.reconcileEmbeddingProbe(
    { ...config, modelName: 'unsaved' },
    'unsaved',
  );
  expect(state.services).toHaveLength(1);
  state.artifactSuffix = ':new-artifact';
  await runtime.reconcileEmbeddingProbe(config, 'chosen:new-artifact');
  expect(state.services).toHaveLength(2);
  expect(state.services[0].cleanup).toHaveBeenCalledTimes(1);
});

it('uses the saved real model configuration rather than a default model', async () => {
  const runtime = await import('../ragServiceInstance');
  await runtime.getRAGService();
  expect(state.services[0].config.embedding).toMatchObject(state.embedding);
});

it('applies configuration events and wakes durable work for the newly selected fingerprint', async () => {
  state.dbInitialized = true;
  const runtime = await import('../ragServiceInstance');
  await runtime.getRAGService();
  await vi.waitFor(() => expect(state.wake).toHaveBeenCalledWith('chosen'));
  state.embedding = { ...state.embedding, modelName: 'changed' };
  for (const listener of state.listeners)
    listener({ embedding: state.embedding });
  await vi.waitFor(() => expect(state.wake).toHaveBeenCalledWith('changed'));
  expect(state.services.at(-1)?.config.embedding.modelName).toBe('changed');
});

it('deduplicates concurrent initialization of one configuration', async () => {
  const runtime = await import('../ragServiceInstance');
  const [a, b] = await Promise.all([
    runtime.getRAGService(),
    runtime.getRAGService(),
  ]);
  expect(a).toBe(b);
  expect(state.services).toHaveLength(1);
});

it('replaces configuration without disposing a model used by an in-flight operation', async () => {
  const runtime = await import('../ragServiceInstance');
  let finish!: () => void;
  const held = runtime.withRAGService(async (_rag, isCurrent) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    expect(isCurrent()).toBe(false);
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  state.embedding = { ...state.embedding, modelName: 'replacement' };
  await runtime.getRAGService();
  expect(state.services[0].cleanup).not.toHaveBeenCalled();
  finish();
  await held;
  expect(state.services[0].cleanup).toHaveBeenCalledTimes(1);
  expect(state.services[1].config.embedding.modelName).toBe('replacement');
});

it('does not publish an obsolete initialization after a newer selection', async () => {
  const runtime = await import('../ragServiceInstance');
  let finish!: () => void;
  state.initialize.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = runtime.getRAGService();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  state.embedding = { ...state.embedding, modelName: 'newer' };
  const second = await runtime.getRAGService();
  finish();
  expect(await first).toBe(second);
  expect(state.services[0].cleanup).toHaveBeenCalledTimes(1);
});
