import { invoke } from '@tauri-apps/api/core';
import { exists } from '@tauri-apps/plugin-fs';
import { EmbeddingStrategy, EmbeddingConfig, EmbeddingError } from '../types';
import { OrtEmbeddingStrategy } from './OrtEmbeddingStrategy';
import { OnnxModelDownloader } from '../OnnxModelDownloader';
import { modelConfigService } from '../ModelConfigService';

export type EmbeddingInferenceSource = 'real' | 'mock' | 'unavailable';

/**
 * 本地 ONNX 嵌入策略（生产路径）
 * - 模型文件存在时走 OrtEmbeddingStrategy（真实 ORT 推理）
 * - 无模型或推理失败时标记为 unavailable；测试环境可显式使用 mock
 */
export class LocalOnnxEmbeddingStrategy implements EmbeddingStrategy {
  private ortStrategy: OrtEmbeddingStrategy | null = null;
  private isInitialized = false;
  private readonly config: EmbeddingConfig;
  private modelId: string;
  private dimension = 384;
  private source: EmbeddingInferenceSource = 'unavailable';
  private readonly allowTestMock = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.modelId = resolveModelId(config);
  }

  getName(): string {
    return 'LocalOnnxEmbeddingStrategy';
  }

  getEmbeddingSource(): EmbeddingInferenceSource {
    return this.source;
  }

  getDimension(): number {
    return this.dimension;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.dimension = await modelConfigService.getModelDimensions(this.modelId);
    const paths = await resolveOnnxModelPaths(this.config, this.modelId);

    if (paths) {
      try {
        this.ortStrategy = new OrtEmbeddingStrategy({
          modelPath: paths.model,
          tokenizerPath: paths.tokenizer,
          maxBatchSize: this.config.maxBatchSize,
          maxLength: this.config.maxLength || modelConfigService.getModelContextLength(this.modelId),
          timeout: this.config.timeout,
        });
        await this.ortStrategy.initialize();
        this.source = 'real';
        console.info(`[LocalOnnx] 已加载真实 ONNX 模型: ${paths.model}`);
      } catch (error) {
        console.warn('[LocalOnnx] 真实模型加载失败:', error);
        this.ortStrategy = null;
        this.source = this.allowTestMock ? 'mock' : 'unavailable';
      }
    } else {
      console.warn(`[LocalOnnx] 未找到模型文件 (id=${this.modelId})，语义检索不可用。请在设置中下载嵌入模型。`);
      this.source = this.allowTestMock ? 'mock' : 'unavailable';
    }

    this.isInitialized = true;
  }

  getMaxInputTokens(): number {
    return this.config.maxLength || modelConfigService.getModelContextLength(this.modelId) || 512;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) {
      throw new EmbeddingError('LocalOnnxEmbeddingStrategy not initialized');
    }
    if (texts.length === 0) return [];

    if (this.source === 'real' && this.ortStrategy) {
      try {
        return await this.ortStrategy.generateEmbeddings(texts);
      } catch (error) {
        console.warn('[LocalOnnx] 真实推理失败:', error);
        this.source = this.allowTestMock ? 'mock' : 'unavailable';
        await this.ortStrategy.cleanup().catch(() => {});
        this.ortStrategy = null;
      }
    }

    if (this.source === 'mock' && this.allowTestMock) {
      return await invoke('generate_embedding_command', { texts });
    }
    throw new EmbeddingError('本地 ONNX embedding 模型不可用');
  }

  async cleanup(): Promise<void> {
    if (this.ortStrategy) {
      await this.ortStrategy.cleanup().catch(() => {});
      this.ortStrategy = null;
    }
    this.isInitialized = false;
  }
}

function resolveModelId(config: EmbeddingConfig): string {
  if (config.modelName?.trim()) return config.modelName.trim();
  const raw = String(config.modelPath || '').replace(/\\/g, '/').trim();
  if (!raw) return 'all-minilm-l6-v2';
  const match = raw.match(/models\/([^/]+)/i);
  if (match?.[1]) return match[1];
  const base = raw.split('/').pop() || raw;
  return base.replace(/\.onnx$/i, '');
}

async function resolveOnnxModelPaths(
  config: EmbeddingConfig,
  modelId: string,
): Promise<{ model: string; tokenizer: string } | null> {
  try {
    const downloader = new OnnxModelDownloader();
    await downloader.waitUntilReady();
    const fromDownloader = await downloader.getModelPaths(modelId);
    if (fromDownloader) return fromDownloader;
  } catch {
    // 非 Tauri 环境或下载器不可用
  }

  const modelPath = config.modelPath?.trim();
  const tokenizerPath = config.tokenizerPath?.trim();
  if (modelPath && tokenizerPath) {
    try {
      if ((await exists(modelPath)) && (await exists(tokenizerPath))) {
        return { model: modelPath, tokenizer: tokenizerPath };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/** @deprecated 使用 LocalOnnxEmbeddingStrategy */
export { LocalOnnxEmbeddingStrategy as TauriOrtStrategy };
