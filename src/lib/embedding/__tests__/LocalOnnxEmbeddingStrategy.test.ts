import { describe, expect, test, vi, beforeEach } from 'vitest';
import { LocalOnnxEmbeddingStrategy } from '../strategies/LocalOnnxEmbeddingStrategy';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string, args?: { texts?: string[] }) =>
    (args?.texts || []).map(() => Array.from({ length: 384 }, (_, i) => i * 0.001)),
  ),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async () => false),
}));

vi.mock('../OnnxModelDownloader', () => ({
  OnnxModelDownloader: class {
    async waitUntilReady() {}
    async getModelPaths() {
      return null;
    }
  },
}));

describe('LocalOnnxEmbeddingStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses mock source when model files are missing', async () => {
    const strategy = new LocalOnnxEmbeddingStrategy({
      strategy: 'local-onnx',
      modelName: 'all-minilm-l6-v2',
    });
    await strategy.initialize();
    expect(strategy.getEmbeddingSource()).toBe('mock');
    const vec = await strategy.generateEmbeddings(['hello']);
    expect(vec).toHaveLength(1);
    expect(vec[0]).toHaveLength(384);
    await strategy.cleanup();
  });
});
