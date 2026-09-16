import {
  EmbeddingStrategy,
  EmbeddingConfig,
  EmbeddingServiceOptions,
  EmbeddingResult,
  EmbeddingError
} from './types';
import { OllamaStrategy } from './strategies/OllamaStrategy';
import { LocalOnnxEmbeddingStrategy } from './strategies/LocalOnnxEmbeddingStrategy';
import { modelConfigService } from './ModelConfigService';
import type { EmbeddingInferenceSource } from './strategies/LocalOnnxEmbeddingStrategy';

/**
 * 嵌入服务主类
 * 使用策略模式支持不同的嵌入生成方式
 *
 * 支持的策略：
 * - ollama: 通过Ollama服务运行模型
 * - local-onnx: 本地ONNX模型（基于Rust后端）
 */
export class EmbeddingService {
  private strategy: EmbeddingStrategy | null = null;
  private cache: Map<string, number[]> = new Map();
  private readonly options: EmbeddingServiceOptions;

  constructor(options: EmbeddingServiceOptions) {
    this.options = {
      enableCache: true,
      cacheSize: 1000,
      ...options
    };
  }

  /**
   * 初始化嵌入服务
   */
  async initialize(): Promise<void> {
    if (this.strategy) {
      return; // 已经初始化
    }

    await this.initializeStrategy();
  }

  private async initializeStrategy(): Promise<void> {
    try {
      const strategy = await this.createStrategy(this.options.config);
      await strategy.initialize();
      this.strategy = strategy;

      const strategyName = this.strategy.getName();
      console.info('嵌入服务初始化完成，使用策略:', strategyName);
    } catch (error) {
      console.error('嵌入服务初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建嵌入策略实例
   * 使用ModelConfigService统一管理模型配置
   */
  private async createStrategy(config: EmbeddingConfig): Promise<EmbeddingStrategy> {
    switch (config.strategy) {
      case 'local-onnx':
        return new LocalOnnxEmbeddingStrategy(config);

      case 'ollama':
        // 动态获取配置的 Ollama URL
        let apiUrl = config.apiUrl;
        if (!apiUrl) {
          const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
          apiUrl = await OllamaConfigService.getOllamaUrl();
          console.log(`[EmbeddingService] 使用配置的 Ollama URL: ${apiUrl}`);
        }

        // 从ModelConfigService获取正确的维度信息
        const modelName = config.modelName || 'nomic-embed-text';
        const dimension = await modelConfigService.getModelDimensions(modelName);

        return new OllamaStrategy({
          apiUrl,
          modelName,
          dimension,
          timeout: config.timeout || 30000,
          maxBatchSize: config.maxBatchSize || 10
        });

      default:
        throw new EmbeddingError(`不支持的嵌入策略: ${config.strategy}`);
    }
  }

  /**
   * 生成单个文本的嵌入向量
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.strategy) {
      throw new EmbeddingError('嵌入服务未初始化，请先调用 initialize()');
    }

    // 检查缓存
    if (this.options.enableCache !== false) {
      const cached = this.cache.get(text);
      if (cached) {
        console.log('从缓存获取嵌入向量');
        return cached;
      }
    }

    try {
      const embeddings = await this.strategy.generateEmbeddings([text]);
      const embedding = embeddings[0];

      // 缓存结果
      if (this.options.enableCache !== false) {
        this.cache.set(text, embedding);

        // 限制缓存大小
        const maxCacheSize = this.options.cacheSize || 1000;
        if (this.cache.size > maxCacheSize) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey !== undefined) {
            this.cache.delete(firstKey);
          }
        }
      }

      return embedding;
    } catch (error) {
      console.error('生成嵌入向量失败:', error);
      throw error;
    }
  }

  /**
   * 批量生成嵌入向量
   * @param texts 文本数组
   * @returns 嵌入向量结果数组
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.strategy) {
      throw new EmbeddingError('嵌入服务未初始化');
    }

    if (texts.length === 0) {
      return [];
    }

    try {
      // 检查缓存
      const cachedResults: number[][] = [];
      const uncachedTexts: string[] = [];
      const resultMap: Map<number, number[]> = new Map();

      if (this.options.enableCache !== false) {
        texts.forEach((text, index) => {
          const cached = this.cache.get(text);
          if (cached) {
            resultMap.set(index, cached);
          } else {
            uncachedTexts.push(text);
          }
        });
      } else {
        uncachedTexts.push(...texts);
      }

      // 生成未缓存的嵌入
      let newEmbeddings: number[][] = [];
      if (uncachedTexts.length > 0) {
        newEmbeddings = await this.strategy.generateEmbeddings(uncachedTexts);

        // 缓存新结果
        if (this.options.enableCache !== false) {
          uncachedTexts.forEach((text, index) => {
            this.cache.set(text, newEmbeddings[index]);
          });

          // 限制缓存大小
          const maxCacheSize = this.options.cacheSize || 1000;
          while (this.cache.size > maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
              this.cache.delete(firstKey);
            } else {
              break;
            }
          }
        }
      }

      // 合并结果
      const results: number[][] = new Array(texts.length);
      let newIndex = 0;

      texts.forEach((text, index) => {
        if (resultMap.has(index)) {
          // 使用缓存的结果
          results[index] = resultMap.get(index)!;
        } else {
          // 使用新生成的结果
          results[index] = newEmbeddings[newIndex];
          newIndex++;
        }
      });

      return results;
    } catch (error) {
      console.error('批量生成嵌入向量失败:', error);
      throw error;
    }
  }

  /**
   * 获取嵌入向量维度
   */
  getDimension(): number {
    if (!this.strategy) {
      throw new EmbeddingError('嵌入服务未初始化');
    }
    return this.strategy.getDimension();
  }

  /**
   * 获取当前策略名称
   */
  getStrategyName(): string {
    if (!this.strategy) {
      throw new EmbeddingError('嵌入服务未初始化');
    }
    return this.strategy.getName();
  }

  /**
   * 获取用户友好的策略名称
   */
  getUserFriendlyStrategyName(): string {
    if (!this.strategy) {
      throw new EmbeddingError('嵌入服务未初始化');
    }

    const strategyName = this.strategy.getName();

    // 映射技术名称到用户友好名称
    const friendlyNames: Record<string, string> = {
      'OllamaStrategy': 'Ollama 服务',
      'LocalOnnxEmbeddingStrategy': '本地离线推理',
      'TauriOrtStrategy': '本地离线推理（模拟）',
      'OrtEmbeddingStrategy': '本地离线推理',
      // 如果没有匹配，根据策略类型返回友好名称
    };

    // 先尝试精确匹配
    if (friendlyNames[strategyName]) {
      return friendlyNames[strategyName];
    }

    // 如果没有精确匹配，根据策略类型判断
    if (strategyName.toLowerCase().includes('ollama')) {
      return 'Ollama 服务';
    } else if (strategyName.toLowerCase().includes('ort') ||
               strategyName.toLowerCase().includes('onnx') ||
               strategyName.toLowerCase().includes('tauri')) {
      return '本地离线推理';
    } else {
      return '未知服务';
    }
  }

  /**
   * 获取当前推理来源（仅 local-onnx 有意义）
   */
  getEmbeddingSource(): EmbeddingInferenceSource | 'ollama' | 'unknown' {
    if (!this.strategy) return 'unknown';
    if (this.options.config.strategy === 'ollama') return 'ollama';
    const s = this.strategy as { getEmbeddingSource?: () => EmbeddingInferenceSource };
    return typeof s.getEmbeddingSource === 'function' ? s.getEmbeddingSource() : 'unknown';
  }

  isUsableForRag(): boolean {
    const src = this.getEmbeddingSource();
    return src === 'real' || src === 'ollama';
  }

  /**
   * Stable identity for vectors produced by the current model and preprocessing.
   * Retrieval must never fuse vectors from a different model or dimension.
   */
  getEmbeddingFingerprint(): string | null {
    if (!this.strategy || !this.isUsableForRag()) return null;
    const config = this.options.config;
    const model = config.modelName || config.modelPath || 'default';
    return `${config.strategy}:${model}:${this.getDimension()}:${this.getMaxInputTokens()}:v1`;
  }

  getMaxInputTokens(): number {
    const strategy = this.strategy as (EmbeddingStrategy & { getMaxInputTokens?: () => number }) | null;
    if (strategy?.getMaxInputTokens) return strategy.getMaxInputTokens();
    if (this.options.config.maxLength) return this.options.config.maxLength;
    const model = this.options.config.modelName
      ? modelConfigService.getModelContextLength(this.options.config.modelName)
      : undefined;
    return model || 512;
  }

  /**
   * 检查服务是否已初始化
   */
  isInitialized(): boolean {
    return this.strategy !== null;
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.cache.clear();
    console.log('嵌入向量缓存已清理');
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    enabled: boolean;
  } {
    return {
      size: this.cache.size,
      maxSize: this.options.cacheSize || 1000,
      enabled: this.options.enableCache !== false
    };
  }

  /**
   * 切换策略
   */
  async switchStrategy(config: EmbeddingConfig): Promise<void> {
    try {
      // 清理当前策略
      if (this.strategy) {
        await this.strategy.cleanup();
      }

      // 创建新策略
      const nextStrategy = await this.createStrategy(config);
      await nextStrategy.initialize();
      this.strategy = nextStrategy;

      // 清理缓存（因为不同策略的嵌入可能不兼容）
      this.clearCache();

      console.log(`已切换到新的嵌入策略: ${this.strategy.getName()}`);
    } catch (error) {
      console.error('切换嵌入策略失败:', error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      if (this.strategy) {
        await this.strategy.cleanup();
        this.strategy = null;
      }
      this.clearCache();
      console.log('嵌入服务已清理');
    } catch (error) {
      console.error('清理嵌入服务失败:', error);
      throw error;
    }
  }
}

/**
 * 创建默认的嵌入服务实例
 */
export function createEmbeddingService(config?: Partial<EmbeddingServiceOptions>): EmbeddingService {
  const defaultOptions: EmbeddingServiceOptions = {
    config: {
      strategy: 'local-onnx',
      maxBatchSize: 32,
      timeout: 30000
    },
    enableCache: true,
    cacheSize: 1000
  };

  const options = {
    ...defaultOptions,
    ...config,
    config: {
      ...defaultOptions.config,
      ...config?.config
    }
  };

  return new EmbeddingService(options);
}
