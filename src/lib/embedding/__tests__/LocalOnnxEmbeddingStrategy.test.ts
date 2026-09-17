import { describe, expect, test, vi, beforeEach } from 'vitest';
import { LocalOnnxEmbeddingStrategy } from '../strategies/LocalOnnxEmbeddingStrategy';

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

  test('reports unavailable when model files are missing instead of fabricating vectors', async () => {
    const strategy = new LocalOnnxEmbeddingStrategy({
      strategy: 'local-onnx',
      modelName: 'all-minilm-l6-v2',
    });
    await strategy.initialize();
    expect(strategy.getEmbeddingSource()).toBe('unavailable');
    await expect(strategy.generateEmbeddings(['hello'])).rejects.toThrow('不可用');
    await strategy.cleanup();
  });
});
