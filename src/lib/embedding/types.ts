// 嵌入相关类型定义

export interface EmbeddingVector {
  vector: number[];
  dimension: number;
}

export interface EmbeddingResult {
  embeddings: number[][];
  tokens: number;
  cached: boolean;
}

export interface EmbeddingStrategy {
  /**
   * 生成文本嵌入向量
   * @param texts 要生成嵌入的文本数组
   * @returns 嵌入向量数组
   */
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  
  /**
   * 获取嵌入向量的维度
   */
  getDimension(): number;
  
  /**
   * 策略名称
   */
  getName(): string;
  
  /**
   * 初始化策略
   */
  initialize(): Promise<void>;
  
  /**
   * 清理资源
   */
  cleanup(): Promise<void>;
}

export interface EmbeddingConfig {
  strategy: 'ollama' | 'local-onnx';
  modelPath?: string;
  modelName?: string;
  tokenizerPath?: string;
  apiUrl?: string;
  maxBatchSize?: number;
  /** Maximum input tokens accepted by the configured embedding model. */
  maxLength?: number;
  timeout?: number;
}

export interface EmbeddingServiceOptions {
  config: EmbeddingConfig;
  enableCache?: boolean;
  cacheSize?: number;
  testMode?: boolean; // 启用测试模式详细日志
}

// 错误类型
export class EmbeddingError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
  options?: {
    normalize?: boolean;
    truncate?: boolean;
  };
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  dimension: number;
}

/**
 * 支持的嵌入策略类型
 */
export type EmbeddingStrategyType = 'ollama' | 'local-onnx';

// 模型错误相关
export class ModelLoadError extends EmbeddingError {
  constructor(message: string, public modelPath?: string) {
    super(message);
    this.name = 'ModelLoadError';
  }
}

export class EmbeddingGenerationError extends EmbeddingError {
  constructor(message: string, public inputTexts?: string[]) {
    super(message);
    this.name = 'EmbeddingGenerationError';
  }
}

/**
 * 嵌入服务和策略的通用配置
 */
