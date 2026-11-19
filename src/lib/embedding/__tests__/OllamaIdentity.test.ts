import { beforeEach, expect, it, vi } from 'vitest';
import { OllamaStrategy } from '../strategies/OllamaStrategy';
import { EmbeddingInputError } from '../types';
import { EmbeddingService } from '../EmbeddingService';

const server = vi.hoisted(() => ({
  digest: 'digest-a',
  changeDuringEmbed: false,
  tooLong: false,
  dimension: 3,
  request: vi.fn(),
}));
vi.mock('@/lib/request', () => ({ tauriFetch: server.request }));
beforeEach(() => {
  server.digest = 'digest-a';
  server.changeDuringEmbed = false;
  server.tooLong = false;
  server.dimension = 3;
  server.request.mockReset();
  server.request.mockImplementation(
    async (url: string, options: RequestInit) => {
      if (url.endsWith('/api/tags'))
        return Response.json({
          models: [{ name: 'model:latest', digest: server.digest }],
        });
      if (url.endsWith('/api/show'))
        return Response.json({ model_info: { 'bert.context_length': 128 } });
      if (!url.endsWith('/api/embed'))
        throw new Error('Unexpected protocol path');
      const body: { input: string[]; truncate: boolean } = JSON.parse(
        String(options.body),
      );
      expect(body.truncate).toBe(false);
      if (server.tooLong)
        return Response.json(
          { error: 'input length exceeds context length' },
          { status: 400 },
        );
      if (server.changeDuringEmbed) server.digest = 'digest-b';
      return Response.json({
        embeddings: body.input.map(() =>
          Array.from({ length: server.dimension }, (_, index) =>
            index === 0 ? 1 : 0,
          ),
        ),
      });
    },
  );
});
const create = () =>
  new OllamaStrategy({
    apiUrl: 'http://ollama.invalid',
    modelName: 'model',
    dimension: 384,
  });

it('does not serve cached vectors or a usable fingerprint after model identity is invalidated', async () => {
  const service = new EmbeddingService({
    config: {
      strategy: 'ollama',
      apiUrl: 'http://ollama.invalid',
      modelName: 'model',
    },
  });
  await service.initialize();
  await service.generateEmbedding('cached');
  server.changeDuringEmbed = true;
  await expect(service.generateEmbedding('uncached')).rejects.toThrow();
  expect(service.isUsableForRag()).toBe(false);
  expect(service.getEmbeddingFingerprint()).toBeNull();
  await expect(service.generateEmbedding('cached')).rejects.toThrow();
  await service.cleanup();
});

it('requires a real model digest before claiming a stable vector identity', async () => {
  server.digest = '';
  await expect(create().initialize()).rejects.toThrow(/digest/i);
});
it('rejects a mutable model alias changing during inference instead of returning mislabelled vectors', async () => {
  const strategy = create();
  await strategy.initialize();
  server.changeDuringEmbed = true;
  await expect(strategy.generateEmbeddings(['document'])).rejects.toThrow(
    /model.*changed/i,
  );
  expect(strategy.isReady()).toBe(false);
});
it('keeps a healthy model after input rejection but invalidates dimension drift', async () => {
  const strategy = create();
  await strategy.initialize();
  expect(strategy.getDimension()).toBe(3);
  expect(strategy.getMaxInputTokens()).toBe(128);
  server.tooLong = true;
  await expect(
    strategy.generateEmbeddings(['oversized']),
  ).rejects.toBeInstanceOf(EmbeddingInputError);
  expect(strategy.isReady()).toBe(true);
  server.tooLong = false;
  server.dimension = 4;
  await expect(strategy.generateEmbeddings(['valid text'])).rejects.toThrow(
    /dimension changed/i,
  );
  expect(strategy.isReady()).toBe(false);
});
