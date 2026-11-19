import { invoke } from '@tauri-apps/api/core';
import { EmbeddingStrategy, EmbeddingError, EmbeddingInputError } from '../types';

// NOTE: Rust 端需要实现对应的 `init_onnx_session`, `generate_embedding`, `release_onnx_session` 命令。
// 推理失败直接抛错，由上层把语义检索标记为不可用并保留词法检索。

interface OrtStrategyConfig {
  modelPath: string;
  tokenizerPath: string;
  maxBatchSize?: number;
  timeout?: number;
  maxLength?: number;
}

interface TokenizationOutput {
  input_ids: number[][];
  attention_mask: number[][];
  token_type_ids: number[][];
}

export class OrtEmbeddingStrategy implements EmbeddingStrategy {
  private isInitialized = false;
  private dimension = 384;
  private readonly sessionId = crypto.randomUUID();
  private modelIdentity: string | null = null;

  constructor(private readonly config: OrtStrategyConfig) {}

  getName(): string {
    return 'OrtEmbeddingStrategy';
  }

  getDimension(): number {
    return this.dimension;
  }

  getModelIdentity(): string | null { return this.modelIdentity; }

  async countTokens(texts: string[]): Promise<number[]> {
    return invoke('count_embedding_tokens', { texts, tokenizerPath: this.config.tokenizerPath, sessionId: this.sessionId });
  }

  getMaxInputTokens(): number {
    return this.config.maxLength || 512;
  }

  /**
   * 初始化：
   * 1. 请求后端加载 ONNX 模型
   * 2. 初始化前端分词器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    const { modelPath, tokenizerPath } = this.config;
    try {
      const expectedGeneration = await invoke<number>('get_onnx_view_generation');
      const info = await invoke<{ modelHash: string; tokenizerHash: string }>('init_onnx_session', { modelPath, tokenizerPath, sessionId: this.sessionId, expectedGeneration });
      this.modelIdentity = `${info.modelHash}:${info.tokenizerHash}`;
      this.isInitialized = true;
      // Readiness means real inference succeeded, not merely that a file loaded.
      const [probe] = await this.generateEmbeddings(['embedding readiness']);
      if (!probe?.length || probe.some((value) => !Number.isFinite(value))) throw new EmbeddingError('Invalid model probe embedding');
      this.dimension = probe.length;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  /** 生成批量嵌入 */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) throw new EmbeddingError('Strategy not initialized');

    if (texts.length === 0) return [];

    const batchSize = this.config.maxBatchSize || 16;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batchTexts = texts.slice(i, i + batchSize);

      // 1. 调用 Rust 批量分词
      let tokenized: TokenizationOutput;
      try {
        tokenized = await invoke('tokenize_batch', {
          texts: batchTexts,
          tokenizerPath: this.config.tokenizerPath,
          maxLength: this.config.maxLength || 512,
          sessionId: this.sessionId,
        });
      } catch (error) {
        if (String(error).includes('EMBEDDING_INPUT_TOO_LONG')) throw new EmbeddingInputError(String(error));
        throw error;
      }

      // 2. 调用 Rust 生成嵌入
      const embeddings: number[][] = await invoke('generate_embedding', {
        input: {
          input_ids: tokenized.input_ids,
          attention_mask: tokenized.attention_mask,
          token_type_ids: tokenized.token_type_ids,
        },
        sessionId: this.sessionId,
      });

      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  /** 释放后端会话，防止内存泄漏 */
  async cleanup(): Promise<void> {
    try {
      await invoke('release_onnx_session', { sessionId: this.sessionId });
    } catch (e) {
      console.warn('release_onnx_session failed', e);
    }
    this.isInitialized = false;
  }
}
