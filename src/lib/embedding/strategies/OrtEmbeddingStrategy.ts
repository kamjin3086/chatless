import { invoke } from '@tauri-apps/api/core';
import { EmbeddingStrategy, EmbeddingError } from '../types';

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
  private readonly dimension = 384;

  constructor(private readonly config: OrtStrategyConfig) {}

  getName(): string {
    return 'OrtEmbeddingStrategy';
  }

  getDimension(): number {
    return this.dimension;
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
    const { modelPath } = this.config;
    await invoke('init_onnx_session', { modelPath });
    this.isInitialized = true;
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
      const tokenized: TokenizationOutput = await invoke('tokenize_batch', {
        texts: batchTexts,
        tokenizerPath: this.config.tokenizerPath,
        maxLength: this.config.maxLength || 512,
      });

      // 2. 调用 Rust 生成嵌入
      const embeddings: number[][] = await invoke('generate_embedding', {
        input: {
          input_ids: tokenized.input_ids,
          attention_mask: tokenized.attention_mask,
          token_type_ids: tokenized.token_type_ids,
        },
        timeout: this.config.timeout || 30000,
      });

      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  /** 释放后端会话，防止内存泄漏 */
  async cleanup(): Promise<void> {
    try {
      await invoke('release_onnx_session');
    } catch (e) {
      console.warn('release_onnx_session failed', e);
    }
    this.isInitialized = false;
  }
}
